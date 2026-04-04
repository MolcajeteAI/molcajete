import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { HookMap, HookEntry, HookResult, HookFn } from '../../types.js';
import { MANDATORY_HOOKS, HOOK_TIMEOUT } from '../../lib/config.js';
import { log, isDebug } from '../../lib/utils.js';

// ── Lazy jiti loader for TypeScript hooks ──

interface JitiLoader {
  import(id: string): Promise<unknown>;
}

let jitiInstance: JitiLoader | undefined;

async function jitiImport(fullPath: string): Promise<Record<string, unknown>> {
  if (!jitiInstance) {
    const jiti = await import('jiti');
    const createJiti = (jiti as Record<string, unknown>).createJiti ?? (jiti as Record<string, unknown>).default;
    jitiInstance = (createJiti as (url: string | URL) => JitiLoader)(import.meta.url);
  }
  return (await jitiInstance.import(fullPath)) as Record<string, unknown>;
}

/**
 * Discover hooks in .molcajete/hooks/.
 * Returns { name: HookEntry } map.
 *
 * Priority: .ts > .hook.mjs > .mjs
 * - `*.ts` files (except types.ts) → version 2 (jiti import)
 * - `*.hook.mjs` files → version 2 (native import, backwards compat)
 * - `*.mjs` (no `.hook.`) → version 1 (child-process spawn)
 */
export async function discoverHooks(projectRoot: string): Promise<HookMap> {
  const hooksDir = join(projectRoot, '.molcajete/hooks');
  if (!existsSync(hooksDir)) return {};

  const entries = readdirSync(hooksDir, { withFileTypes: true });
  const hooks: HookMap = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filename = entry.name;
    const fullPath = join(hooksDir, filename);

    // v2: .ts files (highest priority, new convention)
    if (filename.endsWith('.ts') && filename !== 'types.ts') {
      const name = filename.replace(/(?:\.hook)?\.ts$/, '');

      try {
        const mod = await jitiImport(fullPath);
        if (typeof mod.default === 'function') {
          hooks[name] = { path: fullPath, version: 2, fn: mod.default as HookFn };
        } else {
          log(`Warning: v2 hook ${filename} has no default function export — skipping`);
        }
      } catch (err) {
        log(`Warning: failed to import v2 hook ${filename}: ${(err as Error).message}`);
      }
      continue;
    }

    // v2: .hook.mjs files (backwards compatible)
    if (filename.endsWith('.hook.mjs')) {
      const name = filename.replace(/\.hook\.mjs$/, '');
      if (hooks[name]) continue; // .ts has priority

      try {
        const mod = await import(fullPath);
        if (typeof mod.default === 'function') {
          hooks[name] = { path: fullPath, version: 2, fn: mod.default as HookFn };
        } else {
          log(`Warning: v2 hook ${filename} has no default function export — skipping`);
        }
      } catch (err) {
        log(`Warning: failed to import v2 hook ${filename}: ${(err as Error).message}`);
      }
      continue;
    }

    // v1: .mjs files (child-process spawn, lowest priority)
    if (filename.endsWith('.mjs')) {
      const name = filename.replace(/\.mjs$/, '');
      if (!hooks[name]) {
        hooks[name] = { path: fullPath, version: 1 };
      }
    }
  }

  return hooks;
}

/**
 * Validate that all mandatory hooks are present. Abort if any are missing.
 */
export function validateMandatoryHooks(hooks: HookMap): void {
  const missing = MANDATORY_HOOKS.filter((h) => !hooks[h]);
  if (missing.length > 0) {
    process.stderr.write(`Error: Missing mandatory hooks: ${missing.join(', ')}\n`);
    process.stderr.write('Run /m:setup or provide them manually in .molcajete/hooks/\n');
    process.exit(1);
  }
}

/**
 * Execute a hook. Dispatches to v2 (in-process) or v1 (child-process) based on entry version.
 */
export async function runHook(
  entry: HookEntry,
  input: Record<string, unknown>,
  {
    timeout = HOOK_TIMEOUT,
    cwd,
  }: { timeout?: number; cwd?: string } = {},
): Promise<HookResult> {
  if (entry.version === 2 && entry.fn) {
    return runHookV2(entry, input, { timeout });
  }
  return runHookV1(entry.path, input, { timeout, cwd });
}

