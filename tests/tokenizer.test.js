'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const tk = require('../js/tokenizer.js');
const irc = require('../js/irc-parse.js');

const SOH = String.fromCharCode(1);
const CGJ = String.fromCharCode(0x034F); // 7TV/Chatterino duplicate-bypass suffix char
const ZWJ = String.fromCharCode(0x200D);
const TAG_ZWJ = String.fromCodePoint(0xE0002); // Chatterino-escaped ZWJ
const RAINBOW = String.fromCodePoint(0x1F308);
const SPARKLES = String.fromCodePoint(0x2728);
const TROLL = String.fromCodePoint(0x1F9CC);

function em(provider, name, extra) {
  return Object.assign({ provider, id: provider + ':' + name, name, w: 28, h: 28, urls: { 1: 'https://cdn.example/' + name + '/1x.webp' } }, extra);
}
const E = {
  KEKW: em('bttv', 'KEKW'),
  OMEGALUL: em('7tv', 'OMEGALUL'),
  RainTime: em('7tv', 'RainTime', { zw: true }),
  SoSnowy: em('bttv', 'SoSnowy', { zw: true }),
  ffzOverlay: em('ffz', 'ffzOverlay', { zw: true, flags: 0 }), // FFZ modifier without the Hidden bit
  ffzX: em('ffz', 'ffzX', { hidden: true, flags: 3 }),
  ffzY: em('ffz', 'ffzY', { hidden: true, flags: 5 }),
  ffzW: em('ffz', 'ffzW', { hidden: true, flags: 9 }),
  ffzCursed: em('ffz', 'ffzCursed', { hidden: true, flags: 16385 }),
  ffzHyper: em('ffz', 'ffzHyper', { hidden: true, flags: 12289 }) // Hidden|HyperRed|Shake: no static effect
};
const ALL = new Map(Object.keys(E).map((k) => [k, E[k]]));
const lookup = (w) => ALL.get(w) || null;
const PREFIXES = new Set(tk.BTTV_PREFIXES);

function tok(text, extra, opts) {
  return tk.tokenize(Object.assign({ text, action: false, emotes: '', gifs: '', bits: 0, msgId: '' }, extra),
    Object.assign({ lookup, bttvPrefixes: PREFIXES, gifs: true, cheers: true }, opts));
}
// Compact view: 'text:...', 'emote:name', 'cheer:word', 'gif:title'.
function view(items) {
  return items.map((it) => {
    if (it.type === 'text') return 'text:' + it.text;
    if (it.type === 'emote') return 'emote:' + it.emote.name + (it.overlays.length ? '+' + it.overlays.map((o) => o.name).join('+') : '');
    if (it.type === 'cheer') return 'cheer:' + it.text;
    return it.type + ':' + it.title;
  });
}
const NEUTRAL = { sx: 1, sy: 1, rot: 0, grow: false, cursed: false, zs: false };
const fx = (o) => Object.assign({}, NEUTRAL, o);

describe('text and spacing', () => {
  test('plain words merge into one text item; runs of spaces collapse; first item has no leading space', () => {
    const r = tok('  hello   world ');
    assert.deepEqual(r.items, [{ type: 'text', text: 'hello world', sp: false }]);
    assert.equal(r.action, false);
    assert.deepEqual(tok('').items, []);
  });

  test('sp flags mark a space before each item', () => {
    const r = tok('a KEKW b');
    assert.deepEqual(r.items.map((i) => i.sp), [false, true, true]);
    assert.equal(tk.plainText(r.items), 'a KEKW b');
  });
});

