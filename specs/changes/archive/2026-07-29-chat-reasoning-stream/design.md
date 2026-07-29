# Design: chat-reasoning-stream

## Контекст

Reasoning отбрасывается в `src/main/pi/chat-manager.ts` (`case 'message_update'`
форвардит только `text_delta`; `thinking_start/delta/end` игнорируются).
Приложение нигде не вызывает `session.setThinkingLevel()` — сессии живут с
дефолтным уровнем SDK. Пайплайн событий: `chat-manager.ts` → `emitChatEvent` →
канал `event:chat` (`src/main/ipc.ts`) → preload (`src/preload/index.ts`) →
`ChatArea.tsx` (дедупликация по монотонному `seq` против снапшота). История
собирается из `session.messages` функцией `buildFeedItems()` — pi SDK сам
пишет reasoning в jsonl-сессию как часть контента assistant-сообщения.

## Справка: thinking-API pi SDK 0.82.1

Источник — `.d.ts` пакетов в node_modules (`@earendil-works/pi-coding-agent`,
`pi-agent-core`, `pi-ai`), не документация. Эта справка — единая точка правды
для implementer/reviewer (урок LRN-20260728-002: не реверс-инжинирить семантику
SDK заново в каждой сессии).

### Типы уровней

- `ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`
  (pi-ai); pi-agent-core добавляет `"off"` (`ModelThinkingLevel = "off" |
  ThinkingLevel`).
- ВАЖНО: набор шире задуманного изначально off/low/medium/high/max — решение
  пользователя (2026-07-28): показывать весь набор SDK, отфильтрованный
  возможностями модели, включая `minimal`/`xhigh`, если модель их поддерживает.

### Методы AgentSession (`agent-session.d.ts`)

- `setThinkingLevel(level): void` — синхронный; **клампит** уровень к
  возможностям модели; сохраняет в сессию/настройки только если уровень
  реально изменился.
- `getAvailableThinkingLevels(): ThinkingLevel[]` — уровни для текущей модели;
  провайдер дополнительно клампит внутри. `"off"` в этот список не входит —
  off добавляется в UI всегда.
- `supportsThinking(): boolean` — поддерживает ли текущая модель thinking.
- `CreateAgentSessionOptions.thinkingLevel?` — уровень при создании сессии
  (sdk.d.ts); можно задавать на старте вместо post-hoc setThinkingLevel.
- Событие `thinking_level_changed { level }` в `AgentSessionEvent` — можно
  использовать для диагностики, не обязательно.

### События стриминга (`AssistantMessageEvent`, pi-ai `types.d.ts`)

Приходят внутри `message_update` как `event.assistantMessageEvent`:
- `thinking_start { contentIndex }` — начало порции reasoning;
- `thinking_delta { contentIndex, delta }` — инкремент текста;
- `thinking_end { contentIndex, contentSignature? }` — конец порции.

Три события = одна логическая порция reasoning (один блок в UI). `contentIndex`
— индекс в `AssistantMessage.content`, сохраняет хронологию относительно
`text_*` и `toolcall_*` — основа interleaved-позиционирования.

### Персистентность в сессии pi (бесплатно)

`AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]`;
`ThinkingContent { type: "thinking", thinking, thinkingSignature?, redacted? }`
— pi пишет reasoning в jsonl-сессию сам. `buildFeedItems()` получает блоки из
истории чтением `part.type === 'thinking'`. Порядок массива content —
хронологический (interleaved восстанавливается из коробки).

Подводные камни:
- **Длительность SDK не хранит** — нужен собственный механизм (решение 3).
- `redacted: true` — reasoning, скрытый safety-фильтрами: текст пустой/
  непригодный; такие блоки имеет смысл не показывать или показывать пустыми —
  решение: не рендерить блоки с пустым `thinking`.
- Оборванное сообщение (stopReason `error`/`aborted`) может содержать частичный
  `ThinkingContent` — из истории не рендерим (требование «Оборванный
  reasoning…»): фильтр по stopReason сообщения.
- Шлёт ли конкретная модель `thinking_*` после `setThinkingLevel` — проверяется
  спайком (tasks 1.x); молчаливое отсутствие событий — норма по спеке.

## Цели и не-цели

- Цели: проброс thinking_* в renderer; один UI-блок на порцию reasoning с
  хронологической позицией; auto-collapse; длительность (live + персистентная);
  per-provider уровень с живым применением; дедупликация при auto-retry.
- Не-цели: пер-чат/пер-модель уровни; смена темы приложения; показ redacted-
  reasoning; запоминание состояния сворачивания; агрегация interleaved-порций
  в один блок.

## Решения

