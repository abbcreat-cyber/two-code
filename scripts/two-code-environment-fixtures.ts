import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

export type EnvironmentCase = "visual" | "browser" | "android" | "vm";
export async function createEnvironmentFixture(name: EnvironmentCase, cwd: string) {
  await fs.mkdir(`${cwd}/src`, { recursive: true });
  const playwright = pathToFileURL(createRequire(import.meta.url).resolve("playwright-core")).href;
  const stages: Array<{ id: string; brief: string }> = [];
  let body = "";
  if (name === "visual" || name === "browser") {
    body += `const playwrightModule=await import(${JSON.stringify(playwright)});
const {chromium}=playwrightModule.default ?? playwrightModule;
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
const page=await browser.newPage({viewport:{width:600,height:400}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
await page.goto(pathToFileURL(path.join(cwd,'src/index.html')).href);
`;
  }
  if (name === "visual") {
    await fs.writeFile(
      `${cwd}/reference.png`,
      new Resvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#f1f5f9"/><rect x="80" y="80" width="440" height="240" rx="20" fill="white"/><circle cx="140" cy="160" r="25" fill="#2563eb"/><text x="200" y="170" font-size="32" font-family="Arial" fill="#0f172a">READY 4826</text><rect x="200" y="220" width="240" height="40" rx="8" fill="#16a34a"/></svg>',
      )
        .render()
        .asPng(),
    );
    await fs.writeFile(
      `${cwd}/src/index.html`,
      '<!doctype html><html><body style="background:#fff"><main id="card"><span id="dot">?</span><h1 id="title">WAIT 0000</h1><div id="bar"></div></main></body></html>',
    );
    stages.push({
      id: "all",
      brief:
        "视觉小任务：主手和副手必须分别用view_image看reference.png。把src/index.html修成参考图，保留card/dot/title/bar四个id，600x400画布，卡片左上80,80，440x240。图里的文字、圆点和横条颜色请实际看图确认；不要读取图片二进制或用OCR。完成验证后，主手和副手分别用view_image看actual.png，给出对照结果。",
    });
    body += `assert.equal(await page.locator('#title').innerText(),'READY 4826');
const box=await page.locator('#card').boundingBox();
for(const [key,value] of Object.entries({x:80,y:80,width:440,height:240})) assert(Math.abs(box[key]-value)<2,key);
const colors=await page.evaluate(()=>['dot','bar'].map(id=>getComputedStyle(document.getElementById(id)).backgroundColor));
const [blue,green]=colors.map(v=>v.match(/\\d+/g).map(Number));
assert(blue[2]>150 && blue[2]>blue[0]+80 && blue[2]>blue[1]+40);
assert(green[1]>100 && green[1]>green[0]+50 && green[1]>green[2]+40);
await page.screenshot({path:path.join(cwd,'actual.png')});
`;
  } else if (name === "browser") {
    const interfaceText =
      "无依赖本地便签页src/index.html，input#text、button#add、ul#notes，每条li包含文本、button[data-action=toggle]和button[data-action=delete]，完成条目加data-done=true。所有用户文字用文本节点。另写src/exercise.mjs导出async exercise(page)，通过Playwright给空页输入浏览器试写并点击添加、切换完成，然后返回{count:1,done:true}；必须实际用page浏览器API。";
    stages.push({
      id: "core",
      brief: `浏览器连续开发第一阶段：${interfaceText} 做添加、完成、删除和空文本拒绝；运行真实无头浏览器验收。`,
    });
    stages.push({
      id: "persist",
      brief:
        "第二阶段：同一项目和副手继续。增加localStorage键two-code-notes的持久化（数组，每项{text,done}），添加select#filter，值all/active/done，刷新后数据保持；筛选只影响显示。保留前阶段接口和exercise。",
    });
    stages.push({
      id: "robust",
      brief:
        "第三阶段：损坏JSON/错误存储结构应恢复为空并可继续使用；恶意HTML作为纯文本显示。390px手机宽度不横向溢出。保留CRUD/持久化/筛选，并写README说明用法与验收。完成真实回归后，两角色用view_image看actual.png；此轮不改之前已通过行为。",
    });
    body += `await page.evaluate(()=>localStorage.clear()); await page.reload();
const {exercise}=await import(pathToFileURL(path.join(cwd,'src/exercise.mjs')).href+'?t='+Date.now());
assert.deepEqual(await exercise(page),{count:1,done:true});
assert.equal(await page.locator('#notes li').count(),1);
assert.equal(await page.locator('#notes li').getAttribute('data-done'),'true');
await page.locator('#notes [data-action=delete]').click();
await page.locator('#text').fill('  '); await page.locator('#add').click();
assert.equal(await page.locator('#notes li').count(),0);
for(const text of ['first','second']){await page.locator('#text').fill(text);await page.locator('#add').click();}
await page.locator('#notes li').first().locator('[data-action=toggle]').click();
if(phase!=='core'){
 await page.reload(); assert.equal(await page.locator('#notes li').count(),2);
 await page.locator('#filter').selectOption('done');assert.equal(await page.locator('#notes li:visible').count(),1);assert.match(await page.locator('#notes li:visible').innerText(),/first/);
 await page.locator('#filter').selectOption('active');assert.equal(await page.locator('#notes li:visible').count(),1);assert.match(await page.locator('#notes li:visible').innerText(),/second/);
 await page.locator('#filter').selectOption('all');
}
if(phase==='robust'){
 for(const broken of ['{broken','{}','null']){
  await page.evaluate(v=>localStorage.setItem('two-code-notes',v),broken);await page.reload();assert.equal(await page.locator('#notes li').count(),0);
 }
 await page.locator('#text').fill('<img src=x onerror="window.pwned=true">');await page.locator('#add').click();
 assert.equal(await page.locator('#notes img').count(),0);assert.equal(await page.evaluate(()=>!!window.pwned),false);
 await page.setViewportSize({width:390,height:700});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert((await fs.readFile(path.join(cwd,'README.md'),'utf8')).length>30);
}
await page.screenshot({path:path.join(cwd,'actual.png')});
`;
  } else if (name === "android") {
    stages.push({
      id: "all",
      brief:
        "Android中任务：写src/probe.mjs导出async probe({adb,serial,remoteDir,localDir})。只能操作传入serial的临时模拟器。用execFile及参数数组调用adb：读取ro.build.version.sdk；在remoteDir目录写入并读回UTF-8文本‘双角色 Android 4826’；用exec-out screencap -p取得真实PNG并保存到localDir/screen.png；返回{sdk:number,text:string,screenshot:绝对路径}。主副手完成验证后分别view_image看screen.png并说明真实界面。不要使用其他设备、联网或启动GUI。",
    });
    body = `const {probe}=await import(pathToFileURL(path.join(cwd,'src/probe.mjs')).href);
const result=await probe({adb:'D:/dev/android-sdk/platform-tools/adb.exe',serial:'emulator-5580',remoteDir:'/data/local/tmp/two-code-environment-qa',localDir:cwd});
assert.equal(result.sdk,34); assert.equal(result.text.trim(),'双角色 Android 4826');
assert.equal(path.resolve(result.screenshot),path.resolve(cwd,'screen.png'));
const png=await fs.readFile(result.screenshot);assert.equal(png.subarray(1,4).toString(),'PNG');assert(png.length>1000);
const {stdout}=await execFileAsync('D:/dev/android-sdk/platform-tools/adb.exe',['-s','emulator-5580','shell','cat','/data/local/tmp/two-code-environment-qa/message.txt']);
assert.equal(stdout.trim(),result.text.trim());
await fs.writeFile(path.join(cwd,'device-result.json'),JSON.stringify(result));
`;
    stages[0].brief += "约定设备端文本文件名message.txt，不能伪造设备数据或截图。";
  } else {
    stages.push({
      id: "all",
      brief:
        "虚拟机只读小任务：写src/inspect.mjs导出async inspect({executable,id})，用execFile参数数组执行VBoxManage showvminfo id --machinereadable并解析，返回{name,uuid,state,memoryMiB:number,cpus:number}。解析要容忍CRLF、值中等号和引号。不启动、停止、修改或克隆虚拟机。写README明确只读边界；实际调用由固定验收器提供参数。",
    });
    body = `const {inspect}=await import(pathToFileURL(path.join(cwd,'src/inspect.mjs')).href);
const result=await inspect({executable:'C:/Program Files/Oracle/VirtualBox/VBoxManage.exe',id:'20c7fe65-9e84-4080-8a10-a4a69441be95'});
assert.equal(result.uuid,'20c7fe65-9e84-4080-8a10-a4a69441be95');assert.equal(result.state,'poweroff');assert.equal(result.cpus,8);assert.equal(result.memoryMiB,12288);assert.match(result.name,/Huian/);
await fs.writeFile(path.join(cwd,'vm-result.json'),JSON.stringify(result));
assert((await fs.readFile(path.join(cwd,'README.md'),'utf8')).length>20);
`;
  }
  if (name === "visual" || name === "browser")
    body += "assert.deepEqual(errors,[]);\n} finally {await browser.close();}\n";
  const check = `import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execFileAsync=promisify(execFile),cwd=path.dirname(fileURLToPath(import.meta.url)),phase=process.argv[2];
let passed=false,error='';
try{${body}\npassed=true;}catch(e){error=String(e);process.exitCode=1;}
await fs.mkdir(path.join(cwd,'.qa'),{recursive:true});
const files=(await fs.readdir(path.join(cwd,'src'))).sort();const hash=createHash('sha256');
for(const file of files) hash.update(file).update(await fs.readFile(path.join(cwd,'src',file)));
await fs.appendFile(path.join(cwd,'.qa/ledger.jsonl'),JSON.stringify({phase,passed,error,hash:hash.digest('hex'),at:new Date().toISOString()})+'\\n');
console.log(passed?'PASS '+phase:'FAIL '+phase+' '+error);
`;
  await fs.writeFile(`${cwd}/check.mjs`, check);
  return { check, stages };
}
