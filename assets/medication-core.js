/* Medication scheduling and atomic inventory accounting, shared by browser and tests. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QijianMedication=factory();})(globalThis,()=>{
  'use strict';
  const MAX=1000000000;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=(v,n,min=0)=>typeof v==='string'&&v.length>=min&&v.length<=n;
  const id=v=>text(v,100,1);
  const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const cents=v=>{if(!Number.isFinite(v)||Math.abs(v*100-Math.round(v*100))>0.000001||v<0||v>MAX)throw Error('数量须为最多两位小数，且不能为负数或超出上限。');return Math.round(v*100);};
  const labels=n=>n===1?['服药']:n===2?['早晨','晚上']:n===3?['早晨','中午','晚上']:n===4?['早晨','中午','晚上','睡前']:Array.from({length:n},(_,i)=>'第 '+(i+1)+' 次');
  const key=(day,regimenId,slot)=>day+'|'+regimenId+'|'+slot;
  function care(state){
    if(state.care)return clone(state.care);
    const old=state.illness;
    return {version:1,conditions:old&&(old.active||old.name||old.plan)?[{id:'legacy-illness',active:old.active,name:old.name||'原生病状态',notes:old.plan||'',regimens:[]}]:[],intakes:[]};
  }
  function validCare(value){
    if(!value||value.version!==1||!Array.isArray(value.conditions)||!Array.isArray(value.intakes)||value.conditions.length>100)return false;
    const ids=new Set(),regimenIds=new Set(),intakeIds=new Set();
    for(const c of value.conditions){
      if(!c||!id(c.id)||ids.has(c.id)||typeof c.active!=='boolean'||!text(c.name,200,1)||!text(c.notes,3000)||!Array.isArray(c.regimens)||c.regimens.length>30)return false;
      ids.add(c.id);
      for(const r of c.regimens){
        if(!r||!id(r.id)||regimenIds.has(r.id)||!id(r.medicineId)||!Number.isFinite(r.dose)||r.dose<0.01||r.dose>MAX||!Number.isInteger(r.frequency)||r.frequency<1||r.frequency>6)return false;
        try{cents(r.dose);}catch{return false;}regimenIds.add(r.id);
      }
    }
    for(const i of value.intakes){
      if(!i||!text(i.id,130,1)||!date(i.date)||!id(i.regimenId)||!id(i.conditionId)||!id(i.medicineId)||!Number.isInteger(i.slot)||i.slot<0||i.slot>5||i.id!==key(i.date,i.regimenId,i.slot)||intakeIds.has(i.id)||!text(i.label,20,1)||!text(i.unit,20,1)||!text(i.medicineName,120,1)||!text(i.conditionName,200,1)||!Number.isFinite(i.amount)||i.amount<0.01||!Number.isFinite(i.time))return false;
      try{cents(i.amount);}catch{return false;}intakeIds.add(i.id);
    }
    return true;
  }
  function withCare(state,value){
    if(!validCare(value))throw Error('生病状态或服药记录无效。');
    const active=value.conditions.filter(c=>c.active);
    state.care=value;
    state.illness={active:active.length>0,name:active.map(c=>c.name).join('、').slice(0,200),plan:active.map(c=>c.name+(c.notes?'：'+c.notes:'')).join('\n').slice(0,3000)};
    return state;
  }
  function schedules(state,day){
    const value=care(state),rows=[];
    for(const c of value.conditions.filter(c=>c.active))for(const r of c.regimens){
      const m=state.items.find(m=>m.id===r.medicineId);
      labels(r.frequency).forEach((label,slot)=>{
        const record=value.intakes.find(i=>i.id===key(day,r.id,slot))||null;
        rows.push({key:key(day,r.id,slot),conditionId:c.id,conditionName:c.name,regimenId:r.id,slot,label,frequency:r.frequency,medicineId:r.medicineId,medicineName:m?.name||'药品已删除',amount:r.dose,unit:m?.unit||record?.unit||'',expiry:m?.expiry||'',record,available:!!m&&m.expiry>day.slice(0,7)});
      });
    }
    for(const record of value.intakes.filter(i=>i.date===day)){
      if(rows.some(row=>row.key===record.id))continue;
      rows.push({key:record.id,conditionId:record.conditionId,conditionName:record.conditionName,regimenId:record.regimenId,slot:record.slot,label:record.label,frequency:0,medicineId:record.medicineId,medicineName:record.medicineName,amount:record.amount,unit:record.unit,expiry:'',record,available:false,history:true});
    }
    return rows;
  }
  const signature=row=>JSON.stringify([row.conditionId,row.regimenId,row.medicineId,row.amount,row.unit,row.frequency]);
  function change(row,take){return {take,expected:row.record?JSON.stringify(row.record):null,schedule:signature(row)};}
  function apply(state,day,changes,now=Date.now()){
    if(!date(day)||!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('服药记录日期或选项无效。');
    const next=clone(state),value=care(next),rows=schedules(next,day),operations=[],delta=new Map();
    for(const [slotKey,edit] of Object.entries(changes)){
      const row=rows.find(r=>r.key===slotKey);
      if(!row&&edit?.take===false&&!value.intakes.some(i=>i.id===slotKey))continue;
      if(!row||!edit||typeof edit.take!=='boolean'||edit.schedule!==signature(row))throw Error('服药安排已经变化，请重新核对后选择。');
      const current=value.intakes.find(i=>i.id===slotKey)||null;
      if(edit.take&&current){
        if(current.medicineId!==row.medicineId||current.amount!==row.amount||current.unit!==row.unit)throw Error('此次数已按另一用量保存，请先核对原记录。');
        continue; // Retrying an already stored dose never deducts inventory again.
      }
      if(!edit.take&&!current)continue;
      if(edit.expected!==(current?JSON.stringify(current):null))throw Error('服药记录已更新，请重新核对后选择。');
      const medicine=next.items.find(m=>m.id===(current?.medicineId||row.medicineId));
      if(!medicine)throw Error('原药品批次已删除，无法扣减或恢复库存，请先核对药箱。');
      if(edit.take){
        if(!row.available)throw Error('药品在记录月份已到期，不能记录服用，请核对药箱。');
        const record={id:slotKey,date:day,conditionId:row.conditionId,conditionName:row.conditionName,regimenId:row.regimenId,slot:row.slot,label:row.label,medicineId:medicine.id,medicineName:medicine.name,amount:row.amount,unit:medicine.unit,time:now};
        value.intakes.push(record);delta.set(medicine.id,(delta.get(medicine.id)||0)-cents(row.amount));operations.push({record,undo:false});
      }else{
        if(current.unit!==medicine.unit)throw Error('药品库存单位已变化，不能直接恢复原记录，请核对药箱。');
        value.intakes=value.intakes.filter(i=>i.id!==slotKey);delta.set(medicine.id,(delta.get(medicine.id)||0)+cents(current.amount));operations.push({record:current,undo:true});
      }
    }
    for(const [medicineId,amount] of delta){
      const m=next.items.find(m=>m.id===medicineId),result=cents(m.quantity)+amount;
      if(result<0)throw Error('「'+m.name+'」库存不足，本次所有服药选择均未保存。');
      if(result>MAX*100)throw Error('恢复后库存超出上限，本次未保存。');
      m.quantity=result/100;
    }
    withCare(next,value);return {state:next,operations};
  }
  return {care,validCare,withCare,labels,key,schedules,signature,change,apply};
});
