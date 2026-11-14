import {installMindmapViewport} from './mindmap-viewport.mjs';
import {installTeamTodos} from './team-todos.mjs';
import {installTodos} from './todos.mjs';
import {copy, equal, sharedPart, merge, validateShared, selectSharedData, addSelectedData} from './shared-data.mjs';

// Firebase is injected so the collaboration lifecycle can also be tested offline.
export function installCollaboration({db, auth, api}) {
  const {doc, collection, query, where, onSnapshot, getDoc, getDocFromServer, setDoc, runTransaction, serverTimestamp, getDocsFromServer, writeBatch, limit} = api;
  let user = null, active = null, own = null, base = null, remote = null, activeMeta = null;
  let stopList = () => {}, stopState = () => {}, spaces = [], ready = false;
  let spacesLoaded=false,listError='',hubActionError='';
  let memberSpaces=[],pendingSpaces=[];
  let timer, saving = null, dirty = false, conflict = false, generation = 0, pendingSnapshot = null;
  let ownCommit = null, actionBusy = false, deletionPending = false;
  let customerBase = null, personalSave = Promise.resolve(), personalSaved = null;
  const status = text => { document.getElementById('share-status').textContent = text; document.querySelectorAll('.cloud-status').forEach(element=>element.textContent=text); };
  const errorText = error => error.code === 'permission-denied' ? '沒有共用權限，或 Firebase 共用規則尚未設定。' : error.message || '連線失敗，請稍後重試';
  const draftKey = () => `winplus-draft:${user.uid}:${active}`;
  const stateRef = id => doc(db, 'workspaces', id, 'content', 'state');
  const metaRef = id => doc(db, 'workspaces', id);
  const local = () => sharedPart(window.collectAllData());
  const showError = error => {
    status(`⚠ ${errorText(error)}`);
    hubActionError=errorText(error);
    renderHub();
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
    updateWorkspaceSummary(data);
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
    hubActionError='';
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
  document.addEventListener('mm-gesture-end',()=>{if(pendingSnapshot){const next=pendingSnapshot;pendingSnapshot=null;receive(next.data,next.acknowledged);}});

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
    if(timer || saving || dirty || personalDirty || deletionPending){event.preventDefault();event.returnValue='';}
  });
  window.addEventListener('online',()=>flush().catch(()=>{}));

  function render() {
    renderHub();
    document.body.dataset.dataScope=active?'shared':'personal';
    document.getElementById('scope-banner').textContent=active?'團隊工作區 · '+(spaces.find(space=>space.id===active)?.name || '')+' · 成員共同編輯':'我的事業 · 僅自己可見';
    const select=document.getElementById('share-workspace'); select.replaceChildren(new Option('我的個人資料',''));
    spaces.forEach(space=>select.add(new Option(space.name,space.id)));
    if(activeMeta && activeMeta.id===active && !spaces.some(space=>space.id===active))select.add(new Option(activeMeta.name,active));
    select.value=active || '';
    const current=spaces.find(space=>space.id===active) || (activeMeta?.id===active?activeMeta:null);
    if(current)activeMeta=current;
    teamTodos.setContext(active && user ? {id:active,user,members:current?.memberEmails || []} : null);
    document.getElementById('workspace-add-private').hidden=!current || current.ownerUid!==user?.uid;
    if(active)updateWorkspaceSummary(local());
    document.getElementById('share-current').textContent=current ? current.name : '我的個人資料';
    document.getElementById('share-launcher').dataset.shared=String(!!active);
    document.getElementById('share-members').replaceChildren();
    document.getElementById('share-invite-form').hidden=!current || current.ownerUid!==user?.uid;
    document.getElementById('share-member-heading').hidden=!current;
    if(current) [...current.memberEmails,...(current.invitedEmails || [])].forEach(email=>{
      const row=document.createElement('li');const label=document.createElement('span');label.textContent=email+(email===current.ownerEmail?'（擁有者）':current.memberEmails.includes(email)?'（已接受・共同編輯）':'（等待對方確認）');row.append(label);
      if(current.ownerUid===user.uid && email!==current.ownerEmail){
        const button=document.createElement('button');button.textContent=current.memberEmails.includes(email)?'移除共用':'取消邀請';button.type='button';
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
    clearTimeout(timer);timer=null; generation++;stopState();active=null;activeMeta=null;base=null;remote=null;pendingSnapshot=null;ownCommit=null;dirty=false;conflict=false;
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
    activeMeta=id?(spaces.find(space=>space.id===id) || activeMeta):null;
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
      const members=new Set(data.memberEmails),invited=new Set(data.invitedEmails || []);
      if(add){if(members.has(email))throw new Error('此帳號已接受共用；如需重新確認，請先移除後再邀請');invited.add(email);}else{members.delete(email);invited.delete(email);}
      if(members.size+invited.size>30)throw new Error('每個工作區最多 30 個共用帳號');
      transaction.update(ref,{memberEmails:[...members],invitedEmails:[...invited]});
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
    <form id="share-invite-form" hidden><label for="share-email">指定對方的 Google 帳號 Email</label><div class="share-row"><input type="email" id="share-email" placeholder="name@gmail.com" required><button>送出共用邀請</button></div><p class="share-note">成員可以查看、編輯和刪除工作區資料；只有擁有者能新增或移除共用成員。對方須在團隊工作區接受邀請後才可查看與編輯，此操作不寄送 Email。</p></form>
    <p id="share-error" role="alert"></p><button id="share-retry" hidden>重試同步</button> <button id="share-reload" hidden>放棄未同步修改，載入最新資料</button>`;
  document.body.append(dialog);
  launcher.onclick=()=>{render();refreshSource();sourceMode('create');if(!dialog.open)dialog.showModal();};
  document.getElementById('share-workspace').onchange=event=>action(()=>selectWorkspace(event.target.value));
  document.getElementById('share-create-form').onsubmit=event=>{
    event.preventDefault();action(async()=>{
      await flush();const appending=document.getElementById('share-create-form').dataset.mode==='append';
      const name=document.getElementById('share-name').value.trim();if(!appending && !name)throw new Error('請填寫工作區名稱');
      const data=selectSharedData(own || local(),{customerIds:[...document.querySelectorAll('#share-customer-options input:checked')].map(input=>Number(input.value)),includeGrid:document.getElementById('share-include-grid').checked,includeOrganization:document.getElementById('share-include-organization').checked}),ref=doc(collection(db,'workspaces'));
      if(appending){
        if(!active || spaces.find(space=>space.id===active)?.ownerUid!==user.uid)throw new Error('只有工作區擁有者能從此入口加入私人資料');
        await runTransaction(db,async transaction=>{
          const target=stateRef(active),snapshot=await transaction.get(target);
          if(!snapshot.exists())throw new Error('團隊工作區不存在');
          transaction.set(target,{data:addSelectedData(sharedPart(snapshot.data().data),data),updatedAt:serverTimestamp(),updatedBy:user.uid});
        });
        const snapshot=await getDoc(stateRef(active));receive(snapshot.data().data);
        refreshSource();status('✓ 選取資料已加入，團隊原有內容保留');dialog.close();originalSwitch('workspace');return;
      }
      if(!data.ninety90.length && !data.mindmap.length && !Object.keys(data.cells).length && !Object.keys(data.fields).length && !confirm('你尚未勾選私人資料，將建立空白團隊工作區。確定建立？'))return;
      await runTransaction(db,async transaction=>{
        transaction.set(ref,{name,ownerUid:user.uid,ownerEmail:user.email.toLowerCase(),memberEmails:[user.email.toLowerCase()],invitedEmails:[],createdAt:serverTimestamp()});
        transaction.set(stateRef(ref.id),{data,updatedBy:user.uid,updatedAt:serverTimestamp()});
      });
      // Query listeners may not have emitted the new workspace yet.
      if(!spaces.some(space=>space.id===ref.id))spaces.push({id:ref.id,name,ownerUid:user.uid,ownerEmail:user.email.toLowerCase(),memberEmails:[user.email.toLowerCase()]});
      await selectWorkspace(ref.id);document.getElementById('share-create-form').reset();refreshSource();
    });
  };
  document.getElementById('share-invite-form').onsubmit=event=>{
    event.preventDefault();action(async()=>{const email=document.getElementById('share-email').value.trim().toLowerCase();await changeMember(email,true);document.getElementById('share-email').value='';status('✓ 邀請已送出，等待對方在團隊工作區確認');});
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
    if(banner){if(id==='workspace')workspace.prepend(banner);else if(['todos','team-todos'].includes(id))document.getElementById(id+'-view').prepend(banner);else document.body.prepend(banner);}
    navigate(id,...args);
    if(id==='team-todos')teamTodos.open();
  };
  const home=document.getElementById('home-view');
  const personal=document.createElement('section');personal.id='personal-view';personal.className='app-view data-hub';
  personal.innerHTML='<button class="data-home">← 資料首頁</button><h1>🚀 我的事業</h1><p>這裡的名單、組織網與成長紀錄僅自己可見。</p>';
  personal.append(home.querySelector('main.container'));document.body.append(personal);
  installTodos(personal);
  installMindmapViewport();
  const doors=document.createElement('div');doors.className='data-doors';
  doors.innerHTML='<button id="open-personal"><strong>🚀 我的事業</strong><span>私人名單、組織網與成長紀錄</span></button><button id="open-shared"><strong>📓 團隊工作區</strong><span>與指定 Google 帳號共同查看、編輯</span></button>';
  home.querySelector('header').after(doors);
  const hub=document.createElement('section');hub.id='shared-view';hub.className='app-view data-hub';
  hub.innerHTML='<button class="data-home">← 資料首頁</button><h1>📓 團隊工作區</h1><p>選擇工作區後，變更會同步給該區所有成員。</p><p id="hub-account"></p><p id="hub-message" role="status" aria-live="polite"></p><button id="hub-refresh">重新整理工作區</button> <button id="hub-create">建立團隊工作區</button><section id="pending-invitations"><h2>📬 待確認邀請</h2><p>接受後才會開始共用與同步資料。</p><div id="pending-invitation-list"></div></section><h2>已加入的團隊</h2><div id="workspace-list"></div>';
  document.body.append(hub);
  const workspace=document.createElement('section');workspace.id='workspace-view';workspace.className='app-view data-hub';
  workspace.innerHTML='<button id="back-shared">← 團隊工作區列表</button> <button id="workspace-share-members">👥 共用成員</button><h1 id="workspace-title"></h1><p>共用成員可以共同查看與編輯這裡的資料。</p><p id="workspace-summary"></p><p id="workspace-empty" hidden>此工作區目前沒有名單、九宮格或組織網資料。私人內容不會自動共用，請擁有者選擇資料加入。</p><button id="workspace-add-private" hidden>＋ 從我的事業加入資料</button><div class="data-doors"><button id="workspace-customers">👥 名單</button><button id="workspace-grid">🔲 九宮格</button><button id="workspace-organization">🕸️ 組織網</button><button id="workspace-todos">📝 團隊待辦</button></div>';
  document.body.append(workspace);
  const teamTodos=installTeamTodos({db,api});
  const banner=document.createElement('div');banner.id='scope-banner';banner.setAttribute('role','status');document.body.prepend(banner);
  window.openDataHome=()=>originalSwitch('home');
  window.switchApp=(id,...args)=>{
    if(id==='home')id=active?'workspace':'personal';
    if(id==='team-todos' && !active)return;
    if(active && ['review','hundred','todos'].includes(id))return;
    originalSwitch(id,...args);
  };
  document.querySelectorAll('.data-home').forEach(button=>button.onclick=window.openDataHome);
  document.getElementById('open-personal').onclick=()=>action(async()=>{await selectWorkspace('');if(!active)originalSwitch('personal');});
  document.getElementById('open-shared').onclick=()=>{renderHub();originalSwitch('shared');};
  document.getElementById('back-shared').onclick=()=>originalSwitch('shared');
  document.getElementById('hub-create').onclick=launcher.onclick;
  document.getElementById('workspace-share-members').onclick=launcher.onclick;
  document.getElementById('hub-refresh').onclick=()=>listenWorkspaces();
  document.getElementById('workspace-add-private').onclick=()=>{launcher.onclick();sourceMode('append');document.getElementById('share-create-form').scrollIntoView({block:'start'});};
  document.getElementById('workspace-todos').onclick=()=>window.switchApp('team-todos');
  document.getElementById('workspace-customers').onclick=()=>window.switchApp('ninety');
  document.getElementById('workspace-grid').onclick=()=>{window.switchApp('winplus');window.gotoPage('mandala');};
  document.getElementById('workspace-organization').onclick=()=>{window.switchApp('winplus');window.gotoPage('mindmap');};
  function renderHub(){
    const list=document.getElementById('workspace-list');if(!list)return;
    list.replaceChildren();
    document.getElementById('hub-account').textContent=user?.email?'目前登入的 Google 帳號：'+user.email:'';
    document.getElementById('hub-message').textContent=hubActionError || listError || (spacesLoaded?'已加入 '+spaces.length+' 個團隊工作區；'+pendingSpaces.length+' 個待確認邀請':'正在確認此帳號的共用邀請…');
    const inbox=document.getElementById('pending-invitation-list');inbox.replaceChildren();
    if(!pendingSpaces.length){const empty=document.createElement('p');empty.textContent=spacesLoaded?'目前沒有待確認邀請':'正在載入邀請…';inbox.append(empty);}
    pendingSpaces.forEach(space=>{
      const row=document.createElement('article');row.className='workspace-invitation';
      const heading=document.createElement('h3');heading.textContent=space.name;
      const sender=document.createElement('p');sender.textContent='邀請者：'+space.ownerEmail+' · 邀請帳號：'+user.email;
      const accept=document.createElement('button');accept.type='button';accept.textContent='接受共用';accept.onclick=()=>action(()=>respondInvitation(space.id,true));
      const decline=document.createElement('button');decline.type='button';decline.textContent='婉拒';decline.onclick=()=>action(()=>respondInvitation(space.id,false));
      row.append(heading,sender,accept,decline);inbox.append(row);
    });
    if(!spaces.length && spacesLoaded){const empty=document.createElement('p');empty.textContent='目前沒有團隊工作區。你可以建立一個，或請對方將你的 Google Email 加入共用。';list.append(empty);}
    spaces.forEach(space=>{
      const button=document.createElement('button');button.className='workspace-card';
      const title=document.createElement('strong');title.textContent=space.name;
      const detail=document.createElement('span');detail.textContent=`${space.ownerUid===user?.uid?'我建立的':'受邀共用'} · ${space.memberEmails.length} 位成員`;
      button.append(title,detail);button.disabled=!!space.deleting;button.onclick=()=>action(async()=>{await selectWorkspace(space.id);if(active===space.id)originalSwitch('workspace');});
      const entry=document.createElement('article');entry.className='workspace-entry';entry.append(button);
      if(space.ownerUid===user?.uid){
        const remove=document.createElement('button');remove.className='workspace-delete';remove.type='button';
        const empty=space.memberEmails.length===1 && !(space.invitedEmails || []).length;
        remove.textContent=space.deleting?'繼續刪除工作區':'🗑️ 刪除團隊工作區';remove.disabled=!empty;
        remove.onclick=()=>action(()=>deleteWorkspace(space));entry.append(remove);
        if(!empty){const hint=document.createElement('small');hint.textContent='先移除其他成員與待確認邀請，才能刪除工作區';entry.append(hint);}
      }
      list.append(entry);
    });
    document.getElementById('workspace-title').textContent=spaces.find(space=>space.id===active)?.name || '團隊工作區';
  }
  async function deleteWorkspace(space){
    if(!confirm(`確定永久刪除「${space.name}」及其中的共用名單、九宮格、組織網和團隊待辦？此操作無法復原；「我的事業」的私人資料會保留。`))return;
    await flush();
    if(active===space.id)discardToPersonal('準備刪除團隊工作區');
    originalSwitch('shared');deletionPending=true;
    try{
      await runTransaction(db,async transaction=>{
        const ref=metaRef(space.id),snapshot=await transaction.get(ref);
        if(!snapshot.exists())throw new Error('工作區已被刪除，請重新整理');
        const data=snapshot.data();
        if(data.ownerUid!==user.uid || data.memberEmails.length!==1 || (data.invitedEmails || []).length)throw new Error('請先移除其他共用成員與待確認邀請');
        transaction.update(ref,{deleting:true});
      });
      while(true){
        const tasks=await getDocsFromServer(query(collection(db,'workspaces',space.id,'tasks'),limit(400)));
        if(tasks.empty)break;
        const batch=writeBatch(db);tasks.docs.forEach(task=>batch.delete(task.ref));await batch.commit();status('正在清除團隊待辦…');
      }
      const batch=writeBatch(db);batch.delete(stateRef(space.id));batch.delete(metaRef(space.id));await batch.commit();
      memberSpaces=memberSpaces.filter(item=>item.id!==space.id);spaces=memberSpaces;render();status('✓ 團隊工作區已刪除，私人資料保留');
    }finally{deletionPending=false;}
  }
  function updateWorkspaceSummary(data){
    const summary=document.getElementById('workspace-summary');if(!summary)return;
    const cells=Object.values(data.cells || {}).filter(value=>String(value).trim()).length;
    summary.textContent=`名單 ${data.ninety90.length} 位 · 九宮格 ${cells} 格 · 組織網 ${data.mindmap.length} 個節點`;
    document.getElementById('workspace-empty').hidden=!!(data.ninety90.length || cells || data.mindmap.length);
  }
  function sourceMode(mode){
    const form=document.getElementById('share-create-form'),name=document.getElementById('share-name');
    form.dataset.mode=mode;name.hidden=mode==='append';name.disabled=mode==='append';
    document.querySelector('label[for="share-name"]').hidden=mode==='append';
    form.querySelector('button').textContent=mode==='append'?'加入選取資料（保留團隊已有內容）':'建立團隊工作區';
  }
  async function respondInvitation(id,accept){
    const accepted=await runTransaction(db,async transaction=>{
      const ref=metaRef(id),snapshot=await transaction.get(ref),data=snapshot.data(),email=user.email.toLowerCase();
      if(!data || !(data.invitedEmails || []).includes(email))throw new Error('邀請已取消或已處理，請重新整理工作區');
      const next={...data,invitedEmails:data.invitedEmails.filter(value=>value!==email),memberEmails:accept?[...data.memberEmails,email]:data.memberEmails};
      transaction.update(ref,{invitedEmails:next.invitedEmails,memberEmails:next.memberEmails});return {id,...next};
    });
    pendingSpaces=pendingSpaces.filter(space=>space.id!==id);
    if(accept){memberSpaces=memberSpaces.filter(space=>space.id!==id);memberSpaces.push(accepted);spaces=memberSpaces;render();await selectWorkspace(id);status('✓ 已接受共用，開始同步團隊資料');}
    else{render();status('已婉拒共用邀請');}
  }
  function listenWorkspaces(){
    if(!user || !ready)return;
    stopList();spacesLoaded=false;listError='';hubActionError='';render();
    let membersReady=false,invitationsReady=false;
    const update=()=>{spaces=memberSpaces;spacesLoaded=membersReady && invitationsReady;render();};
    const failure=error=>{listError=errorText(error);showError(error);render();};
    const membersStop=onSnapshot(query(collection(db,'workspaces'),where('memberEmails','array-contains',user.email.toLowerCase())),{includeMetadataChanges:true},snapshot=>{
      membersReady=!snapshot.metadata.fromCache;memberSpaces=snapshot.docs.map(row=>({id:row.id,...row.data()}));update();
      if(active && membersReady && !memberSpaces.some(space=>space.id===active)){
        const id=active,version=generation;
        getDocFromServer(metaRef(id)).then(metadata=>{
          if(version!==generation || id!==active)return;
          if(!metadata.exists() || !metadata.data().memberEmails.includes(user.email.toLowerCase())){sessionStorage.removeItem(draftKey());discardToPersonal('共用權限已移除，已切回個人資料');}
        }).catch(error=>{if(version!==generation || id!==active)return;if(error.code==='permission-denied'){sessionStorage.removeItem(draftKey());discardToPersonal('共用權限已移除，已切回個人資料');}else showError(error);});
      }
    },failure);
    const invitationsStop=onSnapshot(query(collection(db,'workspaces'),where('invitedEmails','array-contains',user.email.toLowerCase())),{includeMetadataChanges:true},snapshot=>{
      invitationsReady=!snapshot.metadata.fromCache;pendingSpaces=snapshot.docs.map(row=>({id:row.id,...row.data()}));update();
    },failure);
    stopList=()=>{membersStop();invitationsStop();};
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
      teamTodos.stop();
      ready=false;spacesLoaded=false;memberSpaces=[];pendingSpaces=[];listError='';hubActionError='';user=nextUser;generation++;clearTimeout(timer);timer=null;stopList();stopState();active=null;activeMeta=null;own=null;base=null;remote=null;spaces=[];dirty=false;conflict=false;pendingSnapshot=null;
      // Never carry another account's cached records into a newly authenticated account.
      apply({cells:{},fields:{},mindmap:[],ninety90:[]});
      const snapshot=await getDoc(doc(db,'users',user.uid));
      window.restoreAllData({notebook:{notes:[],nextId:1},reviewData:{goals:{},richLogs:[]},hundredState:{},todoData:[],...(snapshot.exists()?snapshot.data():{})});
      personalSaved=copy(window.collectAllData());
      ready=true;launcher.hidden=false;render();status('✓ 個人資料已載入');
      if(!user.email || !user.emailVerified){listError='請使用已驗證的 Google 帳號才能共用';render();status(listError);return;}
      listenWorkspaces();
    },
    flush,
    stop() {teamTodos.stop();ready=false;clearTimeout(timer);timer=null;stopList();stopState();generation++;launcher.hidden=true;}
  };
}
