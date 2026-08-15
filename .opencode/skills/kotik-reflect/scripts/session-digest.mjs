#!/usr/bin/env node
// session-digest.mjs — экстрактор дайджеста сессий opencode для reflect-механизма.
// Read-only. Детерминированная предфильтрация: LLM сырые транскрипты не читает.
//
// Использование:
//   node session-digest.mjs [sessionID]            сессия + всё поддерево детей (дефолт: текущая)
//   node session-digest.mjs --days N               все сессии проекта за N дней (пачки деревьев)
//   node session-digest.mjs --session ID --from MSG --to MSG   срез для drill-down
//   node session-digest.mjs --budget BYTES         общий бюджет дайджеста (дефолт 40000)
//   node session-digest.mjs --db PATH              путь к БД opencode (или env OPENCODE_DB)
//   node session-digest.mjs --phrases PATH         файл фраз коррекций (дефолт: ../correction-phrases.txt)
//
// Фразы коррекций калибруются под пользователя в correction-phrases.txt
// (данные, не код). Если файл отсутствует — используются встроенные дефолты.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(os.homedir(), ".local/share/opencode/opencode.db");
const DEFAULT_PHRASES_PATH = path.join(SCRIPT_DIR, "..", "correction-phrases.txt");

const SESSION_CAP = 4000;       // мягкий потолок байт на секцию сессии
const TOTAL_BUDGET = 40000;     // общий потолок дайджеста
const SLICE_BUDGET = 20000;     // потолок в режиме среза
const TEXT_SNIPPET = 500;       // усечение текстовых партсов
const ERROR_SNIPPET = 200;      // усечение ошибок tool
const LOOP_MIN = 3;             // повторов подряд = петля
const STREAK_MIN = 10;          // tool-вызовов без юзера = подозрительная серия

// Дефолтные фразы коррекций — отправная точка, если нет correction-phrases.txt.
const DEFAULT_PHRASES = [
  "не так", "откати", "я просил", "мне не нравится", "как так",
  "стоп", "зачем", "не надо", "не нужно", "ты опять", "хватит", "прекрати",
  "wrong", "revert", "that's not what", "not what i",
];
const DEFAULT_WORDS = ["нет", "нет,", "no", "stop"];

// Формат файла: одна фраза на строку; префикс "=" — точное слово (не подстрока);
// "#" — комментарий. Пустые строки игнорируются.
function loadPhrases(phrasesPath) {
  if (!existsSync(phrasesPath)) return { phrases: DEFAULT_PHRASES, words: DEFAULT_WORDS, source: "встроенные дефолты" };
  const phrases = [], words = [];
  for (const raw of readFileSync(phrasesPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("=")) words.push(line.slice(1).trim());
    else phrases.push(line);
  }
  return { phrases, words, source: phrasesPath };
}

function parseArgs(argv, env = process.env) {
  const args = {
    days: null, session: null, from: null, to: null,
    budget: TOTAL_BUDGET, positional: null,
    db: env.OPENCODE_DB || DEFAULT_DB_PATH,
    phrases: DEFAULT_PHRASES_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") args.days = Number(argv[++i]);
    else if (a === "--session") args.session = argv[++i];
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--budget") args.budget = Number(argv[++i]);
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--phrases") args.phrases = argv[++i];
    else if (a === "--help" || a === "-h") { console.log("Usage: session-digest.mjs [sessionID] [--days N] [--session ID --from MSG --to MSG] [--budget BYTES] [--db PATH] [--phrases PATH]"); process.exit(0); }
    else if (!a.startsWith("--")) args.positional = a;
  }
  if (args.positional && !args.session) args.session = args.positional;
  return args;
}

function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
function sigHash(tool, input) {
  return createHash("sha1").update(tool + "|" + stableStringify(input ?? null)).digest("hex").slice(0, 10);
}
function clip(s, n) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n) + "…[+" + (s.length - n) + " ch]";
}
function esc(s) { return String(s ?? ""); }

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function makeMatchers({ phrases, words }) {
  return {
    phraseRe: phrases.map(p => new RegExp(escapeRe(p), "i")),
    wordRe: words.map(w => new RegExp("(^|[^\\p{L}])" + escapeRe(w) + "([^\\p{L}]|$)", "iu")),
  };
}
function isCorrection(text, matchers) {
  if (!text) return false;
  return matchers.phraseRe.some(r => r.test(text)) || matchers.wordRe.some(r => r.test(text));
}

function openDb(dbPath) {
  try { return new DatabaseSync(dbPath, { readOnly: true }); }
  catch (e) { console.error("Не могу открыть БД " + dbPath + ": " + e.message); process.exit(1); }
}

