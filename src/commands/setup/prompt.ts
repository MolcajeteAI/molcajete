import * as readline from "node:readline";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Multi-line raw-mode editor. Enter submits, Shift+Enter inserts a newline.
 * Supports arrow-key navigation, bracket paste, backspace across lines.
 * Falls back to returning '' when stdin is not a TTY.
 */
export async function readMultiline(banner: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'Warning: stdin is not a TTY — skipping interactive prompt. Pass -p "..." to provide guidance.\n',
    );
    return "";
  }

  process.stderr.write(`\n${banner}\n`);
  process.stderr.write(`${DIM}Enter to submit · Shift+Enter for new line${RESET}\n\n`);

  return new Promise<string>((resolve) => {
    const lines: string[] = [""];
    let row = 0;
    let col = 0;
    let prevLineCount = 1;
    let pasting = false;
    let pasteBuffer = "";

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Enable bracket paste mode
    process.stderr.write("\x1b[?2004h");

    function render(): void {
      // Move cursor to first line of the input area
      if (prevLineCount > 1) {
        process.stderr.write(`\x1b[${prevLineCount - 1}A`);
      }
      // Clear from first line to end of screen
      process.stderr.write("\r\x1b[J");

      // Draw all lines
      process.stderr.write(lines.join("\n"));

      // Position cursor at (row, col)
      const below = lines.length - 1 - row;
      if (below > 0) {
        process.stderr.write(`\x1b[${below}A`);
      }
      process.stderr.write("\r");
      if (col > 0) {
        process.stderr.write(`\x1b[${col}C`);
      }

      prevLineCount = lines.length;
    }

    function insertText(text: string): void {
      const parts = text.split("\n");
      const before = lines[row].slice(0, col);
      const after = lines[row].slice(col);

      if (parts.length === 1) {
        lines[row] = before + parts[0] + after;
        col += parts[0].length;
      } else {
        lines[row] = before + parts[0];
        const tail = parts.slice(1);
        tail[tail.length - 1] += after;
        lines.splice(row + 1, 0, ...tail);
        row += tail.length;
        col = parts[parts.length - 1].length;
      }
    }

    function cleanup(): void {
      process.stderr.write("\x1b[?2004l"); // disable bracket paste
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
    }

    function finish(): void {
      cleanup();
      // Move cursor to end of input then newline
      const below = lines.length - 1 - row;
      if (below > 0) {
        process.stderr.write(`\x1b[${below}B`);
      }
      process.stderr.write("\r\n");
      resolve(lines.join("\n"));
    }

    process.stdin.on("data", (data: Buffer) => {
      const raw = data.toString();

      // Ctrl+C — abort
      if (raw === "\x03") {
        cleanup();
        process.stderr.write("\n");
        process.exit(130);
      }

      // ── Bracket paste handling ──

      // Check for paste start marker anywhere in the data
      const pasteStartIdx = raw.indexOf("\x1b[200~");
      const pasteEndIdx = raw.indexOf("\x1b[201~");

      if (pasteStartIdx !== -1) {
        pasting = true;
        pasteBuffer = "";

        // Content after the start marker
        const afterStart = raw.slice(pasteStartIdx + 6);

        if (pasteEndIdx !== -1 && pasteEndIdx > pasteStartIdx) {
          // Both start and end in same chunk
          const content = raw.slice(pasteStartIdx + 6, pasteEndIdx);
          insertText(content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
          pasting = false;
        } else {
          pasteBuffer += afterStart;
        }
        render();
        return;
      }

      if (pasting) {
        if (pasteEndIdx !== -1) {
          pasteBuffer += raw.slice(0, pasteEndIdx);
          insertText(pasteBuffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
          pasteBuffer = "";
          pasting = false;
          render();
        } else {
          pasteBuffer += raw;
        }
        return;
      }

      // ── Normal key handling ──

      // Shift+Enter — CSI u / kitty protocol: ESC[13;2u
      if (raw === "\x1b[13;2u") {
        const after = lines[row].slice(col);
        lines[row] = lines[row].slice(0, col);
        lines.splice(row + 1, 0, after);
        row++;
        col = 0;
        render();
        return;
      }

      // Enter — submit
      if (raw === "\r" || raw === "\n") {
        finish();
        return;
      }

      // Arrow Up
      if (raw === "\x1b[A" || raw === "\x1bOA") {
        if (row > 0) {
          row--;
          col = Math.min(col, lines[row].length);
          render();
        }
        return;
      }

      // Arrow Down
      if (raw === "\x1b[B" || raw === "\x1bOB") {
        if (row < lines.length - 1) {
          row++;
          col = Math.min(col, lines[row].length);
          render();
        }
        return;
      }

      // Arrow Right
      if (raw === "\x1b[C" || raw === "\x1bOC") {
        if (col < lines[row].length) {
          col++;
        } else if (row < lines.length - 1) {
          row++;
          col = 0;
        }
        render();
        return;
      }

      // Arrow Left
      if (raw === "\x1b[D" || raw === "\x1bOD") {
        if (col > 0) {
          col--;
        } else if (row > 0) {
          row--;
          col = lines[row].length;
        }
        render();
        return;
      }

      // Home
      if (raw === "\x1b[H" || raw === "\x1b[1~" || raw === "\x1bOH") {
        col = 0;
        render();
        return;
      }

      // End
      if (raw === "\x1b[F" || raw === "\x1b[4~" || raw === "\x1bOF") {
        col = lines[row].length;
        render();
        return;
      }

      // Backspace
      if (raw === "\x7f" || raw === "\b") {
        if (col > 0) {
          lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col);
          col--;
        } else if (row > 0) {
          col = lines[row - 1].length;
          lines[row - 1] += lines[row];
          lines.splice(row, 1);
          row--;
        }
        render();
        return;
      }

      // Delete
      if (raw === "\x1b[3~") {
        if (col < lines[row].length) {
          lines[row] = lines[row].slice(0, col) + lines[row].slice(col + 1);
        } else if (row < lines.length - 1) {
          lines[row] += lines[row + 1];
          lines.splice(row + 1, 1);
        }
        render();
        return;
      }

      // Ignore other escape sequences
      if (raw.startsWith("\x1b")) {
        return;
      }

      // Printable characters
      insertText(raw);
      render();
    });

    render();
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
