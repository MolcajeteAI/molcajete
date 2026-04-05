import type { HookContext, VerifyHookInput, VerifyHookOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

/**
 * Mandatory verify hook — runs format, lint, and BDD checks after each dev
 * session commit and before the AI review session. Emit any non-zero output
 * as an `issues[]` entry so the review session can pick them up.
 */
export default async function verify(
  ctx: HookContext<VerifyHookInput>,
): Promise<VerifyHookOutput> {
  const { scope, files, tags } = ctx.input;
  const issues: string[] = [];

  // 1. Format — __FORMATTERS__ (filled by setup)
  const formatters: Array<{ service: string; command: string; fallback: string }> = [
    // __FORMATTERS__
  ];

  for (const fmt of formatters) {
    const cmd = files.length > 0 ? fmt.command.replace('{files}', files.join(' ')) : fmt.fallback;
    try {
      execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    } catch (err) {
      const out =
        ((err as { stdout?: string }).stdout ?? '') +
        '\n' +
        ((err as { stderr?: string }).stderr ?? '');
      issues.push(`[format:${fmt.service}] ${out.trim().slice(0, 500)}`);
    }
  }

  // 2. Lint — __LINTERS__ (filled by setup)
  const linters: Array<{ service: string; command: string; fallback: string }> = [
    // __LINTERS__
  ];

  for (const lnt of linters) {
    const cmd = files.length > 0 ? lnt.command.replace('{files}', files.join(' ')) : lnt.fallback;
    try {
      execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
    } catch (err) {
      const out =
        ((err as { stdout?: string }).stdout ?? '') +
        '\n' +
        ((err as { stderr?: string }).stderr ?? '');
      issues.push(`[lint:${lnt.service}] ${out.trim().slice(0, 500)}`);
    }
  }

  // 3. BDD — __BDD_COMMAND__ (filled by setup). Skipped for sub-task scope.
  if (scope !== 'subtask') {
    const bddCommand = '__BDD_COMMAND__';
    const tagsFlag = '__TAGS_FLAG__';
    const tagJoin = '__TAG_JOIN__';

    if (bddCommand && bddCommand !== '__BDD_COMMAND__') {
      let cmd = bddCommand;
      if (tags.length > 0) {
        cmd += ` ${tagsFlag} "${tags.join(tagJoin)}"`;
      }
      try {
        execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 });
      } catch (err) {
        const out =
          ((err as { stdout?: string }).stdout ?? '') +
          '\n' +
          ((err as { stderr?: string }).stderr ?? '');
        issues.push(`[bdd] ${out.trim().slice(0, 1000)}`);
      }
    }
  }

  return { status: issues.length ? 'failure' : 'success', issues };
}
