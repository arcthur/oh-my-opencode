import type { InstallConfig } from "../types"
import { generateModelConfig } from "../model-fallback"
import { CURRENT_CONFIG_VERSION } from "../../config/version"

export function generateOmoConfig(installConfig: InstallConfig): Record<string, unknown> {
  return {
    config_version: CURRENT_CONFIG_VERSION,
    architecture_version: 2,
    ...generateModelConfig(installConfig),
  }
}
