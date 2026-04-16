import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { HookMap, HookEntry, HookResult, HookFn } from "../../types.js";
import { MANDATORY_HOOKS, HOOK_TIMEOUT } from "../../lib/config.js";
import { log, logDetail, isDebug } from "../../lib/utils.js";
import { debugHookIn, debugHookOut } from "../../lib/format.js";

/**
 * Discover hooks in .molcajete/hooks/.
 * Returns { name: HookEntry } map.
 *
 * Only `.mjs` files are loaded, via native `import()`.
 */
export async function discoverHooks(projectRoot: string): Promise<HookMap> {
  const hooksDir = join(projectRoot, ".molcajete/hooks");
  if (!existsSync(hooksDir)) return {};

  const entries = readdirSync(hooksDir, { withFileTypes: true });
  const hooks: HookMap = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;

    const name = entry.name.replace(/\.mjs$/, "");
    const fullPath = join(hooksDir, entry.name);

    try {
      const mod = await import(fullPath);
      if (typeof mod.default === "function") {
        hooks[name] = { path: fullPath, fn: mod.default as HookFn };
      } else {
        log(`Warning: hook ${entry.name} has no default export — skipping`);
      }
    } catch (err) {
      log(`Warning: failed to import hook ${entry.name}: ${(err as Error).message}`);
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
    process.stderr.write(`Error: Missing mandatory hooks: ${missing.join(", ")}\n`);
    process.stderr.write("Run /m:setup or provide them manually in .molcajete/hooks/\n");
    process.exit(1);
  }
}

/**
 * Execute a hook — in-process function call with HookContext.
 */
export async function runHook(
  entry: HookEntry,
  input: Record<string, unknown>,
  { timeout = HOOK_TIMEOUT }: { timeout?: number } = {},
): Promise<HookResult> {
  const hookName = basename(entry.path).replace(/\.mjs$/, "");

  if (isDebug()) {
    process.stderr.write("\n");
    logDetail(debugHookIn(hookName, JSON.stringify(input)));
    process.stderr.write("\n");
  }

  const ctx = {
    input,
    hook: {
      name: hookName,
      taskId: input.task_id as string | undefined,
      subtaskId: input.subtask_id as string | undefined,
    },
  };

  // Patch process.exit to prevent hooks from killing the host process
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
      entry.fn?.(ctx as never),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Hook ${hookName} timed out after ${timeout}ms`)), timeout),
      ),
    ]);

    if (isDebug()) {
      logDetail(debugHookOut(JSON.stringify(result)));
    }

    if (result && typeof result === "object" && "ok" in result) {
      return result as HookResult;
    }

    // Hook returned data directly (or void)
    const data = (result as unknown as Record<string, unknown>) ?? {};
    return { ok: true, data, stderr: "" };
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
 * Try to run an optional hook. If the hook doesn't exist, returns null.
 */
export async function tryHook(
  hooks: HookMap,
  name: string,
  input: Record<string, unknown>,
  opts?: { timeout?: number },
): Promise<HookResult | null> {
  if (!hooks[name]) return null;
  log(`Running hook: ${name}`);
  return runHook(hooks[name], input, opts);
}
