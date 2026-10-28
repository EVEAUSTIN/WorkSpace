'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createUpdater}=require('../desktop/updater.cjs');
function fixture(packaged=true){
  const provider=new EventEmitter(),calls=[];
  provider.setFeedURL=feed=>calls.push(['feed',feed]);
  provider.checkForUpdates=async()=>{calls.push(['check']);provider.emit('update-available',{version:'0.4.0'});};
  provider.downloadUpdate=async()=>{calls.push(['download']);provider.emit('download-progress',{percent:65});provider.emit('update-downloaded',{version:'0.4.0'});};
  provider.quitAndInstall=(...args)=>calls.push(['install',...args]);
  const updates=createUpdater({app:{isPackaged:packaged,getVersion:()=> '0.3.0'},autoUpdater:provider,schedule:fn=>fn()});
  return {updates,provider,calls};
}
test('installed app checks, downloads, then explicitly installs and restarts',async()=>{
  const {updates,provider,calls}=fixture();
  assert.equal(provider.autoDownload,false);assert.equal(provider.autoInstallOnAppQuit,false);
  assert.equal((await updates.run('check')).available,true);
  assert.equal((await updates.run('download')).downloaded,true);
  await updates.run('install');assert.deepEqual(calls.at(-1),['install',false,true]);
});
test('source development runs never download or install; unsupported actions rejected',async()=>{
  const {updates,calls}=fixture(false);
  for(const action of ['check','download','install'])assert.equal((await updates.run(action)).phase,'development');
  assert.equal(calls.length,1);await assert.rejects(updates.run('arbitrary-command'));
});
test('network errors preserve retry and do not silently install',async()=>{
  const {updates,provider,calls}=fixture();await updates.run('check');
  provider.downloadUpdate=async()=>{throw Error('synthetic secret detail');};
  const state=await updates.run('download');assert.equal(state.phase,'error');assert.equal(state.downloaded,false);assert.ok(!JSON.stringify(state).includes('secret'));
  await updates.run('install');assert.ok(!calls.some(c=>c[0]==='install'));
});
test('a newer release invalidates previously downloaded installer state',async()=>{
  const {updates,provider,calls}=fixture();await updates.run('check');await updates.run('download');
  provider.emit('update-available',{version:'0.5.0'});
  assert.equal(updates.getState().downloaded,false);
  await updates.run('install');assert.ok(!calls.some(c=>c[0]==='install'));
});
