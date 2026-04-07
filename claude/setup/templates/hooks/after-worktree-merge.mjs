/**
 * -- After Worktree Merge Hook --
 *
 * Fires after a worktree branch is merged. Use it to clean up the
 * worktree, update tracking systems, or trigger downstream builds.
 *
 * -- When it fires --
 * After the merge completes and the worktree is removed.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id       - Task ID ("TASK-0A1B")
 * @property {string} branch        - Branch that was merged
 * @property {string} base_branch   - Branch it was merged into
 * @property {string} worktree_path - Path of the (now removed) worktree
 * @property {object} [build]       - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').WorktreeMergeInput} WorktreeMergeInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<WorktreeMergeInput>} ctx */
export default async function afterWorktreeMerge(ctx) {
  return { status: 'ok' };
}
