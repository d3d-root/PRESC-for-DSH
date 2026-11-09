/**
 * Bridge to the original PRESC artifact generator.
 *
 * The original `presc-prompt` project ships `scripts/artifact-generator.py`,
 * a 1000-line validator that owns the project-dossier lifecycle: it prepares a
 * request manifest, restores a shipped ready bundle when it still matches the
 * canonical sources, validates agent-authored dossiers, and records a
 * freshness manifest. Rather than re-implementing that protocol, this plugin
 * vendors the script and drives it as a subprocess, so an existing memory
 * bundle keeps byte-for-byte compatible behaviour.
 *
 * Every failure is non-fatal: project dossiers are an enhancement over the
 * fixed lore, never a prerequisite for the plugin to load.
 *
 * @module dsh-plugin-presc/artifacts
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Generator commands this plugin drives. */
export const GENERATOR_COMMANDS = Object.freeze([
  'prepare',
  'status',
  'verify',
  'session-context',
  'session-status',
  'finalize',
])

/**
 * Build the candidate list of Python interpreters, most specific first.
 *
 * DSH ships a private CPython under `resources/runtime/primary-runtime/
 * dependencies/python`; using it keeps the plugin working on a machine with no
 * system Python, which is the common Windows case.
 *
 * @param {object} options
 * @param {string} [options.configured] explicit interpreter from plugin config
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {NodeJS.Process} [options.processRef]
 * @returns {string[]}
 */
