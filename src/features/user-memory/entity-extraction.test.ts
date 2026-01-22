import { describe, expect, test } from "bun:test"
import type { WeeklySummary } from "./types"
import { extractEntitiesFromText, extractEntitiesFromWeeklySummary } from "./entity-extraction"

describe("entity-extraction", () => {
  test("extracts concept entities from explicit patterns", () => {
    //#given
    const text = "Pattern: Dependency Injection improves testability."

    //#when
    const entities = extractEntitiesFromText(text, 1_700_000_000_000)

    //#then
    const concept = entities.find((e) => e.type === "concept")
    expect(concept?.name.startsWith("Dependency Injection")).toBe(true)
  })

  test("marks weekly summary entities as L1 with sourceId", () => {
    //#given
    const weekly: WeeklySummary = {
      weekStart: 1_700_000_000_000,
      weekEnd: 1_700_000_000_000 + 6 * 24 * 60 * 60 * 1000,
      summary: "Worked with Alice. Pattern: Hexagonal Architecture.",
      projects: ["proj-alpha"],
      keyAchievements: ["Shipped feature"],
      lessonsLearned: ["Concept: Dependency Inversion"],
      techStack: ["TypeScript"],
      entryCount: 3,
    }

    //#when
    const entities = extractEntitiesFromWeeklySummary(weekly)

    //#then
    expect(entities.length).toBeGreaterThan(0)
    const l1Mentions = entities.filter((e) => e.mention.source === "L1")
    expect(l1Mentions.length).toBeGreaterThan(0)
    expect(l1Mentions.every((e) => e.mention.sourceId === String(weekly.weekStart))).toBe(true)
  })
})
