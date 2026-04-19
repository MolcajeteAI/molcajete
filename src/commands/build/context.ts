import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSubTaskId, parentTaskId } from "../../lib/utils.js";
import type { PlanData, Task } from "../../types.js";
import { findTask } from "./plan-data.js";

/**
 * Pre-resolved context for a task, ready to be serialized into the dev session payload.
 * Eliminates the need for the LLM to discover files, read the plan, or glob for paths.
 */
export interface ResolvedTaskContext {
  /** The task JSON object from plan.json */
  task: Task;
  /** The extracted ### T-NNN section from plan.md (implementation narrative) */
  plan_section: string;
  /** Gherkin feature file content for the task's use case */
  gherkin: string;
  /** Content of bdd/steps/INDEX.md */
  steps_index: string;
  /** Resolved path to the .feature file */
  feature_file_path: string;
  /** Resolved path to the UC markdown file */
  uc_file_path: string;
  /** Resolved path to the feature's ARCHITECTURE.md */
  architecture_path: string;
}

/**
 * Resolve all task context from plan data and disk.
 * All I/O is synchronous fs reads — milliseconds, not LLM turns.
 */
export function resolveTaskContext(
  planFile: string,
  planData: PlanData,
  taskId: string,
  cwd?: string,
): ResolvedTaskContext {
  const root = cwd || dirname(dirname(dirname(planFile)));
  const isSub = isSubTaskId(taskId);
  const lookupId = isSub ? parentTaskId(taskId) : taskId;

  // Find the task object
  const task = findTask(planData, lookupId);
  if (!task) {
    return emptyContext(taskId);
  }

  // Extract plan.md section for this task
  const planDir = dirname(planFile);
  const planMdPath = join(planDir, "plan.md");
  const planSection = extractPlanSection(planMdPath, lookupId);

  // Resolve feature file path
  const featureFilePath = resolveFeatureFile(root, task.use_case);
  const gherkin = featureFilePath ? safeRead(featureFilePath) : "";

  // Resolve UC file path
  const ucFilePath = resolveUcFile(root, task.use_case);

  // Architecture path (already stored in task)
  const architecturePath = task.architecture
    ? resolve(root, task.architecture)
    : "";

  // Steps index
  const stepsIndexPath = resolve(root, "bdd/steps/INDEX.md");
  const stepsIndex = safeRead(stepsIndexPath);

  return {
    task,
    plan_section: planSection,
    gherkin,
    steps_index: stepsIndex,
    feature_file_path: featureFilePath || "",
    uc_file_path: ucFilePath || "",
    architecture_path: architecturePath,
  };
}

/**
 * Extract the ### T-NNN section from plan.md.
 * Returns everything from `### T-NNN` heading to the next `### T-` heading or EOF.
 */
function extractPlanSection(planMdPath: string, taskId: string): string {
  const content = safeRead(planMdPath);
  if (!content) return "";

  // Find the heading for this task: ### T-NNN — ...
  const headingPattern = new RegExp(`^### ${escapeRegex(taskId)} [—–-]`, "m");
  const match = headingPattern.exec(content);
  if (!match) return "";

  const startIdx = match.index;

  // Find the next ### T- heading (or EOF)
  const nextHeading = content.indexOf("\n### T-", startIdx + 1);
  const endIdx = nextHeading === -1 ? content.length : nextHeading;

  return content.slice(startIdx, endIdx).trim();
}

/**
 * Resolve the .feature file for a UC using filename-prefix glob.
 * Pattern: bdd/features/{module}/{domain}/{UC-XXXX}-*.feature
 */
function resolveFeatureFile(root: string, ucId?: string): string | null {
  if (!ucId) return null;
  return findFileByPrefix(root, "bdd/features", ucId, [".feature", ".feature.md"]);
}

/**
 * Resolve the UC markdown file.
 * Searches prd/modules recursively for a file starting with the UC ID.
 */
function resolveUcFile(root: string, ucId?: string): string | null {
  if (!ucId) return null;
  return findFileByPrefix(root, "prd/modules", ucId, [".md"]);
}

/**
 * Find a file by its ID prefix within a directory tree.
 * Scans recursively for files starting with the given prefix.
 */
function findFileByPrefix(
  root: string,
  searchDir: string,
  prefix: string,
  extensions: string[],
): string | null {
  const absSearchDir = resolve(root, searchDir);
  if (!existsSync(absSearchDir)) return null;

  try {
    return walkForPrefix(absSearchDir, prefix, extensions);
  } catch {
    return null;
  }
}

function walkForPrefix(dir: string, prefix: string, extensions: string[]): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = walkForPrefix(fullPath, prefix, extensions);
      if (found) return found;
    } else if (entry.name.startsWith(prefix) && extensions.some((ext) => entry.name.endsWith(ext))) {
      return fullPath;
    }
  }
  return null;
}

function safeRead(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emptyContext(taskId: string): ResolvedTaskContext {
  return {
    task: {
      id: taskId,
      title: "",
      intent: "",
      status: "pending",
    },
    plan_section: "",
    gherkin: "",
    steps_index: "",
    feature_file_path: "",
    uc_file_path: "",
    architecture_path: "",
  };
}
