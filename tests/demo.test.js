'use strict';
const test = require('node:test');
const assert = require('node:assert');
const demo = require('../js/demo.js');
const ircParse = require('../js/irc-parse.js');

const TWITCH = { 25: 'Kappa', 305954156: 'PogChamp', 425618: 'LUL' };

function emoteMap(names, extra) {
  const m = new Map();
  names.forEach((n) => m.set(n, Object.assign({ name: n, zw: false, hidden: false }, extra)));
  return m;
}

// The overlay state demo.js reads (overlay.js S), with a few emotes per provider.
function fakeState(withRoom) {
  const stvGlobal = emoteMap(['EZ', 'Clap']);
  stvGlobal.set('RainTime', { name: 'RainTime', zw: true });
  const room = withRoom ? {
    stv: { emotes: emoteMap(['peepoHappy', 'catJAM']) },
    bttv: { emotes: emoteMap(['monkaS']) },
    ffz: { emotes: emoteMap(['OMEGALUL']) }
  } : null;
  return {
    cfg: { channel: 'forsen' },
    homeId: '22484632',
    rooms: { home: () => room },
    stvGlobal,
    bttvGlobal: emoteMap(['FeelsBadMan', 'catJAM']),
    ffzGlobal: emoteMap(['LilZ']),
    bttvPrefixes: new Set(['h!']),
    stv: { paints: new Map(), badges: new Map() },
    ffzBadges: { defs: new Map(), users: new Map() },
    chatterino: new Map(), ffzap: new Map(), bttvStaff: new Map(), homies: new Map(),
    bus: { emit() {} }
  };
}

