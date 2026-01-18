import type { CommandDefinition } from "../features/claude-code-command-loader/types"

/**
 * Converts an array of items to a Record using custom key and value extractors.
 *
 * @param items - Array of items to convert
 * @param keyFn - Function to extract the key from each item
 * @param valueFn - Function to extract the value from each item
 * @returns Record mapping keys to values
 */
export function toRecord<T, V>(
  items: T[],
  keyFn: (item: T) => string,
  valueFn: (item: T) => V
): Record<string, V> {
  const result: Record<string, V> = {}
  for (const item of items) {
    result[keyFn(item)] = valueFn(item)
  }
  return result
}

/**
 * Strips `name` and `argumentHint` fields from a CommandDefinition for OpenCode compatibility.
 * These fields are used internally but should not be exposed in the final Record.
 *
 * @param definition - The full CommandDefinition
 * @returns CommandDefinition without name and argumentHint fields
 */
export function toOpenCodeDefinition(definition: CommandDefinition): CommandDefinition {
  const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = definition
  return openCodeCompatible as CommandDefinition
}

/**
 * Converts an array of loaded items (commands/skills) to a Record of OpenCode-compatible definitions.
 * Each item must have a `name` string and a `definition` CommandDefinition.
 *
 * @param items - Array of items with name and definition properties
 * @returns Record mapping names to OpenCode-compatible definitions
 */
export function toDefinitionRecord<T extends { name: string; definition: CommandDefinition }>(
  items: T[]
): Record<string, CommandDefinition> {
  return toRecord(items, (item) => item.name, (item) => toOpenCodeDefinition(item.definition))
}
