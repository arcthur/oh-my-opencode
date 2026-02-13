export type DiscoverySource = "delegate_output" | "assistant_update"
export type DiscoveryStatus = "open" | "resolved" | "dismissed"

export interface DiscoveryEntry {
  id: string
  planId: string
  claim: string
  source: DiscoverySource
  sourceEventId: string
  timestamp: number
  retrievalPath: string
  status: DiscoveryStatus
}

export interface DiscoveryChannelConfig {
  enabled: boolean
  captureDelegateOutput: boolean
  captureAssistantUpdates: boolean
  markerMode: "xml" | "prefix" | "hybrid"
  dedupeWindowMs: number
  maxOpenItems: number
  autoTaskCreate: boolean
}

export interface DiscoveryCaptureInput {
  planId: string
  text: string
  source: DiscoverySource
  sourceEventId: string
  retrievalPath: string
}
