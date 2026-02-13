import { appendBudgetedOutput } from "../../features/context-view"

const TARGET_TOOLS = ["task", "Task", "task_tool", "delegate_task"]

const SESSION_ID_PATTERNS = [
  /Session ID: (ses_[a-zA-Z0-9_-]+)/,
  /session_id: (ses_[a-zA-Z0-9_-]+)/,
  /<task_metadata>\s*session_id: (ses_[a-zA-Z0-9_-]+)/,
  /sessionId: (ses_[a-zA-Z0-9_-]+)/,
]

function extractSessionId(output: string): string | null {
  for (const pattern of SESSION_ID_PATTERNS) {
    const match = output.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function createTaskResumeInfoHook() {
   const toolExecuteAfter = async (
     input: { tool: string; sessionID: string; callID: string },
     output: { title: string; output: string | undefined; metadata: unknown }
   ) => {
     if (!TARGET_TOOLS.includes(input.tool)) return
     const outputText = output.output ?? ""
     if (outputText.startsWith("Error:") || outputText.startsWith("Failed")) return
     if (outputText.includes("\nto continue:")) return

     const sessionId = extractSessionId(outputText)
     if (!sessionId) return

     const mergedOutput = { output: outputText.trimEnd() }
     const decision = appendBudgetedOutput({
       output: mergedOutput,
       sessionID: input.sessionID,
       source: "task-resume-info",
       id: `${input.callID}:task-resume-info`,
       priority: "high",
       content: `\n\nto continue: delegate_task(description="Continue task", session_id="${sessionId}", load_skills=[], run_in_background=false, prompt="...")`,
     })
     if (decision.accepted) {
       output.output = mergedOutput.output
     }
   }

   return {
     "tool.execute.after": toolExecuteAfter,
   }
}
