import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonFileAtomic } from '../../src/main/json-file'

describe('json-file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kotik-unit-json-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('отсутствующий файл → fallback', () => {
    expect(readJsonFile(join(dir, 'missing.json'), { a: 1 })).toEqual({ a: 1 })
  })

  it('битый JSON → fallback, а не исключение', () => {
    const path = join(dir, 'broken.json')
    writeJsonFileAtomic(path, { ok: true })
    // ломаем содержимое напрямую
    writeFileSync(path, '{ not json')
    expect(readJsonFile(path, 'fallback')).toBe('fallback')
  })

  it('roundtrip: записанное читается обратно', () => {
    const path = join(dir, 'nested', 'data.json')
    const value = { version: 1, items: ['a', 'b'], nested: { n: 42 } }
    writeJsonFileAtomic(path, value)
    expect(readJsonFile(path, null)).toEqual(value)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(value)
  })

  it('атомарность: после записи не остаётся tmp-файлов', () => {
    const path = join(dir, 'atomic.json')
    writeJsonFileAtomic(path, { x: 1 })
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('mode применяется к итоговому файлу', () => {
    const path = join(dir, 'secret.json')
    writeJsonFileAtomic(path, { key: 'value' }, 0o600)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('создаёт промежуточные директории', () => {
    const path = join(dir, 'a', 'b', 'c', 'deep.json')
    writeJsonFileAtomic(path, { deep: true })
    expect(existsSync(path)).toBe(true)
  })
})
