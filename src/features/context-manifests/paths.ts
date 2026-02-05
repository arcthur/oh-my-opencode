export const CONTEXT_MANIFESTS_DIR = ".sisyphus/context-manifests"

export function getContextManifestPath(planName: string): string {
  return `${CONTEXT_MANIFESTS_DIR}/${planName}.md`
}

