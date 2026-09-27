/* Config builder: form generated from config.SPEC, live preview iframe, overlay URL and settings.js output. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var config = typeof require === 'function' ? require('./config.js') : root.TCO.config;
  var api = factory(root, util, config);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).builder = api;
  if (typeof document !== 'undefined' && document.getElementById && !root.TCO_NO_AUTOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.start(); });
    else api.start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, config) {
  'use strict';

  var IVR_USER = 'https://api.ivr.fi/v2/twitch/user?login=';
  var AVATAR_HOST_RE = /(^|\.)jtvnw\.net$/;
  var RELOAD_DELAY = 800;
  var STORE_CFG = 'tco-builder-cfg';
  var STORE_UI = 'tco-builder-ui';
  var STORE_FILE_BASE = 'tco-builder-file:'; // + folder path: the settings.js last loaded from there
  var STORE_CFG_PATH = 'tco-builder-cfg-path'; // file: only: the folder whose builder saved STORE_CFG
  var HIDDEN_GRACE = 60000; // a live preview left in a hidden tab disconnects after this (ms)
  var BACKDROPS = ['dark', 'light', 'checker', 'busy'];
  var SIZE_LIMITS = { w: [100, 3840], h: [100, 2160] };
  var UI_DEFAULTS = { w: 450, h: 700, backdrop: 'dark' };
  // Suggested OBS source size per layout: a column, or a full-width bar on a 1080p canvas.
  var LAYOUT_SIZES = { vertical: { w: 450, h: 700 }, horizontal: { w: 1920, h: 100 } };

  // Font suggestions live in config.js, which the overlay shares (config.canonicalFont uses them).
  var GOOGLE_FONTS = config.GOOGLE_FONTS;
  var SYSTEM_FONT_NAMES = config.SYSTEM_FONT_NAMES;

  // Human labels and help text per config key. Widgets default from SPEC types.
  var META = {
    size: { label: 'Text size', options: { small: 'Small', medium: 'Medium', large: 'Large' } },
    font: { label: 'Font', help: 'Any Google Fonts family, or a font installed on the streaming PC (Arial, Segoe UI…).' },
    shadow: { label: 'Text shadow', widget: 'range', names: ['None', 'Light', 'Medium', 'Strong'] },
    bg: { label: 'Line background', widget: 'range', unit: '%',
      help: 'A dark rounded box behind each message. Helps on bright or busy scenes.' },
    layout: { label: 'Layout', options: { vertical: 'Vertical', horizontal: 'Horizontal' },
      help: 'Vertical stacks messages in a column. Horizontal puts them side by side in one row, like a ticker: new messages come in on the right and older ones slide off to the left.' },
    align: { label: 'New messages appear', options: { bottom: 'At the bottom', top: 'At the top' },
      // Shown instead while layout is horizontal (see syncLabels).
      horizontal: { label: 'Row sits', help: 'Whether the row runs along the bottom or the top edge of the source. New messages always come in on the right.' } },
    animate: { label: 'Slide in new messages' },
    fade: { label: 'Remove after (seconds)', help: 'The last second fades out. 0 keeps messages until newer ones push them out.' },
    max: { label: 'Max messages on screen', help: 'From 1 to 200.' },
    bots: { label: 'Show bot messages',
      help: 'Nightbot, StreamElements, Streamlabs, Moobot, Fossabot and similar bots, plus the bots listed on the channel’s BetterTTV page.' },
    hide_commands: { label: 'Hide !commands', help: 'Hides messages that start with “!”.' },
    block: { label: 'Hide these users', help: 'Twitch usernames, separated by commas.', placeholder: 'username1, username2' },
    events: { label: 'Show subs, gifts, raids and announcements',
      help: 'Sub, resub, gift sub, raid and bits badge notices, plus /announce messages. When off, all of these are hidden; a resubscriber’s own chat message still shows.' },
    replies: { label: 'Show what replies are answering', help: 'Adds a small “↪ @user: message” line above a reply.' },
    first_msg: { label: 'Mark first-time chatters', help: 'A purple bar beside someone’s first message in the channel.' },
    history: { label: 'Recent messages on load',
      help: 'Shows up to this many recent messages (from recent-messages.robotty.de) when the overlay starts. 0 = off.' },
    shared: { label: 'Include Shared Chat',
      help: 'During a Shared Chat session, also show the other channels’ messages, marked with their avatar.' },
    gifs: { label: 'Show GIFs posted in chat' },
    emotes_7tv: { label: '7TV', help: 'Channel and global emotes, updated live when the channel changes them.' },
    emotes_bttv: { label: 'BetterTTV' },
    emotes_ffz: { label: 'FrankerFaceZ' },
    badges: { label: 'Show badges', help: 'Master switch for every badge source below.' },
    badges_twitch: { label: 'Twitch (sub, mod, VIP, bits…)' },
    badges_7tv: { label: '7TV' },
    badges_bttv: { label: 'BetterTTV (Pro and staff)' },
    badges_ffz: { label: 'FrankerFaceZ (incl. custom mod/VIP)' },
    badges_ffzap: { label: 'FFZ:AP supporters' },
    badges_chatterino: { label: 'Chatterino' },
    badges_homies: { label: 'Chatterino Homies' },
    paints: { label: '7TV name paints', help: 'Gradient and image name colors from 7TV.' },
    stv_lookup: { label: 'Look up 7TV cosmetics for every chatter',
      help: '7TV only announces paints and badges for people running a 7TV extension. This asks 7TV about everyone else, in small rate-limited batches. The answer isn’t checked against subscriptions, so it can show paints for lapsed 7TV subs.' },
    readable: { label: 'Brighten dark name colors', help: 'Lightens very dark usernames so they stay readable.' },
    demo: { label: 'Demo messages in OBS too',
      help: 'Plays fake chat in the real overlay, handy for positioning. The preview has its own Demo / Live chat switch.' },
    debug: { label: 'Debug status line', help: 'Shows which providers loaded or failed, and logs details to the browser console.' }
  };

  var BADGE_SUBS = ['badges_twitch', 'badges_7tv', 'badges_bttv', 'badges_ffz', 'badges_ffzap',
    'badges_chatterino', 'badges_homies'];

  var GROUPS = [
    { id: 'look', title: 'Look', keys: ['layout', 'size', 'font', 'shadow', 'bg', 'align', 'animate'] },
    { id: 'behavior', title: 'Behavior', keys: ['fade', 'max', 'bots', 'hide_commands', 'block', 'events',
      'replies', 'first_msg', 'history', 'shared', 'gifs'] },
    { id: 'emotes', title: 'Emotes', keys: ['emotes_7tv', 'emotes_bttv', 'emotes_ffz'],
      note: 'Twitch emotes are always shown.' },
    { id: 'badges', title: 'Badges & paints', keys: ['badges'].concat(BADGE_SUBS, ['paints', 'stv_lookup', 'readable']),
      note: 'DankChat badges can’t be shown: DankChat’s server doesn’t allow requests from web pages (no CORS header).' },
    { id: 'advanced', title: 'Advanced', keys: ['debug', 'demo'], closed: true }
  ];

  // ---------- pure helpers (unit tested) ----------

  function isLiveKey(k) { return config.LIVE_KEYS.indexOf(k) >= 0; }

  var RELOAD_KEYS = config.KEYS.filter(function (k) { return !isLiveKey(k); });

  // Keys a demo overlay ignores: it loads no history (overlay.js loadHistory), looks up no chatters
  // on 7TV and has no Shared Chat, so changing one (when it is a reload key) needs no demo reload.
  var DEMO_INERT = ['history', 'shared', 'stv_lookup'];

  // Live keys reach the frame by postMessage, so only reload keys decide whether to reload.
  function reloadSignature(pc) {
    return RELOAD_KEYS.map(function (k) {
      return pc.demo && DEMO_INERT.indexOf(k) >= 0 ? '-' : serialize(k, pc[k]);
    }).join('|');
  }

  // GROUPS plus any SPEC key the builder doesn't know yet (appended to Advanced).
  function groupLayout() {
    var seen = {};
    var out = GROUPS.map(function (g) {
      g.keys.forEach(function (k) { seen[k] = true; });
      return { id: g.id, title: g.title, keys: g.keys.filter(function (k) { return !!config.SPEC[k]; }),
        note: g.note, closed: !!g.closed };
    });
    var extra = config.KEYS.filter(function (k) { return k !== 'channel' && !seen[k]; });
    if (extra.length) out[out.length - 1].keys = out[out.length - 1].keys.concat(extra);
    return out;
  }

  function serialize(key, v) {
    var t = config.SPEC[key].type;
    if (t === 'bool') return v ? '1' : '0';
    if (t === 'list') return (v || []).join(',');
    return String(v);
  }

  // Commas are legal in a query string; keep block lists readable.
  function tidyQuery(q) { return q.replace(/%2C/gi, ','); }

  // The URL to paste into OBS: only non-default params (config.toParams). A file:/// overlay always
  // loads the settings.js in its folder, which fills in every key the URL leaves out, so there the
  // URL lists every setting (like the preview) and a settings.js can't change the source.
  function overlayUrl(cfg, baseHref) {
    var u = new URL('overlay.html', baseHref);
    if (u.protocol === 'file:') return previewUrl(cfg, baseHref);
    var q = tidyQuery(config.toParams(cfg).toString());
    u.search = q ? '?' + q : '';
    u.hash = '';
    return u.href;
  }

  // The preview iframe URL: every key explicit, so a settings.js next to overlay.html can't leak in.
  // An empty channel is written too (channel=), for the overlay to read as "no channel".
  function previewUrl(cfg, baseHref) {
    var u = new URL('overlay.html', baseHref);
    var p = new URLSearchParams();
    for (var i = 0; i < config.KEYS.length; i++) {
      var k = config.KEYS[i], v = cfg[k];
      if (k === 'channel') { p.set(k, v ? String(v) : ''); continue; }
      if (v === undefined || v === null) continue;
      p.set(k, serialize(k, v));
    }
    u.search = '?' + tidyQuery(p.toString());
    u.hash = '';
    return u.href;
  }

  // The preview frame's sandbox. An opaque-origin frame may not load file: resources, so from disk the
  // preview would stay blank; there it runs unsandboxed (Chrome still gives each file: page an origin
  // of its own, and OBS runs overlay.html unsandboxed from file: anyway).
  function frameSandbox(protocol) { return protocol === 'file:' ? null : 'allow-scripts'; }

  // IVR's logo is the 600x600 rendition; the builder shows it at 28 px. Twitch serves the same image
  // at 70x70 (the builder falls back to the full one if that ever fails).
  function smallAvatar(url) { return String(url).replace(/-(\d+)x\1(\.\w+)$/, '-70x70$2'); }

  function settingsSnippet(cfg) {
    return '// Twitch Chat Overlay settings. Save as settings.js next to overlay.html.\n' +
      '// Settings in the overlay URL override these.\n' +
      'window.TCO_SETTINGS = ' + JSON.stringify(config.toObject(cfg), null, 2) + ';\n';
  }

  // Own SPEC keys only: '__proto__', 'constructor', 'toString'… are not settings.
  function isKnown(k) { return Object.prototype.hasOwnProperty.call(config.SPEC, String(k).toLowerCase()); }

  // How many settings config.parse will actually take from obj: the ones config.applyObject accepts
  // (a known key with a valid value), onto an empty object.
  function countApplied(obj) { return Object.keys(config.applyObject({}, obj)).length; }

  var JS_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

  // A hand-written settings.js (JS object literal: comments, 'single quotes', unquoted keys,
  // trailing commas) -> the object it assigns, via JSON.parse. Reads the text as data and never
  // evaluates it, so anything that isn't a plain literal (a function call, a variable) throws.
  function relaxedJson(src) {
    src = String(src);
    var out = '', i = 0, n = src.length, comma = false, c, j;
    var emit = function (tok) {
      if (comma && tok !== '}' && tok !== ']') out += ','; // a comma right before } or ] is dropped
      comma = false;
      out += tok;
    };
    while (i < n) {
      c = src.charAt(i);
      if (c === '/' && src.charAt(i + 1) === '/') { j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && src.charAt(i + 1) === '*') { j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        var str = '';
        i++;
        while (i < n && src.charAt(i) !== c) {
          if (src.charAt(i) !== '\\') { str += src.charAt(i++); continue; }
          var e = src.charAt(i + 1), hex = src.substr(i + 2, 4);
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) { str += String.fromCharCode(parseInt(hex, 16)); i += 6; }
          else { str += Object.prototype.hasOwnProperty.call(JS_ESCAPES, e) ? JS_ESCAPES[e] : e; i += 2; }
        }
        if (i >= n) throw new SyntaxError('Unterminated string');
        i++;
        emit(JSON.stringify(str));
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        j = i + 1;
        while (j < n && /[\w$]/.test(src.charAt(j))) j++;
        var word = src.slice(i, j), k = j;
        while (k < n && /\s/.test(src.charAt(k))) k++;
        emit(src.charAt(k) === ':' ? JSON.stringify(word) : word); // unquoted key -> "key"
        i = j;
        continue;
      }
      if (c === ',') { if (comma) out += ','; comma = true; i++; continue; }
      if (/\s/.test(c)) out += c;
      else emit(c);
      i++;
    }
    var a = out.indexOf('{'), b = out.lastIndexOf('}');
    if (a < 0 || b <= a) throw new SyntaxError('No object literal');
    return JSON.parse(out.slice(a, b + 1));
  }

  // An object literal, maybe after leading comments: '{…}' or '// note\n{…}'.
  function startsWithObject(s) {
    var i = 0, n = s.length, c, j;
    while (i < n) {
      c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && s.charAt(i + 1) === '/') { j = s.indexOf('\n', i); if (j < 0) return false; i = j + 1; continue; }
      if (c === '/' && s.charAt(i + 1) === '*') { j = s.indexOf('*/', i + 2); if (j < 0) return false; i = j + 2; continue; }
      return c === '{';
    }
    return false;
  }

  // settings.js text -> its settings object, or null. The builder's own snippet is JSON; a
  // hand-edited copy of settings.example.js needs relaxedJson. Nothing is ever evaluated.
  function readSettingsObject(s) {
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* not JSON: hand-written */ }
    }
    try { return relaxedJson(s); } catch (e2) { return null; }
  }

  // Pasted overlay URL, bare query string, or settings.js / JSON object -> {cfg, count} or null.
  function parsePasted(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    if (/TCO_SETTINGS/.test(s) || startsWithObject(s)) {
      var obj = readSettingsObject(s);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      var n = countApplied(obj);
      return n ? { cfg: config.parse('', obj), count: n } : null;
    }
    var q = s.indexOf('?');
    var search;
    if (q >= 0) search = s.slice(q + 1);
    else if (s.indexOf('=') > 0) search = s;
    else return null;
    search = search.split('#')[0];
    var params = new URLSearchParams(search);
    // As config.parse reads a query: keys lowercased, the last value wins.
    var fromUrl = {};
    params.forEach(function (v, k) { if (isKnown(k)) fromUrl[String(k).toLowerCase()] = v; });
    var count = countApplied(fromUrl);
    return count ? { cfg: config.parse(params), count: count } : null;
  }

  // The builder's first config, from its query string and the remembered config. A link with only
  // ?channel= (the overlay's hints link here) keeps the remembered look and filters; a link with more
  // settings is a whole setup, over the defaults.
  function startCfg(search, stored) {
    var params = new URLSearchParams(search || '');
    var known = [];
    params.forEach(function (v, k) { if (isKnown(k)) known.push(String(k).toLowerCase()); });
    var base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    if (known.length) {
      var onlyChannel = known.every(function (k) { return k === 'channel'; });
      return { cfg: config.parse(params, onlyChannel ? base : null), fromQuery: true, fromStore: false };
    }
    if (base) return { cfg: config.parse('', base), fromQuery: false, fromStore: true };
    return { cfg: config.defaults(), fromQuery: false, fromStore: false };
  }

  // The preview size to switch to when the layout changes, or null to keep the current one. Only a
  // size still at the old layout's suggestion is swapped, so a size the user typed in stays.
  function layoutPreviewSize(ui, prevLayout, nextLayout) {
    var from = LAYOUT_SIZES[prevLayout], to = LAYOUT_SIZES[nextLayout];
    if (!from || !to || prevLayout === nextLayout || !ui) return null;
    return ui.w === from.w && ui.h === from.h ? { w: to.w, h: to.h } : null;
  }

  // A field's label and help for the current layout (a META entry's `horizontal` overrides them).
  function fieldText(key, layout) {
    var m = META[key] || {};
    var alt = layout === 'horizontal' && m.horizontal ? m.horizontal : {};
    return { label: alt.label || m.label || key, help: alt.help || m.help || '' };
  }

  // The full-width preview row (.wide-preview) is for a horizontal chat in a landscape source; a portrait
  // source keeps the tall side column, where it stays readable.
  function wantsWidePreview(layout, w, h) { return layout === 'horizontal' && w > h; }

  // Height (px, border-box) of the wide preview's stage: the source's shape at the available width plus
  // the stage's own padding and border, between 150px and 45% of the window.
  function wideStageHeight(availW, chrome, w, h, winH) {
    var want = Math.ceil(availW * h / w) + chrome;
    var max = Math.max(150, Math.round(winH * 0.45));
    return Math.max(150, Math.min(max, want || 150));
  }

  // Scale factor (<= 1) that fits a w×h source into the available box.
  function fitScale(w, h, availW, availH) {
    if (!(w > 0) || !(h > 0) || !(availW > 0) || !(availH > 0)) return 1;
    return Math.max(0.05, Math.min(1, availW / w, availH / h));
  }

  // IVR /v2/twitch/user bare array -> {state:'found', user} | {state:'notfound'} | {state:'error'}.
  // Like the overlay's own lookup: the entry whose login matches, and only with a numeric id. A reply
  // that doesn't fit is 'error' (the overlay still tries the name), never a missing channel.
  function describeIvrUser(r, login) {
    if (Array.isArray(r) && r.length) {
      var want = String(login || '').toLowerCase();
      // Asked for a login: an answer about someone else is no answer (the overlay ignores it too).
      var u = want ? r.filter(function (x) { return x && String(x.login || '').toLowerCase() === want; })[0] : r[0];
      if (!u || !/^\d+$/.test(util.idStr(u.id))) return { state: 'error' };
      return { state: 'found', user: {
        id: util.idStr(u.id), login: String(u.login || ''), displayName: String(u.displayName || u.login || ''),
        logo: typeof u.logo === 'string' ? u.logo : null, banned: !!u.banned } };
    }
    return { state: 'notfound' };
  }

  function clampInt(v, min, max, def) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(',');
    return a === b;
  }

  function copyCfg(cfg) {
    var o = {};
    for (var k in cfg) o[k] = Array.isArray(cfg[k]) ? cfg[k].slice() : cfg[k];
    return o;
  }

  // ---------- DOM runtime ----------
  var B = null; // builder state, created by start()

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function storage() {
    if (B.storage === undefined) B.storage = util.safeStorage();
    return B.storage;
  }
  function loadStored(key) {
    var s = storage();
    if (!s) return null;
    try { return JSON.parse(s.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function store(key, v) {
    var s = storage();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(v)); } catch (e) { /* quota or blocked */ }
  }
  function saveCfg() {
    store(STORE_CFG, config.toObject(B.cfg));
    // Every file:// page shares one localStorage, so remember which folder these settings came from.
    if (root.location.protocol === 'file:') store(STORE_CFG_PATH, folderOf(root.location.pathname));
  }
  // A page's folder. Keys are per folder, not per file, so a renamed builder file keeps its memory
  // (the builder was index.html before it was builder.html, and old keys hold that full path).
  function folderOf(pathname) { return String(pathname || '').replace(/[^\/]*$/, ''); }
  // The settings.js snapshot last loaded from a folder. Until one is saved under the folder, the one the
  // builder saved as index.html counts; after that the old one is never looked at again.
  function lastSnapshot(folderSnap, legacySnap) {
    return folderSnap === null || folderSnap === undefined ? legacySnap : folderSnap;
  }
  function saveUi() { store(STORE_UI, { w: B.ui.w, h: B.ui.h, backdrop: B.ui.backdrop }); }

  function announce(text) {
    var r = $('sr-status');
    if (!r) return;
    r.textContent = '';
    setTimeout(function () { r.textContent = text; }, 30);
  }

  // ---------- form fields ----------
  function labelFor(key) { return (META[key] && META[key].label) || key; }

  function addHelp(row, key, input) {
    var m = META[key] || {};
    if (!m.help && !m.horizontal) return null; // text that follows the layout needs the element either way
    var p = h('p', 'help', m.help || '');
    p.hidden = !m.help;
    p.id = 'h-' + key;
    row.appendChild(p);
    if (input) input.setAttribute('aria-describedby', p.id);
    return p;
  }

  function widgetFor(key) {
    var s = config.SPEC[key], m = META[key] || {};
    if (m.widget) return m.widget;
    if (s.type === 'bool') return 'check';
    if (s.type === 'enum') return 'seg';
    if (s.type === 'int') return 'number';
    if (s.type === 'font') return 'font';
    return 'text'; // list
  }

  function buildField(key) {
    var spec = config.SPEC[key], m = META[key] || {};
    var row = h('div', 'field field-' + widgetFor(key));
    row.setAttribute('data-key', key);
    var id = 'f-' + key;
    var field = { key: key, row: row, set: function () {}, inputs: [] };

    switch (widgetFor(key)) {
      case 'check': {
        var lab = h('label', 'check');
        var cb = h('input');
        cb.type = 'checkbox';
        cb.id = id;
        lab.appendChild(cb);
        lab.appendChild(h('span', 'check-text', labelFor(key)));
        row.appendChild(lab);
        addHelp(row, key, cb);
        cb.addEventListener('change', function () { update(key, cb.checked); });
        field.inputs.push(cb);
        field.set = function (v) { cb.checked = !!v; };
        break;
      }
      case 'seg': {
        var fs = h('fieldset', 'seg-field');
        field.labelEl = h('legend', 'field-label', labelFor(key));
        fs.appendChild(field.labelEl);
        var seg = h('div', 'seg');
        var radios = [];
        spec.values.forEach(function (val) {
          var l = h('label');
          var r = h('input');
          r.type = 'radio';
          r.name = id;
          r.value = val;
          r.addEventListener('change', function () { if (r.checked) update(key, val); });
          l.appendChild(r);
          l.appendChild(h('span', null, (m.options && m.options[val]) || val));
          seg.appendChild(l);
          radios.push(r);
        });
        fs.appendChild(seg);
        row.appendChild(fs);
        field.helpEl = addHelp(row, key, fs);
        field.inputs = radios;
        field.set = function (v) { radios.forEach(function (r) { r.checked = r.value === v; }); };
        break;
      }
      case 'range': {
        var top = h('div', 'range-head');
        var rl = h('label', 'field-label', labelFor(key));
        rl.htmlFor = id;
        var out = h('output', 'range-value');
        out.htmlFor = id;
        top.appendChild(rl);
        top.appendChild(out);
        var rg = h('input');
        rg.type = 'range';
        rg.id = id;
        rg.min = String(spec.min);
        rg.max = String(spec.max);
        rg.step = '1';
        row.appendChild(top);
        row.appendChild(rg);
        addHelp(row, key, rg);
        var fmt = function (v) {
          if (m.names) return m.names[v] || String(v);
          if (m.unit === '%') return v === 0 ? 'Off' : v + '%';
          return String(v);
        };
        var show = function (v) { out.textContent = fmt(v); rg.setAttribute('aria-valuetext', fmt(v)); };
        rg.addEventListener('input', function () { show(Number(rg.value)); update(key, Number(rg.value)); });
        field.inputs.push(rg);
        field.set = function (v) { rg.value = String(v); show(v); };
        break;
      }
      case 'number': {
        var nl = h('label', 'field-label', labelFor(key));
        nl.htmlFor = id;
        var num = h('input', 'num');
        num.type = 'number';
        num.id = id;
        num.min = String(spec.min);
        num.max = String(spec.max);
        num.step = '1';
        num.inputMode = 'numeric';
        row.appendChild(nl);
        row.appendChild(num);
        addHelp(row, key, num);
        // Debounced: typing "50" passes through "5", and max=5 or fade=5 would wipe the preview's lines.
        var nt = null;
        num.addEventListener('input', function () {
          clearTimeout(nt);
          nt = setTimeout(function () { update(key, num.value); }, 400);
        });
        num.addEventListener('change', function () {
          clearTimeout(nt);
          update(key, num.value);
          num.value = String(B.cfg[key]);
        });
        field.inputs.push(num);
        field.set = function (v) { clearTimeout(nt); num.value = String(v); };
        break;
      }
      case 'font': {
        var fl = h('label', 'field-label', labelFor(key));
        fl.htmlFor = id;
        var fi = h('input', 'text');
        fi.type = 'text';
        fi.id = id;
        fi.setAttribute('list', 'font-list');
        fi.autocomplete = 'off';
        fi.spellcheck = false;
        fi.placeholder = String(spec.def);
        row.appendChild(fl);
        row.appendChild(fi);
        var fh = addHelp(row, key, fi);
        var bad = h('p', 'status err', 'Use letters, numbers, spaces and dashes only.');
        bad.id = 'e-' + key;
        bad.hidden = true;
        row.appendChild(bad);
        var timer = null;
        var commit = function (final) {
          clearTimeout(timer);
          var raw = fi.value.trim();
          if (!raw && final) raw = String(spec.def);
          if (!raw) return;
          // Google Fonts only loads the exact spelling: 'roboto' -> 'Roboto', 'press start 2p' -> 'Press Start 2P'.
          var ok = update(key, config.canonicalFont(raw));
          bad.hidden = ok;
          fi.setAttribute('aria-invalid', ok ? 'false' : 'true');
          fi.setAttribute('aria-describedby', (fh ? fh.id + ' ' : '') + (ok ? '' : bad.id));
          if (ok && final) fi.value = B.cfg[key];
        };
        // Debounced so the preview doesn't request a Google Font for every keystroke.
        fi.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { commit(false); }, 600); });
        fi.addEventListener('change', function () { commit(true); });
        field.inputs.push(fi);
        field.set = function (v) { fi.value = v; bad.hidden = true; fi.setAttribute('aria-invalid', 'false'); };
        break;
      }
      default: { // list
        var ll = h('label', 'field-label', labelFor(key));
        ll.htmlFor = id;
        var li = h('input', 'text');
        li.type = 'text';
        li.id = id;
        li.autocomplete = 'off';
        li.spellcheck = false;
        if (m.placeholder) li.placeholder = m.placeholder;
        row.appendChild(ll);
        row.appendChild(li);
        addHelp(row, key, li);
        var lt = null;
        li.addEventListener('input', function () {
          clearTimeout(lt);
          lt = setTimeout(function () { update(key, li.value); }, 400);
        });
        li.addEventListener('change', function () {
          clearTimeout(lt);
          update(key, li.value);
          li.value = (B.cfg[key] || []).join(', ');
        });
        field.inputs.push(li);
        field.set = function (v) { li.value = (v || []).join(', '); };
      }
    }
    return field;
  }

  function buildGroups() {
    var host = $('groups');
    clear(host);
    groupLayout().forEach(function (g) {
      var det = h('details', 'group card');
      det.id = 'group-' + g.id;
      if (!g.closed) det.open = true;
      var sum = h('summary');
      sum.appendChild(h('h2', null, g.title));
      det.appendChild(sum);
      var body = h('div', 'group-body');
      var subs = null;
      g.keys.forEach(function (key) {
        var f = buildField(key);
        B.fields[key] = f;
        if (BADGE_SUBS.indexOf(key) >= 0) {
          if (!subs) {
            subs = h('div', 'subgrid');
            subs.setAttribute('role', 'group');
            subs.setAttribute('aria-label', 'Badge sources');
            body.appendChild(subs);
          }
          f.row.className += ' sub';
          subs.appendChild(f.row);
        } else {
          body.appendChild(f.row);
        }
      });
      if (g.note) body.appendChild(h('p', 'note', g.note));
      det.appendChild(body);
      host.appendChild(det);
    });

    var dl = $('font-list');
    if (dl) {
      clear(dl);
      GOOGLE_FONTS.forEach(function (f) { var o = h('option'); o.value = f; o.label = 'Google Fonts'; dl.appendChild(o); });
      SYSTEM_FONT_NAMES.forEach(function (f) { var o = h('option'); o.value = f; o.label = 'Installed font'; dl.appendChild(o); });
    }
  }

  function syncDisabled() {
    var off = !B.cfg.badges;
    BADGE_SUBS.forEach(function (k) {
      var f = B.fields[k];
      if (!f) return;
      f.inputs.forEach(function (i) { i.disabled = off; });
      if (off) f.row.classList.add('disabled'); else f.row.classList.remove('disabled');
    });
  }

  // Fields whose wording depends on the layout (META `horizontal`; segmented fields only).
  function syncLabels() {
    for (var k in B.fields) {
      var f = B.fields[k];
      if (!f.labelEl || !META[k] || !META[k].horizontal) continue;
      var t = fieldText(k, B.cfg.layout);
      f.labelEl.textContent = t.label;
      if (f.helpEl) {
        f.helpEl.textContent = t.help;
        f.helpEl.hidden = !t.help;
      }
    }
  }

  function syncForm() {
    for (var k in B.fields) B.fields[k].set(B.cfg[k]);
    syncDisabled();
    syncLabels();
  }

  // After a layout change: relabel, and the preview size becomes a bar (or a column again) unless the
  // user set it. fit() then picks the preview row or column.
  function followLayout(prevLayout, nextLayout) {
    // The frame hears about the layout before it is resized, so the overlay holds off trimming lines
    // until both have landed (renderer LAYOUT_SETTLE_MS) instead of trimming for the wrong one.
    postNow();
    syncLabels();
    var s = layoutPreviewSize(B.ui, prevLayout, nextLayout);
    if (s) {
      B.ui.w = s.w;
      B.ui.h = s.h;
      $('pw').value = String(s.w);
      $('ph').value = String(s.h);
      renderSizes();
      saveUi();
    }
    fit();
  }

  // One setting changed from the form. Returns false when the value is invalid.
  function update(key, raw) {
    var v = config.coerce(key, raw);
    if (v === undefined) return false;
    if (sameValue(B.cfg[key], v)) return true;
    var prev = B.cfg[key];
    B.cfg[key] = v;
    if (key === 'layout') followLayout(prev, v);
    onChanged(key);
    return true;
  }

  function onChanged(key) {
    if (key === 'badges') syncDisabled();
    renderOutputs();
    saveCfg();
    if (isLiveKey(key)) postLive();
    else scheduleReload(RELOAD_DELAY);
  }

  // Swap the whole config (paste, reset, settings.js); reload only if a reload key changed.
  function replaceCfg(next) {
    var prev = B.cfg, reload = false;
    if (typeof next.font === 'string' && next.font) next.font = config.canonicalFont(next.font);
    B.cfg = next;
    RELOAD_KEYS.forEach(function (k) { if (!sameValue(prev[k], next[k])) reload = true; });
    syncForm();
    if (prev.layout !== next.layout) followLayout(prev.layout, next.layout);
    $('channel').value = next.channel || '';
    if (next.channel !== B.ch.login || B.ch.state === 'bad') checkChannel(next.channel);
    renderOutputs();
    saveCfg();
    postLive();
    if (reload) scheduleReload(RELOAD_DELAY);
  }

  // ---------- channel ----------
  function commitChannel(force) {
    var input = $('channel');
    var raw = input.value.trim();
    var login = raw ? config.normalizeChannel(raw) : '';
    if (raw && !login) {
      B.chSeq++;
      B.ch = { state: 'bad', login: raw, user: null };
      if (B.cfg.channel) { B.cfg.channel = ''; onChanged('channel'); }
      renderChannel();
      return;
    }
    if (input.value !== login) input.value = login;
    var changed = login !== B.cfg.channel;
    if (changed) { B.cfg.channel = login; onChanged('channel'); }
    if (changed || force || B.ch.login !== login || B.ch.state === 'error' || B.ch.state === 'bad') checkChannel(login);
  }

  function checkChannel(login) {
    var seq = ++B.chSeq;
    if (!login) {
      B.ch = { state: 'empty', login: '', user: null };
      renderChannel();
      scheduleReload(RELOAD_DELAY);
      return;
    }
    var cached = B.chCache.get(login);
    if (cached) { applyChannel(login, cached); return; }
    B.ch = { state: 'checking', login: login, user: null };
    renderChannel();
    util.fetchJson(IVR_USER + encodeURIComponent(login), { timeout: 8000 }).then(function (r) {
      if (seq !== B.chSeq) return;
      var res = util.isNotFound(r) ? { state: 'notfound' } : describeIvrUser(r, login);
      // An odd reply isn't kept: the next check (or the Check button) asks again.
      if (res.state !== 'error') B.chCache.set(login, res);
      applyChannel(login, res);
    }, function (e) {
      if (seq !== B.chSeq) return;
      // IVR answers 400 for names Twitch can't have (e.g. a leading underscore).
      applyChannel(login, e && e.status === 400 ? { state: 'notfound' } : { state: 'error' });
    });
  }

  function applyChannel(login, res) {
    B.ch = { state: res.state, login: login, user: res.user || null };
    renderChannel();
    scheduleReload(150);
  }

  function renderChannel() {
    var box = $('channel-status');
    clear(box);
    var st = B.ch.state, login = B.ch.login;
    var cls = { empty: '', bad: 'err', checking: 'busy', found: 'ok', notfound: 'err', error: 'warn' }[st] || '';
    box.className = 'status' + (cls ? ' ' + cls : '');
    $('channel').setAttribute('aria-invalid', st === 'bad' || st === 'notfound' ? 'true' : 'false');
    if (st === 'empty') {
      box.textContent = 'Enter your channel to preview its emotes and badges.';
    } else if (st === 'bad') {
      box.textContent = 'That isn’t a valid Twitch name. Use letters, numbers and _ only.';
    } else if (st === 'checking') {
      box.textContent = 'Checking “' + login + '”…';
    } else if (st === 'found') {
      var u = B.ch.user;
      if (u.logo && util.isSafeUrl(u.logo, AVATAR_HOST_RE)) {
        var img = h('img', 'avatar');
        var full = u.logo, small = smallAvatar(full);
        img.src = small;
        img.alt = '';
        img.width = 28;
        img.height = 28;
        img.decoding = 'async';
        img.onerror = function () {
          if (small !== full) { small = full; img.src = full; } // no 70x70 rendition: the full image, once
          else img.remove();
        };
        box.appendChild(img);
      }
      var t = h('span');
      t.appendChild(h('strong', null, u.displayName || login));
      t.appendChild(document.createTextNode(' found (id ' + u.id + ')'));
      if (u.banned) {
        box.className = 'status warn';
        t.appendChild(document.createTextNode(', but the channel is suspended, so its chat may stay empty.'));
      }
      box.appendChild(t);
    } else if (st === 'notfound') {
      box.textContent = 'No Twitch channel called “' + login + '” was found.';
    } else {
      box.textContent = 'Couldn’t check “' + login + '” right now. The overlay will still try this name.';
    }
    renderOutputs();
  }

  // ---------- paste existing URL ----------
  function loadPasted() {
    var input = $('paste'), st = $('paste-status');
    var text = input.value.trim();
    if (!text) { st.className = 'status'; st.textContent = ''; return; }
    var res = parsePasted(text);
    if (!res) {
      st.className = 'status err';
      st.textContent = 'No overlay settings found. Paste the full overlay URL (…/overlay.html?channel=…) or a settings.js.';
      return;
    }
    replaceCfg(res.cfg);
    st.className = 'status ok';
    st.textContent = 'Loaded ' + res.count + ' setting' + (res.count === 1 ? '' : 's') + '. Everything else is back to its default.';
  }

  // ---------- outputs ----------
  function renderOutputs() {
    var url = overlayUrl(B.cfg, root.location.href);
    $('bar-url').value = url;
    $('bar-open').href = url;
    $('out-url').textContent = url;
    $('out-open').href = url;

    var n = Object.keys(config.toObject(B.cfg)).filter(function (k) { return k !== 'channel'; }).length;
    $('url-note').textContent = /^file:/i.test(url)
      ? 'The URL lists every setting, so a settings.js in the overlay’s folder can’t change this source.'
      : n
        ? 'The URL holds only the ' + n + ' setting' + (n === 1 ? '' : 's') + ' you changed; everything else uses the defaults.'
        : 'Every setting is at its default, so the URL only needs the channel.';

    var warn = $('url-warn'), msg = '';
    if (!B.cfg.channel) msg = 'Add a channel first. Without one the overlay only shows a hint.';
    else if (B.ch.state === 'notfound' && B.ch.login === B.cfg.channel) msg = 'Twitch has no channel called “' + B.cfg.channel + '”. Check the spelling.';
    warn.textContent = msg;
    warn.hidden = !msg;
    $('bar-warn').hidden = !!B.cfg.channel;

    $('out-settings').textContent = settingsSnippet(B.cfg);
  }

  function renderSizes() {
    var ws = document.querySelectorAll('.obs-w'), hs = document.querySelectorAll('.obs-h');
    for (var i = 0; i < ws.length; i++) ws[i].textContent = String(B.ui.w);
    for (var j = 0; j < hs.length; j++) hs[j].textContent = String(B.ui.h);
  }

  function flash(btn, text) {
    if (!btn) return;
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.textContent = text;
    btn.classList.add('flash');
    clearTimeout(btn._tcoTimer);
    btn._tcoTimer = setTimeout(function () {
      btn.textContent = btn.getAttribute('data-label');
      btn.classList.remove('flash');
    }, 1600);
    announce(text);
  }

  function execCopy(text) {
    var active = document.activeElement;
    var ta = h('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (active && active.focus) { try { active.focus(); } catch (e) { /* ignore */ } }
    return ok;
  }

  function selectNode(node) {
    try {
      if (node.select) { node.focus(); node.select(); return; }
      var r = document.createRange();
      r.selectNodeContents(node);
      var sel = root.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* ignore */ }
  }

  // navigator.clipboard needs a secure context (not OBS docks / LAN http); fall back to execCommand.
  function copyText(text, btn, fallbackNode) {
    var done = function (ok) {
      flash(btn, ok ? 'Copied!' : 'Press Ctrl+C');
      if (!ok && fallbackNode) selectNode(fallbackNode);
    };
    var nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText && root.isSecureContext) {
      nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(execCopy(text)); });
    } else {
      done(execCopy(text));
    }
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
      var href = URL.createObjectURL(blob);
      var a = h('a');
      a.href = href;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- preview ----------
  function previewChannel() {
    var st = B.ch.state;
    return B.cfg.channel && B.ch.login === B.cfg.channel && (st === 'found' || st === 'error') ? B.cfg.channel : '';
  }

  function previewCfg() {
    var c = copyCfg(B.cfg);
    c.channel = previewChannel();
    c.demo = B.mode === 'demo' || !!B.cfg.demo;
    return c;
  }

  function setHint(text) {
    var el = $('stage-hint');
    el.textContent = text || '';
    el.hidden = !text;
  }

  function scheduleReload(delay) {
    clearTimeout(B.reloadTimer);
    B.reloadTimer = setTimeout(doReload, delay === undefined ? RELOAD_DELAY : delay);
  }

  function doReload() {
    B.reloadTimer = null;
    if (B.paused) return; // a live preview in a hidden tab: rebuilt when the tab shows again
    if (B.ch.state === 'checking') { setHint(B.frame ? '' : 'Checking the channel…'); return; } // the result reschedules
    var pc = previewCfg();
    var st = B.ch.state, hint = '';
    if (!pc.channel) {
      if (st === 'notfound') hint = 'Channel “' + B.ch.login + '” was not found.';
      else if (st === 'bad') hint = 'The channel name isn’t valid.';
      if (pc.demo) hint = (hint ? hint + ' ' : '') + 'Demo chat with global emotes only. Enter a channel to preview its own emotes and badges.';
      else hint = (hint ? hint + ' ' : '') + 'Enter a channel (then press Enter) to watch its live chat here.';
    } else if (B.mode === 'live' && B.cfg.demo) {
      hint = 'Demo messages are switched on under Advanced, so the overlay shows fake chat.';
    }
    setHint(hint);
    if (!pc.channel && !pc.demo) setFrame(null, null);
    // Badge and paint data a source turned on later is loaded by the overlay when the setting arrives.
    else setFrame(previewUrl(pc, root.location.href), reloadSignature(pc));
  }

  function setFrame(src, sig) {
    if (sig === B.frameSig && (sig === null || B.frame)) return;
    if (B.frame) {
      // Removing the frame unloads the old overlay, which closes its sockets.
      B.frame.parentNode.removeChild(B.frame);
      B.frame = null;
    }
    B.frameSig = sig;
    if (!src) return;
    var f = h('iframe', 'preview-frame');
    f.title = 'Overlay preview';
    // The preview can show any channel's live chat, so it runs sandboxed: scripts only, in an origin of its
    // own, with no reach into this page or its storage. (Settings still arrive by postMessage.) Not from
    // disk, where a sandboxed frame can't load overlay.html's files (see frameSandbox).
    var sb = frameSandbox(root.location.protocol);
    if (sb) f.setAttribute('sandbox', sb);
    f.src = src;
    f.addEventListener('load', function () { if (B.frame === f) postLive(); });
    B.frame = f;
    $('frame-box').appendChild(f);
    fit();
  }

  function postNow() {
    clearTimeout(B.postTimer);
    B.postTimer = null;
    var f = B.frame;
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage({ type: 'tco-config', cfg: previewCfg() }, '*'); } catch (e) { /* ignore */ }
  }

  // Coalesce bursts (slider drags) into one message per ~frame.
  function postLive() {
    if (B.postTimer) return;
    B.postTimer = setTimeout(postNow, 30);
  }

  function fit() {
    var stage = $('stage'), box = $('frame-box');
    var wide = wantsWidePreview(B.cfg.layout, B.ui.w, B.ui.h);
    $('builder').classList.toggle('wide-preview', wide);
    var cs = root.getComputedStyle(stage);
    var padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var aw = stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    stage.style.height = wide ? wideStageHeight(aw, padV + (parseFloat(cs.borderTopWidth) || 0) +
      (parseFloat(cs.borderBottomWidth) || 0), B.ui.w, B.ui.h, root.innerHeight) + 'px' : '';
    var ah = stage.clientHeight - padV;
    pinPreview(wide);
    var s = fitScale(B.ui.w, B.ui.h, aw, ah);
    box.style.width = Math.floor(B.ui.w * s) + 'px';
    box.style.height = Math.floor(B.ui.h * s) + 'px';
    if (B.frame) {
      B.frame.style.width = B.ui.w + 'px';
      B.frame.style.height = B.ui.h + 'px';
      B.frame.style.transform = s < 1 ? 'scale(' + s + ')' : 'none';
    }
    $('scale-note').textContent = B.ui.w + ' × ' + B.ui.h + (s < 1 ? ' · shown at ' + Math.round(s * 100) + '%' : ' · 100%');
  }

  function fitSoon() {
    if (B.fitQueued) return;
    B.fitQueued = true;
    var run = function () { B.fitQueued = false; fit(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  // The wide preview stays pinned above the scrolling settings only while it leaves most of the window
  // free. Scroll padding then keeps #settings (the skip link) and focused fields from landing under it.
  function pinPreview(wide) {
    var pv = $('preview');
    var pin = wide && root.innerWidth >= 1000 && pv.offsetHeight <= root.innerHeight * 0.4;
    $('builder').classList.toggle('pin-preview', pin);
    document.documentElement.style.scrollPaddingTop = pin ? (pv.offsetHeight + 16) + 'px' : '';
  }

  function setBackdrop(v) {
    B.ui.backdrop = v;
    var stage = $('stage');
    BACKDROPS.forEach(function (b) { stage.classList.remove('bd-' + b); });
    stage.classList.add('bd-' + v);
  }

  function wirePreview() {
    var modes = document.querySelectorAll('input[name="pmode"]');
    Array.prototype.forEach.call(modes, function (r) {
      r.checked = r.value === B.mode;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        B.mode = r.value === 'live' ? 'live' : 'demo';
        scheduleReload(RELOAD_DELAY);
      });
    });
    var bds = document.querySelectorAll('input[name="backdrop"]');
    Array.prototype.forEach.call(bds, function (r) {
      r.checked = r.value === B.ui.backdrop;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        setBackdrop(r.value);
        saveUi();
      });
    });
    setBackdrop(B.ui.backdrop);

    ['w', 'h'].forEach(function (dim) {
      var inp = $(dim === 'w' ? 'pw' : 'ph');
      var lim = SIZE_LIMITS[dim];
      inp.min = String(lim[0]);
      inp.max = String(lim[1]);
      inp.value = String(B.ui[dim]);
      inp.addEventListener('input', function () {
        var n = parseInt(inp.value, 10);
        if (!isFinite(n) || n < lim[0] || n > lim[1]) return;
        B.ui[dim] = n;
        fit();
        renderSizes();
        saveUi();
      });
      inp.addEventListener('change', function () {
        B.ui[dim] = clampInt(inp.value, lim[0], lim[1], B.ui[dim]);
        inp.value = String(B.ui[dim]);
        fit();
        renderSizes();
        saveUi();
      });
    });

    // A frame later: fit() may resize the stage it observes, which inside the callback is a loop warning.
    if (root.ResizeObserver) new root.ResizeObserver(fitSoon).observe($('stage'));
    // Also for height-only window changes: the wide stage's height and pinning follow the window.
    root.addEventListener('resize', fitSoon);

    // A live preview is a second chat client (IRC, 7TV and BTTV sockets, lookups). In a tab left hidden
    // it disconnects after a while; a quick switch to OBS to paste the URL keeps it.
    var hideTimer = null;
    document.addEventListener('visibilitychange', function () {
      clearTimeout(hideTimer);
      if (document.hidden) {
        hideTimer = setTimeout(function () {
          if (!document.hidden || previewCfg().demo || !B.frame) return;
          B.paused = true;
          setFrame(null, null);
        }, HIDDEN_GRACE);
      } else if (B.paused) {
        B.paused = false;
        scheduleReload(0);
      }
    });
  }

  // ---------- wiring ----------
  function wireChannel() {
    var ch = $('channel');
    ch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitChannel(false); }
    });
    ch.addEventListener('change', function () { commitChannel(false); });
    $('channel-check').addEventListener('click', function () {
      var login = config.normalizeChannel(ch.value);
      // The blur before this click may already have started the same lookup.
      if (B.ch.state === 'checking' && B.ch.login === login) return;
      B.chCache.delete(login);
      commitChannel(true);
    });

    var paste = $('paste');
    // A textarea (keeps a pasted settings.js's line breaks): Enter loads, Shift+Enter adds a line.
    paste.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); loadPasted(); }
    });
    paste.addEventListener('paste', function () { setTimeout(loadPasted, 0); });
    $('paste-load').addEventListener('click', loadPasted);
  }

  function wireOutputs() {
    $('bar-copy').addEventListener('click', function () { copyText($('bar-url').value, $('bar-copy'), $('bar-url')); });
    $('out-copy').addEventListener('click', function () { copyText($('out-url').textContent, $('out-copy'), $('out-url')); });
    $('settings-copy').addEventListener('click', function () {
      copyText($('out-settings').textContent, $('settings-copy'), $('out-settings'));
    });
    $('settings-dl').addEventListener('click', function () {
      var ok = download('settings.js', $('out-settings').textContent);
      flash($('settings-dl'), ok ? 'Downloaded' : 'Download failed: copy it instead');
    });
    $('bar-url').addEventListener('focus', function () { this.select(); });
    $('reset').addEventListener('click', function () {
      var d = config.defaults();
      d.channel = B.cfg.channel;
      replaceCfg(d);
      flash($('reset'), 'Reset');
    });
  }

  // Local-file flow: opened from disk, show the settings.js route first and pick up an existing settings.js.
  // A settings.js the builder already loaded once doesn't replace the edits made here since (a snapshot of
  // it per folder says so); a new or changed settings.js does.
  function setupLocalFile(hasQuery, fromStore) {
    if (root.location.protocol !== 'file:') return;
    document.body.classList.add('is-file');
    var obs = $('obs'), local = $('obs-local'), urlBlock = $('obs-url');
    if (obs && local && urlBlock) urlBlock.parentNode.insertBefore(local, urlBlock);
    $('file-intro').hidden = false;
    $('file-url-note').hidden = false;
    var get = $('step-get-files');
    if (get) get.hidden = true;
    if (hasQuery) return;
    var s = document.createElement('script');
    s.src = 'settings.js?t=' + Date.now();
    s.onload = function () {
      var o = root.TCO_SETTINGS;
      if (!o || typeof o !== 'object') return;
      var fileCfg = config.parse('', o);
      var snap = JSON.stringify(config.toObject(fileCfg));
      var key = STORE_FILE_BASE + folderOf(root.location.pathname);
      var seen = lastSnapshot(loadStored(key), loadStored(key + 'index.html'));
      var note = $('file-loaded');
      if (fromStore && seen === snap) {
        if (note) {
          note.textContent = 'Kept your changes from last time: the settings.js in this folder hasn’t changed since the builder loaded it.';
          note.hidden = false;
        }
        return;
      }
      store(key, snap);
      replaceCfg(fileCfg);
      if (note) note.hidden = false;
    };
    s.onerror = function () { /* no settings.js yet: fine */ };
    document.head.appendChild(s);
  }

  function initialCfg() { return startCfg(root.location.search, loadStored(STORE_CFG)); }

  function start() {
    if (B || !$('builder')) return;
    // The Inter stylesheet comes in as media="print" so a slow font host can't hold up the page or
    // its scripts (the CSP allows no inline onload); it applies once loaded.
    var font = $('font-css');
    if (font) {
      var useFont = function () { font.media = 'all'; };
      if (font.sheet) useFont(); else font.addEventListener('load', useFont);
    }
    B = {
      cfg: config.defaults(),
      fields: {},
      ch: { state: 'empty', login: '', user: null },
      chSeq: 0,
      chCache: new Map(),
      mode: 'demo',
      ui: { w: UI_DEFAULTS.w, h: UI_DEFAULTS.h, backdrop: UI_DEFAULTS.backdrop },
      frame: null,
      frameSig: null,
      reloadTimer: null,
      postTimer: null,
      fitQueued: false,
      paused: false,
      storage: undefined
    };
    var u = loadStored(STORE_UI);
    if (u && typeof u === 'object') {
      B.ui.w = clampInt(u.w, SIZE_LIMITS.w[0], SIZE_LIMITS.w[1], UI_DEFAULTS.w);
      B.ui.h = clampInt(u.h, SIZE_LIMITS.h[0], SIZE_LIMITS.h[1], UI_DEFAULTS.h);
      if (BACKDROPS.indexOf(u.backdrop) >= 0) B.ui.backdrop = u.backdrop;
    }

    buildGroups();
    wireChannel();
    wireOutputs();
    wirePreview();
    renderSizes();

    var init = initialCfg();
    // Read before replaceCfg saves: stored settings from another folder's builder aren't "your changes" here.
    var ownStore = init.fromStore && folderOf(loadStored(STORE_CFG_PATH)) === folderOf(root.location.pathname);
    renderChannel();
    replaceCfg(init.cfg);
    // A stored preview size may belong to the other layout (1920×100 saved in a horizontal session,
    // then ?channel=… opens a vertical one): swap it like a layout switch would.
    var other = B.cfg.layout === 'horizontal' ? 'vertical' : 'horizontal';
    if (layoutPreviewSize(B.ui, other, B.cfg.layout)) followLayout(other, B.cfg.layout);
    scheduleReload(0);
    setupLocalFile(init.fromQuery, ownStore);
    fit();
  }

  return {
    start: start,
    META: META,
    GROUPS: GROUPS,
    BADGE_SUBS: BADGE_SUBS,
    DEMO_INERT: DEMO_INERT,
    LAYOUT_SIZES: LAYOUT_SIZES,
    RELOAD_KEYS: RELOAD_KEYS,
    GOOGLE_FONTS: GOOGLE_FONTS,
    SYSTEM_FONT_NAMES: SYSTEM_FONT_NAMES,
    isLiveKey: isLiveKey,
    groupLayout: groupLayout,
    overlayUrl: overlayUrl,
    previewUrl: previewUrl,
    settingsSnippet: settingsSnippet,
    parsePasted: parsePasted,
    relaxedJson: relaxedJson,
    reloadSignature: reloadSignature,
    frameSandbox: frameSandbox,
    folderOf: folderOf,
    lastSnapshot: lastSnapshot,
    smallAvatar: smallAvatar,
    layoutPreviewSize: layoutPreviewSize,
    wantsWidePreview: wantsWidePreview,
    wideStageHeight: wideStageHeight,
    fieldText: fieldText,
    fitScale: fitScale,
    describeIvrUser: describeIvrUser,
    startCfg: startCfg
  };
});
