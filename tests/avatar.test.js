'use strict';
// Avatar mode (js/avatar.js): a picture says each chat message in a speech bubble, one at a time. The pure helpers, then
// createAvatar on the minimal fake DOM (tests/fake-dom.js) with mocked timers, as tests/renderer-dom.test.js runs the
// renderer.
const test = require('node:test');
const assert = require('node:assert');
const config = require('../js/config.js');
const util = require('../js/util.js');
const avatar = require('../js/avatar.js');
const { createDocument } = require('./fake-dom.js');
const { flip } = require('./flip.js');

const A = avatar._internal;

// ---------- pure helpers ----------

test('innerCfg: the bubble\'s renderer draws one line in a column, with no box, shadow or animation of its own', () => {
  const cfg = Object.assign(config.defaults(), { layout: 'horizontal', align: 'top', animate: true, fade: 30, max: 50, bg: 80,
    shadow: 3, line_width: 30, edge_fade: 4, row_sep: 'dot', row_grow: true, smooth_scroll: true, font: 'Roboto', size: 'large' });
  const c = A.innerCfg(cfg);
  assert.deepStrictEqual({ layout: c.layout, align: c.align, animate: c.animate, fade: c.fade, max: c.max, bg: c.bg, shadow: c.shadow,
    line_width: c.line_width, edge_fade: c.edge_fade, row_sep: c.row_sep, row_grow: c.row_grow, smooth_scroll: c.smooth_scroll },
  { layout: 'vertical', align: 'bottom', animate: false, fade: 0, max: 1, bg: 0, shadow: 0, line_width: 0, edge_fade: 0,
    row_sep: 'none', row_grow: false, smooth_scroll: false });
  assert.strictEqual(c.font, 'Roboto', 'the rest as set');
  assert.strictEqual(c.size, 'large');
  assert.strictEqual(cfg.layout, 'horizontal', 'the config itself is left alone');
  // Every forced value is a valid setting.
  Object.keys(A.INNER).forEach((k) => assert.deepStrictEqual(config.coerce(k, config.serialize(k, A.INNER[k])), A.INNER[k], k));
});

