# MVP

> 对应文档：
> - 中文：./mvp.md
> - English: ../en/mvp.md

MVP 的目标是证明 Smart CI/CD 能够在 Kubernetes 上端到端执行一条流水线、进行实时观测、检测常见失败条件，并执行一小组安全且受 policy 控制的干预动作。

## MVP 目标

MVP 不是为了展示完全自治。  
它要验证的是核心执行与监督闭环：

**spec 提交 -> run 编排 -> 运行时观测 -> 异常检测 -> 诊断 -> 安全干预 -> 实时可见性**

## 范围内

### 1. 结构化流水线提交
- 接收结构化 `PipelineSpec`
- 校验并编译为可执行的 `RunGraph`

### 2. 基于 Kubernetes 的执行
- 在 Kubernetes 上调度 runner Jobs
- 在 Jobs/Pods 中执行步骤
- 对构建/镜像步骤使用 Docker/BuildKit

### 3. 实时观测
- 观察 Pod 和 Job 生命周期变化
- 流式采集并归一化 Kubernetes events
- 实时 tail runner logs
- 产出归一化的 `RuntimeEvent`

### 4. 确定性异常检测
- 检测 stuck steps
- 检测重复错误模式
- 检测基础资源压力 / 基础设施故障信号
- 在需要时触发诊断流程

### 5. Policy 控制下的干预
- 执行一组固定的允许动作
- 按 `specs/intervention-policy.yaml` 校验所有动作
- 记录每次干预尝试及其结果

### 6. 实时运行可见性
- 展示当前 run / stage / step
- 展示近期事件与当前风险等级
- 展示动作历史和诊断摘要

## 范围外

MVP 不包括：
- 高级多团队隔离
- 高级 RBAC / 审批工作流
- 把完整自然语言解析作为硬入口
- 完整 builder-pool 管理
- 将外部 cache / registry 优化作为核心要求
- 自动生产发布
- 自动修改业务逻辑

## MVP 服务

| 服务 | MVP 责任 |
|---|---|
| `control-plane` | run 编排与 RunGraph 调度 |
| `watcher` | Pod/Job/Event 观察、日志 tail、事件归一化 |
| `rule-engine` | 确定性异常检测 |
| `ai-supervisor` | 诊断摘要与候选动作排序，初期可受限或 stubbed |
| `action-engine` | 受 policy 控制的干预执行 |
| `ui` | 实时运行视图 |

## MVP 必需干预

MVP 至少应支持：
- rerun failed step
- stop obviously doomed run

可选但有价值：
- clear cache then rerun

## 成功标准

1. `PipelineSpec` 可以被提交并编译为 `RunGraph`
2. run 可以作为 Kubernetes Jobs 执行
3. Pod/Job/Event/log 信号能被归一化为 runtime events
4. rule engine 至少能可靠检测一种已知异常
5. action engine 至少能安全执行两种允许干预
6. UI 能展示实时状态和近期事件
7. 每一次干预都会被记录
8. AI 辅助诊断能够输出受边界约束的摘要，即使初期是简化版
