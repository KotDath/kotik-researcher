import { describe, expect, it } from 'vitest'
import { IpcChannels } from '../../src/shared/ipc'

// Structural test контракта каналов: уникальность и формат — дрейф имён ломает
// и preload, и main одновременно, лучше поймать здесь.
describe('IpcChannels', () => {
  it('все значения каналов уникальны', () => {
    const values = Object.values(IpcChannels)
    expect(new Set(values).size).toBe(values.length)
  })

  it('все каналы следуют формату domain:action', () => {
    for (const value of Object.values(IpcChannels)) {
      expect(value).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('ключи каналов покрывают ожидаемые домены', () => {
    const domains = new Set(Object.values(IpcChannels).map((c) => c.split(':')[0]))
    expect(domains).toEqual(new Set(['projects', 'chats', 'messages', 'settings', 'event']))
  })
})
