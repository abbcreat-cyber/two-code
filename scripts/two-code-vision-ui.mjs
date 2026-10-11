import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { Resvg } from "@resvg/resvg-js";
const root = `D:/Apps/TwoCode/qa/vision-ui-${Date.now()}`;
const cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(
  `${root}/first.png`,
  new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><circle cx="135" cy="100" r="65" fill="#185ceb"/><path d="M430 225 L505 345 L355 345Z" fill="#e63030"/><text x="220" y="205" font-size="42" font-family="Arial">7294</text></svg>',
  )
    .render()
    .asPng(),
);
const second = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><rect x="420" y="30" width="100" height="100" fill="#f4ce12"/><path d="M120 240 L180 360 L60 360Z" fill="#208a43"/><text x="240" y="210" font-size="42" font-family="Arial">8361</text></svg>',
)
  .render()
  .asPng();
await fs.writeFile(`${root}/second.png`, second);
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "edit",
    lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    sidekick: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: `${root}/data`,
  ZCODE_DATA_BASE_DIR: `${root}/data`,
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.20"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const result = { root },
  errors = [];
let page;
async function until(f) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("视觉UI超时");
}
async function read() {
  const names = (await fs.readdir(`${root}/data/tasks`).catch(() => [])).filter((n) =>
    n.endsWith(".json"),
  );
  return names.length
    ? JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"))
    : null;
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByTestId("two-code-lead-model")
    .getByText("Step-5 订阅", { exact: true })
    .waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("非后台隔离窗口");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  console.log(JSON.stringify({ root }));
  await page.getByTestId("two-code-image-input").setInputFiles(`${root}/first.png`);
  await page.getByTestId("two-code-images").getByRole("img").waitFor();
  await page.getByTestId("two-code-composer").evaluate((element, b64) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, second.toString("base64"));
  await until(
    async () => (await page.getByTestId("two-code-images").getByRole("img").count()) === 2,
  );
  const prompt =
    "实际看这两张附图：主手分别调用view_image，报告每张图形颜色、形状、位置及四位数字；再让唯一副手独立用view_image看第一张并报告。只用看图和交接工具，不用命令、联网、源码或GUI。";
  await page.getByTestId("two-code-composer").fill(prompt);
  await page.reload();
  await page.getByTestId("two-code-images").waitFor();
  assert.equal(await page.getByTestId("two-code-images").getByRole("img").count(), 2);
  await page.screenshot({ path: `${root}/image-draft.png`, animations: "disabled" });
  if (process.env.TWO_CODE_VISION_UI_DRAFT_ONLY === "1") {
    await page.getByRole("button", { name: "移除first.png", exact: true }).click();
    assert.equal(await page.getByTestId("two-code-images").getByRole("img").count(), 1);
    await page.reload();
    await page
      .getByTestId("two-code-images")
      .getByRole("img", { name: "pasted.png", exact: true })
      .waitFor();
    assert.equal(await page.getByTestId("two-code-images").getByRole("img").count(), 1);
    assert.equal(await page.getByTestId("two-code-composer").innerText(), prompt);
    assert.equal(await read(), null);
    assert.deepEqual(errors, []);
    Object.assign(result, {
      passed: true,
      upload: true,
      paste: true,
      draftReload: true,
      removeReload: true,
      noUnintendedSend: true,
    });
  } else {
    await page.getByTestId("two-code-send").click();
    const first = await until(async () => {
      const t = await read();
      return t && t.status !== "running" && t;
    });
    assert.equal(first.status, "completed", first.error);
    assert.match(first.lead.lastReport, /7294/);
    assert.match(first.lead.lastReport, /8361/);
    assert.match(first.sidekick.lastReport, /7294/);
    for (const role of ["lead", "sidekick"])
      assert(
        first.events.some((e) => e.role === role && e.kind === "tool" && /view_image/.test(e.text)),
      );
    await page.getByTestId("two-code-state").waitFor();
    assert.equal(await page.getByTestId("two-code-images").count(), 0);
    await page
      .getByTestId("two-code-composer")
      .fill(
        "让原副手用Write新建当前目录双圆.svg：白底，左边蓝色圆，右边红色圆，两圆中间部分重叠。副手用view_image看图，主手也用view_image独立看图核对是否重叠。只用Write、view_image和交接，不执行命令，不联网，不查系统渲染器。",
      );
    await page.getByTestId("two-code-send").click();
    const next = await until(async () => {
      const t = await read();
      return t?.requestIds.length === 2 && t.status !== "running" && t;
    });
    assert.equal(next.status, "completed", next.error);
    assert.equal(next.sidekick.sessionId, first.sidekick.sessionId);
    await fs.access(`${cwd}/双圆.svg`);
    const seq = first.events.at(-1).seq;
    for (const role of ["lead", "sidekick"])
      assert(
        next.events.some(
          (e) => e.seq > seq && e.role === role && e.kind === "tool" && /view_image/.test(e.text),
        ),
      );
    assert.match(next.lead.lastReport, /重叠|覆盖|交叠/);
    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    await page.screenshot({ path: `${root}/visual-result.png`, animations: "disabled" });
    assert.deepEqual(errors, []);
    Object.assign(result, {
      passed: true,
      upload: true,
      paste: true,
      draftReload: true,
      actualPixelsBothRoles: true,
      svgCreatedAndViewed: true,
      sameSidekick: true,
    });
  }
} catch (e) {
  Object.assign(result, { passed: false, error: String(e) });
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  if ((await read())?.status === "running" && page)
    await page
      .getByTestId("two-code-stop")
      .click()
      .catch(() => {});
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
  await app.close();
}
