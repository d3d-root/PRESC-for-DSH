# PRESC for DSH

**Persistent project memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

PRESC gives an agent a memory that outlives the conversation: the rules you work
by, the projects you have built, the decisions already made, and the lessons that
cost you something to learn. It is assembled into the system prompt of every
session, so the agent starts already knowing instead of asking again.

Install it and it works. The package ships a complete memory bundle, copies it
into place on first activation, and from then on reads your own copy — which you
can edit freely and which no upgrade will overwrite.

---

## The problem

An agent runtime starts each conversation blank. Everything the two of you
established — the architecture you settled on, the approach you rejected and why,
the boundary you agreed not to cross, the bug that took a night to find — is
gone. So it gets re-explained, and re-explained slightly differently each time.
That is drift, and drift is expensive.

The usual fixes are unsatisfying:

- **Paste the context every session.** Manual, and it decays as the project moves.
- **Write one long `AGENTS.md`.** Works until it does not: no structure, no
  validation, no way to know whether what the agent read is current.
- **Rely on the model's own memory.** Opaque, inconsistent across runtimes, and
  it cannot tell a settled decision from a stale one.

PRESC takes a different position: treat project memory as **versioned, validated
source material**, and deliver it through the harness's own prompt pipeline.

## The idea

Three things make this work, and they are worth stating plainly because they are
the whole design.

**1. Memory is a context layer, not a tool.**

The agent does not call PRESC to remember. The memory is already in the system
prompt before the first token of the user's message is read. Tools exist only to
inspect and maintain that memory — they are the maintenance hatch, not the
engine.

The distinction matters. A tool is something the agent must decide to use, and a
model that does not know it has forgotten something will not think to look it up.
A context layer removes that failure mode entirely.

**2. Source and summary are separate.**

The canonical sources are written by a person and say what is true. The project
dossiers are a validated summary derived from them, one per project, with a
recorded content digest. When the sources change, the dossiers become detectably
stale instead of silently wrong.

**3. Memory is validated, not trusted.**

A dossier is accepted only if it has the required structure, cites its sources,
matches the project list in the lore, and is written in the expected language.
A broken memory is rejected with an exact reason rather than quietly degrading
the agent.

## How it works

```
  your memory (Markdown)                  DeepSeek Harness
  ┌──────────────────────────┐
  │ prompt.md                │
  │ security-posture.md      │──read──┐
  │ lore.md                  │        │
  │ user.md                  │        ▼
  │ context/research-index.md│   ┌──────────────────────────┐
  │ research/NN-topic.md     │   │ systemPrompt.section()   │→ every request
  │ artifacts/INDEX.md       │   │ skills.register()        │→ skill catalog
  │ artifacts/projects/*.md  │   │ tools.register()         │→ presc_* tools
  └──────────────────────────┘   │ commands.register()      │→ /presc
                                 └──────────────────────────┘
                                              │
                    ┌─────────────────────────┴──────────────────┐
                    │ first run: memory/ is copied into place    │
                    │ later runs: your copy is read, never reset │
                    └────────────────────────────────────────────┘
```

Four delivery surfaces, each chosen for a reason:

| Surface | Why |
|---|---|
| `ctx.systemPrompt.section()` | The lore is present on every assembled request and survives compaction, because a prompt section is not conversation history. |
| `ctx.skills.register()` | A `load-context` skill that embeds the lore itself — for subagents, and for sessions where the section is missing. |
| `ctx.tools.register()` | `presc_status`, `presc_context`, `presc_reload`, `presc_finalize` for inspection and maintenance. |
| `ctx.commands.register()` | `/presc` for the person at the keyboard. |

