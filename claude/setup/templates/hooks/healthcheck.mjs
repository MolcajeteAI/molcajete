/**
 * -- Healthcheck Hook --
 *
 * Infra preflight. Runs after the start hook and again before each task.
 * Returns the same shape as verify: empty issues = healthy. On failure the
 * build halts immediately (no recovery) and the halt hook fires.
 *
 * -- When it fires --
 * Once after the start hook succeeds, then again at the top of each task
 * iteration (before any dev/verify/review work). Catches transient infra
 * failures (Docker daemon down, network unreachable, missing CLI binary).
 *
 * -- Input (ctx.input) --
 * @property {string} [cwd]   - Project working directory
 * @property {object} [build] - BuildContext: plan metadata and stage
 *
 * -- Expected output --
 * @returns {{ status: 'success' | 'failure', issues: string[] }}
 *
 * -- Examples --
 *
 *   // All probes pass:
 *   return { status: 'success', issues: [] };
 *
 *   // Docker daemon down — build halts, halt hook fires:
 *   return { status: 'failure', issues: ['Docker daemon not reachable'] };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').HealthcheckHookInput} HealthcheckHookInput */
/** @typedef {import('@molcajeteai/cli').HealthcheckHookOutput} HealthcheckHookOutput */

/** @param {HookContext<HealthcheckHookInput>} ctx */
export default async function healthcheck(ctx) {
  const issues = [];

  // __HEALTHCHECK_PROBES__

  return { status: issues.length === 0 ? 'success' : 'failure', issues };
}
