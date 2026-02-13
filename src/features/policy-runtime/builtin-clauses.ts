import type { ContractClause } from "../../contracts"
import {
  PLANNING_CONSULT_WARNING,
  PROMETHEUS_WORKFLOW_REMINDER,
} from "./prometheus-policy"

const SUBAGENT_QUESTION_BLOCK_MESSAGE =
  "Question tool is disabled for subagent sessions. " +
  "Subagents should complete their work autonomously without asking questions to users. " +
  "If you need clarification, return to the parent agent with your findings and uncertainties."

const WRITE_EXISTING_BLOCK_MESSAGE = "File already exists. Use edit tool instead."

const PROMETHEUS_MD_ONLY_MESSAGE =
  "[policy-runtime] Prometheus can only write/edit .md files inside .sisyphus/ directory."

export function getBuiltinPolicyClauses(): ContractClause[] {
  return [
    {
      id: "builtin:policy-write-existing-guard",
      description: "Block Write when target file already exists unless .sisyphus/*.md",
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
      id: "builtin:policy-prometheus:block-write",
      description: "Prometheus can only mutate .md files inside .sisyphus/",
      hookPoints: ["tool.execute.before"],
      enforcement: "hard",
      selector: { toolName: ["Write", "write", "Edit", "edit"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.prometheus.blockedWrite": true,
        },
      },
      action: {
        type: "deny",
        message: PROMETHEUS_MD_ONLY_MESSAGE,
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
      reasonCode: "PROMETHEUS_MD_ONLY_BLOCK_WRITE",
    },
    {
      id: "builtin:policy-prometheus:task-warning",
      description: "Inject planning consult warning into task prompts for Prometheus",
      hookPoints: ["tool.execute.before"],
      enforcement: "soft",
      selector: { toolName: ["task", "delegate_task"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.prometheus.taskWarning": true,
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
      reasonCode: "PROMETHEUS_TASK_PROMPT_WARNING",
    },
    {
      id: "builtin:policy-prometheus:workflow-reminder",
      description: "Append workflow reminder when Prometheus writes plan files",
      hookPoints: ["tool.execute.before"],
      enforcement: "soft",
      selector: { toolName: ["Write", "write", "Edit", "edit"] },
      condition: {
        equals: {
          "payload.guardsVersion": 1,
          "payload.guards.prometheus.planReminder": true,
        },
      },
      action: {
        type: "modify",
        mutation: {
          messageAppend: PROMETHEUS_WORKFLOW_REMINDER,
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
      reasonCode: "PROMETHEUS_PLAN_WORKFLOW_REMINDER",
    },
  ]
}
