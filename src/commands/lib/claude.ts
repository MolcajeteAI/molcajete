import { spawn } from "node:child_process";
import type { ClaudeResult, BuildStats, SessionStats } from "../../types.js";
import { PLUGIN_DIR, BACKOFF_BASE, TIMEOUT } from "../../lib/config.js";
import { log, sleep, shellQuote, isDebug } from "../../lib/utils.js";
import { isSpinning, stopSpinner } from "../../lib/spinner.js";
import { writeLog } from "../../lib/logger.js";

// ── Active Child Process ──

let activeChild: ReturnType<typeof spawn> | null = null;

export function setActiveChild(child: ReturnType<typeof spawn> | null): void {
  activeChild = child;
}

export function getActiveChild(): ReturnType<typeof spawn> | null {
  return activeChild;
}

// ── Build Stats ──

export const buildStats: BuildStats = { totalCostUsd: 0, totalApiMs: 0, totalRealMs: 0, sessions: 0 };

// ── Duration Formatting ──

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Result Event Parsing ──

// Claude emits a single JSON object for --output-format json and an array of
// events for --output-format stream-json. Normalise both to the result event.
function parseResultEvent(rawOutput: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawOutput.trim());
    if (Array.isArray(parsed)) {
      const ev = parsed.find((e: Record<string, unknown>) => e.type === "result");
      return (ev ?? null) as Record<string, unknown> | null;
    }
    if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).type === "result") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Session Stats ──

export function extractSessionStats(rawOutput: string, realMs: number): SessionStats {
  const result = parseResultEvent(rawOutput);
  const apiMs = (result?.duration_api_ms as number) ?? 0;
  const costUsd = (result?.total_cost_usd as number) ?? 0;
  return {
    apiMs,
    costUsd,
    apiTime: formatDuration(apiMs),
    realTime: formatDuration(realMs),
    realMs,
    cost: `$${costUsd.toFixed(4)}`,
  };
}

export function logSessionStats(rawOutput: string, realMs: number): void {
  const stats = extractSessionStats(rawOutput, realMs);
  buildStats.totalCostUsd += stats.costUsd;
  buildStats.totalApiMs += stats.apiMs;
  buildStats.totalRealMs += stats.realMs;
  buildStats.sessions++;
  log(`Elapsed: ${stats.apiTime} (Real ${stats.realTime}) | Cost: ${stats.cost}`);
}

// ── Failure Reason ──

export function extractFailureReason(rawOutput: string, stderr: string): string | null {
  const result = parseResultEvent(rawOutput);
  if (result) {
    const isError = result.is_error === true;
    const subtype = typeof result.subtype === "string" ? result.subtype : "";
    const resultText = typeof result.result === "string" ? result.result.trim() : "";
    if (isError || (subtype && subtype !== "success")) {
      if (subtype === "error_max_turns") return "max turns reached";
      if (resultText) return subtype ? `${subtype}: ${resultText}` : resultText;
      if (subtype) return subtype;
    }
  }
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    const lastLine = trimmedStderr.split("\n").pop()?.trim();
    if (lastLine) return lastLine.slice(0, 240);
  }
  return null;
}

// ── Claude Invocation ──

export async function invokeClaude(workdir: string, args: string[]): Promise<ClaudeResult> {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const result = await spawnClaude(workdir, args);

    if (result.exitCode === 0) {
      logSessionStats(result.output, result.realMs);
      return result;
    }

    if (/rate.limit|429|too many requests/i.test(result.stderr)) {
      const wait = BACKOFF_BASE * 2 ** attempt;
      log(`Rate limited. Retrying in ${wait}s (attempt ${attempt + 1}/6)...`);
      await sleep(wait * 1000);
      continue;
    }

    logSessionStats(result.output, result.realMs);
    return result;
  }

  log("Rate limit retries exhausted.");
  return { output: "", stderr: "", exitCode: 1, realMs: 0 };
}

export function spawnClaude(workdir: string, args: string[]): Promise<ClaudeResult> {
  return new Promise((resolveP) => {
    const startTime = Date.now();

    // The last element in args is always the prompt.
    const prompt = args[args.length - 1];
    const flagArgs = args.slice(0, -1);

    const fullArgs = [
      "--output-format",
      "json",
      "--plugin-dir",
      PLUGIN_DIR,
      "--dangerously-skip-permissions",
      ...flagArgs,
      "-p",
      prompt,
    ];

    if (isDebug()) {
      const YELLOW = "\x1b[33m";
      const RESET = "\x1b[0m";
      const quotedArgs = fullArgs.map(shellQuote).join(" ");
      process.stderr.write("\n");
      log(`${YELLOW}$ claude ${quotedArgs}${RESET}`);
      log(`${YELLOW}cwd: ${workdir}${RESET}`);
      process.stderr.write("\n");
    }

    // Stop spinner before subprocess starts to avoid clashing stderr output
    if (isSpinning()) stopSpinner();

    const child = spawn("claude", fullArgs, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" },
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
      writeLog(chunk.toString().trimEnd());
    });

    activeChild = child;

    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, TIMEOUT);

    child.on("close", (code) => {
      clearTimeout(timer);
      activeChild = null;
      resolveP({
        output: Buffer.concat(chunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: code ?? 1,
        realMs: Date.now() - startTime,
      });
    });
  });
}

// ── Output Parsing ──

export function extractStructuredOutput(rawOutput: string): Record<string, unknown> {
  const result = parseResultEvent(rawOutput);
  if (result?.structured_output && typeof result.structured_output === "object") {
    return result.structured_output as Record<string, unknown>;
  }
  // Fallback: when no --json-schema was passed, the `result` field holds the assistant's final text.
  const text = typeof result?.result === "string" ? result.result.trim() : "";
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      /* not JSON text */
    }
  }
  return {};
}