### 1. IPC-контракт: три события + FeedItem kind 'thinking'

`ChatEvent` дополняется `thinking_start`, `thinking_delta { delta }`,
`thinking_end` (все с `file`/`seq` — дедупликация по seq работает как для
остальных событий). `FeedItem` дополняется:

```ts
| { kind: 'thinking'; id: string; text: string; streaming: boolean;
    startedAt: number; durationMs?: number }
```

Renderer агрегирует три события в один item (урок LRN-20260728-002: одна
цепочка SDK-событий — одно пользовательское следствие). Длительность вживую
считается от `startedAt`; по `thinking_end` фиксируется `durationMs`.

### 2. Дедупликация при обрыве и auto-retry

Цепочка `thinking_start → delta* → end` ведётся в main на уровне handle: если
пришёл `thinking_start`, а предыдущая порция не закрыта (`end` не было — обрыв,
`agent_end` с willRetry), новый старт ПОМЕЧАЕТ предыдущий блок заменяемым.
Renderer по новому `thinking_start` заменяет незакрытый streaming-блок reasoning
вместо добавления нового — в ленте нет дублей ни при `auto_retry`, ни при
ручном «Повторить». `contentIndex` дополнительно позволяет склеивать порции
одного индекса, если SDK пошлёт повторный start для того же индекса.

### 3. Персистентность длительности: sidecar-файл

pi хранит текст reasoning, но не длительность. Рядом с механизмом истории —
sidecar JSON в каталоге данных приложения: `sessionFile → [ { contentIndex,
durationMs } ]`, пишется на `thinking_end` (атомарно, tmp+rename, как
recent-projects). `buildFeedItems()` при сборке из истории подставляет
`durationMs` по (sessionFile, contentIndex); thinking-части сообщений со
stopReason `error`/`aborted` и записи с пустым текстом в историю ленты не
попадают. Отвергнуто: вычислять длительность из timestamp'ов соседних
jsonl-записей — хрупко (tool-вызовы между порциями искажают) и не переживает
compaction.

### 4. Per-provider уровень: хранение и применение

`AppSettings` дополняется `thinkingLevels?: Record<providerId, ThinkingLevel |
"off">` (shared/ipc.ts). Применение:
- при создании сессии — `CreateAgentSessionOptions.thinkingLevel` из сохранённого
  уровня провайдера текущей модели (или дефолт: первый доступный из
  low/medium, иначе первый включённый из `getAvailableThinkingLevels()`);
- при смене настроек — в `applySettings()` для каждого загруженного handle
  вызывается `session.setThinkingLevel()` (урок LRN-20260728-003: после мутации
  настроек в main — явное применение к живым сессиям, а не «применится когда-нибудь»).
  setThinkingLevel синхронный и клампит сам; стрим не рвётся, т.к. уровень
  читается SDK на следующий запрос.
- renderer после `settings:set` перечитывает snapshot/настройки (та же явная
  инвалидация, что для остальных настроек).

Отвергнуто: маппинг уровней вручную per-провайдер в коде приложения —
`getAvailableThinkingLevels()` уже отражает возможности модели; ручная таблица
устареет с обновлением pi.

### 5. UI: ReasoningBlock по паттерну ToolBlock

Новый компонент `ReasoningBlock.tsx` повторяет collapse-паттерн
`ToolBlock.tsx` (useState open, кнопка-хедер с chevron): хедер — 💡 + «Thinking»
+ длительность; тело — курсивный текст с `border-left`. Стили `.thinking-*`
на существующих переменных (`--text-dim`), тема не трогается. Состояние open:
во время streaming — принудительно развёрнут; на `thinking_end` —
auto-collapse; из истории — всегда свёрнут. Тиканье секунд — локальный
interval в компоненте пока `streaming`.

## Риски

| Риск | Митигация |
|---|---|
| Модель/провайдер не шлёт thinking_* даже после setThinkingLevel | Спайк 1.x; молчаливое поведение — норма по спеке, фича не «пустая» для UI: без событий блоков нет |
| Дубли блоков при retry/auto-retry (LRN-20260728-002) | Решение 2: замена незакрытого блока; дедуп по seq; склейка по contentIndex |
| Незакрытый streaming-блок «зависает» развёрнутым при обрыве | `agent_end`/`error` в renderer закрывает streaming-блоки (как closeStreaming для текста) |
| Рассинхрон sidecar-длительностей с историей (compaction, удаление чата) | Ключ (sessionFile, contentIndex); отсутствующая запись = блок без длительности (деградация, не ошибка); sidecar чистится вместе с удалением чата |
| Включённый дефолт увеличивает расход токенов | Осознанный компромисс из vision; off доступен всегда |
