import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://local').pathname;
    let body=await readFile(path==='/'?'index.html':'.'+path);
    if(path==='/')body=body.toString().replace(/<script type="module">[\s\S]*?<\/script>/,`<script type="module">
      import {installCollaboration} from './collaboration.mjs';installCollaboration({api:{}});
      document.getElementById('login-overlay').style.display='none';document.body.dataset.dataScope='personal';
      window.mobileSaveCount=0;window.triggerCloudSave=()=>window.mobileSaveCount++;
      localStorage.setItem('mm_nodes',JSON.stringify([{id:'root',text:'手機上的核心目標',x:1500,y:900,parentId:null},{id:'child',text:'遠處的夥伴',x:2600,y:1450,parentId:'root'}]));
      window.switchApp('winplus');window.gotoPage('mindmap');
    </script>`);
    res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>route.abort());await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#mm-fit').waitFor();await page.locator('#mm-fit').click();
  const before=await page.evaluate(()=>JSON.stringify(window.mmNodes));
  const viewport=await page.locator('#page-mindmap').boundingBox();
  for(const node of await page.locator('.mm-node').all()){
    const rect=await node.boundingBox();assert(rect.x>=viewport.x && rect.x+rect.width<=viewport.x+viewport.width);
    assert(rect.y>=viewport.y && rect.y+rect.height<viewport.y+viewport.height);
  }
  const cdp=await context.newCDPSession(page);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id,radiusX:1,radiusY:1,force:1}))});
  const first=await page.evaluate(()=>({...window.mmViewport}));
  await touch('touchStart',[[100,240,1]]);await touch('touchMove',[[160,320,1]]);await touch('touchEnd',[]);
  const panned=await page.evaluate(()=>({...window.mmViewport}));assert(Math.abs(panned.x-first.x-60)<2);assert(Math.abs(panned.y-first.y-80)<2);
  await touch('touchStart',[[100,310,1],[220,310,2]]);await touch('touchMove',[[60,290,1],[270,330,2]]);await touch('touchEnd',[]);
  assert((await page.evaluate(()=>window.mmViewport.scale))>panned.scale*1.5);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.mmNodes)),before);assert.equal(await page.evaluate(()=>window.mobileSaveCount),0);
  console.log('PASS: off-screen nodes fit on mobile; real one-finger pan and two-finger pinch do not mutate saved nodes');
  await page.locator('#mm-fit').click();const oldScale=await page.evaluate(()=>window.mmViewport.scale);
  await page.locator('#mm-zoom-in').click();assert((await page.evaluate(()=>window.mmViewport.scale))>oldScale);
  await page.locator('#mm-fit').click();await page.locator('#mm-move-mode').click();
  const root=page.locator('.mm-node[data-node-id="root"]'),box=await root.boundingBox();
  const scale=await page.evaluate(()=>window.mmViewport.scale),oldX=await page.evaluate(()=>window.mmNodes[0].x);
  await touch('touchStart',[[box.x+box.width/2,box.y+box.height/2,1]]);
  await touch('touchMove',[[box.x+box.width/2+35,box.y+box.height/2+15,1]]);await touch('touchEnd',[]);
  assert(Math.abs(await page.evaluate(()=>window.mmNodes[0].x)-oldX-35/scale)<3);
  await page.locator('#mm-fit').click();await page.locator('#mm-edit-selected').click();
  await root.locator('.mm-node-text').fill('手機修改成功');await page.locator('#mm-fit').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mm_nodes'))[0].text),'手機修改成功');
  console.log('PASS: node drag accounts for zoom; selected node text can be edited and saved on touch screens');
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.locator('#mm-fit').click();
    const toolbar=await page.locator('.mm-toolbar').boundingBox();assert(toolbar.x>=0 && toolbar.x+toolbar.width<=width);assert(toolbar.y>400);assert.equal(await page.locator("#nav").evaluate(node=>node.clientHeight),96);
    for(const button of await page.locator('#nav .tab-btn:visible').all()){
      const box=await button.boundingBox();assert(box.x>=0 && box.x+box.width<=width);assert(box.y+box.height<=96);
    }
  }
  await page.screenshot({path:'test-results/mindmap-mobile.png',fullPage:true});
  await page.evaluate(()=>window.gotoPage('mandala'));await page.locator('#mandala-original').click();assert(await page.evaluate(()=>document.getElementById('mandala-viewport').scrollWidth>document.getElementById('mandala-viewport').clientWidth));
  console.log('PASS: navigation and graph toolbar fit 320–430px; mandala stays readable with horizontal scrolling');
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
