(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QijianSearch=factory();})(globalThis,()=>{
  'use strict';
  function official(base){try{const u=new URL(base);return u.protocol==='https:'&&u.hostname==='api.deepseek.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/','/v1','/v1/'].includes(u.pathname);}catch{return false;}}
  function publicURL(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(u.hostname)||/[\[\]:]/.test(u.hostname)||/\.(local|localhost|internal|test)$/i.test(u.hostname))return null;return u.href;}catch{return null;}}
  const clip=(value,max)=>Array.from(String(value??'')).slice(0,max).join('');
  async function gather({base,request,query,question,alive=()=>true}){
    if(!official(base))throw Error('联网搜索需要 DeepSeek 官方接口 https://api.deepseek.com（也支持 /v1），不会把密钥发送到其他搜索服务。');
    const response=await request('/v1/tools/search',{query:clip(query.trim(),128),ori_question:clip(question.trim(),128)||undefined,count:6,need_content:true});
    if(!alive())return null;
    if(!Array.isArray(response?.results))throw Error('搜索接口未返回有效的 results 数组。');
    const sources=[],seen=new Set();let remaining=24000,fetches=0;
    for(const result of response.results.slice(0,6)){
      const url=publicURL(result.url);if(!url||seen.has(url))continue;seen.add(url);
      let content=clip(result.content||'',6000),fetched=false;
      if(!content&&fetches<2){fetches++;try{const page=await request('/v1/tools/fetch',{url});if(!alive())return null;if(typeof page?.content==='string'&&page.content.trim()){content=clip(page.content,6000);fetched=true;}}catch{/* Search summaries are retained and labelled; do not pretend Fetch succeeded. */}}
      const summary=clip(result.summary||result.snippet||'',2000);content=clip(content,Math.max(0,remaining));remaining-=content.length;
      sources.push({id:sources.length+1,title:clip(result.title||url,300),url,published:clip(result.date||'发布时间未知',100),summary,content,coverage:content?(fetched?'已抓取正文':'搜索接口返回正文'):'仅搜索摘要，未取得正文'});
    }
    return {query:clip(query,128),searchedAt:new Date().toISOString(),sources};
  }
  function appendix(evidence){return '\n\n---\n实际检索来源（'+new Date(evidence.searchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'，北京时间）\n'+evidence.sources.map(s=>'\n'+s.id+'. ['+s.title.replace(/[\\\[\]*_`<>]/g,' ') +'](<'+s.url.replace(/[<>\s]/g,c=>encodeURIComponent(c))+'>) · '+s.coverage+' · '+s.published).join('');}
  return {official,publicURL,gather,appendix};
});
