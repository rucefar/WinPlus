// The viewport is local to this device. Zooming/panning never changes shared nodes.
export function installMindmapViewport(){
  const page=document.getElementById('page-mindmap'),wrapper=document.getElementById('mm-wrapper');
  const view={x:0,y:0,scale:1},pointers=new Map();let gesture=null,moveNodes=false;
  window.mmViewport=view;window.mmIsTouch=matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints>0;
  const clamp=value=>Math.min(3,Math.max(.03,value));
  const local=point=>{const rect=page.getBoundingClientRect();return {x:point.x-rect.left,y:point.y-rect.top};};
  const paint=()=>{wrapper.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;document.getElementById('mm-zoom-level').textContent=Math.round(view.scale*100)+'%';};
  function zoom(scale,anchor){
    scale=clamp(scale);const factor=scale/view.scale;
    view.x=anchor.x-(anchor.x-view.x)*factor;view.y=anchor.y-(anchor.y-view.y)*factor;view.scale=scale;paint();
  }
  window.mmZoomBy=factor=>zoom(view.scale*factor,{x:page.clientWidth/2,y:page.clientHeight/2});
  window.mmFitView=()=>{
    if(!page.clientWidth || !page.clientHeight || !window.mmNodes.length)return;
    const nodes=window.mmNodes.filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y));if(!nodes.length)return;
    const left=Math.min(...nodes.map(n=>n.x))-90,right=Math.max(...nodes.map(n=>n.x))+90;
    const top=Math.min(...nodes.map(n=>n.y))-35,bottom=Math.max(...nodes.map(n=>n.y))+35;
    const toolbar=page.querySelector('.mm-toolbar'),height=Math.max(80,page.clientHeight-toolbar.offsetHeight-100);
    view.scale=clamp(Math.min(1,(page.clientWidth-40)/(right-left),height/(bottom-top)));
    view.x=page.clientWidth/2-(left+right)/2*view.scale;view.y=55+height/2-(top+bottom)/2*view.scale;paint();
  };
  window.mmEditSelected=()=>{
    const id=window.mmSelectedId || 'root',node=page.querySelector(`.mm-node[data-node-id="${CSS.escape(id)}"] .mm-node-text`);
    if(!node)return window.showWPToast('請先點選要編輯的節點');
    const bounds=node.getBoundingClientRect(),area=page.getBoundingClientRect(),toolbar=page.querySelector('.mm-toolbar');
    if(view.scale<.85 || bounds.left<area.left+20 || bounds.right>area.right-20 || bounds.top<area.top+50 || bounds.bottom>area.bottom-toolbar.offsetHeight-25){const selected=window.mmNodes.find(item=>item.id===id);if(selected){view.scale=Math.max(1,view.scale);view.x=page.clientWidth/2-selected.x*view.scale;view.y=Math.max(90,(page.clientHeight-toolbar.offsetHeight)/3)-selected.y*view.scale;paint();}}
    node.contentEditable='true';node.focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  };
  window.mmToggleMoveMode=()=>{
    moveNodes=!moveNodes;const button=document.getElementById('mm-move-mode');button.setAttribute('aria-pressed',String(moveNodes));button.textContent=moveNodes?'✋ 返回拖移畫面':'↔ 移動節點';
  };
  const selectNode=id=>{window.mmSelectedId=id;page.querySelectorAll('.mm-node').forEach(node=>node.classList.toggle('selected',node.dataset.nodeId===id));};
  const pair=()=>[...pointers.values()].slice(0,2);
  const midpoint=points=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
  const distance=points=>Math.max(1,Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y));
  function rollbackNode(){
    if(gesture?.kind!=='node')return;
    const node=window.mmNodes.find(n=>n.id===gesture.id);if(node){node.x=gesture.nx;node.y=gesture.ny;positionNode(node);}
    window.mmDragging=false;
  }
  function positionNode(node){const element=page.querySelector(`.mm-node[data-node-id="${CSS.escape(node.id)}"]`);if(element){element.style.left=node.x+'px';element.style.top=node.y+'px';}window.mmDrawLines();}
  function startPan(point){gesture={kind:'pan',start:point,x:view.x,y:view.y};}
  page.addEventListener('pointerdown',event=>{
    if(event.target.closest('.mm-toolbar,button,input,select,.mm-node-link-btn,.mm-node-unlink-btn'))return;
    if(event.pointerType==='mouse' && event.button!==0)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>1){
      rollbackNode();document.activeElement?.blur();const points=pair(),anchor=local(midpoint(points));
      gesture={kind:'pinch',distance:distance(points),scale:view.scale,world:{x:(anchor.x-view.x)/view.scale,y:(anchor.y-view.y)/view.scale}};
    }else{
      const element=event.target.closest('.mm-node');if(element)selectNode(element.dataset.nodeId);
      if(event.target.isContentEditable){gesture=null;return;}
      const point={x:event.clientX,y:event.clientY};
      if(element && (event.pointerType==='mouse' || moveNodes)){
        const node=window.mmNodes.find(n=>n.id===element.dataset.nodeId);if(!node)return;
        gesture={kind:'node',id:node.id,start:point,nx:node.x,ny:node.y,moved:false};window.mmDragging=true;
      }else startPan(point);
    }
    page.setPointerCapture(event.pointerId);event.preventDefault();
  });
  page.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(!gesture)return;
    event.preventDefault();
    if(gesture.kind==='pinch' && pointers.size>1){
      const points=pair(),anchor=local(midpoint(points));view.scale=clamp(gesture.scale*distance(points)/gesture.distance);
      view.x=anchor.x-gesture.world.x*view.scale;view.y=anchor.y-gesture.world.y*view.scale;paint();
    }else if(gesture.kind==='pan'){
      view.x=gesture.x+event.clientX-gesture.start.x;view.y=gesture.y+event.clientY-gesture.start.y;paint();
    }else if(gesture.kind==='node'){
      const node=window.mmNodes.find(n=>n.id===gesture.id);if(!node)return;
      const dx=event.clientX-gesture.start.x,dy=event.clientY-gesture.start.y;
      gesture.moved=gesture.moved || Math.hypot(dx,dy)>3;
      node.x=gesture.nx+dx/view.scale;node.y=gesture.ny+dy/view.scale;positionNode(node);
    }
  });
  function end(event){
    if(!pointers.has(event.pointerId))return;
    if(gesture?.kind==='node'){
      if(event.type==='pointercancel')rollbackNode();else if(gesture.moved)window.mmSaveState();
    }
    pointers.delete(event.pointerId);window.mmDragging=false;
    if(pointers.size===1)startPan([...pointers.values()][0]);else gesture=null;
    if(page.hasPointerCapture(event.pointerId))page.releasePointerCapture(event.pointerId);
    if(!pointers.size)document.dispatchEvent(new Event('mm-gesture-end'));
  }
  page.addEventListener('pointerup',end);page.addEventListener('pointercancel',end);
  page.addEventListener('wheel',event=>{
    if(event.target.closest('.mm-toolbar'))return;event.preventDefault();
    zoom(view.scale*Math.exp(-event.deltaY*.002),local({x:event.clientX,y:event.clientY}));
  },{passive:false});
  page.addEventListener('dblclick',event=>{const node=event.target.closest('.mm-node');if(node){selectNode(node.dataset.nodeId);window.mmEditSelected();}});
  window.addEventListener('resize',()=>{if(page.classList.contains('active')&&!document.activeElement?.isContentEditable)window.mmFitView();});
  paint();
}
