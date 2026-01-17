import { describe, test, expect } from "bun:test"
import { buildMemorySummary, normalizeArgsToPattern } from "./storage"
import { DEFAULT_ENTITY_MEMORY_CONFIG, DEFAULT_TEMPORAL_VALIDITY_CONFIG, type UserMemory } from "./types"

describe("user-memory storage", () => {
  describe("buildMemorySummary", () => {
    test("filters entity injection using injection_confidence_threshold and min_mentions", () => {
      //#given
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

      //#when
      const summary = buildMemorySummary(memory, {
        temporalConfig: { ...DEFAULT_TEMPORAL_VALIDITY_CONFIG, enabled: false },
        disclosureLevel: "full",
        entityConfig,
      })

      //#then
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
})
