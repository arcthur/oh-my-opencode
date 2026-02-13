# Contract: BDD Specs 与 Writing Plans 对齐

本文档定义 `bdd-specs`（行为规格）与 `writing-plans`（执行计划）在本仓库中的最小契约，目标是避免“双真相源（double SSOT）”与执行漂移。

## 术语

- **Behavior SSOT**：行为真相源。回答“系统应该怎么表现”。
- **Execution SSOT**：执行真相源。回答“当前做到哪一步、下一步是什么”。
- **Scenario Ref**：任务对行为场景的可追溯引用（例如 `S-001`）。

## 单一真相源边界（MUST）

1. `bdd-specs`（或等价场景目录）是 **Behavior SSOT**，用于定义期望行为，不记录运行态任务状态。
2. `TaskGraph`（`scope=plan|swarm`）是 **Execution SSOT**，用于记录任务状态与依赖。
3. `plan.md` 是执行编排工件（可读），不是运行态状态真相源。
4. 任何新增流程 **MUST NOT** 引入第二套执行状态系统。

参考实现：
- `src/features/planning-with-files/manager.ts`
- `src/features/task-system/`

## 规划编译契约（Writing Plans）

`writing-plans` 的本质是“编译”：

- 输入：行为场景（`bdd-specs` 或等价设计文档中的场景段落）
- 输出：可执行任务 DAG（`plan.md` 中 `## Tasks`，随后同步到 TaskGraph）

每个任务条目 **MUST** 包含：

1. `Scenario Ref`（至少一个）
2. 可执行验证步骤（命令或可程序化检查）
3. 失败/负向场景验证（negative case）

推荐任务片段：

```markdown
- 3. Implement token refresh flow
  Scenario Ref: S-003, S-004
  Depends On: 1, 2
  Context Packs: global, auth
```

## Scenario Ref 约束

- 推荐格式：`S-001`、`S-002`。
- 允许多个引用，逗号或空白分隔。
- 引用必须稳定可追溯；重排任务时，引用不应变化。

## 运行时对齐策略

通过 `work_orchestrator.planning_with_files.bdd_alignment` 控制执行前校验：

- `off`：关闭对齐检查。
- `warn`：发现任务缺少 `Scenario Ref` 时注入提醒，不阻断执行。
- `required`：发现缺失时阻断执行，直到计划补齐引用。

默认值建议为 `warn`，逐步收敛到 `required`。

## 非目标（MUST NOT）

1. 不强制引入特定 BDD 工具链（如必须 Gherkin runner）。
2. 不要求 `bdd-specs` 成为运行态任务状态存储。
3. 不要求小修复任务走重型文档流程；但仍应有最小场景引用。

## 验证清单

- [ ] 每个 `## Tasks` 条目都有 `Scenario Ref`
- [ ] 每个任务都有可自动执行验证步骤
- [ ] 执行状态仅在 TaskGraph 中演进
- [ ] 未出现第二套执行状态文件/目录
