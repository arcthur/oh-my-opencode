import { beforeEach, describe, expect, mock, test } from "bun:test"

const mockFindPluginEntry = mock(() => null as {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
} | null)
const mockGetCachedVersion = mock(() => null as string | null)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockUpdatePinnedVersion = mock(() => false)
const mockInvalidatePackage = mock(() => {})
const mockRunBunInstall = mock(async () => true)
const mockGetConfigLoadErrors = mock(() => [] as Array<{ path: string; error: string }>)
const mockClearConfigLoadErrors = mock(() => {})
const mockIsModelCacheAvailable = mock(() => true)
const mockHasConnectedProvidersCache = mock(() => true)
const mockUpdateConnectedProvidersCache = mock(async () => {})

mock.module("./checker", () => ({
  getCachedVersion: mockGetCachedVersion,
  getLocalDevVersion: () => null,
  findPluginEntry: mockFindPluginEntry,
  getLatestVersion: mockGetLatestVersion,
  updatePinnedVersion: mockUpdatePinnedVersion,
}))

mock.module("./cache", () => ({
  invalidatePackage: mockInvalidatePackage,
}))

mock.module("../../cli/config-manager", () => ({
  runBunInstall: mockRunBunInstall,
}))

mock.module("../../shared/config-errors", () => ({
  getConfigLoadErrors: mockGetConfigLoadErrors,
  clearConfigLoadErrors: mockClearConfigLoadErrors,
}))

mock.module("../../shared/model-availability", () => ({
  isModelCacheAvailable: mockIsModelCacheAvailable,
}))

mock.module("../../shared/connected-providers-cache", () => ({
  hasConnectedProvidersCache: mockHasConnectedProvidersCache,
  updateConnectedProvidersCache: mockUpdateConnectedProvidersCache,
}))

mock.module("../../shared/logger", () => ({
  log: () => {},
}))

const { runBackgroundUpdateCheck } = await import("./index")

function createMockCtx() {
  const showToast = mock(async () => {})
  return {
    ctx: {
      directory: "/tmp/project",
      client: { tui: { showToast } },
    } as never,
    showToast,
  }
}

describe("runBackgroundUpdateCheck", () => {
  const getToastMessage = (isUpdate: boolean, version?: string) =>
    isUpdate ? `Update ${version}` : "Up to date"

  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockUpdatePinnedVersion.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstall.mockReset()
    mockGetConfigLoadErrors.mockReset()
    mockClearConfigLoadErrors.mockReset()
    mockIsModelCacheAvailable.mockReset()
    mockHasConnectedProvidersCache.mockReset()
    mockUpdateConnectedProvidersCache.mockReset()

    mockGetConfigLoadErrors.mockReturnValue([])
    mockIsModelCacheAvailable.mockReturnValue(true)
    mockHasConnectedProvidersCache.mockReturnValue(true)
    mockRunBunInstall.mockResolvedValue(true)
  })

  test("pinned version: notification only, no config rewrite, no install", async () => {
    // #given
    const { ctx, showToast } = createMockCtx()
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode@3.4.0",
      isPinned: true,
      pinnedVersion: "3.4.0",
      configPath: "/tmp/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")

    // #when
    await runBackgroundUpdateCheck(ctx, true, getToastMessage)

    // #then
    expect(mockUpdatePinnedVersion).not.toHaveBeenCalled()
    expect(mockRunBunInstall).not.toHaveBeenCalled()
    expect(mockInvalidatePackage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()
  })

  test("unpinned version: performs install path when autoUpdate enabled", async () => {
    // #given
    const { ctx } = createMockCtx()
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode",
      isPinned: false,
      pinnedVersion: null,
      configPath: "/tmp/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")

    // #when
    await runBackgroundUpdateCheck(ctx, true, getToastMessage)

    // #then
    expect(mockInvalidatePackage).toHaveBeenCalled()
    expect(mockRunBunInstall).toHaveBeenCalled()
  })
})
