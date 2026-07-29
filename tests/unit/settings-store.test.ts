import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Управляемое состояние safeStorage — поведение задаётся per-test.
const mockState = vi.hoisted(() => ({ encryptionAvailable: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const text = buf.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('bad blob')
      return text.slice(4)
    }
  }
}))

let storePath: string
vi.mock('../../src/main/paths', () => ({
  dataPaths: {
    get settingsPath(): string {
      return storePath
    }
  }
}))

const { SettingsStore } = await import('../../src/main/settings-store')

describe('SettingsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kotik-unit-settings-'))
    storePath = join(dir, 'settings.json')
    mockState.encryptionAvailable = false
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('дефолты при отсутствии файла', () => {
    const store = new SettingsStore()
    expect(store.isEncryptionAvailable()).toBe(false)
    expect(store.get()).toEqual({ providers: {}, customProviders: [], defaultModel: undefined })
  })

  it('set/get roundtrip с plaintext-ключами и файлом 0600', () => {
    const store = new SettingsStore()
    store.set({
      providers: { deepseek: { apiKey: 'sk-test', baseUrl: 'https://api.example' } },
      customProviders: [],
      defaultModel: { providerId: 'deepseek', modelId: 'deepseek-v4-pro' }
    })
    expect(statSync(storePath).mode & 0o777).toBe(0o600)
    expect(readFileSync(storePath, 'utf-8')).toContain('sk-test') // нет шифрования — plaintext

    const reread = new SettingsStore()
    expect(reread.get().providers.deepseek).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example'
    })
    expect(reread.get().defaultModel).toEqual({ providerId: 'deepseek', modelId: 'deepseek-v4-pro' })
  })

  it('при доступном шифровании ключ не лежит в файле открытым текстом', () => {
    mockState.encryptionAvailable = true
    const store = new SettingsStore()
    expect(store.isEncryptionAvailable()).toBe(true)
    store.set({
      providers: { deepseek: { apiKey: 'sk-secret' } },
      customProviders: [],
      defaultModel: undefined
    })
    const raw = readFileSync(storePath, 'utf-8')
    expect(raw).not.toContain('sk-secret')
    expect(raw).toContain(Buffer.from('enc:sk-secret', 'utf-8').toString('base64'))

    const reread = new SettingsStore()
    expect(reread.get().providers.deepseek.apiKey).toBe('sk-secret')
  })

  it('битый зашифрованный ключ → apiKey undefined, остальное читается', () => {
    mockState.encryptionAvailable = true
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        encrypted: true,
        apiKeys: { deepseek: Buffer.from('garbage', 'utf-8').toString('base64') },
        baseUrls: { deepseek: 'https://api.example' },
        customProviders: []
      })
    )
    const store = new SettingsStore()
    expect(store.get().providers.deepseek.apiKey).toBeUndefined()
    expect(store.get().providers.deepseek.baseUrl).toBe('https://api.example')
  })

  it('файл неизвестной версии игнорируется → дефолты', () => {
    writeFileSync(storePath, JSON.stringify({ version: 2, apiKeys: { x: 'y' } }))
    expect(new SettingsStore().get()).toEqual({
      providers: {},
      customProviders: [],
      defaultModel: undefined
    })
  })

  it('get возвращает копию — мутация не протекает в хранилище', () => {
    const store = new SettingsStore()
    const snapshot = store.get()
    snapshot.providers.evil = { apiKey: 'x' }
    expect(store.get().providers).toEqual({})
  })
})
