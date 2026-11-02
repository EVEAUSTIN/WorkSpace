from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page();page.route('https://**/*',lambda r:r.abort())
  page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady');page.locator('[data-page=notes]').click();page.locator('#new-note-top').click();page.locator('#editor').fill('公式 ')
  page.locator('#tab-insert').click();page.on('dialog',lambda d:d.accept(r'\frac{a}{b}'));page.locator('#insert-formula').click();assert page.locator('#editor .katex').count()==1
  page.evaluate('persistNotes()');assert 'data-latex' in page.evaluate('activeNote().html');page.reload();page.wait_for_function('notesReady');page.locator('[data-page=notes]').click();assert page.locator('#editor .katex').count()==1
  assert page.evaluate("sanitizeHTML('<sup>2</sup><sub>n</sub>')")== '<sup>2</sup><sub>n</sub>'
  browser.close()
 print('PASS: LaTeX insertion renders and persists across reload; superscript/subscript survive sanitizer.')
finally:server.shutdown()
