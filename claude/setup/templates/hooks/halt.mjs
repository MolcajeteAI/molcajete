/**
 * -- Halt Hook --
 *
 * Emergency teardown. Fires when the build is being abandoned mid-flight
 * (currently: only when the healthcheck hook reports failure). Distinct
 * from stop, which runs at normal end-of-build.
 *
 * Use it to: tear down partial state, notify on-call, write a halt marker,
 * post to Slack, etc. Failures here are logged but do not affect exit code.
 *
 * -- When it fires --
 * After the healthcheck hook returns failure. Immediately before the build
 * exits non-zero. The plan status is left untouched so `molcajete build
 * --resume` picks up the same task once infra is fixed.
 *
 * -- Input (ctx.input) --
 * @property {object}   build  - BuildContext (build.stage === "halted")
 * @property {string[]} issues - The issue strings from the healthcheck hook
 *
 * -- Expected output --
 * @returns {{ status: 'ok' | 'failed', summary?: string }}
 *
 * -- Examples --
 *
 *   // Quietly acknowledge:
 *   return { status: 'ok' };
 *
 *   // With a side effect:
 *   await notifySlack(`Build halted: ${ctx.input.issues.join('; ')}`);
 *   return { status: 'ok', summary: 'on-call notified' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').HaltHookInput} HaltHookInput */

/** @param {HookContext<HaltHookInput>} ctx */
export default async function halt(ctx) {
  // __HALT_COMMAND__

  return { status: 'ok' };
}
