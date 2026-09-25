'use strict';
const test = require('node:test');
const assert = require('node:assert');
const renderer = require('../js/renderer.js');
const tokenizer = require('../js/tokenizer.js');
const ircParse = require('../js/irc-parse.js');

const R = renderer._internal;

function emote(provider, name, extra) {
  const e = { provider: provider, id: name + '-id', name: name, w: 28, h: 28,
    urls: { 1: 'https://cdn.example/' + name + '/1', 2: 'https://cdn.example/' + name + '/2', 4: 'https://cdn.example/' + name + '/4' } };
  return Object.assign(e, extra || {});
}

test('exports createRenderer and the pure helpers', () => {
  assert.strictEqual(typeof renderer.createRenderer, 'function');
  assert.throws(() => renderer.createRenderer({}), /root element/);
});

test('shadow levels 0-3 match the plan; invalid falls back to 2', () => {
  assert.strictEqual(R.shadowCss(0), 'none');
  assert.strictEqual(R.shadowCss(1), 'drop-shadow(1px 1px 1px rgba(0,0,0,.8))');
  assert.strictEqual(R.shadowCss(2), 'drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(1px 2px 2px rgba(0,0,0,.75))');
  assert.strictEqual(R.shadowCss(3), 'drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000) drop-shadow(2px 3px 4px rgba(0,0,0,.9))');
  assert.strictEqual(R.shadowCss(9), R.shadowCss(3));
  assert.strictEqual(R.shadowCss('x'), R.shadowCss(2));
  assert.strictEqual(R.shadowCss(undefined), R.shadowCss(2));
});

test('font sizes and want-scale: emotes ceil(fontPx*1.75*2/28), badges ceil(fontPx*2/18)', () => {
  assert.deepStrictEqual([R.fontPx('small'), R.fontPx('medium'), R.fontPx('large'), R.fontPx('bogus')], [18, 24, 32, 24]);
  assert.strictEqual(R.wantEmote(18), 3); // 31.5px -> 63/28 = 2.25
  assert.strictEqual(R.wantEmote(24), 3); // 42px -> 84/28 = 3 exactly (no float bump to 4)
  assert.strictEqual(R.wantEmote(32), 4); // 56px -> 112/28 = 4
  assert.strictEqual(R.wantEmote(24, true), 9); // gigantified: 3x
  assert.strictEqual(R.wantBadge(18), 2);
  assert.strictEqual(R.wantBadge(24), 3);
  assert.strictEqual(R.wantBadge(32), 4);
});

test('pickUrl uses util.pickScale, fixes protocol-relative urls and rejects non-http', () => {
  const urls = { 1: 'https://a/1', 2: 'https://a/2', 4: 'https://a/4' };
  assert.strictEqual(R.pickUrl(urls, 3), 'https://a/4');
  assert.strictEqual(R.pickUrl({ 1: 'https://a/1' }, 3), 'https://a/1');
  assert.strictEqual(R.pickUrl({ 1: '//cdn.7tv.app/emote/x/1x.webp' }, 1), 'https://cdn.7tv.app/emote/x/1x.webp');
  assert.strictEqual(R.pickUrl({ 1: 'javascript:alert(1)' }, 1), null);
  assert.strictEqual(R.pickUrl({ 1: 'file:///c/x.png' }, 1), null);
  assert.strictEqual(R.pickUrl({}, 1), null);
  assert.strictEqual(R.pickUrl(null, 1), null);
});

test('fontVar quotes family names but keeps generic keywords bare', () => {
  assert.strictEqual(R.fontVar('Inter'), '"Inter"');
  assert.strictEqual(R.fontVar('Open  Sans'), '"Open Sans"');
  assert.strictEqual(R.fontVar('system-ui'), 'system-ui');
  assert.strictEqual(R.fontVar('Comic"; } body{x'), '"Comic bodyx"', 'quotes, braces and semicolons are stripped');
  assert.strictEqual(R.fontVar(''), '"Inter"');
  assert.strictEqual(R.fontVar(null), '"Inter"');
});

