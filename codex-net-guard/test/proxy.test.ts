import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { createWhitelistProxy } from '../src/index';

let upstreamPort = 0;
const upstream = http.createServer((req,res)=>{
  res.writeHead(200, {'content-type':'text/plain'});
  res.end('hello from '+req.headers.host);
});
beforeAll(()=>new Promise<void>((ok)=>{ upstream.listen(0,'127.0.0.1',()=>{ upstreamPort=(upstream.address() as any).port; ok(); });}));
afterAll(()=>{ upstream.close(); guard.close(); });

const guard = createWhitelistProxy({
  allowedDomains: ['allowed.test'],
  resolve: (host)=>({host:'127.0.0.1', port: upstreamPort}),
});

function viaProxy(pathUrl: string, host: string): Promise<{status?:number, body:string}> {
  return new Promise((resolve)=>{
    const req = http.request({host:'127.0.0.1', port:guard.port(), path:pathUrl, method:'GET', headers:{host}}, (res)=>{
      let body=''; res.on('data',(c)=>body+=c); res.on('end',()=>resolve({status:res.statusCode, body}));
    });
    req.end();
  });
}

describe('net-guard whitelist proxy', () => {
  it('forwards allowed domains to upstream', async () => {
    const r = await viaProxy('http://allowed.test/hello', 'allowed.test');
    expect(r.status).toBe(200);
    expect(r.body).toContain('allowed.test');
  });
  it('blocks non-whitelisted domains with 403', async () => {
    const r = await viaProxy('http://evil.test/x', 'evil.test');
    expect(r.status).toBe(403);
    expect(r.body).toContain('blocked');
  });
  it('denies CONNECT tunnels to blocked hosts', () => {
    const result = new Promise<string>((resolve)=>{
      const s = net.connect(guard.port(),'127.0.0.1',()=>{
        s.write('CONNECT secret.example.com:443 HTTP/1.1\r\nHost: secret.example.com\r\n\r\n');
      });
      s.on('data',(d)=>{ resolve(d.toString().split('\r\n')[0]); s.destroy(); });
    });
    return result.then((line)=>expect(line).toContain('403'));
  });
});
