import { z } from "zod"

export const ContextManifestItemKindSchema = z.enum([
  "doc",
  "code",
  "index",
  "command",
  "url",
])

export type ContextManifestItemKind = z.infer<typeof ContextManifestItemKindSchema>

export const ContextManifestItemSchema = z.object({
  kind: ContextManifestItemKindSchema,
  ref: z.string().min(1),
  why: z.string().min(1).optional(),
})

export type ContextManifestItem = z.infer<typeof ContextManifestItemSchema>

export const ContextManifestAudienceSchema = z.object({
  agents: z.array(z.string()).optional(),
  subagents: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
})

export type ContextManifestAudience = z.infer<typeof ContextManifestAudienceSchema>

const CONTEXT_PACK_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export const ContextPackSchema = z.object({
  id: z
    .string()
    .regex(CONTEXT_PACK_ID_REGEX, "Pack id must match /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/"),
  title: z.string().min(1),
  audience: ContextManifestAudienceSchema.optional(),
  items: z.array(ContextManifestItemSchema),
})

export type ContextPack = z.infer<typeof ContextPackSchema>

export const ContextManifestSchema = z.object({
  schemaVersion: z.literal(2),
  planId: z.string().min(1),
  generatedAt: z.string().min(1),
  packs: z.array(ContextPackSchema),
})

export type ContextManifest = z.infer<typeof ContextManifestSchema>
