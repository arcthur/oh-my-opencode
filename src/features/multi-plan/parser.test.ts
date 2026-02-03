import { describe, test, expect } from "bun:test"
import { parseRejectedModels } from "./parser"

describe("parseRejectedModels", () => {
  // #region single conflict
  describe("single conflict section", () => {
    test("extracts only rejected model (winner excluded) from conflict", () => {
      // given
      const report = `### CONFLICT: Authentication approach

**strategist says**: Use JWT tokens
**creative says**: Use session cookies

---

**Why strategist is WRONG**: Stateless JWT adds complexity for mobile refresh
**Why creative is WRONG**: Less secure for API access

---

**VERDICT**: ACCEPT strategist
**RECOMMENDATION**: Use JWT with refresh token rotation`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - only loser appears, winner (strategist) excluded
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("creative")
      expect(result[0].conflictId).toBe("Authentication approach")
      expect(result[0].criticism).toContain("Less secure")
      expect(result.find((r) => r.modelName === "strategist")).toBeUndefined()
    })
  })
  // #endregion

  // #region multiple conflicts
  describe("multiple conflict sections", () => {
    test("extracts rejections from all conflicts", () => {
      // given
      const report = `### CONFLICT: API design

**strategist says**: REST
**creative says**: GraphQL

---

**Why strategist is WRONG**: Too rigid
**Why creative is WRONG**: Over-engineered

---

**VERDICT**: ACCEPT strategist

### CONFLICT: State management

**strategist says**: Redux
**creative says**: Zustand

---

**Why strategist is WRONG**: Too much boilerplate
**Why creative is WRONG**: Less ecosystem support

---

**VERDICT**: ACCEPT creative`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        modelName: "creative",
        conflictId: "API design",
        criticism: "Over-engineered",
      })
      expect(result[1]).toEqual({
        modelName: "strategist",
        conflictId: "State management",
        criticism: "Too much boilerplate",
      })
    })

    test("same model can be rejected in multiple conflicts", () => {
      // given
      const report = `### CONFLICT: Auth
**A says**: X
**B says**: Y
---
**Why A is WRONG**: Bad
**Why B is WRONG**: Worse
---
**VERDICT**: ACCEPT A

### CONFLICT: DB
**A says**: Postgres
**B says**: Mongo
---
**Why A is WRONG**: Overkill
**Why B is WRONG**: No ACID
---
**VERDICT**: ACCEPT A`

      // when
      const result = parseRejectedModels(report, ["A", "B"])

      // then
      expect(result).toHaveLength(2)
      expect(result.every((r) => r.modelName === "B")).toBe(true)
      expect(result.map((r) => r.conflictId)).toEqual(["Auth", "DB"])
    })
  })
  // #endregion

  // #region verdict types
  describe("verdict types", () => {
    test("VERDICT: MERGE rejects all models with criticism", () => {
      // given - MERGE means no single winner
      const report = `### CONFLICT: Caching strategy

**strategist says**: Redis
**creative says**: In-memory

---

**Why strategist is WRONG**: Adds infrastructure
**Why creative is WRONG**: Not distributed

---

**VERDICT**: MERGE
**RECOMMENDATION**: Use both - in-memory for hot data, Redis for persistence`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - both should be in rejections since MERGE has no single winner
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.modelName).sort()).toEqual(["creative", "strategist"])
    })

    test("VERDICT: MERGE with explicit winners only rejects excluded models", () => {
      // given - MERGE lists which models are included
      const report = `### CONFLICT: Authentication token storage

**strategist says**: HttpOnly cookie
**pragmatist says**: Bearer token in memory
**creative says**: LocalStorage token

---

**Why strategist is WRONG** (but not fatally): Cookies complicate CSRF
**Why pragmatist is WRONG** (but not fatally): Memory tokens break refresh flows
**Why creative is WRONG**: LocalStorage is vulnerable to XSS

---

**VERDICT**: MERGE strategist + pragmatist
**RECOMMENDATION**: Use cookie for web + memory token for native app`

      // when
      const result = parseRejectedModels(report, ["strategist", "pragmatist", "creative"])

      // then - only creative is excluded from merge
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("creative")
      expect(result[0].conflictId).toBe("Authentication token storage")
    })

    test("VERDICT: BOTH_VALID produces no rejections", () => {
      // given
      const report = `### CONFLICT: Optimization approach

**strategist says**: Add caching
**creative says**: Add indexes

---

**Why strategist is WRONG**: N/A - complementary approach
**Why creative is WRONG**: N/A - complementary approach

---

**VERDICT**: BOTH_VALID
**RECOMMENDATION**: Do both - they are complementary`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result).toHaveLength(0)
    })

    test("VERDICT: PARALLEL_SPIKE produces no rejections", () => {
      // given - PARALLEL_SPIKE defers decision to validation experiment
      const report = `### CONFLICT: Data storage strategy

**strategist says**: Use Redis for fast reads
**creative says**: Use PostgreSQL with caching

---

**Why strategist is WRONG**: Adds infrastructure complexity
**Why creative is WRONG**: May not handle high read load

---

**VERDICT**: PARALLEL_SPIKE
**RATIONALE**: Performance depends on actual usage patterns

**SPIKE DESIGN**:
- **Hypothesis**: PostgreSQL can handle expected load
- **Decision Criteria**: P99 latency <50ms
- **Time-box**: 4 hours

**TEMPORARY DECISION**: creative`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - no rejections since decision is deferred to spike
      expect(result).toHaveLength(0)
    })

    test("VERDICT: REJECT ALL marks all models as rejected", () => {
      // given
      const report = `### CONFLICT: Error handling

**strategist says**: Use exceptions
**creative says**: Use result types

---

**Why strategist is WRONG**: Performance overhead
**Why creative is WRONG**: Verbose code

---

**VERDICT**: REJECT ALL
**RECOMMENDATION**: Need to rethink the approach`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - "REJECT" matches first word, so all models should be rejected
      expect(result).toHaveLength(2)
    })

    test("handles backtick-wrapped verdict", () => {
      // given
      const report = `### CONFLICT: Testing

**strategist says**: Unit tests
**creative says**: E2E tests

---

**Why strategist is WRONG**: Too isolated
**Why creative is WRONG**: Too slow

---

**VERDICT**: \`ACCEPT strategist\``

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("creative")
    })

    test("handles ACCEPT winner with braces and possessive suffix", () => {
      // given
      const report = `### CONFLICT: Cache invalidation

**strategist says**: Write-through
**creative says**: TTL only

---

**Why strategist is WRONG**: Can cause thundering herd
**Why creative is WRONG**: Stale data risks

---

**VERDICT**: ACCEPT {strategist}'s approach`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - strategist is winner, so only creative rejected
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("creative")
    })

    test("handles ACCEPT winner with spaces in model name", () => {
      // given
      const report = `### CONFLICT: Deployment strategy

**Strategy Expert says**: Blue/green deployment
**Creative Thinker says**: Canary deployment

---

**Why Strategy Expert is WRONG**: Requires extra infra
**Why Creative Thinker is WRONG**: Operationally complex

---

**VERDICT**: ACCEPT Strategy Expert`

      // when
      const result = parseRejectedModels(report, ["Strategy Expert", "Creative Thinker"])

      // then - only loser appears, winner excluded
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("Creative Thinker")
      expect(result.find((r) => r.modelName === "Strategy Expert")).toBeUndefined()
    })
  })
  // #endregion

  // #region edge cases
  describe("edge cases", () => {
    test("returns empty array for empty report", () => {
      // given
      const report = ""

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result).toHaveLength(0)
    })

    test("returns empty array for report with no CONFLICT sections", () => {
      // given
      const report = `# Plan Comparison Report

## Summary
All plans were in agreement. No conflicts detected.`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result).toHaveLength(0)
    })

    test("handles malformed CONFLICT section gracefully", () => {
      // given - missing VERDICT
      const report = `### CONFLICT: Incomplete section

**strategist says**: Something
**creative says**: Something else

**Why strategist is WRONG**: Reason
**Why creative is WRONG**: Another reason`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - both models should be rejected since no winner
      expect(result).toHaveLength(2)
    })

    test("deduplicates same model-conflict pair", () => {
      // given - hypothetical case where same model mentioned twice
      const report = `### CONFLICT: Duplicate test

**strategist says**: X

---

**Why strategist is WRONG**: First reason
**Why strategist is WRONG**: Second reason

---

**VERDICT**: ACCEPT creative`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - should only have one entry for strategist in this conflict
      const strategistRejections = result.filter((r) => r.modelName === "strategist")
      expect(strategistRejections).toHaveLength(1)
    })

    test("uses 'general' as conflictId when header is missing", () => {
      // given - CONFLICT: followed immediately by newline
      const report = `### CONFLICT:

**strategist says**: X
**creative says**: Y

---

**Why strategist is WRONG**: Bad
**Why creative is WRONG**: Worse

---

**VERDICT**: ACCEPT strategist`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then
      expect(result[0].conflictId).toBe("general")
    })
  })
  // #endregion

  // #region case sensitivity
  describe("case sensitivity", () => {
    test("model name matching is case insensitive for winner", () => {
      // given
      const report = `### CONFLICT: Test

**Strategist says**: X
**Creative says**: Y

---

**Why Strategist is WRONG**: Bad
**Why Creative is WRONG**: Worse

---

**VERDICT**: ACCEPT STRATEGIST`

      // when - model names passed with different case
      const result = parseRejectedModels(report, ["strategist", "creative"])

      // then - strategist should not be rejected despite case difference
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("creative")
    })

    test("preserves original model name case in output", () => {
      // given
      const report = `### CONFLICT: Test

**STRATEGIST says**: X
**CREATIVE says**: Y

---

**Why STRATEGIST is WRONG**: Bad
**Why CREATIVE is WRONG**: Worse

---

**VERDICT**: ACCEPT STRATEGIST`

      // when
      const result = parseRejectedModels(report, ["Strategist", "Creative"])

      // then - output should use the case from modelNames parameter
      expect(result[0].modelName).toBe("Creative")
    })
  })
  // #endregion

  // #region three models
  describe("three or more models", () => {
    test("correctly identifies single winner among three models", () => {
      // given
      const report = `### CONFLICT: Architecture

**strategist says**: Microservices
**creative says**: Serverless
**practical says**: Monolith

---

**Why strategist is WRONG**: Overkill for small team
**Why creative is WRONG**: Vendor lock-in
**Why practical is WRONG**: Hard to scale

---

**VERDICT**: ACCEPT practical`

      // when
      const result = parseRejectedModels(report, ["strategist", "creative", "practical"])

      // then - two models should be rejected
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.modelName).sort()).toEqual(["creative", "strategist"])
      expect(result.find((r) => r.modelName === "practical")).toBeUndefined()
    })
  })
  // #endregion

  // #region special characters
  describe("special characters in model names", () => {
    test("handles model names with special regex characters", () => {
      // given - model name with characters that need escaping
      const report = `### CONFLICT: Test

**model.v1 says**: X
**model.v2 says**: Y

---

**Why model.v1 is WRONG**: Outdated
**Why model.v2 is WRONG**: Unstable

---

**VERDICT**: ACCEPT model.v1`

      // when
      const result = parseRejectedModels(report, ["model.v1", "model.v2"])

      // then
      expect(result).toHaveLength(1)
      expect(result[0].modelName).toBe("model.v2")
    })
  })
  // #endregion
})
