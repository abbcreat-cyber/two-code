import fs from "node:fs/promises";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";

export async function verifyStepThinking(page: Page, root: string) {
  await page.getByTestId("two-code-lead-model").click();
  const leadThinking = page.getByRole("combobox", { name: "主手思考档位", exact: true });
  assert(await leadThinking.isEnabled());
  await leadThinking.click();
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["低", "中", "高"]);
  await page.getByRole("option", { name: "高", exact: true }).click();
  assert.match((await page.getByTestId("two-code-lead-model").getAttribute("title"))!, /思考高/);
  await page.getByTestId("two-code-lead-panel").screenshot({ path: `${root}/step-thinking.png` });
  await leadThinking.click();
  await page.getByRole("option", { name: "中", exact: true }).click();
  await page.getByTestId("two-code-lead-model").click();
}

export async function verifyResumedThinking(
  page: Page,
  root: string,
  task: { id: string; lead: { sessionId?: string } },
) {
  const sessionId = task.lead.sessionId;
  await page.getByTestId("two-code-lead-model").click();
  await page.getByRole("combobox", { name: "主手思考档位", exact: true }).click();
  await page.getByRole("option", { name: "高", exact: true }).click();
  await page.getByTestId("two-code-lead-model").click();
  await page
    .getByTestId("two-code-composer")
    .fill("本轮不必派副手，不调用工具。用一句完整中文复述上一轮收到的暗号。");
  await page.getByTestId("two-code-send").click();
  await page.locator('[data-testid="two-code-state"][data-status="running"]').waitFor();
  await page
    .locator('[data-testid="two-code-state"][data-status="completed"]')
    .waitFor({ timeout: 120000 });
  const resumed = JSON.parse(await fs.readFile(`${root}/data/tasks/${task.id}.json`, "utf8"));
  assert.equal(resumed.lead.sessionId, sessionId);
  assert.equal(resumed.lead.selection.thinking, "high");
  assert.match(resumed.lead.lastReport, /PAIR_OK/);
  await fs.writeFile(`${root}/resumed-thinking-task.json`, JSON.stringify(resumed, null, 2));
}
