import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ALL_HOOKS, PLUGIN_DIR } from "../../lib/config.js";
import { log, resolveProjectRoot } from "../../lib/utils.js";
import { initLogger, closeLogger } from "../../lib/logger.js";
import { startSpinner, stopSpinner } from "../../lib/spinner.js";
import { readMultiline, confirm } from "./prompt.js";

export interface SetupOptions {
  overwrite: boolean;
  hook: string | null;
  /**
   * Raw prompt value from Commander. `undefined` means the flag was not
   * passed; an empty string means the user explicitly passed `-p ""` (opt-out
   * of interactive guidance).
   */
  prompt?: string;
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const { overwrite, hook } = options;
  const projectRoot = resolveProjectRoot();

  // Validate --hook name
  if (hook !== null && !ALL_HOOKS.includes(hook)) {
    process.stderr.write(`Error: unknown hook "${hook}".\nValid hooks: ${ALL_HOOKS.join(", ")}\n`);
    process.exit(1);
  }

  // Resolve guidance text
  let guidance: string;
  if (options.prompt !== undefined) {
    guidance = options.prompt;
  } else {
    const banner = hook ? `What should the ${hook} hook do?` : "What should the verify hook do?";
    guidance = await readMultiline(banner);
  }

  // Compute target files for this invocation
  const hooksDir = join(projectRoot, ".molcajete", "hooks");
  const targetHook = hook ?? "verify";
  const targetFile = join(hooksDir, `${targetHook}.mjs`);
  const candidateFiles = [targetFile];

  // Per-file overwrite confirmation
  const allowedFiles: string[] = [];
  for (const file of candidateFiles) {
    if (!existsSync(file)) {
      allowedFiles.push(file);
      continue;
    }
    if (overwrite) {
      allowedFiles.push(file);
      continue;
    }
    const relative = file.replace(`${projectRoot}/`, "");
    const ok = await confirm(`Overwrite ${relative}? [y/N]`);
    if (ok) allowedFiles.push(file);
    else log(`Skipping ${relative}`);
  }

  if (allowedFiles.length === 0) {
    log("Nothing to generate.");
    return;
  }

  // Init logger after user input is collected
  const logPath = initLogger("setup", hook || "verify");
  log(`Logs: ${logPath}`);

  const payload = JSON.stringify({
    overwrite,
    hook,
    guidance,
    allowedFiles,
  });

  startSpinner("Generating hooks...");

  const child = spawn(
    "claude",
    ["--plugin-dir", PLUGIN_DIR, "--dangerously-skip-permissions", "-p", `/molcajete:setup ${payload}`],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  const exitCode = await new Promise<number>((resolveP) => {
    child.on("close", (code) => resolveP(code ?? 1));
  });

  stopSpinner();
  closeLogger();

  if (exitCode !== 0) {
    log("Setup failed.");
    process.exit(exitCode);
  }
}
