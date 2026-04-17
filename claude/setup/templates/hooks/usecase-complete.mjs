/**
 * -- Use Case Complete Hook --
 *
 * Fires when all plan tasks associated with a use case are implemented.
 * Use it to run UC-level integration tests, update dashboards, or trigger
 * deployment pipelines scoped to a use case.
 *
 * -- When it fires --
 * After a task completes and all tasks referencing the same use_case ID
 * are now implemented. Fires in parallel with other done hooks
 * (scenario-complete, feature-complete, plan-complete) when multiple
 * boundaries are crossed simultaneously.
 *
 * -- Input (ctx.input) --
 * @property {string}  task          - Task ID that triggered completion
 * @property {string}  [scenario]    - Scenario ID if a scenario also completed (or undefined)
 * @property {string}  usecase       - Completed use case ID ("UC-XXXX")
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
 *   if (ctx.input.feature) return { status: 'ok' };
 *
 *   // Run all BDD scenarios for this use case:
 *   execSync(`make bdd-test T=@${ctx.input.usecase}`, { stdio: 'pipe' });
 *   return { status: 'ok' };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext} ctx */
export default async function usecaseComplete(ctx) {
  return { status: 'ok' };
}
