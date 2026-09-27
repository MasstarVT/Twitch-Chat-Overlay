'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../js/config.js');
const builder = require('../js/builder.js');

const BASE = 'https://masstarvt.github.io/Twitch-Chat-Overlay/index.html?x=1#top';

test('every config key except channel is in exactly one form group, with a label', () => {
  const seen = {};
  builder.groupLayout().forEach((g) => g.keys.forEach((k) => {
    assert.ok(!seen[k], 'duplicate key ' + k);
    seen[k] = true;
    assert.ok(builder.META[k] && builder.META[k].label, 'missing label for ' + k);
  }));
  config.KEYS.filter((k) => k !== 'channel').forEach((k) => assert.ok(seen[k], 'missing field for ' + k));
  assert.ok(!seen.channel);
  assert.deepStrictEqual(builder.groupLayout().map((g) => g.title),
    ['Look', 'Behavior', 'Emotes', 'Badges & paints', 'Advanced']);
});

test('enum option labels cover every SPEC value', () => {
  Object.keys(config.SPEC).forEach((k) => {
    const s = config.SPEC[k];
    if (s.type !== 'enum') return;
    s.values.forEach((v) => assert.ok(builder.META[k].options[v], k + '=' + v));
  });
});

test('reload keys are exactly the non-live keys', () => {
  assert.deepStrictEqual(builder.RELOAD_KEYS.slice().sort(),
    config.KEYS.filter((k) => config.LIVE_KEYS.indexOf(k) < 0).sort());
  ['channel', 'debug', 'demo', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'history', 'stv_lookup']
    .forEach((k) => assert.ok(builder.RELOAD_KEYS.indexOf(k) >= 0, k));
  assert.ok(!builder.isLiveKey('channel'));
});

