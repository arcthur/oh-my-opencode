export const CONTEXT_MANIFESTS_DIR = ".sisyphus/context-manifests"

export function getContextManifestPath(planId: string): string {
  return `${CONTEXT_MANIFESTS_DIR}/${planId}.md`
}
