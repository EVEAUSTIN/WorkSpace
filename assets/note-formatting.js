/* Paragraph-only formatting; native Enter/selection/IME behavior remains intact. */
(()=>{
  'use strict';
  const area=document.getElementById('editor'),indent=document.getElementById('note-first-indent'),spacing=document.getElementById('note-line-spacing');
  const blocks='p,div,h1,h2,h3,h4,h5,h6,li,blockquote';
  let pending=null;
  function rememberSelection(){const s=getSelection();if(s?.rangeCount&&area.contains(s.anchorNode)&&area.contains(s.focusNode))savedRange=s.getRangeAt(0).cloneRange();}
  for(const control of [indent,spacing]){control.addEventListener('pointerdown',rememberSelection);control.addEventListener('focus',rememberSelection);}

  function blockAt(node){const el=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;const block=el?.closest(blocks);return block&&block!==area&&area.contains(block)?block:null;}
  function selectedBlocks(create=true){
    const selection=getSelection();if(!selection?.rangeCount||!area.contains(selection.anchorNode)||!area.contains(selection.focusNode))return [];
    const range=selection.getRangeAt(0);
    if(range.collapsed){const current=blockAt(selection.anchorNode);if(current)return [current];if(!create)return [];document.execCommand('formatBlock',false,'p');return [blockAt(getSelection()?.anchorNode)].filter(Boolean);}
    return [...area.querySelectorAll(blocks)].filter(block=>!block.querySelector(blocks)&&range.intersectsNode(block)&&!(range.endOffset===0&&(range.endContainer===block||block.contains(range.endContainer))));
  }
  function current(){return blockAt(getSelection()?.anchorNode);}
  function syncControls(){
    if(document.activeElement===indent||document.activeElement===spacing)return;
    const selected=selectedBlocks(false),block=current();
    const targets=selected.length?selected:block?[block]:[];
    const indents=new Set(targets.map(b=>!b.style.textIndent||parseFloat(b.style.textIndent)===0?'0':b.style.textIndent));
    const lines=new Set(targets.map(b=>b.style.lineHeight||''));
    const first=indents.size===1?[...indents][0]:indents.size?'':'0';
    indent.value=[...indent.options].some(o=>o.value===first)?first:'';
    const line=lines.size===1?[...lines][0]:lines.size?'mixed':'';
    spacing.value=[...spacing.options].some(o=>o.value===line)?line:'mixed';
  }
  function apply(property,value){
    if(!activeNote())return;restoreSelection();
    for(const block of selectedBlocks())block.style[property]=value;
    captureEditor();syncControls();
  }
  indent.onchange=()=>{if(['0','1em','2em','4em'].includes(indent.value))apply('textIndent',indent.value);};
  spacing.onchange=()=>{if(['','1','1.15','1.5','1.75','2','2.5','3'].includes(spacing.value))apply('lineHeight',spacing.value);};
  area.addEventListener('beforeinput',event=>{
    pending=null;
    if(event.inputType!=='insertParagraph'||event.isComposing)return;
    const block=current();if(!block||block.closest('pre,table,[contenteditable="false"]'))return;
    pending={textIndent:block.style.textIndent,lineHeight:block.style.lineHeight};
  });
  area.addEventListener('input',event=>{
    if(event.inputType==='insertParagraph'&&pending){const next=current();if(next){next.style.textIndent=pending.textIndent;next.style.lineHeight=pending.lineHeight;captureEditor();}}
    pending=null;syncControls();
  });
  document.addEventListener('selectionchange',syncControls);
  document.addEventListener('qijian:note-open',syncControls);
  const layout=document.querySelector('#page-notes .notes-layout'),nav=document.getElementById('toggle-note-navigation'),tools=document.getElementById('toggle-note-toolbar');
  let prefs={navHidden:false,toolbarHidden:false};
  try{const saved=JSON.parse(workspaceStorage.getItem('desktop:notes-view')||'null');if(saved&&typeof saved.navHidden==='boolean'&&typeof saved.toolbarHidden==='boolean')prefs=saved;}catch{}
  function render(){
    layout.classList.toggle('notes-nav-hidden',prefs.navHidden);layout.classList.toggle('notes-toolbar-hidden',prefs.toolbarHidden);
    nav.textContent=prefs.navHidden?'显示文档栏':'隐藏文档栏';tools.textContent=prefs.toolbarHidden?'显示功能栏':'隐藏功能栏';
    nav.setAttribute('aria-expanded',String(!prefs.navHidden));tools.setAttribute('aria-expanded',String(!prefs.toolbarHidden));
  }
  function save(){render();try{workspaceStorage.setItem('desktop:notes-view',JSON.stringify(prefs));}catch{toast('界面布局已切换，但未能保存下次打开时的状态。');}}
  nav.onclick=()=>{prefs.navHidden=!prefs.navHidden;save();};tools.onclick=()=>{prefs.toolbarHidden=!prefs.toolbarHidden;save();};render();
})();
