"""Multi-condition prescriptions, reminder grid, persisted draft and inventory accounting in browser."""
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
        page=browser.new_page(viewport={'width':1440,'height':1100});page.route('https://**/*',lambda route:route.abort())
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.on('dialog',lambda dialog:dialog.accept())
        origin=f'http://127.0.0.1:{server.server_port}'
        page.goto(origin+'/index.html');page.wait_for_function('notesReady')
        assert page.evaluate("persist(MED,{items:[{id:'medicine-test',name:'测试药品',quantity:20,unit:'片',expiry:'2099-10',dosage:'医嘱',purpose:''}],logs:[],illness:{active:true,name:'旧状态',plan:'原服药文字保留'}})")
        page.locator('[data-page=medicine]').click();assert '原服药文字保留' in page.locator('#illness-list').inner_text()
        for name,dose,frequency in [('状态甲','2','2'),('状态乙','0.5','3')]:
            page.locator('#add-illness').click();page.locator('#illness-name').fill(name)
            page.locator('#add-regimen').click();page.locator('[data-regimen-medicine]').select_option('medicine-test')
            page.locator('[data-regimen-dose]').fill(dose);page.locator('[data-regimen-frequency]').select_option(frequency)
            page.locator('#illness-form button.primary').click();assert page.locator('#illness-dialog').is_hidden()
        assert page.evaluate('MED.value.care.conditions.length')==3
        page.locator('[data-page=home]').click();assert page.locator('#home-medication').is_visible()
        checks=page.locator('[data-medication-check]');assert checks.count()==5
        assert page.locator('#medication-reminders').inner_text().count('早晨')==2
        a=page.locator('#home-weather').bounding_box();b=page.locator('#home-medication').bounding_box();assert abs(a['y']-b['y'])<3 and b['x']>a['x']
        for i in range(5):checks.nth(i).check()
        assert page.evaluate('MED.value.items[0].quantity')==20
        page.locator('#save-medication').click();assert page.evaluate('MED.value.items[0].quantity')==14.5
        assert page.evaluate('MED.value.care.intakes.length')==5
        page.locator('#save-medication').click();assert page.evaluate('MED.value.items[0].quantity')==14.5
        checks.first.uncheck();page.locator('#save-medication').click();assert page.evaluate('MED.value.items[0].quantity')==16.5
        checks.first.check();page.locator('#save-medication').click();assert page.evaluate('MED.value.items[0].quantity')==14.5
        # Manual consumption remains an independent supported operation.
        page.locator('[data-page=medicine]').click();page.locator('[data-med-consume]').click()
        page.locator('#med-stock-amount').fill('1');page.locator('#med-stock-form button.primary').click()
        assert page.evaluate('MED.value.items[0].quantity')==13.5
        page.locator('[data-page=home]').click();checks.first.uncheck();assert page.evaluate('medicationDraftDirty()')
        page.reload();page.wait_for_function('notesReady');assert not page.locator('[data-medication-check]').first.is_checked()
        assert page.evaluate('MED.value.items[0].quantity')==13.5
        page.locator('#save-medication').click();assert page.evaluate('MED.value.items[0].quantity')==15.5
        # Changing a saved prescription never rewrites its taken-dose snapshots.
        page.locator('[data-page=medicine]').click();page.locator('[data-illness-edit]').nth(1).click()
        page.locator('[data-regimen-dose]').fill('1');page.locator('#illness-form button.primary').click()
        page.locator('[data-page=home]').click()
        assert '原安排' in page.locator('#medication-reminders').inner_text()
        assert page.evaluate('MED.value.care.intakes.some(i=>i.amount===2)')
        page.set_viewport_size({'width':390,'height':844})
        a=page.locator('#home-weather').bounding_box();b=page.locator('#home-medication').bounding_box();assert b['y']>=a['y']+a['height']
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        assert not errors,errors
        browser.close()
    print('PASS: legacy text, multiple prescriptions, 2/3-per-day UI, weather-side reminder, idempotent inventory/undo, manual consumption, draft reload, changed-dose history and mobile stacking.')
finally:server.shutdown()
