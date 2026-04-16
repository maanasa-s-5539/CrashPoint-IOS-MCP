# AI Agent Rules -- CrashPoint-IOS-MCP

> This is the single source of truth for all AI tools working on this repository.
> All tool-specific config files (.github/copilot-instructions.md, .cursorrules, CLAUDE.md) reference this file.

---

## Project Overview

- **What**: Standalone MCP server for iOS/macOS crash log export, symbolication, analysis and CSV reporting.
- **Stack**: TypeScript 6, Node >= 18, ESM ("type": "module"), Zod 4 for validation, @modelcontextprotocol/sdk.
- **Build**: esbuild bundles src/core-server.ts to dist/core-server.js; tsc emits declarations only.

---

## Architecture

```
src/
├── core-server.ts      # MCP server entry -- DO NOT split into multiple files
├── config.ts           # Runtime config loading
├── index.ts            # Public API re-exports
├── pathSafety.ts       # Path traversal guards -- security critical
├── dateValidation.ts   # Date parsing utilities
├── core/               # Business logic (crashAnalyzer, crashExporter, symbolicator, csvExporter, setup)
├── state/              # Stateful modules (fixTracker, processedManifest)
└── cli/                # CLI entry points
```

---

## Code Style and Conventions

1. **Strict TypeScript** -- strict: true is enabled. Never use `any`; prefer `unknown` + type narrowing.
2. **ESM only** -- Use import/export. No require() or CommonJS patterns.
3. **Zod for validation** -- All external input (config files, CLI args, crash log fields) must be validated with Zod schemas.
4. **No default exports** -- Use named exports exclusively.
5. **Explicit return types** -- All public functions must have explicit return type annotations.

---

## Security Rules

1. **pathSafety.ts is security-critical.** Any change to this file requires extra scrutiny. Never weaken path traversal checks.
2. **Never hard-code secrets, tokens, or API keys.** Use environment variables (see .env.example).
3. **Never disable or weaken strict mode** in tsconfig.json.

---

## Build and Validation

Before committing, ensure:

```bash
npm run typecheck   # Must pass with zero errors
npm run build       # Must produce dist/ without errors
```

- **Never modify files in dist/ directly** -- they are build artifacts.
- **Never commit node_modules/.**

---

## Dependencies

- Do not add new runtime dependencies without justification.
- Keep devDependencies and dependencies properly separated.
- Pin major versions in package.json (use ^ for minor/patch).

---

## Git and PR Conventions

- Branch from main.
- Use conventional commit messages: feat:, fix:, chore:, docs:, refactor:.
- One logical change per commit.
- PRs must pass typecheck and build before merge.

---

## Specific Instructions

1. When modifying MCP tool definitions in core-server.ts, always update the corresponding Zod input schema and the tool's description string together.
2. Never remove or rename an existing exported symbol from index.ts without a deprecation path -- downstream consumers depend on these.
3. All crash-log file path arguments must go through pathSafety.ts validation before use.
4. When adding a new MCP tool, follow the existing pattern: Zod schema, handler function, register in the server, all within core-server.ts.
5. CSV output format changes require updating both csvExporter.ts and any related documentation in docs/.

---

## Do NOT

- Do not modify package-lock.json manually.
- Do not change the publishConfig registry or package scope.
- Do not introduce circular imports between core/, state/, and root src/ modules.
- Do not add browser-specific APIs -- this is a Node-only project.
- Do not remove or alter the automation/ shell scripts without understanding their CI role.
