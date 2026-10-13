import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { configure, sidekick } from './two-code-glm-code-fixture.mjs';
const root=`D:/Apps/TwoCode/qa/native-handoff-${Date.now()}`;
const report=root.replace('/qa/','/reports/');
await fs.mkdir(`${root}/data`,{recursive:true});await fs.mkdir(report,{recursive:true});await configure(root);
await fs.writeFile(`${root}/data/preferences.json`,JSON.stringify({dual:true,mode:'yolo',lead:{harness:'step-code',provider:'step-plan',model:'step-5-preview',thinking:'high'},sidekick}));
const env={...process.env,TWO_CODE_BACKGROUND:'1',TWO_CODE_HOME:`${root}/data`,ZCODE_DATA_BASE_DIR:`${root}/data`,ZCODE_DESKTOP_USER_DATA_DIR:`${root}/electron`,ZCODE_DESKTOP_SESSION_DATA_DIR:`${root}/electron/session`,ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT:'1',ZCODE_DESKTOP_APPLICATION_NAME:'Two Code Handoff QA'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:'D:/Apps/TwoCode/releases/0.8.34/win-unpacked/Two Code.exe',args:[],env,timeout:60000});
let task;let refreshed=false;
try {
 const page=await app.firstWindow();await page.getByTestId('two-code-native-session').waitFor({state:'visible',timeout:45000});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];if(w.isFocusable()||w.getBounds().x>-1000)throw Error('Not isolated');w.showInactive();});
 await page.getByTestId('two-code-composer').fill('这是原生界面接入小测试。主手必须调用 sidekick，让副手不使用任何工具，只回复 NATIVE_DELTA_OK。收到后再调用 read_sidekick 读取报告，主手最后回复“校验完成”。不要创建或修改文件。');
 await page.getByTestId('two-code-send').click();
 const start=Date.now();let index=0;
 while(Date.now()-start<120000){
  await new Promise(r=>setTimeout(r,1000));
  const names=await fs.readdir(`${root}/data/tasks`).catch(()=>[]);if(!names.length)continue;
  task=JSON.parse(await fs.readFile(path.join(root,'data/tasks',names[0]),'utf8'));
  const status=await page.getByTestId('two-code-state').getAttribute('data-status').catch(()=>null);
  if(++index%10===0)console.log(JSON.stringify({stage:'running',seconds:Math.round((Date.now()-start)/1000),status,refreshed}));
  const sideText=await page.getByTestId('two-code-sidekick-usage').innerText().catch(()=>'');
  if(!refreshed&&status==='running'&&sideText.includes('未上报')){
   refreshed=true;await page.reload();await page.getByTestId('two-code-native-session').waitFor({state:'visible'});
   await page.locator(`[data-testid*="task-item"][data-testid$="${task.id}"]`).click();
   console.log(JSON.stringify({stage:'renderer-reloaded-during-sidekick'}));
  }
  if(status==='completed'||status==='error'||status==='cancelled')break;
 }
 if(await page.getByTestId('two-code-stop').count()){await page.getByTestId('two-code-stop').click();await page.waitForFunction(()=>document.querySelector('[data-testid="two-code-state"]')?.getAttribute('data-status')!=='running');}
 task=JSON.parse(await fs.readFile(`${root}/data/tasks/${task.id}.json`,'utf8'));
 await fs.writeFile(`${report}/task.json`,JSON.stringify(task,null,2));
 const roles=[...new Set((task.usage??[]).map(u=>u.role))];
 assert.equal(task.status,'completed',task.error);
 assert(task.events.some(e=>e.kind==='handoff'));
 assert(task.events.some(e=>e.kind==='handoff_report'));
 assert.deepEqual(roles.sort(),['lead','sidekick']);
 assert.match(task.lead.lastReport,/校验完成/);
 await page.getByTestId('two-code-sidekick-usage').click();
 await page.getByTestId('two-code-sidekick-usage-panel').waitFor({state:'visible'});
 await page.screenshot({path:`report-sidekick.png`.replace('report-sidekick.png',`${report}/sidekick.png`),animations:'disabled'});
 await page.getByTestId('two-code-sidekick-usage').click();
 await page.reload();await page.locator(`[data-testid*="task-item"][data-testid$="${task.id}"]`).click();
 await page.getByTestId('two-code-lead-usage').waitFor();
 const result={passed:true,refreshedDuringSidekick:refreshed,taskId:task.id,status:task.status,usage:task.usage,elapsedMs:Date.now()-start};
 await fs.writeFile(`${report}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({report,...result}));
}finally{try{await app.close();}finally{await fs.unlink(`${root}/data/model-connections.json`);}}
