import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  EnvelopeValidator,
  EnvelopeFactory,
  getEnvelopeFactory,
  resetEnvelopeFactory,
  envelopeSuccess,
  envelopeError,
  envelopeSuspended,
  isEnvelopeSuccess,
  isEnvelopeError,
  isEnvelopeSuspended,
} from "./envelope"
import type { AgentEnvelope, EnvelopePermissions } from "./types"

describe("EnvelopeValidator", () => {
  let validator: EnvelopeValidator

  beforeEach(() => {
    validator = new EnvelopeValidator()
  })

  describe("wrap", () => {
    it("creates valid envelope from payload", () => {
      const payload = { data: "test" }
      const envelope = validator.wrap(payload, { type: "tool", id: "Read" })

      expect(envelope.version).toBe("1.0")
      expect(envelope.envelopeId).toBeDefined()
      expect(envelope.payload).toEqual(payload)
      expect(envelope.metadata.timestamp).toBeDefined()
      expect(envelope.metadata.integrityHash).toBeDefined()
      expect(envelope.metadata.source.type).toBe("tool")
      expect(envelope.metadata.source.id).toBe("Read")
    })

    it("uses default permissions when not provided", () => {
      const envelope = validator.wrap({}, { type: "hook", id: "test" })

      expect(envelope.permissions.grantedBy).toBe("auto-inferred")
      expect(envelope.permissions.scope).toBe("this-step")
      expect(envelope.permissions.suggestedNextActions).toEqual([])
      expect(envelope.permissions.escalationRequired).toEqual([])
      expect(envelope.permissions.forbidden).toEqual([])
    })

    it("merges provided permissions with defaults", () => {
      const envelope = validator.wrap(
        {},
        { type: "agent", id: "test" },
        {
          grantedBy: "user-escalation",
          suggestedNextActions: ["commit"],
          forbidden: ["push"],
        }
      )

      expect(envelope.permissions.grantedBy).toBe("user-escalation")
      expect(envelope.permissions.scope).toBe("this-step") // default
      expect(envelope.permissions.suggestedNextActions).toContain("commit")
      expect(envelope.permissions.forbidden).toContain("push")
    })

    it("includes optional gas and trace context", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        {},
        {
          gasUsed: 100,
          traceContext: {
            traceId: "trace-123",
            spanId: "span-456",
          },
        }
      )

      expect(envelope.metadata.gasUsed).toBe(100)
      expect(envelope.metadata.traceContext?.traceId).toBe("trace-123")
      expect(envelope.metadata.traceContext?.spanId).toBe("span-456")
    })
  })

  describe("validate", () => {
    it("validates correct envelope", () => {
      const envelope = validator.wrap({ test: "data" }, { type: "tool", id: "test" })

      const result = validator.validate(envelope)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("detects integrity hash mismatch", () => {
      const envelope = validator.wrap({ test: "data" }, { type: "tool", id: "test" })

      // Tamper with payload
      ;(envelope as any).payload = { test: "modified" }

      const result = validator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === "metadata.integrityHash")).toBe(true)
    })

    it("detects action in both suggested and forbidden", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        {
          suggestedNextActions: ["commit", "push"],
          forbidden: ["push"],
        }
      )

      const result = validator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.error.includes('"push"'))).toBe(true)
    })

    it("detects action in escalationRequired and forbidden", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        {
          escalationRequired: ["delete"],
          forbidden: ["delete"],
        }
      )

      const result = validator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.error.includes("escalation"))).toBe(true)
    })

    it("detects negative gas usage", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" }, {}, { gasUsed: -10 })

      const result = validator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === "metadata.gasUsed")).toBe(true)
    })

    it("detects gas exceeding limit", () => {
      const limitedValidator = new EnvelopeValidator({ maxGasLimit: 100 })
      const envelope = limitedValidator.wrap({}, { type: "tool", id: "test" }, {}, { gasUsed: 150 })

      const result = limitedValidator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.error.includes("exceeds limit"))).toBe(true)
    })

    it("detects invalid version", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      ;(envelope as any).version = "2.0"

      const result = validator.validate(envelope)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === "version")).toBe(true)
    })
  })

  describe("unwrap", () => {
    it("returns payload for valid envelope", () => {
      const payload = { key: "value", nested: { data: 123 } }
      const envelope = validator.wrap(payload, { type: "tool", id: "test" })

      const unwrapped = validator.unwrap(envelope)

      expect(unwrapped).toEqual(payload)
    })

    it("throws for invalid envelope", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      ;(envelope as any).payload = { tampered: true }

      expect(() => validator.unwrap(envelope)).toThrow("Envelope validation failed")
    })
  })

  describe("updateGas", () => {
    it("updates gas usage", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      expect(envelope.metadata.gasUsed).toBe(0)

      const updated = validator.updateGas(envelope, 500)

      expect(updated.metadata.gasUsed).toBe(500)
      expect(envelope.metadata.gasUsed).toBe(0) // immutable
    })
  })

  describe("withTraceContext", () => {
    it("adds trace context", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      expect(envelope.metadata.traceContext).toBeUndefined()

      const updated = validator.withTraceContext(envelope, {
        traceId: "trace-abc",
        spanId: "span-xyz",
        parentSpanId: "parent-123",
      })

      expect(updated.metadata.traceContext?.traceId).toBe("trace-abc")
      expect(updated.metadata.traceContext?.spanId).toBe("span-xyz")
      expect(updated.metadata.traceContext?.parentSpanId).toBe("parent-123")
    })
  })

  describe("updatePermissions", () => {
    it("updates permissions", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })

      const updated = validator.updatePermissions(envelope, {
        forbidden: ["delete", "truncate"],
        rationale: "Security policy",
      })

      expect(updated.permissions.forbidden).toContain("delete")
      expect(updated.permissions.forbidden).toContain("truncate")
      expect(updated.permissions.rationale).toBe("Security policy")
    })
  })

  describe("isActionAllowed", () => {
    it("returns true for allowed actions", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        { forbidden: ["delete"] }
      )

      expect(validator.isActionAllowed(envelope, "read")).toBe(true)
      expect(validator.isActionAllowed(envelope, "write")).toBe(true)
    })

    it("returns false for forbidden actions", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        { forbidden: ["delete", "truncate"] }
      )

      expect(validator.isActionAllowed(envelope, "delete")).toBe(false)
      expect(validator.isActionAllowed(envelope, "truncate")).toBe(false)
    })
  })

  describe("requiresEscalation", () => {
    it("returns true for escalation-required actions", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        { escalationRequired: ["deploy", "publish"] }
      )

      expect(validator.requiresEscalation(envelope, "deploy")).toBe(true)
      expect(validator.requiresEscalation(envelope, "publish")).toBe(true)
    })

    it("returns false for non-escalation actions", () => {
      const envelope = validator.wrap(
        {},
        { type: "tool", id: "test" },
        { escalationRequired: ["deploy"] }
      )

      expect(validator.requiresEscalation(envelope, "read")).toBe(false)
    })
  })

  describe("computeHash", () => {
    it("produces consistent hashes", () => {
      const payload = { a: 1, b: "test" }

      const hash1 = validator.computeHash(payload)
      const hash2 = validator.computeHash(payload)

      expect(hash1).toBe(hash2)
    })

    it("produces different hashes for different payloads", () => {
      const hash1 = validator.computeHash({ a: 1 })
      const hash2 = validator.computeHash({ a: 2 })

      expect(hash1).not.toBe(hash2)
    })

    it("supports different algorithms", () => {
      const sha256Validator = new EnvelopeValidator({ hashAlgorithm: "sha256" })
      const sha512Validator = new EnvelopeValidator({ hashAlgorithm: "sha512" })

      const payload = { test: "data" }
      const hash256 = sha256Validator.computeHash(payload)
      const hash512 = sha512Validator.computeHash(payload)

      expect(hash256).not.toBe(hash512)
      expect(hash512.length).toBeGreaterThan(hash256.length)
    })
  })
})

