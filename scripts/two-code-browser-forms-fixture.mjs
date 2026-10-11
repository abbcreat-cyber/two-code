import assert from "node:assert/strict";

export async function serve(req, res, { writes, loads, inputs }) {
  if (req.method === "POST" && ["/event", "/save"].includes(req.url)) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw);
    (req.url === "/event" ? inputs : writes).push(data);
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ count: writes.length }));
    return;
  }
  if (!["/a", "/b"].includes(req.url)) return void res.writeHead(404).end();
  loads.push(req.url);
  res.writeHead(200, { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" });
  if (req.url === "/b") {
    res.end("<!doctype html><title>详情页</title><h1>详情页：历史标记8427</h1>");
    return;
  }
  res.end(`<!doctype html><title>控件验收</title><body style="font:22px Arial;padding:25px">
<h1>控件验收</h1><label>优先级<select id="priority" aria-label="优先级"><option value="low">普通</option><option value="high">紧急</option></select></label>
<label><input type="checkbox" id="notify" aria-label="通知">通知</label>
<label>备注<textarea id="note" aria-label="备注">原始备注</textarea></label>
<button id="save">保存</button><button id="replace">替换备注控件</button><a href="/b">查看详情</a>
<p role="status" id="status">尚未保存</p><p id="generation">控件代次：1</p>
<script>
let pending=Promise.resolve(), generation=1;
const post=(url,data)=>{pending=pending.then(()=>fetch(url,{method:'POST',body:JSON.stringify(data)}).then(r=>r.json()));return pending;};
for(const type of ['input','change'])document.addEventListener(type,e=>{if(e.target.id)post('/event',{type,id:e.target.id,value:e.target.value,checked:e.target.checked,generation});});
document.querySelector('#save').onclick=async()=>{const data={priority:document.querySelector('#priority').value,notify:document.querySelector('#notify').checked,note:document.querySelector('#note').value,generation};const r=await post('/save',data);document.querySelector('#status').textContent='保存次数：'+r.count+'；'+JSON.stringify(data);};
document.querySelector('#replace').onclick=()=>{const old=document.querySelector('#note'), fresh=old.cloneNode(false);fresh.value='重绘初始';old.replaceWith(fresh);generation++;document.querySelector('#generation').textContent='控件代次：'+generation;};
</script></body>`);
}

export async function runScenarios({ run, origin, writes, inputs, results, app }) {
  const first = await run(
    "controls",
    `控件协作验收：主手browser navigate打开${origin}/a并snapshot，然后交唯一副手在同一tab操作：select把优先级选择为“紧急”（values数组）；check把通知设置checked=true，随后再用check checked=true重复设置一次，验证幂等；fill备注为“控件协作4826”，点击保存一次。主手最后snapshot复核三字段与保存次数。副手使用原生select/check，不用click代替这两个动作。报告tabId。`,
  );
  assert.deepEqual(writes, [
    { priority: "high", notify: true, note: "控件协作4826", generation: 1 },
  ]);
  const checked = first.native.filter(
    (e) => e.role === "sidekick" && e.request.method === "check" && e.result?.ok,
  );
  assert.equal(checked.length, 2, "副手应执行两次幂等check");
  assert.equal(
    inputs.filter((e) => e.id === "notify" && e.type === "change").length,
    1,
    "重复check不能反复触发change",
  );
  assert(
    first.native.some(
      (e) => e.role === "sidekick" && e.request.method === "select" && e.result?.ok,
    ),
  );
  const tabId =
    first.native.find((e) => e.request.method === "navigate" && e.result?.ok)?.result.meta?.tabId ??
    first.native.find((e) => e.request.method === "snapshot" && e.result?.ok)?.request.tabId;
  assert(tabId, "必须取得真实tabId");
  const sessions = [first.task.lead.sessionId, first.task.sidekick.sessionId];
  results.push({ name: "controls", passed: true, elapsedMs: first.elapsedMs, tabId });

  const history = await run(
    "history",
    `继续同一任务，同一tabId=${tabId}。唯一副手snapshot后点击“查看详情”，snapshot核对“历史标记8427”；用browser back回表单，snapshot确认“控件验收”；再forward去详情，snapshot确认8427；最后back回表单并snapshot。主手最后getState和snapshot核对停在/a。禁止navigate替代back/forward，禁止开新标签，本轮不填写、不保存。`,
    first.task.id,
  );
  assert.deepEqual([history.task.lead.sessionId, history.task.sidekick.sessionId], sessions);
  for (const method of ["back", "forward"])
    assert(
      history.native.some(
        (e) => e.role === "sidekick" && e.request.method === method && e.result?.ok,
      ),
    );
  const traversals = history.native.filter(
    (e) => e.role === "sidekick" && ["back", "forward"].includes(e.request.method) && e.result,
  );
  assert.deepEqual(
    traversals.map((e) => e.request.method),
    ["back", "forward", "back"],
  );
  for (const item of traversals) {
    assert.equal(item.result.ok, true);
    assert.equal(
      item.result.state?.url,
      `${origin}/${item.request.method === "back" ? "a" : "b"}`,
      "历史回执必须是到达后的URL",
    );
  }
  const finalState = history.native
    .filter((e) => e.role === "lead" && e.request.method === "getState" && e.result?.ok)
    .at(-1)?.result.state;
  assert.equal(finalState?.url, `${origin}/a`);
  assert.equal(writes.length, 1);
  results.push({ name: "history", passed: true, elapsedMs: history.elapsedMs });

  const dynamic = await run(
    "dynamic",
    `继续同一任务，tabId=${tabId}。唯一副手先snapshot，记住旧“备注”的ref和“替换备注控件”按钮ref。点击替换按钮后，立即对刚才旧备注ref做一次fill value="不应写入"（这是明确的负向测试，预期ref_not_found；此步之前不能重新snapshot，否则ref会重新编号）。随后重新snapshot，找到新备注ref，fill为“重绘后接续7823”；用check checked=false明确关闭通知，再select优先级为“普通”，保存一次。主手snapshot复核备注、代次2和三个字段。不可用旧ref不断重试，不新开标签。`,
    first.task.id,
  );
  assert.deepEqual([dynamic.task.lead.sessionId, dynamic.task.sidekick.sessionId], sessions);
  assert(
    dynamic.native.some(
      (e) => e.request.value === "不应写入" && e.result?.error?.code === "ref_not_found",
    ),
  );
  assert(!inputs.some((e) => e.value === "不应写入"));
  assert.deepEqual(writes.at(-1), {
    priority: "low",
    notify: false,
    note: "重绘后接续7823",
    generation: 2,
  });
  assert.equal(writes.length, 2);
  const guests = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((w) => w.getType() === "webview")
      .map((w) => ({ id: w.id, url: w.getURL() })),
  );
  assert.equal(guests.filter((g) => g.url.startsWith(origin)).length, 1);
  results.push({ name: "dynamic", passed: true, elapsedMs: dynamic.elapsedMs, guests });
}
