# Documentation Guide

## Goal

This repository uses a bilingual documentation layout:
- English: `docs/en/`
- Simplified Chinese: `docs/zh-CN/`

Use `docs/shared/` for language-neutral materials and source-of-truth artifacts.

## Recommended Directory Layout

```text
docs/
├── en/
│   ├── README.md
│   ├── vision.md
│   ├── mvp.md
│   ├── architecture.md
│   ├── development-workflow.md
│   ├── release-workflow.md
│   ├── pr-review-workflow.md
│   ├── glossary.md
│   └── adr/
├── zh-CN/
│   ├── README.md
│   ├── vision.md
│   ├── mvp.md
│   ├── architecture.md
│   ├── development-workflow.md
│   ├── release-workflow.md
│   ├── pr-review-workflow.md
│   ├── glossary.md
│   └── adr/
└── shared/
    ├── documentation-guide.md
    ├── docs-index.md
    ├── terminology-map.md
    ├── adr-template.md
    └── diagrams/
```

## What goes where

### docs/en/
Use for English reader-facing docs.

### docs/zh-CN/
Use for Simplified Chinese reader-facing docs.

### docs/shared/
Use for:
- language-neutral schemas
- source-of-truth naming conventions
- terminology mapping
- documentation rules
- ADR templates
- diagram source files
- canonical tables or matrices referenced by both languages

## Topic mirroring rule

For every long-lived product/design topic, keep mirrored paths:

- `docs/en/vision.md`
- `docs/zh-CN/vision.md`

- `docs/en/architecture.md`
- `docs/zh-CN/architecture.md`

This keeps linking and maintenance simple.

## Translation workflow

Recommended process:
1. Update the primary language version
2. Update `docs/shared/terminology-map.md` if terminology changes
3. Update the mirrored language doc
4. Keep headings structurally aligned where possible

## Metadata suggestion

At the top of mirrored docs, add:

```md
> Source pair:
> - English: ../en/<file>
> - 中文: ../zh-CN/<file>
```

Or the inverse, depending on location.

## Naming conventions

- Use lowercase kebab-case file names
- Keep names identical across languages
- Translate content, not file names
- Prefer `zh-CN` instead of `zh`

## ADR recommendation

Keep ADR files mirrored by number and slug:

- `docs/en/adr/0001-control-plane-boundary.md`
- `docs/zh-CN/adr/0001-control-plane-boundary.md`

Use `docs/shared/adr-template.md` as the canonical structure template.