test('bgAlpha and normalizeCfg clamp values', () => {
  assert.strictEqual(R.bgAlpha(0), 0);
  assert.strictEqual(R.bgAlpha(35), 0.35);
  assert.strictEqual(R.bgAlpha(500), 1);
  const c = R.normalizeCfg({ size: 'huge', align: 'middle', shadow: 7, bg: -3, fade: '12', max: 0, font: 5, block: ['a'], badges: false });
  assert.strictEqual(c.size, 'medium');
  assert.strictEqual(c.align, 'bottom');
  assert.strictEqual(c.shadow, 3);
  assert.strictEqual(c.bg, 0);
  assert.strictEqual(c.fade, 12);
  assert.strictEqual(c.max, 1);
  assert.strictEqual(c.font, 'Inter');
  assert.strictEqual(c.animate, true);
  assert.strictEqual(c.badges, false);
  const d = R.normalizeCfg({});
  assert.strictEqual(d.max, 50);
  assert.strictEqual(d.fade, 0);
  assert.strictEqual(d.shadow, 2);
  const src = { block: ['a'] };
  const n = R.normalizeCfg(src);
  n.block.push('b');
  assert.deepStrictEqual(src.block, ['a'], 'arrays are copied');
});

test('changedAny compares arrays by value', () => {
  assert.strictEqual(R.changedAny({ block: ['a'] }, { block: ['a'] }, ['block']), false);
  assert.strictEqual(R.changedAny({ block: ['a'] }, { block: ['a', 'b'] }, ['block']), true);
  assert.strictEqual(R.changedAny({ bots: false }, { bots: true }, ['block', 'bots']), true);
});

test('fadeTiming: positive delay while visible, negative inside the fade-out, expired after fade', () => {
  assert.strictEqual(R.fadeTiming(0, 0), null);
  assert.strictEqual(R.fadeTiming(undefined, 0), null);
  assert.deepStrictEqual(R.fadeTiming(10, 0), { expired: false, delay: 9000, duration: 1000 });
  assert.deepStrictEqual(R.fadeTiming(10, 4000), { expired: false, delay: 5000, duration: 1000 });
  assert.deepStrictEqual(R.fadeTiming(10, 9500), { expired: false, delay: -500, duration: 1000 });
  assert.deepStrictEqual(R.fadeTiming(10, 10000), { expired: true });
  assert.deepStrictEqual(R.fadeTiming(10, 60000), { expired: true });
  // clock skew: a future timestamp counts as age 0
  assert.deepStrictEqual(R.fadeTiming(10, -5000), { expired: false, delay: 9000, duration: 1000 });
  // fade shorter than the fade-out: the whole life is the fade-out
  assert.deepStrictEqual(R.fadeTiming(1, 250), { expired: false, delay: -250, duration: 1000 });
  // delay + duration always ends exactly `fade` after arrival
  for (const age of [0, 1234, 8999, 9999]) {
    const t = R.fadeTiming(10, age);
    assert.strictEqual(age + t.delay + t.duration, 10000);
  }
});

test('animString combines tco-in (new lines only) and tco-fade', () => {
  const t = R.fadeTiming(10, 0);
  assert.strictEqual(R.animString(true, true, null), 'tco-in 180ms ease-out');
  assert.strictEqual(R.animString(false, true, null), '');
  assert.strictEqual(R.animString(true, false, null), '');
  assert.strictEqual(R.animString(true, true, t), 'tco-in 180ms ease-out, tco-fade 1000ms linear 9000ms forwards');
  assert.strictEqual(R.animString(false, false, R.fadeTiming(10, 9500)), 'tco-fade 1000ms linear -500ms forwards');
  assert.strictEqual(R.animString(true, true, { expired: true }), 'tco-in 180ms ease-out');
});

