// One measurement in one fresh Node process, against the payload version the calling
// variant folder has installed. Called by variants/<name>/run.mjs; started by scripts/runChild.mjs.
//
// Input:  process.argv[2], a JSON object { shape, calls, warmup, outFile }
// Output: a JSON file at outFile.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { generateConfig } from './config.mjs'
import { canonicalJSON, countObjects, quantile } from './measure.mjs'

const admin = { id: 1, collection: 'users', email: 'admin@example.com', roles: ['admin'] }

/**
 * The unsanitized result `getAccessResults` builds before its last line,
 * `return sanitizePermissions(results)`. This is the body of `getAccessResults`
 * (identical in 3.92.1 and 3.94.1, packages/payload/src/auth/getAccessResults.ts)
 * without that last line, using the version's own `getEntityPermissions`.
 */
async function collectAccessResults({ req, getEntityPermissions }) {
  const results = { collections: {}, globals: {} }
  const { payload, user } = req
  const userCollectionConfig = user?.collection ? payload.collections[user.collection]?.config : null
  if (userCollectionConfig && payload.config.admin.user === user.collection) {
    results.canAccessAdmin = userCollectionConfig.access.admin
      ? await userCollectionConfig.access.admin({ req })
      : Boolean(user)
  } else {
    results.canAccessAdmin = false
  }
  const blockReferencesPermissions = {}
  await Promise.all(
    payload.config.collections.map(async (collection) => {
      const operations = ['create', 'read', 'update', 'delete']
      if (collection.auth && typeof collection.auth.maxLoginAttempts !== 'undefined' && collection.auth.maxLoginAttempts !== 0) {
        operations.push('unlock')
      }
      if (collection.versions) operations.push('readVersions')
      results.collections[collection.slug] = await getEntityPermissions({
        blockReferencesPermissions,
        entity: collection,
        entityType: 'collection',
        fetchData: false,
        operations,
        req,
      })
    }),
  )
  await Promise.all(
    payload.config.globals.map(async (global) => {
      const operations = ['read', 'update']
      if (global.versions) operations.push('readVersions')
      results.globals[global.slug] = await getEntityPermissions({
        blockReferencesPermissions,
        entity: global,
        entityType: 'global',
        fetchData: false,
        operations,
        req,
      })
    }),
  )
  return results
}

const timeIt = async (fn, { calls, warmup }) => {
  for (let i = 0; i < warmup; i++) await fn()
  globalThis.gc?.()
  const times = []
  for (let i = 0; i < calls; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  return { median: quantile(times, 0.5), p95: quantile(times, 0.95) }
}

export async function runVariant({ payload, payloadInternal, sqliteAdapter, variantDir }) {
  const input = JSON.parse(process.argv[2])
  const variant = path.basename(variantDir)
  const dataDir = path.join(variantDir, '.data')
  mkdirSync(dataDir, { recursive: true })

  const config = generateConfig({
    buildConfig: payload.buildConfig,
    sqliteAdapter,
    shape: input.shape,
    dbFile: path.join(dataDir, 'repro.db'),
  })

  // No database is touched: getAccessResults with fetchData: false never queries.
  const instance = await payload.getPayload({ config, disableDBConnect: true, disableOnInit: true })
  const req = await payload.createLocalReq({ user: admin }, instance)
  const { getEntityPermissions } = payloadInternal
  const { getAccessResults, deepCopyObject } = payload

  const payloadVersion = JSON.parse(
    readFileSync(path.join(variantDir, 'node_modules', 'payload', 'package.json'), 'utf8'),
  ).version
  const out = { variant, input, payloadVersion }

  const tree = await collectAccessResults({ req, getEntityPermissions })
  const sanitized = await getAccessResults({ req })
  out.counts = countObjects(tree)
  out.jsonBefore = Buffer.byteLength(JSON.stringify(tree))
  out.jsonAfter = Buffer.byteLength(JSON.stringify(sanitized))
  out.sanitizedCanonical = canonicalJSON(sanitized)

  const opts = { calls: input.calls, warmup: input.warmup }
  out.getAccessResults = await timeIt(() => getAccessResults({ req }), opts)
  out.collect = await timeIt(() => collectAccessResults({ req, getEntityPermissions }), opts)
  out.deepCopy = await timeIt(() => deepCopyObject(tree), opts)

  writeFileSync(input.outFile, JSON.stringify(out))
  process.exit(0)
}
