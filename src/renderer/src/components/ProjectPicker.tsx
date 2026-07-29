import { useCallback, useEffect, useState } from 'react'
import type { RecentProject } from '../../../shared/ipc'

interface Props {
  onOpenSettings: () => void
}

function ProjectPicker({ onOpenSettings }: Props): React.JSX.Element {
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const refresh = useCallback(async () => {
    setProjects(await window.api.projects.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openDialog = async (): Promise<void> => {
    setError(null)
    const res = await window.api.projects.openDialog()
    if (!res.ok) setError(res.error)
  }

  const openProject = async (p: RecentProject): Promise<void> => {
    setError(null)
    if (!p.available) {
      setError(`Директория «${p.path}» недоступна (удалена или перемещена)`)
      return
    }
    const res = await window.api.projects.open(p.path)
    if (!res.ok) setError(res.error)
  }

  const startCreate = async (): Promise<void> => {
    setError(null)
    const parent = await window.api.projects.pickParent()
    if (parent) {
      setParentDir(parent)
      setCreating(true)
    }
  }

  const confirmCreate = async (): Promise<void> => {
    if (!parentDir) return
    const res = await window.api.projects.create(parentDir, newName)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreating(false)
    setNewName('')
    setParentDir(null)
  }

  const remove = async (path: string): Promise<void> => {
    setProjects(await window.api.projects.removeFromList(path))
  }

  return (
    <main className="picker" data-testid="project-picker">
      <h1 className="picker-title">Kotik Researcher</h1>
      <p className="picker-subtitle">Откройте или создайте проект — директорию для исследования</p>

      <div className="picker-actions">
        <button
          className="btn btn-primary"
          data-testid="open-project-button"
          onClick={() => void openDialog()}
        >
          Открыть проект…
        </button>
        <button className="btn" data-testid="create-project-button" onClick={() => void startCreate()}>
          Создать проект…
        </button>
        <button className="btn btn-ghost" data-testid="picker-settings-button" onClick={onOpenSettings}>
          Настройки
        </button>
      </div>

      {creating && parentDir && (
        <form
          className="picker-create"
          data-testid="create-project-form"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmCreate()
          }}
        >
          <div className="picker-create-parent" data-testid="create-form-parent">
            Новая папка в: <code>{parentDir}</code>
          </div>
          <input
            autoFocus
            className="input"
            data-testid="project-name-input"
            placeholder="Имя проекта"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="picker-create-buttons">
            <button
              className="btn btn-primary"
              data-testid="confirm-create-button"
              type="submit"
              disabled={!newName.trim()}
            >
              Создать
            </button>
            <button className="btn" type="button" onClick={() => setCreating(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {error && <div className="picker-error" data-testid="picker-error">{error}</div>}

      {projects.length > 0 && (
        <ul className="picker-list" data-testid="recent-projects-list">
          {projects.map((p) => (
            <li
              key={p.path}
              className={`picker-item ${p.available ? '' : 'unavailable'}`}
              data-testid="recent-project-item"
            >
              <button
                className="picker-item-main"
                data-testid="recent-project-open"
                onClick={() => void openProject(p)}
              >
                <span className="picker-item-name">
                  {p.name}
                  {!p.available && <span className="badge-unavailable">недоступен</span>}
                </span>
                <span className="picker-item-path">{p.path}</span>
              </button>
              <button
                className="btn btn-ghost picker-item-remove"
                title="Убрать из списка (директория не удаляется)"
                onClick={() => void remove(p.path)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

export default ProjectPicker