describe("EnvelopeFactory", () => {
  let factory: EnvelopeFactory

  beforeEach(() => {
    factory = new EnvelopeFactory()
  })

  describe("forTool", () => {
    it("creates envelope for tool", () => {
      const envelope = factory.forTool("Bash", { command: "ls" })

      expect(envelope.metadata.source.type).toBe("tool")
      expect(envelope.metadata.source.id).toBe("Bash")
      expect(envelope.payload).toEqual({ command: "ls" })
    })
  })

  describe("forAgent", () => {
    it("creates envelope for agent", () => {
      const envelope = factory.forAgent("explore", { task: "search" })

      expect(envelope.metadata.source.type).toBe("agent")
      expect(envelope.metadata.source.id).toBe("explore")
    })
  })

  describe("forHook", () => {
    it("creates envelope for hook", () => {
      const envelope = factory.forHook("approval-gate", { action: "check" })

      expect(envelope.metadata.source.type).toBe("hook")
      expect(envelope.metadata.source.id).toBe("approval-gate")
    })
  })

  describe("forUser", () => {
    it("creates envelope for user with escalation defaults", () => {
      const envelope = factory.forUser("user-123", { message: "hello" })

      expect(envelope.metadata.source.type).toBe("user")
      expect(envelope.metadata.source.id).toBe("user-123")
      expect(envelope.permissions.grantedBy).toBe("user-escalation")
      expect(envelope.permissions.scope).toBe("this-session")
    })
  })

  describe("getValidator", () => {
    it("returns the underlying validator", () => {
      const validator = factory.getValidator()

      expect(validator).toBeInstanceOf(EnvelopeValidator)
    })
  })
})

