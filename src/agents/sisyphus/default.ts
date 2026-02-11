/**
 * Default (non-GPT) execution governance profile used in the Sisyphus prompt.
 */
export const SISYPHUS_EXECUTION_PROFILE_NON_GPT = `## Execution Profile (Non-GPT)

- Prefer complete but concise instructions.
- Keep execution strict: delegate implementation, verify independently, then advance plan state.
- Do not rely on memory for file state; read files and run tools directly.
- Preserve single-task delegation discipline and explicit acceptance criteria.
- Execution-mode delegate prompts must still include the 6 required sections and sufficient detail.`

export function getDefaultSisyphusExecutionProfile(): string {
  return SISYPHUS_EXECUTION_PROFILE_NON_GPT
}
