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
  function syncRibbon(){
    const selection=getSelection();if(!selection?.rangeCount||!area.contains(selection.anchorNode)||!area.contains(selection.focusNode))return;
    const el=selection.anchorNode.nodeType===1?selection.anchorNode:selection.anchorNode.parentElement;
    const block=blockAt(selection.anchorNode);
    const choose=(id,value)=>{const control=document.getElementById(id);if(document.activeElement===control)return;control.querySelector('[data-context-option]')?.remove();const text=String(value||'');let opt=[...control.options].find(o=>o.value.toLowerCase()===text.toLowerCase());if(!opt){opt=document.createElement('option');opt.value=text;opt.textContent=text?'当前：'+text:'混合 / 未知';opt.disabled=true;opt.dataset.contextOption='true';control.append(opt);}control.value=opt.value;};
    const font=(document.queryCommandValue('fontName')||getComputedStyle(el).fontFamily||'').replace(/["']/g,'').split(',')[0].trim();
    choose('font-family',font);choose('font-size',document.queryCommandValue('fontSize')||getComputedStyle(el).fontSize);choose('block-format',block?.tagName?.toLowerCase()||'p');
    for(const button of document.querySelectorAll('#toolbar [data-cmd]')){
      const name=button.dataset.cmd;if(['bold','italic','underline','strikeThrough','superscript','subscript','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight'].includes(name)){
        let active=false;try{active=document.queryCommandState(name);}catch{}button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      }
    }
  }
  area.addEventListener('keydown',event=>{
    if(event.key!=='Delete'||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
    const selection=getSelection();if(!selection?.rangeCount||!selection.isCollapsed)return;
    const block=current();if(!block||block.closest('pre,table,[contenteditable="false"]'))return;
    const before=document.createRange();before.selectNodeContents(block);before.setEnd(selection.anchorNode,selection.anchorOffset);
    if(before.toString().length||before.cloneContents().querySelector('img,video,audio,table'))return;
    const item=block.closest('li');
    if(item){event.preventDefault();rememberSelection();const list=item.closest('ol,ul');command(list?.tagName==='OL'?'insertOrderedList':'insertUnorderedList');return;}
    if(block.style.textIndent&&parseFloat(block.style.textIndent)!==0){event.preventDefault();block.style.textIndent='0';captureEditor();syncControls();return;}
    const parent=block.closest('blockquote');if(parent&&area.contains(parent)){event.preventDefault();rememberSelection();command('outdent');return;}
    if(block.style.textAlign&&block.style.textAlign!=='left'&&block.style.textAlign!=='start'){event.preventDefault();block.style.textAlign='left';captureEditor();syncRibbon();}
  });
  document.addEventListener('selectionchange',syncRibbon);
  area.addEventListener('input',syncRibbon);
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
