'use strict';
function createUpdater({app,autoUpdater,onState=()=>{},schedule=callback=>setTimeout(callback,500)}) {
  let busy=false;
  let state={current:app.getVersion(),phase:app.isPackaged?'idle':'development',available:false,downloaded:false,version:'',percent:0};
  const publish=patch=>{state={...state,...patch};onState({...state});return {...state};};
  const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value)?value:'';
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.allowPrerelease=false;
  autoUpdater.setFeedURL({provider:'github',owner:'EVEAUSTIN',repo:'WorkSpace',private:false});
  autoUpdater.on('checking-for-update',()=>publish({phase:'checking'}));
  autoUpdater.on('update-available',info=>{const next=version(info.version);publish({phase:'available',available:!!next,downloaded:!!next&&state.downloaded&&state.version===next,version:next,percent:0});});
  autoUpdater.on('update-not-available',()=>publish({phase:'latest',available:false,downloaded:false,version:''}));
  autoUpdater.on('download-progress',info=>publish({phase:'downloading',percent:Math.max(0,Math.min(100,Number(info.percent)||0))}));
  autoUpdater.on('update-downloaded',info=>publish({phase:'downloaded',available:true,downloaded:true,version:version(info.version),percent:100}));
  autoUpdater.on('error',()=>publish({phase:'error'}));
  return {
    getState:()=>({...state}),
    async run(action){
      if(!['state','check','download','install'].includes(action))throw Error('Invalid updater action');
      if(action==='state')return {...state};
      if(!app.isPackaged)return publish({phase:'development'});
      if(busy)return {...state};
      if(action==='install'){
        if(!state.downloaded)return {...state};
        busy=true;publish({phase:'restarting'});schedule(()=>autoUpdater.quitAndInstall(false,true));return {...state};
      }
      busy=true;
      try {
        if(action==='check')await autoUpdater.checkForUpdates();
        else if(state.available&&!state.downloaded){publish({phase:'downloading',percent:0});await autoUpdater.downloadUpdate();}
      }catch{publish({phase:'error'});}
      finally{busy=false;}
      return {...state};
    }
  };
}
module.exports={createUpdater};
