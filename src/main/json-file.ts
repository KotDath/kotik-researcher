import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/** Атомарная запись через tmp + rename — переживает падение посередине записи. */
export function writeJsonFileAtomic(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode })
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, path)
}
