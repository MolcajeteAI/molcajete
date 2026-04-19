import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MODEL } from "../../lib/config.js";
import { log, logDetail } from "../../lib/utils.js";
import type { PlanData } from "../../types.js";
import { logSessionStats, spawnClaude } from "../lib/claude.js";

export interface SeedSessionResult {
  ok: boolean;
  sessionName: string | null;
  error?: string;
}

/**
 * Create a seed session that pre-loads all shared project context.
 * Subsequent sessions fork from this one via --resume + --fork-session,
 * inheriting the loaded context without re-reading files.
 */
export async function createSeedSession(
  projectRoot: string,
  planFile: string,
  planData: PlanData,
): Promise<SeedSessionResult> {
  const planDir = dirname(planFile);
  const planDirBase = planDir.split("/").pop() ?? "plan";
  // --session-id requires a valid UUID; human-readable label for logs only
  const now = new Date();
  const ts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
  ].join("");
  const sessionId = randomUUID();
  const sessionLabel = `molcajete-seed-${ts}-${planDirBase}`;

  const filesToRead = collectFilesToRead(projectRoot, planFile, planData);

  if (filesToRead.length === 0) {
    return { ok: false, sessionName: null, error: "No files to preload" };
  }

  // Build a prompt that reads all files in parallel
  const fileList = filesToRead.map((f) => `- ${f}`).join("\n");
  const prompt = `Read all of the following project context files in parallel (issue all Read calls in a single turn). After reading, respond with exactly: "Context loaded."\n\nFiles:\n${fileList}`;

  log("Creating seed session for context preloading...");
  logDetail(`Seed session: ${sessionLabel} (${filesToRead.length} files)`);

  try {
    const result = await spawnClaude(projectRoot, [
      "--session-id",
      sessionId,
      "--model",
      MODEL,
      "--allowedTools",
      "Read,Glob",
      "--max-turns",
      "10",
      "--max-budget-usd",
      "2.00",
      prompt,
    ]);

    logSessionStats(result.output, result.realMs, "SEED" as never);

    if (result.exitCode !== 0) {
      log(`Seed session failed (exit ${result.exitCode}) — falling back to per-session loading`);
      return { ok: false, sessionName: null, error: `Exit code ${result.exitCode}` };
    }

    log(`Seed session created: ${sessionLabel}`);
    return { ok: true, sessionName: sessionId };
  } catch (err) {
    log(`Seed session error: ${(err as Error).message} — falling back to per-session loading`);
    return { ok: false, sessionName: null, error: (err as Error).message };
  }
}

/**
 * Collect all shared context file paths that should be preloaded.
 * Only includes files that exist on disk.
 */
function collectFilesToRead(
  projectRoot: string,
  planFile: string,
  planData: PlanData,
): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  const add = (path: string): void => {
    const abs = resolve(projectRoot, path);
    if (!seen.has(abs) && existsSync(abs)) {
      seen.add(abs);
      files.push(abs);
    }
  };

  // Project-level PRD files
  for (const name of [
    "prd/PROJECT.md",
    "prd/FEATURES.md",
    "prd/TECH-STACK.md",
    "prd/ACTORS.md",
    "prd/GLOSSARY.md",
    "prd/DOMAINS.md",
    "prd/MODULES.md",
  ]) {
    add(name);
  }

  // Project rules
  add("CLAUDE.md");
  const rulesDir = join(projectRoot, ".claude", "rules");
  if (existsSync(rulesDir)) {
    try {
      for (const entry of readdirSync(rulesDir)) {
        if (entry.endsWith(".md")) {
          add(join(".claude", "rules", entry));
        }
      }
    } catch {
      // non-fatal
    }
  }

  // BDD steps index
  add("bdd/steps/INDEX.md");

  // Plan files
  add(planFile);
  const planDir = dirname(planFile);
  const planMd = join(planDir, "plan.md");
  add(planMd);

  // Per-feature files (deduplicated via `seen` set)
  for (const task of planData.tasks) {
    if (task.architecture) {
      add(task.architecture);
      // REQUIREMENTS.md is always a sibling of ARCHITECTURE.md
      const reqPath = join(dirname(task.architecture), "REQUIREMENTS.md");
      add(reqPath);
    }
  }

  return files;
}
