# 架构

> 对应文档：
> - 中文：./architecture.md
> - English: ../en/architecture.md

## 概览

Smart CI/CD 是一个 Kubernetes-native 的 agentic build platform。

它把构建意图转成结构化执行计划，在 Kubernetes 管理的 runners 上运行，通过 Docker/BuildKit 执行构建步骤，持续观察运行时信号，并使用基于规则与 AI 辅助的监督来支持安全且受 policy 控制的干预。

架构围绕四个不变量构建：

1. 自然语言表达意图
2. 结构化 spec 定义执行
3. 运行时动作必须受 policy 控制
4. 观测、诊断和动作严格分离

## 架构分层

1. Intent Layer
2. Control Layer
3. Execution Layer
4. Observation Layer
5. Decision Layer
6. Action Layer

### Intent Layer
- 接收自然语言或结构化请求
- 生成或校验 `PipelineSpec`

### Control Layer
- 创建并跟踪 `PipelineRun`
- 将 `PipelineSpec` 编译为 `RunGraph`
- 将工作调度到 runners
- 持久化状态与历史

### Execution Layer
- 启动 runner Jobs/Pods
- 准备工作区与运行时
- 执行命令和测试
- 对构建调用 Docker/BuildKit

### Observation Layer
- 观察 Pods 和 Jobs
- 流式采集 Kubernetes events
- tail logs
- 采集 metrics 和 traces
- 将运行时信号归一化为 `RuntimeEvent`

### Decision Layer
- Rule Engine 负责确定性检测
- AI Supervisor 负责受边界约束的诊断和动作排序

### Action Layer
- 按 policy 校验动作
- 执行允许的干预
- 记录尝试与结果

## 核心运行时组件

- API / Intent Service
- Spec Compiler
- Run Orchestrator
- Runner Manager
- Build Adapter
- Watchers
- Stream Normalizer
- Rule Engine
- AI Supervisor
- Action Engine
- Live Run View Service

## 数据模型

- `PipelineSpec`
- `RunGraph`
- `PipelineRun`
- `StepRun`
- `RuntimeEvent`
- `DiagnosisRecord`
- `InterventionRecord`

## 执行流程

### 正常路径
1. 请求到达
2. 创建或校验 `PipelineSpec`
3. 编译 `RunGraph`
4. 创建 `PipelineRun`
5. 启动 runner Jobs
6. 观察并归一化运行时信号
7. 步骤完成
8. Run 成功完成

### 失败路径
1. 某个步骤发出异常信号
2. Observation layer 产出归一化事件
3. Rule Engine 分类已知条件
4. 在必要时触发 AI Supervisor
5. 对候选动作进行排序
6. Action Engine 校验 policy
7. 执行允许动作
8. 验证结果
9. Run 恢复、重试，或安全失败

## 安全与边界

- policy 优先于动作
- 默认最小权限
- 不允许隐藏式提权
- 默认不允许生产发布
- 默认不允许修改业务源码

## 演进路径

### Phase 1
- 单集群 MVP
- 基础 spec 提交
- runner Jobs
- watcher 栈
- 确定性异常检测
- 有限干预

### Phase 2
- 更丰富的 AI 诊断
- 更强的实时运行视图
- 更好的构建/cache 策略
- 带审批流的 guarded actions

### Phase 3
- 更强的租户模型
- 更丰富的执行策略
- 更先进的 replay/testing 系统
- 更多外部集成
