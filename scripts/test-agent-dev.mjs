// Быстрый режим агентской UI-верификации (design.md, решение 5):
// renderer-only dev-server + Playwright MCP. Не проверяет main/IPC —
// финальная верификация только через pnpm test:agent:electron.
console.log(
  [
    'Быстрый режим UI-верификации (renderer-only):',
    '',
    '1. Запустите dev-server:  pnpm dev:renderer',
    '   (renderer поднимется на http://localhost:5173 с моковым window.api —',
    '    main-процесс и IPC в этом режиме не проверяются)',
    '2. Через Playwright MCP перейдите:  browser_navigate http://localhost:5173',
    '3. Проверяйте UI инструментами browser_snapshot / browser_screenshot /',
    '   browser_click; состояния: ?mockApi=loading | ?mockApi=demo | ?mockApi=error',
    '4. Оценивайте по критериям docs/ui-review.md',
    '',
    'Финальная верификация (с main/IPC): pnpm test:agent:electron + MCP с',
    '--cdp-endpoint http://127.0.0.1:9222'
  ].join('\n')
)
