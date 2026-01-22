import { describe, expect, test } from "bun:test"
import {
  PROMPT_TAGS,
  detectPromptKind,
  extractJson,
  parseWithSchema,
  parseWeeklySummarization,
  parseMonthlySummarization,
  parseKnowledgeExtraction,
  parseMergeDecision,
  extractAssistantText,
  parseMonthToTimestamp,
  WeeklySummarizationResponseSchema,
} from "./schemas"

describe("schemas", () => {
  describe("PROMPT_TAGS", () => {
    test("contains all expected tags", () => {
      expect(PROMPT_TAGS.weekly).toBe("[UserMemory:Weekly]")
      expect(PROMPT_TAGS.monthly).toBe("[UserMemory:Monthly]")
      expect(PROMPT_TAGS.merge).toBe("[UserMemory:MergeDecision]")
      expect(PROMPT_TAGS.knowledge).toBe("[UserMemory:Knowledge]")
    })
  })

  describe("detectPromptKind", () => {
    test("detects weekly prompt", () => {
      expect(detectPromptKind("Some text [UserMemory:Weekly] more text")).toBe("weekly")
    })

    test("detects monthly prompt", () => {
      expect(detectPromptKind("[UserMemory:Monthly]")).toBe("monthly")
    })

    test("detects knowledge prompt", () => {
      expect(detectPromptKind("[UserMemory:Knowledge] extract")).toBe("knowledge")
    })

    test("returns unknown for untagged prompt", () => {
      expect(detectPromptKind("no tags here")).toBe("unknown")
    })
  })

  describe("extractJson", () => {
    test("extracts JSON from markdown code block", () => {
      const response = '```json\n{"summary": "test"}\n```'
      expect(extractJson(response)).toBe('{"summary": "test"}')
    })

    test("extracts raw JSON object", () => {
      const response = 'Some text {"summary": "test"} more text'
      expect(extractJson(response)).toBe('{"summary": "test"}')
    })

    test("returns null for no JSON", () => {
      expect(extractJson("no json here")).toBeNull()
    })
  })

  describe("parseWithSchema", () => {
    test("parses valid JSON with schema", () => {
      const response = '{"summary": "test", "achievements": ["a"], "lessons": []}'
      const result = parseWithSchema(response, WeeklySummarizationResponseSchema, {
        summary: "",
        achievements: [],
        lessons: [],
      })
      expect(result.data.summary).toBe("test")
      expect(result.error).toBeNull()
    })

    test("returns fallback for invalid JSON", () => {
      const result = parseWithSchema("not json", WeeklySummarizationResponseSchema, {
        summary: "fallback",
        achievements: [],
        lessons: [],
      })
      expect(result.data.summary).toBe("fallback")
      expect(result.error).not.toBeNull()
    })

    test("returns fallback for schema validation failure", () => {
      const response = '{"summary": 123}' // summary should be string
      const result = parseWithSchema(response, WeeklySummarizationResponseSchema, {
        summary: "fallback",
        achievements: [],
        lessons: [],
      })
      expect(result.data.summary).toBe("fallback")
    })
  })

  describe("parseWeeklySummarization", () => {
    test("parses valid response", () => {
      const response = '{"summary": "Did stuff", "achievements": ["thing"], "lessons": ["learned"]}'
      const result = parseWeeklySummarization(response)
      expect(result.summary).toBe("Did stuff")
      expect(result.achievements).toEqual(["thing"])
      expect(result.lessons).toEqual(["learned"])
    })

    test("handles missing fields with defaults", () => {
      const response = '{"summary": "minimal"}'
      const result = parseWeeklySummarization(response)
      expect(result.summary).toBe("minimal")
      expect(result.achievements).toEqual([])
      expect(result.lessons).toEqual([])
    })
  })

  describe("parseMonthlySummarization", () => {
    test("parses valid response with techEvolution", () => {
      const response = JSON.stringify({
        summary: "Monthly work",
        achievements: ["shipped"],
        lessons: ["test early"],
        techEvolution: "Added TypeScript",
      })
      const result = parseMonthlySummarization(response)
      expect(result.summary).toBe("Monthly work")
      expect(result.techEvolution).toBe("Added TypeScript")
    })
  })

  describe("parseKnowledgeExtraction", () => {
    test("parses valid knowledge array", () => {
      const response = JSON.stringify({
        knowledge: [
          {
            category: "lesson",
            content: "Write tests first",
            confidence: 0.8,
            sourceMonths: ["2024-01", "2024-02"],
          },
        ],
      })
      const result = parseKnowledgeExtraction(response)
      expect(result.knowledge).toHaveLength(1)
      expect(result.knowledge[0].category).toBe("lesson")
      expect(result.knowledge[0].confidence).toBe(0.8)
    })

    test("returns empty array for invalid response", () => {
      const result = parseKnowledgeExtraction("not json")
      expect(result.knowledge).toEqual([])
    })
  })

  describe("parseMergeDecision", () => {
    test("parses merge decision", () => {
      const response = JSON.stringify({
        same_insight: true,
        reason: "Same concept",
        merged_content: "Combined insight",
      })
      const result = parseMergeDecision(response)
      expect(result.same_insight).toBe(true)
      expect(result.merged_content).toBe("Combined insight")
    })

    test("returns false for invalid response", () => {
      const result = parseMergeDecision("invalid")
      expect(result.same_insight).toBe(false)
    })
  })

  describe("extractAssistantText", () => {
    test("extracts text from valid session messages", () => {
      const messages = [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text", text: "question" }],
        },
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [{ type: "text", text: "answer" }],
        },
      ]
      expect(extractAssistantText(messages)).toBe("answer")
    })

    test("returns latest assistant message", () => {
      const messages = [
        {
          info: { role: "assistant", time: { created: 1 } },
          parts: [{ type: "text", text: "first" }],
        },
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [{ type: "text", text: "second" }],
        },
      ]
      expect(extractAssistantText(messages)).toBe("second")
    })

    test("returns null for no assistant message", () => {
      const messages = [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text", text: "question" }],
        },
      ]
      expect(extractAssistantText(messages)).toBeNull()
    })

    test("returns null for invalid input", () => {
      expect(extractAssistantText("not an array")).toBeNull()
      expect(extractAssistantText(null)).toBeNull()
    })
  })

  describe("parseMonthToTimestamp", () => {
    test("parses valid month format", () => {
      const result = parseMonthToTimestamp("2024-01")
      expect(result).toBe(new Date("2024-01-01T00:00:00Z").getTime())
    })

    test("returns null for invalid format", () => {
      expect(parseMonthToTimestamp("2024")).toBeNull()
      expect(parseMonthToTimestamp("2024-1")).toBeNull()
      expect(parseMonthToTimestamp("January 2024")).toBeNull()
    })

    test("returns null for invalid date", () => {
      expect(parseMonthToTimestamp("2024-13")).toBeNull()
    })
  })
})
