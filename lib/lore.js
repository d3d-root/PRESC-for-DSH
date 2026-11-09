/**
 * Canonical lore loading for the PRESC memory plugin.
 *
 * The plugin reads the same five canonical sources as the original
 * presc-prompt project so an existing memory bundle works unchanged:
 *
 *   prompt.md, security-posture.md, lore.md, user.md, context/research-index.md
 *
 * Two layers are supported:
 *   - a global memory root (default `$DSH_HOME/presc`);
 *   - a per-project override directory (`.presc/`) found by walking up from
 *     the session working directory. A project file wins over the global file
 *     of the same relative path, so a repository can specialise any single
 *     document without duplicating the whole bundle.
 *
 * @module dsh-plugin-presc/lore
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

/** Canonical source files, in delivery order. Mirrors the original plugin. */
export const LORE_SOURCES = Object.freeze([
  'prompt.md',
  'security-posture.md',
  'lore.md',
  'user.md',
  'context/research-index.md',
])

/** Separator the original plugin uses between canonical fragments. */
export const LORE_SEPARATOR = '\n\n---\n\n'

/** Directory name used for a per-project memory override. */
export const PROJECT_OVERRIDE_DIR = '.presc'

/**
 * Resolve the DSH home directory.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute path
 */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return resolve(configured.trim())
  const home = env.USERPROFILE || env.HOME
  return home ? join(home, '.dsh') : resolve('.dsh')
}

/**
 * Walk up from `start` looking for a project memory override directory.
 * @param {string} start absolute starting directory
 * @param {string} [dirName] override directory name
 * @returns {string | undefined} absolute override directory, when present
 */
export function findProjectOverride(start, dirName = PROJECT_OVERRIDE_DIR) {
  let current
  try {
    current = resolve(start)
  } catch {
    return undefined
  }
  for (;;) {
    const candidate = join(current, dirName)
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate
    } catch {
      // An unreadable ancestor must not abort the search.
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Read one file as UTF-8 text, or return undefined when it is absent.
 * @param {string} path
 * @returns {string | undefined}
 */
function readOptionalText(path) {
  try {
    if (!existsSync(path)) return undefined
    if (!statSync(path).isFile()) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Normalize line endings and trailing blank lines, matching the original
 * plugin's fragment handling.
 * @param {string} text
 * @returns {string}
 */
function normalizeFragment(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '')
}

/**
 * Load the canonical lore from the global root with optional project overrides.
 *
 * @param {object} options
 * @param {string} options.globalRoot absolute global memory root
 * @param {string | undefined} options.projectRoot absolute project override root
 * @param {number} [options.maxBytes] cap on the assembled text
 * @returns {{
 *   text: string,
 *   digest: string,
 *   bytes: number,
 *   files: Array<{ relative: string, path: string, layer: 'project' | 'global' }>,
 *   missing: string[],
 *   truncated: boolean,
 * }}
 */
export function loadLore({ globalRoot, projectRoot, maxBytes = 262144 }) {
  const files = []
  const missing = []
  const parts = []

  for (const relative of LORE_SOURCES) {
    let picked
    if (projectRoot !== undefined) {
      const candidate = join(projectRoot, relative)
      const text = readOptionalText(candidate)
      if (text !== undefined) picked = { path: candidate, text, layer: 'project' }
    }
    if (picked === undefined) {
      const candidate = join(globalRoot, relative)
      const text = readOptionalText(candidate)
      if (text !== undefined) picked = { path: candidate, text, layer: 'global' }
    }
    if (picked === undefined) {
      missing.push(relative)
      continue
    }
    const fragment = normalizeFragment(picked.text)
    if (fragment.length === 0) {
      missing.push(relative)
      continue
    }
    parts.push(fragment)
    files.push({ relative, path: picked.path, layer: picked.layer })
  }

  let text = parts.join(LORE_SEPARATOR)
  let truncated = false
  if (text.length > 0) {
    const framed = text + '\n'
    if (Buffer.byteLength(framed, 'utf8') > maxBytes) {
      // Trim on a byte budget without splitting a surrogate pair.
      let budget = maxBytes - 64
      let cut = framed
      while (Buffer.byteLength(cut, 'utf8') > budget && cut.length > 0) {
        cut = cut.slice(0, Math.floor(cut.length * 0.9))
      }
      text = cut.replace(/[\uD800-\uDBFF]$/, '')
      truncated = true
    }
  }

  const bytes = Buffer.byteLength(text, 'utf8')
  const digest = createHash('sha256').update(text.endsWith('\n') ? text : text + '\n', 'utf8').digest('hex')

  return { text, digest, bytes, files, missing, truncated }
}

/**
 * Render the lore as the model-facing block the original plugin delivers.
 *
 * @param {object} options
 * @param {string} options.text assembled canonical text
 * @param {string} options.digest content digest
 * @param {string} options.version plugin version
 * @param {string} [options.delivery] delivery channel label
 * @param {string} [options.memoryRoot] memory root for diagnostics
 * @param {string} [options.artifacts] optional project-dossier block
 * @returns {string}
 */
export function renderLoreBlock({ text, digest, version, delivery = 'system-prompt', memoryRoot, artifacts }) {
  const header = `<presc-delivery version="${version}" delivery="${delivery}" context_sha256="${digest}"${
    memoryRoot === undefined ? '' : ` root="${escapeAttribute(memoryRoot)}"`
  } />`
  const body = `<presc-context>\n${text}\n</presc-context>`
  return artifacts === undefined ? `${header}\n${body}` : `${header}\n${body}\n${artifacts}`
}

/**
 * Escape one value for use inside a double-quoted XML attribute.
 * @param {string} value
 * @returns {string}
 */
export function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build a one-line human-readable status for tools and commands.
 *
 * @param {object} state
 * @returns {string}
 */
export function describeLoreState(state) {
  const lines = []
  lines.push(`PRESC memory: ${state.ready ? 'ready' : 'incomplete'}`)
  lines.push(`Global root: ${state.globalRoot}`)
  if (state.projectRoot !== undefined) lines.push(`Project override: ${state.projectRoot}`)
  lines.push(`Sources: ${state.files.length}/${LORE_SOURCES.length} loaded, ${state.bytes} bytes`)
  if (state.files.length > 0) {
    for (const file of state.files) lines.push(`  - ${file.relative} (${file.layer})`)
  }
  if (state.missing.length > 0) lines.push(`Missing: ${state.missing.join(', ')}`)
  if (state.truncated) lines.push('Note: canonical text was truncated to maxLoreBytes.')
  lines.push(`Digest: ${state.digest.slice(0, 16)}`)
  return lines.join('\n')
}
