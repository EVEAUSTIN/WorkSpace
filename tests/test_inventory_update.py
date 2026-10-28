"""Batch stock changes, manual alerts and homepage reminder order in a real browser."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
        page=browser.new_page();page.route('https://**/*',lambda route:route.abort())
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady')
        assert page.evaluate("persist(L,{cabinets:[{id:'cab-test',name:'测试柜',location:'书房',slots:3}],items:[],logs:[]})")
        page.locator('[data-page=lockers]').click();page.locator('#new-slot-items').click()
        page.locator('[data-batch-name]').fill('纸巾');page.locator('[data-batch-quantity]').fill('2')
        page.locator('#batch-add').click();page.locator('[data-batch-name]').nth(1).fill('剪刀');page.locator('[data-batch-quantity]').nth(1).fill('1');page.locator('[data-batch-never]').nth(1).check()
        page.locator('#slot-items-form button.primary').click();assert page.evaluate('L.value.items.length')==2
        assert page.evaluate('shoppingItems().length')==0
        page.locator('[data-item-alert]').click();assert page.evaluate('shoppingItems()[0].name')=='剪刀'
        assert page.locator('[data-item-alert]').inner_text()=='取消告急'
        page.locator('[data-item-alert]').click();assert page.evaluate('shoppingItems().length')==0
        page.locator('#new-slot-items').click();page.locator('#batch-mode').select_option('restock');page.locator('#batch-load').click()
        page.locator('[data-batch-quantity]').first.fill('3');page.locator('#slot-items-form button.primary').click()
        assert page.evaluate('L.value.items.find(i=>i.name==="纸巾").quantity')==5
        assert page.evaluate('L.value.items.find(i=>i.name==="剪刀").quantity')==1
        # A later invalid row must not partially commit earlier valid rows.
        page.locator('#new-slot-items').click();page.locator('[data-batch-quantity]').first.fill('9');page.locator('[data-batch-name]').nth(1).fill('纸巾')
        page.locator('#slot-items-form button.primary').click();assert page.locator('#batch-error').inner_text()
        assert page.evaluate('L.value.items.find(i=>i.name==="纸巾").quantity')==5
        page.locator('[data-close=slot-items-dialog]').click()
        page.evaluate("""()=>{
          const n=copy(L.value);n.items[0].quantity=1;persist(L,n);
          const t=new Date(Date.now()+3600000);const deadline=day(t)+'T'+String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
          persist(M,[{id:'due-test',title:'临期测试',deadline,priority:'normal',remind:60,done:false,notes:''}]);
          persist(R,{entries:[{id:'morning-test',date:day(new Date()),title:'晨起测试',time:'07:00',notes:'',tasks:[{id:'task-test',text:'出门',done:false}],things:[],updatedAt:Date.now()}],ackDates:[]});
        }""")
        assert page.evaluate('shoppingItems()[0].name')=='纸巾'
        page.locator('[data-page=home]').click();assert page.locator('#home-due-panel').is_visible()
        assert page.locator('#home-events').inner_text().find('临期测试')>=0
        assert page.evaluate("!!(document.querySelector('#home-morning').compareDocumentPosition(document.querySelector('#home-due-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)")
        assert page.evaluate("!!(document.querySelector('#home-due-panel').compareDocumentPosition(document.querySelector('#home-weather')) & Node.DOCUMENT_POSITION_FOLLOWING)")
        page.evaluate('persist(M,[])');assert page.locator('#home-due-panel').is_hidden()
        page.reload();page.wait_for_function('notesReady');assert page.evaluate('L.value.items.find(i=>i.name==="剪刀").neverUrgent')
        assert not errors,errors
        browser.close()
    print('PASS: batch count/restock, atomic invalid batch, durable manual stock alerts and morning/due/weather ordering.')
finally:server.shutdown()
