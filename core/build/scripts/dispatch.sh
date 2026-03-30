#!/usr/bin/env bash
set -euo pipefail

# dispatch.sh — Task-centric orchestration loop for /m:build.
#
# Usage: dispatch.sh <tasks.json path>
#
# Per task: create worktree -> run task agent -> review gate -> update architecture -> merge.
# Linear loop with dependency checking. All work inside task worktrees.

# ── Prerequisites ──

if ! command -v jq &>/dev/null; then
  echo "Error: jq required but not found. Install jq and retry." >&2
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI required but not found." >&2
  exit 1
fi

if [ $# -ne 1 ]; then
  echo "Usage: dispatch.sh <tasks.json>" >&2
  exit 1
fi

TASKS_JSON="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -f "$TASKS_JSON" ]; then
  echo "Error: tasks.json not found: $TASKS_JSON" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
PLAN_FILE="${PROJECT_ROOT}/$(jq -r '.plan_file' "$TASKS_JSON")"
BASE_BRANCH=$(jq -r '.base_branch' "$TASKS_JSON")
BDD_COMMAND=$(jq -r '.bdd_command' "$TASKS_JSON")

# ── Constants ──

MAX_RETRIES="${MOLCAJETE_MAX_RETRIES:-2}"
BACKOFF_BASE="${MOLCAJETE_BACKOFF_BASE:-30}"
MAX_TURNS_AGENT="${MOLCAJETE_MAX_TURNS_AGENT:-30}"
MAX_TURNS_REVIEW="${MOLCAJETE_MAX_TURNS_REVIEW:-15}"
BUDGET_AGENT="${MOLCAJETE_BUDGET_AGENT:-3.00}"
BUDGET_REVIEW="${MOLCAJETE_BUDGET_REVIEW:-1.50}"
TIMEOUT="${MOLCAJETE_TASK_TIMEOUT:-897}"

TASK_SCHEMA='{"type":"object","properties":{"status":{"type":"string","enum":["done","failed"]},"commits":{"type":"array","items":{"type":"string"}},"files_modified":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"},"key_decisions":{"type":"array","items":{"type":"string"}},"watch_outs":{"type":"array","items":{"type":"string"}},"error":{"type":["string","null"]}},"required":["status","commits","files_modified","summary"]}'

REVIEW_SCHEMA='{"type":"object","properties":{"verdict":{"type":"string","enum":["pass","fail"]},"gates":{"type":"object","properties":{"formatting":{"type":"string","enum":["pass","fail","skip"]},"linting":{"type":"string","enum":["pass","fail","skip"]},"bdd_tests":{"type":"string","enum":["pass","fail","skip"]},"code_review":{"type":"string","enum":["pass","fail"]},"completeness":{"type":"string","enum":["pass","fail"]}},"required":["formatting","linting","bdd_tests","code_review","completeness"]},"issues":{"type":"array","items":{"type":"object","properties":{"severity":{"type":"string","enum":["blocking","warning"]},"gate":{"type":"string"},"file":{"type":"string"},"description":{"type":"string"}},"required":["severity","gate","description"]}},"summary":{"type":"string"}},"required":["verdict","gates","issues","summary"]}'

ARCH_SCHEMA='{"type":"object","properties":{"status":{"type":"string","enum":["done","failed"]},"commit":{"type":["string","null"]},"sections_updated":{"type":"array","items":{"type":"string"}},"error":{"type":["string","null"]}},"required":["status"]}'

# ── Helpers ──

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

update_json() {
  # Usage: update_json '.jq.filter' "$TASKS_JSON"
  local filter="$1"
  local tmp="${TASKS_JSON}.tmp"
  jq "$filter" "$TASKS_JSON" > "$tmp" && mv "$tmp" "$TASKS_JSON"
}

invoke_claude() {
  # Wrapper for claude -p with rate limit retry.
  # First arg is working directory; remaining args passed to claude -p.
  # Stores output in $CLAUDE_OUTPUT
  local workdir="$1"; shift
  local attempt=0
  while [ $attempt -le $MAX_RETRIES ]; do
    CLAUDE_OUTPUT=$(cd "$workdir" && timeout "$TIMEOUT" claude -p "$@" 2>&1) && return 0
    local exit_code=$?
    if echo "$CLAUDE_OUTPUT" | grep -qi "rate.limit\|429\|too many requests"; then
      attempt=$((attempt + 1))
      local wait=$((BACKOFF_BASE * (2 ** (attempt - 1))))
      log "Rate limited. Retrying in ${wait}s (attempt $attempt/$MAX_RETRIES)..."
      sleep "$wait"
    else
      return $exit_code
    fi
  done
  log "Rate limit retries exhausted."
  return 1
}

parse_json_field() {
  # Extract a field from JSON output. Usage: parse_json_field "field" "$json"
  echo "$2" | jq -r ".$1 // empty" 2>/dev/null || echo ""
}

check_dependencies() {
  # Check if all dependencies for a task are implemented.
  # Usage: check_dependencies "$task_idx"
  # Returns 0 if all deps satisfied, 1 if any dep is failed, 2 if any dep is pending/in_progress.
  local task_idx="$1"
  local deps
  deps=$(jq -r ".tasks[$task_idx].depends_on[]" "$TASKS_JSON" 2>/dev/null) || true

  for dep_id in $deps; do
    local dep_status
    dep_status=$(jq -r ".tasks[] | select(.id == \"$dep_id\") | .status" "$TASKS_JSON")
    case "$dep_status" in
      implemented) continue ;;
      failed)      return 1 ;;
      *)           return 2 ;;
    esac
  done
  return 0
}

