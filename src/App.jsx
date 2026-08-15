import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import Markdown from "react-markdown";

export default function App() {
  // messages: [{ role: "user" | "assistant", content: string }]
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;

    setError(null);
    setInput("");
    setIsStreaming(true);

    const history = messages;
    // Сразу добавляем сообщение пользователя и пустой пузырь ассистента,
    // в который будем дописывать стримящиеся чанки
    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "assistant", content: "" },
    ]);

    const onChunk = new Channel();
    onChunk.onmessage = (chunk) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: last.content + chunk };
        return next;
      });
    };

    try {
      await invoke("send_message", { history, prompt, onChunk });
    } catch (e) {
      setError(String(e));
      // Убираем пустой пузырь ассистента, если ответ так и не начался
      setMessages((prev) =>
        prev.length && prev[prev.length - 1].content === ""
          ? prev.slice(0, -1)
          : prev,
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="app">
      <header className="header">kotik-researcher · deepseek</header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty">Напишите сообщение, чтобы начать диалог</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" ? (
              m.content === "" && isStreaming ? (
                <span className="typing">…</span>
              ) : (
                <Markdown>{m.content}</Markdown>
              )
            ) : (
              m.content
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {error && <div className="error">{error}</div>}

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)"
          rows={2}
          disabled={isStreaming}
        />
        <button onClick={handleSend} disabled={isStreaming || !input.trim()}>
          {isStreaming ? "…" : "Отправить"}
        </button>
      </footer>
    </div>
  );
}
