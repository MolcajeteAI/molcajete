import { createInterface } from "node:readline";

export type SyncAnswer = "yes" | "no" | undefined;

export interface PromptOptions {
  syncAnswer?: SyncAnswer;
}

/**
 * Prompt for a yes/no answer on stdin/tty. Returns true for yes, false for no.
 *
 * Non-interactive handling:
 * - `MOLCAJETE_NONINTERACTIVE=1` → always returns false (no prompt printed).
 * - `syncAnswer = "yes"` / `"no"` (from --yes / --no CLI flags) → returns
 *   without prompting.
 * - If stdin is not a TTY → returns false.
 */
export async function promptYesNo(question: string, opts: PromptOptions = {}): Promise<boolean> {
  if (process.env.MOLCAJETE_NONINTERACTIVE === "1") return false;
  if (opts.syncAnswer === "yes") return true;
  if (opts.syncAnswer === "no") return false;

  if (!process.stdin.isTTY) return false;

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}
