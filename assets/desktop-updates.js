(()=>{
  'use strict';
  const api=window.qijianDesktop;
  if(!api?.update)return;
  const panel=document.getElementById('desktop-update-panel'),status=document.getElementById('desktop-update-status'),check=document.getElementById('desktop-update-check'),install=document.getElementById('desktop-update-install');
  let state=null,busy=false;
  function render(next){
    state=next;
    const messages={development:'当前为源码启动版。请先从安装包下载页安装正式 Windows 版，之后可在应用内更新。',idle:'可检查新版本。',checking:'正在检查更新…',latest:'已是最新发布版本。',available:'发现新版本 '+next.version+'，可下载安装并重启。',downloading:'正在下载更新 '+Math.round(next.percent||0)+'%…',downloaded:'更新已下载，安装前会再次检查未保存内容。',restarting:'正在安装更新并重启…',error:'更新未完成，请检查网络后重试；本机数据保留。'};
    status.textContent='当前版本 '+next.current+' · '+(messages[next.phase]||'');
    const running=busy||['checking','downloading','restarting'].includes(next.phase);
    check.disabled=running;
    install.disabled=running||next.phase==='development'||(!next.available&&!next.downloaded);
    install.textContent=next.downloaded?'安装并重启':'下载安装并重启';
  }
  async function prepare(){
    if(!window.qijianSyncWorkspace?.prepareUpdate)throw Error('应用尚未准备完成，请稍后重试。');
    await window.qijianSyncWorkspace.prepareUpdate();
  }
  check.onclick=async()=>{
    if(busy)return;busy=true;if(state)render(state);
    try{state=await api.update('check');}catch{if(state)state={...state,phase:'error'};}
    finally{busy=false;if(state)render(state);}
  };
  install.onclick=async()=>{
    if(busy)return;
    try{await prepare();}catch(error){status.textContent=error.message;return;}
    busy=true;if(state)render(state);
    try{
      if(!state.downloaded)state=await api.update('download');
      if(state.downloaded){await prepare();state=await api.update('install');}
    }catch(error){status.textContent=error?.message||'更新未完成，请重试。';busy=false;if(state){check.disabled=false;install.disabled=!state.downloaded&&!state.available;}return;}
    busy=false;if(state)render(state);
  };
  panel.classList.remove('hidden');api.onUpdate(render);
  api.update('state').then(render).catch(()=>{status.textContent='无法读取应用版本，请重新打开应用。';});
})();
