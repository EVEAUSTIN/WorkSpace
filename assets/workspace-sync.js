/* Desktop sync controller. Secrets never appear in status text or the repository. */
(()=>{
  'use strict';
  if(!window.qijianDesktop||!window.qijianSyncWorkspace)return;
  const $=id=>document.getElementById('workspace-sync-'+id);
  const storage=window.qijianDesktop.storage, workspace=window.qijianSyncWorkspace;
  const META='desktop:sync-meta',CONFIG='desktop:sync-config';
  const ENV='emotional-newt-d5gg8duqi1ab13685', COLLECTION='workspace_v1';
  const ENDPOINT=`https://${ENV}.api.tcloudbasegateway.com/v1/rdb/rest/qijian_records`;
  const state={auth:null,user:null,engine:null,busy:false,generation:0,requests:new Set(),config:null,restoring:false,blocked:false};
  function status(text){$('status').textContent=text;document.getElementById('workspace-sync-summary').textContent=text;}
  function readConfig(){const raw=storage.getItem(CONFIG);return raw?JSON.parse(raw):null;}
  function controls(){
    const logged=!!state.user;
    $('login').classList.toggle('hidden',logged);
    $('now').disabled=!logged||state.busy||state.blocked;$('logout').disabled=!logged&& !state.config?.enabled;
    $('login-button').disabled=state.busy;
    for(const id of ['key','username','password','consent'])$(id).disabled=state.busy;
    $('user').textContent=logged?'已登录：'+state.config.username:'尚未登录。';
  }
  function errorText(error){
    const code=error?.message;
    const messages={ACCOUNT:'本机数据已绑定另一个账号，已阻止同步。请使用原账号，避免混合个人数据。',META:'同步版本信息异常，已暂停。请保留本地数据库并联系排查。',LOCAL:'本地模块未通过校验，已暂停该轮同步。',REMOTE:'云端记录格式或归属不符合预期，已停止本轮同步。请检查权限与版本。',AUTH:'登录会话已失效，请退出后重新登录。',PERMISSION:'云端拒绝访问（403），请检查 RLS 和 authenticated 授权，勿关闭 RLS。',NETWORK:'网络请求未完成，本机记录仍保留；稍后自动重试。写入结果将通过重新读取确认。',CONFLICT:'云端版本发生变化，稍后将重新读取并提示冲突。',WRITE:'服务器写入或版本号未按预期确认，已暂停本轮操作。',CHANGED:'云端又有新修改，请重新查看冲突后选择。',EDITING:'请先保存当前编辑并关闭编辑弹窗，再处理冲突。',MISSING:'云端模块被直接移除，不能自动采用。请先排查，再选择保留本机。',STOPPED:'同步已停止。',READY:'本机数据仍在加载或读取失败，暂不启动同步。'};
    return messages[code]||'操作未完成，本机记录未清空。请检查网络与 localhost:17383 安全域名配置；登录失败时可用独立连接测试页查看诊断。';
  }
  const repo={
    get:key=>storage.getItem(key),
    meta:()=>{const raw=storage.getItem(META);return raw?JSON.parse(raw):null;},
    commit:(meta,item,archives)=>window.qijianDesktop.commit([{key:META,value:JSON.stringify(meta)},...(item?[item]:[])],archives),
    archive:item=>window.qijianDesktop.commit([],[item])
  };
  function newAuth(key){return window.QijianCloudbase.init({env:ENV,region:'ap-shanghai',accessKey:key,persistence:'local',endPointMode:'GATEWAY'}).auth();}
  async function request(method,key,version,value){
    const generation=state.generation;
    const token=await state.auth.getAccessToken();
    if(generation!==state.generation)throw Error('STOPPED');
    if(typeof token?.accessToken!=='string'||!token.accessToken)throw Error('AUTH');
    const params=new URLSearchParams();
    if(method!=='POST'){
      params.set('collection','eq.'+COLLECTION);params.set('record_id','eq.'+key);
      params.set('select','owner_id,collection,record_id,payload,version,deleted,updated_at');
      if(method==='PATCH'){params.set('owner_id','eq.'+state.user.id);params.set('version','eq.'+version);}
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);state.requests.add(controller);
    try{
      const response=await fetch(ENDPOINT+'?'+params,{method,signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+token.accessToken,'Content-Type':'application/json',Prefer:'return=representation'},
        ...(method==='GET'?{}:{body:JSON.stringify({...(method==='POST'?{owner_id:state.user.id,collection:COLLECTION,record_id:key}:{}),payload:{format:1,value},deleted:false})})});
      if(generation!==state.generation)throw Error('STOPPED');
      if(response.status===401)throw Error('AUTH');if(response.status===403)throw Error('PERMISSION');if(response.status===409)throw Error('CONFLICT');
      if(!response.ok)throw Error('HTTP');
      const rows=await response.json();if(!Array.isArray(rows)||rows.length>1)throw Error('REMOTE');
      if(method!=='GET'&&rows.length!==1)throw Error('CONFLICT');return rows[0]||null;
    }catch(error){if(['AUTH','PERMISSION','CONFLICT','HTTP','REMOTE','STOPPED'].includes(error.message))throw error;throw Error('NETWORK');}
    finally{clearTimeout(timer);state.requests.delete(controller);}
  }
  function conflicts(){
    const host=$('conflicts');host.replaceChildren();
    if(!state.engine)return;
    for(const conflict of state.engine.conflicts.values()){
      const spec=workspace.specs.find(s=>s.key===conflict.key),box=document.createElement('section');
      const title=document.createElement('h3');title.textContent=spec.label+'：两台设备都有修改';box.append(title);
      const explanation=document.createElement('p');explanation.textContent='以下选择作用于整个模块。被替换的版本自动保留在本机 SQLite 的冲突历史中。';box.append(explanation);
      for(const [label,value] of [['本机',state.engine.local(spec)],['云端',conflict.remote?.value??'云端模块不存在']]){
        const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=label+'内容预览';
        pre.textContent=value.slice(0,4000)+(value.length>4000?'\n（预览已截断，原数据完整保留）':'');pre.style.cssText='white-space:pre-wrap;max-height:240px;overflow:auto';details.append(summary,pre);box.append(details);
      }
      for(const [label,choice] of [['保留本机模块','local'],['采用云端模块','cloud']]){
        const button=document.createElement('button');button.textContent=label;button.type='button';button.disabled=state.busy||state.blocked||(choice==='cloud'&&!conflict.remote);
        button.onclick=async()=>{
          if(state.busy||!confirm('确定'+label+'“'+spec.label+'”？这会处理整个模块，不会自动逐条合并。'))return;
          const generation=state.generation;state.busy=true;controls();
          try{await state.engine.resolve(conflict.key,choice);if(generation===state.generation)status('冲突已处理，正在继续检查同步。');}
          catch(error){if(generation===state.generation){if(['WRITE','REMOTE','META','LOCAL'].includes(error.message))state.blocked=true;status(errorText(error));}}
          finally{if(generation===state.generation){state.busy=false;controls();conflicts();}}
          if(generation===state.generation)await sync();
        };box.append(button);
      }
      box.style.cssText='border-top:1px solid #ccc;padding:14px 0';host.append(box);
    }
  }
  async function sync(){
    if(state.busy||state.blocked||!state.engine||!navigator.onLine)return;
    if(!workspace.ready()){status(errorText(Error('READY')));return;}
    const generation=state.generation;state.busy=true;controls();status('正在同步…');
    try{
      const result=await state.engine.cycle();if(generation!==state.generation)return;
      if(result.conflicts)status('有 '+result.conflicts+' 个模块冲突，请在 AI 设置 → 云端同步中处理；本机修改已保留。');
      else if(result.pending)status(workspace.pendingMedication?.()?'首页服药选择尚未保存，请保存或放弃选择后继续同步。':'有待同步更新；请保存并离开正在编辑的输入框，应用会自动重试。');
      else if(workspace.pendingMedication?.())status('已保存数据已同步；首页服药选择尚未保存，尚未扣减库存。');
      else status('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour12:false}));
    }catch(error){if(generation===state.generation){if(['WRITE','REMOTE','META','LOCAL'].includes(error.message))state.blocked=true;status(errorText(error)+(state.blocked?' 已暂停自动同步，请排查后重新登录。':''));}}
    finally{if(generation===state.generation){state.busy=false;controls();conflicts();}}
  }
  function attach(user){
    if(!user||typeof user.id!=='string'||!user.id||user.is_anonymous)throw Error('AUTH');
    const engine=new window.QijianSyncCore.SyncEngine({owner:user.id,specs:workspace.specs,repo,remote:{read:key=>request('GET',key),write:(key,value,version)=>request(version===null?'POST':'PATCH',key,version,value)},canApply:workspace.canApply,onApply:workspace.applied});
    state.user=user;state.engine=engine;state.blocked=false;
  }
  async function restore(){
    if(state.busy||state.user||state.restoring||!state.config?.enabled||!navigator.onLine)return;
    state.restoring=true;state.busy=true;controls();
    const generation=state.generation;
    try{
      if(!workspace.ready())throw Error('READY');
      state.auth=state.auth||newAuth(state.config.key);
      const result=await state.auth.getUser();if(generation!==state.generation)return;if(result?.error)throw Error('AUTH');
      attach(result?.data?.user);
    }catch(error){if(generation===state.generation)status(errorText(error));}
    finally{if(generation===state.generation){state.restoring=false;state.busy=false;controls();}}
    if(generation===state.generation)await sync();
  }
  $('login').onsubmit=async event=>{
    event.preventDefault();if(state.busy)return;
    const key=$('key').value.replace(/\s+/g,''),username=$('username').value.trim(),password=$('password').value;
    if(!key||!username||!password||!$('consent').checked)return;
    if(!workspace.ready()){status(errorText(Error('READY')));return;}
    const generation=++state.generation;state.busy=true;controls();status('正在登录…');
    try{
      state.auth=newAuth(key);
      const signed=await state.auth.signInWithPassword({username,password});if(generation!==state.generation)return;if(signed?.error)throw Error('AUTH');
      const verified=await state.auth.getUser();if(generation!==state.generation)return;if(verified?.error)throw Error('AUTH');
      if(signed?.data?.user?.id&&signed.data.user.id!==verified?.data?.user?.id)throw Error('AUTH');
      attach(verified?.data?.user);
      state.config={key,username,enabled:true};storage.setItem(CONFIG,JSON.stringify(state.config));
    }catch(error){if(generation===state.generation){state.engine?.stop();state.engine=null;state.user=null;status(errorText(error));}}
    finally{if(generation===state.generation){$('password').value='';state.busy=false;controls();}}
    if(generation===state.generation)await sync();
  };
  $('now').onclick=()=>sync();
  $('logout').onclick=async()=>{
    const auth=state.auth;++state.generation;state.engine?.stop();for(const controller of state.requests)controller.abort();state.requests.clear();
    state.engine=null;state.user=null;state.auth=null;state.blocked=false;state.busy=true;state.restoring=false;
    state.config={...(state.config||{}),enabled:false};storage.setItem(CONFIG,JSON.stringify(state.config));controls();conflicts();status('已停止同步，正在退出账号…');
    try{const result=await auth?.signOut();if(result?.error)throw Error();status('已退出；本机数据保留，不再自动同步。');}
    catch{status('已停止同步；服务端退出未确认，必要时在控制台撤销设备会话。');}
    finally{state.busy=false;controls();}
  };
  $('panel').classList.remove('hidden');
  try{state.config=readConfig();if(state.config){$('key').value=state.config.key||'';$('username').value=state.config.username||'';}controls();}
  catch{status('本机同步配置读取失败，请保留数据库后排查。');return;}
  function tick(){if(document.hidden)return;if(!navigator.onLine){status('离线 · 记录保存在本机，联网后自动同步。');return;}if(state.user)sync();else restore();}
  window.addEventListener('online',tick);window.addEventListener('offline',()=>status('离线 · 记录保存在本机，联网后自动同步。'));
  window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
  setInterval(tick,15000);setTimeout(tick,1200);
})();
