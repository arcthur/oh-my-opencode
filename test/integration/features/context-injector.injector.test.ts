import { describe, it, expect, beforeEach } from "bun:test"
import type { AssistantMessage, Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk"
import { ContextCollector } from "../../../src/features/context-injector/collector"
import {
  createContextInjectorMessagesTransformHook,
} from "../../../src/features/context-injector/injector"
import {
  clearAllPrefixFingerprintsForTesting,
  getPrefixFingerprintForSession,
} from "../../../src/features/context-injector/prefix-fingerprint"

describe("createContextInjectorMessagesTransformHook", () => {
  let collector: ContextCollector

  beforeEach(() => {
    collector = new ContextCollector()
    clearAllPrefixFingerprintsForTesting()
  })

  type MessageWithParts = {
    info: Message
    parts: Part[]
  }

  function createTextPart(sessionID: string, messageID: string, text: string): TextPart {
    return {
      id: `part_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sessionID,
      messageID,
      type: "text",
      text,
    }
  }

  function createUserMessage(sessionID: string, text: string): MessageWithParts {
    const id = `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const info: UserMessage = {
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "orchestrator",
      model: { providerID: "test", modelID: "test" },
    }

    return {
      info,
      parts: [createTextPart(sessionID, id, text)],
    }
  }

  function createAssistantMessage(sessionID: string, text: string): MessageWithParts {
    const id = `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const info: AssistantMessage = {
      id,
      sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      parentID: "parent",
      modelID: "test",
      providerID: "test",
      mode: "default",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    }

    return {
      info,
      parts: [createTextPart(sessionID, id, text)],
    }
  }

  it("inserts synthetic part before text part in last user message", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform1"
    collector.register(sessionID, {
      id: "ulw",
      source: "keyword-detector",
      content: "Ultrawork context",
    })
    const messages = [
      createUserMessage(sessionID, "First message"),
      createAssistantMessage(sessionID, "Response"),
      createUserMessage(sessionID, "Second message"),
    ]
    const output: { messages: MessageWithParts[] } = { messages }

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then - synthetic part inserted before original text part
    expect(output.messages.length).toBe(3)
    expect(output.messages[2].parts.length).toBe(2)
    expect(output.messages[2].parts[0].text).toBe("Ultrawork context")
    expect(output.messages[2].parts[0].synthetic).toBe(true)
    expect(output.messages[2].parts[1].text).toBe("Second message")
  })

  it("uses prefix compiler output when compiler is enabled", async () => {
    // given
    const sessionID = "ses_compiler_enabled"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Dynamic tail",
    })
    const hook = createContextInjectorMessagesTransformHook(collector, {
      compiler: {
        enabled: true,
        separator: "\n\n---\n\n",
        maxPrefixSegments: 8,
        maxPrefixChars: 2000,
      },
      ledgerStore: {
        readSegments: () => [
          {
            id: "seg_1",
            sessionID,
            index: 0,
            source: "rules-injector",
            content: "Stable prefix",
            immutable: true,
            previousHash: "root",
            hash: "hash-1",
            createdAt: Date.now(),
          },
        ],
        computePrefixFingerprint: () => "fp_123",
      },
    })

    const messages = [createUserMessage(sessionID, "Message")]
    const output: { messages: MessageWithParts[] } = { messages }

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    const injected = output.messages[0].parts[0]
    expect(injected.text).toContain("Stable prefix")
    expect(injected.text).toContain("Dynamic tail")
    expect(injected.metadata?.prefixFingerprint).toBe("fp_123")
    expect(getPrefixFingerprintForSession(sessionID)).toBe("fp_123")
  })

  it("does nothing when no pending context", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform2"
    const messages = [createUserMessage(sessionID, "Hello world")]
    const output: { messages: MessageWithParts[] } = { messages }

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages.length).toBe(1)
  })

  it("does nothing when no user messages", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform3"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const messages = [createAssistantMessage(sessionID, "Response")]
    const output: { messages: MessageWithParts[] } = { messages }

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages.length).toBe(1)
    expect(collector.hasPending(sessionID)).toBe(true)
  })

  it("consumes context after injection", async () => {
    // given
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_transform4"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const messages = [createUserMessage(sessionID, "Message")]
    const output: { messages: MessageWithParts[] } = { messages }

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(collector.hasPending(sessionID)).toBe(false)
  })
})
