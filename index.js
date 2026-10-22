/**
 * dsh-preset-inspector — host half.
 *
 * Answers one question accurately: *what is actually inside preset X?*
 *
 * ── Where the numbers come from ───────────────────────────────────────────
 *
 * `ctx.agentPresets.definitions` is the live registry (`AgentPresetRegistry`):
 * one record per declared preset holding the parsed `config` — `id`, `name`,
 * `description`, `order` and the COMPLETE `plugins` child list. That list is
 * the preset's whole composition: a preset inherits no other preset, and it
 * does not inherit bundle rows selectively. `config.plugins` is therefore the
 * membership truth, and reading it needs no running session.
 *
 * Two things reach a preset anyway, and both are why counting rows alone is
 * wrong:
 *
 *   1. HOST TOOLS. `ToolRuntime.view(scope)` builds a scope's visible set from
 *      the global layer plus the scope's ancestor layers, so a host-level row
 *      that registers tools is visible inside every preset. The shipped
 *      composition leaves most tool plugins at host level as
 *      `disabled: true` and re-mounts them per preset, so only a few leak —
 *      image-gen's six tools, working-directory, and gated others.
 *   2. CONDITIONAL ROWS. A row gated by `!!js` may register nothing on this
 *      platform (pwsh on macOS) and a config gate may switch a tool off
 *      (`list_subagent_models`). Those are reported as conditional, never
 *      counted as present.
 *
 * Tool names are attributed by reading each plugin package's built `lib/`
 * output for `defineTool({ name: … })`, a constant that feeds it, and a
 * per-row `toolName:` override. The result is static, so it also describes a
 * preset that is not mounted, and it is cached per package directory.
 *
 * Skills are discovery, not rows: a preset's skills are the roots its
 * `skill-filesystem` rows scan, plus whatever a plugin registers at runtime.
 *
 * MCP: one `dsh-mcp-client` row with `serverName: x` starts ONE server process
 * at boot and publishes `mcp__x__*` tools. Tools behind an unconnected server
 * are counted as "dynamic" rather than guessed.
 *
 * ── Delivery ──────────────────────────────────────────────────────────────
 *
 * `webserver/index-inject` fires on every index render, and a `global` row is
 * JSON-safe, so the snapshot rides into the page as `globalThis.__dshPresets`
 * with no route, no auth work, and no client bundle build. The panel itself is
 * a `script` + `style` row — the same hook the stock theme plugin uses.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

export const name = 'preset-inspector'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')

// `run_code` is not registered by a plugin: the tool registry adds it to a
// scope whose presentation mode is not native (PTC). It appears in dsh-tools'
// source but belongs to a mode, not to a package.
const MODE_PROVIDED_TOOLS = new Set(['run_code'])

// Host-level rows whose tools do not exist at session start.
const DEFERRED_PACKAGES = new Map([
  ['@anionex/dsh-computer-use', 'tools appear only after the computer-use skill activates them'],
  ['@deepseek-ai/dsh-mcp-resources', 'tools appear only once an MCP server publishes resources'],
  ['@deepseek-ai/dsh-plugin-manager', 'gated on !!js ctx.get("profileContext")'],
])

// Tools a package registers only under a condition this reader cannot evaluate.
const CONDITIONAL_TOOLS = new Map([
  ['list_subagent_models', 'registered only when subagent model selection is enabled'],
])

// A `!!js` node reaches this file in one of two shapes: `{ __js }` when it was
// parsed from YAML text here, and `{ __jsExpr }` when the live Loader kept it
// (that is the field `isJsExpr` tests). Reading only one of them silently
// reports the other as a literal truthy object — which made every
// platform-gated row look disabled.
function jsExprOf(value) {
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.__js === 'string') return value.__js
  if (typeof value.__jsExpr === 'string') return value.__jsExpr
  return undefined
}

// The Loader evaluates a `!!js` `disabled` node and treats a throw as "leave it
// to the mount" (`disabledContribution`, then combineDisabled). Mirror that:
// true = disabled, false = enabled, 'conditional' = needs a live context.
function evalDisabled(value) {
  if (value === undefined) return false
  const expr = jsExprOf(value)
  if (expr === undefined) return Boolean(value)
  try {
    const fn = new Function('process', 'ctx', `return (${expr})`)
    const ctx = { get: () => undefined, has: () => false }
    return Boolean(fn(process, ctx))
  } catch {
    return 'conditional'
  }
}

function flatten(rows, out = []) {
  for (const row of rows ?? []) {
    if (!row || typeof row !== 'object') continue
    const decision = evalDisabled(row.disabled)
    if (row.group === true) {
      flatten(row.config, out)
      continue
    }
    out.push({
      id: row.id ?? null,
      module: row.name,
      enabled: decision === 'conditional' ? 'conditional' : !decision,
      condition: jsExprOf(row.disabled),
      config: row.config,
    })
  }
  return out
}

function splitModule(moduleName) {
  if (!moduleName) return { pkg: null, sub: null }
  const parts = moduleName.split('/')
  const pkg = moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return { pkg, sub: moduleName === pkg ? null : moduleName.slice(pkg.length + 1) }
}

// ──────────────────────────────────────────────────────────── tool scanning

const toolCache = new Map()

function toolsOf(dir, moduleName) {
  if (!dir) return { names: [], approx: false }
  const key = dir + '::' + (moduleName ?? '')
  const hit = toolCache.get(key)
  if (hit) return hit

  const files = []
  const walk = (p, depth) => {
    if (depth > 3 || !fs.existsSync(p)) return
    let entries
    try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const q = path.join(p, e.name)
      if (e.isDirectory()) walk(q, depth + 1)
      else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) files.push(q)
    }
  }
  for (const d of ['lib', 'dist']) walk(path.join(dir, d), 0)

  // A subpath export (`pkg/tools`) mounts one file, not the whole package.
  const { sub } = splitModule(moduleName)
  let scan = files
  let approx = false
  if (sub) {
    const leaf = sub.split('/').pop()
    const narrowed = files.filter((f) => path.basename(f).replace(/\.m?js$/, '').includes(leaf))
    if (narrowed.length) scan = narrowed
    else approx = true
  }

  const names = new Set()
  for (const f of scan) {
    let s
    try { s = fs.readFileSync(f, 'utf8') } catch { continue }
    for (const m of s.matchAll(/toolName:\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) names.add(m[1])
    for (const m of s.matchAll(/defineTool\(\{\s*name:\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) names.add(m[1])
    const consts = new Map()
    for (const m of s.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([a-z][a-z0-9_]{2,40})["'`]/g)) {
      consts.set(m[1], m[2])
    }
    if (consts.size) {
      for (const m of s.matchAll(/defineTool\(\{[\s\S]{0,600}?\bname:\s*([A-Za-z_$][\w$]*)/g)) {
        const got = consts.get(m[1])
        if (got) names.add(got)
      }
    }
  }
  const result = {
    names: [...names].filter((n) => n.length > 1 && !MODE_PROVIDED_TOOLS.has(n)).sort(),
    approx,
  }
  toolCache.set(key, result)
  return result
}

function countSkills(dir) {
  if (!dir || typeof dir !== 'string') return null
  if (!fs.existsSync(dir)) return { count: 0, names: [] }
  const names = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return { count: 0, names: [] } }
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) names.push(e.name)
    else if (e.isFile() && e.name.endsWith('.md')) names.push(e.name.replace(/\.md$/, ''))
  }
  return { count: names.length, names: names.sort() }
}

function skillRoots(config) {
  const c = config ?? {}
  const custom = (c.customSkillDirs ?? []).map((d) => ({
    dir: typeof d === 'string' ? d : d?.__js ? `!!js ${String(d.__js).slice(0, 60)}` : String(d),
    source: 'custom',
  }))
  if (c.includeDefaultRoots === false) {
    return [...custom, ...(c.bundledSkillDir ? [{ dir: c.bundledSkillDir, source: 'bundled' }] : [])]
  }
  return [
    { dir: '«project»/.dsh/skills', source: 'project-dsh' },
    { dir: '«project»/.agents/skills', source: 'project-agents' },
    ...custom,
    { dir: path.join(DSH_HOME, 'skills'), source: 'user-dsh' },
    { dir: path.join(os.homedir(), '.agents', 'skills'), source: 'user-agents' },
    ...(c.bundledSkillDir ? [{ dir: c.bundledSkillDir, source: 'bundled' }] : []),
  ]
}

// ────────────────────────────────────────────────────── package resolution

function makeResolver(ctx) {
  const roots = []
  // The profile directory owns its own node_modules; baseUrl usually points at
  // it, and its node_modules holds the linked custom plugins.
  const base = (() => {
    try {
      const raw = ctx.baseUrl
      if (typeof raw === 'string') return raw.startsWith('file:') ? path.dirname(new URL(raw).pathname) : path.dirname(raw)
      if (raw instanceof URL) return path.dirname(raw.pathname)
    } catch { /* fall through */ }
    return null
  })()
  if (base) {
    roots.push(path.join(base, 'node_modules'))
    roots.push(path.join(path.dirname(base), 'node_modules'))
  }
  // The dsh install's own packages (the shipped plugins and bundles).
  const dshRoot = (() => {
    // 1. The package that owns the CLI that started this process.
    const fromBin = process.argv[1] ? path.resolve(path.dirname(process.argv[1]), '..') : null
    if (fromBin && fs.existsSync(path.join(fromBin, 'node_modules', '@deepseek-ai'))) return fromBin
    // 2. The node running this process: <prefix>/bin/node → <prefix>/lib/node_modules.
    const prefix = path.resolve(path.dirname(process.execPath), '..')
    const fromExe = path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
    if (fs.existsSync(fromExe)) return fromExe
    // 3. Any other node install under nvm (~/.nvm/versions/node/<version>/…).
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node')
    if (fs.existsSync(nvm)) {
      for (const v of fs.readdirSync(nvm)) {
        const p = path.join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
        if (fs.existsSync(p)) return p
      }
    }
    return null
  })()
  if (dshRoot) {
    roots.push(path.join(dshRoot, 'node_modules'))
    roots.push(path.join(dshRoot, 'node_modules', '@deepseek-ai'))
  }
  // Every profile, last: a link: dependency can live in any of them.
  const profilesDir = path.join(DSH_HOME, 'profiles')
  if (fs.existsSync(profilesDir)) {
    for (const p of fs.readdirSync(profilesDir)) roots.push(path.join(profilesDir, p, 'node_modules'))
  }

  const cache = new Map()
  return (moduleName) => {
    if (!moduleName) return null
    if (cache.has(moduleName)) return cache.get(moduleName)
    const { pkg } = splitModule(moduleName)
    let found = null
    for (const root of roots) {
      const dir = path.join(root, pkg)
      if (fs.existsSync(path.join(dir, 'package.json'))) { found = dir; break }
    }
    cache.set(moduleName, found)
    return found
  }
}