test('Ring is a capped FIFO that drops the oldest entry', () => {
  const r = new R.Ring(3);
  assert.strictEqual(r.push(1), undefined);
  r.push(2);
  r.push(3);
  assert.strictEqual(r.push(4), 1);
  assert.strictEqual(r.push(5), 2);
  assert.deepStrictEqual(r.toArray(), [3, 4, 5]);
  assert.strictEqual(r.size, 3);
  assert.strictEqual(r.some((v) => v === 4), true);
  assert.strictEqual(r.filter((v) => v !== 4), 1);
  assert.deepStrictEqual(r.toArray(), [3, 5]);
  r.push(6);
  r.push(7);
  assert.deepStrictEqual(r.toArray(), [5, 6, 7]);
  r.resize(2);
  assert.deepStrictEqual(r.toArray(), [6, 7], 'shrinking keeps the newest');
  r.resize(4);
  r.push(8);
  r.push(9);
  assert.deepStrictEqual(r.toArray(), [6, 7, 8, 9]);
  const seen = [];
  r.forEach((v) => seen.push(v));
  assert.deepStrictEqual(seen, [6, 7, 8, 9]);
  assert.deepStrictEqual(r.drain(), [6, 7, 8, 9]);
  assert.strictEqual(r.size, 0);
  assert.deepStrictEqual(r.toArray(), []);
  const one = new R.Ring(0);
  one.push('a');
  one.push('b');
  assert.deepStrictEqual(one.toArray(), ['b'], 'capacity is at least 1');
});

test('DeletedIds expire after the TTL and are capped', () => {
  const d = new R.DeletedIds(1000, 3);
  d.add('a', 0);
  assert.strictEqual(d.has('a', 500), true);
  assert.strictEqual(d.has('a', 1000), false);
  assert.strictEqual(d.size, 0, 'an expired id is dropped when checked');
  d.add('a', 0);
  d.add('b', 100);
  d.add('c', 200);
  d.add('d', 300);
  assert.strictEqual(d.size, 3);
  assert.strictEqual(d.has('a', 300), false, 'oldest dropped at the cap');
  assert.strictEqual(d.has('d', 300), true);
  d.add('e', 1150); // prunes b (expired at 1100); c expires at 1200
  assert.strictEqual(d.has('b', 1150), false);
  assert.strictEqual(d.has('c', 1150), true);
  d.add('', 0);
  assert.strictEqual(d.has('', 0), false);
  // re-adding refreshes the expiry and the order
  const e = new R.DeletedIds(1000, 10);
  e.add('x', 0);
  e.add('y', 500);
  e.add('x', 900);
  e.prune(1600);
  assert.strictEqual(e.has('y', 1600), false);
  assert.strictEqual(e.has('x', 1600), true);
  assert.strictEqual(R.DELETED_TTL_MS, 600000);
  assert.strictEqual(R.DELETED_CAP, 5000);
});

test('overflowCount: bottom trims oldest above the top, top trims newest-first list below the bottom', () => {
  // bottom alignment, view 0..100, lines stacked upward from the bottom (oldest first)
  const rects = [{ top: -80, bottom: -40 }, { top: -40, bottom: 0 }, { top: 0, bottom: 40 }, { top: 40, bottom: 100 }];
  let reads = 0;
  const at = (i) => { reads++; return rects[i]; };
  assert.strictEqual(R.overflowCount(rects.length, at, 'bottom', 0, 100), 2);
  assert.strictEqual(reads, 3, 'stops reading at the first visible line');
  assert.strictEqual(R.overflowCount(1, () => ({ top: -500, bottom: 100 }), 'bottom', 0, 100), 0, 'a tall newest line stays');
  // top alignment, newest first
  const trects = [{ top: 0, bottom: 60 }, { top: 60, bottom: 110 }, { top: 110, bottom: 150 }, { top: 150, bottom: 200 }];
  assert.strictEqual(R.overflowCount(trects.length, (i) => trects[i], 'top', 0, 100), 2);
  assert.strictEqual(R.overflowCount(trects.length, (i) => trects[i], 'top', 0, 1000), 0);
  assert.strictEqual(R.overflowCount(0, () => { throw new Error('no reads'); }, 'bottom', 0, 100), 0);
});

