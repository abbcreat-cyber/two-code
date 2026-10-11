import { createHash } from "node:crypto";
import type { TwoCodeTask, ITwoCodeExecutionService } from "../contract.js";
import type { CoordinatorDependencies } from "./ports.js";
import { parsePreferences } from "../domain/snapshot.js";
import { newTask, reconfigureTask } from "../domain/task.js";
import { twoCodeForkPoints } from "../domain/fork-points.js";

/** 复用Coordinator配置锁与执行租约，不为分叉建立第二套可运行任务所有者。 */
export function createTaskMutations(
  deps: CoordinatorDependencies,
  owner: {
    ready(): Promise<void>;
    busy(id: string): boolean;
    lock(id: string, value: boolean): void;
    read(id: string): Promise<TwoCodeTask>;
    cached(id: string): TwoCodeTask | undefined;
    publish(task: TwoCodeTask): void;
  },
) {
  const pending = new Map<string, { atSeq: number; work: Promise<TwoCodeTask> }>();
  async function locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (owner.busy(id)) throw Error("任务执行或配置保存中，请稍后更换或分叉");
    owner.lock(id, true);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await deps.lease?.acquire(id);
      return await operation();
    } finally {
      try {
        await release?.();
      } finally {
        owner.lock(id, false);
      }
    }
  }
  async function forkTask(
    input: Parameters<ITwoCodeExecutionService["fork"]>[0],
  ): Promise<TwoCodeTask> {
    await owner.ready();
    const hex = createHash("sha256")
      .update(JSON.stringify([input.taskId, input.requestId]))
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const prior = (await deps.store.read?.(id)) ?? owner.cached(id);
    const confirmed = (task: TwoCodeTask) => {
      if (task.forkSource?.atSeq !== input.atSeq) throw Error("分叉请求编号与原分叉点冲突");
      return structuredClone(task);
    };
    if (prior) return confirmed(prior);
    return locked(input.taskId, async () => {
      const duplicate = await deps.store.read?.(id);
      if (duplicate) return confirmed(duplicate);
      const source = await owner.read(input.taskId);
      if (source.status === "running" || !twoCodeForkPoints(source).includes(input.atSeq))
        throw Error("只能从已完成的回答分叉");
      if (!deps.forkActors) throw Error("当前宿主未接入原生会话分叉");
      const point = source.events.find((e) => e.seq === input.atSeq)!;
      const actors = await deps.forkActors(source, point.at, id);
      if (
        !actors.lead ||
        actors.lead === source.lead.sessionId ||
        (actors.sidekick && actors.sidekick === source.sidekick.sessionId)
      )
        throw Error("原生分叉未建立独立身份");
      const branch = newTask(
        id,
        {
          workspacePath: source.workspacePath,
          title: `${source.title} · 分支`,
          dual: source.dual,
          mode: source.mode,
          lead: source.lead.selection,
          sidekick: source.sidekick.selection,
        },
        new Date().toISOString(),
      );
      branch.events = structuredClone(source.events.filter((e) => e.seq <= input.atSeq));
      branch.status = "completed";
      branch.forkSource = { ...input };
      for (const role of ["lead", "sidekick"] as const) {
        branch[role].sessionId = actors[role];
        branch[role].status = actors[role] ? "completed" : "idle";
      }
      await deps.store.save(branch);
      owner.publish(branch);
      return structuredClone(branch);
    });
  }
  const fork: ITwoCodeExecutionService["fork"] = (input) => {
    if (!input.requestId || input.requestId.length > 200 || !Number.isSafeInteger(input.atSeq))
      return Promise.reject(Error("分叉请求无效"));
    const key = JSON.stringify([input.taskId, input.requestId]);
    const previous = pending.get(key);
    if (previous)
      return previous.atSeq === input.atSeq
        ? previous.work
        : Promise.reject(Error("分叉请求编号与原分叉点冲突"));
    const work = forkTask(input).finally(() => pending.delete(key));
    pending.set(key, { atSeq: input.atSeq, work });
    return work;
  };
  const configure: ITwoCodeExecutionService["configure"] = async (input) => {
    await owner.ready();
    const preferences = parsePreferences(input.preferences);
    return locked(input.taskId, async () => {
      const task = await owner.read(input.taskId);
      const next = reconfigureTask(task, preferences);
      await deps.store.save(next);
      owner.publish(next);
      return structuredClone(next);
    });
  };
  return { fork, configure };
}