test('overlayUrl resolves next to the builder and holds only non-default params', () => {
  const cfg = config.defaults();
  assert.strictEqual(builder.overlayUrl(cfg, BASE), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html');
  cfg.channel = 'forsen';
  assert.strictEqual(builder.overlayUrl(cfg, BASE), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=forsen');
  cfg.size = 'large';
  cfg.animate = false;
  cfg.block = ['nightbot', 'some_user'];
  cfg.font = 'Open Sans';
  const url = builder.overlayUrl(cfg, BASE);
  assert.strictEqual(url, 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=forsen&size=large&font=Open+Sans&animate=0&block=nightbot,some_user');
  assert.deepStrictEqual(config.parse(new URL(url).searchParams), cfg);
});

test('overlayUrl from a file:// builder lists every setting, so a settings.js there cannot fill any in', () => {
  const cfg = config.defaults();
  cfg.channel = 'xqc';
  cfg.block = ['a_b', 'c'];
  const url = builder.overlayUrl(cfg, 'file:///E:/Github/Twitch%20Chat%20Overlay/index.html');
  assert.ok(url.startsWith('file:///E:/Github/Twitch%20Chat%20Overlay/overlay.html?channel=xqc&'), url);
  const p = new URL(url).searchParams;
  config.KEYS.forEach((k) => assert.ok(p.has(k), 'missing ' + k));
  assert.strictEqual(p.get('size'), 'medium');
  assert.strictEqual(p.get('bots'), '0');
  assert.strictEqual(p.get('demo'), '0');
  // A settings.js that changes defaults loses to every key in the URL.
  const settings = { channel: 'streamer', size: 'large', fade: 30, bots: true, demo: true, block: ['x'] };
  assert.deepStrictEqual(config.parse(p, settings), cfg);
  // and the long URL still round-trips through the paste box
  const r = builder.parsePasted(url);
  assert.deepStrictEqual(r.cfg, cfg);
  assert.strictEqual(r.count, config.KEYS.length);
  // Hosted builders keep the short URL.
  assert.strictEqual(builder.overlayUrl(cfg, BASE),
    'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=xqc&block=a_b,c');
});

test('previewUrl sets every key explicitly and round-trips', () => {
  const cfg = config.defaults();
  cfg.demo = true;
  cfg.bg = 40;
  const url = builder.previewUrl(cfg, BASE);
  const p = new URL(url).searchParams;
  assert.strictEqual(p.get('demo'), '1');
  assert.strictEqual(p.get('badges'), '1');
  assert.strictEqual(p.get('block'), '');
  assert.strictEqual(p.get('channel'), '', 'an empty channel is written as channel=');
  assert.strictEqual(p.size === undefined ? [...p.keys()].length : p.size, config.KEYS.length);
  assert.deepStrictEqual(config.parse(p), cfg);
});

test('settingsSnippet evaluates to toObject(cfg)', () => {
  const cfg = config.defaults();
  cfg.channel = 'forsen';
  cfg.fade = 30;
  cfg.block = ['a_b'];
  cfg.stv_lookup = false;
  const snippet = builder.settingsSnippet(cfg);
  assert.match(snippet, /^\/\/ /);
  const sandbox = { window: {} };
  vm.runInNewContext(snippet, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.window.TCO_SETTINGS)), config.toObject(cfg));
  assert.deepStrictEqual(config.parse('', sandbox.window.TCO_SETTINGS), cfg);
});

test('parsePasted reads overlay URLs, bare queries and settings.js', () => {
  const r1 = builder.parsePasted('  https://example.com/x/overlay.html?channel=Forsen&size=small&bots=1#frag ');
  assert.strictEqual(r1.count, 3);
  assert.strictEqual(r1.cfg.channel, 'forsen');
  assert.strictEqual(r1.cfg.size, 'small');
  assert.strictEqual(r1.cfg.bots, true);
  assert.strictEqual(r1.cfg.font, 'Inter');

  const r2 = builder.parsePasted('channel=xqc&shadow=0');
  assert.strictEqual(r2.cfg.channel, 'xqc');
  assert.strictEqual(r2.cfg.shadow, 0);

  const cfg = config.defaults();
  cfg.channel = 'forsen';
  cfg.readable = false;
  const r3 = builder.parsePasted(builder.settingsSnippet(cfg));
  assert.deepStrictEqual(r3.cfg, cfg);

  assert.strictEqual(builder.parsePasted(''), null);
  assert.strictEqual(builder.parsePasted('forsen'), null);
  assert.strictEqual(builder.parsePasted('https://example.com/overlay.html?foo=1'), null);
  assert.strictEqual(builder.parsePasted('{"nope":1}'), null);
});

test('parsePasted reads settings.example.js as shipped and once edited by hand', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.js'), 'utf8');
  // The placeholder is not a valid Twitch name, so an unedited copy gets the overlay's "No channel set" hint.
  assert.strictEqual(config.normalizeChannel(builder.relaxedJson(example).channel), '');
  assert.strictEqual(builder.parsePasted(example), null, 'no usable setting in the unedited example');

  // A streamer fills in the channel and uncomments some options (the example's own commas).
  const edited = example
    .replace("'YOUR CHANNEL NAME'", "'xQc'")
    .replace(/^ {2}\/\/ /gm, '  ')
    .replace("size: 'medium'", "size: 'large'")
    .replace('shadow: 2', 'shadow: 0')
    .replace("layout: 'vertical'", "layout: 'horizontal'")
    .replace('bots: false', 'bots: true');
  const r2 = builder.parsePasted(edited);
  assert.ok(r2, 'edited settings.js parses');
  assert.strictEqual(r2.count, 9);
  assert.strictEqual(r2.cfg.layout, 'horizontal');
  assert.strictEqual(r2.cfg.channel, 'xqc');
  assert.strictEqual(r2.cfg.size, 'large');
  assert.strictEqual(r2.cfg.shadow, 0);
  assert.strictEqual(r2.cfg.bots, true);
  assert.strictEqual(r2.cfg.hide_commands, false);
  assert.strictEqual(r2.cfg.font, 'Inter');
});

