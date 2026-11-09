import {installTodos} from './todos.mjs';
import {copy, equal, sharedPart, merge, validateShared, selectSharedData} from './shared-data.mjs';

// Firebase is injected so the collaboration lifecycle can also be tested offline.
export function installCollaboration({db, auth, api}) {
  const {doc, collection, query, where, onSnapshot, getDoc, setDoc, runTransaction, serverTimestamp} = api;
  let user = null, active = null, own = null, base = null, remote = null;
  let stopList = () => {}, stopState = () => {}, spaces = [], ready = false;
  let timer, saving = null, dirty = false, conflict = false, generation = 0, pendingSnapshot = null;
  let ownCommit = null, actionBusy = false;
  let customerBase = null, personalSave = Promise.resolve(), personalSaved = null;
  const status = text => { document.getElementById('share-status').textContent = text; document.querySelectorAll('.cloud-status').forEach(element=>element.textContent=text); };
  const errorText = error => error.code === 'permission-denied' ? '沒有共用權限，或 Firebase 共用規則尚未設定。' : error.message || '連線失敗，請稍後重試';
  const draftKey = () => `winplus-draft:${user.uid}:${active}`;
  const stateRef = id => doc(db, 'workspaces', id, 'content', 'state');
  const metaRef = id => doc(db, 'workspaces', id);
  const local = () => sharedPart(window.collectAllData());
  const showError = error => {
    status(`⚠ ${errorText(error)}`);
    document.getElementById('share-error').textContent = errorText(error);
    document.getElementById('share-retry').hidden = !ready;
    document.getElementById('share-reload').hidden = !active;
  };

  // Restore only the shared scope; personal notes, journals and check-ins stay private.
  function apply(data) {
    window.mapGeneration=(window.mapGeneration || 0)+1;
    window.isMapLoading=false;
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
      const key = `mc-${r}-${c}`;
      localStorage.setItem(key, data.cells[key] || '');
    }
    ['ml_date','ml_title','ml_name','ml_memo'].forEach(key=>localStorage.setItem(key, data.fields[key] || ''));
    window.restoreAllData({...data, fields:Object.fromEntries(['ml_date','ml_title','ml_name','ml_memo'].map(key=>[key,data.fields[key] || '']))});
    if (window.mapInstance) {
      (window.mapMarkers || []).forEach(marker=>marker.remove());
      window.mapMarkers = [];
      document.getElementById('map-status').textContent='名單已更新，請重新整理地圖';
    }
  }
  function closeEditors() {
    window.nGoBack(); customerBase = null;
    ['mm-link-modal','mm-reparent-modal'].forEach(id=>document.getElementById(id)?.classList.remove('show'));
  }
  function clearError() {
    conflict = false;
    document.getElementById('share-error').textContent = '';
    document.getElementById('share-retry').hidden = true;
    document.getElementById('share-reload').hidden = true;
  }
  function remember() {
    if (active && base) {
      try { sessionStorage.setItem(draftKey(), JSON.stringify({base, local:local()})); }
      catch { status('⚠ 瀏覽器草稿空間不足，請保持頁面開啟直到同步完成'); }
    }
  }
  function receive(data, acknowledged = null) {
    try { remote = validateShared(sharedPart(data)); }
    catch(error){showError(error);return;}
    if (!acknowledged && ownCommit && equal(remote,ownCommit.result)) acknowledged=ownCommit.submitted;
    const now = local();
    try {
      const next = base ? validateShared(merge(acknowledged || base, now, remote)) : remote;
      // Keep the focused node and caret until blur; preserve the acknowledgement base.
      if (!equal(now,next) && (document.activeElement?.closest('#mm-canvas') || window.mmDragging)) {
        pendingSnapshot={data:remote,acknowledged};status('夥伴已更新，結束節點編輯後顯示');return;
      }
      base = copy(remote);
      ownCommit=null;clearError();
      if (!equal(now,next)) apply(next);
      dirty = !equal(next,base);
      if (!dirty) { sessionStorage.removeItem(draftKey()); clearError(); }
      else remember();
      status(dirty ? '共用資料有待同步變更' : '✓ 共用資料已即時同步');
    } catch (error) { conflict = true; remember(); showError(error); }
  }
  document.addEventListener('focusout', () => setTimeout(()=>{
    if (pendingSnapshot && !window.mmDragging) { const next=pendingSnapshot;pendingSnapshot=null;receive(next.data,next.acknowledged); }
  },0));
  document.addEventListener('mouseup', ()=>setTimeout(()=>{
    if(pendingSnapshot && !window.mmDragging){const next=pendingSnapshot;pendingSnapshot=null;receive(next.data,next.acknowledged);}
  },0));
  document.addEventListener('touchend', ()=>setTimeout(()=>{
    if(pendingSnapshot && !window.mmDragging){const next=pendingSnapshot;pendingSnapshot=null;receive(next.data,next.acknowledged);}
  },0));

  async function savePersonal() {
    const data = window.collectAllData();
    const payload = active ? {...data, ...own} : data;
    if(equal(payload,personalSaved))return;
    // Queue writes so a slower request never replaces a newer personal snapshot.
    const uid=user.uid;
    personalSave = personalSave.catch(()=>{}).then(async()=>{await setDoc(doc(db,'users',uid),payload);personalSaved=copy(payload);});
    await personalSave;
  }
  async function flush() {
    clearTimeout(timer);timer=null;
    if (!ready || !user) return;
    if (saving) { await saving; return flush(); }
    saving = (async()=>{
      await savePersonal();
      if (!active || !dirty) return;
      if (conflict) throw new Error('共用修改有衝突；請開啟「共用與同步」查看處理方式。');
      const id=active, epoch=generation, startBase=copy(base), submitted=local();
      await runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(stateRef(id));
        if(!snapshot.exists()) throw new Error('團隊工作區不存在');
        const latest=sharedPart(snapshot.data().data);
        const next=validateShared(merge(startBase,submitted,latest));
        ownCommit={submitted,result:next};
        transaction.set(stateRef(id),{data:next, updatedAt:serverTimestamp(), updatedBy:user.uid});
      });
      if (epoch!==generation) return;
      // A listener event is the authority for clean state, including intervening edits.
      const latest=await getDoc(stateRef(id));
      if(epoch===generation && latest.exists()) receive(latest.data().data,submitted);
    })();
    try { await saving; if(!active) status('✓ 個人資料已同步'); }
    catch(error) { if(error.code==='sync-conflict') conflict=true; remember();showError(error);throw error; }
    finally { saving=null; }
  }
  window.triggerCloudSave = () => {
    if (!ready) return;
    if(active){ dirty=!equal(local(),base);remember(); }
    status('等待同步…'); clearTimeout(timer);
    timer=setTimeout(()=>flush().catch(()=>{}),700);
  };
  window.addEventListener('beforeunload', event=>{
    const data=ready ? window.collectAllData() : null;
    const personalDirty=ready && !equal(active ? {...data,...own} : data,personalSaved);
    if(timer || saving || dirty || personalDirty){event.preventDefault();event.returnValue='';}
  });
  window.addEventListener('online',()=>flush().catch(()=>{}));

  function render() {
    renderHub();
    document.body.dataset.dataScope=active?'shared':'personal';
    document.getElementById('scope-banner').textContent=active?'團隊工作區 · '+(spaces.find(space=>space.id===active)?.name || '')+' · 成員共同編輯':'我的事業 · 僅自己可見';
    const select=document.getElementById('share-workspace'); select.replaceChildren(new Option('我的個人資料',''));
    spaces.forEach(space=>select.add(new Option(space.name,space.id)));
    select.value=active || '';
    const current=spaces.find(space=>space.id===active);
    document.getElementById('share-current').textContent=current ? current.name : '我的個人資料';
    document.getElementById('share-launcher').dataset.shared=String(!!active);
    document.getElementById('share-members').replaceChildren();
    document.getElementById('share-invite-form').hidden=!current || current.ownerUid!==user?.uid;
    document.getElementById('share-member-heading').hidden=!current;
    if(current) current.memberEmails.forEach(email=>{
      const row=document.createElement('li');const label=document.createElement('span');label.textContent=email+(email===current.ownerEmail?'（擁有者）':'（共同編輯）');row.append(label);
      if(current.ownerUid===user.uid && email!==current.ownerEmail){
        const button=document.createElement('button');button.textContent='移除共用';button.type='button';
        button.onclick=()=>action(async()=>{if(confirm(`停止與 ${email} 共用？`)) await changeMember(email,false);});row.append(button);
      }
      document.getElementById('share-members').append(row);
    });
  }
  async function action(fn) {
    if(actionBusy)return;actionBusy=true;
    const buttons=[...document.querySelectorAll('#share-dialog button, #share-dialog select, .data-hub button, .data-doors button')];
    buttons.forEach(button=>button.disabled=true);
    try { await fn(); } catch(error){showError(error);}
    finally {actionBusy=false;buttons.forEach(button=>button.disabled=false);render();}
  }
  function discardToPersonal(message) {
    clearTimeout(timer);timer=null; generation++;stopState();active=null;base=null;remote=null;pendingSnapshot=null;ownCommit=null;dirty=false;conflict=false;
    closeEditors();if(own) apply(own);own=null;clearError();render();originalSwitch('personal');status(message);
  }
  async function selectWorkspace(id) {
    if(id===active || (!id&&!active)) return;
    if(document.getElementById('n-form-page').style.display==='block' && !confirm('切換工作區會關閉尚未儲存的名單表單，確定切換？'))return;
    await flush();
    let next=null;
    if(id){const snapshot=await getDoc(stateRef(id));if(!snapshot.exists())throw new Error('共用資料不存在');next=validateShared(sharedPart(snapshot.data().data));}
    if(!active)own=local();
    generation++;stopState();pendingSnapshot=null;ownCommit=null;closeEditors();clearError();
    active=id || null;base=null;remote=null;dirty=false;
    if(!active){apply(own);own=null;render();originalSwitch('personal');status('✓ 已切回個人資料');return;}
    let draft=null;
    try{draft=JSON.parse(sessionStorage.getItem(draftKey()));}catch{}
    apply(next);base=copy(next);
    if(draft){apply(draft.local);base=draft.base;dirty=true;receive(next);}
    const epoch=generation;
    stopState=onSnapshot(stateRef(id),snapshot=>{
      if(epoch!==generation || snapshot.metadata.hasPendingWrites)return;
      if(!snapshot.exists()){discardToPersonal('團隊工作區已不存在，已切回個人資料');return;}
      receive(snapshot.data().data);
    },error=>{
      if(epoch!==generation)return;
      if(error.code==='permission-denied'){
        sessionStorage.removeItem(draftKey());discardToPersonal('共用權限已移除或規則拒絕存取，已切回個人資料');
      }else showError(error);
    });
    render();originalSwitch('workspace');status(dirty?'有尚未同步的修改，請按重試':'正在連接共用資料…');
  }
  async function changeMember(email,add) {
    await runTransaction(db,async transaction=>{
      const ref=metaRef(active),snapshot=await transaction.get(ref);
      const data=snapshot.data();if(data.ownerUid!==user.uid)throw new Error('只有擁有者能管理共用');
      const members=new Set(data.memberEmails);
      if(add)members.add(email);else members.delete(email);
      if(members.size>30)throw new Error('每個工作區最多 30 個共用帳號');
      transaction.update(ref,{memberEmails:[...members]});
    });
  }

  const launcher=document.createElement('button');launcher.id='share-launcher';launcher.type='button';launcher.hidden=true;
  launcher.innerHTML='<strong>共用與同步</strong><span id="share-current">我的個人資料</span><small id="share-status" role="status" aria-live="polite">尚未登入</small>';
  document.body.append(launcher);
  const dialog=document.createElement('dialog');dialog.id='share-dialog';
  dialog.innerHTML=`<form method="dialog"><button class="share-close" aria-label="關閉">✕</button></form>
    <h2>共用名單與組織網</h2><p>團隊工作區內的名單、九宮格及組織網會即時同步。筆記、複盤和打卡保留私人。</p>
    <label for="share-workspace">目前工作區</label><select id="share-workspace"></select>
    <p class="share-note">受邀者用指定的 Google 帳號登入 WinPlus，從此處選擇工作區即可共同編輯，不需要傳送檔案。</p>
    <form id="share-create-form"><label for="share-name">建立工作區</label><input id="share-name" maxlength="80" placeholder="例如：團隊共同名單" required>
    <fieldset id="share-source"><legend>從我的事業選擇要共用的內容</legend><p class="share-note">預設不帶入資料，可建立空白工作區。組織網節點文字也會共用，未選名單的連結會解除。</p><div id="share-customer-options"></div><label><input type="checkbox" id="share-include-grid">帶入我的九宮格與標題</label><label><input type="checkbox" id="share-include-organization">帶入我的整份組織網</label></fieldset><button>建立團隊工作區</button></form>
    <h3 id="share-member-heading" hidden>共用成員</h3><ul id="share-members"></ul>
    <form id="share-invite-form" hidden><label for="share-email">指定對方的 Google 帳號 Email</label><div class="share-row"><input type="email" id="share-email" placeholder="name@gmail.com" required><button>加入共用</button></div><p class="share-note">成員可以查看、編輯和刪除工作區資料；只有擁有者能新增或移除共用成員。此操作不寄送通知信。</p></form>
    <p id="share-error" role="alert"></p><button id="share-retry" hidden>重試同步</button> <button id="share-reload" hidden>放棄未同步修改，載入最新資料</button>`;
  document.body.append(dialog);
  launcher.onclick=()=>{render();refreshSource();dialog.showModal();};
  document.getElementById('share-workspace').onchange=event=>action(()=>selectWorkspace(event.target.value));
  document.getElementById('share-create-form').onsubmit=event=>{
    event.preventDefault();action(async()=>{
      await flush();const name=document.getElementById('share-name').value.trim();if(!name)throw new Error('請填寫工作區名稱');
      const data=selectSharedData(own || local(),{customerIds:[...document.querySelectorAll('#share-customer-options input:checked')].map(input=>Number(input.value)),includeGrid:document.getElementById('share-include-grid').checked,includeOrganization:document.getElementById('share-include-organization').checked}),ref=doc(collection(db,'workspaces'));
      await runTransaction(db,async transaction=>{
        transaction.set(ref,{name,ownerUid:user.uid,ownerEmail:user.email.toLowerCase(),memberEmails:[user.email.toLowerCase()],createdAt:serverTimestamp()});
        transaction.set(stateRef(ref.id),{data,updatedBy:user.uid,updatedAt:serverTimestamp()});
      });
      // Query listeners may not have emitted the new workspace yet.
      if(!spaces.some(space=>space.id===ref.id))spaces.push({id:ref.id,name,ownerUid:user.uid,ownerEmail:user.email.toLowerCase(),memberEmails:[user.email.toLowerCase()]});
      await selectWorkspace(ref.id);document.getElementById('share-create-form').reset();refreshSource();
    });
  };
  document.getElementById('share-invite-form').onsubmit=event=>{
    event.preventDefault();action(async()=>{const email=document.getElementById('share-email').value.trim().toLowerCase();await changeMember(email,true);document.getElementById('share-email').value='';status('✓ 已加入共用；對方登入後即可選取工作區');});
  };
  document.getElementById('share-retry').onclick=()=>action(()=>flush());
  document.getElementById('share-reload').onclick=()=>action(async()=>{
    if(!active || !confirm('確定放棄尚未同步的修改，改用雲端最新資料？'))return;
    const snapshot=await getDoc(stateRef(active));if(!snapshot.exists())throw new Error('工作區不存在');
    closeEditors();clearError();base=sharedPart(snapshot.data().data);remote=copy(base);pendingSnapshot=null;apply(base);dirty=false;sessionStorage.removeItem(draftKey());status('✓ 已載入最新共用資料');
  });

  // Separate landing pages make the current ownership scope explicit.
  const navigate=window.switchApp;
  const originalSwitch=(id,...args)=>{
    const banner=document.getElementById('scope-banner');
    if(banner){if(id==='workspace')workspace.prepend(banner);else if(id==='todos')document.getElementById('todos-view').prepend(banner);else document.body.prepend(banner);}
    navigate(id,...args);
  };
  const home=document.getElementById('home-view');
  const personal=document.createElement('section');personal.id='personal-view';personal.className='app-view data-hub';
  personal.innerHTML='<button class="data-home">← 資料首頁</button><h1>🚀 我的事業</h1><p>這裡的名單、組織網與成長紀錄僅自己可見。</p>';
  personal.append(home.querySelector('main.container'));document.body.append(personal);
  installTodos(personal);
  const doors=document.createElement('div');doors.className='data-doors';
  doors.innerHTML='<button id="open-personal"><strong>🚀 我的事業</strong><span>私人名單、組織網與成長紀錄</span></button><button id="open-shared"><strong>📓 團隊工作區</strong><span>與指定 Google 帳號共同查看、編輯</span></button>';
  home.querySelector('header').after(doors);
  const hub=document.createElement('section');hub.id='shared-view';hub.className='app-view data-hub';
  hub.innerHTML='<button class="data-home">← 資料首頁</button><h1>📓 團隊工作區</h1><p>選擇工作區後，變更會同步給該區所有成員。</p><button id="hub-create">建立團隊工作區</button><div id="workspace-list"></div>';
  document.body.append(hub);
  const workspace=document.createElement('section');workspace.id='workspace-view';workspace.className='app-view data-hub';
  workspace.innerHTML='<button id="back-shared">← 團隊工作區列表</button><h1 id="workspace-title"></h1><p>共用成員可以共同查看與編輯這裡的資料。</p><div class="data-doors"><button id="workspace-customers">👥 名單</button><button id="workspace-grid">🔲 九宮格</button><button id="workspace-organization">🕸️ 組織網</button></div>';
  document.body.append(workspace);
  const banner=document.createElement('div');banner.id='scope-banner';banner.setAttribute('role','status');document.body.prepend(banner);
  window.openDataHome=()=>originalSwitch('home');
  window.switchApp=(id,...args)=>{
    if(id==='home')id=active?'workspace':'personal';
    if(active && ['review','hundred','todos'].includes(id))return;
    originalSwitch(id,...args);
  };
  document.querySelectorAll('.data-home').forEach(button=>button.onclick=window.openDataHome);
  document.getElementById('open-personal').onclick=()=>action(async()=>{await selectWorkspace('');if(!active)originalSwitch('personal');});
  document.getElementById('open-shared').onclick=()=>{renderHub();originalSwitch('shared');};
  document.getElementById('back-shared').onclick=()=>originalSwitch('shared');
  document.getElementById('hub-create').onclick=launcher.onclick;
  document.getElementById('workspace-customers').onclick=()=>window.switchApp('ninety');
  document.getElementById('workspace-grid').onclick=()=>{window.switchApp('winplus');window.gotoPage('mandala');};
  document.getElementById('workspace-organization').onclick=()=>{window.switchApp('winplus');window.gotoPage('mindmap');};
  function renderHub(){
    const list=document.getElementById('workspace-list');if(!list)return;
    list.replaceChildren();
    if(!spaces.length){const empty=document.createElement('p');empty.textContent='目前沒有團隊工作區。你可以建立一個，或請對方將你的 Google Email 加入共用。';list.append(empty);}
    spaces.forEach(space=>{
      const button=document.createElement('button');button.className='workspace-card';
      const title=document.createElement('strong');title.textContent=space.name;
      const detail=document.createElement('span');detail.textContent=`${space.ownerUid===user?.uid?'我建立的':'受邀共用'} · ${space.memberEmails.length} 位成員`;
      button.append(title,detail);button.onclick=()=>action(async()=>{await selectWorkspace(space.id);if(active===space.id)originalSwitch('workspace');});list.append(button);
    });
    document.getElementById('workspace-title').textContent=spaces.find(space=>space.id===active)?.name || '團隊工作區';
  }
  function refreshSource(){
    const source=own || local(),options=document.getElementById('share-customer-options');options.replaceChildren();
    if(!source.ninety90.length){const empty=document.createElement('p');empty.textContent='我的事業目前沒有名單';options.append(empty);}
    source.ninety90.forEach(row=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=row.id;label.append(input,document.createTextNode(row.name));options.append(label);});
    document.getElementById('share-include-grid').checked=false;document.getElementById('share-include-organization').checked=false;
  }

  const originalOpen=window.nOpenEdit;
  window.nOpenEdit=id=>{customerBase=copy(window.nGetCustomers().find(row=>row.id===id));originalOpen(id);};
  window.prepareCustomerUpdate=(id,edited)=>{
    if(!id || !customerBase || customerBase.id!==id)return edited;
    const current=window.nGetCustomers().find(row=>row.id===id);
    try{
      if(!current)throw new Error('這筆名單已被刪除，請返回名單重新選擇');
      return merge(customerBase,{...customerBase,...edited},current,'/ninety90/form');
    }catch(error){window.showWPToast('這筆名單已被另一位夥伴修改，請返回名單重新開啟');return null;}
  };
  ['ml-date','ml-title','ml-name','ml-memo'].forEach(id=>{
    document.getElementById(id).addEventListener('input',event=>{localStorage.setItem(id.replace('-','_'),event.target.value);window.triggerCloudSave();});
  });

  return {
    async login(nextUser) {
      ready=false;user=nextUser;generation++;clearTimeout(timer);timer=null;stopList();stopState();active=null;own=null;base=null;remote=null;spaces=[];dirty=false;conflict=false;pendingSnapshot=null;
      // Never carry another account's cached records into a newly authenticated account.
      apply({cells:{},fields:{},mindmap:[],ninety90:[]});
      const snapshot=await getDoc(doc(db,'users',user.uid));
      window.restoreAllData({notebook:{notes:[],nextId:1},reviewData:{goals:{},richLogs:[]},hundredState:{},todoData:[],...(snapshot.exists()?snapshot.data():{})});
      personalSaved=copy(window.collectAllData());
      ready=true;launcher.hidden=false;render();status('✓ 個人資料已載入');
      if(!user.email || !user.emailVerified){status('請使用已驗證的 Google 帳號才能共用');return;}
      stopList=onSnapshot(query(collection(db,'workspaces'),where('memberEmails','array-contains',user.email.toLowerCase())),snapshot=>{
        spaces=snapshot.docs.map(row=>({id:row.id,...row.data()}));
        if(active && !spaces.some(space=>space.id===active)){
          sessionStorage.removeItem(draftKey());discardToPersonal('共用權限已移除，已切回個人資料');
        }
        render();
      },showError);
    },
    flush,
    stop() {ready=false;clearTimeout(timer);timer=null;stopList();stopState();generation++;launcher.hidden=true;}
  };
}
