# Planning with Files Guide

> Manus-style persistent planning: "Context Window = RAM (volatile); Filesystem = Disk (persistent)"

## Overview

Planning with Files 使用 3 个持久化 markdown 文件作为 "磁盘上的工作内存"，克服 AI 上下文窗口的局限性。

## 核心原理

1. **KV-Cache 优化**: 完整注入 task_plan.md 到提示开头，保持前缀稳定以最大化缓存命中
2. **自动检测**: 通过 mtime 自动检测 findings.md 修改，无需手动确认
3. **状态持久化**: 使用 `.planning-state.json` 保存状态，进程重启后可恢复
4. **blocked 状态**: 支持 `blocked` 作为阶段终止状态

## 3 文件模式

```
.sisyphus/plans/{plan-name}/
├── task_plan.md           # 阶段、目标、决策、错误
├── findings.md            # 研究结果 (2-action rule)
├── progress.md            # 会话日志、5-Question Reboot
└── .planning-state.json   # 持久化状态
```

## 配置

```json
{
  "planning_with_files": {
    "enabled": true,
    "directory": "plans",
    "two_action_rule": true,
    "three_strike_protocol": true,
    "auto_reread": true,
    "stop_verification": true,
    "auto_from_multi_plan": true
  }
}
```

## 核心机制

### 1. PreToolUse Hook - 完整 task_plan.md 注入

在 Write/Edit/Bash 操作前，注入**完整**的 task_plan.md 内容：

```xml
<task-plan-context>
# Task Plan: feature-name

> **Goal**: Implement user authentication

## Phases
| # | Phase | Status |
...
</task-plan-context>
```

**KV-Cache 收益**: 前缀稳定 → 注意力计算可复用 → 延迟降低

### 2. 2-Action Rule - 自动检测重置

每 2 次 Read/WebFetch/Grep 操作后提醒更新 findings.md：

```xml
<two-action-rule>
## Update findings.md NOW

2 research operations completed.
Counter auto-resets when you modify findings.md.
</two-action-rule>
```

**自动检测**: 通过 mtime 检测文件修改，无需说 "updated findings"。

### 3. 3-Strike Protocol

| Strike | 行动 |
|--------|------|
| 1 | 诊断 - 仔细阅读错误，检查上下文 |
| 2 | 转向 - 尝试替代方案 |
| 3 | 重新评估 - 审查假设，考虑标记 blocked |
| 4+ | 升级 - 标记阶段为 BLOCKED |

### 4. Stop Verification

支持 `complete` 和 `blocked` 作为终止状态：

```markdown
## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Discovery | complete |
| 2 | Implementation | blocked |  ← 允许停止
| 3 | Testing | pending |        ← 阻止停止
```

## 目录结构

统一使用 `.sisyphus/plans/{plan-name}/`：

- 与 multi-plan 输出统一
- 单一位置管理所有规划文件
- 便于查找和维护

## 使用方式

### 启动规划

```
start planning for "add-authentication"
```

### 运行中

1. Write/Edit/Bash 前自动重读 task_plan.md
2. 2 次研究操作后提醒更新 findings.md
3. 修改 findings.md 后自动重置计数
4. 错误时触发 3-strike 协议

### 完成

确保所有阶段为 `complete` 或 `blocked` 后停止。

## 与 Multi-Plan 整合

当 `auto_from_multi_plan: true` 时，multi-plan 完成后自动创建 3 文件结构。

## 文件模板

### task_plan.md

```markdown
# Task Plan: {name}

> **Goal**: {goal}

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | pending | Understand requirements |
| 2 | Implementation | pending | Build the solution |
| 3 | Verification | pending | Test and validate |

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| - | (none yet) | - |

## Errors (3-Strike Protocol)

| # | Error | Strikes | Resolution |
|---|-------|---------|------------|
| - | (none yet) | - | - |
```

### findings.md

```markdown
# Findings: {name}

## Research

| Source | Finding |
|--------|---------|
| - | (update after 2 actions) |

## Resources

| Name | URL |
|------|-----|
| - | - |
```

### progress.md

```markdown
# Progress: {name}

## Session Log

| Time | Action | Files |
|------|--------|-------|
| 10:30 | Session started | - |

## 5-Question Reboot

1. **Where am I?** -
2. **Where am I going?** -
3. **What is my goal?** -
4. **What have I learned?** -
5. **What have I completed?** -
```

## Silent Tool Output

配合使用 `silent-tool-output` hook 进一步减少 context 消耗：

```json
{
  "silent_tool_output": {
    "silent_write": true,
    "optimize_planning_reads": true,
    "optimize_search": true,
    "search_max_lines": 20
  }
}
```

### 效果对比

| 工具 | 优化前 | 优化后 |
|------|--------|--------|
| Write | `写入成功:\n<200行内容>` | `✓ path.ts written (5000 bytes, 200 lines)` |
| Edit | `已修改:\n<完整内容>` | `✓ path.ts updated` |
| Read (planning) | `<完整内容>` | `✓ task_plan.md loaded - content in <task-plan-context>` |
| Grep | `<100行匹配>` | `<20行匹配>\n... and 80 more` |

### 核心原理

**"Trust the filesystem, not the context"**

- Write 工具只需确认成功，不需要回传内容
- Planning files 已在 PreToolUse 注入，Read 结果冗余
- 搜索结果提供位置引用即可，详细内容用 Read 查看

## 性能优化

| 指标 | 效果 |
|------|------|
| KV-Cache 利用率 | ~80% (前缀稳定) |
| 状态恢复 | 100% (持久化) |
| findings 检测准确率 | 100% (mtime) |
| Write context 减少 | ~95% (只返回元数据) |
| 模板大小 | 精简 50 行 |
