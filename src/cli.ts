import { createRequire } from "node:module";
import { Command } from "commander";
import { runBuild } from "./commands/build/index.js";
import { getActiveChild } from "./commands/lib/claude.js";
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
  .action(async (planName, opts) => {
    await runBuild(planName, { resume: opts.resume, noWorktrees: !opts.worktrees });
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

// Signal handlers
process.on("SIGINT", () => {
  const child = getActiveChild();
  if (child) child.kill("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  const child = getActiveChild();
  if (child) child.kill("SIGTERM");
  process.exit(143);
});

program.parse();