test('settings.example.js runs with any of its options uncommented', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.js'), 'utf8');
  const lines = example.split(/\r?\n/);
  const optional = lines.map((l, i) => (/^ {2}\/\/ \w+:/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.ok(optional.length >= 8);
  const run = (on) => {
    const text = lines.map((l, i) => (on.indexOf(i) >= 0 ? l.replace('// ', '') : l)).join('\n');
    const sandbox = { window: {} };
    vm.runInNewContext(text, sandbox);
    return sandbox.window.TCO_SETTINGS;
  };
  assert.deepStrictEqual(Object.keys(run([])), ['channel']);
  optional.forEach((i) => assert.strictEqual(Object.keys(run([i])).length, 2, lines[i]));
  assert.strictEqual(Object.keys(run(optional)).length, optional.length + 1);
});

test('parsePasted counts only the settings it applies, and ignores a paste with none', () => {
  // A settings.js value that isn't valid is not applied, so it isn't counted, and a paste with
  // nothing usable leaves the builder (and its channel) alone.
  assert.strictEqual(builder.parsePasted('{ "fade": "soon", "max": "lots", "nope": 1 }'), null);
  const r = builder.parsePasted('{ "channel": "xqc", "size": "huge", "max": "lots" }');
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.cfg.size, 'medium');
  // The count is what config.parse takes from the object, whatever the key's case.
  const mixed = builder.parsePasted('{ "channel": "xqc", "Size": "large" }');
  assert.strictEqual(mixed.count, 2);
  assert.strictEqual(mixed.cfg.size, 'large');
  // URL keys are case-insensitive (as in the overlay); a bad value doesn't count.
  assert.strictEqual(builder.parsePasted('?SIZE=large&fade=soon').count, 1);
  assert.strictEqual(builder.parsePasted('?size=huge&channel=a%20b'), null);
  // The last value wins, as in config.parse.
  assert.strictEqual(builder.parsePasted('?size=huge&size=small').count, 1);
});

test('parsePasted reads a hand-written settings.js: comments, single quotes, unquoted keys, trailing commas', () => {
  const text = [
    '/* my overlay {not: "json"} */',
    'window.TCO_SETTINGS = {',
    "  channel: 'https://www.twitch.tv/Forsen', // pasted link, with // inside a string",
    '  "size": \'large\',',
    "  'font': \"Comic Sans MS\",",
    '  fade: 30, /* seconds */',
    "  block: ['Nightbot', \"@StreamElements\",],",
    '  bots: true,',
    '  history: 20,',
    '};',
    '// }'
  ].join('\n');
  const r = builder.parsePasted(text);
  assert.ok(r, 'parses');
  assert.strictEqual(r.count, 7);
  const want = config.defaults();
  Object.assign(want, { channel: 'forsen', size: 'large', font: 'Comic Sans MS', fade: 30,
    block: ['nightbot', 'streamelements'], bots: true, history: 20 });
  assert.deepStrictEqual(r.cfg, want);

  // Windows line endings, and a bare object with a leading comment (no window.TCO_SETTINGS).
  assert.strictEqual(builder.parsePasted(text.replace(/\n/g, '\r\n')).count, 7);
  const bare = builder.parsePasted("// mine\n{ channel: 'xqc', max: 10 }");
  assert.strictEqual(bare.count, 2);
  assert.strictEqual(bare.cfg.max, 10);
  assert.strictEqual(builder.parsePasted('window.TCO_SETTINGS = { channel: "x" };').cfg.channel, 'x');
});

