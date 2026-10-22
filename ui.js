/**
 * dsh-preset-inspector — browser half.
 *
 * A read-only panel: which preset holds which capability. The host pushes the
 * snapshot as `globalThis.__dshPresets` through `webserver/index-inject`, so
 * this file never fetches, never authenticates, and never needs a build step.
 *
 * Two views:
 *   Matrix — capability rows × preset columns, so "who has this?" reads across.
 *   Preset — one preset's tools (grouped by the plugin that registers them),
 *            conditional tools with the reason each is not guaranteed, MCP
 *            servers, skill roots with counts, and every composition row.
 */

export const PRESET_CSS = `
[data-pi-launcher] {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 1100;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, #fff);
  color: var(--dsw-alias-label-primary, #111);
  font: 600 12px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: var(--dsw-elevation-prominent, 0 6px 20px rgba(0,0,0,.18));
}
[data-pi-launcher]:hover { filter: brightness(.97); }
[data-pi-launcher] [data-pi-badge] {
  font-weight: 500;
  opacity: .6;
}

[data-pi-overlay] {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.38);
  padding: 24px;
}
[data-pi-overlay][data-open="1"] { display: flex; }

[data-pi-panel] {
  display: flex;
  flex-direction: column;
  width: min(1180px, 100%);
  height: min(84vh, 900px);
  border-radius: 14px;
  overflow: hidden;
  background: var(--dsw-alias-bg-module-platform, #fff);
  color: var(--dsw-alias-label-primary, #111);
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.3));
  box-shadow: 0 24px 80px rgba(0,0,0,.32);
  font: 13px/1.45 -apple-system, system-ui, sans-serif;
}

[data-pi-head] {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.25));
}
[data-pi-head] h2 { margin: 0; font-size: 15px; font-weight: 650; }
[data-pi-head] [data-pi-sub] { font-size: 11px; opacity: .55; }
[data-pi-head] [data-pi-close] {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  opacity: .55;
  padding: 2px 6px;
  border-radius: 6px;
}
[data-pi-head] [data-pi-close]:hover { opacity: 1; background: rgba(127,127,127,.14); }

[data-pi-tabs] {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.25));
}
[data-pi-tab] {
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.35));
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 3px 11px;
  font: 600 11.5px/1.6 inherit;
  cursor: pointer;
  white-space: nowrap;
}
[data-pi-tab]:hover { background: rgba(127,127,127,.12); }
[data-pi-tab][data-active="1"] {
  background: var(--dsw-alias-label-primary, #111);
  color: var(--dsw-alias-bg-module-platform, #fff);
  border-color: transparent;
}
[data-pi-tab] [data-pi-n] { font-weight: 500; opacity: .65; margin-left: 4px; }
[data-pi-tab][data-active="1"] [data-pi-n] { opacity: .8; }

[data-pi-body] { overflow: auto; padding: 14px 16px 24px; flex: 1; }

[data-pi-cards] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
[data-pi-card] {
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.3));
  border-radius: 10px;
  padding: 9px 11px;
  cursor: pointer;
}
[data-pi-card]:hover { background: rgba(127,127,127,.08); }
[data-pi-card][data-broken="1"] { border-color: #d9534f; }
[data-pi-card] b { display: block; font-size: 12.5px; }
[data-pi-card] span { display: block; font-size: 11px; opacity: .6; }

[data-pi-table] { width: 100%; border-collapse: collapse; font-size: 12px; }
[data-pi-table] th, [data-pi-table] td {
  padding: 4px 8px;
  text-align: left;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.16));
  white-space: nowrap;
}
[data-pi-table] thead th {
  position: sticky;
  top: 0;
  background: var(--dsw-alias-bg-module-platform, #fff);
  font-size: 11px;
  opacity: .7;
  z-index: 1;
}
[data-pi-table] td[data-cap] { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
[data-pi-table] td[data-mark] { text-align: center; width: 46px; }
[data-pi-table] td[data-mark="1"] { color: #2f9e44; }
[data-pi-table] td[data-mark="q"] { color: #f08c00; }
[data-pi-table] tr[data-group] td {
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  opacity: .55;
  font-weight: 650;
  padding-top: 12px;
}

[data-pi-sect] { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .55; font-weight: 650; }
[data-pi-sect]:not(:first-child) { margin-top: 20px; }
[data-pi-grid] { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
[data-pi-box] { border: 0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.25)); border-radius: 9px; padding: 8px 10px; }
[data-pi-box] h4 { margin: 0 0 4px; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
[data-pi-box] p { margin: 0; font-size: 11.5px; opacity: .78; word-break: break-word; }
[data-pi-muted] { opacity: .55; }
[data-pi-flag] { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 0.5px solid currentColor; opacity: .7; margin-left: 6px; }
[data-pi-err] { color: #d9534f; font-size: 11.5px; }
[data-pi-rows] { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
[data-pi-rows] div { padding: 1px 0; opacity: .85; }
[data-pi-rows] span[data-off] { opacity: .45; text-decoration: line-through; }
[data-pi-rows] span[data-cond] { opacity: .7; }
`

