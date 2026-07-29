import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// paths.ts при импорте дёргает electron.app — подменяем модуль целиком,
// направляя хранилище во временную директорию.
let storePath: string
vi.mock('../../src/main/paths', () => ({
  dataPaths: {
    get recentProjectsPath(): string {
      return storePath
    }
  }
}))

const { RecentProjectsStore } = await import('../../src/main/recent-projects')

describe('RecentProjectsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kotik-unit-recent-'))
    storePath = join(dir, 'recent-projects.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('пустое хранилище → пустой список', () => {
    expect(new RecentProjectsStore().list()).toEqual([])
  })

  it('touch добавляет проект и поднимает повторное открытие наверх без дублей', () => {
    vi.useFakeTimers()
    try {
      const store = new RecentProjectsStore()
      vi.setSystemTime(1_000)
      store.touch(join(dir, 'alpha'))
      vi.setSystemTime(2_000)
      store.touch(join(dir, 'beta'))
      vi.setSystemTime(3_000)
      store.touch(join(dir, 'alpha'))
      const list = store.list()
      expect(list.map((p) => p.name)).toEqual(['alpha', 'beta'])
      expect(list).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('list сортирует по lastOpenedAt убыванию и выставляет available', () => {
    vi.useFakeTimers()
    try {
      const store = new RecentProjectsStore()
      vi.setSystemTime(1_000)
      store.touch(dir) // существующая директория
      vi.setSystemTime(2_000)
      store.touch(join(dir, 'ghost')) // несуществующая
      const list = store.list()
      expect(list).toHaveLength(2)
      expect(list[0].available).toBe(false) // ghost — новее
      expect(list[1].available).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remove убирает проект из списка, директория остаётся', () => {
    const store = new RecentProjectsStore()
    store.touch(dir)
    store.remove(dir)
    expect(store.list()).toEqual([])
  })

  it('персистентность: новый инстанс читает записанный файл', () => {
    new RecentProjectsStore().touch(dir)
    const reread = new RecentProjectsStore().list()
    expect(reread.map((p) => p.path)).toEqual([dir])
  })

  it('битый файл → пустой список, а не падение', () => {
    writeFileSync(storePath, 'not json at all')
    expect(new RecentProjectsStore().list()).toEqual([])
  })

  it('файл чужой версии игнорируется', () => {
    writeFileSync(storePath, JSON.stringify({ version: 99, projects: [{ path: '/x', lastOpenedAt: 1 }] }))
    expect(new RecentProjectsStore().list()).toEqual([])
  })
})
