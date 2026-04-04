import type { HookContext, LintInput, LintOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repo root for tool paths (venvs, node_modules live in main repo, not worktrees).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const linters = [
    // __LINTERS__
];

/** Simple glob matcher for patterns like 'dir/**\/*.ext' */
function matchGlob(file: string, pattern: string): boolean {
  const parts = pattern.split('/**/');
  if (parts.length !== 2) return file === pattern;
  const dir = parts[0];
  const extPattern = parts[1];
  if (!file.startsWith(dir + '/') && !file.startsWith(dir)) return false;
  if (extPattern.startsWith('*.')) {
    const extPart = extPattern.slice(1);
    if (extPart.includes('{')) {
      const exts = extPart.slice(2, -1).split(',').map((e) => '.' + e);
      return exts.some((ext) => file.endsWith(ext));
    }
    return file.endsWith(extPart);
  }
  return true;
}

export default async function lint(
  ctx: HookContext<LintInput>,
): Promise<LintOutput> {
  const requestedFiles = ctx.input.files ?? [];
  const requestedServices = ctx.input.services ?? [];
  const issues: string[] = [];

  for (const lntr of linters) {
    if (requestedServices.length > 0 && !requestedServices.includes(lntr.service)) continue;

    let cmd: string;
    if (requestedFiles.length > 0) {
      let matched = requestedFiles.filter((f) => matchGlob(f, lntr.glob));
      if (matched.length === 0) continue;
      const cdMatch = lntr.command.match(/^cd\s+(\S+)\s+&&/);
      if (cdMatch) {
        const prefix = cdMatch[1] + '/';
        matched = matched.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
      }
      cmd = lntr.command.replace('{files}', matched.join(' '));
    } else {
      cmd = lntr.fallback;
    }

    // Resolve local tool paths to main repo
    cmd = cmd.replace(/\.venv\/bin\//g, `${repoRoot}/.venv/bin/`);

    try {
      execSync(cmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });
    } catch (err) {
      const output =
        ((err as { stdout?: string }).stdout ?? '') +
        '\n' +
        ((err as { stderr?: string }).stderr ?? '');
      const lines = output
        .trim()
        .split('\n')
        .filter((l) => l.trim())
        .slice(0, 200);

      for (const line of lines) {
        issues.push(`[${lntr.service}] ${line}`);
      }
    }
  }

  return { status: issues.length === 0 ? 'pass' : 'fail', issues };
}