test('pictures: a bundled pair by name, or custom\'s own (talk only with an idle one)', () => {
  assert.deepStrictEqual(A.pictures({ avatar: 'blob' }), { idle: 'img/avatars/blob-idle.png', talk: 'img/avatars/blob-talk.png' });
  Object.keys(avatar.PRESETS).forEach((k) => {
    assert.ok(config.SPEC.avatar.values.indexOf(k) >= 0, k + ' is an avatar value');
    avatar.PRESETS[k].forEach((f) => assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', f)), f));
  });
  // Every value but off and custom is a bundled pair.
  assert.deepStrictEqual(config.SPEC.avatar.values.filter((v) => v !== 'off' && v !== 'custom').sort(), Object.keys(avatar.PRESETS).sort());
  const png = 'https://example.com/me.png', talk = 'https://example.com/me-talk.png';
  assert.deepStrictEqual(A.pictures({ avatar: 'custom', avatar_idle: png, avatar_talk: talk }), { idle: png, talk: talk });
  assert.deepStrictEqual(A.pictures({ avatar: 'custom', avatar_idle: png }), { idle: png, talk: '' });
  assert.deepStrictEqual(A.pictures({ avatar: 'custom', avatar_talk: talk }), { idle: '', talk: '' }, 'none without an idle picture');
  assert.deepStrictEqual(A.pictures({ avatar: 'bot', avatar_idle: png }).idle, 'img/avatars/bot-idle.png', 'a bundled one wins');
  assert.deepStrictEqual(A.pictures({ avatar: '__proto__' }), { idle: '', talk: '' });
});

test('cssUrl: absolute against the page, and no character that could end the value', () => {
  assert.strictEqual(A.cssUrl('img/avatars/blob-idle.png', 'https://chat.masstar.org/overlay.html?channel=x'),
    'url("https://chat.masstar.org/img/avatars/blob-idle.png")');
  assert.strictEqual(A.cssUrl('data:image/png;base64,iVBOR+/=', 'https://x/'), 'url("data:image/png;base64,iVBOR+/=")');
  const u = A.cssUrl('https://example.com/a b"c\'d(e)f\\g\nh.png');
  assert.match(u, /^url\("[^"'()\\\s]*"\)$/, u);
  assert.strictEqual(A.cssUrl('a.png', ''), 'url("a.png")', 'no base: as it is');
});

test('bubbleLook: dark text on a light bubble, white on a dark one; text_color wins; names darken on a light one', () => {
  assert.deepStrictEqual(A.bubbleLook({}), { color: '#ffffff', set: false, ink: '#1d1d22', notice: '#5b34c9', back: [255, 255, 255] });
  const dark = A.bubbleLook({ bubble_color: '1f2233' });
  assert.deepStrictEqual([dark.color, dark.set, dark.ink, dark.back], ['#1f2233', true, '#ffffff', null]);
  assert.strictEqual(dark.notice, '#e2d6ff', 'the chat\'s own notice color on a dark bubble');
  assert.strictEqual(A.bubbleLook({ bubble_color: 'ffe08a' }).ink, '#1d1d22');
  assert.strictEqual(A.bubbleLook({ bubble_color: '1f2233', text_color: 'ff8800' }).ink, '#ff8800');
  // On the light bubble a light name is darkened, as on a light box (util.readableColor).
  const yellow = util.parseHex(util.readableColor('#FFFF00', 4.5, A.bubbleLook({}).back));
  assert.ok(yellow[0] < 200 && yellow[1] < 200 && yellow[2] === 0, 'darkened: ' + yellow);
  assert.strictEqual(util.readableColor('#FFFF00', 4.5, A.bubbleLook({ bubble_color: '1f2233' }).back), '#ffff00', 'kept on a dark one');
});

test('unitKind: spaces, sentence ends and pauses, and the rest', () => {
  assert.deepStrictEqual([' ', '.', '!', '?', '…', '。', ',', ';', ':', '、', 'a', 'é', '😀', '👍🏽', '1'].map(A.unitKind),
    ['space', 'end', 'end', 'end', 'end', 'end', 'mid', 'mid', 'mid', 'mid', 'char', 'char', 'char', 'char', 'char']);
});

test('typeSchedule: a letter a step, a space with what follows it, pauses after punctuation, faster while busy', () => {
  const s = A.typeSchedule(['char', 'char', 'space', 'char', 'end', 'space', 'emote'], 10, false);
  assert.strictEqual(s.base, 100);
  assert.deepStrictEqual(s.at, [0, 100, 200, 200, 300, 900, 900], 'the space shows with the next letter; an end pauses 5 letters');
  assert.strictEqual(s.total, 1100, 'an emote takes two letters');
  assert.strictEqual(A.typeSchedule(['char', 'mid', 'char'], 10, false).at[2], 400, 'a comma pauses 2 letters');
  assert.strictEqual(A.typeSchedule(['char', 'char'], 10, true).base, 50, 'busy: twice as fast');
  const long = A.typeSchedule(new Array(1000).fill('char'), 30, false);
  assert.ok(Math.abs(long.total - A.TYPE_MAX_MS) < 1e-6, 'a long message is typed in TYPE_MAX_MS');
  assert.ok(long.at[999] < A.TYPE_MAX_MS);
  assert.strictEqual(A.letters(['char', 'space', 'emote', 'end', 'mid']), 5);
});

test('holdMs: its reading time, at least READ_MIN_MS and at most bubble_time; half while others wait', () => {
  assert.strictEqual(A.holdMs(1, { bubble_time: 6 }, false), A.READ_MIN_MS);
  assert.strictEqual(A.holdMs(1000, { bubble_time: 6 }, false), 6000);
  assert.strictEqual(A.holdMs(50, { bubble_time: 30 }, false), 1500 + 55 * 50);
  assert.strictEqual(A.holdMs(1000, { bubble_time: 6 }, true), 3000);
  assert.strictEqual(A.holdMs(1, { bubble_time: 6 }, true), A.READ_MIN_MS / 2);
  assert.strictEqual(A.holdMs(1, { bubble_time: 2 }, true), A.BUSY_MIN_MS, 'at least BUSY_MIN_MS');
  assert.strictEqual(A.holdMs(1000, { bubble_time: 1 }, false), 1000, 'bubble_time is the most, below the minimum too');
  assert.strictEqual(A.holdMs(1000, { bubble_time: 1 }, true), 1000);
  assert.strictEqual(A.talkMs(10, false), 450);
  assert.strictEqual(A.talkMs(1000, false), A.TALK_MAX_MS);
  assert.strictEqual(A.talkMs(10, true), 225);
});

// ---------- createAvatar ----------

let nid = 0;
function chat(login, text, extra) {
  return Object.assign({ kind: 'chat', id: 'm' + (++nid), userId: 'u-' + login, login: login, displayName: login, text: text }, extra || {});
}
function resub(login, text) {
  return { kind: 'notice', type: 'resub', id: 'n' + (++nid), userId: 'u-' + login, login: login, displayName: login,
    systemMsg: login + ' resubscribed', text: text };
}

// An avatar on a fresh fake document, timers (and Date) mocked so tests step time by hand.
function setup(t, cfg, deps, hints) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const doc = createDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const a = avatar.createAvatar({ root: root, cfg: Object.assign(config.defaults(), { avatar: 'blob' }, cfg || {}), deps: deps || {},
    onHint: hints ? (h) => hints.push(h) : undefined });
  const linesEl = root.byClass('lines')[0];
  t.after(() => a.destroy());
  const s = {
    doc, root, a, linesEl,
    lines: () => linesEl.children,
    said: () => linesEl.children.map((l) => l.byClass('message').map((m) => m.textContent).join('')).join(' / '),
    // The letters shown so far: the message's text without its units still hidden (.tw) or cut (.tw-cut).
    shown: () => {
      let out = '';
      const walk = (n) => n.childNodes.forEach((k) => {
        if (k.nodeType === 3) out += k.textContent;
        else if (!k.classList.contains('tw') && !k.classList.contains('tw-cut')) walk(k);
      });
      linesEl.children.forEach((l) => l.byClass('message').forEach(walk));
      return out;
    },
    has: (c) => root.classList.contains(c),
    tick: (ms) => t.mock.timers.tick(ms),
    // The mocked clock is at the end of a tick while its timers run, so a timer one of them sets is due after it: step
    // through time in small ticks where one timer leads to the next (the bubble's exit, then the next message).
    step: (ms) => { for (let i = 0; i < ms; i += 10) t.mock.timers.tick(Math.min(10, ms - i)); },
    // Steps time until the bubble has said its message and gone, and the next one can start.
    finish: () => { for (let i = 0; i < 200 && s.a.stats().saying; i++) t.mock.timers.tick(100); t.mock.timers.tick(500); }
  };
  return s;
}

test('createAvatar: the picture before the bubble in #chat, the look on #chat', (t) => {
  const s = setup(t);
  assert.deepStrictEqual(s.root.children.map((c) => c.className), ['speaker', 'lines']);
  assert.deepStrictEqual(s.root.byClass('speaker')[0].byClass('speaker-bob')[0].byClass('speaker-body')[0].children.map((c) => c.className),
    ['speaker-idle', 'speaker-talk']);
  assert.strictEqual(s.root.byClass('speaker')[0].getAttribute('aria-hidden'), 'true');
  ['has-avatar', 'avatar-left', 'bubble-side', 'motion-bounce', 'layout-vertical'].forEach((c) => assert.ok(s.has(c), c));
  ['avatar-right', 'bubble-above', 'avatar-flip', 'bubble-on', 'talking', 'mouth-open'].forEach((c) => assert.ok(!s.has(c), c));
  assert.strictEqual(s.root.style['--avatar-idle'], 'url("img/avatars/blob-idle.png")');
  assert.strictEqual(s.root.style['--avatar-talk'], 'url("img/avatars/blob-talk.png")');
  assert.strictEqual(s.root.style['--avatar-size'], '300px');
  assert.strictEqual(s.root.style['--bubble-w'], '18em');
  assert.strictEqual(s.root.style['--bubble-ink'], '#1d1d22');
  assert.strictEqual(s.root.style['--bubble-color'], undefined, 'white: the stylesheet\'s');
  assert.strictEqual(s.root.style['--shadow'], 'none', 'the bubble\'s text has no shadow');
});

test('one message at a time: typed out as the mouth moves, held, then the next', (t) => {
  const s = setup(t, { bubble_speed: 10 });
  s.a.push(chat('amy', 'hi there'));
  s.a.push(chat('bob', 'second'));
  s.a.push(chat('cat', 'third'));
  assert.strictEqual(s.lines().length, 1, 'one line in the bubble');
  assert.strictEqual(s.said(), 'hi there');
  assert.strictEqual(s.a.stats().waiting, 2);
  assert.ok(s.has('bubble-on') && s.has('talking'));
  assert.strictEqual(s.shown(), 'h', 'the first letter at once');
  assert.ok(s.has('mouth-open'));
  s.tick(100);
  assert.strictEqual(s.shown(), 'hi');
  s.tick(100);
  assert.strictEqual(s.shown(), 'hi t', 'the space came with the letter after it');
  // The mouth opens and shuts while letters come.
  let flaps = 0, was = s.has('mouth-open');
  for (let i = 0; i < 6; i++) { s.tick(55); if (s.has('mouth-open') !== was) { flaps++; was = !was; } }
  assert.ok(flaps >= 2, 'it flaps (' + flaps + ')');
  // Typed out at 600 ms (8 units, a space with the t), now 530 ms in: held from there its busy reading time (two
  // others wait), then it pops out.
  s.tick(70);
  assert.strictEqual(s.shown(), 'hi there');
  assert.strictEqual(s.a.stats().saying, 'hold');
  const hold = A.holdMs(7, config.defaults(), true);
  s.tick(300);
  assert.ok(!s.has('mouth-open'), 'shut once the letters stop');
  s.tick(hold - 310);
  assert.ok(s.has('bubble-on'), 'held');
  s.tick(20);
  assert.ok(!s.has('bubble-on'), 'popped out');
  assert.strictEqual(s.said(), 'hi there', 'still in the bubble as it pops out');
  s.tick(A.POP_MS);
  assert.strictEqual(s.lines().length, 0);
  s.tick(A.GAP_MS);
  assert.strictEqual(s.said(), 'second');
  assert.strictEqual(s.a.stats().waiting, 1);
  s.finish();
  s.finish();
  assert.strictEqual(s.lines().length, 0, 'all said');
  assert.ok(!s.has('bubble-on') && !s.has('talking') && !s.has('mouth-open'));
});

test('alone, a message is held its full reading time; one that comes meanwhile cuts it to the busy time', (t) => {
  const s = setup(t, { bubble_speed: 100, bubble_time: 20 });
  s.a.push(chat('amy', 'a'.repeat(100)));
  s.tick(1000); // typed (100 letters at 100 a second)
  assert.strictEqual(s.a.stats().saying, 'hold');
  const full = A.holdMs(100, { bubble_time: 20 }, false), busy = A.holdMs(100, { bubble_time: 20 }, true);
  assert.deepStrictEqual([full, busy], [7000, 3500]);
  s.tick(busy - 600);
  s.a.push(chat('bob', 'next'));
  s.tick(500);
  assert.ok(s.has('bubble-on'), 'its busy time isn\'t over');
  s.tick(110);
  assert.ok(!s.has('bubble-on'), 'cut to it');
  s.step(A.POP_MS + A.GAP_MS + 100);
  assert.strictEqual(s.said(), 'next');
});

test('bubble_speed=0: the whole message at once, the mouth moving its talking time', (t) => {
  const s = setup(t, { bubble_speed: 0 });
  s.a.push(chat('amy', 'hello there everyone'));
  assert.strictEqual(s.shown(), 'hello there everyone');
  assert.strictEqual(s.linesEl.byClass('tw').length, 0, 'nothing hidden');
  assert.strictEqual(s.a.stats().saying, 'hold');
  assert.ok(s.has('mouth-open'));
  s.tick(A.talkMs(18, false) + 200);
  assert.ok(!s.has('mouth-open'));
  assert.ok(s.has('bubble-on'));
});

test('a notice and its text line are said together; emotes are typed whole', (t) => {
  const s = setup(t, { bubble_speed: 10 }, {
    tokensFor: (m) => (m.text === 'Kappa hi' ? { items: [{ type: 'emote', emote: { provider: 'twitch', id: '25', name: 'Kappa', w: 28, h: 28,
      urls: { 1: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' } } }, { type: 'text', text: ' hi' }] } : undefined)
  });
  s.a.push(resub('amy', 'still here'));
  assert.strictEqual(s.lines().length, 2, 'the notice line and its text line');
  assert.strictEqual(s.said(), 'amy resubscribed / still here');
  s.finish();
  s.a.push(chat('bob', 'Kappa hi'));
  const stack = s.linesEl.byClass('emote-stack')[0];
  assert.ok(stack, 'drawn as an emote');
  assert.ok(!stack.classList.contains('tw'), 'the first unit, shown at once');
  assert.strictEqual(s.shown(), '');
  s.tick(200);
  assert.strictEqual(s.shown(), ' h', 'two letters\' time for the emote, then the space with the h');
});

test('live chat only: history is noted, not said; a filtered message never waits; no message twice', (t) => {
  const s = setup(t, {}, { shouldShow: (m) => m.login !== 'nightbot' });
  assert.strictEqual(s.a.push(chat('amy', 'old', { historical: true })), false);
  assert.strictEqual(s.a.push(chat('nightbot', 'ad')), false);
  assert.strictEqual(s.lines().length, 0);
  const m = chat('amy', 'live');
  assert.strictEqual(s.a.push(m), true);
  assert.strictEqual(s.a.push(Object.assign({}, m)), false, 'being said');
  const w = chat('bob', 'waiting');
  assert.strictEqual(s.a.push(w), true);
  assert.strictEqual(s.a.push(Object.assign({}, w)), false, 'waiting');
  assert.strictEqual(s.a.push(null), false);
});

test('bubble_queue: the oldest waiting message goes when another comes', (t) => {
  const s = setup(t, { bubble_queue: 3 });
  for (let i = 1; i <= 8; i++) s.a.push(chat('u' + i, 'message ' + i));
  assert.strictEqual(s.said(), 'message 1');
  assert.strictEqual(s.a.stats().waiting, 3);
  const order = [];
  for (let i = 0; i < 4; i++) { s.finish(); order.push(s.said()); }
  assert.deepStrictEqual(order, ['message 6', 'message 7', 'message 8', '']);
  // Turned down live, the queue is cut to the new size.
  s.a.setConfig(Object.assign(config.defaults(), { avatar: 'blob', bubble_queue: 5 }));
  for (let i = 1; i <= 6; i++) s.a.push(chat('w' + i, 'more ' + i));
  assert.strictEqual(s.a.stats().waiting, 5);
  s.a.setConfig(Object.assign(config.defaults(), { avatar: 'blob', bubble_queue: 2 }));
  assert.strictEqual(s.a.stats().waiting, 2);
});

test('moderation: a deleted message goes from the bubble at once, and from the queue', (t) => {
  const s = setup(t);
  const now = chat('troll', 'bad words');
  const later = chat('troll2', 'more bad words', { sourceId: 'src-9' });
  const fine = chat('amy', 'fine');
  s.a.push(now);
  s.a.push(later);
  s.a.push(fine);
  s.a.clearMessage(now.id);
  assert.strictEqual(s.lines().length, 0);
  assert.ok(!s.has('bubble-on') && s.has('bubble-cut'), 'cut, with no exit');
  assert.ok(!s.has('mouth-open') && !s.has('talking'));
  s.a.clearMessage('src-9');
  assert.strictEqual(s.a.stats().waiting, 1, 'a waiting one by its Shared Chat id');
  s.tick(A.GAP_MS);
  assert.strictEqual(s.said(), 'fine');
  assert.ok(!s.has('bubble-cut'));
  // A deletion heard before its message came (a history line said so): the renderer refuses it at its turn.
  s.finish();
  s.a.clearMessage('early');
  s.a.hold(true);
  s.a.push(chat('amy', 'deleted early', { id: 'early' }));
  s.a.push(chat('bob', 'after it'));
  s.a.hold(false);
  s.tick(10);
  assert.strictEqual(s.said(), 'after it');
});

test('moderation: a timeout takes the user\'s waiting messages and the one being said; a clear takes what it covers', (t) => {
  const s = setup(t);
  s.a.push(chat('troll', 'one'));
  s.a.push(chat('amy', 'hello'));
  s.a.push(chat('troll', 'two'));
  assert.strictEqual(s.a.hasUser('u-troll'), true);
  s.a.clearUser('u-troll');
  assert.strictEqual(s.lines().length, 0);
  assert.strictEqual(s.a.stats().waiting, 1);
  assert.strictEqual(s.a.hasUser('u-troll'), false);
  s.tick(A.GAP_MS);
  assert.strictEqual(s.said(), 'hello');
  s.a.push(chat('kickfan', 'kick line', { platform: 'kick' }));
  s.a.push(chat('twitchfan', 'twitch line'));
  // A Twitch /clear in a combined chat leaves the Kick lines (overlay.js passes the test).
  s.a.clearAll((m) => !m.platform);
  assert.strictEqual(s.lines().length, 0, 'the Twitch line being said went');
  assert.strictEqual(s.a.stats().waiting, 1);
  s.tick(A.GAP_MS);
  assert.strictEqual(s.said(), 'kick line');
  s.a.push(chat('x', 'y'));
  s.a.clearAll();
  assert.strictEqual(s.lines().length + s.a.stats().waiting, 0);
  s.a.push(chat('z', 'w'));
  s.a.drop((m) => m.login === 'z');
  s.tick(A.GAP_MS);
  assert.strictEqual(s.lines().length, 0, 'dropped');
});

test('a filter turned on live takes the waiting messages and the line being said', (t) => {
  let hideBots = false;
  const s = setup(t, {}, { shouldShow: (m) => !(hideBots && /bot$/.test(m.login)) });
  s.a.push(chat('nightbot', 'say !points'));
  s.a.push(chat('fossabot', 'ad'));
  s.a.push(chat('amy', 'hi'));
  hideBots = true;
  s.a.setConfig(Object.assign(config.defaults(), { avatar: 'blob', bots: false, hide_commands: true }));
  s.a.refilter();
  assert.strictEqual(s.a.stats().waiting, 1);
  s.tick(A.GAP_MS);
  assert.strictEqual(s.said(), 'hi');
});

test('hold and a hidden page: nothing is said until they end', (t) => {
  const s = setup(t);
  s.a.hold(true);
  s.a.push(chat('amy', 'held'));
  assert.strictEqual(s.lines().length, 0);
  s.a.hold(false);
  assert.strictEqual(s.said(), 'held');
  s.finish();
  s.doc.visibilityState = 'hidden';
  s.a.push(chat('bob', 'while hidden'));
  s.tick(5000);
  assert.strictEqual(s.lines().length, 0);
  s.doc.visibilityState = 'visible';
  s.doc.dispatch('visibilitychange');
  assert.strictEqual(s.said(), 'while hidden');
});

test('restart in place: the new copy shows the message being said whole, then the ones waiting', (t) => {
  const s = setup(t, { bubble_speed: 10 });
  const a = chat('amy', 'being said'), b = chat('bob', 'waiting');
  s.a.push(a);
  s.a.push(b);
  s.tick(150);
  const snap = s.a.snapshot();
  assert.deepStrictEqual(snap.map((e) => [e.msg.text, !!e.speaking]), [['being said', true], ['waiting', false]]);
  assert.ok(s.a.moderation() && typeof s.a.moderation().seq === 'number');
  // The new copy, started unseen (held): it had a line of its own come in, newer than the old copy's newest.
  const doc2 = createDocument();
  const root2 = doc2.createElement('div');
  doc2.body.appendChild(root2);
  const a2 = avatar.createAvatar({ root: root2, cfg: Object.assign(config.defaults(), { avatar: 'blob', bubble_speed: 10 }), deps: {} });
  t.after(() => a2.destroy());
  a2.hold(true);
  const dup = Object.assign({}, b);
  a2.push(dup);
  s.tick(10);
  const fresh = chat('cat', 'newer');
  a2.push(fresh);
  assert.strictEqual(a2.adopt(snap, s.a.moderation(), null), 2);
  a2.hold(false);
  const lines2 = root2.byClass('lines')[0];
  assert.strictEqual(lines2.textContent, 'amy: being said');
  assert.strictEqual(lines2.byClass('tw').length, 0, 'shown whole, not typed again');
  assert.strictEqual(a2.stats().saying, 'hold');
  assert.strictEqual(a2.stats().waiting, 2, 'the old copy\'s waiting one, then the newer one (the duplicate went)');
});

test('setConfig: each avatar setting changes the avatar, live', (t) => {
  const s = setup(t);
  const base = Object.assign(config.defaults(), { avatar: 'blob' });
  // Class and variable sets (a class switched off and on again moves to the end of the list).
  const look = () => JSON.stringify([s.root.className.split(' ').sort(), Object.entries(Object.assign({}, s.root.style)).sort()]);
  const before = look();
  avatar.LIVE_KEYS.forEach((k) => {
    assert.ok(config.LIVE_KEYS.indexOf(k) >= 0, k + ' is a live key');
    if (k === 'avatar_idle' || k === 'avatar_talk' || /^bubble_(speed|time|queue)$/.test(k)) return; // below
    s.a.setConfig(flip(base, k));
    assert.notStrictEqual(look(), before, k + ' changes #chat');
    s.a.setConfig(base);
    assert.strictEqual(look(), before, k + ' set back');
  });
  // The pictures: a custom pair (the bundled one wins while avatar names one).
  s.a.setConfig(Object.assign({}, base, { avatar: 'custom', avatar_idle: 'https://example.com/a.png', avatar_talk: 'https://example.com/b.png' }));
  assert.strictEqual(s.root.style['--avatar-idle'], 'url("https://example.com/a.png")');
  assert.strictEqual(s.root.style['--avatar-talk'], 'url("https://example.com/b.png")');
  s.a.setConfig(Object.assign({}, base, { avatar: 'custom', avatar_idle: 'https://example.com/a.png' }));
  assert.strictEqual(s.root.style['--avatar-talk'], undefined, 'the stylesheet falls back to the idle one');
  // The timing ones: the speed types, the time holds (bubble_queue: its own test).
  s.a.setConfig(Object.assign({}, base, { bubble_speed: 0, bubble_time: 1 }));
  s.a.push(chat('amy', 'whole at once'));
  assert.strictEqual(s.shown(), 'whole at once');
  s.tick(A.talkMs(11, false) + 990);
  assert.ok(s.has('bubble-on'));
  s.tick(20);
  assert.ok(!s.has('bubble-on'), 'bubble_time=1: a second after the mouth stopped');
});

test('destroy: the picture, the bubble and every class and variable avatar mode set go', (t) => {
  const s = setup(t, { avatar_side: 'right', avatar_flip: true, bubble_color: '102030' });
  s.a.push(chat('amy', 'bye'));
  s.a.destroy();
  assert.strictEqual(s.root.children.length, 0);
  ['has-avatar', 'avatar-right', 'avatar-flip', 'bubble-on', 'talking', 'mouth-open', 'motion-bounce'].forEach((c) => assert.ok(!s.has(c), c));
  Object.keys(s.root.style).forEach((k) => assert.ok(!/^--(avatar|bubble)/.test(k), k));
  s.tick(20000);
  assert.strictEqual(s.a.push(chat('bob', 'after')), false);
});

test('a hint once custom has no picture by then; none with one', (t) => {
  const hints = [];
  const s = setup(t, { avatar: 'custom' }, {}, hints);
  s.tick(7000);
  assert.deepStrictEqual(hints, []);
  s.tick(2000);
  assert.strictEqual(hints.length, 1);
  assert.match(hints[0], /no picture yet/);
  assert.match(hints[0], /avatar_idle/);
});

test('no such hint with a picture of its own, or a bundled one', (t) => {
  const hints = [];
  const s = setup(t, { avatar: 'custom', avatar_idle: 'https://example.com/me.png' }, {}, hints);
  s.tick(20000);
  assert.deepStrictEqual(hints, []);
});
