import fs from "node:fs/promises";
export type CodingSize = "small" | "medium" | "long";
export interface CodingStage {
  id: string;
  brief: string;
}

const harness = (body: string) => `import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const cwd=path.dirname(fileURLToPath(import.meta.url));
const phase=process.argv[2]||'all';
const load=async name=>import(pathToFileURL(path.join(cwd,'src',name)).href);
const out=path.join(cwd,'.qa');await fs.mkdir(out,{recursive:true});
const call=(file,args)=>spawnSync(process.execPath,[path.join(cwd,'src',file),...args],{cwd,encoding:'utf8',timeout:15000,windowsHide:true});
let passed=false,error='';
try { ${body}
passed=true;console.log('PASS: '+phase+' coding checks');
} catch(e){error=e?.stack||String(e);console.error('FAIL: '+error);process.exitCode=1;}
const files=(await fs.readdir(path.join(cwd,'src')).catch(()=>[])).filter(n=>n.endsWith('.mjs')).sort();
const source=[];for(const file of files)source.push([file,await fs.readFile(path.join(cwd,'src',file),'utf8')]);
const hash=createHash('sha256').update(JSON.stringify(source)).digest('hex');
await fs.appendFile(path.join(out,'ledger.jsonl'),JSON.stringify({phase,passed,error,hash,at:new Date().toISOString()})+'\\n');
`;

const smallCheck = harness(`
const {uniqueNames}=await load('names.mjs');
assert.deepEqual(uniqueNames([' Amy ','amy','BOB','bob','']),['Amy','BOB']);
assert.deepEqual(uniqueNames([null,3,{},' x ','X']),['x']);
assert.deepEqual(uniqueNames(null),[]);
assert.deepEqual(uniqueNames(undefined),[]);
assert.deepEqual(uniqueNames([]),[]);
const input=[' a ','A'];const before=JSON.stringify(input);uniqueNames(input);assert.equal(JSON.stringify(input),before);
`);

const mediumCheck = harness(`
const {parseCsv}=await load('csv.mjs');const {summarize}=await load('report.mjs');
const input='\\ufeffitem,status,amount\\r\\n"蓝,笔",paid,0.10\\r\\n"蓝,笔",paid,0.20\\r\\n"书""签",paid,5.00\\r\\n取消,cancelled,9.00\\r\\n';
const rows=parseCsv(input);assert.equal(rows.length,4);assert.equal(rows[0].item,'蓝,笔');assert.equal(rows[2].item,'书"签');
assert.deepEqual(parseCsv('item,status,amount\\n"跨\\n行",paid,1.00\\n')[0],{item:'跨\\n行',status:'paid',amount:'1.00'});
assert.deepEqual(parseCsv(''),[]);assert.throws(()=>parseCsv('a,b\\n"unfinished,b'));
assert.deepEqual(summarize(rows),[{item:'蓝,笔',count:2,total:'0.30'},{item:'书"签',count:1,total:'5.00'}]);
assert.equal(summarize(rows,'all').at(-1).total,'9.00');
assert.equal(summarize([{item:'x',status:'paid',amount:'-2.50'},{item:'x',status:'paid',amount:'5.00'}])[0].total,'2.50');
assert.throws(()=>summarize([{item:'x',status:'paid',amount:'bad'}]));
const file=path.join(out,'orders.csv'),dest=path.join(out,'report.json');await fs.writeFile(file,input);
const good=call('cli.mjs',[file,dest]);assert.equal(good.status,0,good.stderr);assert.deepEqual(JSON.parse(await fs.readFile(dest,'utf8')),summarize(rows));
const bad=call('cli.mjs',[]);assert.notEqual(bad.status,0);
`);

