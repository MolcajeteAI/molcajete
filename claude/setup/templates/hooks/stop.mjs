/**
 * -- Stop Hook --
 *
 * Environment teardown. Runs once after the build completes (success or
 * failure). Use it to stop services, clean up temp files, or collect logs.
 *
 * -- When it fires --
 * After all tasks finish or when the build halts due to failure.
 * The build stage in ctx.input.build.stage will be "stop" on success
 * or "failed"/"halted" on failure.
 *
 * -- Input (ctx.input) --
 * @property {object} [build] - BuildContext: plan metadata and completion status
 *
 * -- Expected output --
 * @returns {{ status: 'ok' | 'failed', summary?: string }}
 *
 * -- Examples --
 *
 *   // Clean shutdown:
 *   return { status: 'ok', summary: 'Docker containers stopped' };
 *
 *   // Teardown failed (logged but does not affect build result):
 *   return { status: 'failed', summary: 'Container cleanup timed out' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').StopInput} StopInput */
/** @typedef {import('@molcajeteai/cli').StopOutput} StopOutput */

/** @param {HookContext<StopInput>} ctx */
export default async function stop(ctx) {
  // __STOP_COMMAND__

  return { status: 'ok' };
}
