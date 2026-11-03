/* Export note contents as portable UTF-8 Markdown for reading by GPT. */
(()=>{
  'use strict';
  function markdown(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    function walk(node,depth=0){
      if(node.nodeType===Node.TEXT_NODE)return node.nodeValue.replace(/\u00a0/g,' ');
      if(node.nodeType!==Node.ELEMENT_NODE)return '';
      const tag=node.tagName.toLowerCase();
      if(node.hasAttribute('data-latex')){const src=node.getAttribute('data-latex')||'';return node.getAttribute('data-display')==='block'?'\n\n$$\n'+src+'\n$$\n\n':' $'+src+'$ ';}
      if(node.matches('.graph-output,.diagram-tools'))return '';
      if(['img','audio','video'].includes(tag))return '[附件：'+(node.getAttribute('alt')||({'img':'图片','audio':'音频','video':'视频'}[tag]))+'；内容未包含在文本导出中]';
      if(tag==='figure'&&node.getAttribute('data-block')==='mermaid')return '\n\n```mermaid\n'+(node.querySelector('pre.diagram-source')?.textContent||'')+'\n```\n\n';
      if(tag==='pre')return '\n\n```\n'+node.textContent.replace(/\n?$/,'\n')+'```\n\n';
      if(tag==='table'){
        const rows=[...node.querySelectorAll('tr')].map(tr=>[...tr.children].filter(c=>['TD','TH'].includes(c.tagName)).map(c=>[...c.childNodes].map(n=>walk(n,depth)).join('').replace(/\s*\n\s*/g,' ').replace(/\|/g,'\\|').trim()));
        if(!rows.length)return '';const width=Math.max(...rows.map(r=>r.length));const line=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
        return '\n\n'+line(rows[0])+'\n'+line(Array(width).fill('---'))+'\n'+rows.slice(1).map(line).join('\n')+'\n\n';
      }
      const content=[...node.childNodes].map(n=>walk(n,depth+(tag==='ul'||tag==='ol'?1:0))).join('');
      if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+content.trim()+'\n\n';
      if(tag==='li'){const parent=node.parentElement;const index=parent?.tagName==='OL'?[...parent.children].filter(n=>n.tagName==='LI').indexOf(node)+1:null;return '  '.repeat(Math.max(0,depth-1))+(index?index+'. ':'- ')+content.trim()+'\n';}
      if(tag==='ul'||tag==='ol')return '\n'+content+'\n';
      if(tag==='br')return '\n';
      if(tag==='a'){const href=node.getAttribute('href');return href&&/^https?:\/\//i.test(href)?'['+content+']('+href.replace(/\)/g,'%29')+')':content;}
      if(tag==='sup')return '^('+content+')';if(tag==='sub')return '_('+content+')';
      if(tag==='strong'||tag==='b')return '**'+content+'**';if(tag==='em'||tag==='i')return '*'+content+'*';
      if(tag==='p'||tag==='div'||tag==='blockquote')return '\n\n'+content.trim()+'\n\n';
      if(tag==='hr')return '\n\n---\n\n';return content;
    }
    return [...doc.body.childNodes].map(n=>walk(n)).join('').replace(/\n{3,}/g,'\n\n').trim();
  }
  document.getElementById('export-note').onclick=()=>{
    const note=activeNote();if(!note){toast('请先打开一篇笔记。');return;}
    const title=document.getElementById('note-title').value.trim()||'未命名笔记';
    const filename=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'未命名笔记';
    const text='# '+title.replace(/[\r\n]+/g,' ')+'\n\n'+markdown(serializeEditor())+'\n';
    download(text,'text/markdown;charset=utf-8',filename+'.md');
  };
})();
