import { safeStorage } from 'electron'
import { chmodSync } from 'node:fs'
import { dataPaths } from './paths'
import { readJsonFile, writeJsonFileAtomic } from './json-file'
import type { AppSettings } from '../shared/ipc'

interface SettingsFileV1 {
  version: 1
  /** false когда safeStorage недоступен — ключи лежат в открытом виде (0600). */
  encrypted: boolean
  /** providerId -> apiKey (base64 safeStorage или plaintext при недоступном шифровании). */
  apiKeys: Record<string, string>
  baseUrls: Record<string, string>
  customProviders: AppSettings['customProviders']
  defaultModel?: { providerId: string; modelId: string }
  thinkingLevels?: AppSettings['thinkingLevels']
}

const DEFAULT_SETTINGS: AppSettings = {
  providers: {},
  customProviders: [],
  defaultModel: undefined
}

/**
 * Ключи хранятся зашифрованными safeStorage (design.md, решение 3).
 * Fallback при недоступном шифровании — plaintext в файле 0600, UI показывает
 * предупреждение (encryptionAvailable=false).
 */
export class SettingsStore {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
  private readonly encryptionAvailable: boolean

  constructor() {
    this.encryptionAvailable = safeStorage.isEncryptionAvailable()
    this.load()
  }

  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable
  }

  get(): AppSettings {
    return structuredClone(this.settings)
  }

  set(next: AppSettings): void {
    this.settings = structuredClone(next)
    this.persist()
  }

  private encrypt(value: string): string {
    if (!this.encryptionAvailable) return value
    return safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value: string): string | undefined {
    if (!this.encryptionAvailable) return value
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return undefined
    }
  }

  private load(): void {
    const file = readJsonFile<SettingsFileV1 | null>(dataPaths.settingsPath, null)
    if (!file || file.version !== 1) return
    const providers: AppSettings['providers'] = {}
    for (const [providerId, baseUrl] of Object.entries(file.baseUrls ?? {})) {
      providers[providerId] = { baseUrl }
    }
    for (const [providerId, stored] of Object.entries(file.apiKeys ?? {})) {
      const apiKey = this.decrypt(stored)
      providers[providerId] = { ...providers[providerId], apiKey }
    }
    const customProviders = (file.customProviders ?? []).map((cp) => ({
      ...cp,
      apiKey: cp.apiKey ? this.decrypt(cp.apiKey) : undefined
    }))
    this.settings = {
      providers,
      customProviders,
      defaultModel: file.defaultModel,
      thinkingLevels: file.thinkingLevels
    }
  }

  private persist(): void {
    const apiKeys: Record<string, string> = {}
    const baseUrls: Record<string, string> = {}
    for (const [providerId, p] of Object.entries(this.settings.providers)) {
      if (p.apiKey) apiKeys[providerId] = this.encrypt(p.apiKey)
      if (p.baseUrl) baseUrls[providerId] = p.baseUrl
    }
    const customProviders = this.settings.customProviders.map((cp) => ({
      ...cp,
      apiKey: cp.apiKey ? this.encrypt(cp.apiKey) : undefined
    }))
    const file: SettingsFileV1 = {
      version: 1,
      encrypted: this.encryptionAvailable,
      apiKeys,
      baseUrls,
      customProviders,
      defaultModel: this.settings.defaultModel,
      thinkingLevels: this.settings.thinkingLevels
    }
    writeJsonFileAtomic(dataPaths.settingsPath, file, 0o600)
    try {
      chmodSync(dataPaths.settingsPath, 0o600)
    } catch {
      // Windows не поддерживает posix-права — там файл и так доступен только владельцу профиля
    }
  }
}
