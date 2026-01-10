import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

function resolveStorageDir(): string {
  return getOpenCodeStorageDir()
}

function resolvePaths(storageDir: string): {
  opencodeStorage: string
  messageStorage: string
  partStorage: string
} {
  return {
    opencodeStorage: storageDir,
    messageStorage: join(storageDir, "message"),
    partStorage: join(storageDir, "part"),
  }
}

const defaultPaths = resolvePaths(resolveStorageDir())

export let OPENCODE_STORAGE = defaultPaths.opencodeStorage
export let MESSAGE_STORAGE = defaultPaths.messageStorage
export let PART_STORAGE = defaultPaths.partStorage

/**
 * Test-only override for filesystem paths.
 * This avoids writing to the real user home directory during unit tests.
 */
export function setOpenCodeStorageDirForTesting(storageDir: string): void {
  const next = resolvePaths(storageDir)
  OPENCODE_STORAGE = next.opencodeStorage
  MESSAGE_STORAGE = next.messageStorage
  PART_STORAGE = next.partStorage
}

export function resetOpenCodeStorageDirForTesting(): void {
  const next = resolvePaths(resolveStorageDir())
  OPENCODE_STORAGE = next.opencodeStorage
  MESSAGE_STORAGE = next.messageStorage
  PART_STORAGE = next.partStorage
}
