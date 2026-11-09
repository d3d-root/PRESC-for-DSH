/**
 * dsh-plugin-presc — persistent project memory for DeepSeek Harness.
 *
 * The original `presc-prompt` project delivers a fixed lore bundle through
 * Claude Code / Codex `SessionStart` hooks. DeepSeek Harness has no such hook,
 * so this plugin uses the seams DSH actually owns:
 *
 *   - `ctx.systemPrompt.section()` registers an ordered prompt section, so the
 *     lore is present on every assembled request (this is the SessionStart
 *     equivalent, and it survives compaction because it is not history);
 *   - `ctx.skills.register()` publishes a `load-context` skill, so the model can
 *     re-read the lore on demand;
 *   - `ctx.tools.register()` exposes status / context / reload / finalize tools;
 *   - `ctx.commands.register()` adds a `/presc` command;
 *   - the vendored `artifact-generator.py` keeps the original project-dossier
 *     lifecycle (restore, validate, finalize) byte-compatible.
 *
 * Nothing here patches DSH itself: it is an ordinary profile plugin.
 *
 * @module dsh-plugin-presc
 */

import { existsSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LORE_SOURCES,
  describeLoreState,
  dshHome,
  escapeAttribute,
  findProjectOverride,
  loadLore,
  renderLoreBlock,
} from './lore.js'
import { probeGenerator, runGeneratorWithFallback } from './artifacts.js'
import { seedMemoryIfEmpty } from './seed.js'

/** Plugin identifier used by the profile patch. */
export const name = 'dsh-plugin-presc'

/** The prompt registry is the one service this plugin cannot work without. */
export const inject = ['systemPrompt']

const PLUGIN_VERSION = '1.1.0'
const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SECTION_NAME = 'presc:lore'
const SKILL_NAME = 'load-context'
const DIAGNOSE_SKILL_NAME = 'presc-diagnose'
const WATCH_DEBOUNCE_MS = 250

/**
 * Normalize the raw profile config.
 * @param {Record<string, unknown> | undefined} raw
 * @returns {object}
 */
function normalizeConfig(raw) {
  const config = raw ?? {}
  const number = (value, fallback) => (Number.isFinite(value) ? Number(value) : fallback)
  const text = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined)
  return {
    memoryDir: text(config.memoryDir),
    artifactsDir: text(config.artifactsDir),
    projectOverride: config.projectOverride !== false,
    delivery: config.delivery === 'status' ? 'status' : 'section',
    order: number(config.order, 700),
    maxLoreBytes: number(config.maxLoreBytes, 131072),
    maxArtifactsBytes: number(config.maxArtifactsBytes, 24576),
    artifacts: config.artifacts !== false,
    artifactsMode: config.artifactsMode === 'full' ? 'full' : config.artifactsMode === 'off' ? 'off' : 'auto',
    pythonPath: text(config.pythonPath),
    watch: config.watch !== false,
    debug: config.debug === true,
    seed: config.seed !== false,
  }
}

/**
 * Minimal, dependency-free deep freeze for a message snapshot.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/**
 * Build a user-role message without importing harness internals.
 *
 * The harness message factories only attach a fresh id and freeze the value, so
 * an equivalent literal is enough and keeps this plugin import-free.
 *
 * @param {string} text
 * @param {string} kind
 * @returns {object}
 */
function buildContextMessage(text, kind) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return deepFreeze({
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind, form: 'context' },
  })
}

