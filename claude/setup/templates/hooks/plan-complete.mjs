/**
 * -- Plan Complete Hook --
 *
 * Fires when all tasks in the plan are implemented. Use it to run full
 * regression suites, generate release notes, deploy to staging, or send
 * build-complete notifications.
 *
 * -- When it fires --
 * After the final task completes and every task in the plan has status
 * "implemented". Fires in parallel with other done hooks
 * (scenario-complete, usecase-complete, feature-complete) when multiple
 * boundaries are crossed simultaneously.
 *
 * -- Input (ctx.input) --
 * @property {string}  task          - Task ID that triggered completion
 * @property {string}  [scenario]    - Scenario ID if a scenario also completed (or undefined)
 * @property {string}  [usecase]     - UC ID if a UC also completed (or undefined)
 * @property {string}  [feature]     - Feature ID if a feature also completed (or undefined)
 * @property {boolean} plan_complete - Always true when this hook fires
 * @property {object}  build         - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 *
 * -- Examples --
 *
 *   // Run full BDD regression:
 *   execSync('make bdd-test', { stdio: 'pipe' });
 *   return { status: 'ok' };
 *
 *   // Notify Slack:
 *   await notifySlack(`Build ${ctx.input.build.plan_name} complete!`);
 *   return { status: 'ok' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext} ctx */
export default async function planComplete(ctx) {
  return { status: 'ok' };
}
