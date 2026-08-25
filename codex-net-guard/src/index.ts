import * as http from 'node:http';
import * as net from 'node:net';

export interface NetGuardOptions {
  port?: number;
  /** Suffix-matched: 'example.com' also allows sub.example.com */
  allowedDomains: string[];
  /** Where to forward allowed traffic; default real network :443/:80 by scheme */
  resolve?: (host: string) => { host: string; port: number };
}

function matchesDomain(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/:.*$/,'');
  const p = pattern.toLowerCase();
  return h === p || h.endsWith('.'+p);
}

export function createWhitelistProxy(opts: NetGuardOptions) {
  const resolve = opts.resolve ?? ((host:string)=>({host, port:443}));
  const isAllowed = (h:string)=>opts.allowedDomains.some((p)=>matchesDomain(h,p));

  const server = http.createServer((req,res)=>{
    let host = '';
    try { host = new URL(req.url ?? '/', 'http://placeholder.invalid').hostname; }
    catch { host = String(req.headers.host ?? ''); }
    if (!isAllowed(host)) { res.writeHead(403, {'content-type':'text/plain'}); res.end('net-guard: blocked '+host); return; }
    const t = resolve(host);
    const fwd = http.request({ host:t.host, port:t.port, path:req.url, method:req.method,
      headers:{...req.headers, host} }, (up)=>{
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    fwd.on('error', ()=>{ res.writeHead(502); res.end('net-guard: bad gateway'); });
    req.pipe(fwd);
  });

  server.on('connect', (req, socket, head)=>{
    const host = (req.url ?? '').split(':')[0];
    if (!isAllowed(host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\nnblocked by net-guard');
      socket.destroy(); return;
    }
    const t = resolve(host);
    const up = net.connect(t.port, t.host, ()=>{
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on('error', ()=>socket.destroy());
    socket.on('error', ()=>up.destroy());
  });

  server.listen(opts.port ?? 0, '127.0.0.1');
  const addr = (): number => { const a = server.address(); return typeof a==='object'&&a ? a.port : Number(opts.port); };
  return { server, url: ()=>`http://127.0.0.1:${addr()}`, port: addr, close: ()=>server.close() };
}
