'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const med=require('../assets/medication-core.js');
const {SyncEngine}=require('../assets/workspace-sync-core.js');
const date='2026-10-28';
function state(){return {items:[{id:'m1',name:'药品甲',quantity:20,unit:'片',expiry:'2027-10',dosage:'',purpose:''}],logs:[],illness:{active:false,name:'',plan:''},care:{version:1,conditions:[{id:'c1',name:'状态甲',active:true,notes:'',regimens:[{id:'r1',medicineId:'m1',dose:0.5,frequency:3}]},{id:'c2',name:'状态乙',active:true,notes:'',regimens:[{id:'r2',medicineId:'m1',dose:1,frequency:1}]}],intakes:[]}};}
function selections(s,which=()=>true,take=true,day=date){return Object.fromEntries(med.schedules(s,day).filter(which).map(row=>[row.key,med.change(row,take)]));}
test('multiple conditions and frequency labels; cumulative stock deduction is exact and idempotent',()=>{
  const s=state(),edits=selections(s);
  assert.deepEqual(med.labels(1),['服药']);assert.deepEqual(med.labels(2),['早晨','晚上']);assert.deepEqual(med.labels(3),['早晨','中午','晚上']);assert.equal(med.labels(6).length,6);
  const saved=med.apply(s,date,edits);assert.equal(saved.operations.length,4);assert.equal(saved.state.items[0].quantity,17.5);assert.equal(saved.state.care.intakes.length,4);
  const retry=med.apply(saved.state,date,edits);assert.equal(retry.operations.length,0);assert.equal(retry.state.items[0].quantity,17.5);
  assert.equal(med.schedules(saved.state,'2026-10-29').filter(r=>r.record).length,0);
  assert.equal(s.items[0].quantity,20);assert.ok(med.validCare(saved.state.care));
});
test('insufficient stock, expired/deleted drugs and malformed doses leave original state intact',()=>{
  for(const patch of [{quantity:1},{expiry:'2026-10'}]){const s=state();Object.assign(s.items[0],patch);const before=JSON.stringify(s);assert.throws(()=>med.apply(s,date,selections(s)));assert.equal(JSON.stringify(s),before);}
  const s=state();const edits=selections(s);s.items=[];assert.throws(()=>med.apply(s,date,edits));
  const bad=state();bad.care.conditions[0].regimens[0].dose=0.005;assert.equal(med.validCare(bad.care),false);
});
test('undo restores the originally saved dose once, even when prescription is no longer active',()=>{
  let s=med.apply(state(),date,selections(state(),r=>r.regimenId==='r1'&&r.slot===0)).state;
  s.care.conditions[0].active=false;
  const undo=selections(s,r=>r.regimenId==='r1',false);
  s=med.apply(s,date,undo).state;assert.equal(s.items[0].quantity,20);assert.equal(s.care.intakes.length,0);
  assert.equal(med.apply(s,date,undo).state.items[0].quantity,20);
});
test('draft based on an old dose is rejected; snapshots survive changed prescriptions and deletion',()=>{
  const s=state(),draft=selections(s);s.care.conditions[0].regimens[0].dose=2;
  assert.throws(()=>med.apply(s,date,draft),/已经变化/);
  const saved=med.apply(state(),date,selections(state(),r=>r.slot===0)).state;
  saved.care.conditions[0].regimens=[];saved.items=[];
  assert.ok(med.validCare(saved.care));assert.equal(med.schedules(saved,date).find(r=>r.regimenId==='r1').record.amount,0.5);
});
test('legacy free text migrates without data loss and malformed ledger duplicates are rejected',()=>{
  const s=state();delete s.care;s.illness={active:true,name:'原症状',plan:'旧服药说明'};
  const migrated=med.care(s);assert.equal(migrated.conditions[0].notes,'旧服药说明');assert.equal(migrated.conditions[0].regimens.length,0);assert.equal(s.care,undefined);
  med.withCare(s,migrated);assert.ok(med.validCare(s.care));
  const saved=med.apply(state(),date,selections(state())).state;saved.care.intakes.push(saved.care.intakes[0]);assert.equal(med.validCare(saved.care),false);
});
test('two devices taking the same dose cannot add their stock deductions together during sync',async()=>{
  let cloud=null;
  const spec={key:'qijian-medicine-v1',empty:state(),valid:s=>med.validCare(s.care)};
  function device(){let local=JSON.stringify(state()),meta=null;
    const engine=new SyncEngine({owner:'same-user',specs:[spec],repo:{get:()=>local,meta:()=>meta,commit:(m,item)=>{meta=m;if(item)local=item.value;},archive:()=>{}},remote:{read:async()=>cloud,write:async(key,value,version)=>{if((cloud?.version??null)!==version)throw Error('CONFLICT');cloud={owner_id:'same-user',collection:'workspace_v1',record_id:key,payload:{format:1,value},version:(version||0)+1,deleted:false};return cloud;}}});
    return {engine,get:()=>JSON.parse(local),set:s=>{local=JSON.stringify(s);}};
  }
  const a=device(),b=device();a.set({...state(),items:state().items.map(m=>({...m,quantity:21}))});await a.engine.cycle();await b.engine.cycle();
  for(const d of [a,b]){const s=d.get();d.set(med.apply(s,date,selections(s,r=>r.regimenId==='r1'&&r.slot===0),d===a?1:2).state);}
  await a.engine.cycle();assert.equal((await b.engine.cycle()).conflicts,1);
  await b.engine.resolve(spec.key,'cloud');assert.equal(b.get().items[0].quantity,20.5);assert.equal(b.get().care.intakes.length,1);
});
