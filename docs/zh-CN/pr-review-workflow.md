# PR 审查工作流

> 对应文档：
> - 中文：./pr-review-workflow.md
> - English: ../en/pr-review-workflow.md

## 流程

1. PR 创建或更新
2. GitHub Actions 拉取 PR diff
3. MiniMax 审查 diff
4. 回写结构化 review 评论
5. 如果没有 blocking finding，则尝试启用 auto-merge

## 输入

- PR 标题
- PR 正文
- 变更文件和 patch
- review policy
- review prompt
