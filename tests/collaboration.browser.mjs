import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import assert from 'node:assert/strict';

await mkdir('test-results',{recursive:true});
const bundle=await build({entryPoints:['tests/browser-harness.mjs'],bundle:true,write:false,format:'esm',logLevel:'silent'});
const env=await initializeTestEnvironment({projectId:'demo-winplus',firestore:{host:'127.0.0.1',port:8085,rules:await readFile('firestore.rules','utf8')}});
const personal=who=>({cells:{'mc-0-0':`${who}私人目標`},fields:{},mindmap:[{id:'root',text:`${who}組織`,parentId:null,x:300,y:200}],ninety90:[{id:who==='owner'?1:2,name:`${who}私人名單`,type:'經營者',stage:0,address:'原地址'}],notebook:{notes:[{id:1,title:`${who}私人筆記`,content:'private',updatedAt:1}],nextId:2},reviewData:{goals:{},richLogs:[]},hundredState:{}});
await env.withSecurityRulesDisabled(async context=>{
  await Promise.all(['owner','member'].map(who=>{const data=personal(who);if(who==='owner')data.ninety90.push({id:3,name:'未勾選的私人名單',type:'經營者',stage:0});return setDoc(doc(context.firestore(),`users/${who}`),data);}));
});
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://local').pathname;
    if(path==='/test-harness.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    const target=resolve('.','.'+(path==='/'?'/index.html':path));
    if(!target.startsWith(resolve('.')+'/')){res.writeHead(403).end();return;}
    let body=await readFile(target);
    if(path==='/'||path==='/index.html'){
      body=body.toString().replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'').replace(/<script type="module">[\s\S]*?<\/script>/,'<script type="module" src="/test-harness.js"></script>').replace(/<script src="https:[^>]+><\/script>/g,'');
    }
    res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(target)]||'text/plain');res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const pages=[],errors=[];
