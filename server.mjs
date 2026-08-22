import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), 'prototype');
createServer((req,res)=>{
  const f = req.url==='/' ? 'index.html' : req.url.slice(1);
  try { res.writeHead(200,{'content-type': f.endsWith('.html')?'text/html':'text/plain'});
        res.end(readFileSync(join(root,f))); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(7777,'127.0.0.1',()=>console.log('http://127.0.0.1:7777'));