/**
 * Format a byte count for status output.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Plugin entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown> | undefined} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = ctx.logger
  const debug = (...args) => {
    if (config.debug) log?.info?.(`[presc] ${args.join(' ')}`)
  }

  const globalRoot = config.memoryDir ?? join(dshHome(), 'presc')
  const artifactRoot = config.artifactsDir ?? join(globalRoot, 'artifacts')

  /** Mutable state read synchronously by the prompt section. */
  const state = {
    globalRoot,
    projectRoot: undefined,
    text: '',
    digest: '',
    bytes: 0,
    files: [],
    missing: [...LORE_SOURCES],
    truncated: false,
    ready: false,
    artifactsText: undefined,
    artifactsStatus: 'unavailable',
    artifactsReason: undefined,
    python: undefined,
    lastRefreshAt: 0,
    lastError: undefined,
  }

  let projectCwd = process.cwd()

  /**
   * Re-read the canonical lore from disk and refresh the cached state.
   * @param {object} [options]
   * @param {string} [options.cwd] working directory used for project override discovery
   * @returns {typeof state}
   */
  function refreshLore({ cwd } = {}) {
    if (typeof cwd === 'string' && cwd.length > 0) projectCwd = cwd
    state.projectRoot = config.projectOverride ? findProjectOverride(projectCwd) : undefined
    try {
      const loaded = loadLore({
        globalRoot: state.globalRoot,
        projectRoot: state.projectRoot,
        maxBytes: config.maxLoreBytes,
      })
      state.text = loaded.text
      state.digest = loaded.digest
      state.bytes = loaded.bytes
      state.files = loaded.files
      state.missing = loaded.missing
      state.truncated = loaded.truncated
      state.ready = loaded.files.length > 0
      state.lastRefreshAt = Date.now()
      state.lastError = undefined
      debug(`lore refreshed: ${loaded.files.length}/${LORE_SOURCES.length} sources, ${loaded.bytes} bytes`)
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      log?.warn?.(`[presc] lore refresh failed: ${state.lastError}`)
    }
    return state
  }

  /**
   * Render the model-facing project-dossier block, honoring the size budget.
   * @param {string} raw generator output
   * @returns {string | undefined}
   */
  function shapeArtifacts(raw) {
    const text = raw.trim()
    if (text.length === 0) return undefined
    if (config.artifactsMode === 'off') return undefined
    const bytes = Buffer.byteLength(text, 'utf8')
    if (config.artifactsMode === 'auto' && bytes > config.maxArtifactsBytes) {
      const digest = state.digest.slice(0, 16)
      return `<presc-project-artifacts status="deferred" bytes="${bytes}" source_sha256="${escapeAttribute(
        digest,
      )}">Project dossiers are available but exceed maxArtifactsBytes (${config.maxArtifactsBytes}). Read them with the presc_context tool, or raise maxArtifactsBytes.</presc-project-artifacts>`
    }
    return text
  }

  /**
   * Refresh the project-dossier block from the vendored generator.
   * Failures never throw: dossiers are an enhancement over the fixed lore.
   * @returns {Promise<void>}
   */
  async function refreshArtifacts() {
    if (!config.artifacts || config.artifactsMode === 'off') {
      state.artifactsText = undefined
      state.artifactsStatus = 'off'
      return
    }
    const result = await runGeneratorWithFallback({
      pluginRoot: PLUGIN_ROOT,
      configuredPython: config.pythonPath,
      preferredPython: state.python,
      command: 'session-context',
      sourceRoot: state.projectRoot ?? state.globalRoot,
      artifactRoot,
    })
    if (!result.ok) {
      state.artifactsText = undefined
      state.artifactsStatus = 'unavailable'
      state.artifactsReason = (result.stderr || '').trim().split('\n').slice(0, 3).join(' ') || 'generator failed'
      debug(`artifacts failed: ${state.artifactsReason}`)
      return
    }
    state.python = result.python
    const shaped = shapeArtifacts(result.stdout)
    state.artifactsText = shaped
    state.artifactsStatus = shaped === undefined ? 'empty' : 'ready'
    state.artifactsReason = undefined
    debug(`artifacts refreshed (${shaped === undefined ? 0 : Buffer.byteLength(shaped, 'utf8')} bytes)`)
  }

  /**
   * Compose the final section text delivered to the model.
   * @returns {string}
   */
  function composeSectionText() {
    if (state.text.length === 0) {
      if (state.missing.length === LORE_SOURCES.length) {
        return `PRESC memory is installed but empty. Canonical sources are expected under ${state.globalRoot} (${LORE_SOURCES.join(
          ', ',
        )}). Fill them in, then run the presc_reload tool.`
      }
      return ''
    }
    if (config.delivery === 'status') {
      return [
        `<presc-delivery version="${PLUGIN_VERSION}" delivery="status" context_sha256="${state.digest}" />`,
        'PRESC memory is loaded on disk but not inlined. Call the presc_context tool before handling the first task, and after any compaction.',
        describeLoreState(state),
      ].join('\n')
    }
    return renderLoreBlock({
      text: state.text,
      digest: state.digest,
      version: PLUGIN_VERSION,
      delivery: 'system-prompt',
      memoryRoot: state.projectRoot ?? state.globalRoot,
      artifacts: state.artifactsText,
    })
  }

  // ---- delivery: ordered system prompt section ---------------------------
  // The callback form means a file change is picked up by the next assembly
  // without re-registering the section (and without invalidating its order).
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: config.order,
    text: () => composeSectionText(),
    interpolate: false,
  })

  // ---- initial load ------------------------------------------------------
  // A fresh install has no memory root yet. The package ships a complete
  // bundle under `memory/`, so the first activation copies it into place. This
  // runs before the first read, and never overwrites an existing file, so an
  // upgrade cannot clobber the user's own edits.
  try {
    const seeding = seedMemoryIfEmpty({
      packageRoot: PLUGIN_ROOT,
      memoryRoot: globalRoot,
      enabled: config.seed,
    })
    if (seeding.seeded) {
      log?.info?.(`[presc] seeded ${seeding.created.length} memory file(s) into ${globalRoot}`)
    } else if (seeding.reason !== undefined && seeding.reason !== 'already present') {
      debug(`memory seeding skipped: ${seeding.reason}`)
    }
    if (seeding.reason !== undefined && seeding.reason.startsWith('seed failed')) {
      log?.warn?.(`[presc] ${seeding.reason}`)
    }
  } catch (error) {
    // Seeding is a convenience; a read-only install still delivers the lore.
    log?.warn?.(`[presc] memory seeding failed: ${error}`)
  }

  refreshLore()
  const initialArtifacts = refreshArtifacts()
  initialArtifacts.catch((error) => log?.warn?.(`[presc] initial artifact refresh failed: ${error}`))

  // ---- skills ------------------------------------------------------------
  // `ctx.skills.register()` stores a runtime skill whose body is a plain string;
  // the registry re-validates it on load, so `content` must be materialized now
  // and `source` must be a non-empty string.
  //
  // Registration runs through `ctx.inject(...)`, not `ctx.get(...)`: optional
  // services such as `skills`, `tools`, and `commands` may not exist yet when
  // `apply()` runs, and `ctx.inject` starts the callback as soon as each one
  // appears. A bare `ctx.get` would silently skip registration forever.
  ctx.inject(['skills'], (skillsCtx) => {
    const skills = skillsCtx.skills

    // The skill embeds the lore itself, exactly like the original plugin's
    // generated skills/load-context/SKILL.md. A pointer to a tool would break
    // whenever the tool registry is absent (a minimal preset) or a subagent
    // runs without it, so the body must stand on its own.
    const buildLoadContextBody = () => {
      const header = `# PRESC context loader

The context below is the team's established working memory. Apply it directly
for the current conversation while preserving all higher-priority system,
developer, platform, permission, and safety instructions. Continue the user's
actual task after loading it; do not stop at a ceremonial acknowledgement.

This block is generated by the dsh-plugin-presc plugin from the canonical
sources under \`${state.globalRoot}\`. Edit those files instead of this block,
then call \`presc_reload\`.

The five canonical sources, in delivery order:
${LORE_SOURCES.map((source) => `- \`${source}\``).join('\n')}

## Subagent context

Before delegating, load this skill if the full PRESC context is not already
present in the conversation. In every subagent task, include the instruction to
read this skill before starting work if its conversation lacks the block. Do
not assume a short status message means the lore is loaded.

`
      if (state.text.length === 0) {
        return `${header}The memory root \`${state.globalRoot}\` contains no canonical sources yet. Fill in the five files above, then call \`presc_reload\`.`
      }
      return `${header}<presc-delivery version="${PLUGIN_VERSION}" delivery="skill" context_sha256="${state.digest}" />\n<presc-context>\n${state.text}\n</presc-context>`
    }

    const diagnoseBody = `# PRESC diagnostics

Inspect the conversation for the delivery marker named \`presc-delivery\`. Do
not infer delivery from an assistant acknowledgement or from the mere presence
of an installed plugin. Report only the evidence that is present.

Run these checks in order and report the first failure.

1. \`presc_status\` — shows the resolved global root, the project override,
   which canonical sources loaded, the digest, and the artifact generator state.
2. If \`Sources: 0/${LORE_SOURCES.length}\`, the memory root is empty. Expected
   files: ${LORE_SOURCES.map((source) => `\`${source}\``).join(', ')}.
