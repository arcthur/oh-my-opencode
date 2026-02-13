import type { ContractClause } from "../../contracts"
import {
  PLANNING_CONSULT_WARNING,
  PLANNER_WORKFLOW_REMINDER,
} from "./planner-policy"

const SUBAGENT_QUESTION_BLOCK_MESSAGE =
  "Question tool is disabled for subagent sessions. " +
  "Subagents should complete their work autonomously without asking questions to users. " +
  "If you need clarification, return to the parent agent with your findings and uncertainties."

const WRITE_EXISTING_BLOCK_MESSAGE = "File already exists. Use edit tool instead."

const PLANNER_MD_ONLY_MESSAGE =
  "[policy-runtime] planner can only write/edit .md files inside .orchestrator/ directory."

const VERIFIER_GATE_BLOCK_MESSAGE =
  "[policy-runtime] Verifier gate blocked completion. Run lsp_diagnostics on changed files and run at least one successful test/build/typecheck command before task_transition(next_state=completed)."

export function getBuiltinPolicyClauses(): ContractClause[] {
  return [
    {
      id: "builtin:policy-write-existing-guard",
      description: "Block Write when target file already exists unless .orchestrator/*.md",
      hookPoints: ["tool.execute.before"],
      enforcement: "hard",
      selector: { toolName: ["Write", "write"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.writeExistingFile.blocked": true,
        },
      },
      action: {
        type: "deny",
        message: WRITE_EXISTING_BLOCK_MESSAGE,
      },
      priority: 10,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "WRITE_EXISTING_FILE_GUARD",
    },
    {
      id: "builtin:policy-verifier-completion-guard",
      description: "Block task_transition(completed) when verifier evidence is missing",
      hookPoints: ["tool.execute.before"],
      enforcement: "hard",
      selector: { toolName: ["task_transition", "TaskTransition"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.verifier.blocked": true,
        },
      },
      action: {
        type: "deny",
        message: VERIFIER_GATE_BLOCK_MESSAGE,
      },
      priority: 15,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "VERIFIER_GATE_BLOCK_COMPLETION",
    },
    {
      id: "builtin:policy-subagent-question-guard",
      description: "Block question tools in subagent sessions",
      hookPoints: ["tool.execute.before"],
      enforcement: "hard",
      selector: { toolName: ["question", "askuserquestion", "Question", "AskUserQuestion"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.subagentQuestion.blocked": true,
        },
      },
      action: {
        type: "deny",
        message: SUBAGENT_QUESTION_BLOCK_MESSAGE,
      },
      priority: 20,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "DELEGATION_BLOCK_SUBAGENT_QUESTION",
    },
    {
      id: "builtin:policy-planner:block-write",
      description: "planner can only mutate .md files inside .orchestrator/",
      hookPoints: ["tool.execute.before"],
      enforcement: "hard",
      selector: { toolName: ["Write", "write", "Edit", "edit"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.planner.blockedWrite": true,
        },
      },
      action: {
        type: "deny",
        message: PLANNER_MD_ONLY_MESSAGE,
      },
      priority: 30,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "PLANNER_MD_ONLY_BLOCK_WRITE",
    },
    {
      id: "builtin:policy-planner:task-warning",
      description: "Inject planning consult warning into task prompts for planner",
      hookPoints: ["tool.execute.before"],
      enforcement: "soft",
      selector: { toolName: ["task", "delegate_task"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.planner.taskWarning": true,
        },
      },
      action: {
        type: "modify",
        mutation: {
          argsPromptPrepend: PLANNING_CONSULT_WARNING,
        },
      },
      priority: 40,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "PLANNER_TASK_PROMPT_WARNING",
    },
    {
      id: "builtin:policy-planner:workflow-reminder",
      description: "Append workflow reminder when planner writes plan files",
      hookPoints: ["tool.execute.before"],
      enforcement: "soft",
      selector: { toolName: ["Write", "write", "Edit", "edit"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.planner.planReminder": true,
        },
      },
      action: {
        type: "modify",
        mutation: {
          messageAppend: PLANNER_WORKFLOW_REMINDER,
        },
      },
      priority: 50,
      conflictResolution: "most-restrictive",
      enabled: true,
      version: 1,
      provenance: {
        author: "oh-my-opencode",
        source: "builtin",
        createdAt: Date.now(),
      },
      reasonCode: "PLANNER_PLAN_WORKFLOW_REMINDER",
    },
  ]
}
