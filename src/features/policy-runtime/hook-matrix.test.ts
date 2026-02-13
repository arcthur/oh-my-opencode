import { describe, expect, test } from "bun:test"
import { HookNameSchema } from "../../config"
import { HOOK_POLICY_MIGRATION_MATRIX } from "./hook-matrix"

describe("hook policy migration matrix", () => {
  test("covers every hook from HookNameSchema exactly once", () => {
    const schemaHooks = [...HookNameSchema.options].sort()
    const matrixHooks = Object.keys(HOOK_POLICY_MIGRATION_MATRIX).sort()
    expect(matrixHooks).toEqual(schemaHooks)
  })

  test("preserves expected migration buckets", () => {
    const entries = Object.entries(HOOK_POLICY_MIGRATION_MATRIX)

    const migrateClause = entries
      .filter(([, disposition]) => disposition === "migrate_clause")
      .map(([hook]) => hook)

    expect(migrateClause).toHaveLength(0)
  })
})