describe('Twitch emotes', () => {
  test('ranges become twitch emotes with v2 CDN urls (1.0/2.0/3.0 -> 1/2/4)', () => {
    const r = tok('Kappa hello Kappa', { emotes: '25:0-4,12-16' });
    assert.deepEqual(view(r.items), ['emote:Kappa', 'text:hello', 'emote:Kappa']);
    const e = r.items[0].emote;
    assert.equal(e.provider, 'twitch');
    assert.equal(e.id, '25');
    assert.deepEqual(e.urls, {
      1: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
      2: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
      4: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0'
    });
    assert.deepEqual(r.items.map((i) => i.sp), [false, true, true]);
    assert.deepEqual(tk.twitchEmote('emotesv2_95f3313913cc499eb86537c45c17828b', 'x').urls[4],
      'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_95f3313913cc499eb86537c45c17828b/default/dark/3.0');
  });

  test('ranges count code points: an astral emoji before the emote', () => {
    const text = RAINBOW + '  reefDance ' + SPARKLES;
    const r = tok(text, { emotes: 'emotesv2_2f9a0000000000000000000000000000:3-11' });
    assert.deepEqual(view(r.items), ['text:' + RAINBOW, 'emote:reefDance', 'text:' + SPARKLES]);
    const r2 = tok('<a ' + TROLL + ' forsenPls', { emotes: 'emotesv2_abc:5-13' });
    assert.deepEqual(view(r2.items), ['text:<a ' + TROLL, 'emote:forsenPls']);
  });

  test('out-of-range or invalid emote ids are ignored', () => {
    assert.deepEqual(view(tok('Kappa', { emotes: '25:0-40' }).items), ['text:Kappa']);
    assert.deepEqual(view(tok('Kappa', { emotes: '25<x:0-4' }).items), ['text:Kappa']);
    const ov = tok('Kappa Kappa', { emotes: '25:0-4,6-10/26:2-6' });
    assert.deepEqual(view(ov.items), ['emote:Kappa', 'emote:Kappa'], 'overlapping range skipped');
    assert.deepEqual(ov.items.map((i) => i.emote.id), ['25', '25']);
  });

  test('/me: ACTION stripped by toChatMessage, ranges counted after the prefix', () => {
    const p = irc.parseLine('@emotes=25:0-4,12-16;user-id=1 :u!u@u.tmi.twitch.tv PRIVMSG #c :' + SOH + 'ACTION Kappa waves Kappa' + SOH);
    const msg = irc.toChatMessage(p);
    const r = tk.tokenize(msg, { lookup });
    assert.equal(r.action, true);
    assert.deepEqual(view(r.items), ['emote:Kappa', 'text:waves', 'emote:Kappa']);
  });

  test('/me in raw text is stripped by the tokenizer too', () => {
    const r = tok(SOH + 'ACTION Kappa hi' + SOH, { emotes: '25:0-4' });
    assert.equal(r.action, true);
    assert.deepEqual(view(r.items), ['emote:Kappa', 'text:hi']);
  });

  test('gigantified-emote-message marks only the last Twitch emote big', () => {
    const r = tok('Kappa hi Kappa KEKW', { emotes: '25:0-4,9-13', msgId: 'gigantified-emote-message' });
    assert.deepEqual(r.items.filter((i) => i.type === 'emote').map((i) => i.big), [false, true, false]);
    const plain = tok('Kappa hi Kappa', { emotes: '25:0-4,9-13' });
    assert.ok(plain.items.every((i) => !i.big));
  });
});

describe('replies', () => {
  const reply = { id: 'p', userId: '77', login: 'lmnfm', name: 'LMNfm', body: 'x' };

  test('tokenize the full text, then strip "@parent " (keeps Twitch emote ranges aligned)', () => {
    const r = tok('@LMNfm Kappa cuh', { emotes: '25:7-11' });
    assert.deepEqual(view(r.items), ['text:@LMNfm', 'emote:Kappa', 'text:cuh']);
    const items = tk.stripReplyPrefix(r.items, reply);
    assert.deepEqual(view(items), ['emote:Kappa', 'text:cuh']);
    assert.equal(items[0].sp, false);
  });

  test('end-to-end from an IRC reply line', () => {
    const msg = irc.toChatMessage(irc.parseLine('@emotes=25:7-11;reply-parent-display-name=LMNfm;reply-parent-user-login=lmnfm;reply-parent-msg-id=p ' +
      ':u!u@u.tmi.twitch.tv PRIVMSG #xqc :@LMNfm Kappa cuh'));
    const items = tk.stripReplyPrefix(tk.tokenize(msg, { lookup }).items, msg.reply);
    assert.equal(tk.plainText(items), 'Kappa cuh');
    assert.equal(items[0].type, 'emote');
  });

  test('case-insensitive; login works when the display name is localized', () => {
    assert.deepEqual(view(tk.stripReplyPrefix(tok('@lmnfm hello there').items, reply)), ['text:hello there']);
    const jp = { name: String.fromCodePoint(0x767D, 0x767D), login: 'timpai20001029' };
    assert.deepEqual(view(tk.stripReplyPrefix(tok('@timpai20001029 hi').items, jp)), ['text:hi']);
  });

  test('leaves other text alone', () => {
    assert.deepEqual(view(tk.stripReplyPrefix(tok('@someoneelse hi').items, reply)), ['text:@someoneelse hi']);
    assert.deepEqual(view(tk.stripReplyPrefix(tok('@LMNfmX hi').items, reply)), ['text:@LMNfmX hi']);
    assert.deepEqual(view(tk.stripReplyPrefix(tok('hi @LMNfm').items, reply)), ['text:hi @LMNfm']);
    assert.deepEqual(view(tk.stripReplyPrefix(tok('KEKW').items, reply)), ['emote:KEKW']);
    assert.deepEqual(view(tk.stripReplyPrefix(tok('@LMNfm hi').items, null)), ['text:@LMNfm hi']);
    assert.deepEqual(tk.stripReplyPrefix(tok('@LMNfm').items, reply), []);
  });
});

