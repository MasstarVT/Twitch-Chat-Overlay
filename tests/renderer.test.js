'use strict';
const test = require('node:test');
const assert = require('node:assert');
const renderer = require('../js/renderer.js');
const tokenizer = require('../js/tokenizer.js');
const ircParse = require('../js/irc-parse.js');
const config = require('../js/config.js');

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

test('noticeMax: line_width in a notice\'s own em, so a notice is capped as wide as a chat line', () => {
  assert.strictEqual(R.noticeMax(30, 85), '35.294em');
  assert.strictEqual(R.noticeMax(30, 100), '30em');
  assert.strictEqual(R.noticeMax(5, 50), '10em');
  assert.strictEqual(R.noticeMax(100, 150), '66.667em');
  // At 85% text, 35.294 of the notice's em are 30 of the chat's, to a thousandth.
  assert.ok(Math.abs(35.294 * 0.85 - 30) < 0.001);
  assert.strictEqual(R.noticeMax(30, 'x'), '35.294em', 'not a size: the default 85');
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

test('shadowCss(level, color): today\'s strings without a color, the same shadow in the color\'s rgb with one', () => {
  [0, 1, 2, 3].forEach((l) => {
    assert.strictEqual(R.shadowCss(l, ''), R.SHADOWS[l], l + ': no color');
    assert.strictEqual(R.shadowCss(l, undefined), R.SHADOWS[l]);
    // Not a config color (bare lowercase rrggbb): black, as written.
    ['red', '#ff0000', 'FF0000', 'ff0000;x', ' ff0000', 123456, {}].forEach((c) => assert.strictEqual(R.shadowCss(l, c), R.SHADOWS[l], l + ' ' + String(c)));
  });
  assert.strictEqual(R.shadowCss(0, 'ff0000'), 'none');
  assert.strictEqual(R.shadowCss(1, 'ff0000'), 'drop-shadow(1px 1px 1px rgba(255,0,0,.8))');
  assert.strictEqual(R.shadowCss(2, '0a141e'), 'drop-shadow(0 0 1px rgba(10,20,30,.9)) drop-shadow(1px 2px 2px rgba(10,20,30,.75))');
  assert.strictEqual(R.shadowCss(3, 'ff8800'), 'drop-shadow(0 0 2px #ff8800) drop-shadow(0 0 1px #ff8800) drop-shadow(2px 3px 4px rgba(255,136,0,.9))');
});

test('tshadow: the outline\'s eight sharp layers, then the text-only shadow; null when neither is on', () => {
  const d = { outline: 0, outline_color: '', shadow: 2, shadow_color: '', shadow_style: 'filter' };
  const t = (over) => R.tshadow(Object.assign({}, d, over));
  assert.strictEqual(t({}), null, 'the defaults draw no text-shadow');
  assert.strictEqual(R.tshadow({}), null, 'nor does a partial cfg');
  assert.strictEqual(t({ outline: 1 }), '-.04em -.04em 0 #000, 0 -.04em 0 #000, .04em -.04em 0 #000, -.04em 0 0 #000, ' +
    '.04em 0 0 #000, -.04em .04em 0 #000, 0 .04em 0 #000, .04em .04em 0 #000');
  assert.deepStrictEqual(R.OUTLINE_EM, ['', '.04em', '.06em', '.08em']);
  [2, 3].forEach((o) => {
    const layers = t({ outline: o }).split(', ');
    assert.strictEqual(layers.length, 8);
    layers.forEach((l) => assert.match(l, new RegExp('^(?:-?' + R.OUTLINE_EM[o].replace('.', '\\.') + '|0) (?:-?' + R.OUTLINE_EM[o].replace('.', '\\.') + '|0) 0 #000$'), l));
  });
  assert.ok(t({ outline: 2, outline_color: 'ffcc00' }).split(', ').every((l) => / 0 #ffcc00$/.test(l)));
  assert.ok(t({ outline: 2, outline_color: 'nope' }).split(', ').every((l) => / 0 #000$/.test(l)), 'not a config color: black');
  assert.strictEqual(t({ outline: 9 }).split(', ')[0], '-.08em -.08em 0 #000', 'clamped');
  // shadow_style=text: the level's text layers, blurs doubled from the drop-shadows'.
  assert.deepStrictEqual(R.TEXT_SHADOWS, ['', '1px 1px 2px rgba(0,0,0,.8)', '0 0 2px rgba(0,0,0,.9), 1px 2px 4px rgba(0,0,0,.75)',
    '0 0 4px #000, 0 0 2px #000, 2px 3px 8px rgba(0,0,0,.9)']);
  [1, 2, 3].forEach((s) => assert.strictEqual(t({ shadow_style: 'text', shadow: s }), R.TEXT_SHADOWS[s]));
  assert.strictEqual(t({ shadow_style: 'text', shadow: 0 }), null);
  assert.strictEqual(t({ shadow_style: 'text', shadow: 3, shadow_color: '00ff00' }), '0 0 4px #00ff00, 0 0 2px #00ff00, 2px 3px 8px rgba(0,255,0,.9)');
  assert.strictEqual(t({ shadow_color: '00ff00' }), null, 'the whole-line shadow is --shadow, not this');
  // Outline first, then the shadow under it.
  const both = t({ outline: 1, outline_color: 'ffffff', shadow_style: 'text', shadow: 1 });
  assert.strictEqual(both, t({ outline: 1, outline_color: 'ffffff' }) + ', 1px 1px 2px rgba(0,0,0,.8)');
});

test('tshadowRoom: how far --tshadow reaches past the letters; null when it has no layers', () => {
  const d = { outline: 0, outline_color: '', shadow: 2, shadow_color: '', shadow_style: 'filter' };
  const t = (over) => R.tshadowRoom(Object.assign({}, d, over));
  assert.strictEqual(t({}), null, 'the defaults need none');
  assert.strictEqual(R.tshadowRoom({}), null, 'nor does a partial cfg');
  assert.strictEqual(t({ shadow: 3, shadow_color: 'ffffff' }), null, 'the whole-line filter draws past the clips');
  [1, 2, 3].forEach((o) => assert.strictEqual(t({ outline: o, outline_color: 'ff0000' }), R.OUTLINE_EM[o]));
  assert.strictEqual(t({ outline: 9 }), '.08em', 'clamped');
  // Offset plus blur radius along the farther axis: 1+2, 2+4 (down), 3+8 (down).
  assert.deepStrictEqual(R.TEXT_SHADOW_ROOM, ['', '3px', '6px', '11px']);
  [1, 2, 3].forEach((s) => assert.strictEqual(t({ shadow_style: 'text', shadow: s }), R.TEXT_SHADOW_ROOM[s]));
  assert.strictEqual(t({ shadow_style: 'text', shadow: 0 }), null);
  // Both: the shadow's reach, which covers the outline at the overlay's sizes (one plain length: overflow-clip-margin
  // takes no max()).
  assert.strictEqual(t({ outline: 3, shadow_style: 'text', shadow: 1 }), '3px');
  assert.ok(0.08 * R.FONT_PX.large < 3);
  assert.strictEqual(t({ outline: 1, shadow_style: 'text', shadow: 3 }), '11px');
  [1, 2, 3].forEach((o) => [0, 1, 2, 3].forEach((s) => assert.match(String(t({ outline: o, shadow_style: 'text', shadow: s })), /^\.?\d+(?:em|px)$/)));
  // text_px past 37 px: a thick outline reaches further than the light shadow's 3px, so the room is the outline's.
  assert.strictEqual(t({ outline: 3, shadow_style: 'text', shadow: 1, text_px: 37 }), '3px');
  assert.strictEqual(t({ outline: 3, shadow_style: 'text', shadow: 1, text_px: 40 }), '4px'); // .08 * 40 = 3.2
  assert.strictEqual(t({ outline: 3, shadow_style: 'text', shadow: 3, text_px: 96 }), '11px', 'the strong shadow still reaches further');
  assert.strictEqual(t({ outline: 3, text_px: 96 }), '.08em', 'the outline alone is in em');
  [8, 24, 40, 96].forEach((px) => [1, 2, 3].forEach((o) => [1, 2, 3].forEach((s) =>
    assert.match(t({ outline: o, shadow_style: 'text', shadow: s, text_px: px }), /^\d+px$/))));
});

test('font sizes and want-scale: emotes ceil(fontPx*1.75*dpr/base), badges ceil(fontPx*dpr/18)', () => {
  assert.deepStrictEqual([R.fontPx('small'), R.fontPx('medium'), R.fontPx('large'), R.fontPx('bogus')], [18, 24, 32, 24]);
  // OBS draws at DPR 1: the file only has to cover the drawn size
  assert.strictEqual(R.wantEmote(18), 2); // 31.5px -> 31.5/28 = 1.125
  assert.strictEqual(R.wantEmote(24), 2); // 42px -> 1.5
  assert.strictEqual(R.wantEmote(32), 2); // 56px -> 2 exactly (no float bump to 3)
  assert.strictEqual(R.wantEmote(24, true), 5); // gigantified: 3x -> 126/28 = 4.5
  assert.strictEqual(R.wantBadge(18), 1);
  assert.strictEqual(R.wantBadge(24), 2);
  assert.strictEqual(R.wantBadge(32), 2);
  // a HiDPI builder preview (dpr 2) still gets sharp files
  assert.strictEqual(R.wantEmote(18, false, 2), 3); // 63/28 = 2.25
  assert.strictEqual(R.wantEmote(24, false, 2), 3); // 84/28 = 3 exactly
  assert.strictEqual(R.wantEmote(32, false, 2), 4);
  assert.strictEqual(R.wantEmote(24, true, 2), 9);
  assert.strictEqual(R.wantBadge(24, 2), 3);
  assert.strictEqual(R.wantBadge(32, 2), 4);
  // 7TV scales in 32px steps: size=small at dpr 2 needs 63px, which its 2x (64px) file covers
  assert.strictEqual(R.wantEmote(18, false, 2, R.baseHeight(32)), 2);
  assert.strictEqual(R.wantEmote(24, false, 2, R.baseHeight(32)), 3); // 84/32 = 2.6
  assert.deepStrictEqual([R.baseHeight(0), R.baseHeight(28), R.baseHeight(30), R.baseHeight(32), R.baseHeight(900)], [28, 28, 28, 32, 32],
    'odd provider heights never pick a smaller file than a 28px base would');
});

test('pxFor: text_px while it is set (8 at least), else the size step; fontPx(size) stays as it was', () => {
  assert.deepStrictEqual([{}, { size: 'small' }, { size: 'large' }, { size: 'large', text_px: 0 }, { size: 'bogus' }].map(R.pxFor),
    [24, 18, 32, 32, 24]);
  assert.deepStrictEqual([{ text_px: 40 }, { text_px: 8, size: 'large' }, { text_px: 3 }, { text_px: 1 }, { text_px: 96 }, { text_px: 500 },
    { text_px: 'x' }, { text_px: -4 }, { text_px: '30' }].map(R.pxFor), [40, 8, 8, 8, 96, 96, 24, 24, 30]);
  assert.strictEqual(R.pxFor(undefined), 24);
  assert.strictEqual(R.pxFor(null), 24);
});

test('want-scale with a scale (emote_scale, an emote-only line, badge_size): 1 or none is today\'s file', () => {
  // A scale of 1, or none (left out, 0, negative, not a number), is exactly the call without one.
  [18, 24, 32, 8, 40, 96].forEach((px) => [1, 2, 3].forEach((dpr) => [false, true].forEach((big) => [undefined, 28, 32].forEach((bh) => {
    [1, 0, -1, undefined, NaN].forEach((s) => assert.strictEqual(R.wantEmote(px, big, dpr, bh, s), R.wantEmote(px, big, dpr, bh), px + ' ' + s));
    [1, 0, undefined].forEach((s) => assert.strictEqual(R.wantBadge(px, dpr, s), R.wantBadge(px, dpr)));
  }))));
  assert.strictEqual(R.wantEmote(24, false, 1, 28, 2), 3); // 84/28 = 3 exactly
  assert.strictEqual(R.wantEmote(24, false, 1, 28, 1.5), 3); // 63/28 = 2.25
  assert.strictEqual(R.wantEmote(24, false, 1, 28, 0.5), 1); // 21/28
  assert.strictEqual(R.wantEmote(24, true, 1, 28, 1.25), 6); // gigantified at 125%: 157.5/28 = 5.6
  assert.strictEqual(R.wantBadge(24, 1, 1.5), 2); // 36/18 = 2 exactly
  assert.strictEqual(R.wantBadge(24, 1, 2), 3); // 48/18 = 2.67
  assert.strictEqual(R.wantBadge(24, 1, 0.5), 1);
  assert.strictEqual(R.wantBadge(R.pxFor({ text_px: 40 }), 1), 3); // 40/18 = 2.2
  assert.deepStrictEqual([100, 50, 200, 125, 75, undefined, 'x', 300, 10].map(R.sizeScale), [1, 0.5, 2, 1.25, 0.75, 1, 1, 2, 0.5]);
});

test('scaled emotes and badges are never fetched smaller than drawn while the provider has a big enough file', () => {
  // Twitch/BTTV/FFZ: 28 px steps up to 4x (112 px); 7TV: 32 px steps up to 4x (128 px); badges: 18 px steps up to 4x (72 px).
  const urls = (keys) => { const o = {}; keys.forEach((k) => { o[k] = 'https://cdn.example/' + k; }); return o; };
  const fileKey = (u) => Number(u.split('/').pop());
  const kinds = [{ base: 28, keys: [1, 2, 4] }, { base: 32, keys: [1, 2, 3, 4] }];
  let checked = 0;
  [8, 13, 18, 24, 32, 40, 57, 72, 96].forEach((px) => [1, 2].forEach((dpr) => {
    for (let pct = 50; pct <= 200; pct += 5) {
      kinds.forEach((kd) => [1, 2, 3].forEach((eo) => [false, true].forEach((big) => {
        const s = (pct / 100) * (big ? 1 : eo);
        const drawn = px * 1.75 * (big ? 3 : 1) * s * dpr;
        const k = fileKey(R.pickUrl(urls(kd.keys), R.wantEmote(px, big, dpr, kd.base, s)));
        const max = kd.keys[kd.keys.length - 1];
        if (drawn <= max * kd.base) assert.ok(k * kd.base >= drawn - 1e-6, px + 'px ' + pct + '% x' + eo + (big ? ' big' : '') + ': file ' + k);
        else assert.strictEqual(k, max, 'past the largest file: the largest');
        checked++;
      })));
      const b = fileKey(R.pickUrl(urls([1, 2, 4]), R.wantBadge(px, dpr, pct / 100)));
      const bd = px * (pct / 100) * dpr;
      if (bd <= 72) assert.ok(b * 18 >= bd - 1e-6, 'badge ' + px + 'px ' + pct + '%');
      else assert.strictEqual(b, 4);
    }
  }));
  assert.ok(checked > 5000);
});

test('emoteOnly: emote images alone, with nothing but blanks between them (U+E0000, U+034F, spaces)', () => {
  const k = { type: 'emote', emote: emote('twitch', 'Kappa'), sp: false, overlays: [] };
  const sp = (it) => Object.assign({}, it, { sp: true });
  const text = (s) => ({ type: 'text', text: s, sp: true });
  assert.strictEqual(R.emoteOnly([k]), true);
  assert.strictEqual(R.emoteOnly([k, sp(k), sp(k)]), true);
  assert.strictEqual(R.emoteOnly([k, text('\u{E0000}')]), true, 'Chatterino\'s duplicate suffix');
  assert.strictEqual(R.emoteOnly([k, text('͏')]), true);
  assert.strictEqual(R.emoteOnly([k, text('​⁠'), sp(k)]), true);
  assert.strictEqual(R.emoteOnly([k, text('hi')]), false);
  assert.strictEqual(R.emoteOnly([k, text('!')]), false);
  assert.strictEqual(R.emoteOnly([text('\u{E0000}')]), false, 'no emote');
  assert.strictEqual(R.emoteOnly([]), false);
  assert.strictEqual(R.emoteOnly(null), false);
  // Cheers and GIFs are not emotes; an emote without an image is drawn as its name.
  assert.strictEqual(R.emoteOnly([k, { type: 'cheer', prefix: 'Cheer', amount: 1, urls: {}, sp: true }]), false);
  assert.strictEqual(R.emoteOnly([k, { type: 'gif', url: 'https://media.giphy.com/media/a/200.webp', title: 'g', sp: true }]), false);
  assert.strictEqual(R.emoteOnly([k, sp({ type: 'emote', emote: emote('7tv', 'Gone', { urls: {} }), overlays: [] })]), false);
  // Real tokenizer output: a duplicate-bypass suffix stays a text item, and still counts as blank.
  const msg = ircParse.toChatMessage(ircParse.parseLine('@id=1;user-id=5;emotes=25:0-4 :u!u@u PRIVMSG #c :Kappa \u{E0000}'));
  const tk = tokenizer.tokenize(msg, { lookup: () => null });
  assert.deepStrictEqual(tk.items.map((x) => x.type), ['emote', 'text']);
  assert.strictEqual(R.emoteOnly(tk.items), true);
});

test('modelFor: emote_only=big/huge marks an emote-only line in a column and fetches its emotes that much bigger', () => {
  const msg = { id: 'e', userId: '1', login: 'a', displayName: 'A' };
  const items = () => [{ type: 'emote', emote: emote('twitch', 'Kappa'), sp: false, overlays: [] },
    { type: 'emote', emote: emote('twitch', 'Pog'), sp: true, overlays: [emote('7tv', 'Zw', { zw: true })] }];
  const m = (cfg, its) => R.modelFor(msg, R.normalizeCfg(cfg), { kind: 'chat', items: its || items(), dpr: 1 });
  const at = (cfg, its) => { const x = m(cfg, its); return [x.cls, x.parts[0].url, x.parts[2].ov[0].url]; }; // [1] is the space
  // normal: no class, today's files (42 px drawn: the 2x file).
  assert.deepStrictEqual(at({}), ['line', 'https://cdn.example/Kappa/2', 'https://cdn.example/Zw/2']);
  assert.strictEqual(R.sigOf(m({})), R.sigOf(m({ emote_only: 'normal' })));
  // big: 84 px (3 -> the 4x file, 112 px); huge: 126 px (past 4x: the largest).
  assert.deepStrictEqual(at({ emote_only: 'big' }), ['line emote-only', 'https://cdn.example/Kappa/4', 'https://cdn.example/Zw/4']);
  assert.deepStrictEqual(at({ emote_only: 'huge', size: 'small' }), ['line emote-only', 'https://cdn.example/Kappa/4', 'https://cdn.example/Zw/4']);
  // A row has no emote-only lines; nor has a line with words in it.
  assert.deepStrictEqual(at({ emote_only: 'huge', layout: 'horizontal' }), at({ layout: 'horizontal' }));
  const words = items().concat({ type: 'text', text: 'lol', sp: true });
  assert.deepStrictEqual(at({ emote_only: 'huge' }, words), at({}, words));
  // A gigantified emote keeps its own 3x: the same file with emote_only on as off.
  const giant = [{ type: 'emote', emote: emote('twitch', 'Kappa'), sp: false, big: true, overlays: [] }];
  assert.deepStrictEqual(m({ emote_only: 'big', size: 'small' }, giant).parts, m({ size: 'small' }, giant).parts);
  assert.strictEqual(m({ emote_only: 'big' }, giant).cls, 'line emote-only');
  // A notice is never one.
  assert.strictEqual(R.modelFor({ systemMsg: 'x' }, R.normalizeCfg({ emote_only: 'huge' }), { kind: 'notice', items: items() }).cls, 'line notice');
});

test('modelFor: text_px, badge_size and emote_scale pick the files for the size drawn', () => {
  const msg = { id: 'x', userId: '1', login: 'a', displayName: 'A' };
  const d = {
    kind: 'chat', dpr: 1,
    items: [{ type: 'emote', emote: emote('twitch', 'Kappa'), sp: false, overlays: [] },
      { type: 'cheer', prefix: 'Cheer', amount: 1, color: '#979797', urls: { 1: 'https://c/1', 2: 'https://c/2', 3: 'https://c/3', 4: 'https://c/4' }, sp: true }],
    badges: [{ provider: 'twitch', title: 'VIP', urls: { 1: 'https://v/1', 2: 'https://v/2', 4: 'https://v/4' } }]
  };
  const at = (cfg) => { const x = R.modelFor(msg, R.normalizeCfg(cfg), d); return [x.badges[0].url, x.parts[0].url, x.parts[2].url]; };
  assert.deepStrictEqual(at({}), ['https://v/2', 'https://cdn.example/Kappa/2', 'https://c/2']);
  assert.deepStrictEqual(at({ text_px: 0, badge_size: 100, emote_scale: 100 }), at({}));
  assert.deepStrictEqual(at({ text_px: 10 }), ['https://v/1', 'https://cdn.example/Kappa/1', 'https://c/1']); // 17.5 px emotes
  assert.deepStrictEqual(at({ text_px: 64 }), ['https://v/4', 'https://cdn.example/Kappa/4', 'https://c/4']); // 112 px
  assert.deepStrictEqual(at({ badge_size: 200 }), ['https://v/4', 'https://cdn.example/Kappa/2', 'https://c/2']);
  assert.deepStrictEqual(at({ emote_scale: 150 }), ['https://v/2', 'https://cdn.example/Kappa/4', 'https://c/3']); // 63 px
  assert.deepStrictEqual(at({ emote_scale: 50, size: 'small' }), ['https://v/1', 'https://cdn.example/Kappa/1', 'https://c/1']);
  // text_px wins over size: 8 px at size=large is 8 px.
  assert.deepStrictEqual(at({ text_px: 8, size: 'large' }), at({ text_px: 8 }));
});

test('giant_emotes=0: a gigantified emote is drawn and fetched like any other; partsFor without it is today\'s', () => {
  const big = () => [{ type: 'emote', emote: emote('twitch', 'K'), big: true, sp: false, overlays: [emote('7tv', 'Z', { zw: true })] }];
  const today = R.partsFor(big(), { px: 24, dpr: 1, gifs: true });
  assert.strictEqual(today[0].big, true);
  assert.strictEqual(today[0].url, 'https://cdn.example/K/4');
  assert.deepStrictEqual(R.partsFor(big(), { px: 24, dpr: 1, gifs: true, giant: true, scale: 1, eo: 1 }), today, 'the defaults spelled out');
  assert.deepStrictEqual(R.partsFor(big(), { px: 24, dpr: 1, gifs: true, giant: undefined, scale: 0 }), today);
  const off = R.partsFor(big(), { px: 24, dpr: 1, gifs: true, giant: false });
  assert.deepStrictEqual([off[0].big, off[0].url, off[0].ov[0].url], [false, 'https://cdn.example/K/2', 'https://cdn.example/Z/2']);
  // In a row the class stays (the stylesheet draws it at emote height), and the file is emote height's either way.
  const row = R.partsFor(big(), { px: 24, dpr: 1, gifs: true, flatBig: true });
  assert.deepStrictEqual([row[0].big, row[0].url], [true, 'https://cdn.example/K/2']);
  assert.deepStrictEqual([R.partsFor(big(), { px: 24, dpr: 1, flatBig: true, giant: false })[0].big], [false]);
  // modelFor passes giant_emotes.
  const msg = { id: 'g', userId: '1', login: 'a', displayName: 'A' };
  const parts = (cfg) => R.modelFor(msg, R.normalizeCfg(cfg), { kind: 'chat', items: big(), dpr: 1 }).parts;
  assert.deepStrictEqual(parts({}), today);
  assert.deepStrictEqual(parts({ giant_emotes: false }), off);
});

test('pickUrl uses util.pickScale, fixes protocol-relative urls and rejects unsafe URLs', () => {
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
  assert.strictEqual(c.layout, 'vertical');
  assert.strictEqual(R.normalizeCfg({ layout: 'horizontal' }).layout, 'horizontal');
  assert.strictEqual(R.normalizeCfg({ layout: 'diagonal' }).layout, 'vertical');
  const d = R.normalizeCfg({});
  assert.strictEqual(d.layout, 'vertical');
  assert.strictEqual(d.max, 50);
  assert.strictEqual(d.fade, 0);
  assert.strictEqual(d.shadow, 2);
  const src = { block: ['a'] };
  const n = R.normalizeCfg(src);
  n.block.push('b');
  assert.deepStrictEqual(src.block, ['a'], 'arrays are copied');
});

test('setVar sets a #chat variable, and removes it for null (the stylesheet value and Custom CSS apply)', () => {
  const st = require('./fake-dom.js').createDocument().createElement('div').style;
  R.setVar(st, '--x', 0.4);
  assert.strictEqual(st['--x'], '0.4', 'as a string');
  R.setVar(st, '--x', '"Inter"');
  assert.strictEqual(st.getPropertyValue('--x'), '"Inter"');
  R.setVar(st, '--x', null);
  assert.deepStrictEqual(Object.keys(st), []);
  R.setVar(st, '--y', undefined);
  assert.deepStrictEqual(Object.keys(st), [], 'nothing set for undefined either');
});

test('hexRgb: a config color as r, g, b, and nothing for anything that is not six lowercase hex digits', () => {
  assert.strictEqual(R.hexRgb('9146ff'), '145, 70, 255');
  assert.strictEqual(R.hexRgb('000000'), '0, 0, 0');
  assert.strictEqual(R.hexRgb('ffffff'), '255, 255, 255');
  ['', '#9146ff', '9146FF', 'fff', '9146ff00', 'red', '12345g', ' 9146ff', '9146ff;x:y', null, undefined, 9146, 123456, true]
    .forEach((v) => {
      assert.strictEqual(R.hexRgb(v), null, JSON.stringify(v));
      assert.strictEqual(R.hexColor(v), null, JSON.stringify(v));
    });
  assert.strictEqual(R.hexColor('9146ff'), '#9146ff');
});

test('normalizeCfg: the stage-2 look options fall back to their defaults', () => {
  const d = R.normalizeCfg({});
  assert.deepStrictEqual([d.text_weight, d.name_weight, d.text_color, d.line_height, d.text_case, d.names, d.name_line,
    d.bg_color, d.bg_shape, d.bg_width, d.spacing, d.notice_color, d.notice_size, d.first_msg_color],
  ['semibold', 'heavy', '', 135, 'none', true, false, '', 'round', 'fit', 'normal', '', 85, '']);
  const bad = R.normalizeCfg({ text_weight: 'thin', name_weight: 800, text_color: '#ff0000', line_height: 999, text_case: 'title',
    names: 0, name_line: 1, bg_color: 'ff0000;}', bg_shape: 'blob', bg_width: 'wide', spacing: 'huge', notice_color: 123456,
    notice_size: 'NaN', first_msg_color: 'FF0000' });
  assert.deepStrictEqual([bad.text_weight, bad.name_weight, bad.text_color, bad.line_height, bad.text_case, bad.names,
    bad.name_line, bad.bg_color, bad.bg_shape, bad.bg_width, bad.spacing, bad.notice_color, bad.notice_size, bad.first_msg_color],
  ['semibold', 'heavy', '', 200, 'none', false, true, '', 'round', 'fit', 'normal', '', 85, '']);
  assert.deepStrictEqual(R.WEIGHTS, { light: 300, regular: 400, semibold: 600, bold: 700, heavy: 800, black: 900 });
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
  // a horizontal row slides new lines in from the side
  assert.strictEqual(R.animString(true, true, t, 'horizontal'), 'tco-in-x 180ms ease-out, tco-fade 1000ms linear 9000ms forwards');
  assert.strictEqual(R.animString(true, true, null, 'vertical'), 'tco-in 180ms ease-out');
  assert.strictEqual(R.animString(true, false, null, 'horizontal'), '');
  assert.strictEqual(R.animString(false, true, t, 'horizontal'), 'tco-fade 1000ms linear 9000ms forwards');
});

test('fadeTiming with a fade-out length: capped by the whole life, and the line still gone `fade` s after arrival', () => {
  // Left out (or not a usable number): FADE_OUT_MS, as before.
  [undefined, null, 'soon', -1, NaN].forEach((o) =>
    assert.deepStrictEqual(R.fadeTiming(10, 0, o), { expired: false, delay: 9000, duration: 1000 }, String(o)));
  assert.deepStrictEqual(R.fadeTiming(10, 0, 1000), R.fadeTiming(10, 0));
  assert.deepStrictEqual(R.fadeTiming(10, 0, 2500), { expired: false, delay: 7500, duration: 2500 });
  assert.deepStrictEqual(R.fadeTiming(10, 9000, 2500), { expired: false, delay: -1500, duration: 2500 });
  // 0: no fade at all, the line vanishes at `fade`.
  assert.deepStrictEqual(R.fadeTiming(10, 0, 0), { expired: false, delay: 10000, duration: 0 });
  // Longer than the whole life: the whole life is the fade-out.
  assert.deepStrictEqual(R.fadeTiming(3, 500, 10000), { expired: false, delay: -500, duration: 3000 });
  assert.deepStrictEqual(R.fadeTiming(3, 3000, 250), { expired: true });
  for (const out of [0, 250, 1000, 4000, 10000]) {
    for (const age of [0, 1234, 4999]) {
      const x = R.fadeTiming(5, age, out);
      assert.strictEqual(age + x.delay + x.duration, 5000, out + ' ' + age);
    }
  }
});

test('animString: the entrance style and length, the exit keyframes; left out, 1.5\'s strings', () => {
  const t = R.fadeTiming(10, 0);
  // At the defaults, byte for byte what 1.5 wrote (renderer-dom.test.js and the parity fixtures pin them too).
  assert.strictEqual(R.animString(true, true, null, 'vertical', 'slide', 180, 'tco-fade'), 'tco-in 180ms ease-out');
  assert.strictEqual(R.animString(true, true, null, 'horizontal', 'slide', 180, 'tco-fade'), 'tco-in-x 180ms ease-out');
  assert.strictEqual(R.animString(true, true, t, 'vertical', 'slide', 180, 'tco-fade'),
    'tco-in 180ms ease-out, tco-fade 1000ms linear 9000ms forwards');
  // Each style, in a column and in a row; fade and drop look the same in both, pop grows a row's message from its middle.
  const inn = (style, layout) => R.animString(true, true, null, layout, style, 180);
  assert.deepStrictEqual(['slide', 'fade', 'pop', 'drop'].map((s) => [inn(s, 'vertical'), inn(s, 'horizontal')]), [
    ['tco-in 180ms ease-out', 'tco-in-x 180ms ease-out'],
    ['tco-in-fade 180ms ease-out', 'tco-in-fade 180ms ease-out'],
    ['tco-in-pop 180ms ease-out', 'tco-in-pop-x 180ms ease-out'],
    ['tco-in-drop 180ms ease-out', 'tco-in-drop 180ms ease-out']]);
  assert.strictEqual(R.animString(true, true, null, 'vertical', 'pop', 400), 'tco-in-pop 400ms ease-out');
  // Only listed names and clamped numbers reach the string.
  assert.strictEqual(R.animString(true, true, null, 'vertical', 'toString', 5), 'tco-in 50ms ease-out');
  assert.strictEqual(R.animString(true, true, null, 'vertical', 'x; color: red', '1e9'), 'tco-in 180ms ease-out');
  assert.strictEqual(R.animString(true, true, null, 'vertical', 'drop', 99999), 'tco-in-drop 1000ms ease-out');
  assert.strictEqual(R.animString(true, false, null, 'vertical', 'pop', 400), '', 'animate=0: no entrance');
  // The exit: any listed keyframes, with the fade's own timing; anything else is tco-fade.
  R.EXIT_NAMES.forEach((n) => assert.strictEqual(R.animString(false, false, t, 'vertical', null, null, n), n + ' 1000ms linear 9000ms forwards'));
  assert.strictEqual(R.animString(false, false, t, 'vertical', null, null, 'tco-in'), 'tco-fade 1000ms linear 9000ms forwards');
  assert.strictEqual(R.animString(true, true, R.fadeTiming(1, 0, 400), 'horizontal', 'fade', 300, 'tco-out-slide-x'),
    'tco-in-fade 300ms ease-out, tco-out-slide-x 400ms linear 600ms forwards');
  // The name sets onAnimEnd acts on hold every name animString writes.
  const entered = [];
  Object.keys(R.ENTER).forEach((s) => R.ENTER[s].forEach((n) => { if (entered.indexOf(n) < 0) entered.push(n); }));
  assert.deepStrictEqual(R.ENTER_NAMES.slice().sort(), entered.sort());
  assert.deepStrictEqual(Object.keys(R.ENTER), config.SPEC.enter_style.values);
});

test('exitFor: tco-fade, or exit_style=slide toward the edge old lines leave by', () => {
  const ex = (c) => R.exitFor(R.normalizeCfg(c));
  assert.strictEqual(ex({}), 'tco-fade');
  assert.strictEqual(ex({ align: 'top', layout: 'horizontal' }), 'tco-fade');
  assert.strictEqual(ex({ exit_style: 'slide' }), 'tco-out-slide', 'a column with the newest at the bottom: up');
  assert.strictEqual(ex({ exit_style: 'slide', align: 'top' }), 'tco-out-slide-down', 'the newest on top: down');
  assert.strictEqual(ex({ exit_style: 'slide', layout: 'horizontal' }), 'tco-out-slide-x', 'a row: left');
  assert.strictEqual(ex({ exit_style: 'slide', layout: 'horizontal', align: 'top' }), 'tco-out-slide-x');
  assert.strictEqual(R.exitFor(null), 'tco-fade');
  assert.deepStrictEqual(R.EXIT_NAMES.slice().sort(), ['tco-fade', 'tco-out-slide', 'tco-out-slide-down', 'tco-out-slide-x']);
});

test('animDefaults: only all four animation options at their defaults keep 1.5\'s overlapping fade', () => {
  const at = (c) => R.animDefaults(R.normalizeCfg(c));
  assert.strictEqual(at({}), true);
  assert.strictEqual(at(config.defaults()), true);
  // The other options never matter.
  assert.strictEqual(at({ fade: 1, layout: 'horizontal', align: 'top', animate: false }), true);
  [{ enter_style: 'fade' }, { enter_ms: 200 }, { fade_out_ms: 1500 }, { fade_out_ms: 0 }, { exit_style: 'slide' }]
    .forEach((c) => assert.strictEqual(at(c), false, JSON.stringify(c)));
});

test('newestFirst: only a vertical, top-aligned chat keeps the newest line first in the DOM', () => {
  assert.strictEqual(R.newestFirst(R.normalizeCfg({})), false);
  assert.strictEqual(R.newestFirst(R.normalizeCfg({ align: 'top' })), true);
  assert.strictEqual(R.newestFirst(R.normalizeCfg({ align: 'top', layout: 'horizontal' })), false, 'a row always ends with the newest line');
  assert.strictEqual(R.newestFirst(R.normalizeCfg({ align: 'bottom', layout: 'horizontal' })), false);
  assert.strictEqual(R.newestFirst(null), false);
  // setConfig reverses the DOM exactly when this flips: vertical/top <-> anything else
  const flips = (a, b) => R.newestFirst(R.normalizeCfg(a)) !== R.newestFirst(R.normalizeCfg(b));
  assert.strictEqual(flips({ align: 'top' }, { align: 'top', layout: 'horizontal' }), true);
  assert.strictEqual(flips({ align: 'top', layout: 'horizontal' }, { align: 'bottom', layout: 'horizontal' }), false, 'align only moves a row');
  assert.strictEqual(flips({ align: 'bottom' }, { align: 'bottom', layout: 'horizontal' }), false);
  assert.strictEqual(flips({ align: 'bottom', layout: 'horizontal' }, { align: 'top' }), true);
  assert.ok(R.LAYOUT_SETTLE_MS > 0, 'LAYOUT_SETTLE_MS > 0 (the live reversal itself is tested in renderer-dom.test.js)');
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
  // an optional value rides along and expires with the id
  const v = new R.DeletedIds(1000, 10);
  v.add('u', 0, 7);
  assert.strictEqual(v.get('u', 999), 7);
  assert.strictEqual(v.get('u', 1000), undefined);
  assert.strictEqual(v.get('nope', 0), undefined);
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

test('overflowCountX: a horizontal row trims the oldest lines left of the chat', () => {
  // view starts at x=0; oldest first, the newest line ends at the right edge
  const rects = [{ left: -900, right: -500 }, { left: -480, right: 0 }, { left: 20, right: 300 }, { left: 320, right: 800 }];
  let reads = 0;
  const at = (i) => { reads++; return rects[i]; };
  assert.strictEqual(R.overflowCountX(rects.length, at, 0), 2, 'a line ending exactly on the edge is out');
  assert.strictEqual(reads, 3, 'stops reading at the first visible line');
  // slack: the row is about to slide in from 100px further right, so only lines out of view even then go
  assert.strictEqual(R.overflowCountX(rects.length, (i) => rects[i], 0 - 100), 1);
  assert.strictEqual(R.overflowCountX(rects.length, (i) => rects[i], -1000), 0);
  assert.strictEqual(R.overflowCountX(1, () => ({ left: -2000, right: 800 }), 0), 0, 'a wide newest line stays');
  assert.strictEqual(R.overflowCountX(0, () => { throw new Error('no reads'); }, 0), 0);
});

test('slideLeft: what a running slide still had to go, never piling up past its own offset', () => {
  const S = R.SLIDE_MS;
  assert.strictEqual(R.slideLeft(120, 300, 100), 120, 'mid-slide: what the screen shows');
  assert.strictEqual(R.slideLeft(300, 300, 100), 300, 'a transition that has not started yet keeps its full offset (no hop)');
  assert.strictEqual(R.slideLeft(900, 300, 100), 300, 'capped at the slide offset');
  assert.strictEqual(R.slideLeft(300, 300, S), 0, 'over once SLIDE_MS passed, even if never drawn (hidden source)');
  assert.strictEqual(R.slideLeft(300, 300, S + 1000), 0);
  assert.strictEqual(R.slideLeft(-5, 300, 100), 0, 'overshoot counts as done');
  assert.strictEqual(R.slideLeft(100, 0, 100), 0, 'no slide running');
  assert.strictEqual(R.slideLeft(NaN, 300, 100), 0);
  assert.strictEqual(R.slideLeft(100, 300, NaN), 0);
  // a hidden source: flushes come from the fallback timer, so the stalled offset never carries over.
  // (Only the constants are compared here; renderer-dom.test.js drives the real flush.)
  assert.ok(R.FLUSH_FALLBACK_MS >= S, 'FLUSH_FALLBACK_MS >= SLIDE_MS');
});

test('slideDelta: the next slide starts where the row is on screen', () => {
  assert.strictEqual(R.slideDelta(0, 1000, 600), 400, 'the newest old line moved 400px left');
  assert.strictEqual(R.slideDelta(50, 1000, 600), 450, 'plus what the previous slide had left');
  assert.strictEqual(R.slideDelta(-20, 1000, 600), 400, 'a negative remainder is ignored');
  assert.strictEqual(R.slideDelta(0, 600, 600), 0, 'nothing moved');
  assert.strictEqual(R.slideDelta(0, 600.4, 600), 0, 'under a pixel is no slide');
  assert.strictEqual(R.slideDelta(0, 600, 700), 0, 'moved right (a removal): no slide');
  // capped at the chat width, so a burst can't park the row far off to the right
  assert.strictEqual(R.slideDelta(5000, 1000, 600, 1280), 1280);
  assert.strictEqual(R.slideDelta(50, 1000, 600, 1280), 450, 'under the cap: unchanged');
  assert.strictEqual(R.slideDelta(50, 1000, 600, 0), 450, 'no width known: no cap');
  // A column (smooth_scroll) the same way round: up, the newest old line's top before and after; down (align=top), after
  // and before. At most the chat height.
  assert.strictEqual(R.slideDelta(0, 670, 640, 720), 30, 'up 30 px: starts 30 px below');
  assert.strictEqual(R.slideDelta(12, 30, 0, 720), 42, 'down 30 px with 12 px left: starts 42 px above');
  assert.strictEqual(R.slideDelta(0, 670, -1330, 720), 720);
});

test('glideOf: a row glides left as always; a column only with smooth_scroll, up or (align=top) down', () => {
  const g = (c) => R.glideOf(R.normalizeCfg(c));
  assert.strictEqual(g({}), null, 'the defaults: a column that never glides');
  assert.strictEqual(g({ align: 'top' }), null);
  assert.strictEqual(g({ layout: 'horizontal' }), 'left');
  assert.strictEqual(g({ layout: 'horizontal', align: 'top', smooth_scroll: true }), 'left', 'a row is a row');
  assert.strictEqual(g({ layout: 'horizontal', animate: false }), null);
  assert.strictEqual(g({ smooth_scroll: true }), 'up');
  assert.strictEqual(g({ smooth_scroll: true, align: 'top' }), 'down');
  assert.strictEqual(g({ smooth_scroll: true, animate: false }), null, 'needs animate');
  // Only a real true (normalizeCfg makes one of any setting); never a string from a hand-made cfg.
  assert.strictEqual(R.glideOf({ animate: true, smooth_scroll: 'false' }), null);
  assert.strictEqual(R.glideOf(null), null);
  assert.strictEqual(R.NORM.smooth_scroll.def, false);
});

test('overflowCount: a column about to glide counts only lines out of view at its start too (slack)', () => {
  // bottom alignment, view 0..100: the glide starts 30 px lower, so the line ending at -20 still shows then
  const rects = [{ top: -80, bottom: -50 }, { top: -50, bottom: -20 }, { top: -20, bottom: 10 }];
  assert.strictEqual(R.overflowCount(rects.length, (i) => rects[i], 'bottom', 0, 100), 2);
  assert.strictEqual(R.overflowCount(rects.length, (i) => rects[i], 'bottom', 0 - 30, 100 + 30), 1);
  // top alignment, newest first: the glide starts 30 px higher
  const trects = [{ top: 0, bottom: 30 }, { top: 90, bottom: 120 }, { top: 120, bottom: 150 }];
  assert.strictEqual(R.overflowCount(trects.length, (i) => trects[i], 'top', 0, 100), 1);
  assert.strictEqual(R.overflowCount(trects.length, (i) => trects[i], 'top', 0 - 30, 100 + 30), 0);
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

test('line classes: accent_bar marks chat lines only, never a notice or an announcement', () => {
  const on = { accent_bar: true };
  assert.strictEqual(R.lineClasses({}, on, 'chat', false), 'line accent');
  assert.strictEqual(R.lineClasses({ firstMsg: true, msgId: 'highlighted-message', mirrored: true, platform: 'kick' },
    { accent_bar: true, first_msg: true }, 'chat', true), 'line action first-msg highlight accent mirrored platform-kick',
  'next to first-msg too (the stylesheet lets the first-message bar win)');
  assert.strictEqual(R.lineClasses({}, on, 'notice', false), 'line notice');
  assert.strictEqual(R.lineClasses({ announcement: 'BLUE' }, on, 'chat', false), 'line announcement ann-blue');
  [false, 'true', 1, undefined].forEach((v) => assert.strictEqual(R.lineClasses({}, { accent_bar: v }, 'chat', false), 'line', String(v)));
  // In the model: the class, with the name color the line's bar takes (renderInto).
  const m = R.modelFor({ id: 'a', userId: '1', login: 'a', displayName: 'A' }, on, { kind: 'chat', name: { color: '#123456' } });
  assert.strictEqual(m.cls, 'line accent');
  assert.strictEqual(m.name.color, '#123456');
});

// ---------- highlights (stage 7) ----------

const hlCls = (cfg, msg, kind) => R.lineClasses(Object.assign({ login: 'viewer', text: '' }, msg), R.normalizeCfg(cfg), kind || 'chat', false);

test('points_highlight: on by default (also for a cfg without it), off draws the line like any other', () => {
  const hl = { msgId: 'highlighted-message' };
  assert.strictEqual(R.lineClasses(hl, {}, 'chat', false), 'line highlight', 'a partial cfg: as before');
  assert.strictEqual(R.lineClasses({ highlight: true }, { points_highlight: undefined }, 'chat', false), 'line highlight');
  assert.strictEqual(R.lineClasses(hl, { points_highlight: true }, 'chat', false), 'line highlight');
  assert.strictEqual(R.lineClasses(hl, { points_highlight: false }, 'chat', false), 'line');
  assert.strictEqual(hlCls({ points_highlight: false }, { highlight: true }), 'line');
  assert.strictEqual(R.normalizeCfg({}).points_highlight, true);
});

test('mentions: @name (at), or the bare name too (name), of the Twitch login and the Kick slug; whole names only', () => {
  const at = { mentions: 'at', channel: 'home', kick: 'kick-name' };
  const name = Object.assign({}, at, { mentions: 'name' });
  const t = (cfg, text) => hlCls(cfg, { text: text }) === 'line mention';
  // at: an @ before the name, any letter case, not inside a longer name or an address.
  ['@home', 'hi @home!', '@HOME you rock', '(@home)', '@home, hi', '@home\'s stream', 'yo @kick-name', '@kick_name', '@KICK_NAME',
    '@home- dash after'].forEach((s) => assert.ok(t(at, s), s));
  ['home', 'hi home', '@homes', '@home_x', '@home1', 'x@home', 'mail@home.com', '@kick-names', '@kick-name-x', '@kickname', '',
    '@hom'].forEach((s) => assert.ok(!t(at, s), s));
  // name: the bare word too, but not after / or . (a link or a domain), and still whole names only.
  ['home', 'hi home!', 'HOME', 'go home.', 'kick-name', 'kick_name', '@home'].forEach((s) => assert.ok(t(name, s), s));
  ['homes', 'twitch.tv/home', 'www.home', 'x@home', 'hometown', 'myhome', 'kick-named', 'kick'].forEach((s) => assert.ok(!t(name, s), s));
  // Unicode boundaries: a Latin letter (é too), a digit or a combining mark makes it part of a longer word; a letter of
  // another script can't be part of a login, so a Japanese or Korean suffix, or a word before the '@', is no bar.
  assert.ok(!t(name, 'éhome') && !t(name, 'homeé') && !t(name, 'homé') && !t(name, 'homé') && !t(name, 'home2'));
  assert.ok(t(name, 'ほ home') && t(name, '👋home') && t(name, 'ほhome') && t(name, 'homeさん') && t(name, 'さんhome'));
  ['@homeさん こんにちは', '@home님 안녕하세요', '@home你好', 'こんにちは@home', '@home，你好', 'привет@home', '@kick-nameさん', '@home-さん']
    .forEach((s) => assert.ok(t(at, s) && t(name, s), s));
  ['@homeless', '@homé', '@home-made', '@home_', '@home2', 'éx@home'].forEach((s) => assert.ok(!t(at, s) && !t(name, s), s));
  // Only the names that are set: a Kick-only overlay looks for the slug, one with neither looks for nothing.
  assert.ok(t({ mentions: 'at', kick: 'kick-name' }, '@kick_name') && !t({ mentions: 'at', kick: 'kick-name' }, '@home'));
  assert.ok(t({ mentions: 'at', channel: 'home' }, '@home') && !t({ mentions: 'at', channel: 'home' }, '@kick-name'));
  ['', '@', 'anything', '@ hi'].forEach((s) => assert.ok(!t({ mentions: 'name', channel: '', kick: '' }, s), s));
  assert.ok(!t({ mentions: 'name' }, 'undefined'), 'a cfg without channels');
  // Off (the default, and a partial cfg): nothing.
  [{ channel: 'home' }, { mentions: 'off', channel: 'home' }, { mentions: 'nope', channel: 'home' }].forEach((c) =>
    assert.ok(!t(c, '@home'), JSON.stringify(c)));
});

test('mentions: a reply to the channel counts; the channel\'s own lines never do (Twitch login, Kick slug with _ or -)', () => {
  const cfg = { mentions: 'at', channel: 'home', kick: 'kick-name' };
  assert.strictEqual(hlCls(cfg, { text: 'thanks!', reply: { login: 'home' } }), 'line mention');
  assert.strictEqual(hlCls(cfg, { text: 'thanks!', reply: { login: 'someone' } }), 'line');
  assert.strictEqual(hlCls(cfg, { platform: 'kick', text: 'yes', reply: { login: 'kick_name' } }), 'line mention platform-kick');
  assert.strictEqual(hlCls(cfg, { platform: 'kick', text: 'yes', reply: { login: 'home' } }), 'line platform-kick', 'a Kick reply to a Kick user');
  // The channel's own lines: on Twitch by login, on Kick by the username its slug comes from.
  assert.strictEqual(hlCls(cfg, { login: 'home', text: 'welcome @home' }), 'line');
  assert.strictEqual(hlCls(cfg, { login: 'home', text: 'hi', reply: { login: 'home' } }), 'line');
  assert.strictEqual(hlCls(cfg, { platform: 'kick', login: 'kick_name', text: '@kick-name' }), 'line platform-kick');
  assert.strictEqual(hlCls(cfg, { platform: 'kick', login: 'home', text: '@home' }), 'line mention platform-kick', 'home is a Kick viewer there');
  // Notices and announcements are never tinted, whoever they name.
  assert.strictEqual(hlCls(cfg, { text: '@home', systemMsg: 'x' }, 'notice'), 'line notice');
  assert.strictEqual(hlCls(cfg, { text: '@home', announcement: 'BLUE' }), 'line announcement ann-blue');
});

test('keywords: any letter case, whole words at word ends, phrases with any run of spaces; highlight_users by login', () => {
  const cfg = { keywords: ['gg', 'good game', 'c++', '!!', 'ünï', 'こんにちは'] };
  const t = (text) => hlCls(cfg, { text: text }) === 'line keyword';
  ['gg', 'GG wp', 'that was gg.', 'good game', 'Good   Game!', 'i love c++', 'wow!!', 'hey!! there', 'ÜNÏ', 'こんにちは 世界', '(gg)']
    .forEach((s) => assert.ok(t(s), s));
  ['eggs', 'ggs', 'gg_', 'goodgame', 'good games', 'c+', 'ünïcode', 'xünï', 'gǵ', ''].forEach((s) => assert.ok(!t(s), s));
  // A phrase that starts or ends with a sign matches there as it is: '!!' right after a word, 'c++' before a sign.
  assert.ok(t('c++!') && t('a!!'));
  // Scripts without spaces between words (and Korean, whose particles join the word): a keyword in them matches
  // inside a run of their letters, and one of their letters beside a Latin keyword doesn't make it a longer word.
  const cjk = { keywords: config.coerce('keywords', 'かわいい, 草, ナイス, gg, nice, 대박') };
  const tc = (text) => hlCls(cjk, { text: text }) === 'line keyword';
  ['めっちゃかわいい！', '草草草', '草', 'ナイス！', 'ggです', 'gg요', 'ggー', '대박이다', 'ナイスgg', 'โอเคgg'].forEach((s) => assert.ok(tc(s), s));
  ['eggs', 'nicely', 'ggпривет', 'ggé', 'xgg', 'gg2'].forEach((s) => assert.ok(!tc(s), s));
  // A Turkish dotted capital I: config.js keeps 'İyi' as 'i̇yi' (toLowerCase), and the i flag never takes 'İ' for 'i'. The
  // keyword and the text both fold it to 'i', so any letter case matches, on either side.
  const tr = { keywords: config.coerce('keywords', 'İyi') };
  assert.ok(hlCls(tr, { text: 'İyi oyun' }) === 'line keyword' && hlCls(tr, { text: 'çok İyi!' }) === 'line keyword');
  assert.strictEqual(hlCls(tr, { text: 'İyilik' }), 'line', 'still whole words');
  const tk = (kw, text) => hlCls({ keywords: config.coerce('keywords', kw) }, { text: text });
  [['İyi', 'İYİ'], ['İyi', 'çok İYİ oyun'], ['İyi', 'iyi'], ['İyi', 'IYI'], ['iyi', 'İyi'], ['iyi', 'İYİ'], ['İYİ', 'İyi'],
    ['İYİ', 'iyi'], ['istanbul', 'İSTANBUL'], ['istanbul', 'İstanbul'], ['İstanbul', 'istanbul'], ['İstanbul', 'İSTANBUL']]
    .forEach(([kw, text]) => assert.strictEqual(tk(kw, text), 'line keyword', kw + ' in ' + text));
  [['İyi', 'İYİLİK'], ['iyi', 'İyilik'], ['İYİ', 'xİYİ'], ['spoiler', 'İspoiler']].forEach(([kw, text]) =>
    assert.strictEqual(tk(kw, text), 'line', kw + ' is no whole word in ' + text));
  // block_words, the same way.
  const trBlock = renderer.filtersFor({ block_words: config.coerce('block_words', 'istanbul, İyi') }).block;
  assert.deepStrictEqual(['İstanbul', 'İSTANBUL', 'iyi', 'İYİ', 'İyilik', 'Istanbullu'].map((t) => renderer.hasWords(t, trBlock)),
    [true, true, true, true, false, false]);
  assert.strictEqual(hlCls({ keywords: [] }, { text: 'gg' }), 'line');
  assert.strictEqual(hlCls({ keywords: ['', '  ', 5, null] }, { text: 'gg 5' }), 'line', 'only strings, and never an empty one');
  // highlight_users: the login, on Twitch and Kick alike; another tint slot, the same color.
  const users = { highlight_users: ['waver', 'kick_fan'] };
  assert.strictEqual(hlCls(users, { login: 'waver', text: 'hi' }), 'line user-hl');
  assert.strictEqual(hlCls(users, { login: 'WAVER', text: 'hi' }), 'line user-hl');
  assert.strictEqual(hlCls(users, { platform: 'kick', login: 'kick_fan', text: 'hi' }), 'line user-hl platform-kick');
  assert.strictEqual(hlCls(users, { login: 'wave', text: 'waver' }), 'line', 'by login, not by text');
  assert.strictEqual(hlCls({ highlight_users: ['constructor'] }, { login: '__proto__' }), 'line');
});

test('roleOf: Twitch badge tags (source badges on a mirrored line), Kick badge types; the highest role', () => {
  const tw = (sets, extra) => R.roleOf(Object.assign({ badges: sets.map((s) => ({ set: s, version: '1' })) }, extra || {}));
  assert.strictEqual(tw(['broadcaster', 'subscriber']), 'broadcaster');
  assert.strictEqual(tw(['subscriber', 'moderator']), 'mod');
  assert.strictEqual(tw(['lead_moderator']), 'mod');
  assert.strictEqual(tw(['vip', 'subscriber']), 'vip');
  assert.strictEqual(tw(['moderator', 'vip', 'broadcaster']), 'broadcaster');
  assert.strictEqual(tw(['subscriber']), 'sub');
  assert.strictEqual(tw(['founder']), 'sub');
  assert.strictEqual(tw(['premium', 'bits', 'glhf-pledge']), null);
  assert.strictEqual(tw([]), null);
  // Shared Chat: a line from another channel by its badges there; the home channel's own by its own.
  assert.strictEqual(tw(['broadcaster'], { mirrored: true, sourceBadges: [{ set: 'subscriber' }] }), 'sub');
  assert.strictEqual(tw(['subscriber'], { mirrored: true, sourceBadges: [{ set: 'moderator' }] }), 'mod');
  assert.strictEqual(tw(['moderator'], { mirrored: false, sourceBadges: [{ set: 'broadcaster' }] }), 'mod');
  // Kick: its badge types (kick.js keeps the known ones); Twitch's tags on a Kick line don't count.
  const kick = (types) => R.roleOf({ platform: 'kick', badges: [{ set: 'broadcaster' }], kickBadges: types.map((t) => ({ type: t })) });
  assert.strictEqual(kick(['og', 'moderator', 'subscriber']), 'mod');
  assert.strictEqual(kick(['broadcaster', 'verified']), 'broadcaster');
  assert.strictEqual(kick(['vip', 'og']), 'vip');
  assert.strictEqual(kick(['subscriber', 'sub_gifter']), 'sub');
  assert.strictEqual(kick(['og', 'verified', 'staff', 'sub_gifter']), null);
  [null, undefined, 'x', {}, { badges: 'moderator/1' }, { badges: [null, 5, { set: 7 }] }].forEach((m) => assert.strictEqual(R.roleOf(m), null));
  assert.strictEqual(renderer.roleOf, R.roleOf, 'exported for overlay.js');
});

test('role_style: role-<role> with role-bar or role-tint on chat lines; subscribers, notices and announcements get none', () => {
  const mod = { badges: [{ set: 'moderator' }], text: 'hi' };
  assert.strictEqual(hlCls({}, mod), 'line', 'off by default');
  assert.strictEqual(hlCls({ role_style: 'bar' }, mod), 'line role-mod role-bar');
  assert.strictEqual(hlCls({ role_style: 'tint' }, mod), 'line role-mod role-tint');
  assert.strictEqual(hlCls({ role_style: 'tint' }, { badges: [{ set: 'broadcaster' }] }), 'line role-broadcaster role-tint');
  assert.strictEqual(hlCls({ role_style: 'bar' }, { platform: 'kick', kickBadges: [{ type: 'vip' }] }), 'line role-vip role-bar platform-kick');
  assert.strictEqual(hlCls({ role_style: 'tint' }, { badges: [{ set: 'subscriber' }] }), 'line');
  assert.strictEqual(hlCls({ role_style: 'bar' }, Object.assign({ systemMsg: 'x' }, mod), 'notice'), 'line notice');
  assert.strictEqual(hlCls({ role_style: 'bar' }, Object.assign({ announcement: 'BLUE' }, mod)), 'line announcement ann-blue');
  // Works with badges off: the tags, not what is drawn.
  assert.strictEqual(hlCls({ role_style: 'bar', badges: false }, mod), 'line role-mod role-bar');
});

test('one tint per line: points > mention > keyword/user > role; bars stack (the stylesheet orders them); bg on or off alike', () => {
  const all = { mentions: 'at', channel: 'home', keywords: ['gg'], highlight_users: ['vipfan'], role_style: 'tint', first_msg: true,
    accent_bar: true };
  const msg = (extra) => Object.assign({ login: 'vipfan', text: '@home gg', badges: [{ set: 'vip' }], firstMsg: true }, extra);
  [0, 40].forEach((bg) => {
    const c = Object.assign({ bg: bg }, all);
    assert.strictEqual(hlCls(c, msg({ highlight: true })), 'line first-msg highlight accent role-vip', 'points');
    assert.strictEqual(hlCls(c, msg({})), 'line first-msg accent mention role-vip', 'mention');
    assert.strictEqual(hlCls(c, msg({ text: 'gg' })), 'line first-msg accent keyword role-vip', 'keyword');
    assert.strictEqual(hlCls(c, msg({ text: 'hi' })), 'line first-msg accent user-hl role-vip', 'user');
    assert.strictEqual(hlCls(c, msg({ text: 'hi', login: 'x' })), 'line first-msg accent role-vip role-tint', 'role');
    assert.strictEqual(hlCls(Object.assign({}, c, { points_highlight: false }), msg({ highlight: true })),
      'line first-msg accent mention role-vip', 'points off: the next tint takes it');
    // role_style=bar: the role's bar beside any tint (first-msg and accent are bars too: the stylesheet picks one).
    assert.strictEqual(hlCls(Object.assign({}, c, { role_style: 'bar' }), msg({})), 'line first-msg accent mention role-vip role-bar');
    // An announcement: no tint and no role, whatever it says (its own bar stays).
    assert.strictEqual(hlCls(c, msg({ announcement: 'BLUE', firstMsg: false })), 'line announcement ann-blue');
  });
});

test('the matchers: built once per cfg object, never stored on it; a new cfg (a live change) builds new ones', () => {
  const c1 = R.normalizeCfg({ mentions: 'at', channel: 'home', keywords: ['gg'], highlight_users: ['a'] });
  const before = Object.keys(c1).sort();
  const m1 = R.matchersFor(c1);
  assert.strictEqual(R.matchersFor(c1), m1, 'cached');
  assert.deepStrictEqual(Object.keys(c1).sort(), before, 'nothing added to the cfg');
  assert.ok(m1.mention instanceof RegExp && m1.keyword instanceof RegExp && m1.users.a === 1);
  assert.ok(!m1.mention.global && !m1.keyword.global, 'no g flag: test() keeps no state between lines');
  const c2 = R.normalizeCfg(Object.assign({}, c1, { keywords: ['wp'], mentions: 'off' }));
  const m2 = R.matchersFor(c2);
  assert.notStrictEqual(m2, m1);
  assert.strictEqual(m2.mention, null);
  assert.ok(m2.keyword.test('WP') && !m2.keyword.test('gg'));
  // Nothing on: nothing built that matches.
  assert.deepStrictEqual(R.matchersFor(R.normalizeCfg({})), { mention: null, channel: '', kickKey: '', keyword: null, users: null });
  assert.strictEqual(R.matchersFor(null).mention, null);
  // The live renderer: a changed keyword list re-marks the lines already drawn (tests/renderer-dom.test.js has the DOM).
  assert.ok(R.RERENDER_KEYS.indexOf('keywords') >= 0);
  assert.strictEqual(R.escapeRe('a.b*c(d)[e]{f}|g^h$i+j?k\\l/m-n'), 'a\\.b\\*c\\(d\\)\\[e\\]\\{f\\}\\|g\\^h\\$i\\+j\\?k\\\\l\\/m-n');
});

test('links: https://, http:// or www. where a word starts, never a bare domain or another scheme', () => {
  ['https://example.com', 'see http://x.io/a?b=1 ok', 'www.test.org/a', 'WWW.Test.org', '(https://x.com)', 'HTTP://X.IO',
    'go to https://clips.twitch.tv/demo!'].forEach((t) => assert.strictEqual(renderer.hasLink(t), true, t));
  ['example.com', 'e.g. this', 'lol.exe', 'ok.so', 'awww.cute', 'www.', 'https://', 'http:/x.com', 'mailto:a@b.c', 'steam://run/123',
    'C://Users', 'ftp://files.x', 'xhttps://x.com', '', null, 5].forEach((t) => assert.strictEqual(renderer.hasLink(t), false, String(t)));
});

test('links=shorten: each link as its host name, as text; what follows a link stays', () => {
  const s = renderer.shortenLinks;
  assert.strictEqual(s('check https://example.com/page?x=1 and www.test.org/a'), 'check example.com and www.test.org');
  assert.strictEqual(s('mirror mirror Kappa https://clips.twitch.tv/demo'), 'mirror mirror Kappa clips.twitch.tv');
  assert.strictEqual(s('HTTPS://Example.COM/A'), 'example.com', 'host names are lower case');
  assert.strictEqual(s('look: https://x.com/a, then https://y.com/b.'), 'look: x.com, then y.com.');
  assert.strictEqual(s('(see https://x.com/a)'), '(see x.com)', 'a bracket around the link stays');
  assert.strictEqual(s('https://en.wikipedia.org/wiki/Foo_(bar)'), 'en.wikipedia.org', 'a bracket of the link\'s own goes with it');
  assert.strictEqual(s('https://user:pw@evil.example/x'), 'evil.example', 'only the host');
  assert.strictEqual(s('https://例え.jp/x'), 'xn--r8jz45g.jp', 'an international name as the parser writes it');
  assert.strictEqual(s('https://[nope/x'), 'https://[nope/x', 'a link the parser rejects stays');
  assert.strictEqual(s('file:///etc/x'), 'file:///etc/x', 'no host: as it is');
  assert.strictEqual(s('steam://run/123 or C://Users'), 'steam://run/123 or C://Users', 'other schemes are no site: as they are');
  // Two links joined by a ',', ';' or '|' (another link straight after the sign) are two links: each as its host, the
  // sign kept. A scheme inside a link with no such sign before it (a redirect) is still part of that link.
  assert.strictEqual(s('https://a.com,https://b.com'), 'a.com,b.com');
  assert.strictEqual(s('see https://a.com/x,https://b.com/y ok'), 'see a.com,b.com ok');
  assert.strictEqual(s('https://a.com/x;HTTPS://b.com'), 'a.com;b.com');
  assert.strictEqual(s('links: https://a.com|www.b.com/y'), 'links: a.com|www.b.com');
  assert.strictEqual(s('https://a.com,www.b.com, and more'), 'a.com,www.b.com, and more');
  assert.strictEqual(s('https://x.com/r?u=https://y.com'), 'x.com', 'a redirect is one link');
  assert.strictEqual(s('https://x.com/?q=1,2;3|4'), 'x.com', 'signs inside a link stay in it');
  assert.strictEqual(s('no links here'), 'no links here');
  assert.strictEqual(s(undefined), undefined);
  // The items: text only, copied when changed, the rest as they were.
  const e = { type: 'emote', emote: { name: 'https://x.com' }, sp: true };
  const items = [{ type: 'text', text: 'see https://x.com/a', sp: false }, e, { type: 'text', text: 'plain', sp: true }];
  const out = renderer.shortenItems(items);
  assert.deepStrictEqual(out, [{ type: 'text', text: 'see x.com', sp: false }, e, items[2]]);
  assert.strictEqual(items[0].text, 'see https://x.com/a', 'the items handed in are not changed');
  assert.strictEqual(out[1], e);
  const plain = [{ type: 'text', text: 'hi', sp: false }];
  assert.strictEqual(renderer.shortenItems(plain), plain, 'nothing to shorten: the same array');
  assert.strictEqual(renderer.shortenItems(null), null);
  // A reply header's quote too, only with shorten.
  const reply = { name: 'A', body: 'look https://x.com/a' };
  assert.strictEqual(R.replyModel(reply, false).body, 'look https://x.com/a');
  assert.strictEqual(R.replyModel(reply, false, true).body, 'look x.com');
  assert.deepStrictEqual(R.replyModel(reply, true, true), { name: '@A', short: true });
  const m = (cfg) => R.modelFor({ login: 'b', reply: reply }, R.normalizeCfg(cfg), { kind: 'chat', items: [] }).reply.body;
  assert.deepStrictEqual([m({}), m({ links: 'hide' }), m({ links: 'shorten' })], ['look https://x.com/a', 'look https://x.com/a', 'look x.com']);
});

test('the chat filters\' patterns: built once per cfg object, never stored on it; prefixes escaped; words as keywords', () => {
  const c1 = { block_words: ['spoiler', 'bad words'], command_prefixes: '!?' };
  const f1 = renderer.filtersFor(c1);
  assert.strictEqual(renderer.filtersFor(c1), f1, 'cached');
  assert.deepStrictEqual(Object.keys(c1), ['block_words', 'command_prefixes'], 'nothing added to the cfg');
  assert.ok(!f1.block.global && !f1.command.global, 'no g flag: test() keeps no state between lines');
  const hw = (t) => renderer.hasWords(t, f1.block);
  assert.deepStrictEqual(['SPOILER alert', 'no spoilers', 'some BAD   words here', 'badwords', 'spoiler!', 'İspoiler'].map(hw),
    [true, false, true, false, true, false]);
  assert.strictEqual(renderer.hasWords('x', null), false);
  assert.strictEqual(renderer.hasWords(null, f1.block), false);
  assert.deepStrictEqual(['!cmd', '  ?cmd', 'hi !cmd', '#x', ''].map((t) => f1.command.test(t)), [true, true, false, false, false]);
  // The default and a cfg without the setting: '!' only, as /^\s*!/ always was.
  [{ command_prefixes: '!' }, {}, { command_prefixes: 5 }, { command_prefixes: 'ab' }].forEach((c) => {
    const re = renderer.filtersFor(c).command;
    assert.deepStrictEqual(['!x', ' \t!x', '?x', 'x!', 'a', 'b'].map((t) => re.test(t)), [true, true, false, false, false, false], JSON.stringify(c));
  });
  assert.strictEqual(renderer.filtersFor({}).block, null);
  // '-' and '^' are the signs themselves, never a range or a negation: '!-?' doesn't cover the digits between them.
  const range = renderer.filtersFor({ command_prefixes: '!-?' }).command;
  assert.deepStrictEqual(['!a', '-a', '?a', '0a', '"a', '/a', 'a'].map((t) => range.test(t)), [true, true, true, false, false, false, false]);
  const neg = renderer.filtersFor({ command_prefixes: '^' }).command;
  assert.deepStrictEqual(['^a', 'a', '!a'].map((t) => neg.test(t)), [true, false, false]);
  // Every allowed sign works on its own and with the others (escaped: ] \ and the rest stay literal).
  const all = config.PREFIX_CHARS;
  const every = renderer.filtersFor({ command_prefixes: all }).command;
  all.split('').forEach((ch) => {
    assert.ok(renderer.filtersFor({ command_prefixes: ch }).command.test(ch + 'cmd'), ch);
    assert.ok(every.test(ch + 'x'), ch);
  });
  ['a', '0', '"', '[', ']', '\\', '_', ' ', '`'].forEach((ch) => assert.strictEqual(every.test(ch + 'x'), false, JSON.stringify(ch)));
  assert.strictEqual(renderer.filtersFor(null).block, null);
});

test('keywords, mentions and block_words go by the text as drawn: an invisible character on or in a word doesn\'t hide it', () => {
  const cfg = { keywords: config.coerce('keywords', 'hype, ❤️, gg‍wp, می‌خواهم'), mentions: 'at', channel: 'streamer' };
  const cls = (text) => hlCls(cfg, { text: text });
  // A repeat's duplicate-bypass suffix (a bare U+034F, which is a mark, or ' U+E0000'), a zero-width space, a soft hyphen
  // or a word joiner: drawn as nothing, so the word is still there.
  ['hype͏', 'hype͏!', 'hy​pe', 'hy­pe', 'hy⁠pe', 'hype \u{E0000}', '﻿hype'].forEach((s) =>
    assert.strictEqual(cls(s), 'line keyword', JSON.stringify(s)));
  ['@streamer͏', '@stre​amer hi', 'hi @streamer⁠'].forEach((s) => assert.strictEqual(cls(s), 'line mention', JSON.stringify(s)));
  // Whole words still: what is left once they go is a longer word ('hypes'), or another one (a real accent is no
  // invisible character).
  ['hype͏s', 'hy​pes', 'hyṕe', 'hypé', '@streamer​x'].forEach((s) => assert.strictEqual(cls(s), 'line', JSON.stringify(s)));
  // Emoji and joined words keep matching: with or without the emoji's variation sign, and a phrase with a joiner in it.
  ['love ❤️ it', 'love ❤ it', 'gg‍wp', 'ggwp', 'می‌خواهم', 'میخواهم'].forEach((s) =>
    assert.strictEqual(cls(s), 'line keyword', JSON.stringify(s)));
  // A keyword of invisible characters alone is no keyword (it would match everything).
  assert.strictEqual(hlCls({ keywords: ['️', '‍‍', ' ͏ '] }, { text: 'anything at all' }), 'line');
  // block_words, the same way (overlay.js chatShown and quotesHidden).
  const block = renderer.filtersFor({ block_words: config.coerce('block_words', 'badword, ❤️') }).block;
  const hw = (s) => renderer.hasWords(s, block);
  assert.deepStrictEqual(['badword', 'badword͏', 'badword͏ fr', 'bad​word fr', 'bad­word', 'BAD⁠WORD', 'i ❤ it',
    'badwords', 'bad​words', 'bad word'].map(hw), [true, true, true, true, true, true, true, false, false, false]);
  assert.strictEqual(renderer.filtersFor({ block_words: ['​', '️'] }).block, null, 'no pattern from invisible words alone');
});

test('line classes: a whitelisted platform class for Kick lines; Twitch lines and unknown platforms get none', () => {
  assert.strictEqual(R.lineClasses({ platform: 'kick' }, {}, 'chat', false), 'line platform-kick');
  assert.strictEqual(R.lineClasses({ platform: 'kick' }, {}, 'notice', false), 'line notice platform-kick');
  assert.strictEqual(R.lineClasses({ platform: 'twitch' }, {}, 'chat', false), 'line');
  assert.strictEqual(R.lineClasses({ platform: 'x" onload="y' }, {}, 'chat', false), 'line');
  assert.strictEqual(R.lineClasses({ platform: 'constructor' }, {}, 'chat', false), 'line');
});

test('icon badges: known icons become icon models, unknown keys are dropped, platform icons survive badges=0', () => {
  const list = [
    { provider: 'platform', icon: 'kick', title: 'Kick' },
    { provider: 'kick', icon: 'kick-moderator', title: 'Moderator' },
    { provider: 'kick', icon: 'nope', title: 'Unknown' },
    { provider: 'kick', icon: '__proto__', title: 'Proto' },
    { provider: 'kick', title: 'Subscriber', urls: { 1: 'https://files.kick.com/sub/1' } }
  ];
  assert.deepStrictEqual(R.badgeModels(list, 1), [
    { icon: 'kick', title: 'Kick', platform: true },
    { icon: 'kick-moderator', title: 'Moderator', platform: false },
    { url: 'https://files.kick.com/sub/1', title: 'Subscriber', avatar: false, bg: null }
  ]);
  assert.deepStrictEqual(R.visibleBadges(list, { badges: false }), [list[0]]);
  const msg = { userId: 'kick:1', login: 'a', displayName: 'A', platform: 'kick' };
  const off = R.modelFor(msg, R.normalizeCfg({ badges: false }), { kind: 'chat', items: [], badges: list });
  assert.deepStrictEqual(off.badges, [{ icon: 'kick', title: 'Kick', platform: true }]);
  // A notice keeps only the platform icon; without one its model is unchanged.
  const n = R.modelFor({ systemMsg: 'Fan subscribed!', platform: 'kick' }, R.normalizeCfg({}), { kind: 'notice', badges: list });
  assert.deepStrictEqual(n, { kind: 'notice', cls: 'line notice platform-kick', system: 'Fan subscribed!', badges: [{ icon: 'kick', title: 'Kick', platform: true }] });
});

test('badge URL picker allows the local developer and Beta Tester assets but rejects other relative URLs', () => {
  assert.deepStrictEqual(R.badgeModels([
    { title: 'Developer', urls: { 1: 'img/logos/Badge.svg' } },
    { title: 'Beta Tester', urls: { 1: 'img/logos/Beta.svg' } },
    { title: 'Relative', urls: { 1: 'img/other.svg' } },
    { title: 'Data', urls: { 1: 'data:image/svg+xml,<svg></svg>' } }
  ], 1), [
    { url: 'img/logos/Badge.svg', title: 'Developer', avatar: false, bg: null },
    { url: 'img/logos/Beta.svg', title: 'Beta Tester', avatar: false, bg: null }
  ]);
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
  const opts = { px: 24, dpr: 2, gifs: true };
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
  ], { px: 24, dpr: 2, gifs: false });
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

test('a GIF drawn taller than Giphy\'s 200 px file loads the original as WebP, with the 200 px file and the tag\'s URL behind it', () => {
  const ORIG = 'https://media2.giphy.com/media/abc/giphy.gif?cid=1&rid=giphy.gif&ct=g';
  const SMALL = 'https://media2.giphy.com/media/abc/200.webp?cid=1&rid=200.webp&ct=g';
  const BIG = 'https://media2.giphy.com/media/abc/giphy.webp?cid=1&rid=giphy.webp&ct=g';
  // The tokenizer's own item for a gifs tag: the 200 px file, and the tag's URL as orig.
  const tok = tokenizer.tokenize({ text: 'look [GIF]', gifs: '5-9|abc|' + ORIG }, { lookup: () => null, gifs: true }).items;
  assert.deepStrictEqual(tok[1], { type: 'gif', url: SMALL, orig: ORIG, title: '[GIF]', sp: true });
  const gif = (cfg, dpr, items) => R.modelFor({ id: 'g', login: 'a', displayName: 'A' }, R.normalizeCfg(cfg),
    { kind: 'chat', items: items || tok, dpr: dpr || 1 }).parts.filter((p) => p.t === 'gif')[0];
  const small = { t: 'gif', url: SMALL, title: '[GIF]', orig: ORIG };
  const big = { t: 'gif', url: BIG, title: '[GIF]', alt: SMALL, orig: ORIG };
  // Drawn height in CSS px: text size x 1.75 (an emote) x emote_scale x gif_size (3 in a column, 1 in a row). Every
  // default keeps the 200 px file, at any DPR: the largest is size=large's 168 px.
  [[{}], [{ size: 'large' }], [{ size: 'large' }, 2], [{ size: 'small' }, 3], [{ text_px: 38 }], [{ text_px: 96, gif_size: '1x' }],
    [{ text_px: 96, layout: 'horizontal' }], [{ size: 'large', emote_scale: 200, gif_size: '1x' }], [{ emote_only: 'huge', size: 'large' }]]
    .forEach((c) => assert.deepStrictEqual(gif(c[0], c[1]), small, JSON.stringify(c)));
  // Past 200: 39 x 1.75 x 3 = 204.75, large at 125% = 210, 96 at 2x = 336, a row at 96 px and 150% = 252.
  [[{ text_px: 39 }], [{ size: 'large', emote_scale: 125 }], [{ text_px: 96, gif_size: '2x' }], [{ text_px: 96 }, 2],
    [{ text_px: 96, emote_scale: 150, layout: 'horizontal' }], [{ size: 'medium', emote_scale: 200 }]]
    .forEach((c) => assert.deepStrictEqual(gif(c[0], c[1]), big, JSON.stringify(c)));
  // Only the known URL shape has an original to swap in; a GIF without one keeps what it has.
  const other = [{ type: 'gif', url: 'https://media.giphy.com/media/abc/200.webp', orig: 'https://i.giphy.com/abc.gif', title: 'g' }];
  assert.deepStrictEqual(gif({ text_px: 96 }, 1, other), { t: 'gif', url: other[0].url, title: 'g', orig: other[0].orig });
  const bare = [{ type: 'gif', url: 'https://media.giphy.com/media/abc/200.webp', title: 'g' }];
  assert.deepStrictEqual(gif({ text_px: 96 }, 1, bare), { t: 'gif', url: bare[0].url, title: 'g' });
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
  const parts = R.partsFor(tk.items, { px: 24, dpr: 2, gifs: true });
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
  const m = R.modelFor(msg, R.normalizeCfg({ size: 'large' }), Object.assign({ dpr: 2 }, d));
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
  // OBS (dpr 1) at size=large: 32px badges come from the 2x (36px) file
  assert.strictEqual(R.modelFor(msg, R.normalizeCfg({ size: 'large' }), d).badges[0].url, 'https://v/2');
  // a moderated reply parent: no header
  assert.strictEqual(R.modelFor(msg, R.normalizeCfg({}), Object.assign({ noReply: true }, d)).reply, null);
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

test('timeText: the PC\'s clock, 24h zero-padded, 12h without AM/PM; nothing without a usable time', () => {
  const at = (h, m) => new Date(2026, 0, 1, h, m, 30).getTime(); // local time, whatever the test machine's zone
  assert.deepStrictEqual([[0, 5], [9, 5], [12, 30], [13, 7], [23, 59]].map(([h, m]) => R.timeText(at(h, m), '24h')),
    ['00:05', '09:05', '12:30', '13:07', '23:59']);
  assert.deepStrictEqual([[0, 5], [9, 5], [12, 30], [13, 7], [23, 59]].map(([h, m]) => R.timeText(at(h, m), '12h')),
    ['12:05', '9:05', '12:30', '1:07', '11:59']);
  assert.strictEqual(R.timeText(String(at(13, 7)), '24h'), '13:07', 'a ts as a string');
  [undefined, null, '', 0, -5, NaN, 'soon', Infinity, 9e15].forEach((ts) => {
    assert.strictEqual(R.timeText(ts, '24h'), '', String(ts));
  });
  ['off', undefined, '12H', 'toString'].forEach((mode) => assert.strictEqual(R.timeText(at(13, 7), mode), '', String(mode)));
});

test('modelFor: name_sep, timestamps and reply_style; at their defaults the model is as before', () => {
  const ts = new Date(2026, 0, 1, 15, 7).getTime();
  const msg = { id: 'x', userId: '12', login: 'bob', displayName: 'Bob', ts: ts, reply: { name: 'Alice', login: 'alice', body: 'hi' } };
  const d = { kind: 'chat', items: [{ type: 'text', text: 'yo', sp: false }], badges: [], name: { text: 'Bob', color: '#FF0000' } };
  const base = R.modelFor(msg, R.normalizeCfg({}), d);
  assert.deepStrictEqual(Object.keys(base), ['kind', 'cls', 'reply', 'badges', 'name', 'colon', 'msgColor', 'parts'], 'no time key');
  assert.deepStrictEqual(base.reply, { name: '@Alice', body: 'hi' });
  for (const cfg of [{ name_sep: 'colon', timestamps: 'off', reply_style: 'full' }, { name_sep: 'nope', timestamps: 'nope', reply_style: 'nope' }]) {
    assert.strictEqual(R.sigOf(R.modelFor(msg, R.normalizeCfg(cfg), d)), R.sigOf(base), JSON.stringify(cfg));
    assert.strictEqual(R.sigOf(R.modelFor(msg, cfg, d)), R.sigOf(base), 'not normalized: ' + JSON.stringify(cfg));
  }
  // The separators are fixed strings; a /me line keeps its space whatever is chosen.
  assert.deepStrictEqual(R.NAME_SEPS, { colon: ': ', space: ' ', dash: ' – ', arrow: ' › ' });
  Object.keys(R.NAME_SEPS).forEach((k) => {
    assert.strictEqual(R.modelFor(msg, R.normalizeCfg({ name_sep: k }), d).colon, R.NAME_SEPS[k], k);
    assert.strictEqual(R.modelFor(msg, R.normalizeCfg({ name_sep: k }), Object.assign({}, d, { action: true })).colon, ' ', k + ' /me');
  });
  assert.strictEqual(R.modelFor(msg, { name_sep: 'toString' }, d).colon, ': ');
  // Timestamps: the time last, on chat and notice lines alike.
  const t24 = R.modelFor(msg, R.normalizeCfg({ timestamps: '24h' }), d);
  assert.strictEqual(t24.time, '15:07');
  assert.deepStrictEqual(Object.assign({}, t24, { time: undefined }), Object.assign({}, base, { time: undefined }));
  assert.strictEqual(R.modelFor(msg, R.normalizeCfg({ timestamps: '12h' }), d).time, '3:07');
  assert.ok(!('time' in R.modelFor(Object.assign({}, msg, { ts: undefined }), R.normalizeCfg({ timestamps: '24h' }), d)), 'no ts, no time');
  const notice = { systemMsg: 'Bob subscribed.', ts: ts };
  assert.deepStrictEqual(R.modelFor(notice, R.normalizeCfg({ timestamps: '24h' }), { kind: 'notice' }),
    { kind: 'notice', cls: 'line notice', system: 'Bob subscribed.', time: '15:07' });
  assert.deepStrictEqual(R.modelFor(notice, R.normalizeCfg({}), { kind: 'notice' }), { kind: 'notice', cls: 'line notice', system: 'Bob subscribed.' });
  // The user's own line under a notice: none while the notice (which has it) is drawn; its own when it isn't.
  const part = R.userPart({ kind: 'notice', id: 'n1', type: 'resub', userId: '12', login: 'bob', systemMsg: 'Bob resubscribed.', text: 'hi', ts: ts });
  assert.ok(!('time' in R.modelFor(part, R.normalizeCfg({ timestamps: '24h' }), d)));
  const bare = R.userPart({ kind: 'notice', id: 'n2', type: 'resub', userId: '12', login: 'bob', systemMsg: '', text: 'hi', ts: ts });
  assert.strictEqual(R.modelFor(bare, R.normalizeCfg({ timestamps: '24h' }), d).time, '15:07');
  // reply_style=name: the name only, marked by its own flag (an empty body still means "@name: ").
  assert.deepStrictEqual(R.modelFor(msg, R.normalizeCfg({ reply_style: 'name' }), d).reply, { name: '@Alice', short: true });
  assert.deepStrictEqual(R.replyModel({ name: 'Bob', body: '' }), { name: '@Bob', body: '' });
  assert.deepStrictEqual(R.replyModel({ name: 'Bob', body: 'x' }, true), { name: '@Bob', short: true });
  assert.strictEqual(R.replyModel({ body: 'x' }, true), null);
  assert.strictEqual(R.modelFor(msg, R.normalizeCfg({ reply_style: 'name', replies: false }), d).reply, null);
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
  // The filters and event switches sweep the lines they now hide; links also rebuilds them (shorten rewrites the text).
  ['event_subs', 'event_gifts', 'event_raids', 'event_bits_badge', 'event_announcements', 'role_filter', 'allow_users', 'block_words',
    'min_length', 'links', 'command_prefixes'].forEach((k) => assert.ok(R.FILTER_KEYS.indexOf(k) >= 0, k));
  assert.deepStrictEqual(R.FILTER_KEYS.filter((k) => R.RERENDER_KEYS.indexOf(k) >= 0).sort(), ['links', 'shared']);
});

test('every live config key is handled by the renderer', () => {
  // setConfig handles these itself: applyRoot, reordering, fade re-timing, capping. Written out here, not read
  // from the renderer, so a key added to R.ROOT_KEYS is a decision this list records (tests/parity.test.js
  // checks that each one changes what is drawn).
  const ROOT_KEYS = ['size', 'font', 'shadow', 'bg', 'layout', 'align', 'animate', 'fade', 'max', 'text_weight',
    'text_color', 'line_height', 'text_case', 'names', 'name_weight', 'name_line', 'bg_color', 'bg_shape', 'bg_width',
    'spacing', 'notice_color', 'notice_size', 'first_msg_color', 'shadow_color', 'shadow_style', 'outline', 'outline_color',
    'paint_images', 'text_align', 'line_width', 'pad_x', 'edge_fade', 'row_sep', 'text_px', 'badge_size', 'emote_scale',
    'emote_only', 'gif_size', 'name_font', 'mention_color', 'keyword_color', 'points_color', 'broadcaster_color', 'mod_color',
    'vip_color', 'enter_style', 'enter_ms', 'fade_out_ms', 'exit_style', 'smooth_scroll'];
  assert.deepStrictEqual(R.ROOT_KEYS.slice().sort(), ROOT_KEYS.slice().sort());
  // The animations time the lines (new ones, and restartFades): they never rebuild one.
  ['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].forEach((k) => assert.ok(R.RERENDER_KEYS.indexOf(k) < 0, k));
  // The highlights are line classes, so they rebuild the lines; their colors are #chat variables only.
  ['mentions', 'keywords', 'highlight_users', 'points_highlight', 'role_style'].forEach((k) => {
    assert.ok(R.RERENDER_KEYS.indexOf(k) >= 0 && ROOT_KEYS.indexOf(k) < 0, k);
  });
  ['mention_color', 'keyword_color', 'points_color', 'broadcaster_color', 'mod_color', 'vip_color'].forEach((k) => {
    assert.ok(R.RERENDER_KEYS.indexOf(k) < 0, k);
  });
  // The name colors rebuild the lines (overlay.js nameFor reads them); so do the separator, the timestamps and the
  // reply header, which are drawn into each line. name_font is CSS on #chat only.
  ['name_color', 'name_fallback', 'readable_level', 'name_sep', 'timestamps', 'reply_style'].forEach((k) => {
    assert.ok(R.RERENDER_KEYS.indexOf(k) >= 0 && ROOT_KEYS.indexOf(k) < 0, k);
  });
  assert.ok(R.RERENDER_KEYS.indexOf('name_font') < 0);
  // accent_bar is drawn on each line (a class and the line's own --line-accent), so it rebuilds the lines.
  assert.ok(R.RERENDER_KEYS.indexOf('accent_bar') >= 0 && ROOT_KEYS.indexOf('accent_bar') < 0);
  // The sizes set #chat and pick new image files (and emote_only marks lines); gif_size too (a GIF drawn taller than
  // Giphy's 200 px file loads the original), and giant_emotes only rebuilds the lines.
  ['text_px', 'badge_size', 'emote_scale', 'emote_only', 'giant_emotes', 'gif_size'].forEach((k) => assert.ok(R.RERENDER_KEYS.indexOf(k) >= 0, k));
  assert.ok(ROOT_KEYS.indexOf('gif_size') >= 0 && ROOT_KEYS.indexOf('giant_emotes') < 0);
  const LIVE_KEYS = require('../js/config.js').LIVE_KEYS;
  assert.ok(Array.isArray(LIVE_KEYS) && LIVE_KEYS.length > 0);
  for (const k of LIVE_KEYS) {
    assert.ok(ROOT_KEYS.indexOf(k) >= 0 || R.RERENDER_KEYS.indexOf(k) >= 0 || R.FILTER_KEYS.indexOf(k) >= 0,
      k + ' is live but the renderer ignores it');
  }
  // and a renderer key that config never sends live is dead weight
  for (const k of R.RERENDER_KEYS.concat(R.FILTER_KEYS)) assert.ok(LIVE_KEYS.indexOf(k) >= 0, k + ' is not a live key');
});

test('isGenericFont: CSS generic families need no Google Fonts request', () => {
  assert.strictEqual(renderer.isGenericFont('system-ui'), true);
  assert.strictEqual(renderer.isGenericFont(' Serif '), true);
  assert.strictEqual(renderer.isGenericFont('Inter'), false);
  assert.strictEqual(renderer.isGenericFont(null), false);
});

test('partsFor caps images per message and drops duplicate overlays', () => {
  const b = emote('7tv', 'B');
  const dup = [emote('7tv', 'Z', { zw: true }), emote('7tv', 'Z', { zw: true }), emote('7tv', 'B')];
  const p = R.partsFor([{ type: 'emote', emote: b, sp: false, overlays: dup }], { px: 24, dpr: 1, gifs: true });
  assert.deepStrictEqual(p[0].ov.map((o) => o.name), ['Z'], 'the same image stacked twice (or on itself) is drawn once');
  const items = [];
  for (let i = 0; i < R.MAX_IMAGES + 5; i++) items.push({ type: 'emote', emote: b, sp: i > 0, overlays: [] });
  const parts = R.partsFor(items, { px: 24, dpr: 1, gifs: true });
  assert.strictEqual(parts.filter((x) => x.t === 'emote').length, R.MAX_IMAGES);
  assert.deepStrictEqual(parts[parts.length - 1], { t: 'text', s: ' B B B B B' }, 'past the cap emotes show as their names');
});

test('partsFor: 7TV sizes by its own 1x height; a row draws big emotes at emote height', () => {
  const stv = { provider: '7tv', name: 'S', w: 32, h: 32, urls: { 1: 'https://s/1', 2: 'https://s/2', 3: 'https://s/3', 4: 'https://s/4' } };
  assert.strictEqual(R.partsFor([{ type: 'emote', emote: stv, overlays: [] }], { px: 18, dpr: 2 })[0].url, 'https://s/2', 'small at dpr 2: 64px covers 63px');
  assert.strictEqual(R.partsFor([{ type: 'emote', emote: stv, overlays: [] }], { px: 24, dpr: 1 })[0].url, 'https://s/2', 'OBS medium: 64px covers 42px');
  const big = [{ type: 'emote', emote: emote('twitch', 'K'), big: true, overlays: [] }];
  assert.strictEqual(R.partsFor(big, { px: 24, dpr: 1 })[0].url, 'https://cdn.example/K/4', 'vertical: 3x emote height (126px)');
  assert.strictEqual(R.partsFor(big, { px: 24, dpr: 1, flatBig: true })[0].url, 'https://cdn.example/K/2', 'row: emote height (42px)');
});
