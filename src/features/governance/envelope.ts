/**
 * Agent Envelope Implementation
 *
 * Structured envelope protocol for agent/tool communication.
 * Provides integrity verification, permission tracking, and traceability.
 *
 * @see docs/governance-orchestration-design.md Section 2.4
 */

import { createHash, randomUUID } from "node:crypto"
import type {
  AgentEnvelope,
  EnvelopeMetadata,
  EnvelopePermissions,
  EnvelopeResult,
  EnvelopeValidationResult,
  EnvelopeValidationError,
} from "./types"

// ============================================================================
// Envelope Validator
// ============================================================================

/**
 * Configuration for envelope validation
 */
export interface EnvelopeValidatorConfig {
  /** Hash algorithm to use (default: sha256) */
  hashAlgorithm?: "sha256" | "sha384" | "sha512"

  /** Maximum allowed gas usage */
  maxGasLimit?: number

  /** Strict mode - fail on any warning */
  strictMode?: boolean
}

const DEFAULT_VALIDATOR_CONFIG: Required<EnvelopeValidatorConfig> = {
  hashAlgorithm: "sha256",
  maxGasLimit: Infinity,
  strictMode: false,
}

/**
 * Validates envelope integrity and permissions
 */
export class EnvelopeValidator {
  private config: Required<EnvelopeValidatorConfig>

  constructor(config: EnvelopeValidatorConfig = {}) {
    this.config = { ...DEFAULT_VALIDATOR_CONFIG, ...config }
  }

  /**
   * Validate incoming envelope
   */
  validate<T>(envelope: AgentEnvelope<T>): EnvelopeValidationResult {
    const errors: EnvelopeValidationError[] = []

    // Check version
    if (envelope.version !== "1.0") {
      errors.push({
        field: "version",
        error: `Unsupported envelope version: ${envelope.version}`,
      })
    }

    // Check envelope ID
    if (!envelope.envelopeId || typeof envelope.envelopeId !== "string") {
      errors.push({
        field: "envelopeId",
        error: "Envelope ID is required and must be a string",
      })
    }

    // Check integrity hash
    const computedHash = this.computeHash(envelope.payload)
    if (computedHash !== envelope.metadata.integrityHash) {
      errors.push({
        field: "metadata.integrityHash",
        error: "Integrity check failed - payload may be corrupted",
      })
    }

    // Check permission consistency
    const forbidden = new Set(envelope.permissions.forbidden)
    for (const action of envelope.permissions.suggestedNextActions) {
      if (forbidden.has(action)) {
        errors.push({
          field: "permissions",
          error: `Action "${action}" is both suggested and forbidden`,
        })
      }
    }

    for (const action of envelope.permissions.escalationRequired) {
      if (forbidden.has(action)) {
        errors.push({
          field: "permissions",
          error: `Action "${action}" requires escalation but is also forbidden`,
        })
      }
    }

    // Check gas budget
    if (envelope.metadata.gasUsed < 0) {
      errors.push({
        field: "metadata.gasUsed",
        error: "Gas usage cannot be negative",
      })
    }

    if (envelope.metadata.gasUsed > this.config.maxGasLimit) {
      errors.push({
        field: "metadata.gasUsed",
        error: `Gas usage ${envelope.metadata.gasUsed} exceeds limit ${this.config.maxGasLimit}`,
      })
    }

    // Check timestamp validity
    if (!envelope.metadata.timestamp || envelope.metadata.timestamp <= 0) {
      errors.push({
        field: "metadata.timestamp",
        error: "Invalid timestamp",
      })
    }

    // Check source
    if (!envelope.metadata.source || !envelope.metadata.source.type || !envelope.metadata.source.id) {
      errors.push({
        field: "metadata.source",
        error: "Source type and id are required",
      })
    }

    // Check grantedBy validity
    const validGrantedBy = ["task-definition", "user-escalation", "auto-inferred"]
    if (!validGrantedBy.includes(envelope.permissions.grantedBy)) {
      errors.push({
        field: "permissions.grantedBy",
        error: `Invalid grantedBy value: ${envelope.permissions.grantedBy}`,
      })
    }

    // Check scope validity
    const validScopes = ["this-step", "this-session", "persistent"]
    if (!validScopes.includes(envelope.permissions.scope)) {
      errors.push({
        field: "permissions.scope",
        error: `Invalid scope value: ${envelope.permissions.scope}`,
      })
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Create envelope from raw data
   */
  wrap<T>(
    payload: T,
    source: EnvelopeMetadata["source"],
    permissions: Partial<EnvelopePermissions> = {},
    options: {
      gasUsed?: number
      traceContext?: EnvelopeMetadata["traceContext"]
    } = {}
  ): AgentEnvelope<T> {
    return {
      version: "1.0",
      envelopeId: randomUUID(),
      metadata: {
        gasUsed: options.gasUsed ?? 0,
        integrityHash: this.computeHash(payload),
        timestamp: Date.now(),
        source,
        traceContext: options.traceContext,
      },
      payload,
      permissions: {
        grantedBy: "auto-inferred",
        scope: "this-step",
        suggestedNextActions: [],
        escalationRequired: [],
        forbidden: [],
        ...permissions,
      },
    }
  }

  /**
   * Unwrap envelope after validation
   * Throws if validation fails
   */
  unwrap<T>(envelope: AgentEnvelope<T>): T {
    const result = this.validate(envelope)
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => `${e.field}: ${e.error}`).join("; ")
      throw new Error(`Envelope validation failed: ${errorMessages}`)
    }
    return envelope.payload
  }

