"""Real vendored SDK + desktop UI, synthetic HTTP and persisted mock IPC storage only."""
import base64
import json
import shutil
import time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

def jwt(payload):
    def part(value): return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return part({'alg':'RS256','typ':'JWT'})+'.'+part(payload)+'.synthetic-signature-only'

root=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
rows={}
user_token=jwt({'sub':'synthetic-sync-user','uid':'synthetic-sync-user','exp':int(time.time())+3600,'iat':int(time.time()),'scope':'user'})
public_key='synthetic-publishable-not-a-real-key'
bridge='''
  const prefix='test-sqlite:';
  const storage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,String(value)),removeItem:key=>localStorage.removeItem(prefix+key)};
  window.qijianDesktop={storage,commit:(writes,archives=[])=>{for(const item of writes)storage.setItem(item.key,item.value);const history=JSON.parse(storage.getItem('desktop:test-history')||'[]');history.push(...archives);storage.setItem('desktop:test-history',JSON.stringify(history));}};
'''

def route_request(route):
    request=route.request
    parsed=urlparse(request.url)
    if not parsed.hostname.endswith('.api.tcloudbasegateway.com'):
        route.abort();return
    headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
    if request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
    if parsed.path.endswith('/signin'):
        assert request.post_data_json['password']=='synthetic-password'
        route.fulfill(headers=headers,json={'access_token':user_token,'refresh_token':'synthetic-refresh','token_type':'Bearer','expires_in':3600,'scope':'user'});return
    if parsed.path.endswith('/revoke'):
        route.fulfill(headers=headers,json={});return
    if parsed.path.endswith('/user/me'):
        route.fulfill(headers=headers,json={'sub':'synthetic-sync-user','uid':'synthetic-sync-user','username':'synthetic','groups':[],'providers':[]});return
    if parsed.path!='/v1/rdb/rest/qijian_records':raise AssertionError('Unexpected endpoint '+parsed.path)
    assert request.headers['authorization']=='Bearer '+user_token
    query=parse_qs(parsed.query)
    if request.method=='GET':
        key=query['record_id'][0][3:]
        assert query['collection']==['eq.workspace_v1']
        route.fulfill(headers=headers,json=[rows[key]] if key in rows else []);return
    body=request.post_data_json
    assert body['payload']['format']==1
    assert 'synthetic-password' not in json.dumps(body)
    if request.method=='POST':
        key=body['record_id'];assert body['owner_id']=='synthetic-sync-user'
        assert key not in rows
        rows[key]={**body,'version':1,'updated_at':'2026-10-27T12:00:00Z'}
    else:
        key=query['record_id'][0][3:]
        if key not in rows or query['version']!=['eq.'+str(rows[key]['version'])]:
            route.fulfill(headers=headers,json=[]);return
        rows[key]={**rows[key],**body,'version':rows[key]['version']+1}
    assert key not in ['qijian-ai-v1','desktop:sync-config','desktop:sync-meta']
    route.fulfill(headers=headers,json=[rows[key]])

def login(page):
    page.locator('[data-page=settings]').click()
    page.locator('#workspace-sync-key').fill(public_key)
    page.locator('#workspace-sync-username').fill('synthetic')
    page.locator('#workspace-sync-password').fill('synthetic-password')
    page.locator('#workspace-sync-consent').check()
    page.locator('#workspace-sync-login-button').click()
    page.wait_for_function("document.querySelector('#workspace-sync-status').textContent.startsWith('已同步')")
    assert page.locator('#workspace-sync-password').input_value()==''

