import { mkdir, readdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TwoCodeTask } from "../contract.js";
import type { TaskStore } from "../app/ports.js";
import { parseTask } from "../domain/snapshot.js";

export class JsonTaskStore implements TaskStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async load(): Promise<TwoCodeTask[]> {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json"));
    return Promise.all(
      names.map(async (name) => {
        const data = parseTask(JSON.parse(await readFile(join(this.directory, name), "utf8")));
        if (`${data.id}.json` !== name) throw new Error(`任务文件身份不符，已保留：${name}`);
        return data;
      }),
    );
  }
  async read(id: string): Promise<TwoCodeTask | undefined> {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error("任务编号无效");
    try {
      const task = parseTask(
        JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")),
      );
      if (task.id !== id) throw new Error("任务文件身份不符，已保留原文件");
      return task;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  save(task: TwoCodeTask): Promise<void> {
    if (!/^[\da-f-]{36}$/i.test(task.id)) return Promise.reject(new Error("任务编号无效"));
    // 在入队时冻结内容，避免稍后的变更改写本次快照。
    const contents = JSON.stringify(parseTask(task));
    const target = join(this.directory, `${task.id}.json`);
    const work = this.tail
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, contents, "utf8");
          await rename(temporary, target);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      });
    this.tail = work;
    return work;
  }
}