update_plan_status() {
  # Update the Status field for a task in the plan .md file.
  # Usage: update_plan_status "T-001" "implemented"
  local task_id="$1" new_status="$2"
  sed -i '' "
    /^### ${task_id}:/,/^### T-/{
      s/^\*\*Status:\*\* .*/**Status:** ${new_status}/
    }
  " "$PLAN_FILE"
}

write_plan_summary() {
  # Write summary content into a task's #### Summary block in the plan file.
  # Usage: write_plan_summary "T-001" "summary text"
  local task_id="$1" summary="$2"

  # Escape special characters for awk
  local escaped_summary
  escaped_summary=$(printf '%s' "$summary" | sed 's/[&/\]/\\&/g; s/$/\\/')
  escaped_summary=${escaped_summary%\\}

  awk -v tid="### ${task_id}:" -v summary="$summary" '
    BEGIN { in_task=0; found_summary=0 }
    /^### T-/ {
      if (in_task && !found_summary) { in_task=0 }
      if (index($0, tid) == 1) { in_task=1; found_summary=0 }
      else { in_task=0 }
    }
    in_task && /^#### Summary/ {
      print
      getline  # Skip the placeholder line
      print summary
      found_summary=1
      next
    }
    { print }
  ' "$PLAN_FILE" > "${PLAN_FILE}.tmp" && mv "${PLAN_FILE}.tmp" "$PLAN_FILE"
}

update_prd_statuses() {
  # After a build session, propagate implemented status up through the PRD:
  # UC files -> USE-CASES.md -> FEATURES.md
  # Only marks a UC as implemented when ALL its scenarios are covered by done_tags.

  local prd_dir="${PROJECT_ROOT}/prd"
  if [ ! -d "$prd_dir" ]; then
    log "Warning: prd/ directory not found — skipping PRD status update"
    return 0
  fi

  # Collect all done_tags from implemented tasks into a set (newline-separated)
  local done_tags
  done_tags=$(jq -r '[.tasks[] | select(.status == "implemented") | .done_tags[]] | unique | .[]' "$TASKS_JSON" 2>/dev/null) || true
  if [ -z "$done_tags" ]; then
    log "No done_tags found — skipping PRD status update"
    return 0
  fi

  # Collect unique UCs from implemented tasks
  local implemented_ucs
  implemented_ucs=$(jq -r '[.tasks[] | select(.status == "implemented") | .use_cases[]] | unique | .[]' "$TASKS_JSON" 2>/dev/null) || true
  if [ -z "$implemented_ucs" ]; then
    return 0
  fi

  # Track which features were affected for feature-level check
  local affected_features=""

  for uc_id in $implemented_ucs; do
    # Find the UC file (search across all domains)
    local uc_file
    uc_file=$(find "$prd_dir/domains" -path "*/use-cases/${uc_id}.md" -print -quit 2>/dev/null) || true
    if [ -z "$uc_file" ] || [ ! -f "$uc_file" ]; then
      log "Warning: UC file not found for $uc_id — skipping"
      continue
    fi

    # Extract all scenario IDs from this UC file
    local scenario_ids
    scenario_ids=$(grep -oE '^### SC-[A-Za-z0-9]+' "$uc_file" | sed 's/^### //' || true)
    if [ -z "$scenario_ids" ]; then
      continue
    fi

    # Check if every scenario's @tag is in the done_tags set
    local all_covered=true
    for sc_id in $scenario_ids; do
      if echo "$done_tags" | grep -qxF "@${sc_id}"; then
        :
      else
        all_covered=false
        break
      fi
    done

    if [ "$all_covered" = "true" ]; then
      # Update UC file frontmatter: status: pending/dirty -> status: implemented
      sed -i '' -E 's/^status: (pending|dirty)$/status: implemented/' "$uc_file"

      # Find the feature directory containing this UC
      local feature_dir
      feature_dir=$(dirname "$(dirname "$uc_file")")
      local use_cases_index="${feature_dir}/USE-CASES.md"

      if [ -f "$use_cases_index" ]; then
        # Update the UC's row in USE-CASES.md: replace pending/dirty with implemented
        sed -i '' -E "/^\\| *${uc_id} /s/\\| *(pending|dirty) *\\|/| implemented |/" "$use_cases_index"
      fi

      # Track the feature directory for feature-level check
      local feat_dir_name
      feat_dir_name=$(basename "$feature_dir")
      case "$affected_features" in
        *"$feat_dir_name"*) ;;
        *) affected_features="${affected_features}${feat_dir_name} " ;;
      esac

      log "PRD updated: $uc_id → implemented"
    fi
  done

  # Feature-level check: if all UCs in a feature are implemented, mark the feature
  for feat_dir_name in $affected_features; do
    [ -z "$feat_dir_name" ] && continue

    # Find the USE-CASES.md under the correct domain
    local use_cases_index
    use_cases_index=$(find "$prd_dir/domains" -path "*/${feat_dir_name}/USE-CASES.md" -print -quit 2>/dev/null) || true
    if [ -z "$use_cases_index" ] || [ ! -f "$use_cases_index" ]; then
      continue
    fi

    # Check if any UC row in USE-CASES.md is NOT implemented
    # Table rows start with "| UC-" — check if any have pending/dirty status
    local non_implemented
    non_implemented=$(grep -E '^\| *UC-' "$use_cases_index" | grep -vE '\| *implemented *\|' || true)

    if [ -z "$non_implemented" ]; then
      # All UCs implemented — find the domain's FEATURES.md and update it
      local domain_dir
      domain_dir=$(echo "$use_cases_index" | sed -E 's|/features/.*||')
      local features_md="${domain_dir}/FEATURES.md"
      if [ -f "$features_md" ]; then
        sed -i '' -E "/^\\| *${feat_dir_name} /s/\\| *(pending|dirty) *\\|/| implemented |/" "$features_md"
        log "PRD updated: ${feat_dir_name} → implemented (all UCs done)"
      fi
    fi
  done
}

