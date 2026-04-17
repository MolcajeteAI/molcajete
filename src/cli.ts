import { createRequire } from "node:module";
import { Command } from "commander";
import { runBuild } from "./commands/build/index.js";
import { sweepActiveWorktrees } from "./commands/build/worktree-registry.js";
import { getActiveChildren } from "./commands/lib/claude.js";
import { runSetup } from "./commands/setup/index.js";
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
  .option("--no-worktrees", "Run all tasks in the main working directory (no worktree isolation)")
  .option("--parallel <n>", "Max number of tasks to run concurrently (1-16)", (v) => Number.parseInt(v, 10))
  .option("--no-parallel", "Disable parallelism (equivalent to --parallel 1)")
  .option("--failure-threshold <n>", "Terminal failures allowed before draining (1-100)", (v) =>
    Number.parseInt(v, 10),
  )
  .option("--yes", "Auto-confirm the startup sync prompt (fast-forward or push)")
  .option("--no", "Auto-decline the startup sync prompt (abort on mismatch)")
  .action(async (planName, opts) => {
    const parallelOverride =
      opts.parallel === false ? 1 : typeof opts.parallel === "number" ? opts.parallel : undefined;
    await runBuild(planName, {
      resume: opts.resume,
      noWorktrees: !opts.worktrees,
      parallel: parallelOverride,
      failureThreshold: typeof opts.failureThreshold === "number" ? opts.failureThreshold : undefined,
      syncAnswer: opts.yes === true ? "yes" : opts.no === true ? "no" : undefined,
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
