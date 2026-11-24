// Starts one measurement in a fresh Node process for one variant and returns its JSON result.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const root = path.resolve(import.meta.dirname, '..')
export const variants = ['3.92.1', '3.94.1', '3.94.1-patched']

export function loadEnv() {
  for (const file of ['.env', '.env.example']) {
    if (!process.env.PAYLOAD_SECRET && existsSync(path.join(root, file))) process.loadEnvFile(path.join(root, file))
  }
}

export function runChild(variant, input) {
  const dir = path.join(root, 'variants', variant)
  if (!existsSync(path.join(dir, 'node_modules', 'payload'))) {
    throw new Error(`variants/${variant} is not installed: run \`pnpm install\` at the repository root`)
  }
  const child = spawnSync(process.execPath, ['--expose-gc', path.join(dir, 'run.mjs'), JSON.stringify(input)], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  })
  if (child.status !== 0) {
    process.stderr.write(child.stdout + child.stderr)
    throw new Error(`variants/${variant} exited with ${child.status}`)
  }
  return JSON.parse(readFileSync(input.outFile, 'utf8'))
}
