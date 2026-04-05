import type { HookContext, DocumentationLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeDocumentation(
  ctx: HookContext<DocumentationLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — task identifier
  // ctx.input.feature_id — optional feature identifier

  // Add your pre-documentation logic here
}
