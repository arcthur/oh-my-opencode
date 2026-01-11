# Context Distillation Research: Droid CLI vs oh-my-opencode

## Executive Summary

本文档对比分析了 Factory.ai Droid CLI 的上下文管理策略与当前 oh-my-opencode 项目的实现，并提出具体优化建议。

---

## 1. Droid CLI 上下文管理策略

### 1.1 Context Stack (上下文堆栈)

Droid 采用**渐进式蒸馏**架构，将"公司所有知识"逐层过滤为"当前 Droid 所需内容"。

```
┌─────────────────────────────────────┐
│     Enterprise Context Layer        │  ← Sentry, Notion, Google Docs
├─────────────────────────────────────┤
│     Org Memory Layer                │  ← 团队规范、风格指南
├─────────────────────────────────────┤
│     User Memory Layer               │  ← 个人偏好、环境配置
├─────────────────────────────────────┤
│     Repository Overview Layer       │  ← 项目结构、依赖、构建命令
├─────────────────────────────────────┤
│     Session Context Layer           │  ← 当前任务、工具调用
└─────────────────────────────────────┘
```

### 1.2 核心特性

| 特性 | 描述 |
|------|------|
| **Repository Overview** | 为每个仓库生成结构摘要（项目结构、包、构建命令、核心文件） |
| **Lazy Loading** | 仅在需要时拉取上下文，避免重复 |
| **Runtime Tracking** | 追踪工具执行时间，避免重复慢操作 |
| **Hierarchical Memory** | 分层持久化记忆（User Memory + Org Memory） |
| **Plan-based Coherence** | 使用计划工具保持任务组织性 |

### 1.3 Hierarchical Memory (分层记忆)

**User Memory (用户记忆)**:
- 开发环境配置 (OS, containers)
- 历史工作记录
- 工作风格偏好

**Org Memory (组织记忆)**:
- 公司风格指南
- 代码规范 (如 snake_case for API)
- 架构决策

---

## 2. 当前项目实现分析

### 2.1 现有上下文管理组件

| 组件 | 路径 | 功能 |
|------|------|------|
| Preemptive Compaction | `src/hooks/preemptive-compaction/` | 85%阈值触发压缩 |
| Context Window Recovery | `src/hooks/anthropic-context-window-limit-recovery/` | 三层恢复策略 (DCP → Truncate → Summarize) |
| Compaction Context Injector | `src/hooks/compaction-context-injector/` | 压缩时保留关键上下文 |
| Directory Agents Injector | `src/hooks/directory-agents-injector/` | 自动注入目录 AGENTS.md |
| Dynamic Truncator | `src/shared/dynamic-truncator.ts` | 动态截断工具输出 |
| Context Window Monitor | `src/hooks/context-window-monitor.ts` | 70%使用率提醒 |

### 2.2 现有压缩策略流程

```
PHASE 1: Dynamic Context Pruning (DCP)
├─ Deduplication: 删除重复工具调用
├─ Supersede Writes: 删除被后续读取覆盖的写入
└─ Purge Errors: 清除旧错误调用

PHASE 2: Aggressive Truncation
└─ 截断最大工具输出至 50%

PHASE 3: Session Summarize
└─ 调用 LLM 生成会话摘要
```

### 2.3 当前项目优势

1. **三层恢复策略**: 从轻量到重量级，最小化信息损失
2. **DCP 细粒度控制**: 可配置的修剪策略
3. **AGENTS.md 层级注入**: 支持目录级别上下文
4. **冷却机制**: 防止频繁压缩

### 2.4 当前项目不足

1. **缺乏持久化记忆**: 会话间信息丢失
2. **无 Repository Overview**: 每次需要重新探索项目
3. **无 Runtime Tracking**: 可能重复执行慢操作
4. **无 Org/User Memory 分层**: 团队规范需要每次手动指定
5. **压缩时信息保留有限**: 仅保留基本结构化信息

---

## 3. 行业最佳实践

### 3.1 Compaction vs Summarization

| 方法 | 特点 | 优先级 |
|------|------|--------|
| **Raw** | 原始数据 | 最高 |
| **Compaction (可逆)** | 删除环境中可重新获取的冗余信息 | 中 |
| **Summarization (有损)** | LLM 压缩历史 | 最低 |

**最佳实践**: `Raw > Compaction > Summarization`

### 3.2 阈值管理

- 不要等 API 报错再处理
- Claude 3.5 Sonnet (~200K): 建议在 150K-180K 触发
- 1M context: 建议在 256K 前触发（避免 "context rot"）

### 3.3 保留动量 (Preserving Momentum)

压缩时保留最近 3-5 轮原始对话，保持模型的"节奏"和格式风格。

### 3.4 结构化摘要

```markdown
## Files Modified
- path/to/file.ts: Added function X

## Decisions Made
- Chose approach A over B because...

## Current State
- Working on feature Y
- Blocked by issue Z

## Next Steps
1. Complete task A
2. Test feature B
```

### 3.5 工具结果清理

深层历史中的工具调用结果可安全删除，agent 不需要再次看到原始结果。

---

## 4. 优化建议

### 4.1 高优先级 (Quick Wins)

#### 4.1.1 Repository Overview 生成

**建议**: 新增 `repo-overview-injector` 钩子

```typescript
// src/hooks/repo-overview-injector/index.ts
interface RepoOverview {
  structure: string;        // 目录树
  techStack: string[];      // 技术栈
  buildCommands: string[];  // 构建命令
  coreFiles: string[];      // 核心文件
  conventions: string[];    // 代码规范
}

// 在会话开始时注入，类似 Droid 的 bootstrap
```

