import { describe, expect, test } from "bun:test"
import { createLookAt, normalizeArgs, validateArgs } from "./tools"

describe("look-at tool", () => {
  describe("normalizeArgs", () => {
    test("normalizes `path` to `file_path` for LLM compatibility", () => {
      // given
      const args = { path: "/some/file.png", goal: "analyze" }

      // when
      const normalized = normalizeArgs(args as any)

      // then
      expect(normalized.file_path).toBe("/some/file.png")
      expect(normalized.goal).toBe("analyze")
    })

    test("keeps `file_path` when properly provided", () => {
      // given
      const args = { file_path: "/correct/path.pdf", goal: "extract" }

      // when
      const normalized = normalizeArgs(args)

      // then
      expect(normalized.file_path).toBe("/correct/path.pdf")
    })

    test("prefers `file_path` over `path` when both are provided", () => {
      // given
      const args = { file_path: "/preferred.png", path: "/fallback.png", goal: "test" }

      // when
      const normalized = normalizeArgs(args as any)

      // then
      expect(normalized.file_path).toBe("/preferred.png")
    })
  })

  describe("validateArgs", () => {
    test("returns null for valid args", () => {
      // given
      const args = { file_path: "/valid/path.png", goal: "analyze" }

      // when / then
      expect(validateArgs(args)).toBeNull()
    })

    test("returns an error when `file_path` is missing", () => {
      // given
      const args = { goal: "analyze" } as any

      // when
      const error = validateArgs(args)

      // then
      expect(error).toContain("file_path")
      expect(error).toContain("required")
    })

    test("returns an error when `goal` is missing", () => {
      // given
      const args = { file_path: "/some/path.png" } as any

      // when
      const error = validateArgs(args)

      // then
      expect(error).toContain("goal")
      expect(error).toContain("required")
    })

    test("returns an error when `file_path` is an empty string", () => {
      // given
      const args = { file_path: "", goal: "analyze" }

      // when
      const error = validateArgs(args)

      // then
      expect(error).toContain("file_path")
    })
  })

  describe("createLookAt error handling", () => {
    test("handles JSON parse error from session.prompt gracefully", async () => {
      // given
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_json_error" } }),
          prompt: async () => {
            throw new Error("JSON Parse error: Unexpected EOF")
          },
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // when
      const result = await tool.execute(
        { file_path: "/test/file.png", goal: "analyze image" },
        toolContext,
      )

      // then
      expect(result).toContain("Error: Failed to analyze file")
      expect(result).toContain("malformed response")
      expect(result).toContain("multimodal-looker")
      expect(result).toContain("image/png")
    })

    test("returns assistant output even when prompt throws", async () => {
      // given
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_prompt_error_with_message" } }),
          prompt: async () => {
            throw {}
          },
          messages: async () => ({
            data: [
              {
                info: { role: "assistant", time: { created: 1 } },
                parts: [{ type: "text", text: "analysis result despite prompt error" }],
              },
            ],
          }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // when
      const result = await tool.execute(
        { file_path: "/test/file.png", goal: "analyze image" },
        toolContext,
      )

      // then
      expect(result).toBe("analysis result despite prompt error")
    })

    test("handles generic prompt error gracefully", async () => {
      // given
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_generic_error" } }),
          prompt: async () => {
            throw new Error("Network connection failed")
          },
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // when
      const result = await tool.execute(
        { file_path: "/test/file.pdf", goal: "extract text" },
        toolContext,
      )

      // then
      expect(result).toContain("Error: Failed to send prompt")
      expect(result).toContain("Network connection failed")
    })
  })

  describe("createLookAt model passthrough", () => {
    test("passes multimodal-looker model and variant to session.prompt when available", async () => {
      // given
      let promptBody: any

      const mockClient = {
        app: {
          agents: async () => ({
            data: [
              {
                name: "multimodal-looker",
                mode: "subagent",
                model: { providerID: "google", modelID: "gemini-3-flash" },
                variant: "vision-high",
              },
            ],
          }),
        },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_model_passthrough" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [
              {
                info: { role: "assistant", time: { created: 1 } },
                parts: [{ type: "text", text: "done" }],
              },
            ],
          }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // when
      const result = await tool.execute(
        { file_path: "/test/file.png", goal: "analyze image" },
        toolContext
      )

      // then
      expect(result).toBe("done")
      expect(promptBody.model).toEqual({
        providerID: "google",
        modelID: "gemini-3-flash",
      })
      expect(promptBody.variant).toBe("vision-high")
    })
  })
})
