import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Plugin Directory ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PLUGIN_DIR = resolve(__dirname, "../claude");

// ── Environment Config ──

export const BACKOFF_BASE = parseInt(process.env.MOLCAJETE_BACKOFF_BASE ?? "30", 10);
export const MAX_TURNS_AGENT = process.env.MOLCAJETE_MAX_TURNS_AGENT ?? "250";
export const BUDGET_AGENT = process.env.MOLCAJETE_BUDGET_AGENT ?? "15.00";
export const TIMEOUT = parseInt(process.env.MOLCAJETE_TASK_TIMEOUT ?? "897", 10) * 1000;
export const MAX_DEV_CYCLES = 7;
export const BUDGET_RECOVERY = process.env.MOLCAJETE_BUDGET_RECOVERY ?? "8.00";
export const MODEL = process.env.MOLCAJETE_MODEL ?? "claude-sonnet-4-6";

// Injected into every spawned Claude session via --append-system-prompt.
// Pushes the model to batch independent tool calls into a single assistant
// turn with multiple tool_use blocks, instead of burning one turn per call.
export const PARALLEL_TOOLS_DIRECTIVE =
  "Parallelize independent tool calls. Whenever you need to read, grep, glob, or run independent Bash probes on multiple targets, issue them all in a single assistant turn with multiple tool_use blocks. Do not wait for one tool's result before issuing the next if they are independent. Sequential tool calls burn the turn budget and leave no room for implementation.";

// ── Hook Constants ──

export const MANDATORY_HOOKS = ["verify"];
export const ALL_HOOKS = [
  ...MANDATORY_HOOKS,
  "start",
  "stop",
  "before-task",
  "after-task",
  "before-subtask",
  "after-subtask",
  "before-review",
  "after-review",
  "before-worktree-create",
  "after-worktree-create",
  "before-worktree-merge",
  "after-worktree-merge",
  "before-documentation",
  "after-documentation",
];
export const HOOK_TIMEOUT = parseInt(process.env.MOLCAJETE_HOOK_TIMEOUT ?? "30000", 10);

// ── JSON Schemas for Session Outputs ──

export const DEV_SESSION_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "failed"] },
    files_modified: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    key_decisions: { type: "array", items: { type: "string" } },
    error: { type: ["string", "null"] },
  },
  required: ["status", "files_modified", "summary"],
};

export const REVIEW_SESSION_SCHEMA = {
  type: "object",
  properties: {
    code_review: { type: "array", items: { type: "string" } },
    completeness: { type: "array", items: { type: "string" } },
  },
  required: ["code_review", "completeness"],
};

export const DOC_SESSION_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "failed"] },
    files_modified: { type: "array", items: { type: "string" } },
    error: { type: ["string", "null"] },
  },
  required: ["status", "files_modified"],
};

export const RECOVERY_SESSION_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["recovered", "failed"] },
    actions_taken: { type: "array", items: { type: "string" } },
    files_modified: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    error: { type: ["string", "null"] },
  },
  required: ["status", "actions_taken", "files_modified", "summary"],
};

export const RESOLVE_CONFLICTS_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["resolved", "failed"] },
    files_resolved: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    error: { type: ["string", "null"] },
  },
  required: ["status", "files_resolved"],
};
