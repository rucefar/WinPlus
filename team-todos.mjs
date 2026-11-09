import {merge} from './shared-data.mjs';
const priorities={red:{label:'🔴 緊急',rank:0},yellow:{label:'🟡 重要',rank:1},blue:{label:'🔵 不緊急',rank:2}};
const editable=item=>({title:item.title,priority:item.priority,assigneeEmail:item.assigneeEmail,done:item.done});

export function installTeamTodos({db,api}) {
  const {doc,collection,onSnapshot,setDoc,runTransaction,serverTimestamp}=api;
  let context=null,rows=[],stop=()=>{},subscribed=false,loaded=false,epoch=0,pending=0;
  const editors=new Map();
  const page=document.createElement('section');page.id='team-todos-view';page.className='app-view data-hub';
  page.innerHTML='<button id="team-todo-back">← 團隊工作區</button><h1>📝 團隊待辦事項</h1><p>一起安排工作、指派負責人，掌握每件事的進度。<span class="todo-legend">🔴 緊急　🟡 重要　🔵 不緊急</span></p><p id="team-todo-status" role="status" aria-live="polite">請先選擇團隊工作區</p><button id="team-todo-retry" hidden>重新連線</button><div class="todo-columns"></div>';
  document.body.append(page);page.querySelector('#team-todo-back').onclick=()=>window.switchApp('workspace');
  const status=text=>page.querySelector('#team-todo-status').textContent=text;
  const report=error=>status(error.code==='permission-denied'?'團隊待辦尚未開通或權限已移除，請確認 Firebase 團隊待辦規則已發布。':error.code==='sync-conflict'?'另一位成員修改了相同欄位，已保留表單內容；請取消編輯、查看最新內容後再試。':error.message || '同步失敗，請稍後重試');
  const taskRef=(id,workspace=context.id)=>doc(db,'workspaces',workspace,'tasks',id);
  function controls(){page.querySelectorAll('form input,form select,form button,.todo-item button,.todo-item input').forEach(element=>element.disabled=!context || !loaded || pending>0);}
  async function operation(fn){
    if(!context || !loaded || pending)return;
    const version=epoch,captured=context;pending++;controls();status('正在同步變更…');
    try{await fn(captured);if(version===epoch)status('✓ 團隊待辦已同步');}
    catch(error){if(version===epoch){render();report(error);}}
    finally{pending--;controls();}
  }
  async function update(item,changes,captured){
    await runTransaction(db,async transaction=>{
      const ref=taskRef(item.id,captured.id),snapshot=await transaction.get(ref);
      if(!snapshot.exists())throw new Error('這件待辦已被刪除，請取消編輯後重新新增');
      const next=merge(editable(item),{...editable(item),...changes},editable(snapshot.data()));
      transaction.update(ref,{...next,updatedAt:serverTimestamp(),updatedBy:captured.user.uid});
    });
  }
  for(const [category,title] of [['action','🎯 行動'],['shopping','🛒 購物']]){
    const panel=document.createElement('section');panel.className='todo-panel';
    panel.innerHTML=`<h2>${title} <small id="team-todo-count-${category}"></small></h2><form id="team-todo-form-${category}"><label for="team-todo-text-${category}">要做什麼事情？</label><input id="team-todo-text-${category}" maxlength="240" required placeholder="輸入團隊待辦事項"><label class="todo-assignee-label" for="team-todo-assignee-${category}">負責成員</label><select id="team-todo-assignee-${category}"></select><div class="todo-form-row"><label class="todo-sr-only" for="team-todo-priority-${category}">事項顏色</label><select id="team-todo-priority-${category}"><option value="blue">🔵 藍色・不緊急</option><option value="yellow">🟡 黃色・重要</option><option value="red">🔴 紅色・緊急</option></select><button type="submit">＋ 發布</button><button type="button" class="todo-cancel" hidden>取消</button></div></form><ul id="team-todo-list-${category}"></ul>`;
    page.querySelector('.todo-columns').append(panel);
    const form=panel.querySelector('form'),input=panel.querySelector('input'),assignee=panel.querySelector(`#team-todo-assignee-${category}`),priority=panel.querySelector(`#team-todo-priority-${category}`),submit=panel.querySelector('[type=submit]'),cancel=panel.querySelector('.todo-cancel');
    const editor={item:null,input,assignee,priority,submit,cancel,reset(){this.item=null;form.reset();submit.textContent='＋ 發布';cancel.hidden=true;refreshAssignees();}};
    editors.set(category,editor);cancel.onclick=()=>editor.reset();
    form.onsubmit=event=>{
      event.preventDefault();const title=input.value.trim();if(!title){input.focus();return;}
      const selected=assignee.value;
      if(selected && !context?.members.includes(selected)){status('該負責人已不在共用成員中，請重新選擇');return;}
      operation(async captured=>{
        if(editor.item)await update(editor.item,{title,assigneeEmail:selected,priority:priority.value},captured);
        else await setDoc(doc(collection(db,'workspaces',captured.id,'tasks')),{title,category,priority:priority.value,assigneeEmail:selected,done:false,createdBy:captured.user.uid,creatorEmail:captured.user.email.toLowerCase(),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:captured.user.uid});
        if(context?.id===captured.id){editor.reset();input.focus();}
      });
    };
  }
  function refreshAssignees(){
    for(const editor of editors.values()){
      const selected=editor.assignee.value;
      editor.assignee.replaceChildren(new Option('暫不指派',''));
      (context?.members || []).forEach(email=>editor.assignee.add(new Option(email+(email===context.user.email.toLowerCase()?'（我）':''),email)));
      if(selected && !context?.members.includes(selected)){const option=new Option(`${selected}（已退出，請重新指派）`,selected);option.disabled=true;editor.assignee.add(option);}
      editor.assignee.value=selected;
    }
  }
  function render(){
    for(const [category,editor] of editors){
      const list=page.querySelector(`#team-todo-list-${category}`),items=rows.filter(item=>item.category===category).sort((a,b)=>Number(a.done)-Number(b.done)||priorities[a.priority].rank-priorities[b.priority].rank||(a.createdAt?.toMillis?.() || 0)-(b.createdAt?.toMillis?.() || 0));
      list.replaceChildren();page.querySelector(`#team-todo-count-${category}`).textContent=`${items.filter(item=>!item.done).length} 件待完成`;
      if(!items.length){const empty=document.createElement('li');empty.className='todo-empty';empty.textContent=loaded?'目前沒有團隊待辦，新增第一件吧。':'等待載入團隊待辦…';list.append(empty);}
      for(const item of items){
        const row=document.createElement('li');row.className=`todo-item todo-${item.priority}${item.done?' todo-done':''}`;row.dataset.taskId=item.id;
        const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=item.done;checkbox.setAttribute('aria-label',`完成：${item.title}`);text.textContent=item.title;label.append(checkbox,text);
        checkbox.onchange=()=>{operation(captured=>update(item,{done:!item.done},captured));};
        const details=document.createElement('div');details.className='todo-people';
        const assignee=document.createElement('p'),publisher=document.createElement('p');assignee.className='todo-assignee';publisher.className='todo-publisher';
        assignee.textContent='👤 負責人：'+(item.assigneeEmail?(item.assigneeEmail+(context?.members.includes(item.assigneeEmail)?'':'（已退出，請重新指派）')):'暫未指派');
        publisher.textContent='✍️ 發布者：'+item.creatorEmail;details.append(assignee,publisher);
        const badge=document.createElement('small');badge.textContent=priorities[item.priority].label;
        const edit=document.createElement('button');edit.type='button';edit.textContent='編輯';edit.onclick=()=>{editor.item=structuredClone(item);editor.input.value=item.title;editor.priority.value=item.priority;editor.assignee.value=item.assigneeEmail;editor.submit.textContent='儲存';editor.cancel.hidden=false;editor.input.focus();};
        const remove=document.createElement('button');remove.type='button';remove.textContent='刪除';remove.onclick=()=>{if(!confirm('確定刪除這件團隊待辦？'))return;operation(async captured=>{await runTransaction(db,async transaction=>{const ref=taskRef(item.id,captured.id),snapshot=await transaction.get(ref);if(!snapshot.exists())return;if(!snapshot.data().updatedAt?.isEqual(item.updatedAt))throw new Error('這件待辦剛被其他成員修改，請查看最新內容再刪除');transaction.delete(ref);});if(editor.item?.id===item.id)editor.reset();});};
        const buttons=document.createElement('div');buttons.className='todo-item-actions';buttons.append(badge,edit,remove);row.append(label,details,buttons);list.append(row);
      }
    }
    controls();
  }
  function connect(){
    if(!context)return;stop();const version=epoch;subscribed=true;loaded=false;controls();status('正在載入團隊待辦…');
    stop=onSnapshot(collection(db,'workspaces',context.id,'tasks'),{includeMetadataChanges:true},snapshot=>{
      if(version!==epoch)return;
      rows=snapshot.docs.map(document=>({...document.data(),id:document.id})).filter(item=>Object.hasOwn(priorities,item.priority)&&['action','shopping'].includes(item.category));
      loaded=true;status(snapshot.metadata.fromCache?'正在連線，顯示暫存資料…':snapshot.metadata.hasPendingWrites?'變更正在同步…':'✓ 團隊待辦已同步');render();
    },error=>{if(version!==epoch)return;loaded=false;rows=[];render();report(error);page.querySelector('#team-todo-retry').hidden=false;});
  }
  page.querySelector('#team-todo-retry').onclick=()=>{page.querySelector('#team-todo-retry').hidden=true;connect();};
  window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
  return {
    open(){if(!subscribed)connect();},
    setContext(next){
      if(context?.id===next?.id && context?.user.uid===next?.user.uid){context=next;refreshAssignees();render();return;}
      epoch++;stop();stop=()=>{};subscribed=false;loaded=false;rows=[];context=next;
      editors.forEach(editor=>editor.reset());refreshAssignees();render();status(context?'進入頁面後載入團隊待辦':'請先選擇團隊工作區');page.querySelector('#team-todo-retry').hidden=true;
    },
    stop(){this.setContext(null);}
  };
}
