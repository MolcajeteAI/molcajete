import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { HookMap, HookResult, Settings } from '../../types.js';
import { MANDATORY_HOOKS, HOOK_TIMEOUT } from '../../lib/config.js';
import { log, sleep, isDebug } from '../../lib/utils.js';

/**
 * Discover hooks in .molcajete/hooks/.
 * Returns { name: absolutePath } map, keyed by filename without extension.
 */
export function discoverHooks(projectRoot: string): HookMap {
  const hooksDir = join(projectRoot, '.molcajete/hooks');
  if (!existsSync(hooksDir)) return {};

  const entries = readdirSync(hooksDir, { withFileTypes: true });
  const hooks: HookMap = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.replace(/\.[^.]+$/, '');
    hooks[name] = join(hooksDir, entry.name);
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
 * Execute a hook script. Pipes JSON input via stdin, parses JSON output from stdout.
 */
export async function runHook(
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

/**
 * Poll health-check hook every 10s until all services report ready or timeout.
 */
export async function pollHealthCheck(
  hooks: HookMap,
  timeoutMs: number,
  { cwd }: { cwd?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const intervalMs = 10_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await runHook(hooks['health-check'], {}, { cwd });

    if (result.ok && (result.data as Record<string, unknown>).status === 'ready') {
      const services = (result.data as Record<string, unknown>).services as Record<string, string> | undefined;
      if (services) {
        for (const [name, status] of Object.entries(services)) {
          log(`  ${name}: ${status}`);
        }
      }
      log('All services ready');
      return { ok: true };
    }

    const services = (result.data as Record<string, unknown>).services as Record<string, string> | undefined;
    if (result.ok && services) {
      for (const [name, status] of Object.entries(services)) {
        log(`  ${name}: ${status}`);
      }
    } else if (!result.ok) {
      log(`  health-check: hook error (${result.stderr.slice(0, 100)})`);
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    log(`Services not ready — retrying in 10s (${remaining}s remaining)`);
    await sleep(intervalMs);
  }

  return { ok: false, error: `Health check timed out after ${Math.round(timeoutMs / 1000)}s` };
}

/**
 * Start environment via start hook (optional) then poll health-check.
 */
export async function startEnvironment(
  hooks: HookMap,
  settings: Settings,
  { cwd }: { cwd?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  log('Starting environment...');
  const startResult = await tryHook(hooks, 'start', {}, { cwd });
  if (startResult && !startResult.ok) {
    return { ok: false, error: `Start hook failed: ${startResult.stderr}` };
  }
  if (startResult && (startResult.data as Record<string, unknown>).status === 'failed') {
    return { ok: false, error: (startResult.data as Record<string, unknown>).summary as string || 'Start hook reported failure' };
  }

  log('Waiting for services...');
  return pollHealthCheck(hooks, settings.startTimeout, { cwd });
}

/**
 * Stop environment via stop hook (optional).
 */
export async function stopEnvironment(
  hooks: HookMap,
  { cwd }: { cwd?: string } = {},
): Promise<void> {
  log('Stopping environment...');
  const result = await tryHook(hooks, 'stop', {}, { cwd });
  if (result && !result.ok) {
    log(`Warning: stop hook failed: ${result.stderr}`);
  }
}
