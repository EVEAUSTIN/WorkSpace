"""Application update UI preflight: no restart over unsaved daily edits; notes flush before install."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
        page=browser.new_page();page.route('https://**/*',lambda route:route.abort())
        page.add_init_script('''
          const data=new Map();window.updateActions=[];let callback=()=>{};
          let state={current:'0.3.0',phase:'idle',available:false,downloaded:false};
          window.qijianDesktop={storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},commit:()=>{},
            onUpdate:fn=>{callback=fn;},update:async action=>{
              updateActions.push(action);
              if(action==='check')state={...state,phase:'available',available:true,version:'0.4.0'};
              if(action==='download')state={...state,phase:'downloaded',downloaded:true};
              if(action==='install'){
                if(!data.has('desktop:notebook'))throw Error('notes not flushed');
                state={...state,phase:'restarting'};
              }
              callback(state);return state;
            }};
        ''')
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady')
        page.locator('[data-page=settings]').click();page.locator('#desktop-update-check').click()
        page.evaluate('dailyDirty=true');page.locator('#desktop-update-install').click()
        assert '保存' in page.locator('#desktop-update-status').inner_text()
        assert page.evaluate("!updateActions.includes('download')&&!updateActions.includes('install')")
        page.evaluate("dailyDirty=false;addNote('更新前保存','<p>未保存正文</p>')")
        page.locator('#desktop-update-install').click()
        page.wait_for_function("updateActions.includes('install')")
        assert page.evaluate("JSON.parse(workspaceStorage.getItem('desktop:notebook')).notes[0].title")=='更新前保存'
        assert '正在安装' in page.locator('#desktop-update-status').inner_text()
        browser.close()
    print('PASS: updater UI blocks unsaved daily data, persists notes, then requests download/install in order.')
finally:server.shutdown()
