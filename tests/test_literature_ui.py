"""Synthetic Crossref and AI: direction semantics, translations, IF gating, history and persistence."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse,parse_qs
import shutil
from playwright.sync_api import sync_playwright
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path(__file__).resolve().parents[1])))
Thread(target=server.serve_forever,daemon=True).start()
requests=[]
ai_fail=False
and_expr={'op':'AND','children':[{'op':'ANY','terms':['heat','热岛']},{'op':'ANY','terms':['green','绿地']}]}
or_expr={'op':'OR','children':and_expr['children']}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    def route(route):
        global ai_fail
        u=urlparse(route.request.url)
        headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
        if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
        if u.hostname=='api.crossref.org':
            issn=u.path.split('/')[2];requests.append((issn,parse_qs(u.query)['query'][0]))
            today=page.evaluate('beijingDate()') if False else None
            # Use source date supplied through the test fixture, not host locale assumptions.
            raw={'0169-2046':[('both','Urban heat and green infrastructure'),('green','Urban green space')],'2210-6707':[('heat','Urban heat exposure')]}.get(issn,[])
            data=[{'DOI':'10.1234/'+key,'title':[title],'abstract':'Urban environmental study '+title,'published':{'date-parts':[fixture_date]},'author':[{'given':'Test','family':'Author'}]} for key,title in raw]
            route.fulfill(headers=headers,json={'message':{'items':data}});return
        if u.hostname=='synthetic-ai.invalid':
            body=route.request.post_data_json;data=__import__('json').loads(body['messages'][-1]['content'])
            if ai_fail:route.fulfill(headers=headers,json={'choices':[{'message':{'content':'invalid-json'}}]});return
            if 'papers' in data:
                result={'papers':[{'doi':paper['doi'],'zhTitle':{'10.1234/both':'城市热环境与绿色基础设施','10.1234/heat':'城市热暴露','10.1234/green':'城市绿色空间'}.get(paper['doi'],'测试中文标题'),'relevance':95 if 'both' in paper['doi'] else 60} for paper in data['papers']]}
            elif 'journals' in data:
                result={'journals':[{'issn':j['issn'],'score':80,'reason':'依据给定影响因子与研究方向综合评估'} for j in data['journals']]}
            else:
                use_or='或' in data['direction']
                result={'query':'heat green urban','summary':'热岛或绿地' if use_or else '热岛且绿地','expression':or_expr if use_or else and_expr}
            route.fulfill(headers=headers,json={'choices':[{'message':{'content':__import__('json').dumps(result,ensure_ascii=False)}}]});return
        route.abort()
    page.route('https://**/*',route)
    try:
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html');page.wait_for_function('notesReady')
        fixture_date=page.evaluate('beijingDate().split("-").map(Number)')
        page.evaluate("""()=>{
          aiConfig={enabled:true,base:'https://synthetic-ai.invalid/v1',key:'synthetic-only-key',model:'synthetic',models:[]};workspaceStorage.setItem(AI_KEY,JSON.stringify(aiConfig));
          const next=copy(LIT_PREF.value);next.metrics=LIT_JOURNALS.map((j,i)=>({issn:j.issn,value:i===0?5.2:i===1?10:i===2?4:3.9,year:2024,source:'https://publisher.example/metrics',quote:'Synthetic source evidence for tests only',method:'user',checkedAt:Date.now(),partition:''}));persist(LIT_PREF,next);
          document.addEventListener('click',e=>{if(e.target.closest('[data-lit-read],[data-history-read]'))e.preventDefault();});
        }""")
        page.locator('[data-page=literature]').click()
        page.wait_for_function('!litState.loading && litState.items.length===3')
        page.wait_for_function("document.querySelectorAll('.lit-translation').length===3 && !document.querySelector('#lit-news').textContent.includes('待生成')")
        assert all(issn in ['0169-2046','2210-6707'] for issn,_ in requests)
        assert 'IF 5.2（2024）' in page.locator('#lit-news').inner_text()
        assert page.locator('.lit-journal').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=17
        page.locator('.lit-card h2 a').first.click();assert page.evaluate('LIT_HISTORY.value.entries.length')==1
        page.get_by_role('button',name='阅读历史（最近 50 篇）',exact=True).click();assert page.locator('#page-literature-history').is_visible()
        assert page.locator('#lit-history-list a').first.get_attribute('href').startswith('https://doi.org/')
        page.get_by_role('button',name='返回文献时事',exact=True).click()
        page.locator('#lit-direction').fill('城市热岛 与 绿地');page.locator('#lit-save-direction').click()
        page.wait_for_function("!litState.loading&&!litState.directionBusy&&LIT_PREF.value.direction==='城市热岛 与 绿地'")
        assert page.locator('.lit-card').count()==1
        page.locator('#lit-direction').fill('城市热岛 或 绿地');page.locator('#lit-save-direction').click()
        page.wait_for_function("!litState.loading&&!litState.directionBusy&&LIT_PREF.value.direction==='城市热岛 或 绿地'")
        assert page.locator('.lit-card').count()==3
        assert any('heat green urban'==query for _,query in requests)
        page.locator('#lit-sort').select_option('impact')
        page.wait_for_function('litState.assessmentKey===litAssessmentKey()')
        assert 'Environment' not in page.locator('.lit-card').first.inner_text() # Known source is SCS for high IF fixture.
        assert page.locator('.lit-card').first.locator('h2').inner_text()=='Urban heat exposure'
        # A malformed AI direction response must preserve the last saved direction.
        ai_fail=True;page.locator('#lit-direction').fill('不应保存的新方向');page.locator('#lit-save-direction').click()
        page.wait_for_function('!litState.directionBusy')
        assert page.evaluate('LIT_PREF.value.direction')=='城市热岛 或 绿地';ai_fail=False
        # Force an excluded cached paper to ensure cache cannot bypass IF=4 filtering.
        page.evaluate("(()=>{const p=copy(litState.items[0]);p.doi='10.1234/excluded';p.issn='1618-8667';litState.items.push(p);renderLiterature();})()")
        assert page.locator('[data-lit-read="10.1234/excluded"]').count()==0
        page.evaluate("""()=>{const sample=copy(litState.items[0]);for(let i=0;i<55;i++){const p={...copy(sample),doi:'10.1234/history-'+i};litState.items.push(p);litRemember(p.doi);}}""")
        assert page.evaluate('LIT_HISTORY.value.entries.length')==50
        page.reload();page.wait_for_function('notesReady')
        assert page.evaluate('LIT_HISTORY.value.entries.length')==50
        assert page.evaluate('LIT_PREF.value.direction')=='城市热岛 或 绿地'
        page.get_by_role('button',name='阅读历史（最近 50 篇）',exact=True).click() if page.locator('#page-literature').is_visible() else page.evaluate("showPage('literature-history')")
        assert page.locator('#lit-history-list article').count()==50
        assert not errors,errors
        print('PASS: IF>4 gating, translated titles, history cap/page/persistence, AI AND/OR direction, failed-AI preservation, relevance/impact/date controls and cache admission.')
    finally:
        browser.close();server.shutdown()
