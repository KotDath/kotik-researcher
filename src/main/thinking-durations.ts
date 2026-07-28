import { join } from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './json-file'
import { dataPaths } from './paths'

type DurationsData = Record<string, Record<string, number>>

/**
 * Sidecar-хранилище длительностей reasoning (design.md, решение 3): pi SDK
 * пишет текст thinking в jsonl-сессию, но не длительность. Ключ —
 * (sessionFile, contentIndex); отсутствие записи = блок без длительности
 * (деградация, не ошибка).
 */
export class ThinkingDurationsStore {
  private readonly path = join(dataPaths.userData, 'thinking-durations.json')
  private cache: DurationsData | null = null

  private load(): DurationsData {
    if (!this.cache) this.cache = readJsonFile(this.path, {} as DurationsData)
    return this.cache
  }

  record(sessionFile: string, contentIndex: number, durationMs: number): void {
    const data = this.load()
    this.cache = {
      ...data,
      [sessionFile]: { ...(data[sessionFile] ?? {}), [contentIndex]: durationMs }
    }
    writeJsonFileAtomic(this.path, this.cache)
  }

  get(sessionFile: string, contentIndex: number): number | undefined {
    return this.load()[sessionFile]?.[contentIndex]
  }

  removeSession(sessionFile: string): void {
    const data = this.load()
    if (!(sessionFile in data)) return
    this.cache = { ...data }
    delete this.cache[sessionFile]
    writeJsonFileAtomic(this.path, this.cache)
  }
}
