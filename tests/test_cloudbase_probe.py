"""Standalone mocked CloudBase pilot integration check. Run: python tests/test_cloudbase_probe.py.
Requires Playwright and a Chromium browser. It does not log in to a real cloud environment.
"""
from playwright.sync_api import sync_playwright
import json,datetime,urllib.parse,copy
if __name__ == '__main__':
 from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
 from functools import partial
 from pathlib import Path
 from threading import Thread
 import shutil, tempfile
 ROOT=Path(__file__).resolve().parents[1]
 class QuietHandler(SimpleHTTPRequestHandler):
  def log_message(self, *args):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
 thread=Thread(target=server.serve_forever,daemon=True);thread.start()
 BASE='http://127.0.0.1:'+str(server.server_port)
 ENV='emotional-newt-d5gg8duqi1ab13685'
 API='https://'+ENV+'.api.tcloudbasegateway.com/v1/rdb/rest/qijian_records'
 rows={};requests=[];bad_anon=False;foreign=False;pending=[];hold=False
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),args=['--no-sandbox']);errors=[]
  def endpoint(route):
   global bad_anon,foreign,hold
   req=route.request;headers=req.headers;auth=headers.get('authorization','');params=urllib.parse.parse_qs(urllib.parse.urlsplit(req.url).query);method=req.method
   if method=='OPTIONS':route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,prefer','access-control-allow-methods':'GET,POST,PATCH'});return
   requests.append({'method':method,'params':params,'body':req.post_data_json if method in ['POST','PATCH'] else None})
   common={'access-control-allow-origin':'*','content-type':'application/json'}
   if auth=='Bearer test-public-key':
    if bad_anon:route.fulfill(json=[{'record_id':'cross-device-probe'}],headers=common)
    else:route.fulfill(status=403,json={'message':'hidden test-password test-token'},headers=common)
    return
   owner=auth.removeprefix('Bearer token-')
   assert owner in ['user-a','user-b']
   if method=='GET':
    assert params.get('collection')==['eq.__connection_test'] and params.get('record_id')==['eq.cross-device-probe']
    if hold:pending.append(route);return
    data=[copy.deepcopy(rows[owner])] if owner in rows else []
    if foreign and data:data[0]['owner_id']='another-user';data[0]['payload']={'message':'private-other-user-content'}
    route.fulfill(json=data,headers=common);return
   body=req.post_data_json
   if method=='POST':
    assert body['owner_id']==owner and body['collection']=='__connection_test' and body['record_id']=='cross-device-probe'
    if owner in rows:route.fulfill(status=409,json={},headers=common);return
    row={**body,'version':1,'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};rows[owner]=row;route.fulfill(status=201,json=[row],headers=common);return
   assert method=='PATCH' and params.get('owner_id')==['eq.'+owner] and set(body)=={'payload','deleted'}
   old=rows.get(owner)
   if not old or params.get('version')!=['eq.'+str(old['version'])]:route.fulfill(json=[],headers=common);return
   row={**old,**body,'version':old['version']+1,'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};rows[owner]=row;route.fulfill(json=[row],headers=common)
  def newpage(user='user-a'):
   ctx=b.new_context();page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route(API+'**',endpoint);page.goto(BASE+'/cloudbase-test.html')
   assert page.locator('#check-sdk').inner_text()=='已加载'
   # Use the real vendored SDK for load/shape checks, then replace only its init boundary for mocked auth.
   page.evaluate('''user=>{window.__sdkConfigs=[];QijianCloudbase.init=(config)=>{__sdkConfigs.push(config);return {auth:()=>({signInWithPassword:async ({username,password})=>({data:{user:{id:user}},error:null}),getUser:async()=>({data:{user:{id:user,is_anonymous:false,user_metadata:{username:'tester'}}},error:null}),getAccessToken:async()=>({accessToken:'token-'+user,env:'emotional-newt-d5gg8duqi1ab13685'}),signOut:async()=>({error:null})})}}}''',user)
   page.locator('#cloud-auto').uncheck();page.locator('#cloud-publishable').fill('test-public-key');page.locator('#cloud-username').fill('tester');page.locator('#cloud-password').fill('test-password');page.locator('#cloud-login').click();page.wait_for_function("document.querySelector('#check-read').textContent==='读取成功'")
   assert page.locator('#cloud-password').input_value()==''
   assert page.evaluate('__sdkConfigs[0].endPointMode')=='GATEWAY'
   return page
  a=newpage();assert '尚无测试记录' in a.locator('#cloud-status').inner_text()
  a.locator('#cloud-message').fill('设备 A 的测试内容');a.locator('#cloud-save').click();a.wait_for_function("document.querySelector('#check-write').textContent==='写入成功'");assert rows['user-a']['version']==1
  a.locator('#cloud-anon').click();a.wait_for_function("document.querySelector('#check-anon').textContent==='请求被拒绝'");assert 'test-password' not in a.locator('#cloud-status').inner_text() and 'token-user-a' not in a.locator('#cloud-status').inner_text()
  second=newpage();assert second.locator('#cloud-message').input_value()=='设备 A 的测试内容'
  a.locator('#cloud-message').fill('A 未保存的草稿');second.locator('#cloud-message').fill('B 修改后的内容');second.locator('#cloud-save').click();second.wait_for_function("document.querySelector('#cloud-record-meta').textContent.includes('版本 2')")
  a.locator('#cloud-read').click();a.wait_for_function("document.querySelector('#cloud-preview').textContent==='B 修改后的内容'");assert a.locator('#cloud-message').input_value()=='A 未保存的草稿'
  before=len(requests);a.locator('#cloud-save').click();a.wait_for_function("document.querySelector('#check-write').textContent==='未确认写入'");assert rows['user-a']['payload']['message']=='B 修改后的内容';assert all(r['method']=='PATCH' for r in requests[before:])
  a.locator('#cloud-adopt').click();assert a.locator('#cloud-message').input_value()=='B 修改后的内容'
  a.locator('#cloud-message').fill('A 已处理冲突');a.locator('#cloud-save').click();a.wait_for_function("document.querySelector('#cloud-record-meta').textContent.includes('版本 3')")
  # Different account sees no other-user test content in the mocked RLS backend.
  other=newpage('user-b');assert '还没有测试记录' in other.locator('#cloud-preview').inner_text()
  assert 'A 已处理冲突' not in other.locator('#cloud-preview').inner_text()
  a.locator('#cloud-delete').click();a.wait_for_function("document.querySelector('#check-write').textContent==='测试记录已清理'");assert rows['user-a']['deleted'] and rows['user-a']['version']==4
  second.locator('#cloud-read').click();second.wait_for_function("document.querySelector('#cloud-preview').textContent.includes('保留删除标记')");assert second.locator('#cloud-message').input_value()==''
  # Tombstone reuse updates the existing version rather than inserting a duplicate.
  second.locator('#cloud-message').fill('清理后再建');second.locator('#cloud-save').click();second.wait_for_function("document.querySelector('#cloud-record-meta').textContent.includes('版本 5')");assert rows['user-a']['deleted'] is False
  # The UI also independently rejects a wrong owner even if the backend is misconfigured.
  other.locator('#cloud-message').fill('另一个账号的测试');other.locator('#cloud-save').click();other.wait_for_function("document.querySelector('#check-write').textContent==='写入成功'")
  foreign=True;other.locator('#cloud-read').click();other.wait_for_function("document.querySelector('#cloud-status').textContent.includes('归属')");assert other.locator('#cloud-save').is_disabled();assert 'private-other-user-content' not in other.locator('#cloud-preview').inner_text()
  foreign=False
  # Deliberately bad anonymous permissions suspend writes.
  bad_anon=True;second.locator('#cloud-anon').click();second.wait_for_function("document.querySelector('#check-anon').textContent==='存在读取风险'");assert second.locator('#cloud-save').is_disabled();bad_anon=False
  second.locator('#cloud-logout').click();second.wait_for_function("!document.querySelector('#cloud-login').disabled");assert second.locator('#cloud-session').is_hidden()
  a.set_viewport_size({'width':390,'height':844});assert a.evaluate('document.documentElement.scrollWidth<=innerWidth');a.screenshot(path=str(Path(tempfile.gettempdir())/'qijian-cloudbase-pilot-mobile.png'),full_page=True)
  assert not errors,errors
  print('PASS: actual vendored SDK loads; mocked password login and token API; two-device read/write; CAS conflict protection and draft preservation; soft delete/tombstone recreation; anonymous-access warning; no credential display; mobile layout. Mock backend enforces account isolation; real CloudBase auth/RLS still requires user-run testing.')
  b.close()
 server.shutdown();server.server_close();thread.join(timeout=2)
