import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://local').pathname;let body=await readFile(path==='/'?'index.html':'.'+path);
  if(path==='/')body=body.toString().replace(/<script type="module">[\s\S]*?<\/script>/,`<script type="module">import {installCollaboration} from './collaboration.mjs';installCollaboration({api:{}});document.getElementById('login-overlay').style.display='none';window.saved=0;window.triggerCloudSave=()=>window.saved++;window.switchApp('winplus');window.gotoPage('mandala');</script>`);
  res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(body);
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
  for(const mobile of [true,false]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelectorAll('#big-grid textarea').length===81 && window.mandalaViewport);
    await page.locator('#mandala-fit').click();
    const viewport=await page.locator('#mandala-viewport').boundingBox(),grid=await page.locator('#big-grid').boundingBox();
    assert(viewport.width>100 && viewport.height>100);assert(grid.width<=viewport.width+1 && grid.height<=viewport.height+1);
    const fit=await page.evaluate(()=>window.mandalaViewport.scale);await page.locator('#mandala-zoom-in').click();assert((await page.evaluate(()=>window.mandalaViewport.scale))>fit);
    await page.locator('#mandala-original').click();assert.equal(await page.locator('#mandala-zoom-level').textContent(),'100%');
    await page.locator('#mandala-zoom-range').evaluate(input=>{input.value='125';input.dispatchEvent(new Event('input'));});assert.equal(await page.locator('#mandala-zoom-level').textContent(),'125%');
    assert.equal(await page.evaluate(()=>window.saved),0);
    if(mobile){
      const cdp=await context.newCDPSession(page),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id,radiusX:1,radiusY:1,force:1}))});
      const box=await page.locator('#mandala-viewport').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
      await touch('touchStart',[[x-50,y,1],[x+50,y,2]]);await touch('touchMove',[[x-80,y-10,1],[x+80,y+10,2]]);await touch('touchEnd',[]);
      assert((await page.evaluate(()=>window.mandalaViewport.scale))>1.8);assert.equal(await page.locator('#mandala-cell-dialog').isVisible(),false);
      const before=await page.locator('#mandala-viewport').evaluate(node=>node.scrollLeft);
      await touch('touchStart',[[x,y,1]]);await touch('touchMove',[[x+30,y+20,1]]);await touch('touchEnd',[]);
      assert(Math.abs(await page.locator('#mandala-viewport').evaluate(node=>node.scrollLeft)-before+30)<3);
      assert.equal(await page.evaluate(()=>window.saved),0);
      await page.locator('#mandala-fit').click();const cell=await page.locator('#big-grid textarea').first().boundingBox();
      await touch('touchStart',[[cell.x+cell.width/2,cell.y+cell.height/2,1]]);await touch('touchEnd',[]);
      await page.locator('#mandala-cell-text').fill('手機九宮格編輯');await page.locator('#mandala-cell-form [type=submit]').click();
      assert.equal(await page.evaluate(()=>localStorage.getItem('mc-0-0')),'手機九宮格編輯');
      await touch('touchStart',[[cell.x+cell.width/2,cell.y+cell.height/2,1]]);await touch('touchEnd',[]);
      await page.locator('#mandala-cell-text').fill('尚未儲存');await page.evaluate(()=>document.querySelector('#big-grid textarea').value='夥伴已更新');await page.locator('#mandala-cell-form [type=submit]').click();
      assert(await page.locator('#mandala-cell-dialog').isVisible());assert((await page.locator('#mandala-cell-error').textContent()).includes('另一位成員'));await page.locator('#mandala-cell-cancel').click();
      await page.screenshot({path:'test-results/mandala-zoom-mobile.png',fullPage:true});
    }else{
      await page.locator('#mandala-fit').click();await page.locator('#big-grid textarea').first().fill('桌面仍可編輯');assert.equal(await page.evaluate(()=>localStorage.getItem('mc-0-0')),'桌面仍可編輯');
    }
    assert.deepEqual(errors,[]);console.log(`PASS: ${mobile?'mobile pinch, pan, editing and conflict protection':'desktop zoom and editing'}; fit/zoom controls preserve cell data`);await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
