import type { ITwoCodeService } from "./contract.js";

export async function createPair(service: ITwoCodeService, workspacePath: string) {
  return service.create({
    workspacePath,
    dual: true,
    lead: { harness: "claude-code" },
    sidekick: { harness: "pi" },
  });
}

export async function renameConnection(service: ITwoCodeService, id: string, name: string) {
  const view = await service.modelSettings();
  const connection = view.connections.find((entry) => entry.id === id);
  if (!connection) throw new Error("连接不存在");
  return service.saveConnection({ revision: view.revision, connection: { ...connection, name } });
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
