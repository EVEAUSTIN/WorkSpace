"""Paragraph formatting, Enter inheritance, durable HTML and reversible layout toggles."""
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
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
        browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1000})
        page.route('https://**/*',lambda route:route.abort());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady')
        page.locator('[data-page=notes]').click();page.locator('#new-note-top').click()
        page.locator('#editor').fill('第一段内容')
        page.locator('#editor').press('End');page.locator('#note-first-indent').focus();page.locator('#note-first-indent').select_option('2em');page.locator('#note-line-spacing').focus();page.locator('#note-line-spacing').select_option('1.5')
        page.locator('#editor').press('End');page.locator('#editor').press('Enter');page.keyboard.insert_text('第二段内容')
        assert page.locator('#editor').evaluate("e=>[...e.children].slice(0,2).every(p=>p.style.textIndent==='2em'&&p.style.lineHeight==='1.5')")
        # Shift+Enter is a line break, not another paragraph with a new first-line indent.
        count=page.locator('#editor').evaluate('e=>e.children.length');page.locator('#editor').press('Shift+Enter');page.keyboard.insert_text('段内换行')
        assert page.locator('#editor').evaluate('e=>e.children.length')==count
        page.locator('#editor').press('Control+a');page.locator('#note-line-spacing').focus();page.locator('#note-line-spacing').select_option('2');page.locator('#note-first-indent').focus();page.locator('#note-first-indent').select_option('0')
        assert page.locator('#editor').evaluate("e=>[...e.children].every(p=>p.style.lineHeight==='2'&&parseFloat(p.style.textIndent)===0)")
        page.locator('#note-first-indent').focus();page.locator('#note-first-indent').select_option('2em');page.evaluate('persistNotes()')
        assert 'text-indent: 2em' in page.evaluate('activeNote().html')
        width=page.locator('.document-workspace').bounding_box()['width'];page.locator('#toggle-note-navigation').click();assert page.locator('.document-list').is_hidden();assert page.locator('.folders').is_hidden()
        assert page.locator('.document-workspace').bounding_box()['width']>width
        page.locator('#toggle-note-toolbar').click();assert page.locator('#toolbar').is_hidden();assert page.locator('#toggle-note-toolbar').is_visible()
        page.reload();page.wait_for_function('notesReady');page.locator('[data-page=notes]').click();assert page.locator('#toolbar').is_hidden();assert page.locator('.document-list').is_hidden()
        assert page.locator('#editor').evaluate("e=>[...e.children].every(p=>p.style.lineHeight==='2'&&p.style.textIndent==='2em')")
        page.locator('#toggle-note-navigation').click();page.locator('#toggle-note-toolbar').click();assert page.locator('.document-list').is_visible();assert page.locator('#toolbar').is_visible()
        assert not errors,errors;browser.close()
    print('PASS: indent/line spacing, native Enter inheritance, Shift+Enter, multiselection, durable sanitized HTML, expandable writing area and persistent reversible toggles.')
finally:server.shutdown()
