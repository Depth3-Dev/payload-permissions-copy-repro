// Each payload version lives in its own small pnpm project under variants/, so that the patch
// (pnpm patchedDependencies) applies to one copy of payload@3.94.1 and not the other.
// `pnpm install` at the root runs this and installs all three from their lockfiles.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
for (const variant of ['3.92.1', '3.94.1', '3.94.1-patched']) {
  console.log(`\n> variants/${variant}: pnpm install --frozen-lockfile`)
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: path.join(root, 'variants', variant),
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
