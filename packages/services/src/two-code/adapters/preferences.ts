import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import type { TwoCodePreferences } from "../contract.js";
import { parsePreferences } from "../domain/snapshot.js";

export class JsonPreferences {
  constructor(private readonly root: string) {}
  async read(): Promise<TwoCodePreferences> {
    try {
      return parsePreferences(
        JSON.parse(await readFile(join(this.root, "preferences.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("角色配置损坏，请检查 preferences.json；原文件已保留", { cause: error });
      return { dual: true, lead: { harness: "claude-code" }, sidekick: { harness: "pi" } };
    }
  }
  async write(input: TwoCodePreferences): Promise<void> {
    const value = parsePreferences(input);
    const target = join(this.root, "preferences.json");
    // Windows并发rename会返回EPERM；复用现有跨进程锁和原子写入，不另建锁协议。
    await withFileLock(target, () =>
      atomicWritePrivateTextFile(target, JSON.stringify(value, null, 2)),
    );
  }
}
