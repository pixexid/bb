import { describe, expect, it } from "vitest";
import { getEnvironment } from "@bb/db";
import {
  createStandaloneBuiltinCompactCommandInput,
  type PromptInput,
  type WorkspaceBaseFreshness,
} from "@bb/domain";
import { prepareTurnSubmitCommandPayload } from "../../src/services/threads/thread-commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { withTestHarness } from "../helpers/test-app.js";
import { textInput } from "../helpers/prompt-input.js";

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

async function prepareWorktreeTurns(
  freshness: (WorkspaceBaseFreshness | { error: string })[],
  providerId = "codex",
  inputs: PromptInput[][] = freshness.map((_value, index) =>
    textInput(`turn ${index + 1}`),
  ),
): Promise<{
  commands: Awaited<ReturnType<typeof prepareTurnSubmitCommandPayload>>[];
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
      providerId,
    });
    let refreshIndex = 0;
    const responder = registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: ({ command }) => {
        if (command.type === "workspace.refreshBase") {
          const next = freshness[Math.min(refreshIndex, freshness.length - 1)]!;
          refreshIndex += 1;
          return "error" in next
            ? {
                ok: false,
                errorCode: "host_command_failed",
                errorMessage: next.error,
              }
            : { ok: true, result: { outcome: "available", freshness: next } };
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

    const commands = [];
    for (let index = 0; index < freshness.length; index += 1) {
      commands.push(
        await prepareTurnSubmitCommandPayload(harness.deps, {
          thread,
          environment,
          execution: {
            model: "test-model",
            permissionMode: "accept-edits",
            reasoningLevel: "medium",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          permissionEscalation: "ask",
          input: inputs[index]!,
          providerThreadId: "provider-existing",
          target: { mode: "start" },
        }),
      );
    }
    return {
      commands,
      recorded:
        getEnvironment(harness.deps.db, environment.id)?.baseFreshness ?? null,
      refreshCommands: responder.requests
        .map((request) => request.command)
        .filter((command) => command.type === "workspace.refreshBase"),
    };
  });
}

describe("managed worktree freshness at turn start", () => {
  it.each(["claude-code", "codex", "pi", "acp-cursor"])(
    "delivers exact negative freshness to an existing %s session",
    async (providerId) => {
      const { commands, recorded, refreshCommands } =
        await prepareWorktreeTurns([BEHIND_FRESHNESS], providerId);
      const command = commands[0]!;

      expect(refreshCommands).toEqual([
        expect.objectContaining({
          mergeBaseBranch: "origin/main",
          allowFastForward: true,
        }),
      ]);
      expect(command.input[0]).toMatchObject({
        type: "text",
        visibility: "agent-only",
        text: expect.stringContaining("12 commit(s) behind origin/main"),
      });
      expect(command.input[0]).toMatchObject({
        text: expect.stringContaining("b".repeat(40)),
      });
      expect(command.input[0]).toMatchObject({
        text: expect.stringContaining("a".repeat(40)),
      });
      expect(command.resumeContext.instructions).not.toContain(
        "Workspace freshness",
      );
      expect(recorded).toEqual(BEHIND_FRESHNESS);
    },
  );

  it("refreshes again when a second turn starts inside sixty seconds", async () => {
    const { commands, refreshCommands } = await prepareWorktreeTurns([
      { ...BEHIND_FRESHNESS, behindCount: 0, hasUncommittedChanges: false },
      BEHIND_FRESHNESS,
    ]);

    expect(refreshCommands).toHaveLength(2);
    expect(commands[0]?.input[0]).toMatchObject({ text: "turn 1" });
    expect(commands[1]?.input[0]).toMatchObject({
      visibility: "agent-only",
      text: expect.stringContaining("12 commit(s) behind"),
    });
  });

  it("delivers negative freshness on the first turn after compaction", async () => {
    const compactInput = createStandaloneBuiltinCompactCommandInput();
    const { commands } = await prepareWorktreeTurns(
      [BEHIND_FRESHNESS, BEHIND_FRESHNESS],
      "codex",
      [compactInput, textInput("after compaction")],
    );

    expect(commands[0]?.input).toEqual(compactInput);
    expect(commands[1]?.input[0]).toMatchObject({
      visibility: "agent-only",
      text: expect.stringContaining("12 commit(s) behind"),
    });
  });

  it("stays silent once the workspace is current", async () => {
    const { commands } = await prepareWorktreeTurns([
      {
        ...BEHIND_FRESHNESS,
        behindCount: 0,
        hasUncommittedChanges: false,
      },
    ]);

    expect(commands[0]?.input[0]).toMatchObject({ text: "turn 1" });
  });

  it("reports unknown freshness instead of silence when the fetch fails", async () => {
    const { commands, recorded } = await prepareWorktreeTurns([
      { error: "could not resolve host github.com" },
    ]);
    const input = commands[0]?.input[0];

    expect(input).toMatchObject({
      visibility: "agent-only",
      text: expect.stringContaining(
        "Freshness relative to the remote is UNKNOWN",
      ),
    });
    expect(input).not.toMatchObject({
      text: expect.stringContaining("could not resolve host github.com"),
    });
    expect(recorded?.fetchError).toContain("could not resolve host github.com");
  });
});
