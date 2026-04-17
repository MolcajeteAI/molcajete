/**
 * -- Scenario Complete Hook --
 *
 * Fires when all plan tasks associated with a scenario are implemented.
 * Use it to run scenario-level regression, post notifications, or trigger
 * downstream pipelines scoped to a single scenario.
 *
 * -- When it fires --
 * After a task completes and all tasks referencing the same scenario ID
 * are now implemented. Fires in parallel with other done hooks
 * (usecase-complete, feature-complete, plan-complete) when multiple
 * boundaries are crossed simultaneously.
 *
 * -- Input (ctx.input) --
 * @property {string}  task          - Task ID that triggered completion
 * @property {string}  scenario      - Completed scenario ID ("SC-XXXX")
 * @property {string}  [usecase]     - UC ID if the UC also completed (or undefined)
 * @property {string}  [feature]     - Feature ID if the feature also completed (or undefined)
 * @property {boolean} [plan_complete] - True if all plan tasks are now done
 * @property {object}  build         - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 *
 * -- Examples --
 *
 *   // Skip if a higher-level hook will handle it:
 *   if (ctx.input.usecase || ctx.input.feature) return { status: 'ok' };
 *
 *   // Run BDD tests for the completed scenario:
 *   execSync(`make bdd-test T=@${ctx.input.scenario}`, { stdio: 'pipe' });
 *   return { status: 'ok' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext} ctx */
export default async function scenarioComplete(ctx) {
  return { status: 'ok' };
}
