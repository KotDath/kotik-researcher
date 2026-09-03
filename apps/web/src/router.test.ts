import { describe, expect, it } from 'vitest'
import { experimentDays, findDay } from './experiments.ts'
import { parseHash, routeToHash, type Route } from './router.ts'

describe('parseHash', () => {
  it('routes an empty hash to home', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })

  it('routes to the experiments list', () => {
    expect(parseHash('#/experiments')).toEqual({ name: 'experiments' })
  })

  it('routes to a challenge day page', () => {
    expect(parseHash('#/experiments/day/day-01')).toEqual({ name: 'day', dayId: 'day-01' })
  })

  it('falls back to home for unknown paths', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'home' })
    expect(parseHash('#/experiments/day')).toEqual({ name: 'home' })
  })
})

describe('routeToHash', () => {
  it('round-trips every known route', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'experiments' },
      { name: 'day', dayId: 'day-01' },
    ]
    for (const route of routes) {
      expect(parseHash(routeToHash(route))).toEqual(route)
    }
  })
})

describe('experimentDays', () => {
  it('exposes day-01 as the only available day', () => {
    expect(findDay('day-01')?.status).toBe('available')
    expect(experimentDays.filter((day) => day.status === 'available')).toHaveLength(1)
  })

  it('has unique ids and resolves unknown days to undefined', () => {
    const ids = experimentDays.map((day) => day.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(findDay('day-99')).toBeUndefined()
  })
})