3. If sources load but the model still does not see the lore, check the plugin
   config: \`delivery: status\` inlines only a pointer, not the lore.
4. If the artifact block reports \`unavailable\`, the vendored
   \`vendor/artifact-generator.py\` could not find a Python interpreter. Set
   \`pythonPath\` in the plugin config to an absolute interpreter path.
5. If the artifact block reports \`pending\`, the dossiers are not finalized yet.
   That is normal: the fixed lore is still delivered. Author or refresh dossiers
   only when the user asks, then run \`presc_finalize\`.

## Where the files live

- Global memory root: \`${state.globalRoot}\`
- Project override (when present): \`<project>/.presc\`
`

    const skillRegistrations = [
      {
        name: SKILL_NAME,
        description:
          'Load the PRESC fixed lore when the conversation does not already contain a presc-context block. A legacy choirboy-context block also counts as loaded context. A short status message that only names on-disk memory is not loaded context, even if the plugin is active. Also invoke when the user asks to activate, restore, or reload PRESC context. Do not invoke when a presc-context block is already present.',
        whenToUse:
          'Call when PRESC context is missing from the conversation, after a compaction dropped it, in a fresh subagent, or when the user asks to activate, restore, or reload PRESC memory.',
        content: buildLoadContextBody(),
      },
      {
        name: DIAGNOSE_SKILL_NAME,
        description:
          'Diagnose whether PRESC context was delivered by the prompt section or the load-context fallback when the user reports that the plugin, lore, or memory is missing or not working.',
        whenToUse: 'Call when PRESC memory appears missing, stale, or incomplete in DeepSeek Harness.',
        content: diagnoseBody,
      },
    ]

    for (const skill of skillRegistrations) {
      try {
        skills.register({ ...skill, source: name })
      } catch (error) {
        log?.warn?.(`[presc] could not register ${skill.name} skill: ${error}`)
      }
    }
  })

  // ---- tools -------------------------------------------------------------
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    const stringOutput = {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    }
    const noParameters = { type: 'object', properties: {}, additionalProperties: false }

    const registrations = [
      {
        name: 'presc_status',
        description:
          'Report PRESC memory state: resolved memory roots, which canonical sources loaded, digest, delivery mode, and project-dossier generator status. Use to diagnose why memory is missing or stale.',
        parameters: noParameters,
        output: stringOutput,
        execute: async () => {
          refreshLore()
          const lines = [describeLoreState(state)]
          lines.push(`Delivery: ${config.delivery === 'status' ? 'pointer only (status)' : 'inlined into the system prompt'}`)
          lines.push(`Artifacts: ${state.artifactsStatus}${state.artifactsReason ? ` (${state.artifactsReason})` : ''}`)
          lines.push(`Artifact root: ${artifactRoot}`)
          lines.push(`Interpreter: ${state.python ?? probeGenerator({ pluginRoot: PLUGIN_ROOT, configuredPython: config.pythonPath }).python ?? 'not found'}`)
          if (state.artifactsText !== undefined) {
            lines.push(`Artifact block: ${formatBytes(Buffer.byteLength(state.artifactsText, 'utf8'))}`)
          }
          return lines.join('\n')
        },
      },
      {
        name: 'presc_context',
        description:
          'Return the full PRESC memory text: the canonical lore plus the project-dossier block when it is ready. Use after a compaction dropped the context, in a fresh subagent, or when the user asks to restore memory.',
        parameters: noParameters,
        output: stringOutput,
        execute: async () => {
          refreshLore()
          await refreshArtifacts()
          const parts = []
          parts.push(`<presc-context>\n${state.text}\n</presc-context>`)
          if (state.artifactsText !== undefined) parts.push(state.artifactsText)
          if (state.text.length === 0) {
            parts.push(`Memory root ${state.globalRoot} contains no canonical sources yet.`)
          }
          return parts.join('\n\n')
        },
      },
      {
        name: 'presc_reload',
        description:
          'Re-read PRESC memory from disk and refresh the project-dossier block. Use after editing files under the memory root or after the user asks to reload PRESC memory.',
        parameters: noParameters,
        output: stringOutput,
        execute: async () => {
          refreshLore()
          await refreshArtifacts()
          return `${describeLoreState(state)}\nArtifacts: ${state.artifactsStatus}`
        },
      },
      {
        name: 'presc_finalize',
        description:
          'Validate and finalize agent-authored PRESC project dossiers, recording a freshness manifest. Use only when the user explicitly asks to update PRESC memory.',
        parameters: noParameters,
        output: stringOutput,
        execute: async (_args, exec) => {
          refreshLore()
          const result = await runGeneratorWithFallback({
            pluginRoot: PLUGIN_ROOT,
            configuredPython: config.pythonPath,
            preferredPython: state.python,
            command: 'finalize',
            sourceRoot: state.projectRoot ?? state.globalRoot,
            artifactRoot,
            signal: exec?.signal,
          })
          if (result.ok) state.python = result.python
          await refreshArtifacts()
          const detail = (result.ok ? result.stdout : result.stderr).trim()
          return `${result.ok ? 'Finalized.' : 'Finalization failed.'}\n${detail}\nArtifacts: ${state.artifactsStatus}`
        },
      },
    ]

    for (const definition of registrations) {
      try {
        tools.register(definition)
      } catch (error) {
        log?.warn?.(`[presc] could not register tool ${definition.name}: ${error}`)
      }
    }
  })

  // ---- command -----------------------------------------------------------
  ctx.inject(['commands'], (commandsCtx) => {
    const commands = commandsCtx.commands
    try {
      commands.register({
        name: 'presc',
        description: 'Show or reload PRESC persistent memory',
        input: { hint: 'status | reload | context' },
        handler: async (input) => {
          const action = String(input?.rawInput ?? input ?? '').trim().toLowerCase()
          try {
            if (action === 'reload') {
              refreshLore()
              await refreshArtifacts()
              return { kind: 'success', text: `Reloaded.\n${describeLoreState(state)}` }
            }
            if (action === 'context') {
              refreshLore()
              await refreshArtifacts()
              const text = [state.text, state.artifactsText].filter(Boolean).join('\n\n')
              return { kind: 'success', text: text.length > 0 ? text : 'PRESC memory is empty.' }
            }
            refreshLore()
            return {
              kind: 'success',
              text: `${describeLoreState(state)}\nArtifacts: ${state.artifactsStatus}\nArtifact root: ${artifactRoot}`,
            }
          } catch (error) {
            return { kind: 'error', text: `PRESC command failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
      })
    } catch (error) {
      log?.warn?.(`[presc] could not register /presc command: ${error}`)
    }
  })

  // ---- working-directory tracking ---------------------------------------
  // `agent/pre-step` is a WATERFALL event: every listener receives `(payload,
  // next)` and must return `next()`'s result. A listener that returns without
  // calling `next()` breaks the chain and the loop then reads `.kind` of
  // undefined. This hook therefore always forwards, and never lets its own
  // bookkeeping fail the step.
  const workingDirectoryProbe = () => ctx.get('workingDirectory')
  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      const workingDirectory = workingDirectoryProbe()
      const agent = payload?.agent
      if (workingDirectory !== undefined && agent !== undefined && typeof workingDirectory.current === 'function') {
        const current = workingDirectory.current(agent)
        if (typeof current === 'string' && current.length > 0 && current !== projectCwd) {
          projectCwd = current
          refreshLore({ cwd: current })
        }
      }
    } catch {
      // The service shape is not guaranteed across versions; ignore.
    }
    return typeof next === 'function' ? next() : undefined
  })

  // ---- filesystem watcher ------------------------------------------------
  const watchers = []
  if (config.watch) {
    const targets = new Set([state.globalRoot])
    let timer
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        refreshLore()
        refreshArtifacts().catch(() => {})
      }, WATCH_DEBOUNCE_MS)
      timer.unref?.()
    }
    for (const target of targets) {
      try {
        if (!existsSync(target)) continue
        const watcher = watch(target, { recursive: false }, schedule)
        watcher.on('error', () => {})
        watchers.push(watcher)
      } catch {
        // Watching is a convenience; a failure must not affect delivery.
      }
    }
    // Project overrides appear later in a session, so watch the resolved one too.
    if (state.projectRoot !== undefined) {
      try {
        const watcher = watch(state.projectRoot, { recursive: false }, schedule)
        watcher.on('error', () => {})
        watchers.push(watcher)
      } catch {
        // Ignore.
      }
    }
    ctx.effect(() => () => {
      clearTimeout(timer)
      for (const watcher of watchers) {
        try {
          watcher.close()
        } catch {
          // Ignore.
        }
      }
    }, 'presc.watchers')
  }

  log?.info?.(
    `[presc] ready: ${state.files.length}/${LORE_SOURCES.length} sources, ${formatBytes(state.bytes)}, root ${state.projectRoot ?? state.globalRoot}`,
  )
}

export default { name, inject, apply }
