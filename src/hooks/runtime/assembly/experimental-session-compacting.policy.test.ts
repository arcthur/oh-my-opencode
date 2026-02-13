import { describe, expect, test } from "bun:test"
import { buildExperimentalSessionCompactingNodes } from "./experimental-session-compacting"
import type { RuntimeAssemblyContext } from "./types"

function createContext(overrides?: Partial<RuntimeAssemblyContext>): RuntimeAssemblyContext {
  return {
    ...overrides,
  }
}

describe("experimental.session.compacting policy nodes", () => {
  test("injects observe and enforce nodes around bridge", () => {
    const context = createContext({
      claudeCodeBridgeEnabled: true,
      claudeCodeHooks: {
        "experimental.session.compacting": async () => {},
      },
      policyRuntime: {
        observe: async () => {},
        enforce: async () => [],
      },
    })

    const nodes = buildExperimentalSessionCompactingNodes(
      context,
      { sessionID: "s1" },
      { context: [] }
    )

    expect(nodes.map((node) => node.id)).toEqual([
      "internal:policy-observe:experimental.session.compacting",
      "bridge:claude-code-hooks:experimental.session.compacting",
      "internal:policy-enforce:experimental.session.compacting",
    ])
  })

  test("supports policy modify to append additional compacting context", async () => {
    const output = { context: ["base"] }
    const context = createContext({
      policyRuntime: {
        observe: async () => {},
        enforce: async () => [
          {
            decisionId: "d1",
            clauseId: "c1",
            matchedClauseIds: ["c1"],
            hookPoint: "experimental.session.compacting",
            enforcement: "soft",
            decision: "modify",
            mutation: {
              additionalContext: ["extra-a", "extra-b"],
            },
            reasonCode: "COMPACTION_APPEND",
            timestamp: Date.now(),
            trace: {
              hookNodeId: "internal:policy-enforce:experimental.session.compacting",
              sessionID: "s1",
            },
          },
        ],
      },
    })

    const nodes = buildExperimentalSessionCompactingNodes(
      context,
      { sessionID: "s1" },
      output
    )

    await nodes[nodes.length - 1]?.invoke()

    expect(output.context).toEqual(["base", "extra-a", "extra-b"])
  })
})