describe("result helpers", () => {
  let validator: EnvelopeValidator

  beforeEach(() => {
    validator = new EnvelopeValidator()
  })

  describe("envelopeSuccess", () => {
    it("creates success result", () => {
      const envelope = validator.wrap({ data: "test" }, { type: "tool", id: "test" })
      const result = envelopeSuccess(envelope)

      expect(result.status).toBe("success")
      expect(isEnvelopeSuccess(result)).toBe(true)
      if (isEnvelopeSuccess(result)) {
        expect(result.envelope).toBe(envelope)
      }
    })
  })

  describe("envelopeError", () => {
    it("creates error result", () => {
      const result = envelopeError(
        "ValidationError",
        "Invalid input",
        true,
        "Retry with correct format"
      )

      expect(result.status).toBe("error")
      expect(isEnvelopeError(result)).toBe(true)
      if (isEnvelopeError(result)) {
        expect(result.error.type).toBe("ValidationError")
        expect(result.error.message).toBe("Invalid input")
        expect(result.error.recoverable).toBe(true)
        expect(result.error.suggestedAction).toBe("Retry with correct format")
      }
    })

    it("can include partial envelope", () => {
      const partial = validator.wrap({ partial: true }, { type: "tool", id: "test" })
      const result = envelopeError("Error", "Failed", false, undefined, partial)

      expect(result.status).toBe("error")
      if (isEnvelopeError(result)) {
        expect(result.partialEnvelope).toBe(partial)
      }
    })
  })

  describe("envelopeSuspended", () => {
    it("creates suspended result", () => {
      const result = envelopeSuspended(
        "Needs approval",
        "resume-token-123",
        validator,
        { type: "tool", id: "Bash" },
        { preview: "data" }
      )

      expect(result.status).toBe("suspended")
      expect(isEnvelopeSuspended(result)).toBe(true)
      if (isEnvelopeSuspended(result)) {
        expect(result.reason).toBe("Needs approval")
        expect(result.resumeToken).toBe("resume-token-123")
        expect(result.previewData).toEqual({ preview: "data" })
        expect(result.envelope.payload.suspendedAt).toBeDefined()
      }
    })
  })

  describe("type guards", () => {
    it("correctly identifies success", () => {
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      const success = envelopeSuccess(envelope)
      const error = envelopeError("E", "msg", false)

      expect(isEnvelopeSuccess(success)).toBe(true)
      expect(isEnvelopeSuccess(error)).toBe(false)
    })

    it("correctly identifies error", () => {
      const error = envelopeError("E", "msg", false)
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      const success = envelopeSuccess(envelope)

      expect(isEnvelopeError(error)).toBe(true)
      expect(isEnvelopeError(success)).toBe(false)
    })

    it("correctly identifies suspended", () => {
      const suspended = envelopeSuspended("reason", "token", validator, { type: "tool", id: "t" })
      const envelope = validator.wrap({}, { type: "tool", id: "test" })
      const success = envelopeSuccess(envelope)

      expect(isEnvelopeSuspended(suspended)).toBe(true)
      expect(isEnvelopeSuspended(success)).toBe(false)
    })
  })
})

describe("getEnvelopeFactory singleton", () => {
  afterEach(() => {
    resetEnvelopeFactory()
  })

  it("returns singleton instance", () => {
    const factory1 = getEnvelopeFactory()
    const factory2 = getEnvelopeFactory()

    expect(factory1).toBe(factory2)
  })

  it("resets singleton on reset call", () => {
    const factory1 = getEnvelopeFactory()
    resetEnvelopeFactory()
    const factory2 = getEnvelopeFactory()

    expect(factory1).not.toBe(factory2)
  })
})