test('parsePasted never evaluates a pasted settings.js', () => {
  delete globalThis.__tcoPwned;
  [
    "window.TCO_SETTINGS = { channel: (function () { globalThis.__tcoPwned = 1; return 'x'; })() };",
    "window.TCO_SETTINGS = { channel: 'x', size: globalThis.__tcoPwned = 1 };",
    "window.TCO_SETTINGS = { channel: 'unterminated };",
    "window.TCO_SETTINGS = { channel: 'x' ", // no closing brace
    'window.TCO_SETTINGS = 5;'
  ].forEach((t) => assert.strictEqual(builder.parsePasted(t), null, t));
  // A template literal is read as plain text: its ${…} is never run (and isn't a valid channel).
  const tpl = builder.parsePasted('window.TCO_SETTINGS = { channel: `x${globalThis.__tcoPwned = 1}`, size: `small` };');
  assert.strictEqual(tpl.cfg.channel, '');
  assert.strictEqual(tpl.cfg.size, 'small');
  assert.strictEqual(globalThis.__tcoPwned, undefined);
});

test('relaxedJson turns a JS object literal into data', () => {
  assert.deepStrictEqual(builder.relaxedJson(String.raw`{a: 'it\'s', b: "x\ny", c: 'A', d: [1, -2, true, false, null,], }`),
    { a: "it's", b: 'x\ny', c: 'A', d: [1, -2, true, false, null] });
  assert.deepStrictEqual(builder.relaxedJson("x = { url: 'https://a/b?c=d,}', note: \"a, b: c\" }; // }"),
    { url: 'https://a/b?c=d,}', note: 'a, b: c' });
  const protoKeys = builder.relaxedJson("{ '__proto__': 1, constructor: 2 }");
  assert.strictEqual(Object.getPrototypeOf(protoKeys), Object.prototype, 'no prototype change');
  assert.deepStrictEqual(Object.keys(protoKeys).sort(), ['__proto__', 'constructor']);
  assert.strictEqual(({}).constructor, Object);
  assert.throws(() => builder.relaxedJson('{ a: someVariable }'));
  assert.throws(() => builder.relaxedJson('{ a: 1,, b: 2 }'));
  assert.throws(() => builder.relaxedJson('no object here'));
});

test('parsePasted ignores prototype names: __proto__, constructor and toString are not settings', () => {
  assert.strictEqual(builder.parsePasted('{"__proto__": 1}'), null);
  assert.strictEqual(builder.parsePasted('{"constructor": 1, "toString": 2}'), null);
  assert.strictEqual(builder.parsePasted('window.TCO_SETTINGS = { __proto__: 1, constructor: 2 };'), null);
  assert.strictEqual(builder.parsePasted('?constructor=1'), null);
  assert.strictEqual(builder.parsePasted('https://example.com/overlay.html?__proto__=1&hasOwnProperty=2&toString=3'), null);
  const r = builder.parsePasted('?channel=xqc&constructor=1&__proto__=2');
  assert.strictEqual(r.count, 1);
  assert.deepStrictEqual(r.cfg, Object.assign(config.defaults(), { channel: 'xqc' }));
  assert.strictEqual(({}).channel, undefined);
});

test('badge and paint switches are live keys, so turning one on needs no preview reload', () => {
  ['badges', 'paints'].concat(builder.BADGE_SUBS).forEach((k) => assert.ok(builder.isLiveKey(k), k));
});

// A different valid value for any key.
function flip(cfg, k) {
  const c = Object.assign({}, cfg);
  const s = config.SPEC[k];
  if (s.type === 'bool') c[k] = !c[k];
  else if (s.type === 'int') c[k] = c[k] === s.max ? s.min : c[k] + 1;
  else if (s.type === 'enum') c[k] = s.values.filter((v) => v !== c[k])[0];
  else if (s.type === 'channel') c[k] = c[k] === 'xqc' ? 'forsen' : 'xqc';
  else if (s.type === 'font') c[k] = c[k] === 'Roboto' ? 'Inter' : 'Roboto';
  else c[k] = (c[k] || []).concat('someone');
  return c;
}

