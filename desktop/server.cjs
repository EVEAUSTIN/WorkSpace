'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ORIGIN = 'http://localhost:17383';
function startServer(root) {
  const server = http.createServer((req,res) => {
    if(req.headers.host !== 'localhost:17383' || !['GET','HEAD'].includes(req.method)) {res.writeHead(403).end();return;}
    let pathname;
    try { pathname=decodeURIComponent(new URL(req.url,ORIGIN).pathname); } catch { res.writeHead(400).end();return; }
    const relative=pathname.slice(1);
    if(!/^(index\.html|cloudbase-test\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(relative)){res.writeHead(404).end();return;}
    const filename=path.join(root,relative);
    const type=filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream';
    fs.readFile(filename,(error,data)=>{
      if(error){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data);
    });
  });
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(17383,'127.0.0.1',()=>resolve(server));});
}
module.exports={startServer,ORIGIN};
