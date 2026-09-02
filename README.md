# kotik-researcher

Local DeepSeek research client with a Go agent gateway, React UI, and Electron shell.

## Requirements

- Node.js 22 or newer
- Go 1.24 or newer
- pnpm 10
- `DEEPSEEK_API_KEY`

```bash
cp .env.example .env
export DEEPSEEK_API_KEY=your-key
pnpm install
```

The application reads `DEEPSEEK_API_KEY` from the process environment. It is never sent to the
browser or Electron renderer.

## Development

Browser mode runs Vite and the local Go gateway:

```bash
pnpm dev:browser
```

Electron mode builds and starts the same Go gateway as a supervised subprocess on an ephemeral
loopback port. The React renderer connects through the shared TypeScript client:

```bash
pnpm dev:electron
```

## Production

Build and run browser mode:

```bash
pnpm build
pnpm start
```

Build a Linux AppImage:

```bash
pnpm build:electron
```

Artifacts are written to `release/`.

## Architecture

```text
apps/web       React UI
apps/desktop   Node.js Electron lifecycle and secure preload bridge
cmd/kotik-agent  Go executable and composition root

packages/protocol   transport contracts and event validation
packages/client     shared HTTP/SSE gateway client

internal/agent      session-aware Go runtime and repository ports
internal/deepseek   Go DeepSeek ModelProvider adapter
internal/gateway    Go HTTP/SSE transport and static server
```

The UI creates a fresh in-memory session for each question to preserve the current stateless user
experience. The protocol and runtime are already session-aware, so a future stateful UI can retain a
session ID and later replace the Go `InMemorySessionRepository` with persistent storage without
coupling the agent to HTTP, React, or Electron.

Electron passes a per-launch gateway token to the Go subprocess over stdin. The Go process reports
its selected loopback URL through a machine-readable readiness message on stdout; diagnostics remain
on stderr.

## Checks

```bash
pnpm check
```