function findCurrentSession(db) {
  const cwd = process.cwd();
  const row = db.prepare(
    "SELECT id FROM session WHERE parent_id IS NULL AND directory = ? ORDER BY time_updated DESC LIMIT 1"
  ).get(cwd);
  if (row) return { id: row.id, note: null };
  const any = db.prepare("SELECT id, directory FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 1").get();
  if (any) return { id: any.id, note: "сессия для cwd=" + cwd + " не найдена; взята последняя (" + any.directory + ")" };
  console.error("Сессий не найдено."); process.exit(1);
}

function treeIds(db, rootId) {
  const rows = db.prepare(
    "WITH RECURSIVE tree(id) AS (SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id) SELECT id FROM tree"
  ).all(rootId);
  return rows.map(r => r.id);
}

function rootsForDays(db, days, cwd) {
  const since = Date.now() - days * 86400000;
  return db.prepare(
    "SELECT id FROM session WHERE parent_id IS NULL AND directory = ? AND time_updated >= ? ORDER BY time_updated DESC"
  ).all(cwd, since).map(r => r.id);
}

function loadSession(db, id) {
  const s = db.prepare("SELECT * FROM session WHERE id = ?").get(id);
  if (!s) return null;
  const msgs = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id").all(id)
    .map(m => ({ ...m, data: JSON.parse(m.data) }));
  const parts = db.prepare("SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id").all(id)
    .map(p => ({ ...p, data: JSON.parse(p.data) }));
  return { s, msgs, parts };
}

function analyze(sess, matchers) {
  const { s, msgs, parts } = sess;
  const msgRole = new Map(msgs.map(m => [m.id, m.data.role]));
  const textParts = parts.filter(p => p.data.type === "text");
  const toolParts = parts.filter(p => p.data.type === "tool");

  const userTexts = textParts
    .filter(p => msgRole.get(p.message_id) === "user")
    .map(p => ({ msgId: p.message_id, partId: p.id, time: p.time_created, text: p.data.text ?? "" }))
    .filter(u => u.text.trim());

  const assistantTexts = textParts
    .filter(p => msgRole.get(p.message_id) === "assistant")
    .map(p => ({ msgId: p.message_id, text: p.data.text ?? "" }))
    .filter(a => a.text.trim());

  // Коррекции: user-текст с матчем фразы + ближайший ассистент-текст до/после.
  // Первое сообщение дочерней сессии — это бриф от родителя, не фидбек: пропускаем.
  const corrections = [];
  const isChild = Boolean(s.parent_id);
  for (const u of userTexts) {
    if (isChild && u === userTexts[0]) continue;
    if (!isCorrection(u.text, matchers)) continue;
    const before = [...assistantTexts].reverse().find(a => a.msgId < u.msgId);
    const after = assistantTexts.find(a => a.msgId > u.msgId);
    corrections.push({
      msgId: u.msgId,
      user: clip(u.text, TEXT_SNIPPET),
      ctxBefore: before ? clip(before.text, 200) : null,
      ctxAfter: after ? clip(after.text, 200) : null,
    });
  }

  // Tool-ошибки.
  const errors = toolParts
    .filter(p => p.data.state && (p.data.state.error || p.data.state.status === "error"))
    .map(p => ({
      msgId: p.message_id,
      tool: p.data.tool,
      sig: sigHash(p.data.tool, p.data.state?.input),
      error: clip(p.data.state.error ?? p.data.state.output, ERROR_SNIPPET),
    }));

  // Петли: ≥LOOP_MIN одинаковых подряд; чередование A-B-A-B (длина ≥4).
  const sigSeq = toolParts.map(p => ({ sig: sigHash(p.data.tool, p.data.state?.input), tool: p.data.tool, input: p.data.state?.input, msgId: p.message_id }));
  const loops = [];
  let i = 0;
  while (i < sigSeq.length) {
    let j = i + 1;
    while (j < sigSeq.length && sigSeq[j].sig === sigSeq[i].sig) j++;
    if (j - i >= LOOP_MIN) loops.push({ kind: "repeat", tool: sigSeq[i].tool, count: j - i, input: clip(stableStringify(sigSeq[i].input), 120), msgId: sigSeq[i].msgId });
    i = j;
  }
  for (let k = 0; k + 3 < sigSeq.length; k++) {
    const [a, b, c, d] = [sigSeq[k], sigSeq[k+1], sigSeq[k+2], sigSeq[k+3]];
    if (a.sig !== b.sig && a.sig === c.sig && b.sig === d.sig) {
      if (!loops.some(l => l.kind === "cycle" && l.msgId === a.msgId))
        loops.push({ kind: "cycle", tool: a.tool + "↔" + b.tool, count: 4, input: "", msgId: a.msgId });
    }
  }

  // Серии >STREAK_MIN tool-партсов без единого текста (ни ассистента, ни юзера).
  // Любой текст обрывает серию; кто оборвал — сигнал: юзер = вероятное прерывание.
  const streaks = [];
  let run = 0, runStart = null;
  for (const p of parts) {
    if (p.data.type === "tool") { if (run === 0) runStart = p; run++; }
    else if (p.data.type === "text") {
      if (run > STREAK_MIN) streaks.push({ count: run, msgId: runStart.message_id, brokenBy: msgRole.get(p.message_id) ?? "?", text: clip(p.data.text, 150) });
      run = 0;
    }
  }

  // Повторяющиеся одинаковые ошибки tool (≥LOOP_MIN подряд) — петля ошибок.
  const errSeq = toolParts.filter(p => p.data.state?.error || p.data.state?.status === "error");
  const errorLoops = [];
  let e = 0;
  while (e < errSeq.length) {
    const key = errSeq[e].data.tool + "|" + clip(errSeq[e].data.state.error ?? "", 100);
    let j = e + 1;
    while (j < errSeq.length && errSeq[j].data.tool + "|" + clip(errSeq[j].data.state.error ?? "", 100) === key) j++;
    if (j - e >= LOOP_MIN) errorLoops.push({ tool: errSeq[e].data.tool, count: j - e, error: clip(errSeq[e].data.state.error ?? "", 120), msgId: errSeq[e].message_id });
    e = j;
  }

  const hist = {};
  for (const p of toolParts) hist[p.data.tool] = (hist[p.data.tool] ?? 0) + 1;
  const steps = parts.filter(p => p.data.type === "step-finish").length;
  let tokens = 0, cost = 0;
  for (const m of msgs) if (m.data.role === "assistant") { tokens += m.data.tokens?.total ?? 0; cost += m.data.cost ?? 0; }
  const durationMin = Math.round(((s.time_updated ?? 0) - (s.time_created ?? 0)) / 60000);
  const endsOnCorrection = userTexts.length > 0 && isCorrection(userTexts[userTexts.length - 1].text, matchers)
    && !assistantTexts.some(a => a.msgId > userTexts[userTexts.length - 1].msgId);

  return { s, userTexts, corrections, errors, loops, streaks, errorLoops, hist, steps, tokens, cost, durationMin, endsOnCorrection,
           finalText: assistantTexts.length ? clip(assistantTexts[assistantTexts.length - 1].text, TEXT_SNIPPET) : null };
}

