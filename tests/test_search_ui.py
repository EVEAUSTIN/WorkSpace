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
        browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page();calls=[]
        def route(route):
            path=route.request.url;headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
            if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
            if path.startswith('https://api.deepseek.com/'):
                calls.append((path,route.request.post_data_json))
                if path.endswith('/tools/search'):data={'results':[{'url':'https://museum.example/event','title':'馆方活动','summary':'本期活动'}]}
                elif path.endswith('/tools/fetch'):data={'title':'馆方活动','content':'已获取的活动正文'}
                else:
                    assert '本次联网结果' in route.request.post_data_json['messages'][-1]['content']
                    data={'choices':[{'message':{'content':'**近期活动**，见来源[1]。'}}]}
                route.fulfill(headers=headers,json=data)
            else:route.abort()
        page.route('https://**/*',route);page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady')
        page.evaluate("aiConfig={enabled:true,base:'https://api.deepseek.com/v1',key:'synthetic-only',model:'synthetic'}")
        page.locator('[data-page=travel]').click();page.locator('#travel-query').fill('本周北京展览');page.locator('#travel-ai-form button.primary').click()
        page.wait_for_function("document.querySelector('#travel-answer').textContent.includes('实际检索来源')")
        assert [url for url,_ in calls]==['https://api.deepseek.com/v1/tools/search','https://api.deepseek.com/v1/tools/fetch','https://api.deepseek.com/v1/chat/completions']
        assert page.locator('#travel-answer strong').inner_text()=='近期活动'
        assert page.locator('#travel-answer a[href="https://museum.example/event"]').count()==1
        assert '已打卡' not in str(calls[0][1])
        browser.close()
    print('PASS: travel Search→Fetch→chat, /v1 path, grounded context, Markdown and actual source links; search excludes private visit history.')
finally:server.shutdown()
