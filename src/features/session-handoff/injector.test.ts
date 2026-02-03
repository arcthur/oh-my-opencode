import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { HandoffPackage } from "./types"
import * as storage from "./storage"

mock.module("./storage", () => {
  return {
    ...storage,
    loadHandoff: mock(() => null),
    getRecentSessionHandoffs: mock(() => []),
    findHandoffsForProject: mock(() => []),
    loadEmbeddings: mock(() => null),
    saveEmbeddings: mock(() => {}),
    saveHandoff: mock(() => {}),
  }
})

function createTestHandoff(id: string): HandoffPackage {
  return {
    id,
    sourceSessionId: "session-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    metadata: {
      originalGoal: "Test goal",
      durationMs: 1,
      projectPath: "/test/project",
      keyFiles: [],
      outcome: "completed",
    },
    payload: {
      decisions: [],
      artifacts: [],
      antiPatterns: [],
      domainContext: [],
    },
    embeddingIndex: [],
  }
}

describe("resolveSessionReference", () => {
  beforeEach(() => {
    const {
      loadHandoff,
      getRecentSessionHandoffs,
      findHandoffsForProject,
      loadEmbeddings,
      saveEmbeddings,
      saveHandoff,
    } = require("./storage")

    loadHandoff.mockReset()
    getRecentSessionHandoffs.mockReset()
    findHandoffsForProject.mockReset()
    loadEmbeddings.mockReset()
    saveEmbeddings.mockReset()
    saveHandoff.mockReset()
  })

  test("resolves @session:handoff:ho_* to a direct handoff", async () => {
    const { loadHandoff } = require("./storage")
    const pkg = createTestHandoff("ho_123_abc")
    loadHandoff.mockImplementation((id: string) => (id === pkg.id ? pkg : null))

    const { resolveSessionReference } = require("./injector")

    // given
    const projectPath = "/test/project"
    const identifier = "handoff:ho_123_abc"

    // when
    const resolved = await resolveSessionReference(projectPath, identifier)

    // then
    expect(loadHandoff).toHaveBeenCalledWith("ho_123_abc")
    expect(resolved).toContain("ho_123_abc")
    expect(resolved).toContain("Test goal")
  })

  test("rejects unsafe handoff identifiers", async () => {
    const { loadHandoff } = require("./storage")
    const pkg = createTestHandoff("ho_999_xyz")
    loadHandoff.mockImplementation((id: string) => (id === pkg.id ? pkg : null))

    const { resolveSessionReference } = require("./injector")

    // given
    const projectPath = "/test/project"
    const identifier = "handoff:../ho_999_xyz"

    // when
    const resolved = await resolveSessionReference(projectPath, identifier)

    // then
    expect(loadHandoff).not.toHaveBeenCalled()
    expect(resolved).toBeNull()
  })

  test("uses embedding-based semantic search when embeddings are available", async () => {
    const { loadHandoff, loadEmbeddings } = require("./storage")
    const pkg = createTestHandoff("ho_abc_123")
    pkg.embeddingIndex = [
      { id: "e0", content: "alpha", category: "decision", index: 0, vectorIndex: 0 },
      { id: "e1", content: "beta", category: "decision", index: 1, vectorIndex: 1 },
    ]

    loadHandoff.mockImplementation((id: string) => (id === pkg.id ? pkg : null))
    loadEmbeddings.mockImplementation((id: string) =>
      id === pkg.id
        ? [new Float32Array([1, 0]), new Float32Array([0, 1])]
        : null
    )

    const { resolveSessionReference } = require("./injector")

    // given
    const projectPath = "/test/project"
    const identifier = `handoff:${pkg.id}`
    const query = { type: "semantic" as const, query: "alpha" }

    const embed = mock(async (texts: string[]): Promise<number[][]> => {
      return texts.map(() => [1, 0])
    })

    // when
    const resolved = await resolveSessionReference(projectPath, identifier, query, {
      embeddings: { embed, maxResults: 5, minRelevance: 0.3 },
    })

    // then
    expect(loadEmbeddings).toHaveBeenCalledWith(pkg.id)
    expect(embed).toHaveBeenCalledWith(["alpha"])
    expect(resolved).toContain("## Semantic Matches")
    expect(resolved).toContain("alpha")
    expect(resolved).not.toContain("beta")
  })

  test("generates and persists embeddings on demand when missing", async () => {
    const { loadHandoff, loadEmbeddings, saveEmbeddings, saveHandoff } = require("./storage")
    const pkg = createTestHandoff("ho_lazy_1")
    pkg.payload.decisions = [
      { what: "alpha", chosen: "x", why: "y" },
    ]
    pkg.embeddingIndex = []

    loadHandoff.mockImplementation((id: string) => (id === pkg.id ? pkg : null))
    loadEmbeddings.mockImplementation((id: string) =>
      id === pkg.id ? [new Float32Array([1, 0])] : null
    )

    const { resolveSessionReference } = require("./injector")

    // given
    const projectPath = "/test/project"
    const identifier = `handoff:${pkg.id}`
    const query = { type: "semantic" as const, query: "alpha" }

    const embed = mock(async (texts: string[]): Promise<number[][]> => {
      return texts.map(() => [1, 0])
    })

    // when
    const resolved = await resolveSessionReference(projectPath, identifier, query, {
      embeddings: { embed, maxResults: 5, minRelevance: 0.3, generateIfMissing: true },
    })

    // then
    expect(saveEmbeddings).toHaveBeenCalled()
    expect(saveHandoff).toHaveBeenCalled()
    expect(embed).toHaveBeenCalledTimes(2)
    expect(pkg.embeddingIndex?.length).toBeGreaterThan(0)
    expect(resolved).toContain("## Semantic Matches")
  })
})
