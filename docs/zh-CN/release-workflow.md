# Release 工作流

> 对应文档：
> - 中文：./release-workflow.md
> - English: ../en/release-workflow.md

## 模式

项目使用 Changesets 和 merge-to-main 的 release 流程。

## 步骤

1. 准备 changeset
2. 生成 PR 标题和正文
3. 打开 PR
4. 合并到 `main`
5. 由 CI 执行 version、tag 和 release 发布
