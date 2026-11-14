export function installMandalaViewport(){
  const viewport=document.getElementById('mandala-viewport'),stage=document.getElementById('mandala-stage'),grid=document.getElementById('big-grid');
  const coarse=matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints>0;
  const view={scale:1,left:0,top:0},points=new Map();let gesture=null,tap=null,editing=null;
  window.mandalaViewport=view;
  const clamp=value=>Math.max(.25,Math.min(2.5,value));
  const configure=()=>grid.querySelectorAll('textarea').forEach(cell=>cell.readOnly=coarse);
  function paint(){
    const size=630*view.scale,width=Math.max(size,viewport.clientWidth),height=Math.max(size,viewport.clientHeight);
    stage.style.width=width+'px';stage.style.height=height+'px';view.left=(width-size)/2;view.top=(height-size)/2;
    grid.style.left=view.left+'px';grid.style.top=view.top+'px';grid.style.transform=`scale(${view.scale})`;
    document.getElementById('mandala-zoom-level').textContent=Math.round(view.scale*100)+'%';document.getElementById('mandala-zoom-range').value=Math.round(view.scale*100);
  }
  function zoom(scale,anchor={x:viewport.clientWidth/2,y:viewport.clientHeight/2}){
    const x=(viewport.scrollLeft+anchor.x-view.left)/view.scale,y=(viewport.scrollTop+anchor.y-view.top)/view.scale;
    view.scale=clamp(scale);paint();viewport.scrollLeft=x*view.scale+view.left-anchor.x;viewport.scrollTop=y*view.scale+view.top-anchor.y;
  }
  window.mandalaZoomBy=factor=>zoom(view.scale*factor);
  window.mandalaZoomTo=percent=>zoom(Number(percent)/100);
  window.mandalaFitView=()=>{
    if(!viewport.clientWidth || !viewport.clientHeight)return;
    configure();view.scale=clamp(Math.min((viewport.clientWidth-16)/630,(viewport.clientHeight-16)/630));paint();viewport.scrollLeft=0;viewport.scrollTop=0;
  };
  const dialog=document.createElement('dialog');dialog.id='mandala-cell-dialog';
  dialog.innerHTML='<form id="mandala-cell-form"><h2 id="mandala-cell-title">編輯九宮格</h2><textarea id="mandala-cell-text" rows="7" aria-label="格子內容"></textarea><p id="mandala-cell-error" role="alert"></p><div><button type="button" id="mandala-cell-cancel">取消</button><button type="submit">儲存</button></div></form>';
  document.body.append(dialog);
  function openEditor(cell){
    editing={cell,base:cell.value};document.getElementById('mandala-cell-title').textContent='編輯 '+(cell.parentElement.querySelector('.cell-code').textContent || '中心格');
    document.getElementById('mandala-cell-text').value=cell.value;document.getElementById('mandala-cell-error').textContent='';dialog.showModal();
  }
  document.getElementById('mandala-cell-cancel').onclick=()=>dialog.close();
  document.getElementById('mandala-cell-form').onsubmit=event=>{
    event.preventDefault();if(!editing)return;
    const value=document.getElementById('mandala-cell-text').value;
    if(editing.cell.value!==editing.base && editing.cell.value!==value){document.getElementById('mandala-cell-error').textContent='另一位成員已更新這一格，請先保留文字、取消後重新開啟。';return;}
    editing.cell.value=value;editing.cell.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();
  };
  dialog.addEventListener('close',()=>{editing=null;});
  const local=point=>{const rect=viewport.getBoundingClientRect();return {x:point.x-rect.left,y:point.y-rect.top};};
  const pair=()=>[...points.values()].slice(0,2);
  const middle=pair=>({x:(pair[0].x+pair[1].x)/2,y:(pair[0].y+pair[1].y)/2});
  const distance=pair=>Math.max(1,Math.hypot(pair[1].x-pair[0].x,pair[1].y-pair[0].y));
  function pan(point){gesture={kind:'pan',point,left:viewport.scrollLeft,top:viewport.scrollTop};}
  viewport.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse' && (event.button!==0 || (!coarse && event.target.tagName==='TEXTAREA')))return;
    configure();points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(points.size>1){
      tap=null;const current=pair(),anchor=local(middle(current));
      gesture={kind:'pinch',distance:distance(current),scale:view.scale,world:{x:(viewport.scrollLeft+anchor.x-view.left)/view.scale,y:(viewport.scrollTop+anchor.y-view.top)/view.scale}};
    }else{
      pan({x:event.clientX,y:event.clientY});tap=event.target.closest('textarea');
    }
    viewport.setPointerCapture(event.pointerId);event.preventDefault();
  });
  viewport.addEventListener('pointermove',event=>{
    if(!points.has(event.pointerId)||!gesture)return;event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(gesture.kind==='pinch' && points.size>1){
      const current=pair(),anchor=local(middle(current));view.scale=clamp(gesture.scale*distance(current)/gesture.distance);paint();
      viewport.scrollLeft=gesture.world.x*view.scale+view.left-anchor.x;viewport.scrollTop=gesture.world.y*view.scale+view.top-anchor.y;
    }else if(gesture.kind==='pan'){
      const dx=event.clientX-gesture.point.x,dy=event.clientY-gesture.point.y;if(Math.hypot(dx,dy)>6)tap=null;
      viewport.scrollLeft=gesture.left-dx;viewport.scrollTop=gesture.top-dy;
    }
  });
  function end(event){
    if(!points.has(event.pointerId))return;
    const cell=event.type==='pointerup' && points.size===1 ? tap : null;tap=null;points.delete(event.pointerId);
    if(points.size===1)pan([...points.values()][0]);else gesture=null;
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    if(cell && coarse)openEditor(cell);
  }
  viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
  viewport.addEventListener('wheel',event=>{
    if(!event.ctrlKey && !event.metaKey)return;event.preventDefault();zoom(view.scale*Math.exp(-event.deltaY*.002),local({x:event.clientX,y:event.clientY}));
  },{passive:false});
  window.addEventListener('resize',()=>{if(document.getElementById('page-mandala').classList.contains('active')&&!dialog.open&&!document.activeElement?.matches('input,textarea'))window.mandalaFitView();});
  const observer=new ResizeObserver(()=>{if(!viewport.clientWidth || !viewport.clientHeight)return;if(!stage.style.width)window.mandalaFitView();});observer.observe(viewport);
  configure();
}
