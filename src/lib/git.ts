import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESOLVE_CONFLICTS_SCHEMA } from './config.js';
import type { ResolveConflictsOutput } from '../types.js';

export interface GitResult {
  status: 'success' | 'failure';
  commit?: string;
  error?: string;
}

export interface MergeOptions {
  ffOnly?: boolean;
}

// ── Helpers ──

function head(): string {
  return execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();
}

function hasConflicts(): boolean {
  const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
  return /^(UU|AA|DD|AU|UA|DU|UD) /m.test(status);
}

function conflictedFiles(): string[] {
  const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
  const files: string[] = [];
  for (const line of status.split('\n')) {
    if (/^(UU|AA|DD|AU|UA|DU|UD) /.test(line)) {
      files.push(line.slice(3));
    }
  }
  return files;
}

function detectOperation(cwd: string): 'merge' | 'rebase' | null {
  const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' }).toString().trim();
  if (existsSync(resolve(cwd, gitDir, 'MERGE_HEAD'))) return 'merge';
  if (existsSync(resolve(cwd, gitDir, 'rebase-merge')) || existsSync(resolve(cwd, gitDir, 'rebase-apply'))) return 'rebase';
  return null;
}

async function spawnClaudeResolve(cwd: string, payload: Record<string, unknown>): Promise<ResolveConflictsOutput> {
  // Lazy import to avoid circular dependency with CLI-only code
  const { invokeClaude, extractStructuredOutput } = await import('../commands/lib/claude.js');

  const result = await invokeClaude(cwd, [
    '--model', 'sonnet',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    '--max-turns', '30',
    '--json-schema', JSON.stringify(RESOLVE_CONFLICTS_SCHEMA),
    '--name', 'resolve-conflicts',
    `/molcajete:resolve-conflicts ${JSON.stringify(payload)}`,
  ]);

  return extractStructuredOutput(result.output) as unknown as ResolveConflictsOutput;
}

export interface PushResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Push the current branch to the given remote.
 *
 * - Detached HEAD → skip (warning)
 * - Remote missing → skip (warning)
 * - Missing upstream → retry once with `-u`
 * - Other failures → { ok: false, error }
 *
 * Never throws.
 */
export function pushCurrentBranch(remote: string): PushResult {
  // Resolve current branch
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim();
  } catch (err) {
    return { ok: false, skipped: true, error: `could not resolve HEAD: ${(err as Error).message}` };
  }

  if (branch === 'HEAD') {
    return { ok: false, skipped: true, error: 'detached HEAD' };
  }

  // Verify remote exists
  try {
    execSync(`git remote get-url ${remote}`, { stdio: 'pipe' });
  } catch {
    return { ok: false, skipped: true, error: `no remote '${remote}'` };
  }

  // Attempt push
  try {
    execSync(`git push ${remote} HEAD`, { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    const msg = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim();
    // Retry once with -u for missing upstream
    if (/has no upstream branch|set-upstream|--set-upstream/i.test(msg)) {
      try {
        execSync(`git push -u ${remote} HEAD`, { stdio: 'pipe' });
        return { ok: true };
      } catch (err2) {
        const msg2 = ((err2 as { stderr?: Buffer }).stderr?.toString() ?? (err2 as Error).message).trim();
        return { ok: false, error: msg2 };
      }
    }
    return { ok: false, error: msg };
  }
}

// ── Public API ──

export async function merge(base: string, branch: string, options?: MergeOptions): Promise<GitResult> {
  const ffOnly = options?.ffOnly ?? true;
  const cwd = process.cwd();

  try {
    if (ffOnly) {
      try {
        execSync(`git merge --ff-only ${branch}`, { cwd, stdio: 'pipe' });
        return { status: 'success', commit: head() };
      } catch {
        return { status: 'failure', error: 'Not fast-forwardable — rebase first' };
      }
    }

    // Non-ff merge
    try {
      execSync(`git merge ${branch}`, { cwd, stdio: 'pipe' });
      return { status: 'success', commit: head() };
    } catch {
      if (!hasConflicts()) {
        return { status: 'failure', error: 'Merge failed (no conflicts detected)' };
      }

      const result = await resolveConflicts();

      if (result.status === 'failure') {
        try { execSync('git merge --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
        return result;
      }

      return result;
    }
  } catch (err) {
    return { status: 'failure', error: (err as Error).message };
  }
}

export async function rebase(onto: string, branch: string): Promise<GitResult> {
  const cwd = process.cwd();

  try {
    execSync(`git checkout ${branch}`, { cwd, stdio: 'pipe' });
  } catch (err) {
    return { status: 'failure', error: `Failed to checkout ${branch}: ${(err as Error).message}` };
  }

  try {
    execSync(`git rebase ${onto}`, { cwd, stdio: 'pipe' });
    return { status: 'success', commit: head() };
  } catch {
    if (!hasConflicts()) {
      try { execSync('git rebase --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
      return { status: 'failure', error: 'Rebase failed (no conflicts detected)' };
    }

    const result = await resolveConflicts();

    if (result.status === 'failure') {
      try { execSync('git rebase --abort', { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
      return result;
    }

    return result;
  }
}

export async function resolveConflicts(): Promise<GitResult> {
  const cwd = process.cwd();
  const files = conflictedFiles();

  if (files.length === 0) {
    return { status: 'failure', error: 'No conflicts detected' };
  }

  const operation = detectOperation(cwd);
  if (!operation) {
    return { status: 'failure', error: 'No merge or rebase in progress' };
  }

  // Gather ref info for context
  let baseRef = '';
  let incomingRef = '';
  try {
    if (operation === 'merge') {
      baseRef = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
      incomingRef = execSync('git rev-parse MERGE_HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    } else {
      const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' }).toString().trim();
      baseRef = execSync(`cat ${gitDir}/rebase-merge/onto`, { cwd, stdio: 'pipe' }).toString().trim();
      incomingRef = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    }
  } catch { /* non-fatal — Claude can still resolve without refs */ }

  const payload = {
    conflicted_files: files,
    operation,
    base_ref: baseRef,
    incoming_ref: incomingRef,
  };

  const output = await spawnClaudeResolve(cwd, payload);

  if (output.status !== 'resolved') {
    return { status: 'failure', error: output.error || 'Conflict resolution failed' };
  }

  // Complete the operation
  try {
    if (operation === 'merge') {
      execSync('git commit --no-edit', { cwd, stdio: 'pipe' });
    } else {
      execSync('git rebase --continue', { cwd, stdio: 'pipe', env: { ...process.env, GIT_EDITOR: 'true' } });
    }
    return { status: 'success', commit: head() };
  } catch (err) {
    return { status: 'failure', error: `Failed to complete ${operation}: ${(err as Error).message}` };
  }
}
