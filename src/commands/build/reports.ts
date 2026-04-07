import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../lib/utils.js";

/**
 * Write a validation/test report to the plan's reports/ directory.
 */
export function writeReport(planDir: string, name: string, data: unknown): void {
  const reportsDir = join(planDir, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${name}.json`);
  writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`);
  log(`Report saved: ${reportPath}`);
}
