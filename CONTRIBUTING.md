# Contributing to Lance

Thank you for your interest in contributing! This is an open-source project and we welcome PRs.

## Development Workflow

1. Fork the repository and create a feature branch from `main`.
2. Make your changes with appropriate tests.
3. Run the full test suite locally (see README).
4. Submit a PR — CI must pass before merge.

## Branch Naming

| Type     | Pattern                        |
| -------- | ------------------------------ |
| Feature  | `feat/short-description`       |
| Bug fix  | `fix/short-description`        |
| Contract | `contract/escrow-improvements` |
| Docs     | `docs/update-readme`           |

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(escrow): add milestone partial release
fix(backend): handle missing job gracefully
docs(readme): update testnet deploy steps
```

## Code Style

- **Rust**: `cargo fmt` + `cargo clippy --deny warnings`
- **TypeScript**: `eslint` + `prettier`

CI enforces both.

## Opening Issues

Please use the GitHub issue templates for bug reports and feature requests.
