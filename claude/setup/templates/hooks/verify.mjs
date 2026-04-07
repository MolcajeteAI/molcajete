/**
 * -- Verify Hook (mandatory) --
 *
 * The quality gate. Runs after each development cycle to validate the
 * implementation: format -> lint -> BDD tests. If this hook returns
 * { status: 'failure' }, the build retries the task (up to maxDevCycles).
 *
 * -- When it fires --
 * After every dev session commit, before the task is marked implemented.
 * Scope "subtask" runs per sub-task; "task" runs once for the whole task;
 * "final" runs after all sub-tasks pass as a full-plan gate.
 *
 * -- Input (ctx.input) --
 * @property {string}   task_id  - Task or sub-task ID ("TASK-0A1B" or "TASK-0A1B-1")
 * @property {string}   commit   - SHA of the commit to verify
 * @property {string[]} files    - Files modified in this cycle
 * @property {string[]} tags     - Gherkin scenario tags to run (["@login", "@signup"])
 * @property {string}   scope    - "task" | "subtask" | "final"
 * @property {string}   [cwd]    - Worktree working directory (when using worktrees)
 * @property {string}   [branch] - Worktree branch name (when using worktrees)
 * @property {object}   [build]  - BuildContext: plan metadata and completion status
 *
 * -- Expected output --
 * @returns {{ status: 'success' | 'failure', issues: string[] }}
 *
 * -- Examples --
 *
 *   // All checks pass:
 *   return { status: 'success', issues: [] };
 *
 *   // Lint failure:
 *   return { status: 'failure', issues: ['ESLint: unused variable at src/auth.ts:42'] };
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').VerifyHookInput} VerifyHookInput */
/** @typedef {import('@molcajeteai/cli').VerifyHookOutput} VerifyHookOutput */

/** @param {HookContext<VerifyHookInput>} ctx */
export default async function verify(ctx) {
  const { files, tags, scope, cwd } = ctx.input;
  const opts = cwd ? { cwd } : {};
  const issues = [];

  // -- Format --
  // __FORMATTERS__

  // -- Lint --
  // __LINTERS__

  // -- BDD Tests --
  // __BDD__

  return { status: issues.length === 0 ? 'success' : 'failure', issues };
}