describe('fast path without ranges', () => {
  test('messages with and without an emotes tag give the same items', () => {
    const text = 'hi ' + RAINBOW + ' KEKW RainTime h! OMEGALUL  x';
    assert.deepEqual(tok(text).items, tok(text, { emotes: '25:500-504' }).items);
    assert.deepEqual(tok(text, {}, { gifs: false }).items, tok(text).items);
  });
});

describe('text cleanup', () => {
  test('U+E0002 becomes U+200D without shifting later emote ranges', () => {
    const woman = String.fromCodePoint(0x1F469), laptop = String.fromCodePoint(0x1F4BB);
    const r = tok(woman + TAG_ZWJ + laptop + ' Kappa', { emotes: '25:4-8' });
    assert.deepEqual(view(r.items), ['text:' + woman + ZWJ + laptop, 'emote:Kappa']);
    assert.equal(tk.cleanText('a' + TAG_ZWJ + 'b' + TAG_ZWJ).text, 'a' + ZWJ + 'b' + ZWJ);
  });

  test('trailing " \\u034F" (and a bare trailing \\u034F) is stripped before emote matching', () => {
    const seen = [];
    const r = tok('KEKW ' + CGJ, {}, { lookup: (w) => { seen.push(w); return lookup(w); } });
    assert.deepEqual(view(r.items), ['emote:KEKW']);
    assert.deepEqual(seen, ['KEKW']);
    assert.equal(tk.cleanText('hello' + CGJ).text, 'hello');
    assert.equal(tk.cleanText('a' + CGJ + 'b').text, 'a' + CGJ + 'b', 'only a trailing one is removed');
  });

  test('doubled spaces (Chatterino duplicate bypass) collapse', () => {
    assert.deepEqual(view(tok('KEKW  KEKW').items), ['emote:KEKW', 'emote:KEKW']);
  });
});

describe('precedence via the injected lookup', () => {
  test('Twitch ranges win: lookup is never asked about words inside a range', () => {
    const asked = [];
    const stv = em('7tv', 'Kappa');
    const r = tok('Kappa Kappa', { emotes: '25:0-4' }, { lookup: (w) => { asked.push(w); return w === 'Kappa' ? stv : null; } });
    assert.equal(r.items[0].emote.provider, 'twitch');
    assert.equal(r.items[1].emote.provider, '7tv');
    assert.deepEqual(asked, ['Kappa'], 'only the second (unranged) word is looked up');
  });

  test('the injected lookup decides the emote (tokenizer adds no precedence)', () => {
    const personal = new Map([['KEKW', em('7tv-personal', 'KEKW')]]);
    const channel = new Map([['KEKW', em('bttv', 'KEKW')], ['OMEGALUL', em('7tv', 'OMEGALUL')]]);
    const global = new Map([['OMEGALUL', em('ffz', 'OMEGALUL')], ['LUL', em('ffz', 'LUL')]]);
    const chain = (w) => personal.get(w) || channel.get(w) || global.get(w) || null;
    const r = tok('KEKW OMEGALUL LUL nope', {}, { lookup: chain });
    assert.deepEqual(r.items.map((i) => i.type === 'emote' ? i.emote.provider : 'text'), ['7tv-personal', '7tv', 'ffz', 'text']);
  });

  test('the lookup result is used as-is and never mutated', () => {
    const r = tok('KEKW ffzX RainTime');
    assert.equal(r.items[0].emote, E.KEKW);
    assert.equal(E.KEKW.fx, undefined);
    assert.equal(E.KEKW.overlays, undefined);
  });

  test('cheers beat the lookup only when the message has bits', () => {
    const cheerEmote = em('7tv', 'Cheer100');
    const lk = (w) => (w === 'Cheer100' ? cheerEmote : null);
    assert.equal(tok('Cheer100', { bits: 100 }, { lookup: lk }).items[0].type, 'cheer');
    assert.equal(tok('Cheer100', { bits: 0 }, { lookup: lk }).items[0].type, 'emote');
  });

  test('no lookup at all is fine', () => {
    assert.deepEqual(view(tk.tokenize({ text: 'KEKW hi', emotes: '' }, {}).items), ['text:KEKW hi']);
  });
});