export function pythonCandidates({ configured, env = process.env, processRef = process } = {}) {
  const candidates = []
  const push = (value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    if (!candidates.includes(trimmed)) candidates.push(trimmed)
  }

  push(configured)
  push(env.PRESC_PYTHON)
  // Legacy variable name, kept so an existing deployment keeps working.
  push(env.CHOIRBOY_PYTHON)
  push(env.DSH_PYTHON)

  const exe = processRef.platform === 'win32' ? 'python.exe' : 'bin/python3'
  const resources = processRef.resourcesPath
  if (typeof resources === 'string' && resources.length > 0) {
    push(join(resources, 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
  }
  const execPath = processRef.execPath
  if (typeof execPath === 'string' && execPath.length > 0) {
    const base = dirname(execPath)
    push(join(base, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
    push(join(base, '..', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
  }

  // `resourcesPath` only exists inside the Electron host. Scripts run under a
  // plain Node interpreter (the maintenance tools, tests) still need the
  // bundled CPython, so also probe the documented install roots.
  const localAppData = env.LOCALAPPDATA
  if (processRef.platform === 'win32' && typeof localAppData === 'string' && localAppData.length > 0) {
    push(join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
    push(join(localAppData, 'Programs', 'dsh', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
  }
  const programFiles = env.PROGRAMFILES
  if (processRef.platform === 'win32' && typeof programFiles === 'string' && programFiles.length > 0) {
    push(join(programFiles, 'DeepSeek Harness', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
  }
  if (processRef.platform !== 'win32') {
    push(join('/opt', 'deepseek-harness', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', exe))
  }

  if (processRef.platform === 'win32') {
    push('python.exe')
    push('python3.exe')
    push('py.exe')
  } else {
    push('python3')
    push('python')
  }
  return candidates
}

/**
 * Run one generator command.
 *
 * @param {object} options
 * @param {string} options.python interpreter to invoke
 * @param {string} options.script absolute path to artifact-generator.py
 * @param {string} options.command one of {@link GENERATOR_COMMANDS}
 * @param {string} options.sourceRoot canonical memory root
 * @param {string} options.artifactRoot artifact root
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ ok: boolean, code: number | null, stdout: string, stderr: string }>}
 */
export function runGenerator({ python, script, command, sourceRoot, artifactRoot, timeoutMs = 20000, signal }) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }

    const args = [script, command, '--source-root', sourceRoot, '--root', artifactRoot]
    let child
    try {
      child = spawn(python, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      })
    } catch (error) {
      finish({ ok: false, code: null, stdout: '', stderr: String(error && error.message ? error.message : error) })
      return
    }

    let stdout = ''
    let stderr = ''
    const cap = 4 * 1024 * 1024
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString('utf8')
    })

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Ignore a process that already exited.
      }
      finish({ ok: false, code: null, stdout, stderr: `${stderr}\nartifact-generator timed out after ${timeoutMs} ms`.trim() })
    }, timeoutMs)
    timer.unref?.()

    const onAbort = () => {
      try {
        child.kill()
      } catch {
        // Ignore a process that already exited.
      }
      finish({ ok: false, code: null, stdout, stderr: 'artifact-generator aborted' })
    }
    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      finish({ ok: false, code: null, stdout, stderr: String(error && error.message ? error.message : error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      finish({ ok: code === 0, code, stdout, stderr })
    })
  })
}

/**
 * Resolve the vendored generator script next to this plugin.
 * @param {string} pluginRoot absolute plugin root
 * @returns {string}
 */
export function generatorScriptPath(pluginRoot) {
  return join(pluginRoot, 'vendor', 'artifact-generator.py')
}

/**
 * Check that the vendored generator and a usable interpreter are present.
 * @param {object} options
 * @returns {{ available: boolean, script?: string, python?: string, reason?: string }}
 */
export function probeGenerator({ pluginRoot, configuredPython, env, processRef }) {
  const script = generatorScriptPath(pluginRoot)
  let scriptPresent = false
  try {
    scriptPresent = existsSync(script) && statSync(script).isFile()
  } catch {
    scriptPresent = false
  }
  if (!scriptPresent) return { available: false, reason: `artifact generator missing at ${script}` }

  const candidates = pythonCandidates({ configured: configuredPython, env, processRef })
  // An absolute candidate that exists is the strongest signal; otherwise the
  // first bare name is attempted and a spawn failure degrades gracefully.
  for (const candidate of candidates) {
    const looksAbsolute = candidate.includes('/') || candidate.includes('\\')
    if (!looksAbsolute) return { available: true, script, python: candidate }
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return { available: true, script, python: resolve(candidate) }
    } catch {
      // Keep looking.
    }
  }
  return { available: false, reason: 'no Python interpreter found; set pythonPath in the plugin config' }
}

/**
 * Parse the generator's `--json` status output.
 * @param {string} stdout
 * @returns {object | undefined}
 */
export function parseStatusJson(stdout) {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return undefined
  const start = trimmed.indexOf('{')
  if (start < 0) return undefined
  try {
    const value = JSON.parse(trimmed.slice(start))
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Run one generator command, trying each candidate interpreter until one works.
 *
 * A missing interpreter reports a spawn `ENOENT`; that is the signal to move to
 * the next candidate rather than to give up, because the machine may have no
 * `python` on `PATH` while DSH ships its own copy.
 *
 * @param {object} options
 * @param {string} options.pluginRoot
 * @param {string} [options.configuredPython]
 * @param {string} options.command
 * @param {string} options.sourceRoot
 * @param {string} options.artifactRoot
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.preferredPython] interpreter that worked last time
 * @returns {Promise<{ ok: boolean, code: number | null, stdout: string, stderr: string, python: string, attempts: string[] }>}
 */
export async function runGeneratorWithFallback({
  pluginRoot,
  configuredPython,
  command,
  sourceRoot,
  artifactRoot,
  timeoutMs = 20000,
  signal,
  preferredPython,
}) {
  const script = generatorScriptPath(pluginRoot)
  const candidates = pythonCandidates({ configured: configuredPython })
  if (typeof preferredPython === 'string' && candidates.includes(preferredPython)) {
    candidates.splice(candidates.indexOf(preferredPython), 1)
    candidates.unshift(preferredPython)
  }

  const attempts = []
  let last = { ok: false, code: null, stdout: '', stderr: 'no interpreter candidates' }
  for (const python of candidates) {
    attempts.push(python)
    const result = await runGenerator({ python, script, command, sourceRoot, artifactRoot, timeoutMs, signal })
    if (result.ok) return { ...result, python, attempts }
    last = result
    // A real generator failure (bad input, validation error) is not fixed by a
    // different interpreter, so stop on anything but a spawn failure.
    if (!isSpawnFailure(result.stderr)) break
  }
  return { ...last, python: attempts[attempts.length - 1] ?? '', attempts }
}

/**
 * Detect the "interpreter could not be started" failure class.
 * @param {string} stderr
 * @returns {boolean}
 */
function isSpawnFailure(stderr) {
  return /ENOENT|not recognized as an internal or external command|No such file or directory|cannot find the file/i.test(
    stderr,
  )
}
