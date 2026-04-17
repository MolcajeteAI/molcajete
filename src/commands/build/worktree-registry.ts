import { emergencyCommitAndPush } from "../../lib/git.js";

export interface ActiveWorktree {
  taskId: string;
  worktreePath: string;
  branchName: string;
  remote: string;
}

const active = new Set<ActiveWorktree>();

export function registerWorktree(wt: ActiveWorktree): void {
  active.add(wt);
}

export function unregisterWorktree(wt: ActiveWorktree): void {
  active.delete(wt);
}

export function getActiveWorktrees(): ReadonlySet<ActiveWorktree> {
  return active;
}

/**
 * Best-effort commit + push across every registered worktree. Intended for
 * halt paths (SIGINT, SIGTERM, failed healthcheck) where in-flight worker
 * state would otherwise be lost. Writes one line per worktree to stderr so
 * the user can see what was rescued.
 *
 * Synchronous so it can run inside a signal handler; keeps going if an
 * individual worktree fails.
 */
export function sweepActiveWorktrees(reason: string): void {
  for (const wt of active) {
    const message = `wip(halt): ${reason} — preserving in-flight work for ${wt.taskId}`;
    const result = emergencyCommitAndPush(wt.worktreePath, wt.remote, message);
    const bits: string[] = [];
    if (result.committed) bits.push("committed");
    if (result.pushed) bits.push("pushed");
    if (!result.committed && !result.pushed && !result.error) bits.push("clean");
    const status = bits.length ? bits.join("+") : "noop";
    const suffix = result.error ? ` — ${result.error}` : "";
    process.stderr.write(`  sweep ${wt.taskId} (${wt.branchName}): ${status}${suffix}\n`);
  }
}
