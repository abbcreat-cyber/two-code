import type { ITwoCodeService } from "./contract.js";

export async function createPair(service: ITwoCodeService, workspacePath: string) {
  return service.create({
    workspacePath,
    dual: true,
    lead: { harness: "claude-code" },
    sidekick: { harness: "pi" },
  });
}

export async function changeIdleModel(service: ITwoCodeService, taskId: string, model: string) {
  const task = await service.read(taskId);
  return service.configure({
    taskId,
    preferences: {
      dual: task.dual,
      mode: task.mode,
      lead: { ...task.lead.selection, model },
      sidekick: task.sidekick.selection,
    },
  });
}
