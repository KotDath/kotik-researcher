# Tasks: chat-reasoning-stream

## 1. Верификация pi SDK (спайки, результаты — в decisions.md)

- [x] 1.1 Спайк: на живой сессии вызвать `setThinkingLevel(<включённый уровень>)`
  и отправить запрос к текущей модели — подтвердить/опровергнуть приход
  событий `thinking_start/delta/end` в `message_update.assistantMessageEvent`;
  результат зафиксировать строкой в decisions.md (молчаливое отсутствие
  событий — норма по спеке, не блокер)
- [x] 1.2 Спайк: для задействованных провайдеров/моделей вызвать
  `getAvailableThinkingLevels()` и `supportsThinking()` — зафиксировать в
  decisions.md, какие уровни реально возвращаются (в т.ч. minimal/xhigh) и
  что возвращается для модели без поддержки thinking

## 2. IPC-контракт (shared + preload)

- [x] 2.1 В `src/shared/ipc.ts` добавить в `ChatEvent` события `thinking_start`,
  `thinking_delta { delta }`, `thinking_end` (с `file`/`seq`, как у остальных)
- [x] 2.2 В `src/shared/ipc.ts` добавить в `FeedItem` kind `'thinking'`
  (поля: `id`, `text`, `streaming`, `startedAt`, `durationMs?`)
- [x] 2.3 В `AppSettings` добавить `thinkingLevels?: Record<string, ThinkingLevel | 'off'>`
  (тип уровня — union литералов SDK: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')
- [x] 2.4 Убедиться, что типы доезжают через preload (`src/preload/index.ts`)
  без изменений рантайма (события `event:chat` пробрасываются как раньше)

## 3. Main: проброс и дедупликация thinking-событий

- [x] 3.1 В `chat-manager.ts` (`onSessionEvent`, `case 'message_update'`)
  форвардить `thinking_start/delta/end` в новые ChatEvent; вести состояние
  незакрытой порции на handle
- [x] 3.2 Дедупликация (LRN-20260728-002): повторный `thinking_start` при
  незакрытой предыдущей порции (обрыв + auto-retry) помечает её заменяемой —
  renderer заменяет блок, а не добавляет; склейка по `contentIndex` при
  повторном start того же индекса
- [x] 3.3 Гарантировать, что `agent_end` (включая `willRetry`) и `error`
  закрывают незакрытую thinking-порцию (emit `thinking_end`-эквивалента или
  флага в существующих событиях), чтобы streaming-блок не «зависал»

## 4. Main: персистентность reasoning и длительности

- [x] 4.1 В `buildFeedItems()` собирать блоки `'thinking'` из
  `part.type === 'thinking'` assistant-сообщений в хронологической позиции
  (порядок массива content), пропуская пустые/redacted и части сообщений со
  stopReason `error`/`aborted`
- [x] 4.2 Sidecar-хранилище длительностей: JSON в каталоге данных приложения,
  ключ (sessionFile, contentIndex) → durationMs, запись атомарная (tmp+rename)
  на `thinking_end`; чтение в `buildFeedItems()`; отсутствие записи = блок без
  длительности (не ошибка)
- [x] 4.3 Чистка sidecar-записей при удалении чата

## 5. Main: per-provider уровень thinking

- [x] 5.1 При создании сессии передавать `thinkingLevel` из
  `settings.thinkingLevels[providerId]`; при отсутствии — дефолт: первый
  доступный из low/medium, иначе первый из `getAvailableThinkingLevels()`
- [x] 5.2 В `applySettings()` вызывать `session.setThinkingLevel()` для каждого
  загруженного handle (включая retired) — живое применение без перезапуска
  (LRN-20260728-003); уровень off применяется так же
- [x] 5.3 Протянуть доступные уровни в `SettingsView` (например,
  `availableThinkingLevels` per provider для текущей модели) для рендера
  списка в Settings

## 6. Renderer: блок reasoning

- [x] 6.1 Компонент `ReasoningBlock.tsx` по паттерну `ToolBlock.tsx`: хедер —
  chevron + 💡 + «Thinking» + длительность; тело — текст reasoning; развёрнут
  при `streaming`, auto-collapse на завершении, из истории всегда свёрнут
- [x] 6.2 Тиканье длительности вживую (interval пока `streaming`), фиксация по
  `thinking_end`; формат «Thinking · Ns»
- [x] 6.3 Обработка `thinking_start/delta/end` в `ChatArea.tsx`: создание/
  наращивание/закрытие блока; замена незакрытого блока при новом start (дедуп
  retry); закрытие streaming-блока на `agent_end`/`error`
- [x] 6.4 Стили `.thinking-*` в styles.css: `--text-dim` для хедера и текста,
  курсив, тонкая вертикальная линия-отступ слева (border-left); тема не
  меняется

## 7. Renderer: Settings

- [x] 7.1 Селектор уровня thinking per provider: список = off +
  доступные уровни текущей модели провайдера; настройка видна всегда (в т.ч.
  для модели без поддержки thinking)
- [x] 7.2 Сохранение выбора в `thinkingLevels[providerId]` через
  `settings:set`; после сохранения renderer перечитывает настройки (явная
  инвалидация, LRN-20260728-003)

## 8. Проверка

- [x] 8.1 `pnpm typecheck` и `pnpm lint` проходят
- [x] 8.2 Smoke: `pnpm build` собирается, собранный артефакт запускается
- [x] 8.3 Сценарии дельты pi-chat-sessions: reasoning стримится перед текстом
  ответа; interleaved — несколько блоков по хронологии; auto-collapse; клик
  разворачивает/сворачивает; длительность тикает и фиксируется; оформление
  (курсив, --text-dim, линия-отступ) контрастирует с ответом
- [x] 8.4 Сценарии персистентности: после перезапуска блоки из истории свёрнуты,
  с той же длительностью; оборванный reasoning в истории отсутствует; после
  auto-retry в ленте один блок reasoning без дублей
- [x] 8.5 Сценарии дельты llm-provider-settings: уровень per-provider
  запоминается и переживает перезапуск; список уровней ограничен возможностями
  модели; дефолт нового провайдера включённый; смена уровня действует со
  следующего запроса и не рвёт текущий стрим
- [x] 8.6 Модель без поддержки thinking: чат без reasoning-блоков,
  плейсхолдеров и ошибок; настройка в Settings видна
