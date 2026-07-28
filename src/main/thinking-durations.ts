import { join } from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './json-file'
import { dataPaths } from './paths'

type DurationsData = Record<string, Record<string, number>>

/**
 * Sidecar-хранилище длительностей reasoning (design.md, решение 3): pi SDK
 * пишет текст thinking в jsonl-сессию, но не длительность. Ключ —
 * (sessionFile, messageTimestamp, contentIndex): contentIndex повторяется в
 * каждом assistant-сообщении, поэтому нужна идентичность сообщения; timestamp
 * сообщения создаётся один раз при старте стрима и персистируется в jsonl
 * (подтверждено спайком). Отсутствие записи = блок без длительности
 * (деградация, не ошибка).
 */
export class ThinkingDurationsStore {
  private readonly path = join(dataPaths.userData, 'thinking-durations.json')
  private cache: DurationsData | null = null

  private load(): DurationsData {
    if (!this.cache) this.cache = readJsonFile(this.path, {} as DurationsData)
    return this.cache
  }

  private key(messageTimestamp: number, contentIndex: number): string {
    return `${messageTimestamp}:${contentIndex}`
  }

  record(
    sessionFile: string,
    messageTimestamp: number,
    contentIndex: number,
    durationMs: number
  ): void {
    const data = this.load()
    this.cache = {
      ...data,
      [sessionFile]: {
        ...(data[sessionFile] ?? {}),
        [this.key(messageTimestamp, contentIndex)]: durationMs
      }
    }
    writeJsonFileAtomic(this.path, this.cache)
  }

  get(sessionFile: string, messageTimestamp: number, contentIndex: number): number | undefined {
    return this.load()[sessionFile]?.[this.key(messageTimestamp, contentIndex)]
  }

  removeSession(sessionFile: string): void {
    const data = this.load()
    if (!(sessionFile in data)) return
    this.cache = { ...data }
    delete this.cache[sessionFile]
    writeJsonFileAtomic(this.path, this.cache)
  }
}
