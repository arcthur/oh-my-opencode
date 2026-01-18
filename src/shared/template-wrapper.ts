/**
 * Wraps command body content in the standard command template format.
 *
 * @param body - The raw command instruction content
 * @returns Wrapped template string with command-instruction tags
 */
export function wrapCommandTemplate(body: string): string {
  return `<command-instruction>
${body.trim()}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`
}

/**
 * Wraps skill body content in the standard skill template format.
 * Includes base directory information for file path resolution.
 *
 * @param body - The raw skill instruction content
 * @param baseDir - The base directory path for the skill
 * @returns Wrapped template string with skill-instruction tags
 */
export function wrapSkillTemplate(body: string, baseDir: string): string {
  return `<skill-instruction>
Base directory for this skill: ${baseDir}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`
}
