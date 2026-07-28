import { useCallback, useEffect, useState } from 'react'
import type { ChatSummary, CurrentProject } from '../../../shared/ipc'

interface Props {
  project: CurrentProject
  activeChat: string | null
  chatsVersion: number
  onSelectChat: (file: string) => void
  onChangeProject: () => void
  onOpenSettings: () => void
}

function Sidebar({
  project,
  activeChat,
  chatsVersion,
  onSelectChat,
  onChangeProject,
  onOpenSettings
}: Props): React.JSX.Element {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refresh = useCallback(async () => {
    const list = query.trim() ? await window.api.chats.search(query) : await window.api.chats.list()
    setChats(list)
  }, [query])

  useEffect(() => {
    void refresh()
  }, [refresh, chatsVersion])

  const createChat = async (): Promise<void> => {
    const chat = await window.api.chats.create()
    await refresh()
    onSelectChat(chat.file)
  }

  const select = async (file: string): Promise<void> => {
    const res = await window.api.chats.select(file)
    if (!res.ok) {
      alert(res.error)
      // main отказал (например, session-файл исчез) — не переключаем активный
      // чат в renderer, иначе renderer/main разъедутся; список перечитываем
      await refresh()
      return
    }
    onSelectChat(file)
  }

  const commitRename = async (file: string): Promise<void> => {
    const name = renameValue.trim()
    setRenaming(null)
    if (!name) return
    const res = await window.api.chats.rename(file, name)
    if (!res.ok) alert(res.error)
    await refresh()
  }

  const remove = async (chat: ChatSummary): Promise<void> => {
    if (!confirm(`Удалить чат «${chat.name}»? Файл сессии будет перемещён в корзину.`)) return
    const res = await window.api.chats.delete(chat.file)
    if (!res.ok) {
      alert(res.error)
      return
    }
    // dispose idle-сессии событий не эмитит — список инвалидируем явно,
    // иначе удалённый чат остаётся в списке призраком
    await refresh()
    const active = await window.api.chats.getActive()
    if (active) onSelectChat(active)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-project" title={project.path}>
        <div className="sidebar-project-name">{project.name}</div>
        <div className="sidebar-project-actions">
          <button className="btn btn-ghost btn-sm" onClick={onChangeProject} title="Сменить проект">
            ⇄
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings} title="Настройки">
            ⚙
          </button>
        </div>
      </div>

      <button className="btn btn-primary sidebar-new-chat" onClick={() => void createChat()}>
        + Новый чат
      </button>

      <input
        className="input sidebar-search"
        placeholder="Поиск чатов…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="chat-list">
        {chats.map((chat) => (
          <li
            key={chat.file}
            className={`chat-list-item ${chat.file === activeChat ? 'active' : ''}`}
          >
            {renaming === chat.file ? (
              <input
                autoFocus
                className="input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void commitRename(chat.file)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(chat.file)
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <>
                <button className="chat-list-main" onClick={() => void select(chat.file)}>
                  <span className="chat-list-name">
                    {chat.isGenerating && <span className="chat-generating" title="Генерация…">●</span>}
                    {chat.name}
                  </span>
                  <span className="chat-list-date">
                    {new Date(chat.lastActivity).toLocaleString()}
                  </span>
                </button>
                <span className="chat-list-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Переименовать"
                    onClick={() => {
                      setRenaming(chat.file)
                      setRenameValue(chat.name)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Удалить (в корзину)"
                    onClick={() => void remove(chat)}
                  >
                    ✕
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {chats.length === 0 && <li className="chat-list-empty">Чатов нет</li>}
      </ul>
    </aside>
  )
}

export default Sidebar
