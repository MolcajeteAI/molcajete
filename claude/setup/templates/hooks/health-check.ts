import type { HookContext, HealthCheckInput, HealthCheckOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function loadEnv(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env not found — ok */ }
}

loadEnv('.env');

export default async function healthCheck(
  ctx: HookContext<HealthCheckInput>,
): Promise<HealthCheckOutput> {
  const requested = ctx.input.services ?? [];

  const allServices = [
    // __SERVICES__
  ];

  const results: Record<string, 'ready' | 'failed'> = {};
  for (const svc of allServices) {
    if (requested.length > 0 && !requested.includes(svc.name)) continue;
    try {
      execSync(svc.command, { timeout: svc.timeout, stdio: ['pipe', 'pipe', 'pipe'] });
      results[svc.name] = 'ready';
    } catch {
      results[svc.name] = 'failed';
    }
  }

  const allReady = Object.values(results).every((s) => s === 'ready');
  return { status: allReady ? 'ready' : 'failed', services: results };
}
