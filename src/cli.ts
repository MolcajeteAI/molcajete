import { createRequire } from "node:module";
import { Command, Option } from "commander";
import { runBuild } from "./commands/build/index.js";
import { sweepActiveWorktrees } from "./commands/build/worktree-registry.js";
import { getActiveChildren } from "./commands/lib/claude.js";
import { runSetup } from "./commands/setup/index.js";
import { runTask } from "./commands/task/index.js";
import { setDebug } from "./lib/utils.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("molcajete")
  .version(pkg.version)
  .description("Spec-driven software development CLI powered by Claude Code")
  .option("--debug", "Print spawned claude commands to stderr")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) setDebug(true);
  });

program
  .command("build")
  .description("Execute all pending tasks in a plan")
  .argument("<plan-name>", "Plan name, path, timestamp, or slug")
  .option("--resume", "Resume from where a previous build left off (skip implemented tasks)")
  .option("--parallel <n>", "Max number of tasks to run concurrently (1-16)", (v) => Number.parseInt(v, 10))
  .option("--skip-docs", "Skip the documentation step after each task")
  .option("--skip-review", "Skip end-of-build code review (per-task completeness checks still run)")
  .option("--debug", "Print spawned claude commands to stderr")
  .option("--max-failures <n>", "Stop the build after N terminal task failures (default: no limit)", (v) => Number.parseInt(v, 10))
  .addOption(new Option("--yes").hideHelp())
  .addOption(new Option("--no").hideHelp())
  .action(async (planName, opts) => {
    const parallelOverride = typeof opts.parallel === "number" ? opts.parallel : undefined;
    await runBuild(planName, {
      resume: opts.resume,
      parallel: parallelOverride,
      maxFailures: typeof opts.maxFailures === "number" ? opts.maxFailures : undefined,
      syncAnswer: opts.yes === true ? "yes" : opts.no === true ? "no" : undefined,
      skipDocs: opts.skipDocs || !!process.env.SKIP_DOCS,
      skipReview: opts.skipReview || !!process.env.SKIP_REVIEW,
    });
  });

program
  .command("task")
  .description("Run specific tasks from a plan")
  .argument("<plan-name>", "Plan name, path, timestamp, or slug")
  .argument("<task-numbers...>", "Task numbers to run (e.g. 1 3 99 → T-001 T-003 T-099)")
  .option("--parallel <n>", "Max number of tasks to run concurrently (1-16)", (v) => Number.parseInt(v, 10))
  .option("--resume", "Resume from where a previous run left off (skip implemented tasks)")
  .option("--skip-docs", "Skip the documentation step after each task")
  .option("--skip-review", "Skip end-of-build code review (per-task completeness checks still run)")
  .option("--max-failures <n>", "Stop after N terminal task failures (default: no limit)", (v) => Number.parseInt(v, 10))
  .option("--build-deps", "Build unimplemented dependencies before running specified tasks")
  .option("--debug", "Print spawned claude commands to stderr")
  .addOption(new Option("--yes").hideHelp())
  .addOption(new Option("--no").hideHelp())
  .action(async (planName, taskNumbers, opts) => {
    const nums = (taskNumbers as string[]).map((s) => {
      const n = Number.parseInt(s, 10);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write(`Error: invalid task number "${s}" — must be a positive integer\n`);
        process.exit(1);
      }
      return n;
    });
    const parallelOverride = typeof opts.parallel === "number" ? opts.parallel : undefined;
    await runTask(planName, nums, {
      resume: opts.resume,
      parallel: parallelOverride,
      maxFailures: typeof opts.maxFailures === "number" ? opts.maxFailures : undefined,
      buildDeps: opts.buildDeps,
      syncAnswer: opts.yes === true ? "yes" : opts.no === true ? "no" : undefined,
      skipDocs: opts.skipDocs || !!process.env.SKIP_DOCS,
      skipReview: opts.skipReview || !!process.env.SKIP_REVIEW,
    });
  });

program
  .command("setup")
  .description("Detect tooling and generate hook scripts")
  .option("--overwrite", "Overwrite existing hooks without asking")
  .option("--hook <name>", "Generate a single specific hook (optional, overrides default)")
  .option("-p, --prompt <text>", "Setup/hook guidance as a quoted string (skips interactive prompt)")
  .action(async (opts) => {
    await runSetup({
      overwrite: opts.overwrite ?? false,
      hook: opts.hook ?? null,
      prompt: opts.prompt,
    });
  });

// Signal handlers — on first signal, kill claude children, sweep all active
// worker worktrees (commit + push pending work), then exit. A second signal
// bypasses the sweep and exits immediately.
let shuttingDown = false;

function handleShutdown(signal: "SIGINT" | "SIGTERM", exitCode: number): void {
  if (shuttingDown) {
    process.stderr.write(`\nReceived second ${signal} — forcing immediate exit.\n`);
    process.exit(exitCode);
  }
  shuttingDown = true;

  process.stderr.write(`\nReceived ${signal} — preserving in-flight work before exit...\n`);
  for (const child of getActiveChildren()) child.kill(signal);

  // Give children ~300ms to release any git locks before we commit/push.
  setTimeout(() => {
    sweepActiveWorktrees(signal.toLowerCase());
    process.exit(exitCode);
  }, 300);
}

process.on("SIGINT", () => handleShutdown("SIGINT", 130));
process.on("SIGTERM", () => handleShutdown("SIGTERM", 143));

program.parse();
