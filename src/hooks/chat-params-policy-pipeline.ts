interface ChatParamsInput {
  sessionID: string
  agent: string
  model: { providerID?: string; modelID?: string }
  provider: { id?: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature: number
  topP: number
  topK: number
  options: Record<string, unknown>
}

interface ChatParamsPolicyPipelineInput {
  input: ChatParamsInput
  output: ChatParamsOutput
  observe?: () => Promise<void>
  runExisting: () => Promise<void>
  enforce?: () => Promise<void>
}

export async function runChatParamsPolicyPipeline(
  pipeline: ChatParamsPolicyPipelineInput
): Promise<void> {
  await pipeline.observe?.()
  await pipeline.runExisting()
  await pipeline.enforce?.()
}
