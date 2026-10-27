"""Exercise the unchanged browser path and the desktop storage adapter with a mock bridge."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        for desktop in [False, True]:
            page = browser.new_page()
            page.route('https://**/*', lambda route: route.abort())
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if desktop:
                page.add_init_script('''
                  const data = new Map();
                  window.qijianDesktop = {storage: {
                    getItem: key => data.get(key) ?? null,
                    setItem: (key,value) => data.set(key,String(value)),
                    removeItem: key => data.delete(key)
                  }};
                ''')
            page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
            page.wait_for_function('notesReady || notesFailed')
            assert page.evaluate('notesReady'), errors
            assert not errors, errors
            page.evaluate('''async () => {
              const data={notes:[],folders:[{id:'desktop-test', name:'桌面存储测试'}]};
              await writeDatabase(data);
              if((await readDatabase()).folders[0].name!=='桌面存储测试') throw Error('笔记未保存');
              if(!persist(M,[])) throw Error('业务记录保存失败');
            }''')
            if desktop:
                assert page.evaluate('localStorage.getItem(M.key)') is None
                assert page.evaluate('workspaceStorage.getItem(M.key)') == '[]'
            page.close()
        browser.close()
    print('PASS: browser and mock desktop initialization; notebook and business storage; desktop avoids browser localStorage.')
finally:
    server.shutdown()
