import type { ITwoCodeService } from "./contract.js";

export async function createPair(service: ITwoCodeService, workspacePath: string) {
  return service.create({
    workspacePath,
    dual: true,
    lead: { harness: "claude-code" },
    sidekick: { harness: "pi" },
  });
}