export const PRESET_JS = String.raw`
(function () {
  if (window.__dshPresetInspectorLoaded) return;
  window.__dshPresetInspectorLoaded = true;

  var data = null;
  var state = { tab: "matrix" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function presetById(id) {
    if (!data || !data.presets) return null;
    for (var i = 0; i < data.presets.length; i++) if (data.presets[i].id === id) return data.presets[i];
    return null;
  }

  // ── matrix ────────────────────────────────────────────────────────────
  function matrixHtml() {
    var cols = data.presets;
    var groups = [
      { label: "MCP servers", key: function (p) { return p.mcps.map(function (m) { return "mcp " + m.server; }); } },
      { label: "Tools", key: function (p) { return p.tools.map(function (t) { return t.name; }); } },
      { label: "Conditional tools", key: function (p) { return p.conditional.map(function (t) { return "? " + t.name; }); } },
      { label: "Skills", key: function (p) { return p.skillNames.map(function (s) { return "skill:" + s; }); } }
    ];

    var html = '<table data-pi-table><thead><tr><th>capability</th>';
    for (var i = 0; i < cols.length; i++) {
      html += "<th title=" + JSON.stringify(cols[i].id) + ">" + esc(cols[i].id.slice(0, 6)) + "</th>";
    }
    html += "</tr></thead><tbody>";

    groups.forEach(function (g) {
      var caps = {};
      var order = [];
      cols.forEach(function (p) {
        g.key(p).forEach(function (k) {
          if (!caps[k]) { caps[k] = {}; order.push(k); }
          caps[k][p.id] = true;
        });
      });
      if (!order.length) return;
      order.sort();
      html += '<tr data-group><td colspan="' + (cols.length + 1) + '">' + esc(g.label) + " (" + order.length + ")</td></tr>";
      order.forEach(function (k) {
        var label = k.replace(/^skill:/, "");
        var cls = k.indexOf("? ") === 0 ? "q" : "1";
        html += '<tr><td data-cap>' + esc(label) + "</td>";
        cols.forEach(function (p) {
          html += caps[k][p.id]
            ? '<td data-mark="' + cls + '">' + (cls === "q" ? "?" : "\u25CF") + "</td>"
            : '<td data-mark="">\u00B7</td>';
        });
        html += "</tr>";
      });
    });

    html += "</tbody></table>";
    return html;
  }

  // ── one preset ────────────────────────────────────────────────────────
  function presetHtml(id) {
    var p = presetById(id);
    if (!p) return '<p data-pi-muted>no such preset</p>';
    var html = "";

    html += '<div data-pi-cards style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">';
    [
      ["tools", p.counts.tools],
      ["conditional", p.counts.conditional],
      ["MCP servers", p.counts.mcps],
      ["skills", p.counts.skills],
      ["rows on", p.counts.active + "/" + p.counts.rows]
    ].forEach(function (kv) {
      html += '<div data-pi-card style="cursor:default"><b>' + esc(kv[1]) + "</b><span>" + esc(kv[0]) + "</span></div>";
    });
    html += "</div>";

    if (p.description) html += '<p data-pi-muted style="margin:0 0 12px">' + esc(p.description) + "</p>";
    if (p.broken) html += '<p data-pi-err><b>BROKEN:</b> ' + esc(p.broken) + "</p>";
    if (!p.live) html += '<p data-pi-muted>No session has composed this preset since boot, so its rows are the declared file rows.</p>';

    // tools, grouped by the plugin that registers them
    html += '<div data-pi-sect>Tools (' + p.counts.tools + ')</div>';
    if (!p.tools.length) html += '<p data-pi-muted>none</p>';
    var byPlugin = {};
    var pluginOrder = [];
    p.tools.forEach(function (t) {
      if (!byPlugin[t.plugin]) { byPlugin[t.plugin] = []; pluginOrder.push(t.plugin); }
      byPlugin[t.plugin].push(t);
    });
    pluginOrder.sort();
    html += '<div data-pi-grid>';
    pluginOrder.forEach(function (plugin) {
      var list = byPlugin[plugin];
      var host = list[0].source === "host";
      html += '<div data-pi-box><h4>' + esc(plugin) +
        (host ? '<span data-pi-flag>inherited from host</span>' : "") + "</h4><p>" +
        esc(list.map(function (t) { return t.name; }).join(", ")) + "</p></div>";
    });
    html += "</div>";

    if (p.conditional.length) {
      html += '<div data-pi-sect>Conditional tools (' + p.conditional.length + ") — not guaranteed at session start</div>";
      html += '<div data-pi-grid>';
      p.conditional.forEach(function (t) {
        html += '<div data-pi-box><h4>' + esc(t.name) + "</h4><p>" + esc(t.reason) + "</p></div>";
      });
      html += "</div>";
    }

    html += '<div data-pi-sect>MCP servers (' + p.counts.mcps + ")</div>";
    if (!p.mcps.length) html += '<p data-pi-muted>none</p>';
    html += '<div data-pi-grid>';
    p.mcps.forEach(function (m) {
      html += '<div data-pi-box><h4>' + esc(m.server) + "</h4><p>" + esc(m.transport + " · " + (m.target || "")) +
        '<br><span data-pi-muted>tool names appear as mcp__' + esc(m.server) + "__* only while the server is connected</span></p></div>";
    });
    html += "</div>";

    html += '<div data-pi-sect>Skill roots</div>';
    if (!p.skills.length) html += '<p data-pi-muted>none — this preset mounts no skill provider</p>';
    html += '<div data-pi-grid>';
    p.skills.forEach(function (r) {
      var label = r.count === null ? "? (resolved at runtime)" : r.count + " skills";
      html += '<div data-pi-box><h4>' + esc(r.source) + "</h4><p>" + esc(r.dir) + "<br>" +
        '<span data-pi-muted>' + esc(label) + (r.names.length ? " · " + esc(r.names.join(", ")) : "") + "</span></p></div>";
    });
    html += "</div>";

    html += '<div data-pi-sect>Composition rows (' + p.counts.rows + ")</div><div data-pi-rows>";
    p.rows.forEach(function (r) {
      var attrs = r.enabled === false ? ' data-off=""' : r.enabled === "conditional" ? ' data-cond=""' : "";
      var mark = r.enabled === false ? "\u00B7" : r.enabled === "conditional" ? "\u25D0" : "\u25CF";
      html += "<div><span" + attrs + ">" + mark + " " + esc(r.id || "\u2014") + "</span>  " + esc(r.module) +
        (r.condition ? '  <span data-pi-muted>' + esc(r.condition.slice(0, 80)) + "</span>" : "") + "</div>";
    });
    html += "</div>";
    return html;
  }

  function render() {
    var overlay = document.querySelector("[data-pi-overlay]");
    if (!overlay) return;
    data = window.__dshPresets || null;

    var head = overlay.querySelector("[data-pi-sub]");
    if (!data || !data.supported) {
      head.textContent = data && data.reason ? data.reason : "no snapshot";
      overlay.querySelector("[data-pi-tabs]").innerHTML = "";
      overlay.querySelector("[data-pi-body]").innerHTML =
        '<p data-pi-err>' + esc((data && data.reason) || "The host has not produced an inventory yet.") + "</p>";
      return;
    }
    head.textContent = data.presets.length + " presets · " + new Date(data.generatedAt).toLocaleTimeString();

    var tabs = '<button data-pi-tab data-tab="matrix" data-active="' + (state.tab === "matrix" ? 1 : 0) + '">Matrix</button>';
    data.presets.forEach(function (p) {
      tabs += '<button data-pi-tab data-tab="' + esc(p.id) + '" data-active="' + (state.tab === p.id ? 1 : 0) + '">' +
        esc(p.id) + '<span data-pi-n="">' + p.counts.tools + "</span></button>";
    });
    overlay.querySelector("[data-pi-tabs]").innerHTML = tabs;
    overlay.querySelector("[data-pi-body]").innerHTML =
      state.tab === "matrix" ? matrixHtml() : presetHtml(state.tab);
  }

  function open(tab) {
    var overlay = document.querySelector("[data-pi-overlay]");
    if (!overlay) return;
    if (tab) state.tab = tab;
    overlay.setAttribute("data-open", "1");
    data = window.__dshPresets || null;
    render();
  }

  function close() {
    var overlay = document.querySelector("[data-pi-overlay]");
    if (overlay) overlay.setAttribute("data-open", "0");
  }

  function mount() {
    if (document.querySelector("[data-pi-launcher]")) return;

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("data-pi-launcher", "");
    launcher.innerHTML = "\u25A6 Presets<span data-pi-badge></span>";
    launcher.addEventListener("click", function () { open(); });

    var overlay = document.createElement("div");
    overlay.setAttribute("data-pi-overlay", "");
    overlay.innerHTML =
      '<div data-pi-panel>' +
        '<div data-pi-head><h2>Preset inventory</h2><span data-pi-sub></span>' +
          '<button data-pi-close title="Close (Esc)">\u00D7</button></div>' +
        '<div data-pi-tabs></div>' +
        '<div data-pi-body></div>' +
      "</div>";

    overlay.addEventListener("click", function (ev) {
      var t = ev.target;
      if (overlay.getAttribute("data-open") !== "1") return;
      if (t === overlay) { close(); return; }
      if (t.closest("[data-pi-close]")) { close(); return; }
      var tab = t.closest("[data-pi-tab]");
      if (tab) { state.tab = tab.getAttribute("data-tab"); render(); return; }
      var card = t.closest("[data-pi-card]");
      if (card && card.getAttribute("data-preset")) { state.tab = card.getAttribute("data-preset"); render(); }
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });

    document.body.appendChild(launcher);
    document.body.appendChild(overlay);

    // The badge shows the preset count as soon as the snapshot exists.
    var tries = 0;
    (function badge() {
      var d = window.__dshPresets;
      if (d && d.supported) {
        var b = launcher.querySelector("[data-pi-badge]");
        if (b) b.textContent = " " + d.presets.length;
        return;
      }
      if (tries++ < 40) setTimeout(badge, 250);
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
`