describe('zero-width stacking', () => {
  test('several zero-width emotes stack on one base', () => {
    const r = tok('KEKW RainTime SoSnowy ffzOverlay');
    assert.deepEqual(view(r.items), ['emote:KEKW+RainTime+SoSnowy+ffzOverlay']);
    assert.equal(r.items.length, 1);
  });

  test('a Twitch emote can be the base', () => {
    assert.deepEqual(view(tok('Kappa RainTime', { emotes: '25:0-4' }).items), ['emote:Kappa+RainTime']);
  });

  test('with no base, a zero-width emote renders inline', () => {
    assert.deepEqual(view(tok('RainTime').items), ['emote:RainTime']);
    assert.deepEqual(view(tok('hello RainTime').items), ['text:hello', 'emote:RainTime']);
  });

  test('a non-emote word resets the base', () => {
    assert.deepEqual(view(tok('KEKW hello RainTime').items), ['emote:KEKW', 'text:hello', 'emote:RainTime']);
    assert.deepEqual(view(tok('KEKW OMEGALUL RainTime').items), ['emote:KEKW', 'emote:OMEGALUL+RainTime'], 'stacks on the latest emote');
  });

  test('a cheer or a gif also resets the base', () => {
    assert.deepEqual(view(tok('KEKW Cheer1 RainTime', { bits: 1 }).items), ['emote:KEKW', 'cheer:Cheer1', 'emote:RainTime']);
  });
});

describe('zero-width and image caps', () => {
  test('at most 4 zero-width layers on one emote; the rest are dropped', () => {
    const r = tok('KEKW' + ' RainTime'.repeat(55));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].overlays.length, 4);
    assert.deepEqual(view(tok('KEKW RainTime SoSnowy ffzOverlay RainTime').items), ['emote:KEKW+RainTime+SoSnowy+ffzOverlay+RainTime']);
  });

  test('at most 300 emote images per message; later emote words stay text', () => {
    const ALL2 = new Map([['OK', em('7tv', 'OK')], ['Z', em('7tv', 'Z', { zw: true })]]);
    const ok = (text) => tk.tokenize({ text }, { lookup: (w) => ALL2.get(w) || null });
    const r = ok('OK '.repeat(330).trim()); // 989 characters, from a hostile history line
    assert.equal(r.items.length, 301);
    assert.equal(r.items.filter((i) => i.type === 'emote').length, 300);
    assert.equal(r.items[300].text, 'OK '.repeat(30).trim());
    // zero-width layers count too
    const z = ok('OK Z '.repeat(160).trim());
    assert.equal(z.items.filter((i) => i.type === 'emote').reduce((n, i) => n + 1 + i.overlays.length, 0), 300);
    // Twitch ranges too (adjacent one-character ranges from a hostile history line)
    const t = tok('a'.repeat(400), { emotes: '25:' + Array.from({ length: 400 }, (_, i) => i + '-' + i).join(',') });
    assert.equal(t.items.filter((i) => i.type === 'emote').length, 300);
    assert.equal(t.items[t.items.length - 1].type, 'text');
    // GIF ranges count too
    const GU = 'https://media.giphy.com/media/abc/giphy.gif';
    const g = tok('a'.repeat(400), { gifs: Array.from({ length: 400 }, (_, i) => i + '-' + i + '|id|' + GU).join(',') });
    assert.equal(g.items.filter((i) => i.type === 'gif').length, 300);
    assert.equal(g.items[g.items.length - 1].type, 'text');
    // cheermotes too, and emotes share the same budget
    const c = tok('O '.repeat(250) + 'cheer1 '.repeat(70).trim(), { bits: 70 }, { lookup: (w) => (w === 'O' ? em('7tv', 'O') : null) });
    assert.equal(c.items.filter((i) => i.type === 'emote').length, 250);
    assert.equal(c.items.filter((i) => i.type === 'cheer').length, 50);
    assert.equal(c.items[c.items.length - 1].type, 'text');
    // a real 500-character message of 2-letter emotes is not affected
    const real = ok('OK '.repeat(167).trim());
    assert.equal(real.items.length, 167);
  });

  test('text is cut at 1000 code points (history lines can be 16K)', () => {
    const long = 'x'.repeat(5000);
    assert.equal(tok(long).items[0].text.length, 1000);
    assert.equal(tok(RAINBOW.repeat(1500)).items[0].text, RAINBOW.repeat(1000));
    const r = tok('y'.repeat(999) + ' Kappa', { emotes: '25:1000-1004' });
    assert.deepEqual(view(r.items), ['text:' + 'y'.repeat(999)]);
    assert.equal(tok('z'.repeat(500)).items[0].text.length, 500);
  });
});