# ── Task Functions ──

run_task() {
  # Execute one task via the task agent.
  # Usage: run_task "$task_id" "$worktree_path"
  local task_id="$1" worktree="$2"
  local session_name feat_id
  feat_id=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .feature" "$TASKS_JSON")
  session_name="${feat_id}-${task_id}"

  log "Task agent: $task_id ($session_name)"
  if invoke_claude "$worktree" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash,Agent" \
    --max-turns "$MAX_TURNS_AGENT" --max-budget-usd "$BUDGET_AGENT" \
    --output-format json --json-schema "$TASK_SCHEMA" \
    --name "$session_name" \
    --dangerously-skip-permissions \
    "/m:task $PLAN_FILE $task_id"; then

    local status
    status=$(parse_json_field "status" "$CLAUDE_OUTPUT")
    if [ "$status" = "done" ]; then
      local commits files_modified summary key_decisions watch_outs
      commits=$(echo "$CLAUDE_OUTPUT" | jq -c '.commits // []' 2>/dev/null)
      files_modified=$(echo "$CLAUDE_OUTPUT" | jq -c '.files_modified // []' 2>/dev/null)
      summary=$(parse_json_field "summary" "$CLAUDE_OUTPUT")
      key_decisions=$(echo "$CLAUDE_OUTPUT" | jq -r '.key_decisions // [] | join("; ")' 2>/dev/null)
      watch_outs=$(echo "$CLAUDE_OUTPUT" | jq -r '.watch_outs // [] | join("; ")' 2>/dev/null)

      update_json "(.tasks[] | select(.id == \"$task_id\")) |=
        (.commits = $commits | .error = null)"

      # Build full summary for plan file
      local full_summary="$summary"
      if [ -n "$key_decisions" ]; then
        full_summary="${full_summary}
Key decisions: ${key_decisions}"
      fi
      if [ -n "$watch_outs" ]; then
        full_summary="${full_summary}
Watch-outs: ${watch_outs}"
      fi

      # Store summary for later writing (after merge)
      TASK_SUMMARY="$full_summary"
      log "Task agent done: $task_id"
      return 0
    fi
  fi

  local error
  error=$(parse_json_field "error" "$CLAUDE_OUTPUT") || error="Task agent failed"
  update_json "(.tasks[] | select(.id == \"$task_id\")) |=
    (.status = \"failed\" | .error = \"$error\")"
  log "Task agent failed: $task_id ($error)"
  return 1
}

run_review() {
  # Run adversarial quality gate for a task.
  # Usage: run_review "$task_id" "$worktree_path"
  local task_id="$1" worktree="$2"
  local feat_id session_name
  feat_id=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .feature" "$TASKS_JSON")
  session_name="review-${feat_id}-${task_id}"

  log "Review agent: $task_id ($session_name)"
  invoke_claude "$worktree" \
    --model claude-sonnet-4-6 \
    --allowedTools "Read,Glob,Grep,Bash" \
    --max-turns "$MAX_TURNS_REVIEW" --max-budget-usd "$BUDGET_REVIEW" \
    --output-format json --json-schema "$REVIEW_SCHEMA" \
    --name "$session_name" \
    --dangerously-skip-permissions \
    "/m:review $PLAN_FILE $task_id"
}

run_review_fix() {
  # Resume the TASK AGENT session with review issues.
  # Usage: run_review_fix "$task_id" "$worktree_path" "$issues"
  local task_id="$1" worktree="$2" issues="$3"
  local feat_id session_name
  feat_id=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .feature" "$TASKS_JSON")
  session_name="${feat_id}-${task_id}"

  log "Review fix: resuming task session $session_name with review feedback"
  if invoke_claude "$worktree" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash,Agent" \
    --max-turns "$MAX_TURNS_AGENT" --max-budget-usd "$BUDGET_AGENT" \
    --output-format json --json-schema "$TASK_SCHEMA" \
    --resume "$session_name" \
    --dangerously-skip-permissions \
    "REVIEW FIX MODE — Do NOT re-run your full workflow. Focus only on the issues below.

For each issue:
1. Read the cited file
2. Fix the specific problem described
3. Run the formatter and linter on changed files
4. Re-run unit tests if production code changed

After fixing all issues, stage and commit:
  git add -A && git commit -m \"Fixes review issues for $task_id\"

Issues:
$issues"; then

    local status
    status=$(parse_json_field "status" "$CLAUDE_OUTPUT")
    if [ "$status" = "done" ]; then
      local new_commits
      new_commits=$(echo "$CLAUDE_OUTPUT" | jq -c '.commits // []' 2>/dev/null)
      update_json "(.tasks[] | select(.id == \"$task_id\") | .commits) += $new_commits"
      return 0
    fi
  fi
  return 1
}

run_architecture_update() {
  # Update ARCHITECTURE.md for the task's feature inside the worktree.
  # Usage: run_architecture_update "$task_id" "$worktree_path"
  local task_id="$1" worktree="$2"
  local feat_id
  feat_id=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .feature" "$TASKS_JSON")
  local session_name="arch-${feat_id}-${task_id}"

  log "Architecture update: $feat_id (from $task_id)"
  if invoke_claude "$worktree" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash,Agent" \
    --max-turns 15 --max-budget-usd 1.00 \
    --output-format json --json-schema "$ARCH_SCHEMA" \
    --name "$session_name" \
    --dangerously-skip-permissions \
    "/m:update-architecture $feat_id"; then

    local status
    status=$(parse_json_field "status" "$CLAUDE_OUTPUT")
    if [ "$status" = "done" ]; then
      local commit sections
      commit=$(parse_json_field "commit" "$CLAUDE_OUTPUT")
      sections=$(echo "$CLAUDE_OUTPUT" | jq -r '.sections_updated // [] | join(", ")' 2>/dev/null)
      log "Architecture updated: $feat_id ($sections) — commit $commit"
      return 0
    fi
  fi

  log "Warning: architecture update failed for $feat_id — continuing without it"
  return 0  # Non-fatal — don't fail the task over architecture docs
}

resolve_conflicts() {
  # Resolve rebase conflicts via Claude agent, then validate with BDD.
  # Usage: resolve_conflicts "$task_id" "$worktree_path"
  # Returns 0 if resolved + BDD passes, 1 otherwise.
  local task_id="$1" worktree="$2"
  local feat_id session_name
  feat_id=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .feature" "$TASKS_JSON")
  session_name="${feat_id}-${task_id}"

  # Gather context for the resolver
  local done_tags bdd_command done_signal tag_expr
  done_tags=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .done_tags[]" "$TASKS_JSON" | tr '\n' ' ')
  bdd_command=$(jq -r '.bdd_command' "$TASKS_JSON")
  done_signal=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .done_signal" "$TASKS_JSON")

  # Build tag expression for BDD
  tag_expr=$(echo "$done_tags" | xargs -n1 | sed 's/.*/"&"/' | paste -sd ' or ' -)

  log "Conflict resolution: rebasing $task_id onto $BASE_BRANCH"

  # Start the rebase (will stop at conflicts)
  git -C "$worktree" rebase "$BASE_BRANCH" 2>/dev/null || true

  # Build BDD validation instruction
  local bdd_instruction=""
  if [ "$done_signal" != "validator" ] && [ -n "$bdd_command" ] && [ "$bdd_command" != "null" ]; then
    bdd_instruction="After resolving all conflicts and completing the rebase, run the BDD tests to validate:
$bdd_command --tags=$tag_expr

If the tests fail, your resolution was incorrect — investigate and fix."
  fi

  # Invoke claude to resolve — resume the task agent session so it has full context
  local resolve_prompt="The branch needs to be rebased onto $BASE_BRANCH but there are merge conflicts.
A rebase is already in progress. Your job:

1. List conflicted files: git diff --name-only --diff-filter=U
2. Open each conflicted file, understand both sides using your knowledge of the spec and implementation
3. Resolve each conflict — remove all conflict markers, keep the correct combined code
4. Stage each resolved file: git add <file>
5. Continue the rebase: git rebase --continue
6. If more conflicts appear (multi-commit rebase), repeat steps 1-5
$bdd_instruction

Report status 'done' if rebase completes (and BDD passes if applicable), 'failed' otherwise."

  if invoke_claude "$worktree" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
    --max-turns "$MAX_TURNS_AGENT" --max-budget-usd "$BUDGET_AGENT" \
    --output-format json --json-schema "$TASK_SCHEMA" \
    --resume "$session_name" \
    --dangerously-skip-permissions \
    "$resolve_prompt"; then

    local status
    status=$(parse_json_field "status" "$CLAUDE_OUTPUT")
    if [ "$status" = "done" ]; then
      log "Conflicts resolved for $task_id"
      return 0
    fi
  fi

  # Resolution failed — abort any in-progress rebase
  git -C "$worktree" rebase --abort 2>/dev/null || true
  return 1
}

# ── Main Loop ──

log "Starting dispatch: $TASKS_JSON"
log "Plan: $PLAN_FILE | Base: $BASE_BRANCH"

TASK_COUNT=$(jq '.tasks | length' "$TASKS_JSON")
DONE_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0
ARCH_UPDATED_FEATURES=""

for task_idx in $(seq 0 $((TASK_COUNT - 1))); do
  TASK_ID=$(jq -r ".tasks[$task_idx].id" "$TASKS_JSON")
  TASK_TITLE=$(jq -r ".tasks[$task_idx].title" "$TASKS_JSON")
  TASK_STATUS=$(jq -r ".tasks[$task_idx].status" "$TASKS_JSON")
  TASK_FEAT=$(jq -r ".tasks[$task_idx].feature" "$TASKS_JSON")

  # Skip already completed tasks
  if [ "$TASK_STATUS" = "implemented" ]; then
    log "Skipping $TASK_ID (already implemented)"
    DONE_COUNT=$((DONE_COUNT + 1))
    continue
  fi

  log "━━━ Task: $TASK_ID — $TASK_TITLE ━━━"

  # Check dependencies
  dep_result=0
  check_dependencies "$task_idx" || dep_result=$?

  if [ $dep_result -eq 1 ]; then
    log "Skipping $TASK_ID: dependency failed"
    update_json "(.tasks[$task_idx].status) = \"failed\" | (.tasks[$task_idx].error) = \"Dependency failed\""
    update_plan_status "$TASK_ID" "failed"
    FAILED_COUNT=$((FAILED_COUNT + 1))
    continue
  fi

  if [ $dep_result -eq 2 ]; then
    log "Skipping $TASK_ID: dependency not yet implemented"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  # Update status to in_progress
  update_json "(.tasks[$task_idx].status) = \"in_progress\""
  update_plan_status "$TASK_ID" "in_progress"

  # Create or reuse worktree
  WORKTREE_BRANCH="dispatch/${TASK_FEAT}-${TASK_ID}"
  WORKTREE_PATH=".worktrees/${TASK_FEAT}-${TASK_ID}"

  if [ -d "$WORKTREE_PATH" ]; then
    # Worktree exists from a prior run — reuse it
    log "Reusing existing worktree: $WORKTREE_PATH"
  elif git show-ref --verify --quiet "refs/heads/$WORKTREE_BRANCH" 2>/dev/null; then
    # Branch exists but worktree was removed — prune stale refs and reattach
    git worktree prune 2>/dev/null || true
    git worktree add "$WORKTREE_PATH" "$WORKTREE_BRANCH" 2>/dev/null || {
      log "Error: could not reattach worktree for $TASK_ID"
      update_json "(.tasks[$task_idx].status) = \"failed\" | (.tasks[$task_idx].error) = \"Worktree creation failed\""
      update_plan_status "$TASK_ID" "failed"
      FAILED_COUNT=$((FAILED_COUNT + 1))
      continue
    }
  else
    # Fresh start — create new branch and worktree
    git worktree add -b "$WORKTREE_BRANCH" "$WORKTREE_PATH" "$BASE_BRANCH" 2>/dev/null || {
      log "Error: could not create worktree for $TASK_ID"
      update_json "(.tasks[$task_idx].status) = \"failed\" | (.tasks[$task_idx].error) = \"Worktree creation failed\""
      update_plan_status "$TASK_ID" "failed"
      FAILED_COUNT=$((FAILED_COUNT + 1))
      continue
    }
  fi
  WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

  # ── Phase 1: Task Agent ──
  TASK_SUMMARY=""
  task_attempt=0
  task_done=false

  while [ $task_attempt -le $MAX_RETRIES ] && [ "$task_done" = "false" ]; do
    if run_task "$TASK_ID" "$WORKTREE_PATH"; then
      task_done=true
    else
      task_attempt=$((task_attempt + 1))
      update_json "(.tasks[$task_idx].retries) = $task_attempt"
      if [ $task_attempt -le $MAX_RETRIES ]; then
        log "Task agent retry $task_attempt/$MAX_RETRIES for $TASK_ID"
      fi
    fi
  done

  if [ "$task_done" = "false" ]; then
    log "Task $TASK_ID failed after $MAX_RETRIES retries"
    update_json "(.tasks[$task_idx].status) = \"failed\""
    update_plan_status "$TASK_ID" "failed"
    FAILED_COUNT=$((FAILED_COUNT + 1))
    continue
  fi

  # ── Phase 2: Quality Gate (adversarial review) ──
  review_passed=false
  review_retries=0

  while [ $review_retries -le $MAX_RETRIES ] && [ "$review_passed" = "false" ]; do
    if run_review "$TASK_ID" "$WORKTREE_PATH"; then
      verdict=$(parse_json_field "verdict" "$CLAUDE_OUTPUT")
      if [ "$verdict" = "pass" ]; then
        review_passed=true
        # Log warnings if any
        warning_count=$(echo "$CLAUDE_OUTPUT" | jq '[.issues[] | select(.severity == "warning")] | length' 2>/dev/null) || warning_count=0
        if [ "$warning_count" -gt 0 ]; then
          log "Review passed with $warning_count warning(s)"
          warnings=$(echo "$CLAUDE_OUTPUT" | jq -r '.issues[] | select(.severity == "warning") | "  [\(.gate)] \(.file // "—"): \(.description)"' 2>/dev/null)
          log "$warnings"
        fi
        # Store review results in tasks.json
        gates_json=$(echo "$CLAUDE_OUTPUT" | jq -c '.gates // {}' 2>/dev/null)
        update_json "(.tasks[] | select(.id == \"$TASK_ID\")) |= (.review = {\"verdict\": \"pass\", \"gates\": $gates_json})"
        log "Review passed: $TASK_ID"
      else
        # Extract issues for task agent
        REVIEW_ISSUES=$(echo "$CLAUDE_OUTPUT" | jq -r '.issues[] | "[\(.gate)] \(.file // "—"): \(.description)"' 2>/dev/null)
        review_summary=$(parse_json_field "summary" "$CLAUDE_OUTPUT")
        log "Review failed: $review_summary"
        review_retries=$((review_retries + 1))
        if [ $review_retries -le $MAX_RETRIES ]; then
          log "Review fix attempt $review_retries/$MAX_RETRIES for $TASK_ID"
          run_review_fix "$TASK_ID" "$WORKTREE_PATH" "$REVIEW_ISSUES" || true
        fi
      fi
    else
      # invoke_claude failed (rate limit exhausted, etc.)
      review_retries=$((review_retries + 1))
    fi
  done

  if [ "$review_passed" = "false" ]; then
    log "Task $TASK_ID: review failed after $MAX_RETRIES fix attempts"
    log "Worktree preserved at: $WORKTREE_PATH"
    update_json "(.tasks[$task_idx].status) = \"failed\" | (.tasks[$task_idx].error) = \"Review gate failed\""
    update_plan_status "$TASK_ID" "failed"
    FAILED_COUNT=$((FAILED_COUNT + 1))
    continue
  fi

  # ── Phase 3: Architecture Update ──
  case "$ARCH_UPDATED_FEATURES" in
    *"$TASK_FEAT"*) log "Architecture already updated for $TASK_FEAT — skipping" ;;
    *)
      run_architecture_update "$TASK_ID" "$WORKTREE_PATH"
      ARCH_UPDATED_FEATURES="${ARCH_UPDATED_FEATURES}${TASK_FEAT} "
      ;;
  esac

  # ── Phase 4: Merge ──
  merge_result=0
  bash "$SCRIPT_DIR/merge.sh" "$WORKTREE_PATH" "$BASE_BRANCH" || merge_result=$?

  if [ $merge_result -eq 2 ]; then
    # Rebase conflicts — attempt resolution
    log "Task $TASK_ID: rebase conflicts detected, attempting resolution..."
    if resolve_conflicts "$TASK_ID" "$WORKTREE_PATH"; then
      # Resolution succeeded — retry merge (should be fast-forward now)
      merge_result=0
      bash "$SCRIPT_DIR/merge.sh" "$WORKTREE_PATH" "$BASE_BRANCH" || merge_result=$?
    else
      merge_result=1
    fi
  fi

  if [ $merge_result -eq 0 ]; then
    update_json "(.tasks[$task_idx].status) = \"implemented\" | (.tasks[$task_idx].error) = null"
    update_plan_status "$TASK_ID" "implemented"

    # Write summary to plan file after successful merge
    if [ -n "$TASK_SUMMARY" ]; then
      write_plan_summary "$TASK_ID" "$TASK_SUMMARY"
    fi

    log "Task $TASK_ID: implemented (merged to $BASE_BRANCH)"
    DONE_COUNT=$((DONE_COUNT + 1))
  else
    log "Task $TASK_ID: merge failed — worktree preserved at $WORKTREE_PATH"
    update_json "(.tasks[$task_idx].status) = \"failed\" | (.tasks[$task_idx].error) = \"Merge failed\""
    update_plan_status "$TASK_ID" "failed"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
