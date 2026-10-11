import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Emitter } from "@zcode/rpc";
import { z } from "zod";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import type {
  TwoCodePreferences,
  TwoCodeCombinations,
  TwoCodeCombinationsApi,
} from "../contract.js";
import { parsePreferences } from "../domain/snapshot.js";
import { validateSelection } from "../domain/task.js";

type Document = TwoCodePreferences & {
  revision: number;
  defaultCombinationId: string | null;
  combinations: TwoCodeCombinations["items"];
};
const nameSchema = z
  .string()
  .trim()
  .min(1, "请填写组合名称")
  .max(40, "组合名称最多40字")
  .refine(
    (s) => Array.from(s).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    "组合名称不能包含换行或控制字符",
  );
const extraSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  defaultCombinationId: z.string().nullable(),
  combinations: z
    .array(
      z.object({
        id: z.string().min(1),
        name: nameSchema,
        preferences: z.unknown().transform(parsePreferences),
      }),
    )
    .min(1)
    .max(10),
});
const library = (doc: Document): TwoCodeCombinations => ({
  revision: doc.revision,
  defaultId: doc.defaultCombinationId,
  items: structuredClone(doc.combinations),
});
const configuration = (value: TwoCodePreferences) => {
  const result = parsePreferences(value);
  validateSelection(result.lead);
  validateSelection(result.sidekick);
  return result;
};

export class JsonPreferences {
  private readonly changes = new Emitter<TwoCodeCombinations>();
  readonly onDidCombinationsChange = this.changes.event;
  constructor(private readonly root: string) {}
  private async document(): Promise<Document> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(this.root, "preferences.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("角色配置损坏，请检查 preferences.json；原文件已保留", { cause: error });
      raw = { dual: true, lead: { harness: "claude-code" }, sidekick: { harness: "pi" } };
    }
    try {
      const defaults = configuration(raw as TwoCodePreferences);
      if (!raw || typeof raw !== "object" || !("combinations" in raw))
        return {
          ...defaults,
          revision: 0,
          defaultCombinationId: "initial-default",
          combinations: [{ id: "initial-default", name: "默认组合", preferences: defaults }],
        };
      const extra = extraSchema.parse(raw);
      if (
        new Set(extra.combinations.map((c) => c.id)).size !== extra.combinations.length ||
        (extra.defaultCombinationId &&
          !extra.combinations.some((c) => c.id === extra.defaultCombinationId))
      )
        throw Error("组合配置身份无效，原文件已保留");
      return { ...defaults, ...extra };
    } catch (cause) {
      throw new Error("角色配置损坏，请检查 preferences.json；原文件已保留", { cause });
    }
  }
  async read(): Promise<TwoCodePreferences> {
    return parsePreferences(await this.document());
  }
  async combinations(): Promise<TwoCodeCombinations> {
    return library(await this.document());
  }
  private async mutate(
    revision: number | undefined,
    edit: (doc: Document) => void,
  ): Promise<TwoCodeCombinations> {
    const target = join(this.root, "preferences.json");
    const result = await withFileLock(target, async () => {
      const doc = await this.document();
      if (revision !== undefined && revision !== doc.revision)
        throw Error("组合已在其他窗口更新，请刷新后重试");
      edit(doc);
      doc.revision++;
      await atomicWritePrivateTextFile(target, JSON.stringify(doc, null, 2));
      return library(doc);
    });
    this.changes.fire(result);
    return result;
  }
  saveCombination: TwoCodeCombinationsApi["saveCombination"] = async (input) =>
    this.mutate(z.number().int().nonnegative().parse(input.revision), (doc) => {
      const name = nameSchema.parse(input.name),
        item = input.id ? doc.combinations.find((c) => c.id === input.id) : undefined;
      if (input.id && !item) throw Error("组合不存在");
      if (
        doc.combinations.some(
          (c) =>
            c.id !== input.id &&
            c.name.normalize("NFKC").toLowerCase() === name.normalize("NFKC").toLowerCase(),
        )
      )
        throw Error("已有同名组合，请换一个名称");
      const value = input.preferences ? configuration(input.preferences) : item?.preferences;
      if (!value) throw Error("新组合需要模型配置");
      if (item) {
        item.name = name;
        item.preferences = value;
        if (doc.defaultCombinationId === item.id) Object.assign(doc, value);
      } else {
        if (doc.combinations.length >= 10) throw Error("已保存10套组合，请先删除多余的组合");
        doc.combinations.push({ id: randomUUID(), name, preferences: value });
      }
    });
  defaultCombination: TwoCodeCombinationsApi["defaultCombination"] = async (input) =>
    this.mutate(z.number().int().nonnegative().parse(input.revision), (doc) => {
      const item = doc.combinations.find((c) => c.id === input.id);
      if (!item) throw Error("组合不存在");
      doc.defaultCombinationId = item.id;
      Object.assign(doc, item.preferences);
    });
  removeCombination: TwoCodeCombinationsApi["removeCombination"] = async (input) =>
    this.mutate(z.number().int().nonnegative().parse(input.revision), (doc) => {
      if (!doc.combinations.some((c) => c.id === input.id)) throw Error("组合不存在");
      if (doc.combinations.length === 1) throw Error("至少保留一套组合");
      doc.combinations = doc.combinations.filter((c) => c.id !== input.id);
      if (doc.defaultCombinationId === input.id) {
        const next = doc.combinations[0]!;
        doc.defaultCombinationId = next.id;
        Object.assign(doc, next.preferences);
      }
    });
  async write(input: TwoCodePreferences): Promise<void> {
    const value = configuration(input);
    // 保留旧API兼容性；写默认值不能擦掉已保存的组合库。
    await this.mutate(undefined, (doc) => {
      Object.assign(doc, value);
      doc.defaultCombinationId =
        doc.combinations.find((c) => JSON.stringify(c.preferences) === JSON.stringify(value))?.id ??
        null;
    });
  }
  dispose() {
    this.changes.dispose();
  }
}
