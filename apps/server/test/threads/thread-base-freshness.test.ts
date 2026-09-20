import { describe, expect, it } from "vitest";
import { getEnvironment } from "@bb/db";
import type { WorkspaceBaseFreshness } from "@bb/domain";
import { resolveThreadRuntimeCommandConfig } from "../../src/services/threads/thread-runtime-config.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { withTestHarness } from "../helpers/test-app.js";

const BEHIND_FRESHNESS: WorkspaceBaseFreshness = {
  mergeBaseBranch: "origin/main",
  remoteRef: "origin/main",
  remoteSha: "b".repeat(40),
  headSha: "a".repeat(40),
  aheadCount: 0,
  behindCount: 12,
  hasUncommittedChanges: true,
  fastForwarded: false,
  fetchError: null,
  checkedAt: 1_700_000_000_000,
};

async function resolveWorktreeTurnInstructions(
  freshness: WorkspaceBaseFreshness | { error: string },
): Promise<{
  instructions: string;
  recorded: WorkspaceBaseFreshness | null;
  refreshCommands: unknown[];
}> {
  return withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      id: "host-base-freshness",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/base-freshness-workspace",
      environmentProviderId: "git-worktree",
      mergeBaseBranch: "origin/main",
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const responder = registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: ({ command }) => {
        if (command.type === "workspace.refreshBase") {
          return "error" in freshness
            ? {
                ok: false,
                errorCode: "host_command_failed",
                errorMessage: freshness.error,
              }
            : { ok: true, result: { outcome: "available", freshness } };
        }
        if (command.type === "host.list_files") {
          return { ok: true, result: { files: [], truncated: false } };
        }
        if (command.type === "host.list_skills") {
          return { ok: true, result: { skills: [] } };
        }
        return {
          ok: false,
          errorCode: "ENOENT",
          errorMessage: `Path does not exist for ${command.type}`,
        };
      },
    });

    const config = await resolveThreadRuntimeCommandConfig(harness.deps, {
      thread,
      environment,
      model: "gpt-5",
    });
    return {
      instructions: config.instructions,
      recorded:
        getEnvironment(harness.deps.db, environment.id)?.baseFreshness ?? null,
      refreshCommands: responder.requests
        .map((request) => request.command)
        .filter((command) => command.type === "workspace.refreshBase"),
    };
  });
}

describe("managed worktree freshness at turn start", () => {
  it("warns the agent with exact refs and counts when the workspace is behind", async () => {
    const { instructions, recorded, refreshCommands } =
      await resolveWorktreeTurnInstructions(BEHIND_FRESHNESS);

    expect(refreshCommands).toEqual([
      expect.objectContaining({
        mergeBaseBranch: "origin/main",
        allowFastForward: true,
      }),
    ]);
    expect(instructions).toContain("12 commit(s) behind origin/main");
    expect(instructions).toContain("bbbbbbbbbbbb");
    expect(instructions).toContain("aaaaaaaaaaaa");
    expect(instructions).toContain("does not prove it is missing upstream");
    expect(recorded).toEqual(BEHIND_FRESHNESS);
  });

  it("stays silent once the workspace is current", async () => {
    const { instructions } = await resolveWorktreeTurnInstructions({
      ...BEHIND_FRESHNESS,
      behindCount: 0,
      hasUncommittedChanges: false,
    });

    expect(instructions).not.toContain("Workspace freshness");
  });

  it("reports unknown freshness instead of silence when the fetch fails", async () => {
    const { instructions, recorded } = await resolveWorktreeTurnInstructions({
      error: "could not resolve host github.com",
    });

    expect(instructions).toContain(
      "Freshness relative to the remote is UNKNOWN",
    );
    expect(recorded?.fetchError).toContain("could not resolve host github.com");
  });
});
