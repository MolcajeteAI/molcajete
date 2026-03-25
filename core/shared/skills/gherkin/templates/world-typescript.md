# TypeScript World Module Template

Create the world/context module during scaffold setup. **If `bdd/steps/world.ts` already exists, do NOT modify it.**

Write `bdd/steps/world.ts`:

```typescript
/**
 * Test world — shared context for all BDD steps.
 *
 * Modify this file to add project-specific setup (DB connections, API clients, auth helpers).
 */

import { World as CucumberWorld, setWorldConstructor, Before, After } from "@cucumber/cucumber";

export class World extends CucumberWorld {
  baseUrl = "";          // TODO: set API base URL
  authToken = "";        // TODO: set auth token helper
  response: Response | null = null;  // Last HTTP response
  data: Record<string, unknown> = {};  // Arbitrary shared data between steps
}

setWorldConstructor(World);

Before(async function (this: World) {
  // Initialize fresh state for each scenario
  this.data = {};
  this.response = null;
});

After(async function (this: World) {
  // TODO: TRUNCATE test tables or rollback transaction
});
```