// Every line of the demo script, once: start() plus one interval tick per remaining line.
function runScript(state) {
  const lines = [];
  const d = demo.createDemo({ getState: () => state, feed: (l) => lines.push(l) });
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  let tick = null;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => {};
  try {
    d.start();
    for (let i = 1; i < 12; i++) tick();
    d.stop();
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
  return lines;
}

test('twitchEmotesTag uses code-point positions', () => {
  const d = demo.createDemo({ getState: fakeState, feed() {} });
  const text = '\u{1F389}\u{1F389} Kappa LUL Kappa';
  const tag = d._twitchEmotesTag(text);
  assert.strictEqual(tag, '25:3-7,13-17/425618:9-11');
  const cps = Array.from(text);
  ircParse.parseEmotesTag(tag).forEach((e) =>
    assert.strictEqual(cps.slice(e.start, e.end + 1).join(''), TWITCH[e.id]));
  assert.strictEqual(d._twitchEmotesTag('no emotes here'), '');
  assert.strictEqual(d._twitchEmotesTag('KappaKappa xKappa'), '');
});

test('tag values round-trip through the IRC parser', () => {
  const v = 'a;b c\\d\re\nf ;; end\\';
  const p = ircParse.parseLine(demo._tagString({ 'system-msg': v, empty: '', undef: undefined }) + ' :tmi.twitch.tv USERNOTICE #x');
  assert.strictEqual(p.tags['system-msg'], v);
  assert.strictEqual(p.tags.empty, '');
  assert.strictEqual(p.tags.undef, '');
});

[true, false].forEach((withRoom) => {
  test('every demo line parses, and its Twitch emote ranges cover exactly their words' +
    (withRoom ? ' (channel emotes)' : ' (global emotes only)'), () => {
    const lines = runScript(fakeState(withRoom));
    assert.strictEqual(lines.length, 12);
    const kinds = {};
    lines.forEach((line) => {
      const p = ircParse.parseLine(line);
      assert.ok(p, line);
      assert.ok(p.command === 'PRIVMSG' || p.command === 'USERNOTICE', p.command);
      kinds[p.command] = (kinds[p.command] || 0) + 1;
      const m = p.command === 'PRIVMSG' ? ircParse.toChatMessage(p) : ircParse.toNoticeMessage(p);
      assert.strictEqual(p.params[0], '#forsen');
      assert.strictEqual(m.roomId, '22484632');
      assert.ok(/^demo-msg-\d+$/.test(m.id), m.id);
      const cps = Array.from(m.text);
      ircParse.parseEmotesTag(p.tags.emotes).forEach((e) =>
        assert.strictEqual(cps.slice(e.start, e.end + 1).join(''), TWITCH[e.id], line));
      // No stray escapes: the parsed text has no IRC escape left in it.
      assert.ok(m.text.indexOf('\\s') < 0 && m.text.indexOf('\\:') < 0, m.text);
    });
    assert.ok(kinds.PRIVMSG >= 8 && kinds.USERNOTICE === 2, JSON.stringify(kinds));
    // The resub's system message keeps its spaces and apostrophe.
    const resub = lines.map(ircParse.parseLine).filter((p) => p.tags['msg-id'] === 'resub')[0];
    assert.strictEqual(resub.tags['system-msg'], "Lurker_Supreme subscribed at Tier 1. They've subscribed for 6 months!");
    // The /me line is an action; the zero-width emote follows a normal one.
    const chat = lines.map(ircParse.parseLine).filter((p) => p.command === 'PRIVMSG').map(ircParse.toChatMessage);
    assert.ok(chat.some((m) => m.action && /^does a little dance /.test(m.text)));
    assert.ok(chat.some((m) => /^Kappa RainTime /.test(m.text)));
    if (withRoom) assert.ok(chat.some((m) => /^peepoHappy .* catJAM$/.test(m.text)), 'channel 7TV emotes first');
    else assert.ok(chat.some((m) => /^EZ .* Clap$/.test(m.text)), 'global 7TV emotes without a channel');
  });
});

[true, false].forEach((withRoom) => {
  test('the eighth line is emotes alone, so the preview shows emote_only' + (withRoom ? ' (channel emotes)' : ' (global emotes only)'), () => {
    const tokenizer = require('../js/tokenizer.js');
    const R = require('../js/renderer.js')._internal;
    const st = fakeState(withRoom);
    const home = st.rooms.home();
    const maps = (home ? [home.stv.emotes, home.bttv.emotes, home.ffz.emotes] : []).concat([st.stvGlobal, st.bttvGlobal, st.ffzGlobal]);
    const lookup = (w) => {
      const m = maps.filter((x) => x.has(w))[0];
      return m ? Object.assign({ provider: 'x', urls: { 1: 'https://cdn.example/' + w } }, m.get(w)) : null;
    };
    const items = (line) => tokenizer.tokenize(ircParse.toChatMessage(ircParse.parseLine(line)), { lookup }).items;
    const lines = runScript(st);
    assert.ok(R.emoteOnly(items(lines[7])), lines[7]);
    // and it is the only one: every other chat line has words in it.
    lines.forEach((l, i) => {
      if (i !== 7 && ircParse.parseLine(l).command === 'PRIVMSG') assert.strictEqual(R.emoteOnly(items(l)), false, l);
    });
  });
});

test('demo users get the cosmetics the catalog offers', () => {
  const st = fakeState(false);
  st.stv.paints.set('p1', { id: 'p1', bgImage: 'linear-gradient(red, blue)' });
  st.stv.paints.set('p2', { id: 'p2', bgImage: 'url("https://cdn.7tv.app/paint/x.webp")' });
  st.stv.badges.set('b1', {});
  let emitted = 0;
  st.bus.emit = () => { emitted++; };
  const d = demo.createDemo({ getState: () => st, feed() {} });
  d.onCatalog();
  assert.strictEqual(emitted, 1);
  assert.deepStrictEqual(d.effective('demo-2'), { paint: 'p1', badge: 'b1', sets: [] });
  assert.deepStrictEqual(d.effective('demo-4'), { paint: 'p2', badge: null, sets: [] });
  assert.deepStrictEqual(d.effective('demo-6'), { paint: null, badge: null, sets: [] });
  assert.strictEqual(d.effective('12345'), null, 'real chatters are left to 7TV');
  assert.deepStrictEqual(d.extraBadges('demo-1'), []);
  st.chatterino.set('x', [{ provider: 'chatterino', title: 'C' }]);
  assert.deepStrictEqual(d.extraBadges('demo-1'), [{ provider: 'chatterino', title: 'C' }]);
});

test('with a Kick channel set, every third line is a Kick event that kick.js parses; without one, none', () => {
  const kick = require('../js/kick.js');
  function run(cfg) {
    const state = Object.assign(fakeState(true), { cfg: cfg });
    const lines = [], kicks = [];
    const d = demo.createDemo({ getState: () => state, feed: (l) => lines.push(l), feedKick: (e, data) => kicks.push(kick.parseEvent(e, data)) });
    const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
    let tick = null;
    globalThis.setInterval = (fn) => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    try {
      d.start();
      for (let i = 1; i < 9; i++) tick();
      d.stop();
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
    return { lines, kicks };
  }
  const off = run({ channel: 'forsen' });
  assert.strictEqual(off.lines.length, 9);
  assert.strictEqual(off.kicks.length, 0);
  const on = run({ channel: 'forsen', kick: 'forsen' });
  assert.strictEqual(on.lines.length, 6);
  assert.deepStrictEqual(on.kicks.map((e) => e.type), ['message', 'message', 'notice']);
  const first = on.kicks[0].msg;
  assert.strictEqual(first.platform, 'kick');
  assert.strictEqual(first.text, 'hello from Kick! KEKW');
  assert.strictEqual(first.kickEmotes, '37226:17-20');
  assert.deepStrictEqual(first.kickBadges.map((b) => b.type), ['og', 'subscriber']);
  assert.match(on.kicks[1].msg.text, /^Twitch and Kick chat in one overlay (peepoHappy|catJAM)$/);
  assert.strictEqual(on.kicks[2].msg.systemMsg, 'KickSubber subscribed for 3 months!');
  // The Twitch script carries on where it was: the first six Twitch lines are the usual first six.
  assert.deepStrictEqual(on.lines.map((l) => ircParse.parseLine(l).command), off.lines.slice(0, 6).map((l) => ircParse.parseLine(l).command));
});
