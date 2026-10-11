import type { ITwoCodeService } from "./contract.js";
import { normalizeThinkingSelection } from "./contract.js";
export async function saveNamedCombination(service: ITwoCodeService, name: string) {
  const library = await service.combinations();
  return service.saveCombination({
    revision: library.revision,
    name,
    preferences: await service.preferences(),
  });
}
export const forkCompletedAnswer = (
  service: ITwoCodeService,
  taskId: string,
  atSeq: number,
  requestId: string,
) => service.fork({ taskId, atSeq, requestId });

export const uploadImage = (service: ITwoCodeService, fileName: string, dataBase64: string) =>
  service.importImage({ fileName, dataBase64 });

export const previewUploadedImage = (service: ITwoCodeService, path: string) =>
  service.readImage(path);

export const explicitAstraThinking = normalizeThinkingSelection({
  harness: "pi",
  model: "gpt-6-astra",
});

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

export async function testSavedModel(service: ITwoCodeService, id: string, modelId: string) {
  const view = await service.modelSettings();
  return service.testConnection({ id, modelId, revision: view.revision });
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
