#!/usr/bin/env node

const arg = process.argv[2];

if (arg !== undefined && (isNaN(arg) || Number(arg) < 1 || !Number.isInteger(Number(arg)))) {
  process.stderr.write('Usage: generate-id.js [count]\n  count  positive integer, number of IDs to generate (default: 1)\n');
  process.exit(1);
}

const count = arg ? Number(arg) : 1;
const ts = Math.floor(Date.now() / 1000);

for (let i = 0; i < count; i++) {
  const code = (ts + i).toString(36).slice(-4).toUpperCase();
  process.stdout.write(code + '\n');
}
