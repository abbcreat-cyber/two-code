import type { TwoCodePreferences } from "../contract.js";
import type { CoordinatorDependencies } from "./ports.js";
import { parsePreferences } from "../domain/snapshot.js";
import { validateSelection } from "../domain/task.js";

export async function readDefaults(
  store: CoordinatorDependencies["preferences"],
): Promise<TwoCodePreferences> {
  return (
    store?.read() ?? { dual: true, lead: { harness: "claude-code" }, sidekick: { harness: "pi" } }
  );
}
export async function writeDefaults(
  store: CoordinatorDependencies["preferences"],
  value: TwoCodePreferences,
): Promise<TwoCodePreferences> {
  const input = parsePreferences(value);
  validateSelection(input.lead);
  validateSelection(input.sidekick);
  if (!store) throw new Error("配置不可保存");
  await store.write(input);
  return structuredClone(input);
}
