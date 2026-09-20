import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { environmentHostProgressSchema } from "bb-environment-provider-host/progress";

const gitBranchForbiddenCharacterPattern = /[\u0000-\u001f\u007f\\:~^?*\[]/u;
const gitReservedBranchNames = new Set([
  "AUTO_MERGE",
  "BISECT_HEAD",
  "CHERRY_PICK_HEAD",
  "FETCH_HEAD",
  "HEAD",
  "MERGE_HEAD",
  "ORIG_HEAD",
  "REVERT_HEAD",
]);
const gitBranchNameSchema = z.string().refine((name) => {
  const components = name.split("/");
  return (
    name.length > 0 &&
    name.trim().length > 0 &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    name !== "@" &&
    !gitReservedBranchNames.has(name) &&
    !gitBranchForbiddenCharacterPattern.test(name) &&
    !/[ \t]/u.test(name) &&
    !name.includes("..") &&
    !name.includes("@{") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    components.every(
      (component) =>
        component.length > 0 &&
        !component.startsWith(".") &&
        !component.endsWith(".lock"),
    )
  );
}, "Invalid git branch name");

export const worktreeBaseBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: gitBranchNameSchema }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);
export type WorktreeBaseBranch = z.infer<typeof worktreeBaseBranchSchema>;

export const discoveredWorktreeSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().nullable(),
    locked: z.boolean(),
    prunable: z.boolean(),
  })
  .strict();
export type DiscoveredWorktree = z.infer<typeof discoveredWorktreeSchema>;

export const worktreeHostContract = defineRpcContract({
  defaultBaseBranch: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.object({ branch: z.string().min(1).nullable() }).strict(),
  },
  listWorktrees: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.object({ worktrees: z.array(discoveredWorktreeSchema) }).strict(),
  },
  resolveExistingWorktree: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        path: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("resolved"),
          path: z.string().min(1),
          branch: z.string().nullable(),
        })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  create: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1),
        baseBranch: worktreeBaseBranchSchema,
        branchMode: z.enum(["reset", "reuse-existing"]),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          baseBranch: z.string().min(1).nullable(),
          baseSha: z.string().min(1).nullable(),
        })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  remove: {
    input: z
      .object({
        operationId: z.string().min(1),
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
});

export const worktreeHostSignals = {
  progress: {
    payload: environmentHostProgressSchema,
  },
} as const;
