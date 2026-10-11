import type { ActorRole } from "../contract.js";
import type { CoordinatorDependencies, HarnessAdapter } from "./ports.js";

/** 仅由Coordinator拥有的本轮内存状态，不写入任务快照或跨轮复用。 */
export interface ActiveRun {
  connections?: Awaited<ReturnType<NonNullable<CoordinatorDependencies["connections"]>>>;
  id: string;
  requestId: string;
  abort: AbortController;
  actors: Map<ActorRole, HarnessAdapter>;
  permissions: Map<string, (allow: boolean) => void>;
  sidekick?: Promise<string>;
  sidekickRead?: boolean;
  work?: Promise<void>;
  admission?: Promise<void>;
  release?: () => Promise<void>;
  duplicate?: boolean;
  committing?: boolean;
  leadWake?: { promise: Promise<void>; resolve(): void };
  steering?: Promise<void>;
  steeringError?: string;
  updateAdmissions?: Map<string, Promise<void>>;
}
