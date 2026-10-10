export const module = {
  id: "two-code",
  owner: "two-code-coordination",
  requires: ["rpc", "shared", "services"],
  publicEntrypoints: ["contract.ts", "adapters/bootstrap.ts"],
} as const;
