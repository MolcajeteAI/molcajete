import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { log } from "../../lib/utils.js";
import { readPlan } from "./plan-data.js";

/**
 * Update PRD statuses based on implemented tasks in the plan.
 */
export function updatePrdStatuses(projectRoot: string, planFile: string): void {
  const prdDir = join(projectRoot, "prd");
  if (!existsSync(prdDir)) {
    log("Warning: prd/ directory not found — skipping PRD status update");
    return;
  }

  const data = readPlan(planFile);

  const doneTags = new Set<string>();
  const implementedUcs = new Set<string>();
  for (const task of data.tasks) {
    if (task.status === "implemented") {
      if (task.scenario) doneTags.add(`@${task.scenario}`);
      if (task.use_case) implementedUcs.add(task.use_case);
    }
  }

  if (doneTags.size === 0 || implementedUcs.size === 0) return;

  const affectedFeatures = new Set<string>();
  const modulesDir = join(prdDir, "modules");
  if (!existsSync(modulesDir)) return;

  for (const ucId of implementedUcs) {
    const ucFile = findUcFile(modulesDir, ucId);
    if (!ucFile) {
      log(`Warning: UC file not found for ${ucId} — skipping`);
      continue;
    }

    const ucContent = readFileSync(ucFile, "utf8");
    const scenarioIds: string[] = [];
    for (const match of ucContent.matchAll(/^### (SC-[A-Za-z0-9]+)/gm)) {
      scenarioIds.push(match[1]);
    }
    if (scenarioIds.length === 0) continue;

    const allCovered = scenarioIds.every((sc) => doneTags.has(`@${sc}`));
    if (!allCovered) continue;

    let ucText = readFileSync(ucFile, "utf8");
    ucText = ucText.replace(/^status: (pending|dirty)$/m, "status: implemented");
    writeFileSync(ucFile, ucText);

    const featureDir = dirname(dirname(ucFile));
    const useCasesIndex = join(featureDir, "USE-CASES.md");
    if (existsSync(useCasesIndex)) {
      let indexContent = readFileSync(useCasesIndex, "utf8");
      const ucPattern = new RegExp(`(\\| *${ucId} .*)\\| *(pending|dirty) *\\|`);
      indexContent = indexContent.replace(ucPattern, "$1| implemented |");
      writeFileSync(useCasesIndex, indexContent);
    }

    affectedFeatures.add(basename(featureDir));
    log(`PRD updated: ${ucId} → implemented`);
  }

  for (const featDirName of affectedFeatures) {
    const useCasesIndex = findFile(modulesDir, `${featDirName}/USE-CASES.md`);
    if (!useCasesIndex) continue;

    const indexContent = readFileSync(useCasesIndex, "utf8");
    const ucRows = indexContent.match(/^\| *UC-.*$/gm) || [];
    const allImplemented = ucRows.every((row) => /\| *implemented *\|/.test(row));

    if (!allImplemented) continue;

    const featuresMd = join(projectRoot, "prd", "FEATURES.md");
    if (existsSync(featuresMd)) {
      let featContent = readFileSync(featuresMd, "utf8");
      const featPattern = new RegExp(`(\\| *${featDirName} .*)\\| *(pending|dirty) *\\|`);
      featContent = featContent.replace(featPattern, "$1| implemented |");
      writeFileSync(featuresMd, featContent);
      log(`PRD updated: ${featDirName} → implemented (all UCs done)`);
    }
  }
}

/** Recursively find a file matching a suffix path under a directory. */
export function findFile(dir: string, suffixPath: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(full, suffixPath);
        if (found) return found;
      } else if (full.endsWith(suffixPath)) {
        return full;
      }
    }
  } catch {
    // ignore permission errors etc.
  }
  return null;
}

// UC files are named `UC-XXXX-{slug}.md` under a `use-cases/` directory.
function findUcFile(dir: string, ucId: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findUcFile(full, ucId);
        if (found) return found;
      } else if (
        basename(dirname(full)) === "use-cases" &&
        entry.name.startsWith(`${ucId}-`) &&
        entry.name.endsWith(".md")
      ) {
        return full;
      }
    }
  } catch {
    // ignore permission errors etc.
  }
  return null;
}