test('reloadSignature: live keys never reload the preview; reload keys do, except those a demo ignores', () => {
  const live = Object.assign(config.defaults(), { channel: 'forsen' });
  const sig = builder.reloadSignature(live);
  config.LIVE_KEYS.forEach((k) => assert.strictEqual(builder.reloadSignature(flip(live, k)), sig, k));
  builder.RELOAD_KEYS.forEach((k) => assert.notStrictEqual(builder.reloadSignature(flip(live, k)), sig, k));
  // In demo mode the keys the demo ignores don't reload it; everything else still does.
  const demo = Object.assign({}, live, { demo: true });
  const dsig = builder.reloadSignature(demo);
  assert.deepStrictEqual(builder.DEMO_INERT.slice().sort(), ['history', 'shared', 'stv_lookup']);
  builder.RELOAD_KEYS.forEach((k) => {
    assert.strictEqual(builder.reloadSignature(flip(demo, k)) === dsig, builder.DEMO_INERT.indexOf(k) >= 0, k);
  });
});

test('the preview frame is sandboxed to scripts only, except from disk where it could not load', () => {
  assert.strictEqual(builder.frameSandbox('https:'), 'allow-scripts');
  assert.strictEqual(builder.frameSandbox('http:'), 'allow-scripts');
  assert.strictEqual(builder.frameSandbox('file:'), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'builder.js'), 'utf8');
  assert.match(src, /setAttribute\('sandbox', sb\)/);
  ['js/builder.js', 'index.html'].forEach((f) =>
    assert.ok(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').indexOf('allow-same-origin') < 0, f));
});

test('every GROUPS key is a SPEC key, listed once, and together they are every setting but channel', () => {
  const all = [].concat(...builder.GROUPS.map((g) => g.keys));
  all.forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(config.SPEC, k), 'stale GROUPS key ' + k));
  assert.deepStrictEqual(all.slice().sort(), config.KEYS.filter((k) => k !== 'channel').sort());
});

test('startCfg: a ?channel= link keeps the remembered settings; a full link starts from defaults', () => {
  const stored = config.toObject(Object.assign(config.defaults(), { channel: 'old', size: 'large', fade: 30 }));
  const a = builder.startCfg('?channel=NewOne', stored);
  assert.strictEqual(a.fromQuery, true);
  assert.strictEqual(a.cfg.channel, 'newone');
  assert.strictEqual(a.cfg.size, 'large');
  assert.strictEqual(a.cfg.fade, 30);
  const b = builder.startCfg('?channel=x&size=small', stored);
  assert.deepStrictEqual(b.cfg, Object.assign(config.defaults(), { channel: 'x', size: 'small' }));
  const c = builder.startCfg('', stored);
  assert.strictEqual(c.fromStore, true);
  assert.strictEqual(c.fromQuery, false);
  assert.strictEqual(c.cfg.fade, 30);
  assert.strictEqual(builder.startCfg('?utm=1', null).fromStore, false);
  assert.deepStrictEqual(builder.startCfg('?utm=1', ['x']).cfg, config.defaults());
});

test('smallAvatar asks Twitch for the 70x70 rendition', () => {
  assert.strictEqual(builder.smallAvatar('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-600x600.png'),
    'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png');
  assert.strictEqual(builder.smallAvatar('https://static-cdn.jtvnw.net/x/y.jpeg'), 'https://static-cdn.jtvnw.net/x/y.jpeg');
});

test('events help mentions announcements', () => {
  assert.match(builder.META.events.label, /announcements/);
  assert.match(builder.META.events.help, /announce/);
});

test('layout: first in Look, and the align field reads differently for a horizontal row', () => {
  assert.strictEqual(builder.groupLayout()[0].keys[0], 'layout');
  assert.ok(builder.META.layout.help);
  const v = builder.fieldText('align', 'vertical');
  const hz = builder.fieldText('align', 'horizontal');
  assert.strictEqual(v.label, builder.META.align.label);
  assert.notStrictEqual(hz.label, v.label);
  assert.match(hz.help, /right/);
  // fields without a horizontal wording read the same in both layouts
  assert.deepStrictEqual(builder.fieldText('size', 'horizontal'), builder.fieldText('size', 'vertical'));
  assert.strictEqual(builder.fieldText('bg', 'horizontal').help, builder.META.bg.help);
});

