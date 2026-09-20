import type { EnvironmentRow } from "@bb/db";
import { recordEnvironmentBaseFreshness } from "@bb/db";
import {
  describeWorkspaceBaseFreshness,
  type WorkspaceBaseFreshness,
} from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpcForWork } from "../hosts/online-rpc.js";
import { workspaceContextFromPath } from "./workspace-command-target.js";
import { resolveDeprecatedWorkspaceProvisionType } from "./environment-response.js";

export const BASE_FRESHNESS_REFRESH_INTERVAL_MS = 60_000;

function isRefreshable(environment: EnvironmentRow): boolean {
  return (
    environment.status === "ready" &&
    environment.path !== null &&
    environment.isGitRepo &&
    resolveDeprecatedWorkspaceProvisionType(
      environment.environmentProviderId,
    ) === "managed-worktree"
  );
}

export async function refreshEnvironmentBaseFreshness(
  deps: WorkSessionDeps,
  environment: EnvironmentRow,
): Promise<WorkspaceBaseFreshness | null> {
  const mergeBaseBranch = environment.mergeBaseBranch ?? environment.baseBranch;
  const workspacePath = environment.path;
  if (
    mergeBaseBranch === null ||
    workspacePath === null ||
    !isRefreshable(environment)
  ) {
    return environment.baseFreshness ?? null;
  }
  const recorded = environment.baseFreshness ?? null;
  if (
    recorded !== null &&
    recorded.mergeBaseBranch === mergeBaseBranch &&
    Date.now() - recorded.checkedAt < BASE_FRESHNESS_REFRESH_INTERVAL_MS
  ) {
    return recorded;
  }

  const unresolved = (message: string): WorkspaceBaseFreshness => ({
    mergeBaseBranch,
    remoteRef: null,
    remoteSha: null,
    headSha: recorded?.headSha ?? null,
    aheadCount: recorded?.aheadCount ?? 0,
    behindCount: recorded?.behindCount ?? 0,
    hasUncommittedChanges: recorded?.hasUncommittedChanges ?? false,
    fastForwarded: false,
    fetchError: message,
    checkedAt: Date.now(),
  });

  let freshness: WorkspaceBaseFreshness;
  try {
    const result = await callHostOnlineRpcForWork(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.refreshBase",
        environmentId: environment.id,
        workspaceContext: workspaceContextFromPath({ path: workspacePath }),
        mergeBaseBranch,
        allowFastForward: true,
      },
    });
    freshness =
      result.outcome === "available"
        ? result.freshness
        : unresolved(result.failure.message);
  } catch (error) {
    freshness = unresolved(
      error instanceof Error ? error.message : String(error),
    );
  }

  recordEnvironmentBaseFreshness(deps.db, deps.hub, environment.id, freshness);
  return freshness;
}

export function baseFreshnessInstructions(
  freshness: WorkspaceBaseFreshness | null,
): string | null {
  if (freshness === null) return null;
  const summary = describeWorkspaceBaseFreshness(freshness);
  return summary === null ? null : `Workspace freshness: ${summary}`;
}
