#!/usr/bin/env node
/**
 * Export the installed PRESC memory as an editable bundle.
 *
 * The exported folder mirrors the memory root layout, so it can be handed to
 * another agent, edited, and returned to `apply-memory.mjs` unchanged.
 *
 * Usage:
 *   node export-memory.mjs [outputFolder] [--memory-dir PATH]
 *
 * The generated `.artifact-manifest.json` and `.artifact-request.json` are
 * deliberately excluded: they are validator bookkeeping, not editable content.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)))
const TEMPLATE_ROOT = join(PLUGIN_ROOT, 'memory')
const CANONICAL = ['prompt.md', 'security-posture.md', 'lore.md', 'user.md', 'context/research-index.md']

function parseArgs(argv) {
  const options = { out: undefined, memoryDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--memory-dir') options.memoryDir = argv[++index]
    else if (arg.startsWith('--memory-dir=')) options.memoryDir = arg.slice('--memory-dir='.length)
    else if (!arg.startsWith('--') && options.out === undefined) options.out = arg
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return options
}

function resolveMemoryDir(explicit) {
  if (explicit) return resolve(explicit)
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return join(resolve(home), 'presc')
}

function listFiles(root) {
  const out = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  visit(root)
  return out
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const memoryDir = resolveMemoryDir(options.memoryDir)
  const out = options.out ? resolve(options.out) : join(process.cwd(), 'presc-editable')

  if (!existsSync(memoryDir)) {
    console.error(`Memory root not found: ${memoryDir}`)
    return 2
  }
  for (const relative of CANONICAL) {
    if (!existsSync(join(memoryDir, relative))) {
      console.error(`Memory root is incomplete: missing ${relative}`)
      return 2
    }
  }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  const SKIP = new Set(['.artifact-manifest.json', '.artifact-request.json', '.artifact-migration.json'])
  let copied = 0
  for (const file of listFiles(memoryDir)) {
    const name = file.slice(file.lastIndexOf('/') + 1).slice(file.lastIndexOf('\\') + 1)
    if (SKIP.has(name)) continue
    const relative = file.slice(memoryDir.length + 1)
    cpSync(file, join(out, relative))
    copied += 1
  }

  // Ship the editing contract with the bundle.
  cpSync(join(PLUGIN_ROOT, 'docs', 'EDITING.md'), join(out, 'INSTRUCTIONS.md'))

  console.log(`Exported ${copied} file(s) to ${out}`)
  console.log('Hand this folder to another agent, then apply the result with:')
  console.log(`  node apply-memory.mjs "${out}"`)
  return 0
}

process.exitCode = main()
