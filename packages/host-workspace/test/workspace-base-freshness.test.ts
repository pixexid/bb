import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace.js";
import { runGit } from "../src/git.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runGit(args, { cwd })).stdout.trim();
}

async function configure(cwd: string): Promise<void> {
  await git(cwd, "config", "user.name", "BB Tests");
  await git(cwd, "config", "user.email", "bb@example.com");
}

async function createClonedWorkspace(): Promise<{
  originPath: string;
  clonePath: string;
  advanceOrigin: () => Promise<string>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-base-freshness-"));
  tempDirs.push(root);
  const originPath = path.join(root, "origin");
  const clonePath = path.join(root, "clone");
  await fs.mkdir(originPath, { recursive: true });
  await git(originPath, "init", "-b", "main");
  await configure(originPath);
  await fs.writeFile(path.join(originPath, "README.md"), "hello\n", "utf8");
  await git(originPath, "add", ".");
  await git(originPath, "commit", "-m", "initial");
  await git(root, "clone", originPath, clonePath);
  await configure(clonePath);
  let advanced = 0;
  return {
    originPath,
    clonePath,
    advanceOrigin: async () => {
      advanced += 1;
      await fs.writeFile(
        path.join(originPath, `remote-${advanced}.txt`),
        "new\n",
        "utf8",
      );
      await git(originPath, "add", ".");
      await git(originPath, "commit", "-m", `advance ${advanced}`);
      return git(originPath, "rev-parse", "HEAD");
    },
  };
}

describe("Workspace.refreshBase", () => {
  it("fast-forwards a clean workspace with no local commits", async () => {
    const { clonePath, advanceOrigin } = await createClonedWorkspace();
    const remoteSha = await advanceOrigin();

    const freshness = await new Workspace(clonePath).refreshBase({
      mergeBaseBranch: "main",
      allowFastForward: true,
    });

    expect(freshness).toMatchObject({
      remoteRef: "origin/main",
      remoteSha,
      headSha: remoteSha,
      aheadCount: 0,
      behindCount: 0,
      fastForwarded: true,
      fetchError: null,
    });
  });

  it.each([
    [
      "dirty",
      async (clonePath: string) => {
        await fs.writeFile(
          path.join(clonePath, "README.md"),
          "dirty\n",
          "utf8",
        );
      },
      { hasUncommittedChanges: true, aheadCount: 0 },
    ],
    [
      "locally ahead",
      async (clonePath: string) => {
        await fs.writeFile(path.join(clonePath, "local.txt"), "x\n", "utf8");
        await git(clonePath, "add", ".");
        await git(clonePath, "commit", "-m", "local");
      },
      { hasUncommittedChanges: false, aheadCount: 1 },
    ],
  ])(
    "preserves a %s workspace and reports exact counts",
    async (_label, mutate, expected) => {
      const { clonePath, advanceOrigin } = await createClonedWorkspace();
      const remoteSha = await advanceOrigin();
      await mutate(clonePath);
      const headBefore = await git(clonePath, "rev-parse", "HEAD");

      const freshness = await new Workspace(clonePath).refreshBase({
        mergeBaseBranch: "main",
        allowFastForward: true,
      });

      expect(freshness).toMatchObject({
        ...expected,
        remoteRef: "origin/main",
        remoteSha,
        headSha: headBefore,
        behindCount: 1,
        fastForwarded: false,
        fetchError: null,
      });
      expect(await git(clonePath, "rev-parse", "HEAD")).toBe(headBefore);
    },
  );

  it("reports a fetch failure instead of presenting the stale ref as current", async () => {
    const { clonePath, originPath, advanceOrigin } =
      await createClonedWorkspace();
    await advanceOrigin();
    await git(clonePath, "fetch", "origin");
    await git(clonePath, "merge", "--ff-only", "origin/main");
    await fs.rm(originPath, { recursive: true, force: true });
    const headBefore = await git(clonePath, "rev-parse", "HEAD");

    const freshness = await new Workspace(clonePath).refreshBase({
      mergeBaseBranch: "main",
      allowFastForward: true,
    });

    expect(freshness.behindCount).toBe(0);
    expect(freshness.fetchError).not.toBeNull();
    expect(freshness.fastForwarded).toBe(false);
    expect(await git(clonePath, "rev-parse", "HEAD")).toBe(headBefore);
  });
});
