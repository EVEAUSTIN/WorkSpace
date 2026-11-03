from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p, TemporaryDirectory() as tmp:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(accept_downloads=True);page.route('https://**/*',lambda r:r.abort())
  page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady');page.locator('[data-page=notes]').click();page.locator('#new-note-top').click();page.locator('#note-title').fill('测试文档')
  page.evaluate("""()=>{editor.innerHTML='<p>正文</p><ul><li>条目</li></ul><table><tr><th>项目</th><th>数值</th></tr><tr><td>甲</td><td>2</td></tr></table><p><span data-latex="x^2" data-display="inline">x^2</span></p><img alt="照片" src="data:image/png;base64,AA==">';captureEditor()}""")
  with page.expect_download() as info:page.locator('#export-note').click()
  result=info.value;assert result.suggested_filename=='测试文档.md';path=Path(tmp)/'result.md';result.save_as(path);text=path.read_text(encoding='utf-8');assert all(x in text for x in ['# 测试文档','正文','- 条目','| 项目 | 数值 |','$x^2$','附件：照片']);assert 'base64' not in text
  browser.close()
 print('PASS: exported UTF-8 Markdown contains title, text, lists, tables, formula and attachment notice.')
finally:server.shutdown()