// ────────────────────────────────────────────────────────── snapshot build

function hostRows(ctx) {
  let entries
  try { entries = ctx.loader.entries() } catch { return [] }
  const out = []
  for (const entry of entries) {
    const o = entry.options
    if (!o || o.group === true) continue
    if (o.name === '@deepseek-ai/dsh-agent-preset') continue
    if (entry.disabled === true) continue
    out.push({ id: o.id ?? null, module: o.name, condition: o.disabled })
  }
  return out
}

async function buildSnapshot(ctx) {
  const reg = ctx.agentPresets
  if (!reg) return { supported: false, reason: 'no agent-preset registry in this composition' }
  const resolve = makeResolver(ctx)

  // Declared metadata plus the live diagnostic, both from the registry itself.
  let roster = []
  try { roster = await reg.list() } catch (e) { roster = [] }
  const rosterById = new Map(roster.map((r) => [r.id, r]))

  const defs = reg.definitions instanceof Map ? reg.definitions : new Map()
  const presets = []

  // Host rows whose tools reach every preset scope.
  const inherited = []
  for (const h of hostRows(ctx)) {
    const dir = resolve(h.module)
    const { pkg } = splitModule(h.module)
    if (pkg === '@deepseek-ai/dsh-mcp-client') {
      inherited.push({ id: h.id, module: h.module, tools: [], mcp: true })
      continue
    }
    if (DEFERRED_PACKAGES.has(pkg)) {
      inherited.push({ id: h.id, module: h.module, tools: [], deferred: toolsOf(dir, h.module).names, reason: DEFERRED_PACKAGES.get(pkg) })
      continue
    }
    const { names } = toolsOf(dir, h.module)
    if (names.length) inherited.push({ id: h.id, module: h.module, tools: names })
  }

  for (const [id, record] of defs) {
    const cfg = record.config ?? {}
    const rows = flatten(cfg.plugins)
    const tools = []
    const conditional = []
    const mcps = []
    const skills = []
    const skillNames = new Set()
    const seen = new Set()

    const addTool = (toolName, plugin, entryId, source) => {
      if (seen.has(toolName)) return
      seen.add(toolName)
      const why = CONDITIONAL_TOOLS.get(toolName)
      if (why) conditional.push({ name: toolName, plugin, entryId, source, reason: why })
      else tools.push({ name: toolName, plugin, entryId, source })
    }

    for (const h of inherited) {
      for (const t of h.tools) addTool(t, h.module, h.id, 'host')
      for (const d of h.deferred ?? []) conditional.push({ name: d, plugin: h.module, entryId: h.id, source: 'host', reason: h.reason })
    }

    for (const r of rows) {
      if (r.enabled === false) continue
      const dir = resolve(r.module)
      const { pkg } = splitModule(r.module)
      if (pkg === '@deepseek-ai/dsh-mcp-client') {
        mcps.push({
          server: r.config?.serverName ?? r.id,
          transport: r.config?.transport ?? 'stdio',
          target: r.config?.command
            ? `${r.config.command} ${(r.config.args ?? []).join(' ')}`.trim()
            : (r.config?.url ?? null),
          origin: 'preset',
        })
        continue
      }
      if (pkg === '@deepseek-ai/dsh-skill-filesystem') {
        for (const root of skillRoots(r.config)) {
          const counted = root.dir.startsWith('«') || root.dir.startsWith('!!js') ? null : countSkills(root.dir)
          skills.push({
            source: root.source,
            dir: root.dir,
            count: counted ? counted.count : null,
            names: counted ? counted.names : [],
          })
          for (const n of counted?.names ?? []) skillNames.add(n)
        }
        continue
      }
      const scan = toolsOf(dir, r.module)
      const names = new Set(scan.names)
      if (typeof r.config?.toolName === 'string') names.add(r.config.toolName)
      for (const n of names) {
        if (r.enabled === 'conditional') {
          conditional.push({
            name: n,
            plugin: r.module,
            entryId: r.id,
            source: 'preset',
            reason: `row gated by !!js ${String(r.condition ?? '').slice(0, 70)}`,
          })
        } else addTool(n, r.module, r.id, 'preset')
      }
    }

    tools.sort((a, b) => a.name.localeCompare(b.name))
    conditional.sort((a, b) => a.name.localeCompare(b.name))
    const meta = rosterById.get(id) ?? {}

    presets.push({
      id,
      name: meta.name ?? cfg.name ?? null,
      description: meta.description ?? cfg.description ?? null,
      order: meta.order ?? cfg.order ?? null,
      isDefault: meta.isDefault === true,
      broken: meta.broken ?? null,
      rows: rows.map((r) => ({ id: r.id, module: r.module, enabled: r.enabled, condition: r.condition ?? null })),
      live: record.generation !== undefined,
      tools,
      conditional,
      mcps,
      skills,
      skillNames: [...skillNames].sort(),
      counts: {
        rows: rows.length,
        active: rows.filter((r) => r.enabled !== false).length,
        tools: tools.length,
        conditional: conditional.length,
        mcps: mcps.length,
        skills: skillNames.size,
        skillRootsUncounted: skills.filter((s) => s.count === null).length,
      },
    })
  }

  presets.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  return {
    supported: true,
    generatedAt: new Date().toISOString(),
    defaultId: reg.defaultId ?? null,
    inherited: inherited.map((h) => ({ id: h.id, module: h.module, tools: h.tools ?? [], deferred: h.deferred ?? [], reason: h.reason ?? null })),
    presets,
  }
}

