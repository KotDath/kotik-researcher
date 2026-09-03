export type Route = { name: 'home' } | { name: 'experiments' } | { name: 'day'; dayId: string }

export function parseHash(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash
  const segments = path.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) {
    return { name: 'home' }
  }
  if (segments[0] === 'experiments' && segments.length === 1) {
    return { name: 'experiments' }
  }
  if (segments[0] === 'experiments' && segments[1] === 'day' && segments[2]) {
    return { name: 'day', dayId: segments[2] }
  }
  return { name: 'home' }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'experiments':
      return '#/experiments'
    case 'day':
      return `#/experiments/day/${route.dayId}`
  }
}
