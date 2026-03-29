#!/usr/bin/env bash
set -euo pipefail

# merge.sh — Merge a task worktree branch into the base branch.
#
# Usage: merge.sh <worktree-path> <base-branch>
#
# Exit codes:
#   0  Merge succeeded, worktree cleaned up
#   1  Merge failed (conflict or error), worktree preserved for inspection

if [ $# -ne 2 ]; then
  echo "Usage: merge.sh <worktree-path> <base-branch>" >&2
  exit 1
fi

WORKTREE_PATH="$1"
BASE_BRANCH="$2"

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "Error: worktree path does not exist: $WORKTREE_PATH" >&2
  exit 1
fi

# Get the branch name used by the worktree
WORKTREE_BRANCH=$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD)

if [ -z "$WORKTREE_BRANCH" ]; then
  echo "Error: could not determine branch for worktree: $WORKTREE_PATH" >&2
  exit 1
fi

# Find the main working directory (where the base branch lives)
MAIN_WORKTREE=$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir)
MAIN_WORKTREE=$(dirname "$MAIN_WORKTREE")

# Merge the worktree branch into the base branch
if ! git -C "$MAIN_WORKTREE" checkout "$BASE_BRANCH" 2>/dev/null; then
  echo "Error: could not checkout base branch: $BASE_BRANCH" >&2
  exit 1
fi

if git -C "$MAIN_WORKTREE" merge --no-edit "$WORKTREE_BRANCH"; then
  # Merge succeeded — clean up worktree and branch
  git -C "$MAIN_WORKTREE" worktree remove "$WORKTREE_PATH" 2>/dev/null || true
  git -C "$MAIN_WORKTREE" branch -d "$WORKTREE_BRANCH" 2>/dev/null || true
  echo "Merged $WORKTREE_BRANCH into $BASE_BRANCH and cleaned up worktree."
else
  # Merge failed — abort and preserve worktree for inspection
  git -C "$MAIN_WORKTREE" merge --abort 2>/dev/null || true
  echo "Error: merge conflict merging $WORKTREE_BRANCH into $BASE_BRANCH" >&2
  echo "Worktree preserved at: $WORKTREE_PATH" >&2
  exit 1
fi
