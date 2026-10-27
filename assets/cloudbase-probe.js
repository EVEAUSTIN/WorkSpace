/* CloudBase connection pilot. No workspace business stores are accessed here. */
(() => {
  'use strict';
  const ENV='emotional-newt-d5gg8duqi1ab13685';
  const ENDPOINT=`https://${ENV}.api.tcloudbasegateway.com/v1/rdb/rest/qijian_records`;
  const COLLECTION='__connection_test', RECORD='cross-device-probe';
  const CONFIG_KEY='qijian-cloudbase-probe-publishable-v1';
  const $=s=>document.querySelector(s);
  const state={app:null,auth:null,user:null,key:'',base:null,remote:null,readDone:false,dirty:false,busy:false,blocked:false,epoch:0,timer:null,requests:new Set()};
  const secrets=new Set();
  function status(message,kind=''){$('#cloud-status').textContent=message;$('#cloud-status').className='status '+kind;}
  function check(name,text,kind=''){const el=$('#check-'+name);el.textContent=text;el.className='check-result '+kind;}
  function safeMessage(error){
    let message=error?.safeMessage||'操作未完成。请检查网络、登录配置和数据库权限后重试。';
    for(const secret of secrets)if(secret)message=message.split(secret).join('[已隐藏]');
    return message;
  }
  function failure(message,code){const e=new Error(message);e.safeMessage=message;e.code=code;return e;}
  function renderControls(){
    const logged=!!state.user,ready=logged&&!state.busy&&!state.blocked;
    $('#cloud-login').disabled=state.busy||logged;
    for(const id of ['cloud-publishable','cloud-username','cloud-password'])$('#'+id).disabled=logged||state.busy;
    $('#cloud-session').classList.toggle('hidden',!logged);
    $('#cloud-message').disabled=!logged||state.blocked;$('#cloud-message').readOnly=state.busy;
    $('#cloud-save').disabled=!ready||!state.readDone;
    $('#cloud-read').disabled=!ready;
    $('#cloud-delete').disabled=!ready||!state.base||state.base.deleted;
    $('#cloud-anon').disabled=!ready||!state.remote||state.remote.deleted;
    $('#cloud-adopt').disabled=!ready;
    $('#cloud-adopt').classList.toggle('hidden',!logged||!state.dirty||!state.remote);
    $('#cloud-draft').textContent=!logged?'登录后可编辑。':state.dirty?'本设备有尚未保存的输入。':state.base?.deleted?'测试记录已清理；输入新内容可重新创建。':'当前输入与上次成功读取 / 保存的记录一致。';
  }
  function setBusy(value){state.busy=value;renderControls();}
  function displayRecord(row){
    $('#cloud-preview').textContent=row?(row.deleted?'测试记录已清理（保留删除标记用于同步）。':row.payload.message):'这个账号还没有测试记录。可在左侧保存第一条内容。';
    $('#cloud-record-meta').textContent=row?'记录版本 '+row.version+' · 服务器更新时间 '+new Date(row.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'本次读取未返回测试记录。';
  }
  function validateRow(row){
    if(!row||row.owner_id!==state.user?.id||row.collection!==COLLECTION||row.record_id!==RECORD){
      state.blocked=true;renderControls();throw failure('响应记录的归属与当前账号不一致，已停止写入。请检查 RLS 配置。','ISOLATION');
    }
    const version=Number(row.version);
    if(!Number.isSafeInteger(version)||version<1||typeof row.deleted!=='boolean'||!row.payload||typeof row.payload!=='object'||(!row.deleted&&typeof row.payload.message!=='string')||!Number.isFinite(Date.parse(row.updated_at))){
      throw failure('测试记录格式或版本信息不符合预期，请检查表结构与触发器。','SCHEMA');
    }
    return {...row,version};
  }
  async function token(){
    const result=await state.auth.getAccessToken();
    if(!result?.accessToken||result.env!==ENV)throw failure('登录凭证不可用，请退出后重新登录。','AUTH');
    secrets.add(result.accessToken);return result.accessToken;
  }
  function query(extra={},withOwner=false){
    const params=new URLSearchParams({collection:'eq.'+COLLECTION,record_id:'eq.'+RECORD,...extra});
    if(withOwner)params.set('owner_id','eq.'+state.user.id);
    return params;
  }
  async function request(method,params,body,anonymous=false){
    const accessToken=anonymous?state.key:await token();
    const controller=new AbortController();state.requests.add(controller);const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(ENDPOINT+'?'+params.toString(),{method,headers:{Authorization:'Bearer '+accessToken,Accept:'application/json',...(body?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if(anonymous&&(response.status===401||response.status===403))return {denied:true};
      if(!response.ok){
        if(response.status===409)throw failure('测试记录已被其他设备创建或修改。请先读取云端，再决定采用哪份内容。','CONFLICT');
        if(response.status===401)throw failure('登录凭证未被接口接受（HTTP 401）。请重新登录，并确认环境及客户端密钥。','AUTH');
        if(response.status===403)throw failure('数据库拒绝访问（HTTP 403）。请核对 authenticated 角色的授权和 RLS 策略。','PERMISSION');
        if(response.status===404)throw failure('未找到数据表或接口（HTTP 404）。请确认 qijian_records 位于 public schema。','SCHEMA');
        throw failure('数据库请求失败（HTTP '+response.status+'），请稍后重试。','HTTP');
      }
      let data;try{data=await response.json();}catch{throw failure('接口没有返回 JSON 数据，请核对接口配置。','FORMAT');}
      if(!Array.isArray(data))throw failure('接口没有返回预期的记录数组。','FORMAT');return data;
    }catch(error){
      if(error.safeMessage)throw error;
      throw failure('网络连接或请求超时。请检查 HTTPS 访问、CloudBase 安全域名配置与网络连通性；云端是否已写入需重新读取确认。','NETWORK');
    }finally{clearTimeout(timer);state.requests.delete(controller);}
  }
  async function readRemote(silent=false){
    if(!state.user||state.busy||state.blocked)return;
    const epoch=state.epoch;setBusy(true);
    try{
      // No owner filter here: the server must enforce owner isolation through RLS.
      const rows=await request('GET',query({select:'owner_id,collection,record_id,payload,version,deleted,updated_at'}));
      if(epoch!==state.epoch)return;
      if(rows.length>1){state.blocked=true;throw failure('返回了多条固定测试记录，已停止写入。请检查记录归属与 RLS。','ISOLATION');}
      const row=rows.length?validateRow(rows[0]):null;state.remote=row;state.readDone=true;displayRecord(row);
      if(!state.dirty){state.base=row;$('#cloud-message').value=row&&!row.deleted?row.payload.message:'';}
      const changed=state.dirty&&(row?.version!==state.base?.version);
      check('read','读取成功','pass');
      if(changed)status('云端已有不同版本。你的未保存输入已保留；直接保存会校验旧版本，不会静默覆盖其他设备。可点击“用云端内容替换输入”。','warning');
      else if(!silent)status(row?'已读取云端测试记录。':'读取成功；这个账号尚无测试记录。现在可保存第一条测试内容。','success');
    }catch(error){if(epoch!==state.epoch)return;check('read','读取失败','fail');status(safeMessage(error)+(state.remote?' 下方仍为上次成功读取的结果。':''),'error');}
    finally{if(epoch===state.epoch)setBusy(false);}
  }
  async function writeRemote(remove=false){
    if(!state.user||state.busy||state.blocked||!state.readDone)return;
    const message=$('#cloud-message').value.trim();if(!remove&&!message){status('请先输入一条测试内容。','warning');return;}
    const epoch=state.epoch,base=state.base;setBusy(true);
    try{
      const payload={payload:remove?{}:{message},deleted:remove};
      const rows=base?await request('PATCH',query({version:'eq.'+base.version},true),payload):await request('POST',new URLSearchParams(),{owner_id:state.user.id,collection:COLLECTION,record_id:RECORD,...payload});
      if(epoch!==state.epoch)return;
      if(rows.length!==1)throw failure('写入没有返回一条记录：其他设备可能已更新，或当前写入被权限规则拦截。输入已保留，请读取云端后再处理。','CONFLICT');
      const row=validateRow(rows[0]),expected=base?base.version+1:1;
      if(row.version!==expected){state.blocked=true;throw failure('服务器版本号未按预期递增，已暂停写入。请检查 qijian_records_stamp 触发器。','SCHEMA');}
      state.base=row;state.remote=row;state.dirty=false;$('#cloud-message').value=row.deleted?'':row.payload.message;displayRecord(row);
      check('write',remove?'测试记录已清理':'写入成功','pass');status(remove?'测试记录已标记为删除，其他设备读取后会看到清理结果。':'测试内容已保存到云端。请在第二台设备用同一账号打开本页验证。','success');
    }catch(error){if(epoch!==state.epoch)return;check('write','未确认写入','fail');status(safeMessage(error),'error');}
    finally{if(epoch===state.epoch)setBusy(false);}
  }
  function resetLocal(){
    state.epoch++;clearInterval(state.timer);state.timer=null;for(const c of state.requests)c.abort();state.requests.clear();
    state.user=null;state.base=null;state.remote=null;state.readDone=false;state.dirty=false;state.blocked=false;state.busy=false;state.auth=null;state.app=null;state.key='';
    secrets.clear();$('#cloud-password').value='';$('#cloud-message').value='';$('#cloud-user').textContent='';$('#cloud-preview').textContent='已退出本页登录。';$('#cloud-record-meta').textContent='';
    for(const name of ['login','read','write','anon'])check(name,'尚未验证');renderControls();
  }
  async function logout(clearConfig=false){
    const auth=state.auth;resetLocal();setBusy(true);
    if(clearConfig){try{sessionStorage.removeItem(CONFIG_KEY);}catch{}$('#cloud-publishable').value='';}
    try{
      if(auth){const r=await auth.signOut();if(r?.error)throw r.error;}
      status(clearConfig?'已退出，并清除了本页的客户端密钥配置。':'已退出本页登录。');
    }catch{status('本页已停止同步，但服务端注销未确认。请关闭此标签页；必要时在 CloudBase 撤销该设备会话。','warning');}
    finally{setBusy(false);}
  }
  $('#cloud-login-form').onsubmit=async event=>{
    event.preventDefault();if(state.busy||state.user)return;
    if(!window.QijianCloudbase){status('官方 SDK 未加载。部署时请一并上传 assets 目录，检查文件请求是否成功。','error');return;}
    const key=$('#cloud-publishable').value.replace(/\s+/g,''),username=$('#cloud-username').value.trim(),password=$('#cloud-password').value;
    if(!key||!username||!password)return;
    const epoch=++state.epoch;secrets.add(key);secrets.add(password);setBusy(true);status('正在使用你的应用账号登录…');
    try{
      state.key=key;state.app=window.QijianCloudbase.init({env:ENV,region:'ap-shanghai',accessKey:key,persistence:'session',endPointMode:'GATEWAY'});
      state.auth=state.app.auth({persistence:'session'});
      const result=await state.auth.signInWithPassword({username,password});if(result?.error)throw result.error;
      const verified=await state.auth.getUser();if(verified?.error)throw verified.error;
      const user=verified?.data?.user;
      if(!user||typeof user.id!=='string'||!user.id||user.is_anonymous)throw failure('没有获取到有效的个人账号身份，请核对登录方式。','IDENTITY');
      if(result?.data?.user?.id&&result.data.user.id!==user.id)throw failure('登录后的用户身份不一致，请退出后重试。','IDENTITY');
      if(epoch!==state.epoch)return;state.user=user;
      try{sessionStorage.setItem(CONFIG_KEY,key);}catch{}
      $('#cloud-user').textContent='已登录：'+(user.user_metadata?.username||username)+' · 用户标识：'+user.id;
      $('#cloud-password').value='';check('login','登录成功','pass');status('登录成功，正在检查测试记录读取…','success');
    }catch(error){
      if(epoch!==state.epoch)return;check('login','登录未成功','fail');status(error.safeMessage?safeMessage(error):'登录未成功。请核对应用用户名、密码和客户端 Publishable Key；确认用户名密码登录已启用，并按 CloudBase 要求配置当前网站的安全域名。如提示人机验证，请按官方验证流程完成。','error');state.user=null;
    }finally{if(epoch===state.epoch){$('#cloud-password').value='';secrets.delete(password);setBusy(false);}}
    if(state.user&&epoch===state.epoch){await readRemote();if(epoch!==state.epoch)return;state.timer=setInterval(()=>{if($('#cloud-auto').checked&&!document.hidden)readRemote(true);},10000);}
  };
  $('#cloud-message').oninput=()=>{const base=state.base&&!state.base.deleted?state.base.payload.message:'';state.dirty=$('#cloud-message').value!==base;renderControls();};
  $('#cloud-save').onclick=()=>writeRemote(false);$('#cloud-read').onclick=()=>readRemote();$('#cloud-delete').onclick=()=>writeRemote(true);
  $('#cloud-adopt').onclick=()=>{if(!state.remote||state.busy)return;state.base=state.remote;state.dirty=false;$('#cloud-message').value=state.remote.deleted?'':state.remote.payload.message;renderControls();status('已采用当前显示的云端版本。','success');};
  $('#cloud-logout').onclick=()=>logout(false);$('#cloud-clear-config').onclick=()=>logout(true);
  $('#cloud-anon').onclick=async()=>{
    if(!state.user||state.busy||!state.remote||state.remote.deleted)return;const epoch=state.epoch;setBusy(true);
    try{const result=await request('GET',query({select:'record_id'}),undefined,true);if(epoch!==state.epoch)return;if(result.denied){check('anon','请求被拒绝','pass');status('未登录请求被接口拒绝。此结果不替代两个不同账号间的 RLS 隔离测试。','success');}else if(result.length===0){check('anon','未看到测试记录','pass');status('未登录请求未读到当前测试记录。完整隔离仍需另一个测试账号验证。','success');}else{state.blocked=true;check('anon','存在读取风险','fail');status('未登录请求读到了测试记录，已停止写入。请检查匿名权限和 RLS，暂不要迁移真实数据。','error');}}
    catch(error){if(epoch===state.epoch){check('anon','未完成检查','fail');status(safeMessage(error),'error');}}finally{if(epoch===state.epoch)setBusy(false);}
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.user&&$('#cloud-auto').checked)readRemote(true);});
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  $('#cloud-origin').textContent='当前网站来源：'+location.origin+'（如需配置安全域名，请使用控制台要求的格式）';
  if(location.protocol==='file:')$('#file-warning').classList.remove('hidden');
  try{$('#cloud-publishable').value=sessionStorage.getItem(CONFIG_KEY)||'';}catch{}
  check('sdk',window.QijianCloudbase?'已加载':'加载失败',window.QijianCloudbase?'pass':'fail');renderControls();
})();
