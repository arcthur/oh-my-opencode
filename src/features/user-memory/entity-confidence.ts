import type { EntityNode } from "./types"

export function calculateCountBasedConfidence(
  count: number,
  saturationCount: number = 5
): number {
  if (saturationCount <= 0) return 1
  if (count <= 0) return 0
  return Math.min(1, count / saturationCount)
}

export function calculateEntityNodeConfidence(node: Pick<EntityNode, "mentionCount">): number {
  return calculateCountBasedConfidence(node.mentionCount, 5)
}

