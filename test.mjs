#!/usr/bin/env node
/**
 * Offline checks for dsh-preset-inspector.
 *
 * Nothing here needs a running server: the host half is pure data shaping plus
 * one event listener, so a stub context exercises every path that matters, and
 * the browser half is a string that must never leak the sequences that would
 * close its own <script> or <style> element.
 *
 *   node test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const here = path.dirname(new URL(import.meta.url).pathname)
const { apply, buildSnapshot, flatten, evalDisabled, toolsOf } = await import(path.join(here, 'index.js'))
const { PRESET_CSS, PRESET_JS } = await import(path.join(here, 'ui.js'))

let passed = 0
const check = (label, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok   ${label}`)
  } catch (error) {
    console.error(`  FAIL ${label}\n       ${error.message}`)
    process.exitCode = 1
  }
}

console.log('\nbrowser half')
check('lib/client.js exists and registers under the package name', async () => {
  const client = fs.readFileSync(path.join(here, 'lib', 'client.js'), 'utf8')
  const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'))
  assert.match(client, /__ModuleLoader__\.load/)
  assert.ok(client.includes(`id: ${JSON.stringify(pkg.name)}`), 'client id must be the package name')
  assert.match(client, /exports\.apply = apply/)
})

console.log('\nindex-inject payload')
check('script text cannot close its own element', () => {
  assert.equal(/<\/script/i.test(PRESET_JS), false)
})
check('style text cannot close its own element', () => {
  assert.equal(/<\/style/i.test(PRESET_CSS), false)
})
check('script probes the global the host sets', () => {
  assert.match(PRESET_JS, /__dshPresets/)
})
check('launcher and overlay ids are namespaced', () => {
  assert.match(PRESET_JS, /data-pi-launcher/)
  assert.match(PRESET_JS, /data-pi-overlay/)
})

console.log('\ndisabled-gate evaluation')
check('absent gate means enabled', () => {
  assert.equal(evalDisabled(undefined), false)
})
check('literal true disables', () => {
  assert.equal(evalDisabled(true), true)
})
check('a platform expression is evaluated, not guessed', () => {
  assert.equal(evalDisabled({ __js: "process.platform === 'win32'" }), process.platform === 'win32')
})
check('an expression needing a live context is conditional', () => {
  assert.equal(evalDisabled({ __js: 'ctx.get("profileContext").ready' }), 'conditional')
})

console.log('\ncomposition flattening')
check('groups are flattened, nested groups too', () => {
  const rows = flatten([
    { id: 'a', name: 'pkg-a' },
    {
      id: 'grp',
      name: 'cordis:group',
      group: true,
      config: [
        { id: 'b', name: 'pkg-b' },
        { id: 'inner', name: 'cordis:group', group: true, config: [{ id: 'c', name: 'pkg-c' }] },
      ],
    },
  ])
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c'])
})
check('a disabled row is marked, not dropped', () => {
  const rows = flatten([{ id: 'off', name: 'pkg', disabled: true }])
  assert.equal(rows[0].enabled, false)
})

console.log('\ntool attribution')
{
  const yamlDir = path.join(here, 'node_modules')
  check('a missing package yields no tools instead of throwing', () => {
    assert.deepEqual(toolsOf(null, 'nope').names, [])
  })
  check('run_code is never attributed to a package', () => {
    const dshRoot = (() => {
      const nvm = path.join(os.homedir(), '.nvm', 'versions')
      for (const v of fs.existsSync(nvm) ? fs.readdirSync(nvm) : []) {
        const p = path.join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
        if (fs.existsSync(p)) return p
      }
      return null
    })()
    if (!dshRoot) return
    const dir = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-tools')
    if (!fs.existsSync(dir)) return
    assert.equal(toolsOf(dir, '@deepseek-ai/dsh-tools').names.includes('run_code'), false)
  })
}

console.log('\nsnapshot build against a stub registry')
{
  const calls = []
  const ctx = {
    loader: {
      entries: () => [
        { options: { id: 'tool-working-directory', name: '@deepseek-ai/dsh-tool-working-directory' }, disabled: false },
        { options: { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' }, disabled: true },
        { options: { id: 'grp', name: 'cordis:group', group: true }, disabled: false },
      ],
    },
    agentPresets: {
      defaultId: 'standard',
      definitions: new Map([
        ['standard', {
          config: {
            id: 'standard',
            name: 'Standard',
            order: 1,
            plugins: [
              { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
              {
                id: 'skill-filesystem',
                name: '@deepseek-ai/dsh-skill-filesystem',
                config: { includeDefaultRoots: false, customSkillDirs: [path.join(here, '..')] },
              },
            ],
          },
          generation: {},
        }],
      ]),
      list: async () => [{ id: 'standard', name: 'Standard', order: 1, isDefault: true }],
    },
    baseUrl: new URL('file://' + here + '/'),
    effect: (fn) => { calls.push(fn); return () => {} },
    on: () => {},
    logger: { warn: () => {} },
  }

  const snapshot = await buildSnapshot(ctx)
  check('reports support when a registry exists', () => assert.equal(snapshot.supported, true))
  check('the default preset is identified', () => assert.equal(snapshot.defaultId, 'standard'))
  check('a host row that is enabled is inherited by the preset', () => {
    const names = snapshot.presets[0].tools.map((t) => t.name)
    assert.ok(names.includes('working_directory'), names.join(','))
    assert.ok(snapshot.presets[0].tools.some((t) => t.source === 'host' && t.plugin === '@deepseek-ai/dsh-tool-working-directory'))
  })
  check('a disabled host row does not reach the preset', () => {
    assert.equal(snapshot.inherited.some((h) => h.id === 'tool-fs'), false)
  })
  check('a preset row still supplies its own tools', () => {
    const names = snapshot.presets[0].tools.map((t) => t.name)
    for (const n of ['read', 'write', 'edit']) assert.ok(names.includes(n), n)
  })
  check('skill roots are counted and named', () => {
    const root = snapshot.presets[0].skills[0]
    assert.equal(root.source, 'custom')
    assert.ok(Array.isArray(root.names))
  })
  check('counts agree with the arrays', () => {
    const p = snapshot.presets[0]
    assert.equal(p.counts.tools, p.tools.length)
    assert.equal(p.counts.conditional, p.conditional.length)
    assert.equal(p.counts.rows, p.rows.length)
  })
  check('the snapshot is JSON-serializable (it rides in the page)', () => {
    const round = JSON.parse(JSON.stringify(snapshot))
    assert.equal(round.presets.length, snapshot.presets.length)
  })
}

console.log('\napply() wiring')
{
  const handlers = new Map()
  const ctx = {
    on: (event, fn) => { handlers.set(event, fn) },
    effect: () => () => {},
    logger: { warn: () => {} },
    loader: { entries: () => [] },
    agentPresets: null,
  }
  apply(ctx)
  check('it listens for webserver/index-inject', () => assert.ok(handlers.has('webserver/index-inject')))
  check('it refreshes on tools/change', () => assert.ok(handlers.has('tools/change')))
  const table = []
  handlers.get('webserver/index-inject')(table)
  // Data only. The panel is a client module: a `kind: 'script'` row is spliced
  // after <body> and, on this composition, that region is parsed as CSS text —
  // the script never executes. See DECISIONS.md 2026-10-22.
  check('it pushes exactly one data row', () => {
    assert.deepEqual(table.map((r) => r.kind), ['global'])
  })
  check('the global row is named for the browser half', () => {
    assert.equal(table[0].name, '__dshPresets')
  })
  check('it never falls back to an injected script', () => {
    assert.equal(table.some((r) => r.kind === 'script' || r.kind === 'style'), false)
  })
  check('a registry-less composition still injects a truthful payload', () => {
    assert.equal(table[0].value.supported, false)
    assert.ok(table[0].value.reason)
  })
}

console.log(`\n${passed} checks passed${process.exitCode ? ' with failures' : ''}\n`)
// apply() installs a refresh interval by design; a test process must not wait
// for it to fire forever.
process.exit(process.exitCode ?? 0)