/**
 * v2 hook execution: in-process function call with HookContext.
 */
async function runHookV2(
  entry: HookEntry,
  input: Record<string, unknown>,
  { timeout }: { timeout?: number },
): Promise<HookResult> {
  const hookName = basename(entry.path).replace(/(?:\.hook)?\.(?:mjs|ts)$/, '');

  if (isDebug()) {
    const YELLOW = '\x1b[33m';
    const RESET = '\x1b[0m';
    process.stderr.write('\n');
    log(`${YELLOW}$ hook (v2): ${hookName}${RESET}`);
    log(`${YELLOW}input: ${JSON.stringify(input)}${RESET}`);
    process.stderr.write('\n');
  }

  const ctx = {
    input,
    hook: {
      name: hookName,
      taskId: input.task_id as string | undefined,
      subtaskId: input.subtask_id as string | undefined,
    },
  };

  // Patch process.exit to prevent v2 hooks from killing the host process
  const originalExit = process.exit;
  let exitCalled = false;
  let exitCode = 0;
  process.exit = ((code?: number) => {
    exitCalled = true;
    exitCode = code ?? 0;
    throw new Error(`Hook ${hookName} called process.exit(${code})`);
  }) as never;

  try {
    const result = await Promise.race([
      entry.fn!(ctx as never),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Hook ${hookName} timed out after ${timeout}ms`)), timeout),
      ),
    ]);

    if (isDebug()) {
      const GRAY = '\x1b[90m';
      const RESET = '\x1b[0m';
      log(`${GRAY}output: ${JSON.stringify(result)}${RESET}`);
    }

    if (result && typeof result === 'object' && 'ok' in result) {
      return result as HookResult;
    }

    // Hook returned data directly (or void)
    const data = (result as unknown as Record<string, unknown>) ?? {};
    return { ok: true, data, stderr: '' };
  } catch (err) {
    if (exitCalled) {
      return { ok: exitCode === 0, data: {}, stderr: `Hook called process.exit(${exitCode})` };
    }
    return { ok: false, data: {}, stderr: (err as Error).message };
  } finally {
    process.exit = originalExit;
  }
}

/**
 * v1 hook execution: child-process spawn with JSON stdin/stdout.
 */
async function runHookV1(
  hookPath: string,
  input: Record<string, unknown>,
  { timeout = HOOK_TIMEOUT, cwd }: { timeout?: number; cwd?: string } = {},
): Promise<HookResult> {
  return new Promise((resolveP) => {
    const child = spawn(hookPath, [], {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const inputJson = JSON.stringify(input);
    child.stdin.write(inputJson);
    child.stdin.end();

    if (isDebug()) {
      const YELLOW = '\x1b[33m';
      const RESET = '\x1b[0m';
      process.stderr.write('\n');
      log(`${YELLOW}$ hook: ${basename(hookPath)}${RESET}`);
      log(`${YELLOW}input: ${inputJson}${RESET}`);
      process.stderr.write('\n');
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (code !== 0) {
        resolveP({ ok: false, data: {}, stderr: stderr || `Hook exited with code ${code}` });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        if (isDebug()) {
          const GRAY = '\x1b[90m';
          const RESET = '\x1b[0m';
          log(`${GRAY}output: ${stdout}${RESET}`);
        }
        resolveP({ ok: true, data, stderr });
      } catch {
        resolveP({ ok: false, data: {}, stderr: `Invalid JSON from hook: ${stdout.slice(0, 200)}` });
      }
    });
  });
}

/**
 * Try to run an optional hook. If the hook doesn't exist, returns null.
 */
export async function tryHook(
  hooks: HookMap,
  name: string,
  input: Record<string, unknown>,
  opts?: { timeout?: number; cwd?: string },
): Promise<HookResult | null> {
  if (!hooks[name]) return null;
  log(`Running hook: ${name}`);
  return runHook(hooks[name], input, opts);
}
