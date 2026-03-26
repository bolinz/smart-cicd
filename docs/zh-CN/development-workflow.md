# 开发工作流

> 对应文档：
> - 中文：./development-workflow.md
> - English: ../en/development-workflow.md

本文档描述本地模块开发闭环，以及如何衔接到 release 准备、PR 审查与下一模块规划。

## 目标

这个工作流应让模块开发具备以下特点：
- 增量式
- 可复现
- 可审查
- 本地优先
- 默认安全

## 本地模块闭环

1. 在 `.claude/state/current-module.json` 中设置当前模块
2. 只实现一个边界清晰的模块
3. 运行相关测试
4. 如果测试通过，触发 `/module-complete`
5. `/module-complete` 会调用：
   - `/release`
   - `/next-module`
6. 使用生成的 release 草稿打开 PR
7. 由 GitHub Actions 运行 MiniMax PR review
8. 如果没有 blocking finding 且仓库规则允许，则启用 auto-merge

## 当前模块状态

文件：
- `.claude/state/current-module.json`

示例：
```json
{
  "module_name": "pod-watcher"
}
```

这个文件作为当前正在实现模块的本地事实来源。

## Skills

### `/release`
用于：
- 判断 release 类型（`minor` 或 `patch`）
- 准备 changeset 草稿
- 起草 PR 标题和 PR 正文

### `/next-module`
用于：
- 检查本地仓库
- 判断下一个最合适的模块
- 返回验收标准
- 生成可直接运行的实现 prompt

### `/module-complete`
用于：
- 汇总当前模块完成情况
- 调用 `/release`
- 调用 `/next-module`
- 生成当前模块的最终交付结果

## Hook 自动化

本地工作流使用 Claude hooks。

### PostToolUse
当测试命令成功执行后，把测试状态记录到：
- `.claude/state/test-status.json`

### TaskCompleted
当任务完成时：
- 检查当前模块状态
- 检查最近一次测试状态
- 如果都有效，则建议执行：
  - `/module-complete <module-name>`

## 推荐开发模式

对于每个模块：
1. 先读 docs 和 specs
2. 只实现一个受边界约束的模块
3. 添加或更新测试
4. 避免跨模块扩 scope
5. 以 release 准备和下一步规划作为收尾

## Release 交接

本项目里的 release 指的是：
- 准备 changeset
- 起草 PR 元数据
- 进入基于 PR 的合并流程

它**不表示**：
- 立即发布版本
- 立即打 tag
- 跳过 PR 审查

## PR 审查交接

PR 打开后：
- GitHub Actions 拉取 PR diff
- MiniMax 审查 PR
- 回写结构化 review 评论
- 如果没有 blocking finding，则可能尝试 auto-merge

## 安全规则

- 优先使用本地仓库上下文
- 不要静默扩大干预范围
- 不要绕过 specs 或 policies
- 不要把 release 误解为“已经发布完成”
- 在没有明确确认前，不要自动开始下一个模块
