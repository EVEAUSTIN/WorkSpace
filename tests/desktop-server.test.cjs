'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const http=require('node:http');
const {startServer}=require('../desktop/server.cjs');
function request(url,host='localhost:17383'){
  return new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:17383,path:url,headers:{host}},response=>{let text='';response.on('data',part=>text+=part);response.on('end',()=>resolve({status:response.statusCode,text}));}).on('error',reject);});
}
test('loopback server serves only public assets, rejects foreign Host and private files',async()=>{
  const server=await startServer(path.join(__dirname,'..'));
  try {
    assert.equal((await request('/index.html')).status,200);
    assert.equal((await request('/assets/workspace-sync.js')).status,200);
    for(const url of ['/package.json','/desktop/main.cjs','/.git/config','/assets/%2e%2e/desktop/storage.cjs','/%ZZ'])assert.notEqual((await request(url)).status,200);
    assert.equal((await request('/index.html','attacker.test:17383')).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
