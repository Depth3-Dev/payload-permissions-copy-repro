// Runs every preset against every variant, one fresh Node process per run, and prints the table.
//
//   pnpm bench                         all presets
//   pnpm bench --preset default        one preset (comma-separate for several)
//   pnpm bench --calls 500 --warmup 100
//   pnpm bench --shape 30,12,8,references   a custom size: collections,blocks,fieldsPerBlock,mode
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { loadEnv, root, runChild as run, variants } from './runChild.mjs'

const presets = {
  small: { collections: 10, blocks: 5, fieldsPerBlock: 5, mode: 'inline' },
  default: { collections: 20, blocks: 10, fieldsPerBlock: 8, mode: 'inline' },
  'default-refs': { collections: 20, blocks: 10, fieldsPerBlock: 8, mode: 'references' },
  large: { collections: 50, blocks: 20, fieldsPerBlock: 10, mode: 'inline' },
  'large-refs': { collections: 50, blocks: 20, fieldsPerBlock: 10, mode: 'references' },
}

const { values: args } = parseArgs({
  options: {
    preset: { type: 'string' },
    shape: { type: 'string' },
    calls: { type: 'string', default: '300' },
    warmup: { type: 'string', default: '50' },
  },
})

loadEnv()

let runs
if (args.shape) {
  const [c, b, f, mode = 'inline'] = args.shape.split(',')
  runs = [['custom', { collections: +c, blocks: +b, fieldsPerBlock: +f, mode }]]
} else {
  const names = args.preset ? args.preset.split(',') : Object.keys(presets)
  runs = names.map((n) => {
    if (!presets[n]) throw new Error(`unknown preset ${n}; known: ${Object.keys(presets).join(', ')}`)
    return [n, presets[n]]
  })
}

const resultsDir = path.join(root, '.results')
mkdirSync(resultsDir, { recursive: true })

const ms = (n) => n.toFixed(2)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

console.log(`node ${process.version}, ${os.cpus()[0]?.model ?? os.arch()}, ${os.platform()} ${os.release()}`)
console.log(`${args.calls} timed calls after ${args.warmup} warm-up calls, admin user, one process per row\n`)

const header = [
  pad('preset', 13),
  pad('variant', 15),
  pad('config (C x B x F)', 22),
  lpad('objects', 8),
  lpad('distinct', 9),
  lpad('JSON before', 12),
  lpad('after', 9),
  lpad('gAR median', 11),
  lpad('gAR p95', 8),
  lpad('build', 8),
  lpad('deepCopy', 9),
  lpad('same result', 12),
].join(' ')
console.log(header)
console.log('-'.repeat(header.length))

const all = []
for (const [name, shape] of runs) {
  const rows = variants.map((variant) =>
    run(variant, {
      shape,
      calls: Number(args.calls),
      warmup: Number(args.warmup),
      outFile: path.join(resultsDir, `${name}__${variant}.json`),
    }),
  )
  const reference = rows.find((r) => r.variant === '3.94.1').sanitizedCanonical
  for (const r of rows) {
    const cfg = `${shape.collections} x ${shape.blocks} x ${shape.fieldsPerBlock} ${shape.mode === 'references' ? 'refs' : 'inline'}`
    console.log(
      [
        pad(name, 13),
        pad(r.variant, 15),
        pad(cfg, 22),
        lpad(r.counts.reached, 8),
        lpad(r.counts.distinct, 9),
        lpad(kb(r.jsonBefore), 12),
        lpad(kb(r.jsonAfter), 9),
        lpad(`${ms(r.getAccessResults.median)} ms`, 11),
        lpad(ms(r.getAccessResults.p95), 8),
        lpad(ms(r.collect.median), 8),
        lpad(`${ms(r.deepCopy.median)} ms`, 9),
        lpad(r.sanitizedCanonical === reference ? 'yes' : 'NO', 12),
      ].join(' '),
    )
  }
  all.push({ name, shape, rows, reference })
}

console.log(`
objects / distinct: objects reached in getAccessResults' unsanitized result (one reached from two
  places counts twice) and how many different objects that is.
JSON before / after: that result as JSON, and the sanitized result getAccessResults returns.
gAR median / p95: getAccessResults({ req }) in ms.  build: building the unsanitized result alone (median).
deepCopy: deepCopyObject(unsanitized result) alone (median).
same result: the sanitized result deep-equals 3.94.1's.`)

console.log('\nChecks (medians, ms)')
const signed = (n) => `${n >= 0 ? '+' : ''}${ms(n)}`
for (const { name, rows, reference } of all) {
  const by = Object.fromEntries(rows.map((r) => [r.variant, r]))
  const [old, cur, pat] = ['3.92.1', '3.94.1', '3.94.1-patched'].map((v) => by[v])
  const gar = (r) => r.getAccessResults.median
  const shared = rows.map((r) => `${r.variant} ${r.counts.reached - r.counts.distinct}`).join(', ')
  console.log(`  ${name}`)
  console.log(
    `    3.94.1 vs 3.92.1:  ${signed(gar(cur) - gar(old))} (${(gar(cur) / gar(old)).toFixed(2)}x)`,
  )
  console.log(
    `    3.94.1 vs patched: ${signed(gar(cur) - gar(pat))}   deepCopyObject of the tree alone: ${ms(cur.deepCopy.median)}`,
  )
  console.log(
    `    patched vs 3.92.1: ${signed(gar(pat) - gar(old))} (${(gar(pat) / gar(old)).toFixed(2)}x)   ` +
      `of which building the tree: ${signed(pat.collect.median - old.collect.median)}`,
  )
  console.log(
    `    same sanitized result: ${rows.map((r) => `${r.variant} ${r.sanitizedCanonical === reference ? 'yes' : 'NO'}`).join(', ')}`,
  )
  console.log(`    objects reached twice: ${shared}`)
}

