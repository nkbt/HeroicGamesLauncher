// nk: #5 - the current backing store's escaped dot-key semantics.
type ObjectValue = Record<string, unknown>
const objectValue = (value: unknown): value is ObjectValue =>
  value !== null && (typeof value === 'object' || typeof value === 'function')

function segments(key: string) {
  const split = key.split('.')
  const result: string[] = []
  for (let index = 0; index < split.length; index++) {
    let segment = split[index]
    while (segment.endsWith('\\') && index + 1 < split.length)
      segment = `${segment.slice(0, -1)}.${split[++index]}`
    if (
      segment === '__proto__' ||
      segment === 'prototype' ||
      segment === 'constructor'
    )
      return []
    result.push(segment)
  }
  return result
}

export function getPath(store: ObjectValue, key: string, fallback?: unknown) {
  const path = segments(key)
  if (!path.length) return undefined
  let value: unknown = store
  for (let index = 0; index < path.length; index++) {
    value = (value as ObjectValue)[path[index]]
    if (value == null) {
      if (index < path.length - 1) return fallback
      break
    }
  }
  return value === undefined ? fallback : value
}

export function hasPath(store: ObjectValue, key: string) {
  const path = segments(key)
  if (!path.length) return false
  let value: unknown = store
  for (const segment of path) {
    if (!objectValue(value) || !(segment in value)) return false
    value = value[segment]
  }
  return true
}

export function setPath(store: ObjectValue, key: string, value: unknown) {
  const path = segments(key)
  let current = store
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]
    if (index === path.length - 1) current[segment] = value
    else {
      if (!objectValue(current[segment])) current[segment] = {}
      current = current[segment] as ObjectValue
    }
  }
}

export function deletePath(store: ObjectValue, key: string) {
  const path = segments(key)
  let current: unknown = store
  for (let index = 0; index < path.length; index++) {
    if (!objectValue(current)) return
    if (index === path.length - 1) delete current[path[index]]
    else current = current[path[index]]
  }
}

// Backing JSON writes remove custom array properties and normalize holes to null.
// Normalize only an affected array branch, never the entire cache snapshot.
export function normalizePathArrays(store: ObjectValue, key: string) {
  const path = segments(key)
  let current: unknown = store
  for (const segment of path) {
    if (!objectValue(current)) return
    const value = current[segment]
    if (Array.isArray(value)) {
      current[segment] = JSON.parse(JSON.stringify(value))
      return
    }
    current = value
  }
}
