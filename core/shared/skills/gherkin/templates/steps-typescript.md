# TypeScript Step Definition Template

Use this template when creating new step definition files for TypeScript (cucumber-js). Each template includes JSDoc comments with parameter descriptions and a TODO placeholder body.

When creating a new step file, use the full template (imports + step functions). When appending to an existing step file, add only the new step functions.

```typescript
/**
 * {Domain} step definitions.
 *
 * Steps for {domain description} scenarios.
 */

import { Given, When, Then } from "@cucumber/cucumber";
import type { World } from "./world";

/**
 * Set up {what this step does}.
 *
 * @param param - {parameter description}
 */
Given("{step pattern with {param}}", async function (this: World, param: string) {
  throw new Error("TODO: implement step");
});

/**
 * Perform {what this step does}.
 *
 * @param param - {parameter description}
 */
When("{step pattern with {param}}", async function (this: World, param: string) {
  throw new Error("TODO: implement step");
});

/**
 * Assert {what this step verifies}.
 *
 * @param param - {parameter description}
 */
Then("{step pattern with {param}}", async function (this: World, param: string) {
  throw new Error("TODO: implement step");
});
```
