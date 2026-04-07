/**
 * -- Before Worktree Merge Hook --
 *
 * Fires before a worktree branch is merged back into the base branch.
 * Use it to run final checks, lock resources, or snapshot state.
 *
 * -- When it fires --
 * After the task passes all quality gates, before the merge operation.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id       - Task ID ("TASK-0A1B")
 * @property {string} branch        - Worktree branch to be merged
 * @property {string} base_branch   - Target branch for the merge
 * @property {string} worktree_path - Path of the worktree
 * @property {object} [build]       - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').WorktreeMergeInput} WorktreeMergeInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<WorktreeMergeInput>} ctx */
export default async function beforeWorktreeMerge(ctx) {
  return { status: 'ok' };
}
