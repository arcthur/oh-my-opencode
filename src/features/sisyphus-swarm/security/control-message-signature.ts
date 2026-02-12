import { generateKeyPairSync, sign, verify, createHash } from "crypto"
import { join } from "path"
import { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, readJsonSafe, writeJsonAtomic } from "../../sisyphus-tasks/storage"
import type { EnvelopeAuth, InboxMessage, ProtocolMessage } from "../mailbox"

const ControlSigningKeySchema = z.object({
  alg: z.literal("ed25519"),
  keyId: z.string(),
  privateKeyPem: z.string(),
  publicKeyPem: z.string(),
  createdAt: z.number(),
})

type ControlSigningKey = z.infer<typeof ControlSigningKeySchema>

const PRIVILEGED_CONTROL_TYPES: ReadonlySet<ProtocolMessage["type"]> = new Set([
  "permission_response",
  "plan_approval_response",
  "mode_set_request",
  "shutdown_approved",
  "shutdown_rejected",
])

function getSecurityDir(teamName: string, config: Partial<OhMyOpenCodeConfig>): string {
  return join(getTeamDir(teamName, config), "security")
}

function getControlSigningKeyPath(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getSecurityDir(teamName, config), "control-message-signing-key.json")
}

function buildKeyId(publicKeyPem: string): string {
  return `ed25519:${createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16)}`
}

function readControlSigningKey(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): ControlSigningKey | null {
  return readJsonSafe(getControlSigningKeyPath(teamName, config), ControlSigningKeySchema)
}

function createControlSigningKey(): ControlSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString()
  return {
    alg: "ed25519",
    keyId: buildKeyId(publicKeyPem),
    privateKeyPem,
    publicKeyPem,
    createdAt: Date.now(),
  }
}

function ensureControlSigningKey(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): ControlSigningKey {
  const existing = readControlSigningKey(teamName, config)
  if (existing) {
    return existing
  }

  const created = createControlSigningKey()
  writeJsonAtomic(getControlSigningKeyPath(teamName, config), created)
  return created
}

function buildSignatureInput(args: {
  fromAgentId: string
  toAgentId: string
  payload: ProtocolMessage
  epoch?: number
}): string {
  return JSON.stringify({
    v: 1,
    from: args.fromAgentId,
    to: args.toAgentId,
    epoch: args.epoch ?? null,
    payload: args.payload,
  })
}

export function isPrivilegedControlMessage(payload: ProtocolMessage): boolean {
  return PRIVILEGED_CONTROL_TYPES.has(payload.type)
}

export function signControlMessage(args: {
  teamName: string
  fromAgentId: string
  toAgentId: string
  payload: ProtocolMessage
  epoch?: number
  config: Partial<OhMyOpenCodeConfig>
}): EnvelopeAuth | undefined {
  if (!isPrivilegedControlMessage(args.payload)) {
    return undefined
  }

  const key = ensureControlSigningKey(args.teamName, args.config)
  const signatureInput = buildSignatureInput({
    fromAgentId: args.fromAgentId,
    toAgentId: args.toAgentId,
    payload: args.payload,
    epoch: args.epoch,
  })
  const sig = sign(null, Buffer.from(signatureInput, "utf-8"), key.privateKeyPem).toString("base64")

  return {
    alg: "ed25519",
    keyId: key.keyId,
    sig,
  }
}

export function verifyControlMessageSignature(args: {
  teamName: string
  fromAgentId: string
  toAgentId: string
  payload: ProtocolMessage
  epoch?: number
  auth?: EnvelopeAuth
  config: Partial<OhMyOpenCodeConfig>
}): { ok: boolean; reason?: string } {
  if (!isPrivilegedControlMessage(args.payload)) {
    return { ok: true }
  }

  if (!args.auth) {
    return { ok: false, reason: "missing_auth" }
  }

  const key = readControlSigningKey(args.teamName, args.config)
  if (!key) {
    return { ok: false, reason: "missing_signing_key" }
  }
  if (args.auth.keyId !== key.keyId) {
    return { ok: false, reason: "key_id_mismatch" }
  }

  const signatureInput = buildSignatureInput({
    fromAgentId: args.fromAgentId,
    toAgentId: args.toAgentId,
    payload: args.payload,
    epoch: args.epoch,
  })

  try {
    const ok = verify(
      null,
      Buffer.from(signatureInput, "utf-8"),
      key.publicKeyPem,
      Buffer.from(args.auth.sig, "base64")
    )
    return ok ? { ok: true } : { ok: false, reason: "invalid_signature" }
  } catch {
    return { ok: false, reason: "verification_error" }
  }
}

export function verifyInboxControlMessageSignature(args: {
  teamName: string
  recipientAgentId: string
  message: InboxMessage
  config: Partial<OhMyOpenCodeConfig>
}): { ok: boolean; reason?: string } {
  return verifyControlMessageSignature({
    teamName: args.teamName,
    fromAgentId: args.message.from,
    toAgentId: args.recipientAgentId,
    payload: args.message.payload,
    epoch: args.message.epoch,
    auth: args.message.auth,
    config: args.config,
  })
}
