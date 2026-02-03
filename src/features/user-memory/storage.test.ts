import { describe, test, expect, spyOn, afterEach, mock } from "bun:test"
import * as storage from "./storage"
import { buildMemorySummary, normalizeArgsToPattern, addWorkHistoryEntry, migrateUserMemory } from "./storage"
import {
  DEFAULT_CONFIG,
  DEFAULT_ENTITY_MEMORY_CONFIG,
  DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  DEFAULT_USER_MEMORY,
  type UserMemory,
} from "./types"
import * as embeddingsProvider from "./embeddings/provider"
import * as embeddingsCache from "./embeddings/cache"
import * as bm25 from "./embeddings/bm25"
import * as hybrid from "./embeddings/hybrid"

describe("user-memory storage", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("searchMemory", () => {
    test("uses most recent 20 work history entries (not oldest) when building candidates", async () => {
      // given
      const now = 1_700_000_000_000
      spyOn(Date, "now").mockReturnValue(now)

      const workHistory = Array.from({ length: 30 }, (_, i) => ({
        // Newest first: 30..1
        timestamp: now - i * 1000,
        summary: `entry-${30 - i}`,
        project: "proj-x",
      }))

      spyOn(storage, "loadUserMemory").mockReturnValue({
        ...DEFAULT_USER_MEMORY,
        workHistory,
      } as unknown as UserMemory)

      // Make embeddings enabled and short-circuit heavy dependencies
      spyOn(embeddingsCache, "loadEmbeddingCache").mockReturnValue({
        embeddings: {
          version: 1,
          provider: "local",
          model: "Xenova/all-MiniLM-L6-v2",
          dimension: 384,
          entries: {},
          lastUpdated: now,
        },
        bm25Index: {
          documents: [],
          documentFrequency: {},
          avgDocLength: 0,
          totalDocuments: 0,
          version: 1,
          lastUpdated: now,
        },
      })

      spyOn(bm25, "deserializeBM25Index").mockReturnValue({
        documents: [],
        documentFrequency: new Map(),
        avgDocLength: 0,
        totalDocuments: 0,
        version: 1,
        lastUpdated: now,
      })

      spyOn(embeddingsProvider, "getProviderWithFallback").mockResolvedValue({
        provider: { name: "local", dimension: 384, embed: async () => [[]], isAvailable: async () => true },
        usedFallback: false,
      })

      const searchHybridSpy = spyOn(hybrid, "searchHybrid").mockResolvedValue([])

      // when
      await storage.searchMemory("query", { enabled: true, provider: "local", cache_enabled: true, batch_size: 20 }, 5)

      // then
      expect(searchHybridSpy).toHaveBeenCalled()
      const candidatesArg = searchHybridSpy.mock.calls[0]?.[1] as Array<{ id: string; text: string }>
      const historyCandidates = candidatesArg.filter((c) => c.id.startsWith("history:"))
      expect(historyCandidates).toHaveLength(20)

      const texts = historyCandidates.map((c) => c.text)
      expect(texts.some((t) => t.endsWith("entry-30"))).toBe(true)
      expect(texts.some((t) => t.endsWith("entry-11"))).toBe(true)
      expect(texts.some((t) => t.endsWith("entry-10"))).toBe(false)
      expect(texts.some((t) => t.endsWith("entry-1"))).toBe(false)
    })
  })

  describe("buildMemorySummary", () => {
    test("filters entity injection using injection_confidence_threshold and min_mentions", () => {
      // given
      const now = 1_700_000_000_000
      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: now,
        schemaVersion: 3,
        weeklySummaries: [],
        monthlySummaries: [],
        longTermKnowledge: [],
        entityGraph: {
          nodes: {
            "person:alice": {
              id: "person:alice",
              name: "Alice",
              type: "person",
              aliases: [],
              aliasConfidence: {},
              mentions: [],
              mentionCount: 1,
              firstSeen: now,
              lastSeen: now,
              metadata: {},
            },
            "person:bob": {
              id: "person:bob",
              name: "Bob",
              type: "person",
              aliases: [],
              aliasConfidence: {},
              mentions: [],
              mentionCount: 2,
              firstSeen: now,
              lastSeen: now,
              metadata: {},
            },
            "project:proj": {
              id: "project:proj",
              name: "proj",
              type: "project",
              aliases: [],
              aliasConfidence: {},
              mentions: [],
              mentionCount: 2,
              firstSeen: now,
              lastSeen: now,
              metadata: {},
            },
            "technology:typescript": {
              id: "technology:typescript",
              name: "TypeScript",
              type: "technology",
              aliases: [],
              aliasConfidence: {},
              mentions: [],
              mentionCount: 1,
              firstSeen: now,
              lastSeen: now,
              metadata: {},
            },
          },
          relationships: [
            {
              id: "rel:person:bob|works_on|project:proj",
              subject: "person:bob",
              predicate: "works_on",
              object: "project:proj",
              confidence: 0.4,
              observationCount: 2,
              firstObserved: now,
              lastObserved: now,
              contextSamples: ["pairing"],
            },
            {
              id: "rel:project:proj|uses|technology:typescript",
              subject: "project:proj",
              predicate: "uses",
              object: "technology:typescript",
              confidence: 0.4,
              observationCount: 2,
              firstObserved: now,
              lastObserved: now,
              contextSamples: ["build"],
            },
          ],
          aliasIndex: {},
          lastExtraction: now,
          graphVersion: 1,
        },
      }

      const entityConfig = {
        ...DEFAULT_ENTITY_MEMORY_CONFIG,
        enabled: true,
        min_mentions: 2,
        injection_confidence_threshold: 0.4,
      }

      // when
      const summary = buildMemorySummary(memory, {
        temporalConfig: { ...DEFAULT_TEMPORAL_VALIDITY_CONFIG, enabled: false },
        disclosureLevel: "full",
        entityConfig,
      })

      // then
      expect(summary).not.toBeNull()
      expect(summary).toContain("Bob")
      expect(summary).not.toContain("Alice")
      expect(summary).toContain("Bob works on proj")
      // TypeScript node is below threshold => relationship should not be injected
      expect(summary).not.toContain("uses TypeScript")
    })
  })

  describe("normalizeArgsToPattern", () => {
    describe("Read tool", () => {
      test("extracts directory pattern from absolute path", () => {
        // Absolute paths keep first two segments after splitting by /
        const result = normalizeArgsToPattern("Read", {
          file_path: "/Users/test/project/src/hooks/preemptive-compaction/index.ts",
        })
        // Leading "/" creates empty first element, so first two non-empty are "Users" and "test"
        expect(result).toBe("/Users/*")
      })

      test("extracts directory pattern from relative path", () => {
        const result = normalizeArgsToPattern("Read", {
          file_path: "src/hooks/preemptive-compaction/index.ts",
        })
        expect(result).toBe("src/hooks/*")
      })

      test("handles shallow paths", () => {
        const result = normalizeArgsToPattern("Read", {
          file_path: "package.json",
        })
        // Single segment gets /* suffix
        expect(result).toBe("package.json/*")
      })

      test("handles filePath variant", () => {
        const result = normalizeArgsToPattern("Read", {
          filePath: "src/index.ts",
        })
        expect(result).toBe("src/*")
      })
    })

    describe("Glob tool", () => {
      test("preserves glob pattern", () => {
        const result = normalizeArgsToPattern("Glob", {
          pattern: "**/*.ts",
        })
        expect(result).toBe("**/*.ts")
      })

      test("truncates long patterns", () => {
        const longPattern = "a".repeat(60)
        const result = normalizeArgsToPattern("Glob", {
          pattern: longPattern,
        })
        expect(result?.length).toBeLessThanOrEqual(50)
        expect(result).toContain("...")
      })
    })

    describe("Grep tool", () => {
      test("categorizes TODO patterns", () => {
        expect(normalizeArgsToPattern("Grep", { pattern: "TODO" })).toBe("TODO/FIXME patterns")
        expect(normalizeArgsToPattern("Grep", { pattern: "FIXME" })).toBe("TODO/FIXME patterns")
        expect(normalizeArgsToPattern("Grep", { pattern: "XXX" })).toBe("TODO/FIXME patterns")
      })

      test("categorizes import patterns", () => {
        expect(normalizeArgsToPattern("Grep", { pattern: "import.*from" })).toBe("import statements")
        expect(normalizeArgsToPattern("Grep", { pattern: "require\\(" })).toBe("import statements")
      })

      test("categorizes definition patterns", () => {
        expect(normalizeArgsToPattern("Grep", { pattern: "function\\s+\\w+" })).toBe("definitions")
        expect(normalizeArgsToPattern("Grep", { pattern: "class Foo" })).toBe("definitions")
        expect(normalizeArgsToPattern("Grep", { pattern: "interface Bar" })).toBe("definitions")
      })

      test("preserves short patterns", () => {
        expect(normalizeArgsToPattern("Grep", { pattern: "foobar" })).toBe("foobar")
      })

      test("truncates long patterns", () => {
        const longPattern = "verylongpatternthatshouldbetruncated"
        const result = normalizeArgsToPattern("Grep", { pattern: longPattern })
        expect(result?.length).toBeLessThanOrEqual(30)
      })
    })

    describe("Bash tool", () => {
      test("extracts npm commands", () => {
        expect(normalizeArgsToPattern("Bash", { command: "npm install" })).toBe("npm install")
        expect(normalizeArgsToPattern("Bash", { command: "npm test --watch" })).toBe("npm test")
        expect(normalizeArgsToPattern("Bash", { command: "npm run build" })).toBe("npm run")
      })

      test("extracts git commands", () => {
        expect(normalizeArgsToPattern("Bash", { command: "git status" })).toBe("git status")
        expect(normalizeArgsToPattern("Bash", { command: "git commit -m 'test'" })).toBe("git commit")
      })

      test("extracts other commands", () => {
        expect(normalizeArgsToPattern("Bash", { command: "ls -la" })).toBe("ls")
        expect(normalizeArgsToPattern("Bash", { command: "echo hello" })).toBe("echo")
      })
    })

    describe("edge cases", () => {
      test("returns null for null args", () => {
        expect(normalizeArgsToPattern("Read", null)).toBeNull()
      })

      test("returns null for non-object args", () => {
        expect(normalizeArgsToPattern("Read", "string")).toBeNull()
      })

      test("returns null for unknown tool", () => {
        expect(normalizeArgsToPattern("UnknownTool", { some: "args" })).toBeNull()
      })
    })
  })

  describe("addWorkHistoryEntry", () => {
    test("sets temporal validity defaults for new entries", () => {
      // given
      const now = 1_700_000_123_000
      spyOn(Date, "now").mockReturnValue(now)
      const loadSpy = spyOn(storage, "loadUserMemory").mockReturnValue({
        ...DEFAULT_USER_MEMORY,
      })
      const saveSpy = spyOn(storage, "saveUserMemory").mockImplementation(() => {})

      // when
      addWorkHistoryEntry({ summary: "Test entry", project: "proj-x" }, DEFAULT_CONFIG)

      // then
      expect(loadSpy).toHaveBeenCalled()
      expect(saveSpy).toHaveBeenCalled()
      const saved = saveSpy.mock.calls[0]?.[0] as UserMemory
      const entry = saved.workHistory[0]
      expect(entry.valid_from).toBe(now)
      expect(entry.staleness_category).toBe("short-term")
    })
  })

  describe("migrateUserMemory", () => {
    test("fills missing temporal fields and preserves unknown fields", () => {
      // given
      const now = 1_700_000_500_000
      spyOn(Date, "now").mockReturnValue(now)
      const legacy = {
        schemaVersion: 2,
        preferences: { tone: "concise" },
        environment: {},
        workHistory: [
          { timestamp: now - 1000, summary: "Legacy entry" },
        ],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: now - 1000,
        customField: "keep-me",
      } as Partial<UserMemory> & { customField: string }

      // when
      const migrated = migrateUserMemory(legacy)

      // then
      expect(migrated.schemaVersion).toBe(3)
      expect(migrated.workHistory[0]?.valid_from).toBe(legacy.workHistory?.[0]?.timestamp)
      expect(migrated.workHistory[0]?.staleness_category).toBe("short-term")
      expect((migrated as unknown as Record<string, unknown>).customField).toBe("keep-me")
    })
  })
})
