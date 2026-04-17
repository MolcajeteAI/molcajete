/**
 * -- Feature Complete Hook --
 *
 * Fires when all plan tasks associated with a feature are implemented.
 * Use it to run feature-level regression, send release notifications, or
 * trigger deployment pipelines scoped to an entire feature.
 *
 * -- When it fires --
 * After a task completes and all tasks referencing the same feature ID
 * are now implemented. Fires in parallel with other done hooks
 * (scenario-complete, usecase-complete, plan-complete) when multiple
 * boundaries are crossed simultaneously.
 *
 * -- Input (ctx.input) --
 * @property {string}  task          - Task ID that triggered completion
 * @property {string}  [scenario]    - Scenario ID if a scenario also completed (or undefined)
 * @property {string}  [usecase]     - UC ID if a UC also completed (or undefined)
 * @property {string}  feature       - Completed feature ID ("FEAT-XXXX")
 * @property {boolean} [plan_complete] - True if all plan tasks are now done
 * @property {object}  build         - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 *
 * -- Examples --
 *
 *   // Run full regression for the feature:
 *   execSync(`make bdd-test T=@${ctx.input.feature}`, { stdio: 'pipe' });
 *   return { status: 'ok' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext} ctx */
export default async function featureComplete(ctx) {
  return { status: 'ok' };
}
