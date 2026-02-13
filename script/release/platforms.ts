export interface PlatformTarget {
  dir: string
  target: string
  binary: string
  description: string
  publish: boolean
}

export const PLATFORM_TARGETS: PlatformTarget[] = [
  { dir: "darwin-arm64", target: "bun-darwin-arm64", binary: "oh-my-opencode", description: "macOS ARM64", publish: true },
  { dir: "darwin-x64", target: "bun-darwin-x64", binary: "oh-my-opencode", description: "macOS x64", publish: true },
  { dir: "darwin-x64-baseline", target: "bun-darwin-x64-baseline", binary: "oh-my-opencode", description: "macOS x64 (no AVX2)", publish: false },
  { dir: "linux-x64", target: "bun-linux-x64", binary: "oh-my-opencode", description: "Linux x64 (glibc)", publish: true },
  { dir: "linux-x64-baseline", target: "bun-linux-x64-baseline", binary: "oh-my-opencode", description: "Linux x64 (glibc, no AVX2)", publish: false },
  { dir: "linux-arm64", target: "bun-linux-arm64", binary: "oh-my-opencode", description: "Linux ARM64 (glibc)", publish: true },
  { dir: "linux-x64-musl", target: "bun-linux-x64-musl", binary: "oh-my-opencode", description: "Linux x64 (musl)", publish: true },
  { dir: "linux-x64-musl-baseline", target: "bun-linux-x64-musl-baseline", binary: "oh-my-opencode", description: "Linux x64 (musl, no AVX2)", publish: false },
  { dir: "linux-arm64-musl", target: "bun-linux-arm64-musl", binary: "oh-my-opencode", description: "Linux ARM64 (musl)", publish: true },
  { dir: "windows-x64", target: "bun-windows-x64", binary: "oh-my-opencode.exe", description: "Windows x64", publish: true },
  { dir: "windows-x64-baseline", target: "bun-windows-x64-baseline", binary: "oh-my-opencode.exe", description: "Windows x64 (no AVX2)", publish: false },
]

export const BUILD_PLATFORM_TARGETS: PlatformTarget[] = PLATFORM_TARGETS
export const VERSION_SYNC_PLATFORM_DIRS: string[] = PLATFORM_TARGETS.map((platform) => platform.dir)

export const RELEASE_PLATFORM_TARGETS: PlatformTarget[] = PLATFORM_TARGETS.filter(
  (platform) => platform.publish
)
export const RELEASE_PLATFORM_DIRS: string[] = RELEASE_PLATFORM_TARGETS.map((platform) => platform.dir)
