#!/usr/bin/env node
/**
 * Apply an edited PRESC memory bundle.
 *
 * Workflow this supports:
 *   1. `node export-memory.mjs` copies the installed memory to a folder the
 *      owner can hand to another agent;
 *   2. that agent edits the Markdown and hands the folder back;
 *   3. `node apply-memory.mjs <folder>` validates the edits, backs up the
 *      installed memory, and installs them only if validation passes.
 *
 * Usage:
 *   node apply-memory.mjs <editedFolder> [--dry-run] [--memory-dir PATH]
 *
 * Exit codes: 0 applied (or dry-run passed), 1 validation failed, 2 bad usage.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pythonCandidates } from './lib/artifacts.js'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)))
const GENERATOR = join(PLUGIN_ROOT, 'vendor', 'artifact-generator.py')
const CANONICAL = ['prompt.md', 'security-posture.md', 'lore.md', 'user.md', 'context/research-index.md']

function parseArgs(argv) {
  const options = { folder: undefined, dryRun: false, memoryDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--memory-dir') options.memoryDir = argv[++index]
    else if (arg.startsWith('--memory-dir=')) options.memoryDir = arg.slice('--memory-dir='.length)
    else if (!arg.startsWith('--') && options.folder === undefined) options.folder = arg
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

function findPython() {
  // Try every candidate for real: a bare name may resolve through PATH, and a
  // bundled interpreter may sit outside the current process's own runtime.
  for (const candidate of pythonCandidates({})) {
    try {
      execFileSync(candidate, ['-c', 'print(1)'], { stdio: 'ignore', timeout: 10000 })
      return candidate
    } catch {
      // Keep looking.
    }
  }
  return undefined
}

function run(python, args) {
  try {
    const stdout = execFileSync(python, [GENERATOR, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out: stdout }
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
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
  if (options.folder === undefined) {
    console.error('usage: node apply-memory.mjs <editedFolder> [--dry-run] [--memory-dir PATH]')
    return 2
  }

  const source = resolve(options.folder)
  const memoryDir = resolveMemoryDir(options.memoryDir)

  if (!existsSync(source)) {
    console.error(`Folder not found: ${source}`)
    return 2
  }
  for (const relative of CANONICAL) {
    if (!existsSync(join(source, relative))) {
      console.error(`Bundle is incomplete: missing ${relative}`)
      return 2
    }
  }
  if (!existsSync(join(source, 'artifacts', 'INDEX.md'))) {
    console.error('Bundle is incomplete: missing artifacts/INDEX.md')
    return 2
  }

  const python = findPython()
  if (python === undefined) {
    console.error('No Python interpreter found. Set pythonPath in the plugin config, or add Python to PATH.')
    return 2
  }
  console.log(`Bundle:      ${source}`)
  console.log(`Memory root: ${memoryDir}`)
  console.log(`Interpreter: ${python}`)

  // 1. Validate in a staging copy, so a bad bundle never touches the install.
  const staging = mkdtempSync(join(tmpdir(), 'presc-apply-'))
  try {
    cpSync(source, staging, { recursive: true })
    // The manifest is regenerated; a stale one from the source must not decide.
    rmSync(join(staging, 'artifacts', '.artifact-manifest.json'), { force: true })

    const prepared = run(python, ['prepare', '--source-root', staging, '--root', join(staging, 'artifacts')])
    if (!prepared.ok) {
      console.error(`\nValidation failed during prepare:\n${prepared.out.trim()}`)
      return 1
    }
    const finalized = run(python, ['finalize', '--source-root', staging, '--root', join(staging, 'artifacts'), '--json'])
    if (!finalized.ok) {
      console.error(`\nValidation failed:\n${finalized.out.trim()}`)
      console.error('\nThe installed memory was NOT changed.')
      return 1
    }
    const status = JSON.parse(finalized.out.slice(finalized.out.indexOf('{')))
    console.log(`Validation:  ${status.status}, ${status.project_count} project(s)`)

    if (options.dryRun) {
      console.log('\nDry run: bundle is valid; nothing was installed.')
      return 0
    }

    // 2. Back up, then install exactly the bundle's own files.
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const backup = `${memoryDir}.bak-${stamp}`
    if (existsSync(memoryDir)) {
      cpSync(memoryDir, backup, { recursive: true })
      console.log(`Backup:      ${backup}`)
    }

    // Remove the managed subtrees first so a deleted dossier cannot linger.
    for (const relative of ['artifacts', 'research', 'context']) {
      rmSync(join(memoryDir, relative), { recursive: true, force: true })
    }
    // Bundle-only documentation is for the editor, not part of the memory root.
    const BUNDLE_DOCS = new Set(['INSTRUCTIONS.md', 'PROMPT.txt', 'README-RU.md'])
    for (const file of listFiles(source)) {
      const relative = file.slice(source.length + 1)
      if (BUNDLE_DOCS.has(relative)) continue
      const destination = join(memoryDir, relative)
      cpSync(file, destination)
    }

    // 3. Finalize against the installed root so the manifest matches it.
    const installed = run(python, ['finalize', '--source-root', memoryDir, '--root', join(memoryDir, 'artifacts'), '--json'])
    if (!installed.ok) {
      console.error(`\nInstalled bundle failed finalization:\n${installed.out.trim()}`)
      console.error(`Restore with: node apply-memory.mjs "${backup}"`)
      return 1
    }
    const installedStatus = JSON.parse(installed.out.slice(installed.out.indexOf('{')))
    console.log(`Installed:   ${installedStatus.status}, ${installedStatus.project_count} project(s)`)
    console.log('\nDone. Run /presc reload in a session to pick up the change.')
    return 0
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

process.exitCode = main()
