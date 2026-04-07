/** Generate N Base62 4-char timestamp codes. */
export function generateIds(count = 1): string[] {
  const ts = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => (ts + i).toString(36).slice(-4).toUpperCase());
}

/** Generate a single TASK-XXXX ID. */
export function generateTaskId(): string {
  return `TASK-${generateIds(1)[0]}`;
}
