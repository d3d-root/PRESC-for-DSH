/**
 * First-run memory seeding.
 *
 * The package ships a complete memory bundle under `memory/`. A fresh install
 * has no memory root yet, so the plugin copies the bundle once, on activation,
 * and then always reads from the user's own root. That keeps two things true at
 * the same time:
 *
 *   - install and it works: no manual file copying, no installer step;
 *   - the memory stays editable and survives plugin upgrades: seeding never
 *     overwrites a file that already exists.
 *
 * Seeding is deliberately conservative: a missing root is created, an existing
 * root is only topped up with absent files, and any failure is reported and
 * ignored rather than breaking plugin activation.
 *
 * @module dsh-plugin-presc/seed
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Files that define whether a memory root is usable. */
export const REQUIRED_SOURCES = Object.freeze([
  'prompt.md',
  'security-posture.md',
  'lore.md',
  'user.md',
  'context/research-index.md',
])

/**
 * Recursively list regular files under a directory.
 * @param {string} root
 * @returns {string[]} absolute paths
 */
function listFiles(root) {
  const out = []
  const visit = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  visit(root)
  return out
}

/**
 * Whether a memory root already holds the canonical sources.
 * @param {string} memoryRoot
 * @returns {boolean}
 */
export function hasCanonicalSources(memoryRoot) {
  return REQUIRED_SOURCES.every((relative) => {
    try {
      return statSync(join(memoryRoot, relative)).isFile()
    } catch {
      return false
    }
  })
}

/**
 * Copy the shipped bundle into the memory root, without overwriting anything.
 *
 * @param {object} options
 * @param {string} options.packageRoot absolute plugin package root
 * @param {string} options.memoryRoot absolute destination memory root
 * @param {boolean} [options.enabled] set false to skip seeding entirely
 * @returns {{ seeded: boolean, created: string[], kept: number, reason?: string }}
 */
export function seedMemoryIfEmpty({ packageRoot, memoryRoot, enabled = true }) {
  if (!enabled) return { seeded: false, created: [], kept: 0, reason: 'disabled' }

  const templateRoot = join(packageRoot, 'memory')
  if (!existsSync(templateRoot)) {
    return { seeded: false, created: [], kept: 0, reason: `no shipped bundle at ${templateRoot}` }
  }

  // A root that already has the canonical sources is the user's; never touch it.
  if (hasCanonicalSources(memoryRoot)) {
    return { seeded: false, created: [], kept: 0, reason: 'already present' }
  }

  const created = []
  let kept = 0
  try {
    for (const source of listFiles(templateRoot)) {
      const relative = source.slice(templateRoot.length + 1)
      const destination = join(memoryRoot, relative)
      if (existsSync(destination)) {
        kept += 1
        continue
      }
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      created.push(relative)
    }
  } catch (error) {
    return {
      seeded: created.length > 0,
      created,
      kept,
      reason: `seed failed after ${created.length} file(s): ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { seeded: created.length > 0, created, kept }
}
