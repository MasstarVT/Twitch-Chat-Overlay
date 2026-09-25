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
    ['channel', 'debug', 'demo', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'history', 'shared', 'stv_lookup'].sort());
  config.LIVE_KEYS.forEach((k) => assert.ok(builder.isLiveKey(k)));
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

test('overlayUrl works from a file:// builder', () => {
  const cfg = config.defaults();
  cfg.channel = 'xqc';
  assert.strictEqual(builder.overlayUrl(cfg, 'file:///E:/Github/Twitch%20Chat%20Overlay/index.html'),
    'file:///E:/Github/Twitch%20Chat%20Overlay/overlay.html?channel=xqc');
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
  assert.ok(!p.has('channel'), 'empty channel is omitted');
  assert.strictEqual(p.size === undefined ? [...p.keys()].length : p.size, config.KEYS.length - 1);
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
  const r1 = builder.parsePasted(example);
  assert.ok(r1, 'settings.example.js parses');
  assert.strictEqual(r1.count, 1);
  const want = config.defaults();
  want.channel = 'your_channel_name';
  assert.deepStrictEqual(r1.cfg, want);

  // A streamer fills in the channel and uncomments some options.
  const edited = example
    .replace("channel: 'your_channel_name'", "channel: 'xQc',")
    .replace(/^ {2}\/\/ /gm, '  ')
    .replace("size: 'medium'", "size: 'large'")
    .replace('shadow: 2', 'shadow: 0')
    .replace('bots: false', 'bots: true');
  const r2 = builder.parsePasted(edited);
  assert.ok(r2, 'edited settings.js parses');
  assert.strictEqual(r2.count, 8);
  assert.strictEqual(r2.cfg.channel, 'xqc');
  assert.strictEqual(r2.cfg.size, 'large');
  assert.strictEqual(r2.cfg.shadow, 0);
  assert.strictEqual(r2.cfg.bots, true);
  assert.strictEqual(r2.cfg.hide_commands, false);
  assert.strictEqual(r2.cfg.font, 'Inter');
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

test('the preview frame boots with every badge and paint loader on', () => {
  assert.deepStrictEqual(builder.LOAD_KEYS.slice().sort(), ['badges', 'paints'].concat(builder.BADGE_SUBS).sort());
  builder.LOAD_KEYS.forEach((k) => assert.ok(builder.isLiveKey(k), k + ' must be a live key, so the real value can follow by postMessage'));
  const pc = config.defaults();
  pc.channel = 'forsen';
  pc.demo = true;
  pc.badges = false;
  pc.badges_ffz = false;
  pc.paints = false;
  pc.size = 'large';
  const boot = builder.frameBootCfg(pc);
  builder.LOAD_KEYS.forEach((k) => assert.strictEqual(boot[k], true, k));
  assert.strictEqual(pc.badges, false, 'input not mutated');
  assert.strictEqual(pc.paints, false, 'input not mutated');
  assert.strictEqual(boot.size, 'large');
  assert.strictEqual(boot.channel, 'forsen');
  assert.notStrictEqual(boot.block, pc.block);
  const p = new URL(builder.previewUrl(boot, BASE)).searchParams;
  ['badges', 'badges_ffz', 'paints'].forEach((k) => assert.strictEqual(p.get(k), '1', k));
  assert.strictEqual(p.get('size'), 'large');
});

test('events help mentions announcements', () => {
  assert.match(builder.META.events.label, /announcements/);
  assert.match(builder.META.events.help, /announce/);
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