Dossier validation and finalization are delegated to
`vendor/artifact-generator.py`, vendored unmodified from the
[choirboy-prompt](https://github.com/howdeploy/choirboy-prompt) project. The
protocol — request manifest, readiness gate, freshness digests — is kept
byte-compatible, so an existing bundle works unchanged.

## Install

PRESC is an ordinary DSH bundle: `package.json` declares `dsh.bundle.patch`, and
that patch inserts one plugin row.

### From the Web UI

Open **Plugins**, choose **Install bundle**, and give the package name or a path
to this folder. It appears in the plugin list as **PRESC for DSH**.

### From a profile

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "file:C:/path/to/dsh-plugin-presc"
```

Add the bundle to that profile's `package.json`:

```json
"dsh": { "profile": { "bundles": ["...", "dsh-plugin-presc"] } }
```

Restart DSH, or let HMR apply the patch.

### Verify

In a new session:

```
/presc status
```

It reports the memory root, which canonical sources loaded, the content digest,
the delivery mode, and the dossier generator state.

## Use

Nothing is required. Every new session starts with the memory loaded.

| Action | How |
|---|---|
| Inspect state | `/presc status` or `presc_status` |
| Reload after editing | `/presc reload` or `presc_reload` |
| Show the full memory | `/presc context` or `presc_context` |
| Finalize dossiers | `presc_finalize`, after writing them |

## Your memory

The memory root defaults to `$DSH_HOME/presc` (`~/.dsh/presc`).

| File | What to write |
|---|---|
| `prompt.md` | working rules: priorities, style, boundaries |
| `security-posture.md` | security frame and disclosure rules |
| `user.md` | durable collaboration preferences only |
| `lore.md` | real projects: what was decided, what exists, what failed |
| `context/research-index.md` | one line per document in `research/` |
| `research/NN-topic.md` | one decision per file: question, evidence, options, decision, risks, revisit trigger |
| `artifacts/INDEX.md` | index of project dossiers |
| `artifacts/projects/*.md` | one validated dossier per project |

Edit them in any editor. The plugin watches the folder and reloads, or call
`/presc reload`.

### Keeping dossiers valid

Each `###` heading in `lore.md` is a project, and each needs one dossier in
`artifacts/projects/` whose first line is `# ` plus that exact heading. Dossiers
must contain nine sections — `Canon`, `Goal and Outcome`, `Architecture and
Components`, `Decisions and Constraints`, `Operating Workflow`, `Lessons and
Rules`, `Sources`, `Unknowns`, `When to Revisit` — and cite their sources.

If you change `lore.md`, the dossiers become stale: rewrite them and run
`presc_finalize`. Until then the status is `pending` and only the dossier block
is withheld — the lore itself keeps delivering.

`docs/EDITING.md` is the complete editing contract, written so you can hand the
folder to another agent.

### Hand the memory to another agent

```powershell
node export-memory.mjs ./presc-editable
```

Edit the exported folder, then:

```powershell
node apply-memory.mjs ./presc-editable
```

`apply-memory.mjs` validates on a staging copy first. A broken bundle is
reported with exact file names and **the installed memory is not touched**. A
valid bundle is backed up and installed.

### Per-project override

Put a `.presc` folder in a repository root, or any parent of the working
directory. Files in it override the global ones one by one, so a single project
can replace only `lore.md` and keep the shared rules.

## Configuration

Every field is optional; defaults live in `lib/index.js`. Edit the `presc` row in
your profile's `cordis.patch.yml`.

| Field | Default | Meaning |
|---|---|---|
| `memoryDir` | `$DSH_HOME/presc` | global memory root |
| `artifactsDir` | `<memoryDir>/artifacts` | dossiers and manifest |
| `seed` | `true` | copy the shipped bundle into an empty root |
| `projectOverride` | `true` | look for `.presc` in the working directory |
| `delivery` | `section` | `section` inlines the lore; `status` inlines a pointer |
| `order` | `700` | prompt section order |
| `maxLoreBytes` | `131072` | lore size cap |
| `artifacts` | `true` | include project dossiers |
| `artifactsMode` | `auto` | `auto` / `full` / `off` |
| `maxArtifactsBytes` | `24576` | threshold for `auto` |
| `pythonPath` | auto-detect | interpreter for the dossier generator |
| `watch` | `true` | re-read files on change |
| `debug` | `false` | verbose log |

### Token cost

This is the one real trade-off, so it is worth being concrete.

`delivery: section` pays the lore on every request. `artifactsMode: auto` keeps
the dossier block out of the prompt when it exceeds `maxArtifactsBytes` and
offers a pointer instead. For a large memory, use `delivery: status` with
`artifactsMode: auto`: only a short pointer is inlined, and the model reads the
memory on demand with `presc_context`.

A typical bundle of ~30 KiB of lore plus ~85 KiB of dossiers costs roughly 36k
tokens per request when fully inlined. Measure your own bundle with
`/presc status`.

## Requirements

- DSH `>= 0.2.1-rc.2`, Node `>= 20`.
- Python 3 for the dossier generator. The plugin uses the interpreter bundled
  with DSH, then `PATH`; set `pythonPath` if neither is found. Without Python the
  dossiers are skipped and the lore still works.

## How this differs from choirboy-prompt

PRESC is an adaptation of [choirboy-prompt](https://github.com/howdeploy/choirboy-prompt)
for DeepSeek Harness. The method is the same; the delivery mechanism is not.

| choirboy-prompt | PRESC |
|---|---|
| `SessionStart` hook (Claude Code, Codex, 13 runtimes) | ordered prompt section |
| short status only in capped runtimes | full lore inlined, no cap |
| `load-context` skill points at files | skill embeds the lore itself |
| CLI scripts | `presc_*` tools and `/presc` |
| `Stop` hook | not needed |
| `CLAUDE_PLUGIN_DATA` / `XDG_DATA_HOME` | `$DSH_HOME/presc` |
| manual install per runtime | one bundle, installs from the plugin list |

The prompt-section approach is stronger than a hook for one reason: a section is
not conversation history, so it survives compaction and does not inflate the
session log. That is precisely why the original had to fall back to a short
status in Claude Code and Codex — those hooks could not carry the full text.

## Tests

```powershell
node test/package.test.mjs
```

Covers seeding on a fresh root, upgrade safety (an edited file is never
overwritten), registration of every surface, delivery in both modes, and the
empty-root fallback.

CI runs the same suite on Linux and Windows across Node 20 and 22, and validates
the bundled memory with the real generator.

## License

MIT. Vendored `vendor/artifact-generator.py` comes from the
[choirboy-prompt](https://github.com/howdeploy/choirboy-prompt) project (MIT) and
is included unmodified.
