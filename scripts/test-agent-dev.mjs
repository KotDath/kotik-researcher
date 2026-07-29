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
    '2. Используйте инструменты MCP-сервера playwright (префикс playwright_*):',
    '   browser_navigate http://localhost:5173, затем browser_snapshot /',
    '   browser_click / browser_take_screenshot',
    '3. Состояния: ?mockApi=loading | ?mockApi=demo | ?mockApi=error',
    '4. Оценивайте по критериям docs/ui-review.md',
    '',
    'Финальная верификация (с main/IPC): pnpm test:agent:electron + инструменты',
    'MCP-сервера playwright-cdp (префикс playwright-cdp_*)'
  ].join('\n')
)
