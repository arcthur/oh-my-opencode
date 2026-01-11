# Context Management Strategy

oh-my-opencode 的上下文管理策略文档。本文档详细介绍了项目如何高效管理 LLM 上下文窗口，确保在长会话中保持信息完整性和系统稳定性。

## Table of Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Architecture](#architecture)
- [Compaction Strategies](#compaction-strategies)
- [Memory Systems](#memory-systems)
- [Configuration Guide](#configuration-guide)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

### The Context Window Problem

大型语言模型（LLM）具有固定的上下文窗口限制。随着对话的进行，上下文会逐渐填满，导致：

1. **性能退化**: 在接近上下文限制时，模型性能会显著下降（"context rot"）
2. **信息丢失**: 简单截断会丢失重要的历史信息
3. **连续性中断**: 压缩后可能丢失任务上下文，导致工作中断

### Our Approach

oh-my-opencode 采用**多层次上下文蒸馏**策略，核心理念是：

> "Treat context the way operating systems treat memory: as finite resources to be budgeted, compacted, and intelligently paged."

```
┌─────────────────────────────────────────────────┐
│           Raw Context (Original)                │  ← 优先保留
├─────────────────────────────────────────────────┤
│      Compaction (Reversible Pruning)            │  ← 可逆压缩
├─────────────────────────────────────────────────┤
│      Summarization (Lossy Compression)          │  ← 最后手段
└─────────────────────────────────────────────────┘
```

**黄金法则**: `Raw > Compaction > Summarization`

---

## Core Principles

### 1. Proactive vs Reactive

| 策略 | 时机 | 优点 |
|------|------|------|
| **Proactive** | 达到阈值前主动压缩 | 平滑过渡，避免中断 |
| **Reactive** | API 报错后被动恢复 | 最大化利用上下文 |

oh-my-opencode 同时支持两种策略，推荐使用 Proactive 模式。

### 2. Preserve Momentum

压缩时始终保留最近的 3-5 轮对话原文，确保模型保持：
- 格式风格一致性
- 任务执行"节奏"
- 工具调用模式

### 3. Structure Forces Preservation

使用结构化摘要模板，每个章节作为检查清单，防止信息静默丢失：

```markdown
## 1. User Requests (As-Is)
## 2. Final Goal
## 3. Files Modified
## 4. Key Decisions & Rationale
## 5. Current Working State
## 6. Remaining Tasks
## 7. MUST NOT Do
...
```

### 4. Layered Recovery

采用三层递进恢复策略，从轻量到重量：

```
PHASE 1: Dynamic Context Pruning (DCP)
    ↓ 如果仍超限
PHASE 2: Aggressive Truncation
    ↓ 如果仍超限
PHASE 3: Session Summarization
```

---

## Architecture

### Component Overview

```
oh-my-opencode Context Management
├── Preemptive Compaction          # 主动压缩
│   └── preemptive-compaction/
├── Error Recovery                 # 错误恢复
│   └── anthropic-context-window-limit-recovery/
│       ├── pruning-deduplication.ts
│       ├── pruning-supersede.ts
│       ├── pruning-purge-errors.ts
│       ├── pruning-clear-results.ts
│       └── storage.ts
├── Context Injection              # 上下文注入
│   ├── compaction-context-injector/
│   ├── repo-overview-injector/
│   └── directory-agents-injector/
├── Memory Systems                 # 记忆系统
│   └── user-memory/
├── Monitoring                     # 监控
│   ├── context-window-monitor.ts
│   └── runtime-tracker/
└── Output Optimization            # 输出优化
    ├── tool-output-truncator.ts
    └── dynamic-truncator.ts
```

### Data Flow

```
                    ┌──────────────┐
                    │   Session    │
                    │    Start     │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │   Bootstrap Injection   │
              │  - Repo Overview        │
              │  - User Memory          │
              │  - AGENTS.md            │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    Normal Operation     │◄────────────┐
              │  - Tool Calls           │             │
              │  - Runtime Tracking     │             │
              └────────────┬────────────┘             │
                           │                          │
              ┌────────────▼────────────┐             │
              │   Context Monitoring    │             │
              │   (70% / 85% thresholds)│             │
              └────────────┬────────────┘             │
                           │                          │
            ┌──────────────┴──────────────┐           │
            │                             │           │
   ┌────────▼────────┐         ┌──────────▼─────────┐ │
   │  Below 85%      │         │  Above 85% or      │ │
   │  Continue       │         │  Token Error       │ │
   └────────┬────────┘         └──────────┬─────────┘ │
            │                             │           │
            │              ┌──────────────▼──────────┐│
            │              │   Compaction Pipeline   ││
            │              │  1. DCP Pruning         ││
            │              │  2. Truncation          ││
            │              │  3. Summarization       ││
            │              └──────────────┬──────────┘│
            │                             │           │
            └─────────────────────────────┴───────────┘
```

---

## Compaction Strategies

### 1. Dynamic Context Pruning (DCP)

DCP 是一组可逆的修剪策略，删除冗余信息而不丢失语义。

#### 1.1 Deduplication (去重)

删除完全相同的工具调用（相同工具名 + 相同参数）。

```typescript
// 示例：连续读取同一文件
Read("src/index.ts")  // 保留
Read("src/index.ts")  // 删除（重复）
Read("src/utils.ts")  // 保留
Read("src/index.ts")  // 删除（重复）
```

**配置**:
```json
{
  "strategies": {
    "deduplication": { "enabled": true }
  }
}
```

#### 1.2 Supersede Writes (超越写入)

当文件被后续读取时，删除之前的写入工具输入（内容已被读取覆盖）。

```typescript
// 示例
Write("config.json", content)  // 删除输入（后续被读取）
Edit("config.json", ...)       // 删除输入
Read("config.json")            // 保留（证明之前的写入已完成）
```

**配置**:
```json
{
  "strategies": {
    "supersede_writes": {
      "enabled": true,
      "aggressive": false  // true: 删除任何后续被读取的写入
    }
  }
}
```

#### 1.3 Purge Errors (清除错误)

删除 N 轮之前的错误工具调用（错误信息已过时）。

```typescript
// 5 轮之前的错误
Bash("invalid-cmd")  // Error → 删除
// 当前轮
Bash("valid-cmd")    // Success → 保留
```

**配置**:
```json
{
  "strategies": {
    "purge_errors": {
      "enabled": true,
      "turns": 5  // N 轮后清除
    }
  }
}
```

#### 1.4 Clear Tool Results (清除工具结果)

**最安全的压缩形式** - 清除旧轮次的工具输出，仅保留最近 N 轮。

原理：深层历史中的工具结果不再需要完整输出，agent 可以通过重新调用工具获取。

```typescript
// Turn 1 (old)
Read("file.ts") → output: "[Content pruned by DCP]"

// Turn 5 (recent, preserved)
Read("file.ts") → output: "actual file content..."
```

**配置**:
```json
{
  "strategies": {
    "clear_tool_results": {
      "enabled": true,
      "keep_recent_turns": 5
    }
  }
}
```

### 2. Aggressive Truncation

当 DCP 不足以释放空间时，主动截断最大的工具输出。

**策略**:
1. 找到当前会话中最大的工具输出
2. 按比例截断至目标 token 数
3. 最多重试 20 次

**目标**: 将 token 数降至 `maxTokens * 0.5`

### 3. Session Summarization

最后的回退策略，使用 LLM 生成会话摘要。

#### 压缩模板

```markdown
## 1. User Requests (As-Is)
- 原始用户请求的精确措辞
- 保留用户意图

## 2. Final Goal
- 最终目标
- 成功标准

## 3. Files Modified (with details)
- 每个文件的具体修改
- 行号范围
- 创建/修改/删除标记

## 4. Key Decisions & Rationale
- 技术决策及原因
- 被拒绝的替代方案
- 权衡考量

## 5. Current Working State
- 当前工作状态
- 测试/构建状态

## 6. Environment & Tool Outputs Still Needed
- 可能需要重新获取的工具结果
- 依赖的外部状态

## 7. Remaining Tasks
- 具体待办事项
- 阻塞项

## 8. MUST NOT Do (Critical Constraints)
- 明确禁止的操作
- 失败的方法（不要重试）
- 用户限制

## 9. Important Context
- 领域知识
- 组件关系
- 发现的 quirks
```

---

## Memory Systems

### 1. Repository Overview

会话开始时自动注入项目概览，减少重复探索。

**内容**:
- 项目名称和描述
- 技术栈 (TypeScript, React, etc.)
- 框架 (Next.js, Express, etc.)
- 包管理器 (npm, yarn, pnpm, bun)
- 常用命令 (build, dev, test, lint)
- 核心文件列表
- 目录结构树

**缓存**: 1 小时（可配置）

**配置**:
```json
{
  "repo_overview": {
    "enabled": true,
    "auto_generate": true,
    "max_tree_depth": 50,
    "cache_duration_ms": 3600000
  }
}
```

### 2. User Memory

跨会话持久化记忆，存储于 `~/.opencode/memory/user.json`。

**存储内容**:

| 类型 | 描述 | 示例 |
|------|------|------|
| preferences | 用户偏好 | `{ "style": "concise", "language": "zh" }` |
| environment | 开发环境 | `{ "os": "macOS", "shell": "zsh" }` |
| workHistory | 工作历史 | 最近 50 条会话摘要 |
| customRules | 自定义规则 | `["Always use TypeScript"]` |
| explicitMemories | 显式记忆 | 用户说 "remember that..." 的内容 |

**触发记忆**:
```
User: Remember that our API uses snake_case
→ 自动保存到 explicitMemories
```

**配置**:
```json
{
  "user_memory": {
    "enabled": true,
    "persist_preferences": true,
    "persist_work_history": true,
    "max_history_entries": 50,
    "auto_inject": true
  }
}
```

### 3. AGENTS.md Injection

自动注入目录级别的 AGENTS.md 文件，提供局部上下文。

**查找逻辑**:
1. 从当前操作文件的目录开始
2. 向上遍历至项目根目录
3. 注入找到的所有 AGENTS.md

---

## Configuration Guide

### Full Configuration Example

```json
{
  "experimental": {
    "preemptive_compaction": true,
    "preemptive_compaction_threshold": 0.80,
    "dcp_for_compaction": true,
    "dynamic_context_pruning": {
      "enabled": true,
      "notification": "detailed",
      "turn_protection": {
        "enabled": true,
        "turns": 3
      },
      "protected_tools": [
        "task", "todowrite", "todoread",
        "lsp_rename", "lsp_code_action_resolve"
      ],
      "strategies": {
        "deduplication": { "enabled": true },
        "supersede_writes": { "enabled": true, "aggressive": false },
        "purge_errors": { "enabled": true, "turns": 5 },
        "clear_tool_results": { "enabled": true, "keep_recent_turns": 5 }
      }
    }
  },
  "repo_overview": {
    "enabled": true,
    "auto_generate": true,
    "max_tree_depth": 50,
    "cache_duration_ms": 3600000
  },
  "user_memory": {
    "enabled": true,
    "persist_preferences": true,
    "persist_work_history": true,
    "max_history_entries": 50,
    "auto_inject": true
  },
  "runtime_tracker": {
    "enabled": true,
    "threshold_ms": 3000,
    "max_recent": 10,
    "inject_hints": true
  }
}
```

### Threshold Recommendations

| 模型 | 上下文窗口 | 推荐阈值 | 说明 |
|------|-----------|---------|------|
| Claude 3.5 Sonnet | 200K | 0.80 (160K) | 标准配置 |
| Claude 3 Opus | 200K | 0.75 (150K) | 更保守 |
| Claude 3.5 Sonnet (1M) | 1M | 0.25 (256K) | 避免 context rot |
| GPT-4 Turbo | 128K | 0.80 (102K) | 标准配置 |

### Protected Tools

某些工具不应被修剪：

```json
{
  "protected_tools": [
    "task",           // 子任务状态
    "todowrite",      // 任务列表
    "todoread",       // 任务读取
    "lsp_rename",     // LSP 重命名
    "lsp_code_action_resolve"  // LSP 代码操作
  ]
}
```

---

## Best Practices

### 1. 阈值设置

```
✅ 推荐: 0.75 - 0.85
❌ 避免: > 0.90 (太晚) 或 < 0.60 (太早)
```

### 2. 保护关键工具

确保以下工具始终被保护：
- 任务管理工具 (task, todo*)
- LSP 工具 (重命名、重构)
- 会话管理工具 (session_*)

### 3. 使用结构化摘要

始终使用压缩上下文注入器，确保关键信息保留：
- 用户原始请求
- 文件修改记录
- 决策及理由
- 待办事项

### 4. 监控上下文使用

启用 context-window-monitor 在 70% 时提醒：

```
[Context Status: 72% used, 28% remaining]
[SYSTEM REMINDER: You have plenty of context remaining]
```

### 5. 利用 Runtime Tracker

启用运行时追踪，避免重复慢操作：

```
[Runtime: 5.2s - Tool "grep" averaged 4.8s over 3 calls]
[Consider narrower queries or caching results]
```

---

## Troubleshooting

### 问题: 压缩后丢失重要信息

**症状**: 压缩后 agent 忘记之前的决策或文件修改

**解决方案**:
1. 启用增强的压缩上下文模板
2. 增加 `keep_recent_turns` 值
3. 将关键工具添加到 `protected_tools`

### 问题: 压缩触发过于频繁

**症状**: 频繁看到压缩通知，影响工作流

**解决方案**:
1. 提高 `preemptive_compaction_threshold`
2. 启用 `clear_tool_results` 策略减少工具输出
3. 启用 `tool-output-truncator` hook

### 问题: Token 超限错误

**症状**: API 返回 token limit exceeded 错误

**解决方案**:
1. 确保 `anthropic-context-window-limit-recovery` hook 已启用
2. 启用 `dcp_for_compaction: true`
3. 降低 `preemptive_compaction_threshold`

### 问题: 工具输出过大

**症状**: 单次工具调用消耗大量 token

**解决方案**:
1. 启用 `tool-output-truncator` hook
2. 配置 `experimental.truncate_all_tool_outputs: true`
3. 使用更精确的查询（如更窄的 grep 模式）

---

## References

- [Factory.ai - The Context Window Problem](https://factory.ai/news/context-window-problem)
- [Anthropic - Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Google ADK - Context Compaction](https://google.github.io/adk-docs/context/compaction/)
- [JetBrains Research - Efficient Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)

---

## Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| 3.0.0 | 2026-01 | 新增 clear_tool_results 策略、增强压缩模板、Repo Overview、User Memory、Runtime Tracker |
| 2.9.0 | - | 初始 DCP 实现 |
