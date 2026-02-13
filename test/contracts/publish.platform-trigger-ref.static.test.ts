import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("publish workflow platform trigger ref", () => {
  test("triggers publish-platform workflow using version tag ref", () => {
    //#given
    const publishWorkflowPath = resolve(import.meta.dir, "../../.github/workflows/publish.yml")
    const content = readFileSync(publishWorkflowPath, "utf-8")

    //#when
    const triggerCommandIndex = content.indexOf("gh workflow run publish-platform.yml")
    const versionFieldIndex = content.indexOf("-f version=${{ needs.publish-main.outputs.version }}")
    const tagRefIndex = content.indexOf("--ref v${{ needs.publish-main.outputs.version }}")
    const branchRefIndex = content.indexOf("--ref ${{ github.ref }}")

    //#then
    expect(triggerCommandIndex).toBeGreaterThanOrEqual(0)
    expect(versionFieldIndex).toBeGreaterThanOrEqual(0)
    expect(tagRefIndex).toBeGreaterThanOrEqual(0)
    expect(branchRefIndex).toBe(-1)
  })
})
