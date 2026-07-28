import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { dataPaths } from './paths'
import { readJsonFile, writeJsonFileAtomic } from './json-file'
import type { RecentProject } from '../shared/ipc'

interface RecentProjectsFile {
  version: 1
  projects: Array<{ path: string; lastOpenedAt: number }>
}

/** Список недавних проектов: JSON в userData, сортировка по дате, без дублей. */
export class RecentProjectsStore {
  private projects: Array<{ path: string; lastOpenedAt: number }> = []

  constructor() {
    const file = readJsonFile<RecentProjectsFile | null>(dataPaths.recentProjectsPath, null)
    if (file?.version === 1 && Array.isArray(file.projects)) {
      this.projects = file.projects.filter((p) => typeof p?.path === 'string')
    }
  }

  list(): RecentProject[] {
    return this.projects
      .slice()
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .map((p) => ({
        path: p.path,
        name: basename(p.path),
        lastOpenedAt: p.lastOpenedAt,
        available: existsSync(p.path)
      }))
  }

  /** Повторное открытие поднимает проект наверх без дублирования. */
  touch(path: string): void {
    this.projects = this.projects.filter((p) => p.path !== path)
    this.projects.push({ path, lastOpenedAt: Date.now() })
    this.persist()
  }

  /** Удаление только из списка — директория на диске не трогается. */
  remove(path: string): void {
    this.projects = this.projects.filter((p) => p.path !== path)
    this.persist()
  }

  private persist(): void {
    const file: RecentProjectsFile = { version: 1, projects: this.projects }
    writeJsonFileAtomic(dataPaths.recentProjectsPath, file)
  }
}
