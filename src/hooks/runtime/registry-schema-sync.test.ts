import { describe, expect, test } from "bun:test"
import { HookNameSchema, type HookName } from "../../config"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"
import { getRuntimeRegistryEntries, validateRuntimeRegistry } from "./registry"
import { buildHookEnablementMap } from "./enablement"
import type { HookEventType, HookNodeId } from "./types"

describe("runtime registry sync", () => {
  test("schema/registry/order are aligned", () => {
    const schemaHooks = [...HookNameSchema.options]
    const registryEntries = getRuntimeRegistryEntries()

    expect(() =>
      validateRuntimeRegistry({
        schemaHooks,
        registryEntries,
        order: EVENT_TOTAL_ORDER,
      })
    ).not.toThrow()
  })

  test("order hook nodes have matching registry event declarations", () => {
    const registryEntries = getRuntimeRegistryEntries()
    const registryByName = new Map(
      registryEntries.map((e) => [e.name, new Set(e.events)])
    )

    for (const [event, nodes] of Object.entries(EVENT_TOTAL_ORDER) as Array<
      [HookEventType, HookNodeId[]]
    >) {
      for (const nodeId of nodes) {
        if (nodeId.startsWith("internal:")) continue

        let hookName: string
        if (nodeId.startsWith("bridge:claude-code-hooks:")) {
          hookName = "claude-code-hooks"
        } else {
          hookName = nodeId.split(":")[0]
        }

        const registryEvents = registryByName.get(hookName as HookName)
        expect(registryEvents).toBeDefined()
        expect(registryEvents!.has(event)).toBe(true)
      }
    }
  })

  test("enablement map covers all schema hooks", () => {
    const hookNames = [...HookNameSchema.options] as HookName[]
    const enablementMap = buildHookEnablementMap({
      hookNames,
      disabledHooks: new Set<string>(),
    })

    expect(enablementMap.size).toBe(hookNames.length)
    for (const hookName of hookNames) {
      expect(enablementMap.has(hookName)).toBe(true)
    }
  })
})