done

# ── Completion Report ──

log "━━━ Dispatch Complete ━━━"
log "Implemented: $DONE_COUNT | Failed: $FAILED_COUNT | Skipped: $SKIPPED_COUNT | Total: $TASK_COUNT"
echo ""
echo "Task Status:"
for task_idx in $(seq 0 $((TASK_COUNT - 1))); do
  task_id=$(jq -r ".tasks[$task_idx].id" "$TASKS_JSON")
  task_title=$(jq -r ".tasks[$task_idx].title" "$TASKS_JSON")
  task_status=$(jq -r ".tasks[$task_idx].status" "$TASKS_JSON")
  task_error=$(jq -r ".tasks[$task_idx].error // empty" "$TASKS_JSON")

  case "$task_status" in
    implemented) printf "  %-8s  implemented  %s\n" "$task_id" "$task_title" ;;
    failed)      printf "  %-8s  failed       %s (%s)\n" "$task_id" "$task_title" "$task_error" ;;
    *)           printf "  %-8s  %-12s %s\n" "$task_id" "$task_status" "$task_title" ;;
  esac
done

# Update PRD statuses (UC files, USE-CASES.md, FEATURES.md)
if [ "$DONE_COUNT" -gt 0 ]; then
  update_prd_statuses
fi

# Update plan-level status (only the first **Status:** line — before any task headings)
ALL_IMPLEMENTED=$(jq '[.tasks[] | select(.status == "implemented")] | length' "$TASKS_JSON")
ANY_FAILED=$(jq '[.tasks[] | select(.status == "failed")] | length' "$TASKS_JSON")

if [ "$ALL_IMPLEMENTED" -eq "$TASK_COUNT" ]; then
  awk '/^### T-/{found=1} !found && /^\*\*Status:\*\*/{$0="**Status:** implemented"; done=1} {print}' "$PLAN_FILE" > "${PLAN_FILE}.tmp" && mv "${PLAN_FILE}.tmp" "$PLAN_FILE"
elif [ "$ANY_FAILED" -gt 0 ]; then
  awk '/^### T-/{found=1} !found && /^\*\*Status:\*\*/{$0="**Status:** failed"; done=1} {print}' "$PLAN_FILE" > "${PLAN_FILE}.tmp" && mv "${PLAN_FILE}.tmp" "$PLAN_FILE"
fi

[ "$FAILED_COUNT" -eq 0 ] && exit 0 || exit 1
