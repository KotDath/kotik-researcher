import { useEffect, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import { experimentDays, findDay } from './experiments.ts'
import { parseHash, routeToHash, type Route } from './router.ts'
import './App.css'

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

function App() {
  const route = useHashRoute()
  const experimentsActive = route.name === 'experiments' || route.name === 'day'

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand brand--link" href={routeToHash({ name: 'home' })}>
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>kotik-researcher</span>
        </a>
        <nav className="topnav" aria-label="Разделы">
          <a
            href={routeToHash({ name: 'home' })}
            aria-current={route.name === 'home' ? 'page' : undefined}
          >
            Главная
          </a>
          <a
            href={routeToHash({ name: 'experiments' })}
            aria-current={experimentsActive ? 'page' : undefined}
          >
            Эксперименты
          </a>
        </nav>
      </header>

      {route.name === 'home' && (
        <ChatPanel
          eyebrow="DAY 01 / STATELESS CHAT"
          title={<>Один вопрос.<br />Один ответ.</>}
          description="Следующий запрос заменит текущий. История не сохраняется и не отправляется модели."
          emptyHint="Задайте первый вопрос DeepSeek V4 Flash"
          inputId="question"
        />
      )}
      {route.name === 'experiments' && <ExperimentsList />}
      {route.name === 'day' && <DayPage dayId={route.dayId} />}
    </div>
  )
}

function ExperimentsList() {
  return (
    <main className="workspace">
      <section className="intro">
        <p className="eyebrow">Челлендж / Эксперименты</p>
        <h1>Мои<br />эксперименты.</h1>
        <p className="intro-copy">
          Каждый день челленджа — отдельный эксперимент. Выбирай день и пробуй:
          всё работает на том же движке, что и главный чат.
        </p>
      </section>

      <section className="day-list" aria-label="Дни челленджа">
        {experimentDays.map((day) =>
          day.status === 'available' ? (
            <a
              key={day.id}
              className="day-card"
              href={routeToHash({ name: 'day', dayId: day.id })}
            >
              <span className="day-card__index" aria-hidden="true">{day.index}</span>
              <span className="day-card__body">
                <span className="day-card__title">{day.title}</span>
                <span className="day-card__subtitle">{day.subtitle}</span>
              </span>
              <span className="day-card__badge">Открыт ↗</span>
            </a>
          ) : (
            <div key={day.id} className="day-card day-card--soon" aria-disabled="true">
              <span className="day-card__index" aria-hidden="true">{day.index}</span>
              <span className="day-card__body">
                <span className="day-card__title">{day.title}</span>
                <span className="day-card__subtitle">{day.subtitle}</span>
              </span>
              <span className="day-card__badge">Скоро</span>
            </div>
          ),
        )}
      </section>
    </main>
  )
}

function DayPage({ dayId }: { dayId: string }) {
  const day = findDay(dayId)
  if (!day || day.status !== 'available') {
    return <ExperimentsList />
  }

  return (
    <ChatPanel
      eyebrow="Эксперименты / День 01"
      title={<>Один вопрос.<br />Один ответ.</>}
      description="Тот же stateless-чат, что и на главной: следующий запрос заменит текущий, история не сохраняется."
      emptyHint="Задайте первый вопрос DeepSeek V4 Flash"
      inputId="day-question"
      backHref={routeToHash({ name: 'experiments' })}
      backLabel="Все эксперименты"
    />
  )
}

export default App
