import { jsonValueSchema } from "./json-value.js";
import { z } from "zod";

export const environmentMachineSelectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("existing"), hostId: z.string().min(1) }),
  z.object({
    type: z.literal("new"),
    machineProviderId: z.string().min(1),
    inputs: jsonValueSchema.nullable(),
  }),
]);
export type EnvironmentMachineSelection = z.infer<
  typeof environmentMachineSelectionSchema
>;

export const environmentProviderSelectionSchema = z.object({
  machine: environmentMachineSelectionSchema,
  inputs: jsonValueSchema.nullable(),
});
export type EnvironmentProviderSelection = z.infer<
  typeof environmentProviderSelectionSchema
>;
export const environmentStatusValues = [
  "creating",
  "provisioning",
  "ready",
  "error",
  "destroyed",
] as const;
export const environmentStatusSchema = z.enum(environmentStatusValues);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

const WORKSPACE_PROVISION_TYPES = [
  "unmanaged",
  "managed-worktree",
  "personal",
] as const;
export const workspaceProvisionTypeSchema = z.enum(WORKSPACE_PROVISION_TYPES);
export type WorkspaceProvisionType = z.infer<
  typeof workspaceProvisionTypeSchema
>;

const environmentWorkspaceDisplayKindValues = [
  "managed-worktree",
  "unmanaged-worktree",
  "other",
] as const;
export const environmentWorkspaceDisplayKindSchema = z.enum(
  environmentWorkspaceDisplayKindValues,
);
export type EnvironmentWorkspaceDisplayKind = z.infer<
  typeof environmentWorkspaceDisplayKindSchema
>;

export const discoveredWorkspacePropertiesSchema = z.object({
  path: z.string().min(1),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  defaultBranch: z.string().nullable(),
});
export type DiscoveredWorkspaceProperties = z.infer<
  typeof discoveredWorkspacePropertiesSchema
>;

export const environmentLifecycleSchema = z.object({
  phase: z.enum(["active", "retiring", "teardown", "destroyed"]),
  retireAt: z.number().nullable(),
  teardown: z
    .object({
      status: z.enum(["running", "failed", "removed"]),
      attempt: z.number().int().nonnegative(),
      message: z.string().optional(),
    })
    .nullable(),
});

export const workspaceBaseFreshnessSchema = z
  .object({
    mergeBaseBranch: z.string().min(1),
    remoteRef: z.string().min(1).nullable(),
    remoteSha: z.string().min(1).nullable(),
    headSha: z.string().min(1).nullable(),
    aheadCount: z.number().int().nonnegative(),
    behindCount: z.number().int().nonnegative(),
    hasUncommittedChanges: z.boolean(),
    fastForwarded: z.boolean(),
    fetchError: z.string().min(1).nullable(),
    checkedAt: z.number(),
  })
  .strict();
export type WorkspaceBaseFreshness = z.infer<
  typeof workspaceBaseFreshnessSchema
>;

export type WorkspaceBaseFreshnessState =
  | "current"
  | "fast-forwarded"
  | "behind"
  | "unknown";

export function resolveWorkspaceBaseFreshnessState(
  freshness: WorkspaceBaseFreshness,
): WorkspaceBaseFreshnessState {
  if (freshness.fetchError !== null) return "unknown";
  if (freshness.fastForwarded) return "fast-forwarded";
  return freshness.behindCount > 0 ? "behind" : "current";
}

function describeRemote(freshness: WorkspaceBaseFreshness): string {
  const ref = freshness.remoteRef ?? freshness.mergeBaseBranch;
  return freshness.remoteSha === null
    ? ref
    : `${ref} (${freshness.remoteSha.slice(0, 12)})`;
}

function describeDivergence(freshness: WorkspaceBaseFreshness): string {
  const reasons: string[] = [];
  if (freshness.hasUncommittedChanges) reasons.push("has uncommitted changes");
  if (freshness.aheadCount > 0) {
    reasons.push(`is ${freshness.aheadCount} commit(s) ahead`);
  }
  return reasons.length === 0
    ? ""
    : ` The workspace ${reasons.join(" and ")}, so bb did not move it.`;
}

export function describeWorkspaceBaseFreshness(
  freshness: WorkspaceBaseFreshness,
): string | null {
  const head =
    freshness.headSha === null ? "unknown" : freshness.headSha.slice(0, 12);
  switch (resolveWorkspaceBaseFreshnessState(freshness)) {
    case "current":
      return null;
    case "fast-forwarded":
      return `Fast-forwarded the workspace to ${describeRemote(freshness)} before this turn.`;
    case "behind":
      return `The workspace is ${freshness.behindCount} commit(s) behind ${describeRemote(freshness)}; HEAD is ${head}.${describeDivergence(freshness)} Code merged into the base after ${head} is NOT present here, so absence of code in this workspace does not prove it is missing upstream. Fetch and rebase or merge before drawing conclusions about the base branch.`;
    case "unknown":
      return `bb could not refresh ${freshness.mergeBaseBranch} for this workspace (${freshness.fetchError}). Freshness relative to the remote is UNKNOWN; HEAD is ${head}. Do not conclude that code is missing upstream without a successful fetch.`;
  }
}

export const environmentSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  projectId: z.string(),
  hostId: z.string(),
  path: z.string().nullable(),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  mergeBaseBranch: z.string().nullable(),
  baseFreshness: workspaceBaseFreshnessSchema.nullable().default(null),
  status: environmentStatusSchema,
  environmentProviderId: z.string().nullable(),
  lifecycle: environmentLifecycleSchema,
  environmentProviderSelection: environmentProviderSelectionSchema.nullable(),
  environmentProviderInstanceKey: z.string().nullable(),
  managed: z.boolean(),
  workspaceProvisionType: workspaceProvisionTypeSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Environment = z.infer<typeof environmentSchema>;

type EnvironmentMergeBaseBranchSource = Pick<
  Environment,
  "baseBranch" | "defaultBranch" | "mergeBaseBranch"
>;

export function resolveEnvironmentMergeBaseBranch(
  environment: EnvironmentMergeBaseBranchSource | null | undefined,
): string | undefined {
  return (
    environment?.mergeBaseBranch ??
    environment?.baseBranch ??
    environment?.defaultBranch ??
    undefined
  );
}
