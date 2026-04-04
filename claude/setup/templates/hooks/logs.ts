import type { HookContext, LogsInput, LogsOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

const serviceMap: Record<string, string> = {
    // __SERVICE_MAP__
};

export default async function logs(
  ctx: HookContext<LogsInput>,
): Promise<LogsOutput> {
  const service = ctx.input.service;
  const lines = ctx.input.lines ?? 100;
  const since = ctx.input.since;

  let cmd = '__LOGS_COMMAND__';

  // Map service alias to actual service name
  const actualService = service ? (serviceMap[service] ?? service) : undefined;
  if (actualService && actualService !== 'all') {
    cmd += ` ${actualService}`;
  }

  cmd += ` --tail ${lines}`;
  if (since) {
    cmd += ` --since ${since}`;
  }

  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    // Truncate to 50KB to avoid overwhelming output
    const truncated = output.length > 50000 ? output.slice(-50000) : output;
    return { logs: truncated };
  } catch (err) {
    return { logs: `Error retrieving logs: ${(err as Error).message}` };
  }
}