  /**
   * Update envelope gas usage after execution
   */
  updateGas<T>(envelope: AgentEnvelope<T>, gasUsed: number): AgentEnvelope<T> {
    return {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        gasUsed,
      },
    }
  }

  /**
   * Add trace context to envelope
   */
  withTraceContext<T>(
    envelope: AgentEnvelope<T>,
    traceContext: NonNullable<EnvelopeMetadata["traceContext"]>
  ): AgentEnvelope<T> {
    return {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        traceContext,
      },
    }
  }

  /**
   * Update permissions on envelope
   * Creates a new envelope with updated integrity hash
   */
  updatePermissions<T>(
    envelope: AgentEnvelope<T>,
    permissions: Partial<EnvelopePermissions>
  ): AgentEnvelope<T> {
    return {
      ...envelope,
      permissions: {
        ...envelope.permissions,
        ...permissions,
      },
    }
  }

  /**
   * Check if an action is allowed by the envelope permissions
   */
  isActionAllowed(envelope: AgentEnvelope, action: string): boolean {
    if (envelope.permissions.forbidden.includes(action)) {
      return false
    }
    return true
  }

  /**
   * Check if an action requires escalation
   */
  requiresEscalation(envelope: AgentEnvelope, action: string): boolean {
    return envelope.permissions.escalationRequired.includes(action)
  }

  /**
   * Compute integrity hash of payload
   */
  computeHash(payload: unknown): string {
    const serialized = JSON.stringify(payload, null, 0)
    return createHash(this.config.hashAlgorithm).update(serialized).digest("hex")
  }
}

// ============================================================================
// Envelope Factory
// ============================================================================

/**
 * Factory for creating envelopes with common configurations
 */
export class EnvelopeFactory {
  private validator: EnvelopeValidator

  constructor(config: EnvelopeValidatorConfig = {}) {
    this.validator = new EnvelopeValidator(config)
  }

  /**
   * Create a tool envelope
   */
  forTool<T>(toolId: string, payload: T, permissions?: Partial<EnvelopePermissions>): AgentEnvelope<T> {
    return this.validator.wrap(payload, { type: "tool", id: toolId }, permissions)
  }

  /**
   * Create an agent envelope
   */
  forAgent<T>(agentId: string, payload: T, permissions?: Partial<EnvelopePermissions>): AgentEnvelope<T> {
    return this.validator.wrap(payload, { type: "agent", id: agentId }, permissions)
  }

  /**
   * Create a hook envelope
   */
  forHook<T>(hookId: string, payload: T, permissions?: Partial<EnvelopePermissions>): AgentEnvelope<T> {
    return this.validator.wrap(payload, { type: "hook", id: hookId }, permissions)
  }

  /**
   * Create a user envelope
   */
  forUser<T>(userId: string, payload: T, permissions?: Partial<EnvelopePermissions>): AgentEnvelope<T> {
    return this.validator.wrap(
      payload,
      { type: "user", id: userId },
      {
        grantedBy: "user-escalation",
        scope: "this-session",
        ...permissions,
      }
    )
  }

  /**
   * Get the underlying validator
   */
  getValidator(): EnvelopeValidator {
    return this.validator
  }
}

// ============================================================================
// Envelope Result Helpers
// ============================================================================

/**
 * Create a success result
 */
export function envelopeSuccess<T>(envelope: AgentEnvelope<T>): EnvelopeResult<T> {
  return {
    status: "success",
    envelope,
  }
}

/**
 * Create an error result
 */
export function envelopeError(
  type: string,
  message: string,
  recoverable: boolean,
  suggestedAction?: string,
  partialEnvelope?: AgentEnvelope<unknown>
): EnvelopeResult<never> {
  return {
    status: "error",
    error: {
      type,
      message,
      recoverable,
      suggestedAction,
    },
    partialEnvelope,
  }
}

/**
 * Create a suspended result
 */
export function envelopeSuspended(
  reason: string,
  resumeToken: string,
  validator: EnvelopeValidator,
  source: EnvelopeMetadata["source"],
  previewData?: unknown
): EnvelopeResult<never> {
  const envelope = validator.wrap({ suspendedAt: new Date().toISOString() }, source)

  return {
    status: "suspended",
    reason,
    resumeToken,
    previewData,
    envelope,
  }
}

/**
 * Type guard for success result
 */
export function isEnvelopeSuccess<T>(result: EnvelopeResult<T>): result is { status: "success"; envelope: AgentEnvelope<T> } {
  return result.status === "success"
}

/**
 * Type guard for error result
 */
export function isEnvelopeError<T>(result: EnvelopeResult<T>): result is EnvelopeResult<T> & { status: "error" } {
  return result.status === "error"
}

/**
 * Type guard for suspended result
 */
export function isEnvelopeSuspended<T>(result: EnvelopeResult<T>): result is EnvelopeResult<T> & { status: "suspended" } {
  return result.status === "suspended"
}

// ============================================================================
// Singleton Manager
// ============================================================================

let defaultFactory: EnvelopeFactory | null = null

/**
 * Get the default envelope factory
 */
export function getEnvelopeFactory(config?: EnvelopeValidatorConfig): EnvelopeFactory {
  if (!defaultFactory) {
    defaultFactory = new EnvelopeFactory(config)
  }
  return defaultFactory
}

/**
 * Reset the default factory (for testing)
 */
export function resetEnvelopeFactory(): void {
  defaultFactory = null
}
