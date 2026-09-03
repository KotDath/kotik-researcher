# kotik-researcher

Local DeepSeek research client that runs in a browser or as an Electron application.

## Requirements

- Node.js 22 or newer
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

Browser mode runs Vite and the local TypeScript gateway:

```bash
pnpm dev:browser
```

Electron mode runs the same gateway on an ephemeral loopback port and connects through the shared
client:

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
apps/server    Node HTTP/SSE gateway and static server
apps/desktop   Electron lifecycle and secure preload bridge

packages/agent      session-aware agent runtime and repository ports
packages/deepseek   DeepSeek ModelProvider adapter
packages/protocol   transport contracts and event validation
packages/client     shared HTTP/SSE gateway client
```

The UI creates a fresh in-memory session for each question to preserve the current stateless user
experience. The protocol and runtime are already session-aware, so a future stateful UI can retain a
session ID and later replace `InMemorySessionRepository` with persistent storage without coupling the
agent to HTTP or Electron.

## Checks

```bash
pnpm check
```