const longCheck = harness(`
const {normalizeItems}=await load('items.mjs');const inv=await load('inventory.mjs');
const seed=inv.createState({apple:10,pear:5});
assert.deepEqual(normalizeItems([{sku:'apple',qty:1},{sku:'apple',qty:2}]),[{sku:'apple',qty:3}]);
for(const items of [[],[{sku:'',qty:1}],[{sku:'a',qty:0}],[{sku:'a',qty:1.5}]])assert.throws(()=>normalizeItems(items));
assert.throws(()=>inv.createState({a:-1}));
const frozen=JSON.stringify(seed);const first=inv.reserve(seed,'r1',[{sku:'apple',qty:3}]);
assert.equal(JSON.stringify(seed),frozen);assert.equal(first.stock.apple,7);assert.equal(first.orders.r1.status,'active');
assert.deepEqual(inv.reserve(first,'r1',[{sku:'apple',qty:3}]),first);
assert.throws(()=>inv.reserve(first,'r1',[{sku:'apple',qty:2}]));
const firstText=JSON.stringify(first);assert.throws(()=>inv.reserve(first,'bad',[{sku:'apple',qty:1},{sku:'pear',qty:99}]));assert.equal(JSON.stringify(first),firstText);
const cancelled=inv.cancel(first,'r1');assert.equal(cancelled.stock.apple,10);assert.equal(cancelled.orders.r1.status,'cancelled');assert.deepEqual(inv.cancel(cancelled,'r1'),cancelled);
assert.throws(()=>inv.cancel(first,'missing'));assert.throws(()=>inv.reserve(first,'unknown',[{sku:'missing',qty:1}]));
if(phase!=='core') {
const {readState,writeState}=await load('store.mjs');const {execute}=await load('service.mjs');
const file=path.join(out,'stock-'+phase+'.json');await writeState(file,seed);assert.deepEqual(await readState(file),seed);
const r=await execute(file,{type:'reserve',id:'persist',items:[{sku:'pear',qty:2}]});assert.equal(r.stock.pear,3);assert.deepEqual(await readState(file),r);
assert.deepEqual(await execute(file,{type:'reserve',id:'persist',items:[{sku:'pear',qty:2}]}),r);
const before=await fs.readFile(file,'utf8');await assert.rejects(execute(file,{type:'reserve',id:'bad',items:[{sku:'apple',qty:99}]}));assert.equal(await fs.readFile(file,'utf8'),before);
const cli=call('cli.mjs',[file,JSON.stringify({type:'cancel',id:'persist'})]);assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).state.stock.pear,5);
const bad=call('cli.mjs',[file,JSON.stringify({type:'wrong'})]);assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stdout).ok,false);
const corrupt=path.join(out,'corrupt.json');await fs.writeFile(corrupt,'broken-json');await assert.rejects(readState(corrupt));assert.equal(await fs.readFile(corrupt,'utf8'),'broken-json');
}
if(['expiry','all'].includes(phase)) {
const {summarize}=await load('summary.mjs');
const pending=inv.reserve(seed,'expiry1',[{sku:'apple',qty:2}],{expiresAt:1000});
assert.equal(inv.expire(pending,999).stock.apple,8);
const expired=inv.expire(pending,1000);assert.equal(expired.stock.apple,10);assert.equal(expired.orders.expiry1.status,'expired');
assert.deepEqual(inv.expire(expired,2000),expired);assert.deepEqual(inv.cancel(expired,'expiry1'),expired);
assert.deepEqual(inv.reserve(expired,'expiry1',[{sku:'apple',qty:2}],{expiresAt:1000}),expired);
const report=summarize(expired);assert.deepEqual(report.stock,[{sku:'apple',available:10},{sku:'pear',available:5}]);assert.deepEqual(report.orders,{active:0,cancelled:0,expired:1});
const {execute}=await load('service.mjs');const {writeState}=await load('store.mjs');const file=path.join(out,'expiry-cli-'+phase+'.json');await writeState(file,pending);
const cli=call('cli.mjs',[file,JSON.stringify({type:'expire',now:1000})]);assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).state.orders.expiry1.status,'expired');
}
if(phase==='all') {const doc=await fs.readFile(path.join(cwd,'README.md'),'utf8');for(const word of ['reserve','cancel','expire','src/cli.mjs'])assert(doc.includes(word));}
`);