def sync(page):
    page.locator('[data-page=settings]').click()
    page.locator('#workspace-sync-now').click()
    page.wait_for_function("!document.querySelector('#workspace-sync-now').disabled")
    return page.locator('#workspace-sync-status').inner_text()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
        pages=[]
        errors=[]
        for _ in range(2):
            context=browser.new_context();context.add_init_script(bridge);context.route('https://**/*',route_request)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(origin+'/index.html');page.wait_for_function('notesReady');pages.append(page)
        a,b=pages
        a.evaluate("persist(M,[{id:'test-memo',text:'',title:'双设备测试',deadline:'2027-10-27T12:00',priority:'normal',remind:15,done:false,notes:''}])")
        login(a);login(b)
        assert b.evaluate('M.value[0].title')=='双设备测试'
        b.evaluate("(()=>{const next=copy(M.value);next[0].title='B已修改';persist(M,next);})()")
        assert sync(b).startswith('已同步');assert sync(a).startswith('已同步')
        assert a.evaluate('M.value[0].title')=='B已修改'
        a.evaluate("(()=>{const next=copy(M.value);next[0].title='A冲突';persist(M,next);})()")
        b.evaluate("(()=>{const next=copy(M.value);next[0].title='B冲突';persist(M,next);})()")
        sync(a);assert '冲突' in sync(b)
        assert b.evaluate('M.value[0].title')=='B冲突'
        b.on('dialog',lambda dialog:dialog.accept())
        b.get_by_role('button',name='采用云端模块',exact=True).click()
        b.wait_for_function("document.querySelector('#workspace-sync-status').textContent.startsWith('已同步')")
        assert b.evaluate('M.value[0].title')=='A冲突'
        a.evaluate("(()=>{addNote('同步笔记','<p>笔记正文</p>');return persistNotes();})()")
        sync(a);sync(b);assert b.evaluate('notesState.notes[0].title')=='同步笔记'
        b.reload();b.wait_for_function("document.querySelector('#workspace-sync-status').textContent.startsWith('已同步')",timeout=15000)
        assert b.evaluate('notesState.notes[0].title')=='同步笔记'
        a.evaluate('persist(M,[])');sync(a);sync(b);assert b.evaluate('M.value.length')==0
        # Medication ledger and inventory move together as one versioned module.
        a.evaluate("""()=>{
          persist(MED,{items:[{id:'sync-med',name:'同步药品',quantity:10,unit:'片',expiry:'2099-10',dosage:'',purpose:''}],logs:[],illness:{active:true,name:'同步状态',plan:''},care:{version:1,conditions:[{id:'sync-condition',name:'同步状态',active:true,notes:'',regimens:[{id:'sync-regimen',medicineId:'sync-med',dose:2,frequency:1}]}],intakes:[]}});
        }""")
        sync(a);sync(b)
        b.locator('[data-page=home]').click();b.locator('[data-medication-check]').check();b.locator('#save-medication').click()
        sync(b);sync(a)
        assert a.evaluate('MED.value.items[0].quantity')==8
        assert a.evaluate('MED.value.care.intakes.length')==1
        a.locator('[data-page=home]').click();assert a.locator('[data-medication-check]').is_checked()
        a.locator('#save-medication').click();assert a.evaluate('MED.value.items[0].quantity')==8
        sync(a);assert rows['qijian-medicine-v1']['version']==2
        a.evaluate("""()=>{
          const prefs=copy(LIT_PREF.value);prefs.direction='同步的城市环境方向';persist(LIT_PREF,prefs);
          persist(LIT_HISTORY,{entries:[{doi:'10.1234/synced-reading',title:'Synced urban paper',zhTitle:'同步的文献标题',journal:'Synthetic Journal',issn:'0169-2046',published:'2026-10-28',readAt:1,metric:null}]});
        }""")
        sync(a);sync(b)
        assert b.evaluate('LIT_PREF.value.direction')=='同步的城市环境方向'
        assert b.evaluate('LIT_HISTORY.value.entries[0].zhTitle')=='同步的文献标题'
        b.locator('#workspace-sync-logout').click();b.wait_for_function("document.querySelector('#workspace-sync-status').textContent.includes('已退出')")
        b.reload();b.wait_for_function('notesReady');assert b.locator('#workspace-sync-now').is_disabled()
        assert not errors,errors
        browser.close()
    print('PASS: real SDK synthetic login, two-device business/notes sync, conflict UI, deletion, medication ledger/stock, literature preferences/history, persistent session restore and logout; secrets excluded.')
finally:
    server.shutdown()