function renderSession(a, cap) {
  const s = a.s;
  const L = [];
  const push = (line) => { if (L.join("\n").length < cap) L.push(line); };
  push("## " + esc(s.title) + "  `" + s.id + "`");
  push("- агент: " + esc(s.agent ?? "?") + (s.parent_id ? " (дочерняя от " + s.parent_id + ")" : " (корневая)"));
  push("- статистика: шагов " + a.steps + ", tool-вызовов " + Object.values(a.hist).reduce((x, y) => x + y, 0)
    + ", токенов " + a.tokens + ", ~" + a.durationMin + " мин"
    + (s.time_compacting ? ", **была компакция**" : ""));
  const histStr = Object.entries(a.hist).sort((x, y) => y[1] - x[1]).map(([t, n]) => t + "×" + n).join(", ");
  if (histStr) push("- инструменты: " + histStr);
  if (a.endsOnCorrection) push("- **сессия кончается коррекцией без ответа ассистента**");

  if (a.corrections.length) {
    push("- коррекции пользователя (" + a.corrections.length + "):");
    for (const c of a.corrections) {
      push("  - [" + c.msgId + "] «" + esc(c.user) + "»");
      if (c.ctxBefore) push("    - до: " + esc(c.ctxBefore));
      if (c.ctxAfter) push("    - после: " + esc(c.ctxAfter));
    }
  }
  if (a.errors.length) {
    push("- tool-ошибки (" + a.errors.length + "):");
    for (const e of a.errors.slice(0, 10)) push("  - [" + e.msgId + "] " + e.tool + " (sig " + e.sig + "): " + esc(e.error));
    if (a.errors.length > 10) push("  - …ещё " + (a.errors.length - 10));
  }
  if (a.loops.length) {
    push("- петли (" + a.loops.length + "):");
    for (const l of a.loops) push("  - [" + l.msgId + "] " + l.kind + " " + l.tool + " ×" + l.count + (l.input ? " " + esc(l.input) : ""));
  }
  if (a.errorLoops.length) {
    push("- петли ошибок (" + a.errorLoops.length + "):");
    for (const l of a.errorLoops) push("  - [" + l.msgId + "] " + l.tool + " ×" + l.count + ": " + esc(l.error));
  }
  if (a.streaks.length) {
    push("- длинные серии вызовов без текстов (" + a.streaks.length + "):");
    for (const st of a.streaks) push("  - [" + st.msgId + "] " + st.count + " вызовов, оборвал «" + st.brokenBy + "»: " + esc(st.text));
  }
  if (a.userTexts.length) {
    push("- сообщения пользователя (" + a.userTexts.length + "):");
    for (const u of a.userTexts.slice(0, 12)) push("  - [" + u.msgId + "] " + clip(u.text, 250));
    if (a.userTexts.length > 12) push("  - …ещё " + (a.userTexts.length - 12));
  }
  if (a.finalText) push("- финальный текст ассистента: " + esc(a.finalText));
  const out = L.join("\n");
  return out.length >= cap ? out + "\n- …секция усечена по лимиту " + cap + "B; drill-down: --session " + s.id + " --from <msgID> --to <msgID>" : out;
}

