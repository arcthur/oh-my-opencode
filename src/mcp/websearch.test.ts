import { afterEach, describe, expect, test } from "bun:test"
import { createWebsearchConfig } from "./websearch"

describe("websearch MCP config", () => {
  const originalExaApiKey = process.env.EXA_API_KEY

  afterEach(() => {
    if (originalExaApiKey === undefined) {
      delete process.env.EXA_API_KEY
      return
    }
    process.env.EXA_API_KEY = originalExaApiKey
  })

  test("uses base Exa URL when EXA_API_KEY is not set", () => {
    // #given
    delete process.env.EXA_API_KEY

    // #when
    const result = createWebsearchConfig()

    // #then
    expect(result.url).toBe("https://mcp.exa.ai/mcp?tools=web_search_exa")
    expect(result.headers).toBeUndefined()
    expect(result.oauth).toBe(false)
  })

  test("adds encoded exaApiKey query param when EXA_API_KEY is set", () => {
    // #given
    const apiKey = "test key+/=?"
    process.env.EXA_API_KEY = apiKey

    // #when
    const result = createWebsearchConfig()

    // #then
    expect(result.url).toContain(`exaApiKey=${encodeURIComponent(apiKey)}`)
    expect(result.headers).toEqual({
      "x-api-key": apiKey,
    })
    expect(result.oauth).toBe(false)
  })
})
