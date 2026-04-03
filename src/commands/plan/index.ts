import { log } from '../../lib/utils.js';
import { PLUGIN_DIR } from '../../lib/config.js';
import { invokeClaude } from '../lib/claude.js';

const SCOPE_RE = /^(FEAT|UC|SC)-[A-Z0-9]{4}$/;

/**
 * Headless plan generation command.
 */
export async function runPlan(scopes: string[]): Promise<void> {
  for (const scope of scopes) {
    if (!SCOPE_RE.test(scope)) {
      process.stderr.write(`Error: scope must match FEAT-XXXX, UC-XXXX, or SC-XXXX (got: ${scope})\n`);
      process.exit(1);
    }
  }

  log(`Generating plan for scope: ${scopes.join(' ')}`);

  const result = await invokeClaude(process.cwd(), [
    '--model', 'sonnet',
    '--max-turns', '50',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    `/m:plan ${scopes.join(' ')}`,
  ]);

  if (result.exitCode !== 0) {
    process.stderr.write('Error: plan generation failed\n');
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    process.exit(1);
  }

  // Extract plan file location from output if possible
  const output = result.output;
  const planPathMatch = output.match(/\.molcajete\/plans\/[^\s"]+/);
  if (planPathMatch) {
    log(`Plan created: ${planPathMatch[0]}`);
  } else {
    log('Plan generation complete.');
  }
}
