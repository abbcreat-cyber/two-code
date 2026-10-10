import assert from "node:assert/strict";

async function installDelay(page) {
  // 只在隔离QA页面延迟入站消息，模拟准入已完成但确认尚未送达的窗口。
  await page.addInitScript(() => {
    if (window.__twoCodeLatencyInstalled) return;
    window.__twoCodeLatencyInstalled = true;
    const original = MessagePort.prototype.addEventListener;
    const remove = MessagePort.prototype.removeEventListener;
    const post = MessagePort.prototype.postMessage;
    const wrappers = new WeakMap();
    const heldIds = new WeakMap();
    const header = (data) => {
      if (!(data instanceof Uint8Array)) return [];
      let offset = 0;
      const integer = () => {
        let value = 0,
          shift = 0,
          byte;
        do {
          byte = data[offset++];
          value |= (byte & 127) << shift;
          shift += 7;
        } while (byte & 128);
        return value;
      };
      const read = () => {
        const type = data[offset++];
        if (type === 6) return integer();
        if (type === 4) return Array.from({ length: integer() }, read);
        if (type === 1) {
          const length = integer();
          const value = new TextDecoder().decode(data.slice(offset, offset + length));
          offset += length;
          return value;
        }
        throw new Error("Not a channel header");
      };
      try {
        return read();
      } catch {
        return [];
      }
    };
    MessagePort.prototype.postMessage = function (data, ...args) {
      const h = header(data);
      if (window.__twoCodeHold && h[0] === 100 && h[3] === (window.__twoCodeHoldMethod || "submit"))
        heldIds.set(this, h[1]);
      return post.call(this, data, ...args);
    };
    window.__twoCodeDelayed = [];
    MessagePort.prototype.addEventListener = function (type, listener, options) {
      if (type !== "message" || typeof listener !== "function")
        return original.call(this, type, listener, options);
      const wrapped = (event) => {
        const deliver = () => listener.call(this, event);
        const h = header(event.data);
        if (window.__twoCodeHold && [201, 202, 203].includes(h[0]) && h[1] === heldIds.get(this))
          window.__twoCodeDelayed.push(deliver);
        else deliver();
      };
      wrappers.set(listener, wrapped);
      return original.call(this, type, wrapped, options);
    };
    MessagePort.prototype.removeEventListener = function (type, listener, options) {
      return remove.call(this, type, wrappers.get(listener) || listener, options);
    };
  });
}
async function releaseReplies(page) {
  await page.evaluate(() => {
    window.__twoCodeHold = false;
    for (const deliver of window.__twoCodeDelayed.splice(0)) deliver();
  });
}
export async function runLatencyCases({ page, send, fresh, completed, checkCase, tasks, until }) {
  await checkCase("same-text-draft-race", async () => {
    await fresh();
    const task = await send("只回复READY，不派工，不使用工具。");
    await completed(task.id);
    await installDelay(page);
    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    const text = "只回复RACE_OK，不派工，不使用工具。";
    await page.evaluate(() => {
      window.__twoCodeHold = true;
    });
    try {
      await send(text, task.id);
      await fresh();
      await page.getByTestId("two-code-composer").fill(text);
      await page.waitForFunction(() => window.__twoCodeDelayed.length > 0);
    } finally {
      await releaseReplies(page);
    }
    await completed(task.id);
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      text,
      "late send acknowledgement cleared another task's identical draft",
    );
    await page.reload();
    await page.getByTestId("two-code-composer").waitFor();
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      text,
      "other draft was removed from storage",
    );
    await page.locator(`[data-testid*="task-item"][data-testid$="${task.id}"]`).click();
    assert.equal(
      (await page.getByTestId("two-code-composer").innerText()).trim(),
      "",
      "submitted task draft was not cleared",
    );
  });
  await checkCase("late-create-navigation", async () => {
    await fresh();
    const seed = await send("只回复NAV_READY，不派工，不使用工具。");
    await completed(seed.id);
    await installDelay(page);
    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    await fresh();
    const previous = new Set((await tasks()).map((t) => t.id));
    const prompt = "只回复NEW_TASK_OK，不派工，不使用工具。";
    await page.evaluate(() => {
      window.__twoCodeHoldMethod = "create";
      window.__twoCodeHold = true;
    });
    try {
      await page.getByTestId("two-code-composer").fill(prompt);
      await page.getByTestId("two-code-send").click();
      await page.waitForFunction(() => window.__twoCodeDelayed.length > 0);
      await page.locator(`[data-testid*="task-item"][data-testid$="${seed.id}"]`).click();
      await page.getByTestId("two-code-composer").fill("另一个任务的新草稿NAV_SAFE");
    } finally {
      await releaseReplies(page);
    }
    const created = (await tasks()).find((t) => !previous.has(t.id));
    assert(created);
    await until(
      async () =>
        (await tasks()).find((t) => t.id === created.id)?.events.some((e) => e.role === "user"),
      20000,
    );
    await completed(created.id);
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      "另一个任务的新草稿NAV_SAFE",
      "late creation navigated away from current task",
    );
    assert(
      !(await page.getByTestId("two-code-native-session").innerText()).includes("NEW_TASK_OK"),
    );
    await page.locator(`[data-testid*="task-item"][data-testid$="${created.id}"]`).click();
    assert.equal(
      (await page.getByTestId("two-code-composer").innerText()).trim(),
      "",
      "new task copied another task's draft",
    );
    assert.equal((await completed(created.id)).events.find((e) => e.role === "user")?.text, prompt);
  });
}
