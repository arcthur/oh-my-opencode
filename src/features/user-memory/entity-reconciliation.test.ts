import { describe, expect, test } from "bun:test"
import type { EntityGraph } from "./types"
import type { ExtractedEntity } from "./entity-extraction"
import { DEFAULT_ENTITY_GRAPH } from "./types"
import { addEntitiesAndCooccurrenceRelationships, addEntityToGraph, pruneEntityGraph } from "./entity-reconciliation"

describe("entity-reconciliation", () => {
  test("creates works_on and uses relationships from one observation", () => {
    //#given
    const baseGraph: EntityGraph = structuredClone(DEFAULT_ENTITY_GRAPH)
    const timestamp = 1_700_000_000_000
    const extracted: ExtractedEntity[] = [
      {
        id: "person:john_smith",
        name: "John Smith",
        type: "person",
        mention: { timestamp, context: "with John Smith", source: "L0" },
      },
      {
        id: "project:oh-my-opencode",
        name: "oh-my-opencode",
        type: "project",
        mention: { timestamp, context: "Project: oh-my-opencode", source: "L0" },
      },
      {
        id: "technology:typescript",
        name: "TypeScript",
        type: "technology",
        mention: { timestamp, context: "using TypeScript", source: "L0" },
      },
    ]

    //#when
    const updated = addEntitiesAndCooccurrenceRelationships(baseGraph, extracted, {
      timestamp,
      context: "Project: oh-my-opencode - worked on build",
    })

    //#then
    expect(Object.keys(updated.nodes).length).toBe(3)
    expect(updated.relationships.length).toBe(2)

    const worksOn = updated.relationships.find((r) => r.predicate === "works_on")
    expect(worksOn?.subject).toBe("person:john_smith")
    expect(worksOn?.object).toBe("project:oh-my-opencode")
    expect(worksOn?.observationCount).toBe(1)
    expect(worksOn?.confidence).toBe(0.2)

    const uses = updated.relationships.find((r) => r.predicate === "uses")
    expect(uses?.subject).toBe("project:oh-my-opencode")
    expect(uses?.object).toBe("technology:typescript")
    expect(uses?.observationCount).toBe(1)
    expect(uses?.confidence).toBe(0.2)
  })

  test("increments observationCount and confidence for repeated observations", () => {
    //#given
    const baseGraph: EntityGraph = structuredClone(DEFAULT_ENTITY_GRAPH)
    const firstTs = 1_700_000_000_000
    const secondTs = firstTs + 60_000
    const extracted: ExtractedEntity[] = [
      {
        id: "person:john_smith",
        name: "John Smith",
        type: "person",
        mention: { timestamp: firstTs, context: "with John Smith", source: "L0" },
      },
      {
        id: "project:oh-my-opencode",
        name: "oh-my-opencode",
        type: "project",
        mention: { timestamp: firstTs, context: "Project: oh-my-opencode", source: "L0" },
      },
    ]

    //#when
    const updated1 = addEntitiesAndCooccurrenceRelationships(baseGraph, extracted, {
      timestamp: firstTs,
      context: "Project: oh-my-opencode - first observation",
    })
    const updated2 = addEntitiesAndCooccurrenceRelationships(updated1, extracted, {
      timestamp: secondTs,
      context: "Project: oh-my-opencode - second observation",
    })

    //#then
    const rel = updated2.relationships.find((r) => r.predicate === "works_on")
    expect(rel?.observationCount).toBe(2)
    expect(rel?.confidence).toBe(0.4)
    expect(rel?.firstObserved).toBe(firstTs)
    expect(rel?.lastObserved).toBe(secondTs)
    expect(rel?.contextSamples.length).toBeLessThanOrEqual(3)
  })

  test("creates collaborates_with with canonical ordering", () => {
    //#given
    const baseGraph: EntityGraph = structuredClone(DEFAULT_ENTITY_GRAPH)
    const timestamp = 1_700_000_000_000
    const extracted: ExtractedEntity[] = [
      {
        id: "person:john_smith",
        name: "John Smith",
        type: "person",
        mention: { timestamp, context: "with John Smith", source: "L0" },
      },
      {
        id: "person:alice",
        name: "Alice",
        type: "person",
        mention: { timestamp, context: "with Alice", source: "L0" },
      },
    ]

    //#when
    const updated = addEntitiesAndCooccurrenceRelationships(baseGraph, extracted, {
      timestamp,
      context: "pair programming",
    })

    //#then
    const rel = updated.relationships.find((r) => r.predicate === "collaborates_with")
    expect(rel?.subject).toBe("person:alice")
    expect(rel?.object).toBe("person:john_smith")
  })

  test("does not drop single-mention nodes when under capacity", () => {
    //#given
    const baseGraph: EntityGraph = structuredClone(DEFAULT_ENTITY_GRAPH)
    const timestamp = 1_700_000_000_000
    const extracted: ExtractedEntity = {
      id: "person:john_smith",
      name: "John Smith",
      type: "person",
      mention: { timestamp, context: "with John Smith", source: "L0" },
    }

    const graphWithOne = addEntityToGraph(baseGraph, extracted)

    //#when
    const pruned = pruneEntityGraph(graphWithOne, 200, 500, 2)

    //#then
    expect(Object.keys(pruned.nodes).length).toBe(1)
  })
})