test('reverseGroups keeps a notice and its message line together', () => {
  assert.deepStrictEqual(R.reverseGroups(['a', 'b', 'c']), [2, 1, 0]);
  assert.deepStrictEqual(R.reverseGroups(['a', 'n', 'n', 'b']), [3, 1, 2, 0]);
  assert.deepStrictEqual(R.reverseGroups([undefined, undefined]), [1, 0], 'unknown keys are never grouped');
  assert.deepStrictEqual(R.reverseGroups([]), []);
  // reversing twice restores the order
  const keys = ['a', 'n', 'n', 'b', 'm', 'm'];
  const once = R.reverseGroups(keys).map((i) => keys[i]);
  const twice = R.reverseGroups(once).map((i) => once[i]);
  assert.deepStrictEqual(twice, keys);
});

test('line classes: action, first-msg (only with cfg.first_msg), highlight, announcement colors, notice, mirrored', () => {
  const base = { firstMsg: true, msgId: 'highlighted-message', mirrored: true };
  assert.strictEqual(R.lineClasses(base, { first_msg: false }, 'chat', true), 'line action highlight mirrored');
  assert.strictEqual(R.lineClasses(base, { first_msg: true }, 'chat', false), 'line first-msg highlight mirrored');
  assert.strictEqual(R.lineClasses({ highlight: true }, {}, 'chat', false), 'line highlight');
  assert.strictEqual(R.lineClasses({ announcement: 'BLUE' }, {}, 'chat', false), 'line announcement ann-blue');
  assert.strictEqual(R.lineClasses({ announcement: 'green' }, {}, 'chat', false), 'line announcement ann-green');
  assert.strictEqual(R.lineClasses({ announcement: 'NOPE' }, {}, 'chat', false), 'line announcement ann-primary');
  assert.strictEqual(R.lineClasses({ firstMsg: true, announcement: 'BLUE' }, { first_msg: true }, 'notice', false), 'line notice');
  assert.strictEqual(R.annClass(''), null);
  for (const c of ['PRIMARY', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE']) assert.strictEqual(R.annClass(c), 'ann-' + c.toLowerCase());
});

test('reply header model strips ACTION and newlines; empty parent names give no header', () => {
  assert.deepStrictEqual(R.replyModel({ name: 'Bob', body: '\u0001ACTION waves\u0001' }), { name: '@Bob', body: 'waves' });
  assert.deepStrictEqual(R.replyModel({ login: 'bob', body: 'a\nb' }), { name: '@bob', body: 'a b' });
  assert.strictEqual(R.replyModel({ body: 'x' }), null);
  assert.strictEqual(R.replyModel(null), null);
});

test('badge models: url by want, bg wrap color, avatar flag, unusable badges dropped', () => {
  const list = [
    { provider: 'twitch', title: 'Moderator', urls: { 1: 'https://b/1', 2: 'https://b/2', 4: 'https://b/4' } },
    { provider: 'ffz', title: 'Supporter', urls: { 1: 'https://f/1' }, bg: '#755000' },
    { provider: 'avatar', title: 'Other channel', urls: { 1: 'https://logo', 2: 'https://logo', 4: 'https://logo' } },
    { provider: 'bttv', title: 'Broken', urls: {} },
    null
  ];
  assert.deepStrictEqual(R.badgeModels(list, 3), [
    { url: 'https://b/4', title: 'Moderator', avatar: false, bg: null },
    { url: 'https://f/1', title: 'Supporter', avatar: false, bg: '#755000' },
    { url: 'https://logo', title: 'Other channel', avatar: true, bg: null }
  ]);
  assert.deepStrictEqual(R.badgeModels(undefined, 3), []);
});

test('partsFor: text, spacing, emotes with overlays and effects, cheers, gifs', () => {
  const opts = { want: 3, wantBig: 9, gifs: true };
  const items = [
    { type: 'text', text: 'hello there', sp: false },
    { type: 'emote', emote: emote('7tv', 'Base', { w: 56, h: 28 }), sp: true, big: false,
      overlays: [emote('7tv', 'RainTime', { zw: true }), emote('7tv', 'NoUrl', { urls: {} })],
      fx: { sx: -1, sy: 1, rot: 0, grow: true, cursed: false, zs: false } },
    { type: 'emote', emote: emote('bttv', 'Zed'), sp: true, overlays: [], fx: { sx: 1, sy: 1, rot: 90, zs: true, cursed: true } },
    { type: 'emote', emote: emote('ffz', 'Gone', { urls: {} }), sp: true, overlays: [] },
    { type: 'cheer', prefix: 'Cheer', amount: 100, tier: 100, color: '#9C3EE8', urls: { 1: 'https://c/1.gif', 2: 'https://c/2.gif', 3: 'https://c/3.gif', 4: 'https://c/4.gif' }, sp: true },
    { type: 'gif', url: 'https://media2.giphy.com/media/abc/giphy.gif?cid=1', title: '[GIF]', sp: true },
    { type: 'text', text: 'end', sp: true }
  ];
  const parts = R.partsFor(items, opts);
  assert.deepStrictEqual(parts[0], { t: 'text', s: 'hello there ' });
  assert.deepStrictEqual(parts[1], {
    t: 'emote', name: 'Base', url: 'https://cdn.example/Base/4', w: 56, h: 28,
    big: false, grow: true, cursed: false, zs: false,
    fx: { sx: -1, sy: 1, rot: 0 },
    ov: [{ name: 'RainTime', url: 'https://cdn.example/RainTime/4', w: 28, h: 28 }]
  });
  // z! emote: no space before it; rotate + cursed
  assert.strictEqual(parts[2].t, 'emote');
  assert.strictEqual(parts[2].zs, true);
  assert.strictEqual(parts[2].cursed, true);
  assert.deepStrictEqual(parts[2].fx, { sx: 1, sy: 1, rot: 90 });
  // an emote without a usable url becomes its name as text
  assert.deepStrictEqual(parts[3], { t: 'text', s: ' Gone ' });
  assert.deepStrictEqual(parts[4], { t: 'cheer', prefix: 'Cheer', amount: '100', color: '#9C3EE8', url: 'https://c/3.gif' });
  assert.deepStrictEqual(parts[5], { t: 'text', s: ' ' });
  assert.deepStrictEqual(parts[6], { t: 'gif', url: 'https://media2.giphy.com/media/abc/giphy.gif?cid=1', title: '[GIF]' });
  assert.deepStrictEqual(parts[7], { t: 'text', s: ' end' });

  // gifs off -> title text; no leading space on the first rendered part; big emotes use wantBig
  const p2 = R.partsFor([
    { type: 'gif', url: 'https://media2.giphy.com/x.gif', title: '[GIF]', sp: true },
    { type: 'emote', emote: emote('twitch', 'Kappa'), sp: true, big: true, overlays: [] }
  ], { want: 3, wantBig: 9, gifs: false });
  assert.deepStrictEqual(p2[0], { t: 'text', s: '[GIF] ' });
  assert.strictEqual(p2[1].big, true);
  assert.strictEqual(p2[1].url, 'https://cdn.example/Kappa/4');
  assert.strictEqual(p2[1].fx, null);
  // unsafe gif url -> text
  const p3 = R.partsFor([{ type: 'gif', url: 'http://media2.giphy.com/x.gif', title: 'T', sp: false }], opts);
  assert.deepStrictEqual(p3, [{ t: 'text', s: 'T' }]);
  // cheer without a url keeps prefix + colored amount (rendered as text)
  const p4 = R.partsFor([{ type: 'cheer', prefix: 'Cheer', amount: 5, color: 'red;x', urls: {}, sp: false }], opts);
  assert.deepStrictEqual(p4, [{ t: 'cheer', prefix: 'Cheer', amount: '5', color: null, url: null }]);
  assert.deepStrictEqual(R.partsFor(null, opts), []);
});

test('partsFor works on real tokenizer output (zero-width stacking, FFZ hidden modifier, BTTV prefix)', () => {
  const maps = new Map([
    ['Base', emote('7tv', 'Base')],
    ['RainTime', emote('7tv', 'RainTime', { zw: true })],
    ['ffzX', emote('ffz', 'ffzX', { hidden: true, flags: 1 | 2 })],
    ['Pog', emote('bttv', 'Pog')]
  ]);
  const msg = ircParse.toChatMessage(ircParse.parseLine('@id=1;user-id=5 :u!u@u PRIVMSG #c :hi Base RainTime ffzX v! Pog'));
  const tk = tokenizer.tokenize(msg, { lookup: (w) => maps.get(w) || null, bttvPrefixes: new Set(['v!']) });
  const parts = R.partsFor(tk.items, { want: 3, wantBig: 9, gifs: true });
  assert.strictEqual(parts.length, 4);
  assert.deepStrictEqual(parts[0], { t: 'text', s: 'hi ' });
  assert.strictEqual(parts[1].name, 'Base');
  assert.deepStrictEqual(parts[1].ov.map((o) => o.name), ['RainTime']);
  assert.deepStrictEqual(parts[1].fx, { sx: -1, sy: 1, rot: 0 });
  assert.deepStrictEqual(parts[2], { t: 'text', s: ' ' });
  assert.strictEqual(parts[3].name, 'Pog');
  assert.deepStrictEqual(parts[3].fx, { sx: 1, sy: -1, rot: 0 });
});

test('modelFor: chat line with badges, paint, reply and /me', () => {
  const msg = { id: 'x', userId: '12', login: 'bob', displayName: 'Bob', firstMsg: false, msgId: '',
    reply: { name: 'Alice', login: 'alice', body: 'hi' } };
  const d = {
    kind: 'chat',
    items: [{ type: 'text', text: 'waves', sp: false }],
    action: true,
    badges: [{ provider: 'twitch', title: 'VIP', urls: { 1: 'https://v/1', 2: 'https://v/2', 4: 'https://v/4' } }],
    name: { text: 'Bob', color: '#FF0000', paint: '01ABCDEF' }
  };
  const m = R.modelFor(msg, R.normalizeCfg({ size: 'large' }), d);
  assert.strictEqual(m.kind, 'chat');
  assert.strictEqual(m.cls, 'line action');
  assert.deepStrictEqual(m.reply, { name: '@Alice', body: 'hi' });
  assert.deepStrictEqual(m.badges, [{ url: 'https://v/4', title: 'VIP', avatar: false, bg: null }]);
  assert.deepStrictEqual(m.name, { text: 'Bob', color: '#FF0000', paint: '01ABCDEF' });
  assert.strictEqual(m.colon, ' ');
  assert.strictEqual(m.msgColor, '#FF0000');
  assert.deepStrictEqual(m.parts, [{ t: 'text', s: 'waves' }]);

  const off = R.modelFor(msg, R.normalizeCfg({ replies: false, badges: false }), Object.assign({}, d, { action: false }));
  assert.strictEqual(off.reply, null);
  assert.deepStrictEqual(off.badges, []);

  // with badges off, the Shared Chat source avatar still marks a mirrored message; other badges stay hidden
  const avatar = { provider: 'avatar', title: 'Other channel', urls: { 1: 'https://logo', 2: 'https://logo', 4: 'https://logo' } };
  const shared = Object.assign({}, d, { badges: [avatar].concat(d.badges, [null]) });
  assert.deepStrictEqual(R.modelFor(msg, R.normalizeCfg({ badges: false }), shared).badges,
    [{ url: 'https://logo', title: 'Other channel', avatar: true, bg: null }]);
  assert.strictEqual(R.modelFor(msg, R.normalizeCfg({}), shared).badges.length, 2);
  assert.deepStrictEqual(R.visibleBadges(undefined, { badges: false }), []);
  assert.strictEqual(off.colon, ': ');
  assert.strictEqual(off.msgColor, null);

  // unsafe paint ids are ignored; missing name/color fall back to the message
  const fb = R.modelFor({ userId: '3', login: 'carl', displayName: '' }, R.normalizeCfg({}), { kind: 'chat', items: [], name: { paint: 'bad id!' } });
  assert.strictEqual(fb.name.text, 'carl');
  assert.strictEqual(fb.name.paint, null);
  assert.match(fb.name.color, /^#[0-9A-F]{6}$/i);

  // the model is plain data, so its signature is stable
  assert.strictEqual(R.sigOf(R.modelFor(msg, R.normalizeCfg({}), d)), R.sigOf(R.modelFor(msg, R.normalizeCfg({}), d)));
  assert.notStrictEqual(R.sigOf(m), R.sigOf(off));
});

test('modelFor: notice line', () => {
  const m = R.modelFor({ systemMsg: 'Bob subscribed at Tier 1.', mirrored: false }, R.normalizeCfg({}), { kind: 'notice' });
  assert.deepStrictEqual(m, { kind: 'notice', cls: 'line notice', system: 'Bob subscribed at Tier 1.' });
});

test('normTokens accepts an items array or {items, action}, else falls back to plain text', () => {
  const items = [{ type: 'text', text: 'a', sp: false }];
  assert.deepStrictEqual(R.normTokens(items, {}), { items: items, action: false });
  assert.deepStrictEqual(R.normTokens({ items: items, action: true }, {}), { items: items, action: true });
  assert.deepStrictEqual(R.normTokens(undefined, { text: 'raw' }), { items: [{ type: 'text', text: 'raw', sp: false }], action: false });
  assert.deepStrictEqual(R.normTokens(null, {}), { items: [], action: false });
});

test('userPart derives the attached chat message of a USERNOTICE', () => {
  const n = { kind: 'notice', id: 'n1', sourceId: 's1', type: 'resub', userId: '9', text: 'still here', reply: { name: 'x' }, firstMsg: true };
  const m = R.userPart(n);
  assert.strictEqual(m.kind, 'chat');
  assert.strictEqual(m.id, 'n1:m');
  assert.strictEqual(m.sourceId, 's1:m');
  assert.strictEqual(m.noticeId, 'n1');
  assert.strictEqual(m.userId, '9');
  assert.strictEqual(m.text, 'still here');
  assert.strictEqual(m.reply, null);
  assert.strictEqual(m.firstMsg, false);
  assert.strictEqual(n.kind, 'notice', 'the original is not modified');
  assert.strictEqual(R.userPart({ id: '', type: 'announcement', announceColor: 'GREEN' }).announcement, 'GREEN');
  assert.strictEqual(R.userPart({ id: 'a', type: 'announcement' }).announcement, 'PRIMARY');
  assert.strictEqual(R.userPart({ id: '' }).id, '');
});

test('config keys that trigger a re-render or a filter sweep', () => {
  for (const k of ['badges', 'badges_7tv', 'paints', 'readable', 'replies', 'gifs', 'size', 'first_msg']) {
    assert.ok(R.RERENDER_KEYS.indexOf(k) >= 0, k);
  }
  for (const k of ['bots', 'hide_commands', 'block']) assert.ok(R.FILTER_KEYS.indexOf(k) >= 0, k);
});
