'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const lit=require('../assets/literature-core.js');
const {fetchJournalMetric,SOURCES}=require('../desktop/literature-metrics.cjs');
const metric=(value,issn='0169-2046')=>({issn,value,year:2024,source:'https://publisher.example/metrics',quote:'Synthetic year-tagged publisher evidence only',method:'user',checkedAt:1,partition:''});
test('Boolean direction plans preserve AND, OR and nested meanings; reject malformed/excessive expressions',()=>{
  const heat={op:'ANY',terms:['heat','热岛']},green={op:'ANY',terms:['green','绿地']};
  assert.ok(lit.matches({op:'AND',children:[heat,green]},'Urban heat and green space'));
  assert.equal(lit.matches({op:'AND',children:[heat,green]},'Urban heat exposure'),false);
  assert.ok(lit.matches({op:'OR',children:[heat,green]},'城市绿地'));
  assert.equal(lit.matches(heat,'theatre ecology'),false);
  assert.ok(lit.matches({op:'OR',children:[{op:'AND',children:[heat,green]},{op:'ANY',terms:['flood']}]},'flood mitigation'));
  assert.equal(lit.validExpr({op:'EVAL',terms:['code']}),false);
});
test('journal admission is strictly greater than four with year and source; partition is no substitute',()=>{
  assert.equal(lit.eligible(metric(4)),false);assert.equal(lit.eligible(metric(3.9)),false);assert.equal(lit.eligible(metric(4.01)),true);
  assert.equal(lit.eligible({...metric(null),partition:'中科院二区'}),false);
  assert.equal(lit.eligible({...metric(8),source:'javascript:alert(1)'}),false);
  assert.equal(lit.eligible({...metric(8),method:'ai-guess'}),false);
});
test('extract source impact factor only with explicit year, never substitute CiteScore or five-year IF',()=>{
  assert.equal(lit.extractMetric('<p>Journal Impact Factor (2024): 8.5</p>').value,8.5);
  assert.equal(lit.extractMetric('2024 Impact Factor 5.2').year,2024);
  assert.equal(lit.extractMetric('Impact Factor 9.3 (2024)').value,9.3);
  assert.equal(lit.extractMetric('CiteScore 2024: 9.3'),null);
  assert.equal(lit.extractMetric('Impact Factor 9.3'),null);
  assert.equal(lit.extractMetric('5-year Journal Impact Factor (2024): 9.3'),null);
  assert.equal(lit.extractMetric('Journal Impact Factor (2024): 9.3. Journal Impact Factor (2024): 8.2'),null);
});
test('history retains latest fifty unique DOI records with metric snapshots and safe source links',()=>{
  let rows=[];
  for(let i=0;i<55;i++)rows=lit.history(rows,{doi:'10.1234/test-'+i,title:'Title '+i,journal:'Journal',issn:'0169-2046',date:{label:'2026-10-28'}},metric(8),i);
  assert.equal(rows.length,50);assert.equal(rows[0].doi,'10.1234/test-54');
  rows=lit.history(rows,{doi:'10.1234/test-20',title:'Read again',journal:'Journal',issn:'0169-2046',date:{label:'2026-10-28'}},metric(8),100);
  assert.equal(rows.length,50);assert.equal(rows[0].title,'Read again');assert.ok(lit.validHistory({entries:rows}));
});
test('date, relevance and influence sorting differ; impact factor remains dominant over AI preference',()=>{
  const papers=[{doi:'a',issn:'0169-2046',title:'urban green heat',abstract:'',date:{min:'2026-10-20'}},{doi:'b',issn:'2210-6707',title:'urban water',abstract:'',date:{min:'2026-10-28'}}];
  const context={plan:{expression:{op:'ANY',terms:['heat','green']}},metrics:[metric(5),metric(20,'2210-6707')],assessments:{'0169-2046':{score:100},'2210-6707':{score:0}}};
  assert.equal(lit.sort(papers,'relevance',context)[0].doi,'a');assert.equal(lit.sort(papers,'date',context)[0].doi,'b');assert.equal(lit.sort(papers,'impact',context)[0].doi,'b');
});
test('publisher proxy uses fixed allowlist, bounded response and attributable evidence',async()=>{
  let calls=0;
  const found=await fetchJournalMetric('0169-2046',async(url,options)=>{calls++;assert.equal(url,SOURCES['0169-2046']);assert.equal(options.redirect,'error');return new Response('Journal Impact Factor (2024): 8.5');});
  assert.equal(found.method,'publisher');assert.equal(found.value,8.5);assert.equal(found.source,SOURCES['0169-2046']);
  await assert.rejects(fetchJournalMetric('http://127.0.0.1',async()=>{calls++;}));assert.equal(calls,1);
  await assert.rejects(fetchJournalMetric('0169-2046',async()=>new Response('CiteScore 20, unknown impact factor')));
});
