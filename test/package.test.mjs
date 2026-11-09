// Package test: mount the plugin against a mock Cordis context on a fresh
// memory root and verify seeding, registration, and delivery.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../lib/index.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`ok   ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function createMockContext() {
  const record = { sections: [], skills: [], tools: [], commands: [], events: [], effects: [], logs: [] }
  const services = {
    skills: { register: (s) => (record.skills.push(s), () => {}) },
    tools: { register: (t) => (record.tools.push(t), () => {}) },
    commands: { register: (c) => (record.commands.push(c), () => {}) },
  }
  const ctx = {
    logger: {
      info: (...a) => record.logs.push(['info', a.join(' ')]),
      warn: (...a) => record.logs.push(['warn', a.join(' ')]),
      error: (...a) => record.logs.push(['error', a.join(' ')]),
    },
    systemPrompt: { section: (s) => (record.sections.push(s), () => {}) },
    get: (n) => services[n],
    inject: (deps, cb) => {
      const child = { ...ctx }
      for (const d of deps) child[d] = services[d]
      return cb(child)
    },
    on: (event, listener) => record.events.push({ event, listener }),
    effect: (fn) => fn(),
  }
  return { ctx, record }
}

check('exports the package name', name === 'dsh-plugin-presc', name)
check('declares the systemPrompt injection', Array.isArray(inject) && inject.includes('systemPrompt'))

// --- fresh install: seeding ------------------------------------------------
const freshRoot = mkdtempSync(join(tmpdir(), 'presc-fresh-'))
rmSync(freshRoot, { recursive: true, force: true }) // start absent

const fresh = createMockContext()
apply(fresh.ctx, { memoryDir: freshRoot, watch: false, artifactsMode: 'off' })

check('creates the memory root on first run', existsSync(freshRoot))
check('seeds prompt.md', existsSync(join(freshRoot, 'prompt.md')))
check('seeds lore.md', existsSync(join(freshRoot, 'lore.md')))
check('seeds the research index', existsSync(join(freshRoot, 'context', 'research-index.md')))
check('seeds research documents', existsSync(join(freshRoot, 'research', '01-telegram-stars.md')))
check('seeds the dossier index', existsSync(join(freshRoot, 'artifacts', 'INDEX.md')))
check('seeds project dossiers', existsSync(join(freshRoot, 'artifacts', 'projects')))

const freshText = fresh.record.sections[0].text()
check('delivers the lore after seeding', freshText.includes('<presc-context>'), freshText.slice(0, 100))
check('delivers a delivery marker', freshText.includes('<presc-delivery'))
check('delivers real lore content', freshText.length > 20000, `${freshText.length} chars`)

const toolNames = fresh.record.tools.map((t) => t.name)
for (const expected of ['presc_status', 'presc_context', 'presc_reload', 'presc_finalize']) {
  check(`registers ${expected}`, toolNames.includes(expected))
}
check('registers no legacy tool names', !toolNames.some((t) => t.startsWith('choirboy_')))
check('registers the /presc command', fresh.record.commands.some((c) => c.name === 'presc'))
check('registers the load-context skill', fresh.record.skills.some((s) => s.name === 'load-context'))
check('registers the presc-diagnose skill', fresh.record.skills.some((s) => s.name === 'presc-diagnose'))

const loadSkill = fresh.record.skills.find((s) => s.name === 'load-context')
check('load-context embeds the lore', loadSkill.content.includes('<presc-context>'))
check('load-context is a string', typeof loadSkill.content === 'string')

// --- upgrade safety: seeding must not overwrite edits ----------------------
const editedPath = join(freshRoot, 'prompt.md')
writeFileSync(editedPath, '# My own rules\n\nNever overwrite this.\n', 'utf8')

const second = createMockContext()
apply(second.ctx, { memoryDir: freshRoot, watch: false, artifactsMode: 'off' })
check('does not overwrite an edited file', readFileSync(editedPath, 'utf8').includes('Never overwrite this'))

// --- empty root with seeding disabled -------------------------------------
const emptyRoot = mkdtempSync(join(tmpdir(), 'presc-empty-'))
const empty = createMockContext()
apply(empty.ctx, { memoryDir: emptyRoot, watch: false, artifacts: false, seed: false })
const emptyText = empty.record.sections[0].text()
check('explains an empty root instead of failing', emptyText.includes('installed but empty'), emptyText.slice(0, 100))
check('does not seed when disabled', !existsSync(join(emptyRoot, 'lore.md')))

// --- status delivery mode --------------------------------------------------
const statusCtx = createMockContext()
apply(statusCtx.ctx, { memoryDir: freshRoot, watch: false, artifactsMode: 'off', delivery: 'status' })
const statusText = statusCtx.record.sections[0].text()
check('status mode inlines a pointer', statusText.includes('presc_context') && statusText.length < 5000, `${statusText.length} chars`)

rmSync(freshRoot, { recursive: true, force: true })
rmSync(emptyRoot, { recursive: true, force: true })

console.log(failures === 0 ? '\nall package checks passed' : `\n${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
