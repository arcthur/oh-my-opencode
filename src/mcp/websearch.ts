type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

const EXA_WEBSEARCH_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa"

export function createWebsearchConfig(): RemoteMcpConfig {
  const exaApiKey = process.env.EXA_API_KEY

  return {
    type: "remote" as const,
    url: exaApiKey
      ? `${EXA_WEBSEARCH_MCP_URL}&exaApiKey=${encodeURIComponent(exaApiKey)}`
      : EXA_WEBSEARCH_MCP_URL,
    enabled: true,
    ...(exaApiKey ? { headers: { "x-api-key": exaApiKey } } : {}),
    // Disable OAuth auto-detection - Exa uses URL query auth for remote MCP
    oauth: false as const,
  }
}

export const websearch = createWebsearchConfig()
