'use strict';
// README.md documents every setting and every stable class name, so a new one can't ship undocumented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../js/config.js');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

// The text of a '## title' section, up to the next '## ' heading.
function section(title) {
  const at = README.indexOf('\n## ' + title + '\n');
  assert.ok(at >= 0, 'README has a "## ' + title + '" section');
  const rest = README.slice(at + 4 + title.length);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}

// The cells of every table row in a section (header and separator rows left out). A section may hold several tables.
function rows(text) {
  const out = [];
  text.split('\n').forEach((line, i, lines) => {
    if (!/^\|/.test(line) || /^\|[\s|:-]+\|$/.test(line)) return;
    if (i + 1 < lines.length && /^\|[\s|:-]+\|$/.test(lines[i + 1])) return; // a header row
    out.push(line.split('|').slice(1));
  });
  return out;
}
// The first cell of every table row in a section.
const firstCells = (text) => rows(text).map((cells) => cells[0]);
const codeIn = (cell) => Array.from(cell.matchAll(/`([^`]+)`/g), (m) => m[1]);

test('README: the Options table has a row for every setting, and for nothing else', () => {
  const cells = firstCells(section('Options'));
  assert.ok(cells.length > 20, 'the scan finds the rows');
  const seen = {};
  cells.forEach((cell) => {
    const keys = codeIn(cell);
    assert.ok(keys.length > 0, 'a row names its option: ' + cell);
    // One row may cover several keys (emotes_7tv, emotes_bttv, emotes_ffz).
    keys.forEach((k) => {
      assert.ok(!seen[k], k + ' has two rows');
      seen[k] = true;
    });
  });
  assert.deepStrictEqual(Object.keys(seen).sort(), config.KEYS.slice().sort());
});

// overlay.css's stable list and the README's Custom CSS table name the same classes, both ways, so a class the README
// promises can't be renamed or dropped with no test noticing.
test('README: the Custom CSS table names the classes overlay.css lists as stable, and no others', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'overlay.css'), 'utf8');
  const m = /Stable class names for OBS "Custom CSS":([\s\S]*?)\*\//.exec(css);
  assert.ok(m, 'overlay.css lists its stable class names');
  const stable = new Set(Array.from(m[1].matchAll(/[.#][\w-]+/g), (x) => x[0]));
  assert.ok(stable.size > 25, 'the scan finds the names');
  // Every class and id in the table's selectors (`.line.notice` names .line and .notice), and a lone class a row's
  // description names (`.ann-blue`, an announcement's bar color).
  const named = new Set();
  rows(section('Custom CSS')).forEach((cells) => {
    codeIn(cells[0]).forEach((sel) => {
      for (const x of sel.matchAll(/[.#][\w-]+/g)) named.add(x[0]);
    });
    codeIn(cells.slice(1).join('|')).forEach((c) => { if (/^\.[a-z][\w-]*$/i.test(c)) named.add(c); });
  });
  stable.forEach((c) => assert.ok(named.has(c), 'README Custom CSS has no row for ' + c));
  named.forEach((c) => assert.ok(stable.has(c), c + ' is in the README Custom CSS table but not in overlay.css\'s stable list'));
  // and what the table names is in the overlay's stylesheet or drawn by the renderer: in code, not just in a comment's
  // words ("a colored bar"), or built from a quoted prefix ('platform-' + 'kick')
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const drawn = code(css) + code(fs.readFileSync(path.join(ROOT, 'js', 'renderer.js'), 'utf8'));
  const esc = (s) => s.replace(/-/g, '\\-');
  named.forEach((c) => {
    const pre = /^.([\w]+-)/.exec(c);
    assert.ok(new RegExp('[\\s.\'"#]' + esc(c.slice(1)) + '\\b').test(drawn) || (pre && drawn.indexOf('\'' + pre[1] + '\'') >= 0), c + ' is real');
  });
});

// The Size limits notes (README's and the home page's) give the caps a crafted history line meets, measured on the real
// code: the tokenizer keeps at most 300 images (emotes, zero-width layers, GIFs and cheermotes), and of those the
// renderer draws at most its MAX_IMAGES emote images (layers included) and shows later emotes as their names.
test('README and home page: the size limits are the caps the overlay keeps', () => {
  const tk = require('../js/tokenizer.js');
  const R = require('../js/renderer.js')._internal;
  const ranges = (from, n, tail) => Array.from({ length: n }, (_, i) => (from + i) + '-' + (from + i) + (tail || '')).join(',');
  const msg = (extra) => Object.assign({ text: 'a'.repeat(400), action: false, emotes: '', gifs: '', bits: 0, msgId: '' }, extra);
  const zw = { provider: '7tv', id: '7tv:Z', name: 'Z', w: 28, h: 28, zw: true, urls: { 1: 'https://cdn.example/Z/1x.webp' } };
  const opts = { lookup: (w) => (w === 'Z' ? zw : null), gifs: true, cheers: true };
  const drawn = (m, types) => R.partsFor(tk.tokenize(msg(m), opts).items, { px: 24, dpr: 1, gifs: true })
    .filter((p) => types.indexOf(p.t) >= 0).length;
  const GU = '|id|https://media.giphy.com/media/abc/giphy.gif';
  const caps = {
    chars: tk.tokenize(msg({ text: 'b'.repeat(1500) }), opts).items.map((i) => i.text).join('').length,
    emotes: drawn({ emotes: '25:' + ranges(0, 400) }, ['emote']),
    images: drawn({ emotes: '25:' + ranges(0, 100), gifs: ranges(100, 300, GU) }, ['emote', 'gif']),
    zw: tk.tokenize(msg({ text: 'a' + ' Z'.repeat(10), emotes: '25:0-0' }), opts).items[0].overlays.length
  };
  assert.deepStrictEqual(caps, { chars: 1000, emotes: R.MAX_IMAGES, images: 300, zw: 4 }, 'the scan measures the caps');
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  [['README', /^- \*\*Size limits\.\*\* (.*)$/m.exec(README)], ['home page', /<dt>Size limits<\/dt><dd>([^<]*)<\/dd>/.exec(home)]]
    .forEach((d) => {
      assert.ok(d[1], d[0] + ' has a Size limits note');
      const said = (re) => { const n = re.exec(d[1][1]); return n ? Number(n[1]) : null; };
      assert.deepStrictEqual({
        chars: said(/cut at (\d+) characters/), emotes: said(/at most (\d+) emote images/),
        images: said(/(\d+) images in all/), zw: said(/at most (\d+) zero-width layers/)
      }, caps, d[0] + '\'s Size limits note');
    });
});

// The mentions row says what makes '@name' part of a longer name and gives examples either side of the rule. The
// matcher's own lookahead takes a '-' before a Latin letter or digit as more name (a Kick slug can go on with one), so
// the row names the '-' and its examples are what the overlay does, in both modes.
test('README: the mentions row\'s examples are what the overlay tints', () => {
  const R = require('../js/renderer.js')._internal;
  const row = /^\| `mentions` \|[^\n]*/m.exec(section('Options'));
  assert.ok(row, 'README has a mentions row');
  const ex = /\bso ([^.]*?) count but ([^.]*?) (?:doesn't|don't)/.exec(row[0]);
  assert.ok(ex, 'the row gives names that count and some that don\'t');
  const yes = codeIn(ex[1]), no = codeIn(ex[2]);
  assert.ok(yes.length >= 2 && no.length >= 1, 'the scan finds the examples');
  assert.ok(/`-`/.test(row[0]) && no.some((s) => /-/.test(s)), 'the row says a "-" can make it part of a longer name');
  ['at', 'name'].forEach((mode) => {
    const cfg = R.normalizeCfg({ mentions: mode, channel: 'name' });
    const tinted = (s) => R.lineClasses({ login: 'viewer', text: s }, cfg, 'chat', false) === 'line mention';
    yes.forEach((s) => assert.ok(tinted(s), mode + ': ' + s + ' counts'));
    no.forEach((s) => assert.ok(!tinted(s), mode + ': ' + s + ' doesn\'t count'));
  });
});

// A builder quick look puts every PRESET_KEYS setting at its value or its default, so the note's "Each sets ..."
// names each: one it left out (the name's own line, the name-color bar) would be reset with the README silent on it.
test('README: the Builder quick looks note names every setting a look sets', () => {
  const builder = require('../js/builder.js');
  const note = /\*\*Builder quick looks:\*\*[^\n]*/.exec(README);
  assert.ok(note, 'README has the Builder quick looks note');
  const sets = /Each sets ([^;]+);/.exec(note[0]);
  assert.ok(sets, 'the note says what each look sets');
  const phrase = {
    size: 'text size', text_px: 'text size', text_weight: 'weight', name_weight: 'name weight',
    text_color: 'color and line spacing', line_height: 'line spacing', shadow: 'shadow', shadow_color: 'shadow',
    outline: 'outline', outline_color: 'outline', bg: 'box', bg_color: 'box', bg_shape: 'box', bg_width: 'box',
    spacing: 'space between messages', accent_bar: 'name-color bar', name_line: 'whether the name has a line of its own',
    emote_scale: 'emote', badge_size: 'badge size'
  };
  assert.deepStrictEqual(Object.keys(phrase).sort(), builder.PRESET_KEYS.slice().sort(), 'a phrase for each look setting');
  Object.keys(phrase).forEach((k) => assert.ok(sets[1].indexOf(phrase[k]) >= 0, 'the note names ' + k + ' ("' + phrase[k] + '")'));
});

// A Custom CSS example that sets a property on #chat itself does something only if it weighs at least as much as the
// stylesheet's own #chat rules for that property: #chat always has one of the size-* classes, so `#chat.size-medium
// { font-size }` beats a plain `#chat { font-size: 28px; }` at every setting. OBS adds its Custom CSS after the page's
// stylesheet, so a tie is enough, and an `!important` declaration always wins.
test('README: a Custom CSS example on #chat outweighs the stylesheet\'s own #chat rules', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'overlay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const onChat = (sel) => /^#chat(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+)*$/.test(sel);
  const weight = (sel) => [(sel.match(/#[\w-]+/g) || []).length, (sel.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length];
  const atLeast = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1]);
  const decls = (body) => body.split(';').map((d) => {
    const at = d.indexOf(':');
    return at < 0 ? null : { prop: d.slice(0, at).trim(), important: /!\s*important/.test(d) };
  }).filter((d) => d && d.prop);
  // property -> the heaviest stylesheet selector on #chat alone that sets it
  const own = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim()).filter(onChat);
    decls(m[2]).forEach((d) => sels.forEach((s) => {
      if (!own[d.prop] || !atLeast(weight(own[d.prop]), weight(s))) own[d.prop] = s;
    }));
  }
  assert.strictEqual(own['font-size'], '#chat.size-small', 'the scan finds the size rules');
  let checked = 0;
  codeIn(section('Custom CSS')).forEach((code) => {
    const rule = /^([^{}@]+)\{([^{}]*)\}$/.exec(code.trim());
    if (!rule) return;
    rule[1].split(',').map((s) => s.trim()).filter(onChat).forEach((sel) => decls(rule[2]).forEach((d) => {
      if (d.important || !own[d.prop]) return;
      checked++;
      assert.ok(atLeast(weight(sel), weight(own[d.prop])),
        '`' + code + '` loses to the stylesheet\'s `' + own[d.prop] + ' { ' + d.prop + ' }`, so it does nothing');
    }));
  });
  assert.ok(checked > 0, 'the README gives a Custom CSS example that changes a #chat property the stylesheet sets');
});