describe('FFZ Hidden modifiers', () => {
  test('apply their effect to the previous emote and are not drawn', () => {
    const r = tok('KEKW ffzX');
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].fx, fx({ sx: -1 }));
  });

  test('effects compose (FlipX, FlipY, GrowX, Cursed)', () => {
    const r = tok('KEKW ffzX ffzY ffzW ffzCursed');
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].fx, fx({ sx: -1, sy: -1, grow: true, cursed: true }));
  });

  test('a modifier with no static effect is still consumed', () => {
    const r = tok('KEKW ffzHyper');
    assert.deepEqual(view(r.items), ['emote:KEKW']);
    assert.deepEqual(r.items[0].fx, NEUTRAL);
  });

  test('applies to the base, not the zero-width overlay', () => {
    const r = tok('KEKW RainTime ffzX');
    assert.deepEqual(view(r.items), ['emote:KEKW+RainTime']);
    assert.deepEqual(r.items[0].fx, fx({ sx: -1 }));
  });

  test('with no target it renders as a normal emote', () => {
    const alone = tok('ffzX');
    assert.deepEqual(view(alone.items), ['emote:ffzX']);
    assert.equal(alone.items[0].fx, null);
    assert.deepEqual(view(tok('hello ffzX').items), ['text:hello', 'emote:ffzX']);
  });
});

describe('repeated flips', () => {
  test('a repeated FlipX/FlipY keeps the flip (flags, not a toggle)', () => {
    assert.deepEqual(tok('KEKW ffzX ffzX').items[0].fx, fx({ sx: -1 }));
    assert.deepEqual(tok('KEKW ffzY ffzX ffzY').items[0].fx, fx({ sx: -1, sy: -1 }));
    assert.deepEqual(tok('h! h! KEKW').items[0].fx, fx({ sx: -1 }));
    assert.deepEqual(tok('h! KEKW ffzX').items[0].fx, fx({ sx: -1 }));
  });
});

