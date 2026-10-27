/* Versioned, per-module synchronization. No credentials or UI dependencies. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QijianSyncCore=factory();})(globalThis,()=>{
  'use strict';
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  class SyncEngine {
    constructor({owner,specs,repo,remote,canApply=()=>true,onApply=()=>{}}){
      this.owner=owner;this.specs=specs;this.repo=repo;this.remote=remote;this.canApply=canApply;this.onApply=onApply;this.busy=false;this.stopped=false;this.conflicts=new Map();
      this.meta=repo.meta()||{format:1,owner,bases:{}};
      if(this.meta.format!==1||this.meta.owner!==owner||!this.meta.bases||typeof this.meta.bases!=='object')throw Error('ACCOUNT');
      for(const spec of specs){const base=this.meta.bases[spec.key];if(base&&(!Number.isSafeInteger(base.version)||base.version<1||typeof base.value!=='string'||!spec.valid(JSON.parse(base.value))))throw Error('META');}
      repo.commit(this.meta,null,[]);
    }
    stop(){this.stopped=true;}
    check(){if(this.stopped)throw Error('STOPPED');}
    local(spec){const raw=this.repo.get(spec.key);const value=raw===null?spec.empty:JSON.parse(raw);if(!spec.valid(value))throw Error('LOCAL');return canonical(value);}
    decode(spec,row){
      if(!row)return null;
      if(row.owner_id!==this.owner||row.collection!=='workspace_v1'||row.record_id!==spec.key||!Number.isSafeInteger(row.version)||row.version<1||row.deleted!==false||row.payload?.format!==1||typeof row.payload.value!=='string')throw Error('REMOTE');
      const value=JSON.parse(row.payload.value);if(!spec.valid(value))throw Error('REMOTE');
      return {version:row.version,value:canonical(value)};
    }
    commit(spec,remote,apply=false,archives=[]){
      this.check();
      const meta={format:1,owner:this.owner,bases:{...this.meta.bases,[spec.key]:remote}};
      this.repo.commit(meta,apply?{key:spec.key,value:remote.value}:null,archives);
      this.meta=meta;this.conflicts.delete(spec.key);
      if(apply)this.onApply(spec.key);
    }
    async write(spec,value,remote,archives=[]){
      const row=await this.remote.write(spec.key,value,remote?.version??null);this.check();
      const result=this.decode(spec,row);
      if(!result||result.value!==value||result.version!==(remote?remote.version+1:1))throw Error('WRITE');
      this.commit(spec,result,false,archives);
    }
    async cycle(){
      if(this.busy||this.stopped)return {busy:true};this.busy=true;let pending=0;
      try{
        for(const spec of this.specs){
          this.check();
          const cloud=this.decode(spec,await this.remote.read(spec.key));this.check();
          const local=this.local(spec),base=this.meta.bases[spec.key];
          if(base&&cloud&&(cloud.version<base.version||(cloud.version===base.version&&cloud.value!==base.value)))throw Error('REMOTE');
          if(cloud&&cloud.value===local){this.commit(spec,cloud);continue;}
          if(!cloud){
            if(base){this.conflicts.set(spec.key,{key:spec.key,remote:null});continue;}
            if(local!==canonical(spec.empty))await this.write(spec,local,null);
            continue;
          }
          const changed=base?local!==base.value:local!==canonical(spec.empty);
          if(!changed){
            if(this.canApply(spec.key))this.commit(spec,cloud,true,[{key:spec.key,value:local,reason:'remote-apply'}]);else pending++;
          }else if(base&&base.version===cloud.version&&base.value===cloud.value){
            await this.write(spec,local,cloud);
          }else this.conflicts.set(spec.key,{key:spec.key,remote:cloud});
        }
        // Edits made while a request was in flight remain pending, never acknowledged as uploaded.
        for(const spec of this.specs){const base=this.meta.bases[spec.key];if(base&&this.local(spec)!==base.value&&!this.conflicts.has(spec.key))pending++;}
        return {pending,conflicts:this.conflicts.size};
      }finally{this.busy=false;}
    }
    async resolve(key,choice){
      if(this.busy||this.stopped)throw Error('BUSY');
      const conflict=this.conflicts.get(key),spec=this.specs.find(s=>s.key===key);
      if(!conflict||!spec||!['local','cloud'].includes(choice))throw Error('CONFLICT');
      if(!this.canApply(key))throw Error('EDITING');
      this.busy=true;
      try{
        const latest=this.decode(spec,await this.remote.read(key));this.check();
        if(latest?.version!==conflict.remote?.version||latest?.value!==conflict.remote?.value){this.conflicts.set(key,{key,remote:latest});throw Error('CHANGED');}
        const local=this.local(spec);
        if(choice==='cloud'){
          if(!latest)throw Error('MISSING');
          this.commit(spec,latest,true,[{key,value:local,reason:'conflict-local'}]);
        }else{
          // Persist the other version before an explicitly chosen replacement is sent.
          if(latest)this.repo.archive({key,value:latest.value,reason:'conflict-cloud'});
          await this.write(spec,local,latest);
        }
      }finally{this.busy=false;}
    }
  }
  return {canonical,SyncEngine};
});
