import { describe, expect, test } from "bun:test"
import { extractCacheUsageSnapshot } from "./probe"

describe("extractCacheUsageSnapshot", () => {
  test("parses canonical tokens payload with cache read/write", () => {
    // #given
    const payload = {
      tokens: {
        input: 1200,
        output: 400,
        cache: { read: 300, write: 50 },
      },
    }

    // #when
    const snapshot = extractCacheUsageSnapshot(payload)

    // #then
    expect(snapshot.inputTokens).toBe(1200)
    expect(snapshot.outputTokens).toBe(400)
    expect(snapshot.cacheReadTokens).toBe(300)
    expect(snapshot.cacheWriteTokens).toBe(50)
    expect(snapshot.effectiveInputTokens).toBe(1500)
    expect(snapshot.totalTokens).toBe(1900)
    expect(snapshot.cacheHitRatio).toBeCloseTo(0.2, 5)
    expect(snapshot.confidence).toBe("high")
  })

  test("avoids double counting when prompt token field already includes cached tokens", () => {
    // #given
    const payload = {
      usage: {
        prompt_tokens: 2000,
        completion_tokens: 500,
        prompt_tokens_details: {
          cached_tokens: 600,
        },
      },
    }

    // #when
    const snapshot = extractCacheUsageSnapshot(payload)

    // #then
    expect(snapshot.inputTokens).toBe(2000)
    expect(snapshot.cacheReadTokens).toBe(600)
    expect(snapshot.includesCacheInInput).toBe(true)
    expect(snapshot.effectiveInputTokens).toBe(2000)
    expect(snapshot.totalTokens).toBe(2500)
    expect(snapshot.cacheHitRatio).toBeCloseTo(0.3, 5)
  })

  test("infers input tokens from total tokens when explicit input is unavailable", () => {
    // #given
    const payload = {
      usage: {
        total_tokens: 1800,
        completion_tokens: 300,
      },
    }

    // #when
    const snapshot = extractCacheUsageSnapshot(payload)

    // #then
    expect(snapshot.inputTokens).toBe(1500)
    expect(snapshot.outputTokens).toBe(300)
    expect(snapshot.totalTokens).toBe(1800)
    expect(snapshot.effectiveInputTokens).toBe(1500)
    expect(snapshot.confidence).toBe("medium")
  })
})

