const priorities={red:{label:'🔴 緊急',rank:0},yellow:{label:'🟡 重要',rank:1},blue:{label:'🔵 不緊急',rank:2}};

export function installTodos(personal) {
  window.todoItems=[];
  const card=document.createElement('button');card.type='button';card.className='card todo-card';
  card.innerHTML='<div class="icon">📝</div><h2>待辦事項</h2><p>分開記錄行動與購物清單，<br>用紅黃藍三色安排輕重緩急。</p><div class="tag">行動・購物・完成每一步</div>';
  card.onclick=()=>window.switchApp('todos');
  personal.querySelector('.card.hundred').after(card);
  const page=document.createElement('section');page.id='todos-view';page.className='app-view data-hub';
  page.innerHTML='<button id="todo-back">← 我的事業</button><h1>📝 待辦事項</h1><p>把想做的事寫下來，一件一件完成。<span class="todo-legend">🔴 緊急　🟡 重要　🔵 不緊急</span></p><div class="todo-columns"></div>';
  document.body.append(page);page.querySelector('#todo-back').onclick=()=>window.switchApp('personal');
  const editors=new Map();
  function save(){localStorage.setItem('winplus_todos',JSON.stringify(window.todoItems));render();window.triggerCloudSave?.();}
  for(const [category,title] of [['action','🎯 行動'],['shopping','🛒 購物']]){
    const panel=document.createElement('section');panel.className='todo-panel';
    panel.innerHTML=`<h2>${title} <small id="todo-count-${category}"></small></h2><form id="todo-form-${category}"><label for="todo-text-${category}">要做什麼事情？</label><input id="todo-text-${category}" maxlength="240" placeholder="${category==='action'?'例如：聯絡客戶、安排拜訪':'例如：買筆記本、補充日用品'}" required><div class="todo-form-row"><label for="todo-priority-${category}" class="todo-sr-only">事項顏色</label><select id="todo-priority-${category}"><option value="blue">🔵 藍色・不緊急</option><option value="yellow">🟡 黃色・重要</option><option value="red">🔴 紅色・緊急</option></select><button type="submit">＋ 新增</button><button type="button" class="todo-cancel" hidden>取消</button></div></form><ul id="todo-list-${category}"></ul>`;
    page.querySelector('.todo-columns').append(panel);
    const form=panel.querySelector('form'),input=panel.querySelector('input'),select=panel.querySelector('select'),submit=panel.querySelector('[type=submit]'),cancel=panel.querySelector('.todo-cancel');
    const editor={id:null,input,select,submit,cancel,reset(){this.id=null;form.reset();submit.textContent='＋ 新增';cancel.hidden=true;}};editors.set(category,editor);
    cancel.onclick=()=>editor.reset();
    form.onsubmit=event=>{
      event.preventDefault();const title=input.value.trim();if(!title){input.focus();return;}
      if(editor.id){const item=window.todoItems.find(item=>item.id===editor.id);if(item){item.title=title;item.priority=select.value;}}
      else window.todoItems.push({id:crypto.randomUUID(),category,title,priority:select.value,done:false,createdAt:Date.now()});
      editor.reset();save();input.focus();
    };
  }
  function render(){
    for(const [category,editor] of editors){
      const list=page.querySelector(`#todo-list-${category}`),items=window.todoItems.filter(item=>item.category===category).sort((a,b)=>Number(a.done)-Number(b.done)||priorities[a.priority].rank-priorities[b.priority].rank||a.createdAt-b.createdAt);
      list.replaceChildren();page.querySelector(`#todo-count-${category}`).textContent=`${items.filter(item=>!item.done).length} 件待完成`;
      if(!items.length){const empty=document.createElement('li');empty.className='todo-empty';empty.textContent='目前沒有事項，新增第一件吧。';list.append(empty);}
      for(const item of items){
        const row=document.createElement('li');row.className=`todo-item todo-${item.priority}${item.done?' todo-done':''}`;
        const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=item.done;checkbox.setAttribute('aria-label',`完成：${item.title}`);text.textContent=item.title;label.append(checkbox,text);
        checkbox.onchange=()=>{item.done=checkbox.checked;save();};
        const badge=document.createElement('small');badge.textContent=priorities[item.priority].label;
        const edit=document.createElement('button');edit.type='button';edit.textContent='編輯';edit.onclick=()=>{editor.id=item.id;editor.input.value=item.title;editor.select.value=item.priority;editor.submit.textContent='儲存';editor.cancel.hidden=false;editor.input.focus();};
        const remove=document.createElement('button');remove.type='button';remove.textContent='刪除';remove.onclick=()=>{if(!confirm('確定刪除這件待辦事項？'))return;window.todoItems=window.todoItems.filter(row=>row.id!==item.id);if(editor.id===item.id)editor.reset();save();};
        const controls=document.createElement('div');controls.className='todo-item-actions';controls.append(badge,edit,remove);row.append(label,controls);list.append(row);
      }
    }
  }
  window.restoreTodos=data=>{
    window.todoItems=Array.isArray(data)?data.filter(item=>item && typeof item.id==='string' && typeof item.title==='string' && ['action','shopping'].includes(item.category) && Object.hasOwn(priorities,item.priority)).map(item=>({...item,done:item.done===true,createdAt:Number(item.createdAt)||0})):[];
    localStorage.setItem('winplus_todos',JSON.stringify(window.todoItems));editors.forEach(editor=>editor.reset());render();
  };
  render();
}