// ────────────────────────────────────────────────────────────────── plugin

export function apply(ctx) {
  let snapshot = null
  let building = null

  const rebuild = () => {
    if (building) return building
    building = (async () => {
      try {
        snapshot = await buildSnapshot(ctx)
      } catch (error) {
        snapshot = { supported: false, reason: String(error?.message ?? error) }
        ctx.logger?.warn?.(`preset-inspector: ${String(error?.message ?? error)}`)
      } finally {
        building = null
      }
      return snapshot
    })()
    return building
  }

  // First pass after the tree settles, then a slow refresh. The injections are
  // read on every index render, so a page load always gets the latest snapshot.
  const first = setTimeout(() => { void rebuild() }, 1500)
  const timer = setInterval(() => { void rebuild() }, 60_000)
  const debounce = (() => {
    let t = null
    return () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => { void rebuild() }, 400)
    }
  })()

  ctx.effect(() => () => {
    clearTimeout(first)
    clearInterval(timer)
  }, 'preset-inspector.timers')

  ctx.on('tools/change', debounce)
  ctx.on('agent-preset/selected', debounce)

  // Data only. The panel itself is a CLIENT MODULE (`./client`), because a
  // `kind: 'script'` row is spliced immediately after `<body>` and on this
  // composition that region is parsed as CSS text: the injected <script> never
  // executes. A `global` row lands in <head> and survives, so the host ships the
  // snapshot and the client module renders it.
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__dshPresets',
      value: snapshot ?? { supported: false, reason: 'first inventory pass has not finished' },
    })
  })
}

// Exported for a one-shot inspection from the CLI (`node -e`), and so a test
// can build a snapshot without a running server.
export { buildSnapshot, flatten, toolsOf, evalDisabled, pathToFileURL }