try{
  for(const who of ['owner','member']){
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    const page=await context.newPage();pages.push(page);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('https://**/*',route=>route.abort());
    await page.goto(`${url}/?user=${who}`);await page.waitForFunction(()=>window.testReady);
    assert(await page.locator('#open-personal').isVisible());
  }
  const [owner,member]=pages;
  await owner.locator('#open-shared').click();
  await owner.locator('#hub-create').click();
  assert.equal(await owner.locator('#share-customer-options input:checked').count(),0);
  await owner.locator('#share-name').fill('團隊共同名單');
  await owner.locator('#share-customer-options input').first().check();
  await owner.locator('#share-include-grid').check();
  await owner.locator('#share-include-organization').check();
  await owner.locator('#share-create-form button').click();
  await owner.waitForFunction(()=>document.getElementById('share-workspace').value!=='');
  const workspace=await owner.locator('#share-workspace').inputValue();
  await owner.locator('#share-email').fill('MEMBER@gmail.com');await owner.locator('#share-invite-form button').click();
  await member.locator('#open-shared').click();
  await member.locator('#share-launcher').click();
  await member.locator(`#share-workspace option[value="${workspace}"]`).waitFor({state:'attached'});
  await member.locator('#share-workspace').selectOption(workspace);
  await member.waitForFunction(()=>window.nGetCustomers()[0]?.name==='owner私人名單');
  assert.equal(await member.evaluate(()=>window.NotebookApp.notes[0].title),'member私人筆記');
  assert.equal(await member.evaluate(()=>window.nGetCustomers().length),1);
  assert.equal(await member.evaluate(()=>window.nGetCustomers().some(row=>row.id===3)),false);
  console.log('PASS: unchecked private customers are excluded from the shared workspace');
  await Promise.all(pages.map(page=>page.locator('#share-dialog .share-close').click()));

  for(const who of ['member','stranger']){
    const directContext=await browser.newContext();const direct=await directContext.newPage();
    await direct.route('https://**/*',route=>route.abort());
    await direct.goto(`${url}/?user=${who}&noList=1&workspace=${workspace}`);await direct.waitForFunction(()=>window.testReady);
    if(who==='member'){
      assert(await direct.locator('#workspace-view').isVisible());
      assert.equal(await direct.evaluate(()=>window.nGetCustomers()[0]?.name),'owner私人名單');
    }else{
      assert(await direct.locator('#shared-view').isVisible());
      assert((await direct.locator('#hub-message').textContent()).includes('未授予'));
      assert.equal(await direct.evaluate(()=>window.nGetCustomers().length),0);
    }
    await directContext.close();
  }
  console.log('PASS: direct team link works when discovery fails; unauthorized accounts still cannot read it');
  await Promise.all(pages.map(page=>page.locator('#workspace-todos').click()));
  await owner.locator('#team-todo-text-action').fill('團隊拜訪客戶');
  await owner.locator('#team-todo-priority-action').selectOption('red');
  await owner.locator('#team-todo-assignee-action').selectOption('member@gmail.com');
  await owner.locator('#team-todo-form-action [type=submit]').click();
  await member.locator('#team-todo-list-action .todo-item').waitFor();
  assert((await member.locator('#team-todo-list-action .todo-assignee').textContent()).includes('member@gmail.com'));
  assert((await member.locator('#team-todo-list-action .todo-publisher').textContent()).includes('owner@gmail.com'));
  await member.locator('#team-todo-list-action button').filter({hasText:'編輯'}).click();
  await member.locator('#team-todo-text-action').fill('團隊拜訪客戶已安排');
  await member.locator('#team-todo-assignee-action').selectOption('owner@gmail.com');
  await member.locator('#team-todo-form-action [type=submit]').click();
  await owner.waitForFunction(()=>document.querySelector('#team-todo-list-action .todo-item')?.textContent.includes('團隊拜訪客戶已安排'));
  assert((await owner.locator('#team-todo-list-action .todo-publisher').textContent()).includes('owner@gmail.com'));
  assert((await owner.locator('#team-todo-list-action .todo-assignee').textContent()).includes('owner@gmail.com'));
  await member.locator('#team-todo-list-action input[type=checkbox]').check();
  await owner.locator('#team-todo-list-action .todo-done').waitFor();
  await member.locator('#team-todo-text-shopping').fill('採買活動用品');
  await member.locator('#team-todo-assignee-shopping').selectOption('member@gmail.com');
  await member.locator('#team-todo-form-shopping [type=submit]').click();
  await owner.locator('#team-todo-list-shopping .todo-item').waitFor();
  assert((await owner.locator('#team-todo-list-shopping .todo-publisher').textContent()).includes('member@gmail.com'));
  await owner.setViewportSize({width:390,height:844});
  await owner.screenshot({path:'test-results/team-todos-mobile.png',fullPage:true});
  await owner.setViewportSize({width:1280,height:900});
  console.log('PASS: team task assignment, publisher identity, member editing/reassignment, completion and two-way synchronization');

  await owner.evaluate(()=>window.switchApp('winplus'));
  await owner.locator('#big-grid textarea').first().fill('雙向同步目標');
  await member.waitForFunction(()=>localStorage.getItem('mc-0-0')==='雙向同步目標');
  console.log('PASS: Google Email invitation, automatic workspace discovery, private notes, owner → member live update');

  await member.evaluate(()=>{window.switchApp('ninety');window.nOpenNew(0);});
  await member.locator('#nf-name').fill('夥伴新增名單');
  await member.evaluate(()=>window.nSaveCustomer());
  await owner.waitForFunction(()=>window.nGetCustomers().some(row=>row.name==='夥伴新增名單'));
  console.log('PASS: member → owner live customer addition');

  await owner.evaluate(()=>{window.switchApp('winplus');window.gotoPage('mindmap');});
  await owner.locator('.mm-node-text').first().fill('團隊共同組織');
  await member.waitForFunction(()=>window.mmNodes[0]?.text==='團隊共同組織');
  await member.evaluate(()=>window.mmAddChildToSelected());
  await member.evaluate(()=>window.testCollaboration.flush());
  await owner.evaluate(()=>document.activeElement.blur());
  await owner.waitForFunction(()=>window.mmNodes.length===2);
  console.log('PASS: organization node text and additions synchronize in both directions');

  await owner.evaluate(()=>{window.switchApp('ninety');window.nOpenEdit(1);});
  await member.evaluate(()=>window.nOpenEdit(1));
  await member.locator('#nf-address').fill('夥伴改的新地址');await member.evaluate(()=>window.nSaveCustomer());
  await owner.waitForFunction(()=>window.nGetCustomers().find(row=>row.id===1).address==='夥伴改的新地址');
  await owner.locator('#nf-name').fill('擁有者改的新名字');await owner.evaluate(()=>window.nSaveCustomer());
  await member.waitForFunction(()=>window.nGetCustomers().find(row=>row.id===1).name==='擁有者改的新名字');
  assert.equal(await member.evaluate(()=>window.nGetCustomers().find(row=>row.id===1).address),'夥伴改的新地址');
  console.log('PASS: stale open forms merge independent fields');

  // Both users modify one field against the same baseline while offline.
  await Promise.all(pages.map(page=>page.evaluate(()=>window.testCollaboration.flush())));
  await member.evaluate(()=>window.testOffline());
  await member.evaluate(()=>{window.switchApp('winplus');document.querySelector('#big-grid textarea').value='離線修改';document.querySelector('#big-grid textarea').dispatchEvent(new Event('input'));});
  await owner.evaluate(()=>{window.switchApp('winplus');window.gotoPage('mandala');});
  await owner.locator('#big-grid textarea').first().fill('線上夥伴修改');
  await owner.evaluate(()=>window.testCollaboration.flush());
  await member.evaluate(()=>window.testOnline());
  await member.waitForFunction(()=>document.getElementById('share-error').textContent.includes('相同欄位'));
  assert.equal(await member.evaluate(()=>localStorage.getItem('mc-0-0')),'離線修改');
  await member.locator('#share-launcher').click();await member.locator('#share-reload').click();
  await member.waitForFunction(()=>localStorage.getItem('mc-0-0')==='線上夥伴修改');
  console.log('PASS: offline edits preserved; same-field conflict shown; explicit reload resolves conflict');

  await member.locator('#share-workspace').selectOption('');
  await member.waitForFunction(()=>window.nGetCustomers()[0]?.name==='member私人名單');
  assert.equal(await member.evaluate(()=>localStorage.getItem('mc-0-0')),'member私人目標');
  assert(await member.locator('#personal-view').isVisible());
  let memberData;
  await env.withSecurityRulesDisabled(async context=>{memberData=(await getDoc(doc(context.firestore(),'users/member'))).data();});
  assert.equal(memberData.ninety90.length,1);assert.equal(memberData.cells['mc-0-0'],'member私人目標');
  console.log('PASS: workspace switching restores personal data; shared records never overwrite private account');

  await member.locator('#share-dialog .share-close').click();
  await member.locator('.todo-card').click();
  for(const [category,title,priority] of [['action','聯絡客戶','red'],['shopping','買筆記本','yellow'],['action','整理文件','blue']]){
    await member.locator(`#todo-text-${category}`).fill(title);
    await member.locator(`#todo-priority-${category}`).selectOption(priority);
    await member.locator(`#todo-form-${category} [type=submit]`).click();
  }
  assert.equal(await member.locator('.todo-item').count(),3);
  await member.locator('#todo-list-action .todo-red button').filter({hasText:'編輯'}).click();
  await member.locator('#todo-text-action').fill('聯絡客戶安排拜訪');
  await member.locator('#todo-form-action [type=submit]').click();
  await member.locator('#todo-list-action .todo-red input').check();
  assert.equal(await member.locator('.todo-done').count(),1);
  await member.locator('#todo-list-action .todo-blue button').filter({hasText:'刪除'}).click();
  assert.equal(await member.locator('.todo-item').count(),2);
  await member.evaluate(()=>window.testCollaboration.flush());
  await env.withSecurityRulesDisabled(async context=>{
    const privateData=(await getDoc(doc(context.firestore(),'users/member'))).data();
    const sharedData=(await getDoc(doc(context.firestore(),`workspaces/${workspace}/content/state`))).data();
    assert.equal(privateData.todoData.length,2);
    assert.equal(sharedData.data.todoData,undefined);
  });
  await member.setViewportSize({width:390,height:844});
  assert(await member.evaluate(()=>[...document.querySelectorAll('.todo-panel')].every(panel=>panel.getBoundingClientRect().right<=innerWidth)));
  await member.screenshot({path:'test-results/todos-mobile.png',fullPage:true});
  await member.goto(`${url}/?user=member`);await member.waitForFunction(()=>window.testReady);
  await member.locator('#open-personal').click();await member.locator('.todo-card').click();
  assert.equal(await member.locator('.todo-item').count(),2);
  assert.equal(await member.locator('.todo-done').count(),1);
  console.log('PASS: private to-do action/shopping colors, edit, completion, delete, cloud persistence, reload and mobile layout');
  await member.evaluate(()=>window.openDataHome());await member.locator('#open-shared').click();await member.locator('#share-launcher').click();
  await member.locator('#share-workspace').selectOption(workspace);
  await member.waitForFunction(()=>window.nGetCustomers().length===2);
  await owner.evaluate(()=>window.switchApp('workspace'));
  await owner.locator('#workspace-add-private').click();
  await owner.locator('#share-customer-options input[value="3"]').check();
  await owner.locator('#share-create-form button').click();
  await member.waitForFunction(()=>window.nGetCustomers().some(row=>row.id===3));
  assert.equal(await member.evaluate(()=>window.nGetCustomers().find(row=>row.id===1).name),'擁有者改的新名字');
  assert.equal(await member.evaluate(()=>window.nGetCustomers().find(row=>row.id===1).address),'夥伴改的新地址');
  assert((await owner.locator('#workspace-summary').textContent()).includes('名單 3 位'));
  console.log('PASS: owner adds selected private data to an existing workspace; recipient receives it without overwriting team edits');
  await owner.locator('#share-launcher').click();await owner.locator('#share-members button').click();
  await member.waitForFunction(()=>document.getElementById('share-workspace').value==='');
  assert.equal(await member.evaluate(()=>window.nGetCustomers()[0].name),'member私人名單');
  console.log('PASS: removing membership immediately switches the recipient back to private data');
  await owner.setViewportSize({width:390,height:844});
  assert(await owner.evaluate(()=>document.getElementById('share-dialog').getBoundingClientRect().width<=window.innerWidth));
  await owner.screenshot({path:'test-results/sharing-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile dialog fits viewport; no browser JavaScript errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await env.cleanup();}
