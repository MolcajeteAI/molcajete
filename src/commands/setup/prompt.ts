import * as readline from "node:readline";

/**
 * Multi-line editor-style reader. Prints the banner, accumulates lines
 * until the user submits an empty line. Returns the joined text (may be '').
 *
 * If stdin is not a TTY, prints a warning and returns ''.
 */
export async function readMultiline(banner: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'Warning: stdin is not a TTY — skipping interactive prompt. Pass -p "..." to provide guidance.\n',
    );
    return "";
  }

  process.stderr.write(`${banner}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return await new Promise<string>((resolve) => {
    const lines: string[] = [];

    const onLine = (line: string) => {
      if (line === "") {
        rl.removeListener("line", onLine);
        rl.close();
        resolve(lines.join("\n"));
        return;
      }
      lines.push(line);
    };

    rl.on("line", onLine);
    rl.on("close", () => {
      resolve(lines.join("\n"));
    });
  });
}

/**
 * Ask a yes/no question. Default is No unless user answers y/Y/yes.
 */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return await new Promise<boolean>((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
