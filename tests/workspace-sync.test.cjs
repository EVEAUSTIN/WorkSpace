'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SyncEngine,canonical}=require('../assets/workspace-sync-core.js');
const spec={key:'qijian-memos-v1',empty:[],valid:v=>Array.isArray(v)&&v.every(s=>typeof s==='string')};
function server(){
  const rows=new Map();
  return {rows,client(owner){return {
    async read(key){return rows.get(owner+key)||null;},
    async write(key,value,version){
      const old=rows.get(owner+key);
      if((old?.version??null)!==version)throw Error('CONFLICT');
      const row={owner_id:owner,collection:'workspace_v1',record_id:key,payload:{format:1,value},deleted:false,version:(version||0)+1};
      rows.set(owner+key,row);return row;
    }
  };}};
}
function device(cloud,owner='alice',existing=null){
  const data=new Map(existing?[[spec.key,JSON.stringify(existing)]]:[]),history=[];
  let meta=null,apply=true;
  const repo={get:k=>data.get(k)??null,meta:()=>meta,commit:(m,item,archive)=>{meta=structuredClone(m);if(item)data.set(item.key,item.value);history.push(...archive);},archive:item=>history.push(item)};
  const remote=cloud.client(owner);
  let engine=new SyncEngine({owner,specs:[spec],repo,remote,canApply:()=>apply});
  return {data,history,repo,remote,get engine(){return engine;},set engine(v){engine=v;},setApply:v=>apply=v,set:v=>data.set(spec.key,JSON.stringify(v)),get:()=>JSON.parse(data.get(spec.key)||'[]'),restart:()=>engine=new SyncEngine({owner,specs:[spec],repo,remote})};
}
test('two devices download, edit and delete; deleted module contents do not resurrect',async()=>{
  const cloud=server(),a=device(cloud,'alice',['one']),b=device(cloud);
  await a.engine.cycle();await b.engine.cycle();assert.deepEqual(b.get(),['one']);
  b.set(['two']);await b.engine.cycle();await a.engine.cycle();assert.deepEqual(a.get(),['two']);
  a.set([]);await a.engine.cycle();await b.engine.cycle();assert.deepEqual(b.get(),[]);
  b.restart();await b.engine.cycle();assert.deepEqual(b.get(),[]);
});
test('concurrent same-module edits conflict and preserve both versions; resolution uses CAS',async()=>{
  const cloud=server(),a=device(cloud,'alice',['base']),b=device(cloud);
  await a.engine.cycle();await b.engine.cycle();a.set(['A']);b.set(['B']);
  await a.engine.cycle();const result=await b.engine.cycle();assert.equal(result.conflicts,1);assert.deepEqual(b.get(),['B']);
  await b.engine.resolve(spec.key,'local');assert.equal(b.history.at(-1).value,canonical(['A']));
  await a.engine.cycle();assert.deepEqual(a.get(),['B']);
  a.set(['A2']);b.set(['B2']);await a.engine.cycle();await b.engine.cycle();
  a.set(['A3']);await a.engine.cycle();await assert.rejects(b.engine.resolve(spec.key,'cloud'),/CHANGED/);
  await b.engine.resolve(spec.key,'cloud');assert.deepEqual(b.get(),['A3']);assert.equal(b.history.at(-1).value,canonical(['B2']));
});
test('first login with different existing contents never silently replaces either device',async()=>{
  const cloud=server(),a=device(cloud,'alice',['old']),b=device(cloud,'alice',['new']);
  await a.engine.cycle();assert.equal((await b.engine.cycle()).conflicts,1);assert.deepEqual(b.get(),['new']);
});
test('offline and uncertain write survive restart; server confirmed retry is idempotent',async()=>{
  const cloud=server(),a=device(cloud,'alice',['first']);await a.engine.cycle();a.set(['offline']);
  const read=a.remote.read;a.remote.read=async()=>{throw Error('NETWORK');};
  await assert.rejects(a.engine.cycle(),/NETWORK/);a.remote.read=read;a.restart();await a.engine.cycle();
  const write=a.remote.write;a.set(['uncertain']);a.remote.write=async(...args)=>{await write(...args);throw Error('NETWORK');};
  await assert.rejects(a.engine.cycle(),/NETWORK/);a.remote.write=write;a.restart();
  await a.engine.cycle();assert.equal(a.engine.conflicts.size,0);assert.deepEqual(a.get(),['uncertain']);
  assert.equal(cloud.rows.get('alice'+spec.key).version,3);
});
test('an edit during upload is left pending; busy editing defers remote downloads',async()=>{
  const cloud=server(),a=device(cloud,'alice',['start']),b=device(cloud);await a.engine.cycle();await b.engine.cycle();
  const write=a.remote.write;a.remote.write=async(...args)=>{a.set(['newer']);return write(...args);};a.set(['old']);
  assert.equal((await a.engine.cycle()).pending,1);a.remote.write=write;await a.engine.cycle();
  b.setApply(false);assert.equal((await b.engine.cycle()).pending,1);assert.deepEqual(b.get(),['start']);
  b.setApply(true);await b.engine.cycle();assert.deepEqual(b.get(),['newer']);
});
test('owner pinning, foreign rows, invalid payloads and version rollback are rejected',async()=>{
  const cloud=server(),a=device(cloud,'alice',['one']);await a.engine.cycle();
  assert.throws(()=>new SyncEngine({owner:'bob',specs:[spec],repo:a.repo,remote:cloud.client('bob')}),/ACCOUNT/);
  const saved=cloud.rows.get('alice'+spec.key);
  for(const patch of [{owner_id:'bob'},{payload:{format:1,value:'{"not":"an array"}'}},{version:0},{version:1,payload:{format:1,value:'["tampered"]'}}]){
    cloud.rows.set('alice'+spec.key,{...saved,...patch});await assert.rejects(a.engine.cycle(),/REMOTE/);assert.deepEqual(a.get(),['one']);
  }
});
test('late response after logout cannot commit a downloaded record',async()=>{
  const cloud=server(),a=device(cloud,'alice',['remote']),b=device(cloud);await a.engine.cycle();
  const read=b.remote.read;b.remote.read=async key=>{const row=await read(key);b.engine.stop();return row;};
  await assert.rejects(b.engine.cycle(),/STOPPED/);assert.deepEqual(b.get(),[]);
});
