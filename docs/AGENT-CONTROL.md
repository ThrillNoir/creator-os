# Agent control

Creator OS detects the locally installed Codex CLI and Claude Code runtimes and can dispatch bounded tasks to either provider.

## Integration choice

- Use `codex exec --json` for isolated background jobs. It provides a machine-readable event stream and explicit sandbox selection.
- Consider Codex App Server later if the dashboard needs long-lived conversations, streamed approvals, and complete thread history.
- Use `claude -p --output-format stream-json` for Claude jobs.
- Never use either provider's permission-bypass flags.

## Task lifecycle

`draft → scoped → approved → running → needs_review → completed`

A task stores its provider, role, prompt, input references, workspace, permission mode, budget, timestamps, event log, output, and human approval.

## Roles

- **Research agent:** read-only access to research sources and platform rules.
- **Creator-managing agent:** reads approved voice examples, creator notes, relevant research, and recent captions; drafts copy but cannot publish.
- **Quality agent:** checks factual grounding, voice, repetition, tags, platform constraints, and approval completeness.
- **Operations agent:** may update Creator OS records after explicit approval; cannot publish externally by default.

## Security rules

- Plan mode is read-only.
- Execute mode is workspace-write and requires an approval record.
- Workspaces are selected from an allowlist, never arbitrary user-entered paths.
- Prompts cannot change the permission policy.
- Secrets are inherited only by the exact task that needs them; they are never written into logs.
- A completed agent task does not imply a post was published.
- External publishing remains a separate, destination-specific approval.
- Timeouts, output-size limits, cancellation, and concurrency caps are mandatory.

## Current implementation

`src/lib/agents/runtime.ts` detects both CLIs and contains the bounded runner. `/api/agents/status` reports installation state without exposing credentials. `/agents` shows the control-plane UI.

Task execution is intentionally not exposed through an HTTP route until SQLite-backed tasks, approvals, and audit events exist.