export async function createCodingFixture(
  size: CodingSize,
  cwd: string,
): Promise<{ check: string; stages: CodingStage[] }> {
  await fs.mkdir(`${cwd}/src`, { recursive: true });
  let check: string, stages: CodingStage[];
  if (size === "small") {
    await fs.writeFile(
      `${cwd}/src/names.mjs`,
      "export function uniqueNames(items) { return [...new Set(items)]; }\n",
    );
    check = smallCheck;
    stages = [
      {
        id: "all",
        brief:
          "修复src/names.mjs导出的uniqueNames(items)：非数组返回[]；忽略非字符串，trim后去空，按不区分大小写去重，保留首次出现的大小写与顺序，不修改输入。仅修改该模块。",
      },
    ];
  } else if (size === "medium") {
    check = mediumCheck;
    stages = [
      {
        id: "all",
        brief:
          "实现一个无依赖CSV汇总库及CLI，共三个ESM文件。src/csv.mjs导出parseCsv(text)，首行列名，返回对象数组；支持UTF-8 BOM、LF/CRLF、引号内逗号/换行、双引号转义、末尾空行，空输入[]，未闭合引号报错。src/report.mjs导出summarize(rows,status='paid')：按item首次出现顺序汇总匹配status的count及total（两位小数字符串），status='all'包含所有行；amount为十进制金额字符串，支持负数，用整数分避免0.1+0.2误差，非法金额报错。src/cli.mjs参数为输入CSV路径、输出JSON路径、可选status；成功写汇总JSON并退出0，缺参/错误退出非0。请主手先确认三个接口再派副手实现，并检查跨文件衔接。",
      },
    ];
  } else {
    check = longCheck;
    stages = [
      {
        id: "core",
        brief:
          "阶段1/4，库存预留纯业务层。src/items.mjs导出normalizeItems(items)：非空数组，元素sku为非空字符串、qty为正整数，重复sku合并，保持首次顺序，非法输入抛错。src/inventory.mjs导出createState(stock)、reserve(state,id,items,options={})、cancel(state,id)。state结构{stock:{sku:非负整数},orders:{[id]:{items:规范化items,status:'active'|'cancelled',expiresAt?:数字}}}。函数不得修改传入state。reserve校验所有商品及库存后原子扣减；相同id相同items/options幂等返回不重复扣减，相同id不同内容报错；未知sku/不足报错且无部分扣减。cancel未知id报错，active归还库存并改cancelled，重复取消不再归还。本阶段只实现这两个源文件，勿提前扩展。",
      },
      {
        id: "storage",
        brief:
          "阶段2/4，保留已通过的纯业务层，新增JSON持久化和CLI。src/store.mjs导出async readState(file)、writeState(file,state)：读现有JSON，损坏文件报错且不覆盖，写文件使用同目录临时文件+rename原子替换。src/service.mjs导出async execute(file,command)，读取state，按{type:'reserve',id,items,options?}或{type:'cancel',id}调用库存层并成功才写回，返回新state；错误不改持久文件。src/cli.mjs接受file和JSON command两个参数，成功stdout只打印JSON{ok:true,state}退出0，失败stdout只打印{ok:false,error}退出1。无第三方依赖，不联网。保留前阶段接口，使用原副手继续。",
      },
      {
        id: "expiry",
        brief:
          "阶段3/4，增量需求：reserve的options.expiresAt为可选有限数字，与items一起构成同id幂等内容。新增inventory.expire(state,now)：到期(expiresAt<=now)且active的预留原子归还库存，改status为expired；重复expire/cancel已expired都不得重复归还，相同id同内容reserve已过期记录也不得重新扣减。execute/CLI新增{type:'expire',now}。新增src/summary.mjs导出summarize(state)，返回{stock:[{sku,available}]按sku升序,orders:{active:数量,cancelled:数量,expired:数量}}。不得破坏前两阶段，所有函数不修改传入state。主手核对边界并向原副手交接。",
      },
      {
        id: "all",
        brief:
          "阶段4/4，交付审查：由主手审查src模块之间的接口和幂等/失败不落盘/过期不重复回库存规则，把发现的具体问题一次性交给原副手修复；副手完成README.md，说明src/cli.mjs的reserve/cancel/expire用法、状态文件与异常行为。运行全量固定测试并交回真实回执；主手核对代码和文档后交付。不要为了改进文风重写已有实现，不重复已经通过且代码未变的验证。",
      },
    ];
  }
  await fs.writeFile(`${cwd}/check.mjs`, check);
  return { check, stages };
}
