/**
 * -- Start Hook --
 *
 * Environment bootstrap. Runs once at the very beginning of a build,
 * before any tasks are dispatched. Use it to spin up services, seed
 * databases, or prepare the workspace.
 *
 * -- When it fires --
 * Immediately after the plan is loaded and hooks are discovered,
 * before the first task begins.
 *
 * -- Input (ctx.input) --
 * @property {object} [build] - BuildContext: plan metadata and completion status
 *
 * -- Expected output --
 * @returns {{ status: 'ready' | 'failed', summary?: string }}
 *
 * -- Examples --
 *
 *   // Services started:
 *   return { status: 'ready', summary: 'Docker containers up' };
 *
 *   // Failure aborts the build:
 *   return { status: 'failed', summary: 'Database container failed to start' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').StartInput} StartInput */
/** @typedef {import('@molcajeteai/cli').StartOutput} StartOutput */

/** @param {HookContext<StartInput>} ctx */
export default async function start(ctx) {
  // __START_COMMAND__

  return { status: 'ready' };
}
