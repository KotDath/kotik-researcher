import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, CurrentProject } from '../../shared/ipc'
import ProjectPicker from './components/ProjectPicker'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsView from './components/SettingsView'

type View = 'loading' | 'picker' | 'main'

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('loading')
  const [project, setProject] = useState<CurrentProject | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [chatsVersion, setChatsVersion] = useState(0)
  const chatEventListeners = useRef(new Set<(e: ChatEvent) => void>())

  useEffect(() => {
    void window.api.projects.getCurrent().then(async (p) => {
      if (p) {
        setProject(p)
        setActiveChat(await window.api.chats.getActive())
        setView('main')
      } else {
        setView('picker')
      }
    })
  }, [])

  useEffect(() => {
    return window.api.events.onProjectChanged((p) => {
      setProject(p)
      setSettingsOpen(false)
      void window.api.chats.getActive().then(setActiveChat)
      setChatsVersion((v) => v + 1)
      setView('main')
    })
  }, [])

  useEffect(() => {
    return window.api.events.onChatEvent((e) => {
      for (const listener of chatEventListeners.current) listener(e)
      // lifecycle-события любого чата меняют список (порядок, индикатор генерации)
      if (e.type === 'agent_start' || e.type === 'agent_end' || e.type === 'error') {
        setChatsVersion((v) => v + 1)
      }
    })
  }, [])

  const registerChatListener = useCallback((listener: (e: ChatEvent) => void) => {
    chatEventListeners.current.add(listener)
    return () => chatEventListeners.current.delete(listener)
  }, [])

  const refreshChats = useCallback(() => setChatsVersion((v) => v + 1), [])

  if (view === 'loading') {
    return <main className="app-loading">Загрузка…</main>
  }

  return (
    <div className="app">
      {view === 'picker' ? (
        <ProjectPicker onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        project && (
          <div className="app-main">
            <Sidebar
              key={project.path}
              project={project}
              activeChat={activeChat}
              chatsVersion={chatsVersion}
              onSelectChat={setActiveChat}
              onChangeProject={() => setView('picker')}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            {activeChat ? (
              <ChatArea
                key={activeChat}
                file={activeChat}
                registerListener={registerChatListener}
                onFeedChanged={refreshChats}
              />
            ) : (
              <main className="chat-empty">Нет активного чата</main>
            )}
          </div>
        )
      )}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
