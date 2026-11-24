/**
 * Walks a permissions tree and counts the objects (arrays included) it reaches.
 *
 * - reached:  every time an object is reached through a property (an object reached
 *             from two places counts twice)
 * - distinct: how many different objects that was
 *
 * reached === distinct means no object of the tree is shared between two places.
 */
export function countObjects(root) {
  const all = new Set()
  let reached = 0
  let cycles = 0
  const path = new Set()
  const walk = (value) => {
    if (value === null || typeof value !== 'object') return
    if (path.has(value)) {
      cycles++
      return
    }
    reached++
    all.add(value)
    path.add(value)
    for (const key of Object.keys(value)) walk(value[key])
    path.delete(value)
  }
  walk(root)
  return { reached, distinct: all.size, cycles }
}

/** JSON with object keys sorted, so two results compare equal whatever order they were built in. */
export function canonicalJSON(value) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  )
}

export function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}