describe('BTTV prefix modifiers', () => {
  test('provider codes named like Object.prototype members are not prefixes', () => {
    const set = new Set(tk.BTTV_PREFIXES.concat(['constructor', 'toString', '__proto__']));
    const r = tok('constructor KEKW toString KEKW __proto__ KEKW', {}, { bttvPrefixes: set });
    assert.deepEqual(view(r.items), ['text:constructor', 'emote:KEKW', 'text:toString', 'emote:KEKW', 'text:__proto__', 'emote:KEKW']);
    assert.equal(r.items[1].fx, null);
  });

  test('h! applies FlipX to the next emote and is hidden', () => {
    const r = tok('h! KEKW');
    assert.deepEqual(view(r.items), ['emote:KEKW']);
    assert.deepEqual(r.items[0].fx, fx({ sx: -1 }));
    assert.equal(r.items[0].sp, false);
  });

  test('every prefix maps to its effect', () => {
    const cases = { 'h!': { sx: -1 }, 'v!': { sy: -1 }, 'w!': { grow: true }, 'c!': { cursed: true },
      'l!': { rot: -90 }, 'r!': { rot: 90 }, 'z!': { zs: true }, 'p!': {}, 's!': {} };
    assert.deepEqual(Object.keys(cases).sort(), [...tk.BTTV_PREFIXES].sort());
    for (const p of Object.keys(cases)) {
      const r = tok(p + ' KEKW');
      assert.deepEqual(view(r.items), ['emote:KEKW'], p);
      assert.deepEqual(r.items[0].fx, fx(cases[p]), p);
    }
  });

  test('prefixes stack, keep the prefix spacing, and work on Twitch emotes', () => {
    const r = tok('hi v! w! KEKW');
    assert.deepEqual(view(r.items), ['text:hi', 'emote:KEKW']);
    assert.equal(r.items[1].sp, true);
    assert.deepEqual(r.items[1].fx, fx({ sy: -1, grow: true }));
    const tw = tok('h! Kappa', { emotes: '25:3-7' });
    assert.equal(tw.items[0].emote.provider, 'twitch');
    assert.deepEqual(tw.items[0].fx, fx({ sx: -1 }));
  });

  test('a prefix with no following emote stays as text', () => {
    assert.deepEqual(view(tok('h! hello').items), ['text:h! hello']);
    assert.deepEqual(view(tok('h!').items), ['text:h!']);
    const trail = tok('KEKW h!');
    assert.deepEqual(view(trail.items), ['emote:KEKW', 'text:h!']);
    assert.equal(trail.items[0].fx, null);
    assert.deepEqual(view(tok('h! Cheer1', { bits: 1 }).items), ['text:h!', 'cheer:Cheer1']);
  });

  test('prefixes are only recognized when the BTTV prefix set is provided', () => {
    const r = tok('h! KEKW', {}, { bttvPrefixes: null });
    assert.deepEqual(view(r.items), ['text:h!', 'emote:KEKW']);
    assert.equal(r.items[1].fx, null);
    assert.deepEqual(view(tok('x! KEKW', {}, { bttvPrefixes: new Set(['x!']) }).items), ['text:x!', 'emote:KEKW'], 'unknown prefix codes are plain words');
  });
});

describe('cheers', () => {
  function cheer(word, bits) { return tok(word, { bits: bits === undefined ? 1 : bits }).items[0]; }

  test('only when the message has bits', () => {
    assert.equal(cheer('Cheer100', 0).type, 'text');
    assert.equal(cheer('Cheer100', 100).type, 'cheer');
    assert.equal(tok('Cheer100', { bits: 100 }, { cheers: false }).items[0].type, 'text');
  });

  test('Kappa100 is tier 100 on the public CDN', () => {
    const c = cheer('Kappa100', 100);
    assert.equal(c.type, 'cheer');
    assert.equal(c.prefix, 'Kappa');
    assert.equal(c.amount, 100);
    assert.equal(c.tier, 100);
    assert.equal(c.color, tk.TIER_COLORS[100]);
    assert.equal(c.text, 'Kappa100');
    assert.equal(c.urls[1], 'https://d3aqoihi2n8ty8.cloudfront.net/actions/kappa/dark/animated/100/1.gif');
    assert.equal(c.urls[4], 'https://d3aqoihi2n8ty8.cloudfront.net/actions/kappa/dark/animated/100/4.gif');
  });

  test('tier selection and the 100000 cap', () => {
    const tiers = { cheer1: 1, cheer99: 1, cheer100: 100, cheer999: 100, cheer1000: 1000, cheer4999: 1000,
      cheer5000: 5000, cheer9999: 5000, cheer10000: 10000, cheer99999: 10000, cheer100000: 100000, cheer250000: 100000,
      doodlecheer100000: 100000, anon100000: 100000, kappa100000: 10000, cheerwhal100000: 10000, pride123456: 10000 };
    for (const w of Object.keys(tiers)) assert.equal(cheer(w).tier, tiers[w], w);
    assert.ok(cheer('cheer100000').urls[1].includes('/cheer/dark/animated/100000/'));
    assert.ok(cheer('kappa100000').urls[1].includes('/kappa/dark/animated/10000/'));
  });

  test('longest prefix wins (cheerwhal, not cheer)', () => {
    assert.equal(cheer('cheerwhal100').prefix, 'cheerwhal');
    assert.equal(cheer('CheerWhal100').urls[1], 'https://d3aqoihi2n8ty8.cloudfront.net/actions/cheerwhal/dark/animated/100/1.gif');
  });

  test('unknown prefixes and malformed words stay text', () => {
    ['BibleThump100', 'PetsPog100', 'cheer', 'Cheer100x', 'cheer0', 'xcheer100', '100cheer'].forEach((w) => {
      assert.deepEqual(view(tok(w, { bits: 100 }).items), ['text:' + w], w);
    });
  });

  test('several cheers in one message', () => {
    const r = tok('Cheer1 a Cheer1 Cheer1', { bits: 3 });
    assert.deepEqual(view(r.items), ['cheer:Cheer1', 'text:a', 'cheer:Cheer1', 'cheer:Cheer1']);
    assert.equal(tk.plainText(r.items), 'Cheer1 a Cheer1 Cheer1');
  });

  test('amounts are capped at 7 digits (no Infinity)', () => {
    assert.equal(tk.cheerFor('cheer9999999').amount, 9999999);
    assert.equal(tk.cheerFor('cheer10000000'), null);
    assert.equal(tk.cheerFor('cheer' + '9'.repeat(400)), null);
    assert.deepEqual(view(tok('cheer' + '9'.repeat(400), { bits: 1 }).items), ['text:cheer' + '9'.repeat(400)]);
  });

  test('cheerFor is exported', () => {
    assert.equal(tk.cheerFor('ShowLove5000').tier, 5000);
    assert.equal(tk.cheerFor('nope100'), null);
  });
});