test('layoutPreviewSize swaps a suggested preview size and keeps one the user typed', () => {
  const S = builder.LAYOUT_SIZES;
  assert.deepStrictEqual(S.vertical, { w: 450, h: 700 });
  assert.deepStrictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'horizontal'), S.horizontal);
  assert.deepStrictEqual(builder.layoutPreviewSize({ w: S.horizontal.w, h: S.horizontal.h }, 'horizontal', 'vertical'), S.vertical);
  assert.strictEqual(builder.layoutPreviewSize({ w: 600, h: 700 }, 'vertical', 'horizontal'), null, 'a size the user typed stays');
  assert.strictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'vertical'), null);
  assert.strictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'diagonal'), null);
  assert.strictEqual(builder.layoutPreviewSize(null, 'vertical', 'horizontal'), null);
});

test('the wide preview row is for a horizontal chat in a landscape source', () => {
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 100), true);
  assert.strictEqual(builder.wantsWidePreview('horizontal', 450, 800), false, 'a portrait source keeps the side column');
  assert.strictEqual(builder.wantsWidePreview('vertical', 1920, 100), false);
  // stage height follows the source's shape, within 150px .. 45% of the window
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 100, 950), 150);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 300, 950), 265);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 1080, 950), 428);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 1080, 200), 150, 'never under 150px');
  assert.strictEqual(builder.wideStageHeight(0, 30, 1920, 100, 950), 150);
});

test('fitScale scales down only', () => {
  assert.strictEqual(builder.fitScale(450, 700, 1000, 1000), 1);
  assert.strictEqual(builder.fitScale(450, 700, 450, 350), 0.5);
  assert.strictEqual(builder.fitScale(1000, 100, 500, 1000), 0.5);
  assert.strictEqual(builder.fitScale(450, 700, 0, 0), 1);
});

test('describeIvrUser handles the bare-array IVR shape', () => {
  const found = builder.describeIvrUser([{ id: '22484632', login: 'forsen', displayName: 'forsen', logo: 'https://static-cdn.jtvnw.net/x.png', banned: false }]);
  assert.strictEqual(found.state, 'found');
  assert.strictEqual(found.user.id, '22484632');
  assert.strictEqual(found.user.banned, false);
  assert.strictEqual(builder.describeIvrUser([]).state, 'notfound');
  assert.strictEqual(builder.describeIvrUser(null).state, 'notfound');
  assert.strictEqual(builder.describeIvrUser([{ id: 5 }]).user.id, '5');
  // Like the overlay's lookup: a numeric id only (else 'error', not a missing channel), and the entry
  // whose login matches.
  ['', ' ', 'abc', {}, null].forEach((id) =>
    assert.strictEqual(builder.describeIvrUser([{ id, login: 'x' }], 'x').state, 'error', JSON.stringify(id)));
  assert.strictEqual(builder.describeIvrUser([null]).state, 'error');
  // An answer only about another login is no answer, as in the overlay.
  assert.strictEqual(builder.describeIvrUser([{ id: '1', login: 'other' }], 'forsen').state, 'error');
  assert.strictEqual(builder.describeIvrUser([{ id: '1', login: 'other' }, { id: '2', login: 'Forsen' }], 'forsen').user.id, '2');
});

test('font suggestions are all valid font values', () => {
  builder.GOOGLE_FONTS.concat(builder.SYSTEM_FONT_NAMES).forEach((f) => {
    assert.strictEqual(config.coerce('font', f), f);
  });
  builder.SYSTEM_FONT_NAMES.forEach((f) => assert.ok(config.isSystemFont(f), f));
  builder.GOOGLE_FONTS.forEach((f) => assert.ok(!config.isSystemFont(f), f));
});

test('builder font lists are the config lists', () => {
  assert.strictEqual(builder.GOOGLE_FONTS, config.GOOGLE_FONTS);
  assert.strictEqual(builder.SYSTEM_FONT_NAMES, config.SYSTEM_FONT_NAMES);
});
