---
name: ast-index
description: Структурный поиск по коду через ast-index CLI (SQLite+FTS5 индекс, tree-sitter). Use when нужно найти символ/класс/функцию, usages перед рефакторингом, implementations трейта/интерфейса, callers, refs, outline файла, карту проекта, зависимости модулей — в Rust/TypeScript/JavaScript кодовой базе этого репозитория. ast-index — PRIMARY инструмент поиска кода, до grep/glob. NOT FOR поиска по строковым литералам, regex и содержимому комментариев (там grep).
---

# ast-index — структурный поиск кода

Портировано из upstream-плагина `defendend/Claude-ast-index-search`
(плагины для Claude Code/Cursor/Codex). Этот скилл — адаптация под opencode
и стек kotik-researcher (Rust workspace + React/JSX).

## Critical Rules

1. **ast-index — PRIMARY search tool**: любой поиск по коду сначала через
   ast-index, grep/glob — только если ast-index вернул пусто, нужен regex,
   строковый литерал или содержимое комментариев.
2. **Не дублировать результат**: если ast-index нашёл usages/implementations —
   это и есть полный ответ, не перепроверять grep'ом «для полноты».
3. **Первый запрос в сессии — `ast-index stats`**: если индекса нет или он
   подозрительно пуст/стар — `ast-index rebuild` из корня.
4. Индекс протухает: после крупных правок, merge или смены ветки —
   `ast-index update` (инкрементально) или `rebuild` (полностью).

## Prerequisites

```bash
# Установка (cargo, из git — на crates.io пакета нет):
cargo install --git https://github.com/defendend/Claude-ast-index-search ast-index

# Индексация (один раз на проект, из корня репо):
ast-index rebuild --type files
```

Индекс лежит вне репозитория: `~/.cache/ast-index/<project-hash>/index.db`.

Почему `--type files` (проверено по исходникам v3.50.0): дефолтный
`rebuild` (режим `all`) дополнительно индексирует `node_modules/**/*.d.ts`
отдельным vendor-проходом, который **не читается** из exclude-конфига —
700+ файлов шума в `map`/`explore`. Режим `files` делает только основной
обход (он `.ast-index.yaml` уважает). Мы ничего не теряем: модули/deps
ast-index умеет только для Gradle/SPM/Maven/Python, для Cargo их нет
в принципе. `update` vendor-проход не запускает, так что `.d.ts` не вернутся.

Проектный конфиг `.ast-index.yaml` в корне (exclude: node_modules, dist,
target, gen) — коммитим в репо.

## Core commands

```bash
ast-index explore "как устроен стриминг чанков"   # one-shot: релевантные символы + исходники + соседи по графу + тесты
ast-index explore ChatAgent --rwr                 # + переранжирование через граф вызовов (PageRank)
ast-index search ChatAgent                        # универсальный: файлы + символы
ast-index symbol send_message                     # точный поиск символа
ast-index refs ChatAgent                          # определения + импорты + usages одним видом
ast-index usages stream_reply                     # все использования (перед рефакторингом!)
ast-index implementations ChatAgent               # кто реализует трейт/интерфейс
ast-index callers handleSend                      # все места вызова функции
ast-index outline src-tauri/src/lib.rs            # структура файла (символы)
ast-index imports src/App.jsx                     # импорты файла
ast-index map                                     # карта проекта (~50 строк, топ директорий)
ast-index conventions                             # стек, фреймворки, паттерны проекта
ast-index changed --base main                     # инвентарь файлов ветки перед ревью
ast-index update                                  # инкрементальное обновление индекса
```

Полный перечень команд с опциями: `ast-index --help`.

## Workflow

1. Начало сессии в незнакомой области: `ast-index explore "<вопрос>"` или
   `map` — вместо чтения файлов подряд.
2. Перед правкой символа: `usages <символ>` — чтобы знать все call sites.
3. Перед ревью ветки: `changed --base main`.
4. После своих правок: `update`.

## Ограничения (проверено на этом репо)

- Запросы к `explore`/`search` — на языке символов (английские термины
  кода: `stream chat reply`), а не русской прозой: матч идёт по именам
  символов и путям.
- Rust: определения трейтов/структур/fn и их impl-блоки находятся отлично;
  usages **методов трейтов** может не находить (tree-sitter, не компилятор) —
  тогда grep по имени метода как fallback.
- Модули (`map` с modules, `deps`, `dependents`) для Cargo не поддержаны —
  команды есть, но данных не будет.

## JSON / scripting

По умолчанию вывод человекочитаемый — его и используй. `--format json` —
только для скриптов/пайплайнов. Сырые SQL-запросы к индексу:
`ast-index query "SELECT ..."` (только SELECT/WITH/EXPLAIN).

## References

- `references/rust-commands.md` — структуры, трейты, impl-блоки, макросы
- `references/typescript-commands.md` — React/TS: компоненты, хуки, NestJS