**预期收益**: 减少初始探索时间，降低 token 消耗

#### 4.1.2 Tool Result Clearing (工具结果清理)

**建议**: 在 DCP 中增加 `clear_old_tool_results` 策略

```typescript
// pruning-tool-results.ts
export function clearOldToolResults(
  messages: Message[],
  options: { keepRecentTurns: number }
): PruningResult {
  // 保留最近 N 轮的工具结果
  // 清除更早的工具输出（仅保留工具名和简要状态）
}
```

**预期收益**: 显著减少 token 消耗，比截断更精准

#### 4.1.3 增强压缩上下文模板

**建议**: 扩展 `compaction-context-injector` 模板

```markdown
## Files Modified (with line ranges)
## Key Decisions & Rationale
## Current Working State
## Environment/Tool Outputs Still Needed
## Blocked Items
```

### 4.2 中优先级 (Significant Improvements)

#### 4.2.1 持久化 User Memory

**建议**: 新增 `user-memory` 模块

```typescript
// src/features/user-memory/
interface UserMemory {
  preferences: Record<string, string>;  // 用户偏好
  environment: EnvironmentInfo;          // 开发环境
  workHistory: WorkHistoryEntry[];       // 历史工作
  customRules: string[];                 // 自定义规则
}

// 存储: ~/.opencode/memory/user.json
// 跨会话持久化
```

#### 4.2.2 Runtime Tracking

**建议**: 追踪工具执行时间并注入上下文

```typescript
// src/hooks/runtime-tracker/
interface ToolRuntime {
  tool: string;
  avgDuration: number;
  lastDuration: number;
  callCount: number;
}

// 当工具耗时超过阈值时注入提示:
// "[Tool runtime: grep averaged 5.2s last 3 calls - consider narrower search]"
```

#### 4.2.3 Observation Masking

**建议**: 实现观察掩码策略（参考 OpenHands/Cursor）

```typescript
// 仅掩码环境观察（工具输出）
// 保留完整的动作和推理历史
// 比 LLM 摘要更轻量，保留更多信息
```

### 4.3 低优先级 (Future Enhancements)

#### 4.3.1 Org Memory (团队记忆)

```typescript
// src/features/org-memory/
// 存储: .opencode/memory/org.json (项目级)
// 内容: 团队规范、架构决策、命名约定
```

#### 4.3.2 Multi-Agent Context Isolation

```typescript
// 子 agent 返回精简摘要（1-2k tokens）
// 主 agent 仅看到结果摘要，不看过程
// "Share memory by communicating" 原则
```

#### 4.3.3 智能预压缩触发

```typescript
// 根据任务复杂度动态调整阈值
// 简单任务: 90% 阈值
// 复杂任务: 75% 阈值
// 基于历史 token 消耗模式预测
```

---

## 5. 实现路线图

### Phase 1: Quick Wins (1-2 weeks)

1. [ ] 实现 `clear_old_tool_results` DCP 策略
2. [ ] 增强 `compaction-context-injector` 模板
3. [ ] 添加 "preserve recent turns" 选项到 summarization

### Phase 2: Core Features (2-4 weeks)

4. [ ] 实现 `repo-overview-injector`
5. [ ] 实现 `user-memory` 持久化
6. [ ] 实现 `runtime-tracker`

### Phase 3: Advanced Features (4-8 weeks)

7. [ ] 实现 Observation Masking
8. [ ] 实现 Org Memory
9. [ ] 优化 Multi-Agent Context Isolation

---

## 6. 配置建议

```json
{
  "experimental": {
    "preemptive_compaction": true,
    "preemptive_compaction_threshold": 0.80,
    "dcp_for_compaction": true,
    "dynamic_context_pruning": {
      "enabled": true,
      "strategies": {
        "deduplication": { "enabled": true },
        "supersede_writes": { "enabled": true, "aggressive": true },
        "purge_errors": { "enabled": true, "turns": 3 },
        "clear_tool_results": { "enabled": true, "keep_recent_turns": 5 }
      }
    },
    "repo_overview": {
      "enabled": true,
      "auto_generate": true
    },
    "user_memory": {
      "enabled": true,
      "persist_preferences": true
    },
    "runtime_tracking": {
      "enabled": true,
      "threshold_ms": 3000
    }
  }
}
```

---

## 7. References

- [Factory.ai - The Context Window Problem](https://factory.ai/news/context-window-problem)
- [Factory.ai - Memory and Context Management](https://docs.factory.ai/guides/power-user/memory-management)
- [Factory.ai - Evaluating Compression](https://factory.ai/news/evaluating-compression)
- [Two Experiments on Context Compaction - Jason Liu](https://jxnl.co/writing/2025/08/30/context-engineering-compaction/)
- [JetBrains Research - Efficient Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Google ADK - Context Compaction](https://google.github.io/adk-docs/context/compaction/)
- [Anthropic - Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

---

## 8. Conclusion

当前 oh-my-opencode 的上下文管理实现已经相当完善，特别是三层恢复策略和 DCP 机制。主要改进方向应集中在：

1. **持久化记忆**: 跨会话保留用户/项目知识
2. **Repository Overview**: 减少重复探索
3. **工具结果清理**: 更精准的 token 节省
4. **Runtime Tracking**: 避免重复慢操作

通过这些优化，可以显著提升上下文利用效率，减少不必要的压缩，提供更流畅的用户体验。