test('README: the URL length note gives the limit the builder warns at, and the word lists point to it', () => {
  const builder = require('../js/builder.js');
  const opts = section('Options');
  const note = /^- \*\*URL length:\*\* (.*)$/m.exec(opts);
  assert.ok(note, 'Options has a URL length note');
  assert.match(note[1], new RegExp('over about ' + builder.MAX_URL_BYTES.toLocaleString('en-US') + ' characters'));
  assert.match(note[1], /settings\.js/);
  ['block_words', 'keywords'].forEach((k) => {
    const row = opts.split('\n').filter((l) => l.indexOf('| `' + k + '` |') === 0)[0];
    assert.match(row, /see \*\*URL length\*\* above/, k);
  });
});

// How large text_px and emote_scale can get before a horizontal row in the suggested 1920 × 100 source cuts its lines
// off (measured in headless Chrome on the demo chat). Along the bottom edge a reply's header is a block above its
// message, so it is cut first: at about 32 px text, or past about 150% emotes with a box (165% without) at medium
// text. Other lines fit up to about 46 px text. The builder's help and the README give the same limits.
test('README and builder help: text_px and emote_scale give a horizontal row\'s limits, reply headers included', () => {
  const builder = require('../js/builder.js');
  const opts = section('Options');
  const row = (k) => opts.split('\n').filter((l) => l.indexOf('| `' + k + '` |') === 0)[0] || '';
  const limits = { text_px: ['about 46 px', 'about 32 px'], emote_scale: ['about 150', '165'] };
  Object.keys(limits).forEach((k) => {
    [['builder help', builder.META[k].help], ['README row', row(k)]].forEach((t) => {
      const where = t[0] + ' of ' + k;
      assert.match(t[1], /100 px tall source/, where + ' names the 100 px tall source');
      assert.match(t[1], /reply.s header/, where + ' names a reply\'s header');
      limits[k].forEach((n) => assert.ok(t[1].indexOf(n) >= 0, where + ' gives "' + n + '"'));
    });
  });
});
