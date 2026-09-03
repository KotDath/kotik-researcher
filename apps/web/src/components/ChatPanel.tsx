import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { streamChat } from '../chat'

type Phase = 'idle' | 'connecting' | 'reasoning' | 'answering' | 'done' | 'stopped' | 'error'

interface Exchange {
  question: string
  reasoning: string
  answer: string
}

const phaseLabels: Record<Phase, string> = {
  idle: 'Готов к вопросу',
  connecting: 'Подключаемся к DeepSeek',
  reasoning: 'DeepSeek рассуждает',
  answering: 'Формируем ответ',
  done: 'Ответ готов',
  stopped: 'Генерация остановлена',
  error: 'Ошибка запроса',
}

interface ChatPanelProps {
  eyebrow: string
  title: ReactNode
  description: string
  emptyHint: string
  inputId: string
  backHref?: string
  backLabel?: string
}

function ChatPanel({
  eyebrow,
  title,
  description,
  emptyHint,
  inputId,
  backHref,
  backLabel,
}: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const [exchange, setExchange] = useState<Exchange | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  const isStreaming = phase === 'connecting' || phase === 'reasoning' || phase === 'answering'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentQuestion = question.trim()
    if (!currentQuestion || isStreaming) {
      return
    }

    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller

    setQuestion('')
    setExchange({ question: currentQuestion, reasoning: '', answer: '' })
    setError('')
    setReasoningOpen(false)
    setPhase('connecting')

    let receivedReasoning = false
    let receivedAnswer = false

    try {
      await streamChat(currentQuestion, controller.signal, {
        onReasoning(delta) {
          if (activeRequest.current !== controller) {
            return
          }
          if (!receivedReasoning) {
            receivedReasoning = true
            setReasoningOpen(true)
            setPhase('reasoning')
          }
          setExchange((current) =>
            current ? { ...current, reasoning: current.reasoning + delta } : current,
          )
        },
        onAnswer(delta) {
          if (activeRequest.current !== controller) {
            return
          }
          if (!receivedAnswer) {
            receivedAnswer = true
            setReasoningOpen(false)
            setPhase('answering')
          }
          setExchange((current) =>
            current ? { ...current, answer: current.answer + delta } : current,
          )
        },
      })
      if (activeRequest.current === controller) {
        setPhase('done')
      }
    } catch (requestError: unknown) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setError(requestError instanceof Error ? requestError.message : 'Неизвестная ошибка')
        setPhase('error')
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
      }
    }
  }

  const stop = () => {
    activeRequest.current?.abort()
    activeRequest.current = null
    setPhase('stopped')
  }

  const handleQuestionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <main className="workspace">
      <section className="intro">
        {backHref && (
          <a className="back-link" href={backHref}>
            ← {backLabel ?? 'Назад'}
          </a>
        )}
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="intro-copy">{description}</p>
      </section>

      <section className="conversation" aria-live="polite">
        <div className={`chat-status runtime-status runtime-status--${phase}`}>
          <span className="runtime-dot" aria-hidden="true" />
          {phaseLabels[phase]}
        </div>

        {!exchange && (
          <div className="empty-state">
            <span>01</span>
            <p>{emptyHint}</p>
          </div>
        )}

        {exchange && (
          <div className="exchange">
            <article className="message message--question">
              <p className="message-role">Вопрос</p>
              <p className="message-text">{exchange.question}</p>
            </article>

            {exchange.reasoning && (
              <details
                className="reasoning"
                open={reasoningOpen}
                onToggle={(event) => setReasoningOpen(event.currentTarget.open)}
              >
                <summary>Ход рассуждений</summary>
                <p>{exchange.reasoning}</p>
              </details>
            )}

            <article className="message message--answer">
              <p className="message-role">Ответ</p>
              {exchange.answer ? (
                <p className="message-text">{exchange.answer}</p>
              ) : (
                <p className="message-placeholder">
                  {phase === 'error'
                    ? 'Ответ не получен'
                    : phase === 'stopped'
                      ? 'Генерация остановлена'
                      : 'Ожидаем финальный ответ…'}
                </p>
              )}
            </article>

            {error && <p className="error-message" role="alert">{error}</p>}
          </div>
        )}
      </section>

      <form className="composer" onSubmit={submit}>
        <label htmlFor={inputId}>Ваш вопрос</label>
        <textarea
          id={inputId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleQuestionKeyDown}
          placeholder="Спросите что-нибудь…"
          rows={3}
        />
        <div className="composer-footer">
          <span>Enter — отправить · Shift+Enter — новая строка</span>
          {isStreaming ? (
            <button className="button button--stop" type="button" onClick={stop}>
              Остановить
            </button>
          ) : (
            <button className="button button--send" type="submit" disabled={!question.trim()}>
              Спросить <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </form>
    </main>
  )
}

export default ChatPanel