describe('gifs', () => {
  const TITLE = '[Uh Oh Wrestling GIF by WWE]';
  const URL = 'https://media2.giphy.com/media/3oFzm0o2jMKftsaBoc/giphy.gif?cid=abc123&rid=giphy.gif&ct=g';

  test('a giphy original is swapped for the 200 px rendition; the original is kept as orig', () => {
    const r = tok(TITLE, { gifs: '0-27|3oFzm0o2jMKftsaBoc|' + URL });
    assert.deepEqual(r.items, [{ type: 'gif', url: 'https://media2.giphy.com/media/3oFzm0o2jMKftsaBoc/200.webp?cid=abc123&rid=200.webp&ct=g',
      orig: URL, title: TITLE, sp: false }]);
    const one = (u) => tok(TITLE, { gifs: '0-27|id|' + u }).items[0].url;
    assert.equal(one('https://media0.giphy.com/media/v1.Y2lkPTc5/3oFzm0o2jMKftsaBoc/giphy.gif?cid=1&ep=2&rid=giphy.gif&ct=g'),
      'https://media0.giphy.com/media/v1.Y2lkPTc5/3oFzm0o2jMKftsaBoc/200.webp?cid=1&ep=2&rid=200.webp&ct=g');
    assert.equal(one('https://media.giphy.com/media/abc/giphy.gif'), 'https://media.giphy.com/media/abc/200.webp');
  });

  test('other giphy url shapes are used unmodified', () => {
    ['https://i.giphy.com/abc.gif', 'https://media2.giphy.com/media/abc/200.gif?cid=1', 'https://giphy.com/media/abc/giphy.gif',
      'https://media2.giphy.com/media/a/b/c/giphy.gif', 'https://media2.giphy.com/media/abc/giphy.gif#x'].forEach((u) => {
      const it = tok(TITLE, { gifs: '0-27|id|' + u }).items[0];
      assert.equal(it.url, u, u);
      assert.equal(it.orig, u, u);
    });
  });

  test('non-giphy, non-https or unsafe urls are rejected and the title stays text', () => {
    ['https://evil.example/x.gif', 'http://media2.giphy.com/media/x/giphy.gif', 'https://media2.giphy.com/x".gif',
      'https://giphy.com.evil.net/x.gif', 'javascript:alert(1)'].forEach((u) => {
      assert.deepEqual(view(tok(TITLE, { gifs: '0-27|id|' + u }).items), ['text:' + TITLE], u);
    });
  });

  test('disabled with gifs:false', () => {
    assert.deepEqual(view(tok(TITLE, { gifs: '0-27|id|' + URL }, { gifs: false }).items), ['text:' + TITLE]);
  });

  test('mixed with words and Twitch emotes', () => {
    const r = tok('lol [Title] Kappa', { gifs: '4-10|id|' + URL, emotes: '25:12-16' });
    assert.deepEqual(view(r.items), ['text:lol', 'gif:[Title]', 'emote:Kappa']);
    assert.deepEqual(r.items.map((i) => i.sp), [false, true, true]);
    assert.equal(tk.plainText(r.items), 'lol [Title] Kappa');
  });

  test('a gif resets the zero-width base', () => {
    assert.deepEqual(view(tok('KEKW [T] RainTime', { gifs: '5-7|id|' + URL }).items), ['emote:KEKW', 'gif:[T]', 'emote:RainTime']);
  });
});
