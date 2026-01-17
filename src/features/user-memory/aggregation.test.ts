import { describe, test, expect, beforeEach } from "bun:test"
import type { WorkHistoryEntry, WeeklySummary, MonthlySummary, LongTermKnowledge, UserMemory } from "./types"
import {
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  formatMonth,
  crossedWeekBoundary,
  crossedMonthBoundary,
  crossedKnowledgeExtractionBoundary,
  extractProjects,
  extractTechStack,
  aggregateToWeekly,
  aggregateToMonthly,
  extractLongTermKnowledge,
  mergeKnowledge,
  performAggregations,
  initializeAggregationTimestamps,
  type SummarizeFunction,
} from "./aggregation"

describe("aggregation", () => {
  // ============================================================================
  // Time Boundary Utilities
  // ============================================================================

  describe("getWeekStart", () => {
    test("returns Monday 00:00:00 for a Wednesday", () => {
      // Wednesday, January 15, 2025
      const wednesday = new Date("2025-01-15T12:30:00Z").getTime()
      const weekStart = getWeekStart(wednesday)
      const date = new Date(weekStart)

      expect(date.getDay()).toBe(1) // Monday
      expect(date.getHours()).toBe(0)
      expect(date.getMinutes()).toBe(0)
      expect(date.getSeconds()).toBe(0)
    })

    test("returns same Monday for a Monday", () => {
      // Monday, January 13, 2025
      const monday = new Date("2025-01-13T15:00:00Z").getTime()
      const weekStart = getWeekStart(monday)
      const date = new Date(weekStart)

      expect(date.getDay()).toBe(1) // Monday
      expect(date.getDate()).toBe(13)
    })

    test("returns previous Monday for a Sunday", () => {
      // Sunday, January 19, 2025
      const sunday = new Date("2025-01-19T10:00:00Z").getTime()
      const weekStart = getWeekStart(sunday)
      const date = new Date(weekStart)

      expect(date.getDay()).toBe(1) // Monday
      expect(date.getDate()).toBe(13) // Previous Monday
    })
  })

  describe("getWeekEnd", () => {
    test("returns Sunday 23:59:59.999 for a Wednesday", () => {
      const wednesday = new Date("2025-01-15T12:30:00Z").getTime()
      const weekEnd = getWeekEnd(wednesday)
      const weekStart = getWeekStart(wednesday)

      // Week end should be 7 days - 1ms after week start
      expect(weekEnd - weekStart).toBe(7 * 24 * 60 * 60 * 1000 - 1)
    })
  })

  describe("formatMonth", () => {
    test("formats month correctly", () => {
      const jan2025 = new Date("2025-01-15T12:00:00Z").getTime()
      expect(formatMonth(jan2025)).toBe("2025-01")

      const dec2024 = new Date("2024-12-25T12:00:00Z").getTime()
      expect(formatMonth(dec2024)).toBe("2024-12")
    })
  })

  describe("crossedWeekBoundary", () => {
    test("returns false when lastAggregation is undefined", () => {
      const now = Date.now()
      expect(crossedWeekBoundary(undefined, now)).toBe(false)
    })

    test("returns true when weeks are different", () => {
      const lastWeek = new Date("2025-01-06T12:00:00Z").getTime() // Week of Jan 6
      const thisWeek = new Date("2025-01-13T12:00:00Z").getTime() // Week of Jan 13
      expect(crossedWeekBoundary(lastWeek, thisWeek)).toBe(true)
    })

    test("returns false when within same week", () => {
      const monday = new Date("2025-01-13T09:00:00Z").getTime()
      const friday = new Date("2025-01-17T17:00:00Z").getTime()
      expect(crossedWeekBoundary(monday, friday)).toBe(false)
    })
  })

  describe("crossedMonthBoundary", () => {
    test("returns false when lastAggregation is undefined", () => {
      expect(crossedMonthBoundary(undefined, Date.now())).toBe(false)
    })

    test("returns true when months are different", () => {
      const december = new Date("2024-12-15T12:00:00Z").getTime()
      const january = new Date("2025-01-15T12:00:00Z").getTime()
      expect(crossedMonthBoundary(december, january)).toBe(true)
    })

    test("returns false when within same month", () => {
      const jan1 = new Date("2025-01-01T12:00:00Z").getTime()
      const jan31 = new Date("2025-01-31T12:00:00Z").getTime()
      expect(crossedMonthBoundary(jan1, jan31)).toBe(false)
    })
  })

  describe("crossedKnowledgeExtractionBoundary", () => {
    test("returns false when lastExtraction is undefined", () => {
      expect(crossedKnowledgeExtractionBoundary(undefined, Date.now())).toBe(false)
    })

    test("returns true after 3 months by default", () => {
      const threeMonthsAgo = Date.now() - 100 * 24 * 60 * 60 * 1000 // ~100 days
      expect(crossedKnowledgeExtractionBoundary(threeMonthsAgo, Date.now())).toBe(true)
    })

    test("returns false before interval", () => {
      const oneMonthAgo = Date.now() - 25 * 24 * 60 * 60 * 1000 // ~25 days
      expect(crossedKnowledgeExtractionBoundary(oneMonthAgo, Date.now())).toBe(false)
    })
  })

  // ============================================================================
  // Metadata Extraction
  // ============================================================================

  describe("extractProjects", () => {
    test("extracts unique projects", () => {
      const entries: WorkHistoryEntry[] = [
        { timestamp: Date.now(), summary: "Test", project: "project-a" },
        { timestamp: Date.now(), summary: "Test", project: "project-b" },
        { timestamp: Date.now(), summary: "Test", project: "project-a" },
        { timestamp: Date.now(), summary: "Test" },
      ]

      const projects = extractProjects(entries)
      expect(projects).toHaveLength(2)
      expect(projects).toContain("project-a")
      expect(projects).toContain("project-b")
    })
  })

  describe("extractTechStack", () => {
    test("extracts tech from file extensions", () => {
      const entries: WorkHistoryEntry[] = [
        {
          timestamp: Date.now(),
          summary: "Test",
          filesModified: ["src/index.ts", "src/App.tsx"],
        },
        {
          timestamp: Date.now(),
          summary: "Test",
          filesModified: ["main.py", "config.json"],
        },
      ]

      const techStack = extractTechStack(entries)
      expect(techStack).toContain("TypeScript")
      expect(techStack).toContain("Python")
    })

    test("extracts tech from summary keywords", () => {
      const entries: WorkHistoryEntry[] = [
        { timestamp: Date.now(), summary: "Implemented React component" },
        { timestamp: Date.now(), summary: "Added GraphQL resolver" },
      ]

      const techStack = extractTechStack(entries)
      expect(techStack).toContain("React")
      expect(techStack).toContain("GraphQL")
    })

    test("detects testing files", () => {
      const entries: WorkHistoryEntry[] = [
        {
          timestamp: Date.now(),
          summary: "Test",
          filesModified: ["src/utils.test.ts"],
        },
      ]

      const techStack = extractTechStack(entries)
      expect(techStack).toContain("Testing")
    })
  })

  // ============================================================================
  // Aggregation Functions
  // ============================================================================

  describe("aggregateToWeekly", () => {
    const mockSummarizer: SummarizeFunction = async () => ({
      summary: "Mocked summary",
      achievements: ["Achievement 1"],
      lessons: ["Lesson 1"],
    })

    test("creates empty summary when no entries", async () => {
      const weekStart = new Date("2025-01-13").getTime()
      const weekEnd = getWeekEnd(weekStart)

      const summary = await aggregateToWeekly([], weekStart, weekEnd, mockSummarizer)

      expect(summary.entryCount).toBe(0)
      expect(summary.projects).toHaveLength(0)
      expect(summary.summary).toContain("No recorded work sessions")
    })

    test("aggregates entries within week range", async () => {
      const weekStart = new Date("2025-01-13").getTime()
      const weekEnd = getWeekEnd(weekStart)

      const entries: WorkHistoryEntry[] = [
        { timestamp: weekStart + 1000, summary: "Task 1", project: "proj-a" },
        { timestamp: weekStart + 2000, summary: "Task 2", project: "proj-b" },
        { timestamp: weekEnd + 1000, summary: "Outside week", project: "proj-c" }, // Outside range
      ]

      const summary = await aggregateToWeekly(entries, weekStart, weekEnd, mockSummarizer)

      expect(summary.entryCount).toBe(2)
      expect(summary.projects).toHaveLength(2)
      expect(summary.projects).not.toContain("proj-c")
    })

    test("uses fallback when summarizer fails", async () => {
      const failingSummarizer: SummarizeFunction = async () => {
        throw new Error("LLM unavailable")
      }

      const weekStart = new Date("2025-01-13").getTime()
      const weekEnd = getWeekEnd(weekStart)

      const entries: WorkHistoryEntry[] = [
        { timestamp: weekStart + 1000, summary: "Task 1", project: "proj", outcome: "success" },
      ]

      const summary = await aggregateToWeekly(entries, weekStart, weekEnd, failingSummarizer)

      expect(summary.entryCount).toBe(1)
      expect(summary.summary).toContain("1 work sessions")
    })
  })

  describe("aggregateToMonthly", () => {
    const mockSummarizer: SummarizeFunction = async () => ({
      summary: "Monthly summary",
      achievements: ["Monthly achievement"],
      lessons: ["Monthly lesson"],
      techEvolution: "Added TypeScript",
    })

    test("creates empty summary when no weeks", async () => {
      const summary = await aggregateToMonthly([], "2025-01", mockSummarizer)

      expect(summary.weekCount).toBe(0)
      expect(summary.summary).toContain("No recorded work sessions")
    })

    test("aggregates weeks within month", async () => {
      const weeks: WeeklySummary[] = [
        {
          weekStart: new Date("2025-01-06").getTime(),
          weekEnd: getWeekEnd(new Date("2025-01-06").getTime()),
          summary: "Week 1",
          projects: ["proj-a"],
          keyAchievements: ["Done task 1"],
          lessonsLearned: [],
          techStack: ["TypeScript"],
          entryCount: 3,
        },
        {
          weekStart: new Date("2025-01-13").getTime(),
          weekEnd: getWeekEnd(new Date("2025-01-13").getTime()),
          summary: "Week 2",
          projects: ["proj-b"],
          keyAchievements: ["Done task 2"],
          lessonsLearned: ["Lesson 1"],
          techStack: ["Python"],
          entryCount: 2,
        },
        {
          weekStart: new Date("2025-02-03").getTime(), // February - should be excluded
          weekEnd: getWeekEnd(new Date("2025-02-03").getTime()),
          summary: "Week in Feb",
          projects: ["proj-c"],
          keyAchievements: [],
          lessonsLearned: [],
          techStack: [],
          entryCount: 1,
        },
      ]

      const summary = await aggregateToMonthly(weeks, "2025-01", mockSummarizer)

      expect(summary.weekCount).toBe(2)
      expect(summary.projects).toContain("proj-a")
      expect(summary.projects).toContain("proj-b")
      expect(summary.projects).not.toContain("proj-c")
    })
  })

  // ============================================================================
  // Knowledge Extraction
  // ============================================================================

  describe("mergeKnowledge", () => {
    test("adds new knowledge items", () => {
      const existing: LongTermKnowledge[] = [
        {
          category: "lesson",
          content: "Always write tests",
          confidence: 0.8,
          firstSeen: Date.now() - 100000,
          lastReinforced: Date.now() - 50000,
          sourceMonths: ["2024-12"],
        },
      ]

      const newKnowledge: LongTermKnowledge[] = [
        {
          category: "pattern",
          content: "Use dependency injection",
          confidence: 0.6,
          firstSeen: Date.now(),
          lastReinforced: Date.now(),
          sourceMonths: ["2025-01"],
        },
      ]

      const merged = mergeKnowledge(existing, newKnowledge, 50)

      expect(merged).toHaveLength(2)
    })

    test("reinforces similar knowledge by merging source months", () => {
      // Existing knowledge from 2 months
      // Content must be similar enough to get "high" confidence (>= 0.6 similarity score)
      const existing: LongTermKnowledge[] = [
        {
          category: "lesson",
          content: "Always write unit tests for critical functions",
          confidence: 0.4,  // 2 months = 2/5 = 0.4
          firstSeen: Date.now() - 100000,
          lastReinforced: Date.now() - 50000,
          sourceMonths: ["2024-11", "2024-12"],
        },
      ]

      // New knowledge from a different month - content is nearly identical for high similarity
      const newKnowledge: LongTermKnowledge[] = [
        {
          category: "lesson",
          content: "Always write unit tests for critical functions in your code",
          confidence: 0.4,
          firstSeen: Date.now(),
          lastReinforced: Date.now(),
          sourceMonths: ["2025-01"],
        },
      ]

      const merged = mergeKnowledge(existing, newKnowledge, 50)

      expect(merged).toHaveLength(1)
      // Now 3 unique months: 2024-11, 2024-12, 2025-01 => confidence = 3/5 = 0.6
      expect(merged[0].confidence).toBe(0.6)
      expect(merged[0].sourceMonths).toHaveLength(3)
      expect(merged[0].sourceMonths).toContain("2025-01")
    })

    test("respects caller-provided limit", () => {
      //#given
      const now = Date.now()
      const existing: LongTermKnowledge[] = []
      const newKnowledge: LongTermKnowledge[] = Array.from({ length: 60 }, (_, i) => ({
        category: "lesson",
        content: `insight-${i}-token`,
        confidence: 0.6,
        firstSeen: now,
        lastReinforced: now,
        sourceMonths: ["2025-01"],
      }))

      //#when
      const merged = mergeKnowledge(existing, newKnowledge, 100)

      //#then
      expect(merged).toHaveLength(60)
    })

    test("enforces limit to avoid unbounded growth", () => {
      //#given
      const now = Date.now()
      const existing: LongTermKnowledge[] = Array.from({ length: 45 }, (_, i) => ({
        category: "lesson",
        content: `existing-${i}`,
        confidence: 0.6,
        firstSeen: now,
        lastReinforced: now,
        sourceMonths: ["2025-01"],
      }))
      const newKnowledge: LongTermKnowledge[] = Array.from({ length: 10 }, (_, i) => ({
        category: "pattern",
        content: `new-${i}`,
        confidence: 0.6,
        firstSeen: now,
        lastReinforced: now,
        sourceMonths: ["2025-02"],
      }))

      //#when
      const merged = mergeKnowledge(existing, newKnowledge, 50)

      //#then
      expect(merged).toHaveLength(50)
    })

    test("retains expired knowledge items for history (not injected by default)", () => {
      //#given
      const now = Date.now()
      const existing: LongTermKnowledge[] = [
        {
          category: "lesson",
          content: "Old preference that was superseded",
          confidence: 1.0,
          firstSeen: now - 100_000,
          lastReinforced: now - 90_000,
          valid_until: now - 1,
          sourceMonths: ["2025-01"],
        },
        {
          category: "lesson",
          content: "Active preference",
          confidence: 0.8,
          firstSeen: now - 50_000,
          lastReinforced: now - 10_000,
          sourceMonths: ["2025-02"],
        },
      ]

      const newKnowledge: LongTermKnowledge[] = []

      //#when
      const merged = mergeKnowledge(existing, newKnowledge, 50)

      //#then
      expect(merged).toHaveLength(2)
      expect(merged[0]?.content).toBe("Active preference")
      expect(merged.some((k) => k.content === "Old preference that was superseded")).toBe(true)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("initializeAggregationTimestamps", () => {
    test("initializes timestamps for new memory", () => {
      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [{ timestamp: Date.now(), summary: "Test" }],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: Date.now(),
        schemaVersion: 2,
      }

      const now = Date.now()
      const initialized = initializeAggregationTimestamps(memory, now)

      expect(initialized.lastWeeklyAggregation).toBe(now)
      expect(initialized.lastMonthlyAggregation).toBe(now)
      expect(initialized.lastKnowledgeExtraction).toBe(now)
      expect(initialized.weeklySummaries).toEqual([])
      expect(initialized.monthlySummaries).toEqual([])
      expect(initialized.longTermKnowledge).toEqual([])
    })
  })

  describe("performAggregations", () => {
    const mockSummarizer: SummarizeFunction = async () => ({
      summary: "Test summary",
      achievements: [],
      lessons: [],
    })

    test("skips aggregation when disabled", async () => {
      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: Date.now(),
        schemaVersion: 2,
        lastWeeklyAggregation: Date.now(),
      }

      const result = await performAggregations(memory, Date.now(), mockSummarizer, {
        enabled: false,
        weekly_summaries_limit: 12,
        monthly_summaries_limit: 12,
        long_term_knowledge_limit: 50,
        aggregation_model: "haiku",
        auto_aggregate: true,
      })

      expect(result).toEqual(memory)
    })

    test("initializes arrays if undefined", async () => {
      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: Date.now(),
        schemaVersion: 2,
        lastWeeklyAggregation: Date.now(),
      }

      const result = await performAggregations(memory, Date.now(), mockSummarizer, {
        enabled: true,
        weekly_summaries_limit: 12,
        monthly_summaries_limit: 12,
        long_term_knowledge_limit: 50,
        aggregation_model: "haiku",
        auto_aggregate: true,
      })

      expect(result.weeklySummaries).toEqual([])
      expect(result.monthlySummaries).toEqual([])
      expect(result.longTermKnowledge).toEqual([])
    })

    test("aggregates multiple skipped weeks without data loss", async () => {
      // Scenario: user skips 2 weeks, has data in both weeks
      const week1Start = new Date("2025-01-06").getTime() // Week 1 Mon
      const week2Start = new Date("2025-01-13").getTime() // Week 2 Mon
      const week3Start = new Date("2025-01-20").getTime() // Week 3 Mon (current)

      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [
          { timestamp: week1Start + 1000, summary: "Week 1 task", project: "proj-a", outcome: "success" },
          { timestamp: week2Start + 1000, summary: "Week 2 task", project: "proj-b", outcome: "success" },
        ],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: Date.now(),
        schemaVersion: 2,
        lastWeeklyAggregation: week1Start, // Last aggregation was week 1
        weeklySummaries: [],
        monthlySummaries: [],
        longTermKnowledge: [],
      }

      const result = await performAggregations(memory, week3Start, mockSummarizer, {
        enabled: true,
        weekly_summaries_limit: 12,
        monthly_summaries_limit: 12,
        long_term_knowledge_limit: 50,
        aggregation_model: "haiku",
        auto_aggregate: true,
      })

      // Should have 2 weekly summaries (week 1 and week 2)
      expect(result.weeklySummaries?.length).toBe(2)
      // workHistory should be cleaned (only current week kept)
      expect(result.workHistory.length).toBe(0)
      // lastWeeklyAggregation should be updated
      expect(result.lastWeeklyAggregation).toBe(week3Start)
    })

    test("handles empty summarizer response with fallback", async () => {
      const emptySummarizer: SummarizeFunction = async () => ({
        summary: "", // Empty response
        achievements: [],
        lessons: [],
      })

      const weekStart = new Date("2025-01-06").getTime()
      const weekEnd = getWeekEnd(weekStart)
      const entries: WorkHistoryEntry[] = [
        { timestamp: weekStart + 1000, summary: "Task 1", project: "proj", outcome: "success" },
      ]

      const summary = await aggregateToWeekly(entries, weekStart, weekEnd, emptySummarizer)

      // Should use fallback summary, not empty string
      expect(summary.summary).not.toBe("")
      expect(summary.summary).toContain("1 work sessions")
      expect(summary.entryCount).toBe(1)
    })

    test("aggregates multiple skipped months correctly", async () => {
      // Scenario: user skips 2 months
      const dec2024 = new Date("2024-12-15").getTime()
      const mar2025 = new Date("2025-03-15").getTime() // Current

      const memory: UserMemory = {
        preferences: {},
        environment: {},
        workHistory: [],
        customRules: [],
        frequentPatterns: [],
        explicitMemories: [],
        lastUpdated: Date.now(),
        schemaVersion: 2,
        lastWeeklyAggregation: mar2025,
        lastMonthlyAggregation: dec2024, // Last monthly aggregation was Dec 2024
        weeklySummaries: [
          {
            weekStart: new Date("2024-12-09").getTime(),
            weekEnd: getWeekEnd(new Date("2024-12-09").getTime()),
            summary: "Dec week",
            projects: ["proj-dec"],
            keyAchievements: [],
            lessonsLearned: [],
            techStack: [],
            entryCount: 1,
          },
          {
            weekStart: new Date("2025-01-06").getTime(),
            weekEnd: getWeekEnd(new Date("2025-01-06").getTime()),
            summary: "Jan week",
            projects: ["proj-jan"],
            keyAchievements: [],
            lessonsLearned: [],
            techStack: [],
            entryCount: 1,
          },
          {
            weekStart: new Date("2025-02-03").getTime(),
            weekEnd: getWeekEnd(new Date("2025-02-03").getTime()),
            summary: "Feb week",
            projects: ["proj-feb"],
            keyAchievements: [],
            lessonsLearned: [],
            techStack: [],
            entryCount: 1,
          },
        ],
        monthlySummaries: [],
        longTermKnowledge: [],
      }

      const result = await performAggregations(memory, mar2025, mockSummarizer, {
        enabled: true,
        weekly_summaries_limit: 12,
        monthly_summaries_limit: 12,
        long_term_knowledge_limit: 50,
        aggregation_model: "haiku",
        auto_aggregate: true,
      })

      // Should have 3 monthly summaries (Dec, Jan, Feb)
      expect(result.monthlySummaries?.length).toBe(3)
      expect(result.lastMonthlyAggregation).toBe(mar2025)
    })

    test("trims long-term knowledge to long_term_knowledge_limit on extraction", async () => {
      //#given
      const day = 24 * 60 * 60 * 1000
      const now = new Date("2025-04-15T00:00:00Z").getTime()
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
        longTermKnowledge: Array.from({ length: 55 }, (_, i) => ({
          category: "lesson",
          content: `insight-${i}-token`,
          confidence: 0.6,
          firstSeen: now,
          lastReinforced: now,
          sourceMonths: ["2025-01"],
        })),
        lastKnowledgeExtraction: now - 100 * day, // force extraction boundary
      }

      //#when
      const result = await performAggregations(memory, now, mockSummarizer, {
        enabled: true,
        weekly_summaries_limit: 12,
        monthly_summaries_limit: 12,
        long_term_knowledge_limit: 50,
        aggregation_model: "haiku",
        auto_aggregate: true,
      })

      //#then
      expect(result.longTermKnowledge).toHaveLength(50)
    })
  })
})
