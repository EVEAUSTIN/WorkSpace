/* Source-backed journal admission, bounded Boolean plans and persistent reading history. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QijianLiterature=factory();})(globalThis,()=>{
  'use strict';
  const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
  const doi=value=>typeof value==='string'&&/^10\.\d{4,9}\/\S{1,500}$/i.test(value);
  const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min;
  function validExpr(node,depth=0){
    if(depth>4||!node||typeof node!=='object')return false;
    if(node.op==='ANY')return Array.isArray(node.terms)&&node.terms.length>0&&node.terms.length<=10&&node.terms.every(t=>text(t,80,1));
    return ['AND','OR'].includes(node.op)&&Array.isArray(node.children)&&node.children.length>0&&node.children.length<=8&&node.children.every(c=>validExpr(c,depth+1));
  }
  function validPlan(plan){return !!plan&&text(plan.query,300,1)&&text(plan.summary,1000,1)&&validExpr(plan.expression)&&JSON.stringify(plan).length<=12000&&terms(plan.expression).length<=80;}
  const norm=value=>String(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
  function contains(haystack,term){
    const needle=norm(term);if(/[\u3400-\u9fff]/.test(needle))return haystack.includes(needle);
    const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(?:^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','i').test(haystack);
  }
  function matches(expression,value){
    const haystack=norm(value);
    if(expression.op==='ANY')return expression.terms.some(term=>contains(haystack,term));
    if(expression.op==='AND')return expression.children.every(child=>matches(child,haystack));
    return expression.children.some(child=>matches(child,haystack));
  }
  function terms(expression){return expression.op==='ANY'?expression.terms:expression.children.flatMap(terms);}
  function relevance(plan,paper){return [...new Set(terms(plan.expression))].reduce((score,t)=>score+(contains(norm(paper.title),t)?3:0)+(contains(norm(paper.abstract||''),t)?1:0),0);}
  function validMetric(m){return !!m&&/^\d{4}-\d{3}[\dX]$/.test(m.issn)&&((m.value===null&&text(m.partition,100,1))||(Number.isFinite(m.value)&&m.value>=0&&m.value<=500))&&Number.isInteger(m.year)&&m.year>=2000&&m.year<=new Date().getFullYear()&&https(m.source)&&text(m.quote,1000,1)&&['publisher','user'].includes(m.method)&&Number.isFinite(m.checkedAt)&&text(m.partition||'',100);}
  function eligible(metric){return validMetric(metric)&&typeof metric.value==='number'&&metric.value>4.0;}
  function extractMetric(html){
    const raw=String(html).slice(0,4000000),plain=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ');
    const candidates=[];
    const patterns=[/(?:Journal\s+)?Impact\s+Factor\s*[:=]?\s*\(?\s*(20\d{2})\s*\)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi,/(20\d{2})\s*(?:Journal\s+)?Impact\s+Factor\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi,/(?:Journal\s+)?Impact\s+Factor\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*\(?\s*(20\d{2})\s*\)?/gi];
    for(let i=0;i<patterns.length;i++)for(const match of plain.matchAll(patterns[i])){
      if(/[\d,]/.test(plain.charAt(match.index+match[0].length)))continue;
      const context=plain.slice(Math.max(0,match.index-40),match.index+match[0].length+40);
      if(/(?:5|five)[ -]?year[^.]{0,35}$/i.test(plain.slice(Math.max(0,match.index-45),match.index)))continue;
      const year=Number(match[i===2?2:1]),value=Number(match[i===2?1:2]);
      if(year>=2000&&year<=new Date().getFullYear()&&value>=0&&value<=500)candidates.push({year,value,quote:context.trim()});
    }
    const sorted=candidates.sort((a,b)=>b.year-a.year);if(!sorted.length)return null;
    const latest=sorted.filter(c=>c.year===sorted[0].year);if(new Set(latest.map(c=>c.value)).size!==1)return null;
    return latest[0];
  }
  function history(entries,paper,metric,now=Date.now()){
    if(!doi(paper.doi))throw Error('Invalid DOI');
    const row={doi:paper.doi.toLowerCase(),title:paper.title,zhTitle:paper.zhTitle||'',journal:paper.journal,issn:paper.issn,published:paper.date.label,readAt:now,metric:metric?{...metric}:null};
    return [row,...entries.filter(p=>p.doi.toLowerCase()!==row.doi)].sort((a,b)=>b.readAt-a.readAt).slice(0,50);
  }
  function validHistory(state){return !!state&&Array.isArray(state.entries)&&state.entries.length<=50&&new Set(state.entries.map(e=>e.doi)).size===state.entries.length&&state.entries.every(e=>e&&doi(e.doi)&&text(e.title,1000,1)&&text(e.zhTitle,1000)&&text(e.journal,300,1)&&text(e.issn,20,1)&&text(e.published,100)&&Number.isFinite(e.readAt)&&(e.metric===null||validMetric(e.metric)));}
  function sort(papers,mode,{plan,metrics,assessments={}}){
    const metric=p=>metrics.find(m=>m.issn===p.issn),max=Math.max(1,...papers.map(p=>Math.log1p(metric(p)?.value||0)));
    const impact=p=>.85*Math.log1p(metric(p)?.value||0)/max+.15*((assessments[p.issn]?.score||0)/100);
    const rel=p=>Number.isFinite(p.aiRelevance)?p.aiRelevance:relevance(plan,p);
    return [...papers].sort((a,b)=>mode==='impact'?impact(b)-impact(a)||b.date.min.localeCompare(a.date.min):mode==='relevance'?rel(b)-rel(a)||b.date.min.localeCompare(a.date.min):b.date.min.localeCompare(a.date.min)||a.doi.localeCompare(b.doi));
  }
  return {https,doi,validExpr,validPlan,matches,relevance,validMetric,eligible,extractMetric,history,validHistory,sort};
});