function renderSlice(db, sessionId, fromId, toId, budget) {
  const sess = loadSession(db, sessionId);
  if (!sess) { console.error("Сессия не найдена: " + sessionId); process.exit(1); }
  const msgRole = new Map(sess.msgs.map(m => [m.id, m.data.role]));
  const order = new Map(sess.msgs.map((m, idx) => [m.id, idx]));
  const fromIdx = fromId ? (order.get(fromId) ?? 0) : 0;
  const toIdx = toId ? (order.get(toId) ?? sess.msgs.length - 1) : sess.msgs.length - 1;
  const L = ["# Срез сессии " + sessionId + " (сообщения " + fromIdx + "–" + toIdx + ")"];
  for (const m of sess.msgs.slice(fromIdx, toIdx + 1)) {
    const role = msgRole.get(m.id) ?? "?";
    const mParts = sess.parts.filter(p => p.message_id === m.id && (p.data.type === "text" || p.data.type === "tool"));
    if (!mParts.length) continue;
    L.push("\n### [" + m.id + "] " + role);
    for (const p of mParts) {
      if (p.data.type === "text") L.push(clip(p.data.text, 4000));
      else {
        const st = p.data.state ?? {};
        L.push("[tool " + p.data.tool + " " + (st.status ?? "?") + "] input: " + clip(stableStringify(st.input), 400)
          + (st.error ? "\nERROR: " + clip(st.error, 1000) : "\noutput: " + clip(st.output, 2000)));
      }
    }
    if (L.join("\n").length > budget) { L.push("\n…срез усечён по бюджету " + budget + "B"); break; }
  }
  return L.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const matchers = makeMatchers(loadPhrases(args.phrases));
  const db = openDb(args.db);

  if (args.session && (args.from || args.to)) {
    console.log(renderSlice(db, args.session, args.from, args.to, args.budget === TOTAL_BUDGET ? SLICE_BUDGET : args.budget));
    return;
  }

  let rootIds = [], note = null;
  if (args.days) {
    rootIds = rootsForDays(db, args.days, process.cwd());
    if (!rootIds.length) { console.error("Сессий за " + args.days + " дн. для " + process.cwd() + " не найдено."); process.exit(1); }
  } else if (args.session) {
    rootIds = [args.session];
  } else {
    const cur = findCurrentSession(db);
    rootIds = [cur.id]; note = cur.note;
  }

  const sections = [];
  let totalSessions = 0;
  for (const rootId of rootIds) {
    for (const id of treeIds(db, rootId)) {
      const sess = loadSession(db, id);
      if (!sess) continue;
      totalSessions++;
      sections.push(renderSession(analyze(sess, matchers), SESSION_CAP));
    }
  }

  let out = "# Дайджест сессий\n\nСкоуп: " + (args.days ? "последние " + args.days + " дн." : "сессия + дочерние")
    + "; сессий: " + totalSessions + "; бюджет " + args.budget + "B. Drill-down: `--session <id> --from <msgID> --to <msgID>`.\n";
  if (note) out += "\n> Внимание: " + note + "\n";
  for (const sec of sections) {
    if ((out + "\n\n" + sec).length > args.budget) {
      out += "\n\n…дайджест усечён по бюджету; сессий не показано: " + (sections.length - out.split("## ").length + 1)
        + ". Сузьте скоуп (--days меньше) или поднимите --budget.";
      break;
    }
    out += "\n\n" + sec;
  }
  console.log(out);
}

main();
