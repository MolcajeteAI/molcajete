const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

let timer: ReturnType<typeof setInterval> | null = null;
let frameIndex = 0;
let currentMessage = "";

function render(): void {
  process.stderr.write(`\r\x1b[K${FRAMES[frameIndex]} ${currentMessage}`);
  frameIndex = (frameIndex + 1) % FRAMES.length;
}

export function startSpinner(message: string): void {
  if (timer) stopSpinner();
  currentMessage = message;
  frameIndex = 0;

  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
    return;
  }

  render();
  timer = setInterval(render, INTERVAL);
}

export function updateSpinner(message: string): void {
  currentMessage = message;
  if (!timer && process.stderr.isTTY) return;
  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
  }
}

export function stopSpinner(final?: string): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
  if (final) {
    process.stderr.write(`${final}\n`);
  }
}

export function isSpinning(): boolean {
  return timer !== null;
}

/** Clear spinner line so a log message can print cleanly, then redraw. */
export function clearForLog(): void {
  if (timer && process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
}

export function redrawAfterLog(): void {
  if (timer && process.stderr.isTTY) {
    process.stderr.write(`\r\x1b[K${FRAMES[frameIndex]} ${currentMessage}`);
  }
}
