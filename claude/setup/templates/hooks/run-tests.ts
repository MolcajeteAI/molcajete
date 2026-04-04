import type { HookContext, RunTestsInput, RunTestsOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repo root for tool paths (venvs, node_modules live in main repo, not worktrees).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const bddCommand = '__BDD_COMMAND__';
const tagsFlag = '__TAGS_FLAG__';
const formatFlags = '__FORMAT_FLAGS__';
const tagJoin = '__TAG_JOIN__';

const SETUP_PATTERNS = [
  /connection refused/i,
  /connection timed out/i,
  /command not found/i,
  /no such file or directory/i,
  /module not found/i,
  /cannot find module/i,
  /not installed/i,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
];

export default async function runTests(
  ctx: HookContext<RunTestsInput>,
): Promise<RunTestsOutput> {
  let cmd = bddCommand;

  const tags = ctx.input.tags ?? [];
  if (tags.length > 0) {
    const tagExpr = tags.join(tagJoin);
    cmd += ` ${tagsFlag} "${tagExpr}"`;
  }

  if (formatFlags) {
    cmd += ` ${formatFlags}`;
  }

  // Resolve .venv/bin/ to repo root for worktree compat
  cmd = cmd.replace(/\.venv\/bin\//g, `${repoRoot}/.venv/bin/`);

  try {
    execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,
    });
    return { status: 'pass', failures: [], summary: 'All tests passed' };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const stdout = (err as { stdout?: string }).stdout ?? '';

    const isSetupError = SETUP_PATTERNS.some((p) => p.test(stderr) || p.test(stdout));

    if (isSetupError) {
      const combined = (stderr || stdout).trim();
      const errorLine =
        combined.split('\n').find((l) => SETUP_PATTERNS.some((p) => p.test(l))) ??
        combined.slice(0, 500);
      return {
        status: 'error',
        failures: [`Setup error: ${errorLine.trim().slice(0, 500)}`],
        summary: 'Test infrastructure is broken — cannot run tests',
      };
    }

    // Parse test output for individual failures
    const combined = stdout + '\n' + stderr;
    let failureLines: string[] | undefined;

    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        failureLines = [];
        for (const feature of parsed) {
          for (const el of (feature as Record<string, unknown[]>).elements ?? []) {
            for (const step of (el as Record<string, unknown[]>).steps ?? []) {
              const result = (step as Record<string, Record<string, unknown>>).result;
              if (result?.status === 'failed' || result?.status === 'error') {
                const loc = (feature as Record<string, string>).location ?? '';
                const msg =
                  (result?.error_message as string)?.split('\n')[0] ??
                  `${(step as Record<string, string>).keyword}${(step as Record<string, string>).name}`;
                failureLines.push(`[${loc}] ${(el as Record<string, string>).name}: ${msg}`);
              }
            }
          }
        }
      }
    } catch {
      // Not JSON — fall through to line-based parsing
    }

    if (!failureLines || failureLines.length === 0) {
      failureLines = combined
        .split('\n')
        .filter(
          (l) =>
            l.trim() &&
            /fail|error|assert/i.test(l) &&
            !l.trim().startsWith('{') &&
            !l.trim().startsWith('['),
        )
        .slice(0, 50);
    }

    return {
      status: 'fail',
      failures:
        failureLines.length > 0
          ? failureLines
          : [`Tests failed: exit code ${(err as { status?: number }).status}`],
      summary: `${failureLines.length} test failure(s)`,
    };
  }
}
