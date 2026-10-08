'use strict';
// Behavioural tests: the real createRenderer on a minimal fake DOM (tests/fake-dom.js) with mocked timers.
const test = require('node:test');
const assert = require('node:assert');
const renderer = require('../js/renderer.js');
const { createDocument } = require('./fake-dom.js');

const R = renderer._internal;

// A renderer on a fresh fake document. Timers are mocked (Date too) so tests step time by hand.
function setup(t, cfg, deps, docOpts) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const doc = createDocument(docOpts);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const r = renderer.createRenderer({ root: root, cfg: cfg || {}, deps: deps || {} });
  const linesEl = root.firstElementChild;
  t.after(() => r.destroy());
  return {
    doc, root, r, linesEl,
    lines: () => linesEl.children,
    texts: () => linesEl.children.map((l) => l.byClass('message').map((m) => m.textContent).join('')),
    tick: (ms) => t.mock.timers.tick(ms)
  };
}

let nid = 0;
function chat(login, text, extra) {
  return Object.assign({ kind: 'chat', id: 'm' + (++nid), userId: 'u-' + login, login: login, displayName: login, text: text }, extra || {});
}
function resub(login, text, extra) {
  return Object.assign({ kind: 'notice', type: 'resub', id: 'n' + (++nid), userId: 'u-' + login, login: login,
    displayName: login, systemMsg: login + ' resubscribed', text: text }, extra || {});
}
function replyTo(parent, login, text) {
  return chat(login, text, { reply: { id: parent.id, userId: parent.userId, login: parent.login, name: parent.displayName, body: parent.text } });
}
function replyText(line) {
  const r = line.byClass('reply')[0];
  return r ? r.textContent : null;
}

// ---------- moderation (clearMessage, clearUser, deleted-id guard) ----------

test('clearMessage removes a resub notice and its attached text line', (t) => {
  const s = setup(t);
  const n = resub('bob', 'abusive words');
  s.r.push(n);
  s.r.flush();
  assert.strictEqual(s.lines().length, 2);
  s.r.clearMessage(n.id);
  assert.strictEqual(s.lines().length, 0, 'the ":m" user-text line goes too');
  assert.deepStrictEqual([s.r.stats().ids, s.r.stats().users], [0, 0]);
});

test('clearMessage finds a Shared Chat line by its source id', (t) => {
  const s = setup(t);
  s.r.push(chat('amy', 'hi', { sourceId: 'src-1' }));
  s.r.flush();
  s.r.clearMessage('src-1');
  assert.strictEqual(s.lines().length, 0);
});

test('clearUser also drops the user\'s messages still waiting in the queue', (t) => {
  const s = setup(t);
  s.r.hold(true);
  s.r.push(chat('troll', 'bad 1'));
  s.r.push(chat('amy', 'fine'));
  s.r.push(chat('troll', 'bad 2'));
  assert.strictEqual(s.r.hasUser('u-troll'), true);
  s.r.clearUser('u-troll');
  assert.strictEqual(s.r.stats().queued, 1);
  s.r.hold(false);
  assert.deepStrictEqual(s.texts(), ['fine']);
  assert.strictEqual(s.r.hasUser('u-troll'), false);
});

test('push refuses deleted and duplicate ids', (t) => {
  const s = setup(t);
  s.r.clearMessage('gone');
  assert.strictEqual(s.r.push(chat('amy', 'x', { id: 'gone' })), false);
  assert.strictEqual(s.r.push(chat('amy', 'x', { sourceId: 'gone' })), false);
  assert.strictEqual(s.r.stats().queued, 0);
  const m = chat('amy', 'y');
  assert.strictEqual(s.r.push(m), true);
  assert.strictEqual(s.r.push(Object.assign({}, m)), false, 'queued already');
  s.r.flush();
  assert.strictEqual(s.r.push(Object.assign({}, m)), false, 'on screen already');
  assert.strictEqual(s.lines().length, 1);
});

// ---------- reply headers of moderated parents ----------

test('a deleted message stops showing in the reply headers that quote it', (t) => {
  const s = setup(t);
  const bad = chat('troll', 'slur');
  const other = chat('amy', 'hello');
  s.r.push(bad);
  s.r.push(other);
  s.r.push(replyTo(bad, 'viewer', 'wtf'));
  s.r.push(replyTo(other, 'viewer', 'hi amy'));
  s.r.flush();
  const kept = s.lines()[3].byClass('reply')[0];
  assert.strictEqual(replyText(s.lines()[2]), '↪ @troll: slur');
  s.r.clearMessage(bad.id);
  assert.deepStrictEqual(s.texts(), ['hello', 'wtf', 'hi amy']);
  assert.strictEqual(replyText(s.lines()[1]), null, 'the header is dropped');
  assert.ok(s.root.textContent.indexOf('slur') < 0);
  assert.strictEqual(s.lines()[2].byClass('reply')[0], kept, 'an unrelated reply is left alone');
  // a reply that arrives later and quotes the deleted message gets no header either
  s.r.push(replyTo(bad, 'late', 'what did they say'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[3]), null);
});

test('a timeout or ban removes the user\'s text from reply headers, even after their line is gone', (t) => {
  const s = setup(t, { max: 3 });
  const bad = chat('troll', 'slur');
  s.r.push(bad);
  s.r.push(replyTo(bad, 'viewer', 'wtf'));
  s.r.push(chat('a', '1'));
  s.r.push(chat('b', '2'));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['wtf', '1', '2'], 'the parent already left the screen');
  assert.strictEqual(replyText(s.lines()[0]), '↪ @troll: slur');
  s.r.clearUser('u-troll');
  assert.strictEqual(replyText(s.lines()[0]), null);
  assert.ok(s.root.textContent.indexOf('slur') < 0);
  // queued and later replies quoting it: no header
  s.r.push(replyTo(bad, 'late', 'lol'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[2]), null);
  // back after the timeout: replies to what they say now keep the header
  const back = chat('troll', 'sorry');
  s.r.push(back);
  s.r.push(replyTo(back, 'amy', 'ok'));
  s.r.flush();
  const ok = () => s.lines().find((l) => l.byClass('message')[0].textContent === 'ok');
  assert.strictEqual(replyText(ok()), '↪ @troll: sorry');
  // a second timeout covers the new message too
  s.r.clearUser('u-troll');
  assert.strictEqual(replyText(ok()), null);
  assert.deepStrictEqual(s.texts(), ['lol', 'ok']);
});

test('a reply without a usable parent (null, as a blocked parent arrives) renders without a header', (t) => {
  const s = setup(t);
  s.r.push(chat('amy', 'hi', { reply: null }));
  s.r.push(chat('bob', 'yo', { reply: { id: 'x' } }));
  s.r.flush();
  assert.deepStrictEqual(s.lines().map(replyText), [null, null]);
});

// ---------- indexes stay the size of what is on screen ----------

test('byId/byUser indexes never outgrow the lines on screen', (t) => {
  const s = setup(t, { max: 5 });
  for (let i = 0; i < 300; i++) {
    s.r.push(i % 7 === 0 ? resub('user' + (i % 20), 'text ' + i) : chat('user' + (i % 20), 'msg ' + i));
    if (i % 13 === 0) s.r.flush();
  }
  s.r.flush();
  let st = s.r.stats();
  assert.ok(st.lines <= 10, 'max counts messages; a resub is two lines');
  assert.ok(st.ids <= 2 * st.lines, 'at most id + source id per line');
  assert.ok(st.users <= st.lines);
  s.r.clearUser('u-user3');
  st = s.r.stats();
  assert.ok(st.ids <= 2 * st.lines && st.users <= st.lines);
  s.r.clearAll();
  st = s.r.stats();
  assert.deepStrictEqual([st.lines, st.ids, st.users, st.queued], [0, 0, 0, 0]);
});

// ---------- max, filters, align ----------

test('max counts messages: a resub and its text stay or leave together', (t) => {
  for (const align of ['bottom', 'top']) {
    const s = setup(t, { max: 1, align: align });
    s.r.push(resub('bob', 'hello'));
    s.r.flush();
    assert.strictEqual(s.lines().length, 2, align + ': both lines of one message');
    s.r.push(chat('amy', 'next'));
    s.r.flush();
    assert.deepStrictEqual(s.texts(), ['next'], align + ': the whole group leaves');
    s.r.destroy();
    t.mock.timers.reset();
  }
  // one flush builds max messages, not max lines
  const s2 = setup(t, { max: 2 });
  s2.r.hold(true);
  s2.r.push(chat('amy', 'first'));
  s2.r.push(resub('bob', 'second'));
  s2.r.hold(false);
  assert.deepStrictEqual(s2.texts(), ['first', 'bob resubscribed', 'second']);
});

test('setConfig: max, filters and align take effect on lines already on screen', (t) => {
  let block = [];
  const s = setup(t, { max: 50 }, { shouldShow: (m) => block.indexOf(m.login) < 0 });
  for (let i = 0; i < 30; i++) s.r.push(chat(i % 2 ? 'odd' : 'even', 'm' + i));
  s.r.flush();
  s.r.setConfig({ max: 10 });
  assert.strictEqual(s.lines().length, 10);
  assert.deepStrictEqual(s.texts().slice(-2), ['m28', 'm29'], 'the newest stay');
  block = ['odd'];
  s.r.setConfig({ max: 10, block: ['odd'] });
  assert.deepStrictEqual(s.texts(), ['m20', 'm22', 'm24', 'm26', 'm28']);
  // align flip reverses the lines and keeps a notice with its text line
  s.r.push(resub('even', 'still here'));
  s.r.flush();
  s.r.setConfig({ max: 10, block: ['odd'], align: 'top' });
  const order = s.lines().map((l) => l.classList.contains('notice') ? 'N' : l.byClass('message')[0].textContent);
  assert.deepStrictEqual(order, ['N', 'still here', 'm28', 'm26', 'm24', 'm22', 'm20']);
  // a new message goes on top
  s.r.push(chat('even', 'newest'));
  s.r.flush();
  assert.strictEqual(s.texts()[0], 'newest');
  s.r.setConfig({ max: 10, block: ['odd'], align: 'bottom' });
  assert.strictEqual(s.texts()[s.lines().length - 1], 'newest');
});

test('a resub\'s own text follows the chat filters, not the notice\'s', (t) => {
  let hideCommands = true;
  const shouldShow = (m) => !(hideCommands && m.kind === 'chat' && /^\s*!/.test(m.text || ''));
  const s = setup(t, {}, { shouldShow: shouldShow });
  s.r.push(resub('bob', '!command'));
  s.r.push(resub('amy', 'thanks'));
  s.r.flush();
  assert.deepStrictEqual(s.lines().map((l) => l.classList.contains('notice') ? 'N' : l.byClass('message')[0].textContent),
    ['N', 'N', 'thanks'], 'the command text is hidden, the notice stays');
  // live: the part line is swept by its own message too
  hideCommands = false;
  s.r.push(resub('cat', '!again'));
  s.r.flush();
  assert.strictEqual(s.lines().length, 5);
  hideCommands = true;
  s.r.setConfig({ hide_commands: true });
  assert.strictEqual(s.lines().length, 4);
  assert.ok(s.root.textContent.indexOf('!again') < 0);
});

// ---------- fade ----------

test('fade: the sweep removes lines at `fade` seconds, then stops waking the page', (t) => {
  const s = setup(t, { fade: 5, animate: false });
  let cleared = 0;
  const realClear = globalThis.clearInterval;
  t.mock.method(globalThis, 'clearInterval', function (id) { cleared++; return realClear(id); });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  assert.strictEqual(s.lines()[0].style.animation, 'tco-fade 1000ms linear 4000ms forwards');
  s.tick(4000);
  assert.strictEqual(s.lines().length, 1);
  s.tick(1000);
  assert.strictEqual(s.lines().length, 0, 'removed by the sweep');
  assert.strictEqual(cleared, 1, 'the sweep interval stops once the chat is empty');
  s.tick(10000);
  assert.strictEqual(cleared, 1);
});

test('fade: a flush also drops expired lines, between sweeps', (t) => {
  const s = setup(t, { fade: 5, animate: false });
  s.r.push(chat('amy', 'a'));
  s.r.flush(); // the sweep now ticks at 1000, 2000, ...
  s.tick(500);
  s.r.push(chat('bob', 'b')); // expires at 5500
  s.r.flush();
  s.tick(4500); // the sweep at 5000 takes a
  assert.deepStrictEqual(s.texts(), ['b']);
  s.tick(600);
  assert.deepStrictEqual(s.texts(), ['b'], 'expired at 5500, next sweep at 6000');
  s.r.push(chat('cat', 'c'));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['c'], 'b expired 100 ms ago; the next sweep is 400 ms away');
});

test('fade: animationend of tco-fade removes the line', (t) => {
  const s = setup(t, { fade: 5, animate: false });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const line = s.lines()[0];
  s.linesEl.dispatch('animationend', { target: line, animationName: 'tco-other' });
  assert.strictEqual(s.lines().length, 1);
  s.linesEl.dispatch('animationend', { target: line, animationName: 'tco-fade' });
  assert.strictEqual(s.lines().length, 0);
  assert.strictEqual(s.r.stats().ids, 0);
});

test('fade + animate: tco-in and tco-fade never share a line, the fade keeps its timing', (t) => {
  const s = setup(t, { fade: 30, animate: true });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const line = s.lines()[0];
  assert.strictEqual(line.style.animation, 'tco-in 180ms ease-out', 'entrance only');
  s.tick(180);
  s.linesEl.dispatch('animationend', { target: line, animationName: 'tco-in' });
  assert.strictEqual(line.style.animation, 'tco-fade 1000ms linear 28820ms forwards', 'still ends 30 s after arrival');
  // the fade itself ending is what removes it; a later tco-in end changes nothing
  s.linesEl.dispatch('animationend', { target: line, animationName: 'tco-in' });
  assert.strictEqual(line.style.animation, 'tco-fade 1000ms linear 28820ms forwards');
  // fade=1: the fade-out starts at arrival, so both go on at once as before (no jump in opacity)
  s.r.setConfig({ fade: 1, animate: true });
  s.r.push(chat('bob', 'b'));
  s.r.flush();
  assert.strictEqual(s.lines()[1].style.animation, 'tco-in 180ms ease-out, tco-fade 1000ms linear 0ms forwards');
});

test('hidden page: nothing is built; on show, lines are re-timed from their arrival', (t) => {
  const s = setup(t, { fade: 5, animate: true });
  s.doc.visibilityState = 'hidden';
  s.r.push(chat('amy', 'a'));
  s.tick(300);
  assert.strictEqual(s.lines().length, 0, 'the fallback flush builds nothing while hidden');
  assert.strictEqual(s.r.stats().queued, 1);
  s.tick(1700);
  s.doc.visibilityState = 'visible';
  s.doc.dispatch('visibilitychange');
  assert.strictEqual(s.lines().length, 1);
  assert.strictEqual(s.lines()[0].style.animation, 'tco-fade 1000ms linear 2000ms forwards', 'no mass fade-in; 2 s already passed');
  // OBS source shown after a hide: the same
  s.tick(1000);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.strictEqual(s.lines()[0].style.animation, 'tco-fade 1000ms linear 1000ms forwards');
  s.tick(2500);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.strictEqual(s.lines().length, 0, 'expired while hidden: dropped on show');
});

// ---------- flush scheduling ----------

test('flushes wait for the next frame, at most one per FLUSH_GAP_MS', (t) => {
  const s = setup(t, {}, {}, { rAF: true });
  const win = s.doc.defaultView;
  s.r.push(chat('a', '1'));
  assert.strictEqual(win.pendingFrames(), 1);
  win.frame();
  assert.strictEqual(s.lines().length, 1);
  const before = s.r.stats().flushes;
  s.r.push(chat('b', '2'));
  s.r.push(chat('c', '3'));
  assert.strictEqual(win.pendingFrames(), 0, 'right after a flush: wait out the gap first');
  s.tick(R.FLUSH_GAP_MS - 1);
  assert.strictEqual(win.pendingFrames(), 0);
  s.tick(1);
  assert.strictEqual(win.pendingFrames(), 1);
  win.frame();
  assert.strictEqual(s.r.stats().flushes, before + 1, 'one flush for both');
  assert.deepStrictEqual(s.texts(), ['1', '2', '3']);
  // hold cancels everything pending
  s.tick(R.FLUSH_GAP_MS);
  s.r.push(chat('d', '4'));
  s.r.hold(true);
  s.tick(1000);
  win.frame();
  assert.strictEqual(s.lines().length, 3);
  s.r.hold(false);
  assert.strictEqual(s.lines().length, 4);
});

test('without rAF (hidden OBS source) the fallback timer flushes', (t) => {
  const s = setup(t);
  s.r.push(chat('a', '1'));
  s.tick(R.FLUSH_FALLBACK_MS - 1);
  assert.strictEqual(s.lines().length, 0);
  s.tick(1);
  assert.strictEqual(s.lines().length, 1);
});

// ---------- horizontal slide ----------

// A row of lines, newest on the right edge of a W px wide chat; each character is 10 px.
function rowLayout(s, W) {
  const widths = () => s.lines().map((l) => l.textContent.length * 10);
  s.doc.layout = (el) => {
    if (el === s.root || el === s.linesEl) return { left: 0, right: W, width: W, top: 0, bottom: 50, height: 50 };
    const i = s.lines().indexOf(el);
    if (i < 0) return null;
    const w = widths();
    let right = W;
    for (let j = w.length - 1; j > i; j--) right -= w[j];
    return { left: right - w[i], right: right, width: w[i], top: 0, bottom: 50, height: 50 };
  };
  const moves = [];
  const st = s.linesEl.style;
  let tf = '';
  Object.defineProperty(st, 'transform', { get: () => tf, set: (v) => { tf = v; if (v && v !== 'none') moves.push(v); } });
  return moves;
}

test('horizontal slide: lines in view when the slide starts survive it; the next flush trims them', (t) => {
  const s = setup(t, { layout: 'horizontal', animate: true });
  const moves = rowLayout(s, 300);
  // "a: " + text; widths: 100 and 200
  s.r.push(chat('a', 'x'.repeat(7)));
  s.r.push(chat('b', 'y'.repeat(17)));
  s.r.flush();
  assert.strictEqual(s.lines().length, 2);
  s.r.push(chat('c', 'z'.repeat(12))); // 150 px: the first line ends at -50
  s.r.flush();
  assert.deepStrictEqual(moves, ['translateX(150px)'], 'the row starts 150 px right and glides home');
  assert.strictEqual(s.lines().length, 3, 'the first line is still in view at the start of the slide');
  s.tick(1000);
  assert.strictEqual(s.lines().length, 3, 'no extra timer frame just to drop a clipped line');
  s.r.push(chat('d', ''));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['y'.repeat(17), 'z'.repeat(12), ''], 'the next flush trims it');
});

test('horizontal slide: the start offset never exceeds the chat width', (t) => {
  const s = setup(t, { layout: 'horizontal', animate: true });
  const moves = rowLayout(s, 300);
  s.r.push(chat('a', 'x'));
  s.r.flush();
  s.r.hold(true);
  for (let i = 0; i < 10; i++) s.r.push(chat('b' + i, 'y'.repeat(20)));
  s.r.hold(false);
  assert.deepStrictEqual(moves, ['translateX(300px)']);
  assert.ok(s.lines().length <= 3, 'lines out of view even at the start of the slide are trimmed');
});

// ---------- rerender, paints, images ----------

test('rerender keeps unchanged lines and rebuilds changed ones', (t) => {
  let color = '#FF0000';
  const emote = { provider: '7tv', name: 'Pog', w: 28, h: 28, urls: { 1: 'https://e/1', 2: 'https://e/2' } };
  const s = setup(t, {}, {
    tokensFor: () => [{ type: 'text', text: 'look', sp: false }, { type: 'emote', emote: emote, sp: true, overlays: [] }],
    nameFor: (m) => ({ text: m.displayName, color: color })
  });
  s.r.push(chat('amy', 'look Pog'));
  s.r.flush();
  const img = s.lines()[0].byClass('emote')[0];
  assert.strictEqual(img.src, 'https://e/2', 'OBS (dpr 1) at medium: 42px from the 56px file');
  assert.strictEqual(s.r.rerender(), 0);
  assert.strictEqual(s.lines()[0].byClass('emote')[0], img, 'same node: an animated emote does not restart');
  color = '#00FF00';
  assert.strictEqual(s.r.rerender((m) => m.login === 'nobody'), 0);
  assert.strictEqual(s.r.rerender(), 1);
  assert.strictEqual(s.lines()[0].byClass('name')[0].style.color, '#00FF00');
});

test('paint rules: one per paint id; a rejected rule leaves the name unpainted', (t) => {
  const s = setup(t, {}, {
    nameFor: (m) => ({ text: m.displayName, color: '#FFFFFF', paintId: m.login === 'bad' ? 'BAD1' : 'P1' }),
    paintRule: (id) => id === 'BAD1' ? '.p-BAD1 { INVALID }' : '.p-' + id + ' { color: red; }'
  });
  s.r.push(chat('amy', '1'));
  s.r.push(chat('bob', '2'));
  s.r.push(chat('bad', '3'));
  s.r.flush();
  const style = s.doc.head.children.find((e) => e.getAttribute('data-tco') === 'paints');
  assert.deepStrictEqual(style.sheet.cssRules, ['.p-P1 { color: red; }']);
  const names = s.lines().map((l) => l.byClass('name')[0].className);
  assert.deepStrictEqual(names, ['name painted p-P1', 'name painted p-P1', 'name']);
  assert.strictEqual(s.r.stats().paints, 2);
});

test('emotes: a failed image becomes its name; r!/l! draws the emote in a square box', (t) => {
  const e = { provider: 'bttv', name: 'Wide', w: 84, h: 28, urls: { 1: 'https://w/1', 2: 'https://w/2' } };
  const s = setup(t, {}, {
    tokensFor: (m) => [{ type: 'emote', emote: e, sp: false, overlays: [],
      fx: m.text === 'r' ? { sx: 1, sy: 1, rot: 90, grow: true } : { sx: 1, sy: 1, rot: 0, grow: true } }]
  });
  s.r.push(chat('amy', 'r'));
  s.r.push(chat('bob', 'w'));
  s.r.flush();
  const rotated = s.lines()[0].byClass('emote-stack')[0];
  assert.ok(rotated.classList.contains('rot'));
  assert.strictEqual(rotated.firstElementChild.style.width, undefined, 'w! is ignored once turned upright');
  const wide = s.lines()[1].byClass('emote-stack')[0];
  assert.ok(!wide.classList.contains('rot'));
  assert.strictEqual(wide.firstElementChild.style.width, 'calc(var(--eh) * 6)');
  wide.firstElementChild.onerror();
  assert.strictEqual(s.lines()[1].byClass('message')[0].textContent, 'Wide');
});

test('emotes: w! on a hostile aspect ratio is capped at 16:1', (t) => {
  const e = { provider: 'bttv', name: 'Line', w: 9999, h: 1, urls: { 1: 'https://w/1' } };
  const s = setup(t, {}, { tokensFor: () => [{ type: 'emote', emote: e, sp: false, overlays: [], fx: { sx: 1, sy: 1, rot: 0, grow: true } }] });
  s.r.push(chat('amy', 'w'));
  s.r.flush();
  const img = s.lines()[0].byClass('emote-stack')[0].firstElementChild;
  assert.strictEqual(img.style.width, 'calc(var(--eh) * 16)');
  assert.strictEqual(img.getAttribute('width'), '16');
});

test('gifs: a missing small rendition falls back once to the original URL, then to the title', (t) => {
  const s = setup(t, { gifs: true }, { tokensFor: () => [{ type: 'gif', url: 'https://media.giphy.com/media/a/200.webp', orig: 'https://media.giphy.com/media/a/giphy.gif', title: 'party', sp: false }] });
  s.r.push(chat('amy', 'g'));
  s.r.flush();
  const img = s.lines()[0].byClass('gif')[0];
  assert.strictEqual(img.src, 'https://media.giphy.com/media/a/200.webp');
  img.onerror();
  assert.strictEqual(img.src, 'https://media.giphy.com/media/a/giphy.gif');
  img.onerror();
  assert.strictEqual(s.lines()[0].byClass('message')[0].textContent, 'party');
});

test('refilter drops lines the filters now reject', (t) => {
  let bots = [];
  const s = setup(t, {}, { shouldShow: (m) => bots.indexOf(m.login) < 0 });
  s.r.push(chat('nightbot', 'beep'));
  s.r.push(chat('amy', 'hi'));
  s.r.flush();
  bots = ['nightbot'];
  s.r.refilter();
  assert.deepStrictEqual(s.texts(), ['hi']);
});

test('badge backgrounds: only hex colors are kept', () => {
  const want = 1;
  const models = R.badgeModels([{ urls: { 1: 'https://b/1' }, bg: '#34AE0A' }, { urls: { 1: 'https://b/2' }, bg: 'red;x' }], want);
  assert.deepStrictEqual(models.map((b) => b.bg), ['#34AE0A', null]);
});

test('badges: a colored badge is a plain .badge img (no wrapper), and a broken one is removed', (t) => {
  const s = setup(t, {}, { badgesFor: () => [
    { provider: 'twitch', title: 'Moderator', urls: { 1: 'https://b/mod' } },
    { provider: 'ffz', title: 'Supporter', urls: { 1: 'https://f/1' }, bg: '#755000' }
  ] });
  s.r.push(chat('amy', 'hi'));
  s.r.flush();
  const bs = s.lines()[0].byClass('badges')[0];
  const kids = bs.children;
  assert.deepStrictEqual(kids.map((k) => [k.tagName, k.className]), [['IMG', 'badge'], ['IMG', 'badge colored']]);
  assert.strictEqual(kids[1].style.backgroundColor, '#755000');
  assert.strictEqual(kids[0].style.backgroundColor, undefined);
  kids[1].onerror();
  assert.deepStrictEqual(bs.children.map((k) => k.className), ['badge']);
});

test('icon badges render as inline SVG from the registry; notices carry only the platform icon', (t) => {
  const s = setup(t, {}, { badgesFor: (m) => [
    { provider: 'platform', icon: m.platform || 'twitch', title: m.platform === 'kick' ? 'Kick' : 'Twitch' },
    { provider: 'kick', icon: 'kick-og', title: 'OG' },
    { provider: 'kick', icon: 'kick-bogus', title: 'Bogus' }
  ] });
  s.r.push(chat('amy', 'hi', { platform: 'kick' }));
  s.r.push({ kind: 'notice', id: 'n-kick', platform: 'kick', systemMsg: 'Fan subscribed!', text: '' });
  s.r.flush();
  const [line, notice] = s.lines();
  assert.strictEqual(line.className, 'line platform-kick');
  const kids = line.byClass('badges')[0].children;
  assert.deepStrictEqual(kids.map((k) => [k.tagName, k.className]), [['SVG', 'badge icon icon-kick platform'], ['SVG', 'badge icon icon-kick-og']]);
  const logo = kids[0];
  assert.strictEqual(logo.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.strictEqual(logo.getAttribute('viewBox'), '-4 -4 32 32');
  assert.strictEqual(logo.getAttribute('aria-label'), 'Kick');
  assert.deepStrictEqual(logo.children.map((c) => c.tagName), ['TITLE', 'RECT', 'PATH']);
  assert.strictEqual(logo.children[0].textContent, 'Kick');
  assert.deepStrictEqual(kids[1].children.map((c) => c.tagName), ['TITLE', 'RECT', 'TEXT']);
  assert.strictEqual(kids[1].children[2].textContent, 'OG');
  assert.strictEqual(notice.className, 'line notice platform-kick');
  assert.deepStrictEqual(notice.byClass('badges')[0].children.map((k) => k.className), ['badge icon icon-kick platform']);
  assert.strictEqual(notice.byClass('message')[0].textContent, 'Fan subscribed!');
});

test('clearAll(pred) clears only the matching queued and on-screen lines', (t) => {
  const s = setup(t);
  s.r.push(chat('amy', 'twitch 1'));
  s.r.push(chat('kim', 'kick 1', { platform: 'kick', userId: 'kick:1' }));
  s.r.push(resub('bob', 'twitch resub'));
  s.r.flush();
  s.r.hold(true);
  s.r.push(chat('kim', 'kick 2', { platform: 'kick', userId: 'kick:1' }));
  s.r.push(chat('amy', 'twitch 2'));
  s.r.clearAll((m) => m.platform !== 'kick');
  assert.deepStrictEqual(s.texts(), ['kick 1']);
  s.r.hold(false);
  assert.deepStrictEqual(s.texts(), ['kick 1', 'kick 2']);
  s.r.clearAll((m) => m.platform === 'kick');
  assert.deepStrictEqual(s.texts(), []);
  assert.deepStrictEqual([s.r.stats().ids, s.r.stats().users], [0, 0]);
  s.r.push(chat('amy', 'again'));
  s.r.clearAll(() => { throw new Error('bad predicate'); });
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['again'], 'a throwing predicate clears nothing');
});

test('overlay.css: badge size and highlight tint stay overridable by Custom CSS', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8');
  const badge = /\n\.badge \{([^}]*)\}/.exec(css)[1];
  assert.match(badge, /aspect-ratio: 1 \/ 1;/, 'the square slot follows any height set on .badge');
  assert.doesNotMatch(badge, /max-width/, 'no fixed-em width cap');
  assert.doesNotMatch(css, /badge-wrap/);
  assert.match(css, /\n:where\(\.has-bg\) \.line\.highlight \{/, '(0,2,0), so `.line.highlight` in Custom CSS wins');
  assert.doesNotMatch(css, /\n\.has-bg \.line\.highlight/);
});

test('GENERIC_FONTS matches config.GENERIC_FONT_NAMES', () => {
  const config = require('../js/config.js');
  assert.deepStrictEqual(R.GENERIC_FONTS.slice().sort(), config.GENERIC_FONT_NAMES.slice().sort());
});

test('destroy removes the lines, the paint sheet and every listener', (t) => {
  const s = setup(t, { fade: 5 }, { nameFor: (m) => ({ text: m.login, paintId: 'P1' }), paintRule: () => '.p-P1 {}' });
  s.r.push(chat('amy', '1'));
  s.r.flush();
  s.r.destroy();
  assert.strictEqual(s.root.childElementCount, 0);
  assert.strictEqual(s.doc.head.childElementCount, 0);
  assert.strictEqual((s.doc.listeners.visibilitychange || []).length, 0);
  assert.strictEqual((s.doc.defaultView.listeners.obsSourceVisibleChanged || []).length, 0);
  assert.strictEqual(s.r.push(chat('bob', '2')), false);
});

test('config root classes and variables', (t) => {
  const s = setup(t, { size: 'large', layout: 'horizontal', align: 'top', bg: 40, shadow: 0, font: 'system-ui' });
  const cl = s.root.className.split(' ').sort();
  assert.deepStrictEqual(cl, ['align-top', 'has-bg', 'layout-horizontal', 'size-large']);
  assert.strictEqual(s.root.style['--font'], 'system-ui');
  assert.strictEqual(s.root.style['--shadow'], 'none');
  assert.strictEqual(s.root.style['--bg-alpha'], '0.4');
});

// #chat as {classes beyond the usual, variables beyond --font --shadow --bg-alpha}.
function rootExtras(s) {
  const usual = ['align-bottom', 'align-top', 'layout-vertical', 'layout-horizontal', 'size-small', 'size-medium', 'size-large', 'has-bg'];
  const style = Object.assign({}, s.root.style);
  ['--font', '--shadow', '--bg-alpha'].forEach((k) => delete style[k]);
  return { cls: s.root.className.split(' ').filter((c) => c && usual.indexOf(c) < 0).sort(), style: style };
}

test('text, names and box options: a class or a variable on #chat only while changed, gone again when set back', (t) => {
  const s = setup(t, {});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  const all = { bg: 40, text_weight: 'light', name_weight: 'black', text_color: 'ff8800', line_height: 115, text_case: 'smallcaps',
    names: false, name_line: true, bg_color: '102030', bg_shape: 'pill', bg_width: 'full', spacing: 'extra',
    notice_color: 'abcdef', notice_size: 120, first_msg_color: '00ff00' };
  s.r.setConfig(all);
  assert.deepStrictEqual(rootExtras(s), {
    cls: ['bg-full', 'case-smallcaps', 'name-line', 'no-names'],
    style: { '--text-weight': '300', '--name-weight': '900', '--text-color': '#ff8800', '--line-height': '1.15',
      '--bg-rgb': '16, 32, 48', '--bg-radius': '1em', '--line-gap': '.5em', '--notice-color': '#abcdef',
      '--notice-size': '1.2em', '--first-color': '#00ff00' }
  });
  s.r.setConfig({ bg: 40 });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  // each value of each enum
  const one = (k, v) => { s.r.setConfig({ [k]: v }); return rootExtras(s); };
  assert.deepStrictEqual(['light', 'regular', 'semibold', 'bold', 'heavy', 'black'].map((w) => one('text_weight', w).style['--text-weight']),
    ['300', '400', undefined, '700', '800', '900']);
  assert.deepStrictEqual(['light', 'regular', 'semibold', 'bold', 'heavy', 'black'].map((w) => one('name_weight', w).style['--name-weight']),
    ['300', '400', '600', '700', undefined, '900']);
  assert.deepStrictEqual(['none', 'upper', 'lower', 'smallcaps'].map((v) => one('text_case', v).cls), [[], ['case-upper'], ['case-lower'], ['case-smallcaps']]);
  assert.deepStrictEqual(['square', 'soft', 'round', 'pill'].map((v) => one('bg_shape', v).style['--bg-radius']), ['0', '.2em', undefined, '1em']);
  assert.deepStrictEqual([100, 135, 136, 200].map((v) => one('line_height', v).style['--line-height']), ['1', undefined, '1.36', '2']);
  assert.deepStrictEqual([50, 85, 150].map((v) => one('notice_size', v).style['--notice-size']), ['0.5em', undefined, '1.5em']);
});

test('spacing: a column spaces its lines (--line-gap), a row its messages (--row-gap, closer with boxes)', (t) => {
  const s = setup(t, {});
  const gaps = (cfg) => { s.r.setConfig(cfg); const st = rootExtras(s).style; return [st['--line-gap'], st['--row-gap']]; };
  assert.deepStrictEqual(['tight', 'normal', 'loose', 'extra'].map((v) => gaps({ spacing: v })),
    [['.05em', undefined], [undefined, undefined], ['.3em', undefined], ['.5em', undefined]]);
  assert.deepStrictEqual(['tight', 'normal', 'loose', 'extra'].map((v) => gaps({ spacing: v, layout: 'horizontal' })),
    [[undefined, '.5em'], [undefined, undefined], [undefined, '1.5em'], [undefined, '2em']]);
  assert.deepStrictEqual(['tight', 'normal', 'loose', 'extra'].map((v) => gaps({ spacing: v, layout: 'horizontal', bg: 40 })),
    [[undefined, '.2em'], [undefined, undefined], [undefined, '.6em'], [undefined, '.8em']]);
  // A live layout switch moves the gap to the other variable.
  assert.deepStrictEqual(gaps({ spacing: 'loose', layout: 'horizontal' }), [undefined, '1.5em']);
  assert.deepStrictEqual(gaps({ spacing: 'loose' }), ['.3em', undefined]);
  // The lines themselves never change: spacing, like every option here, is CSS on #chat.
  s.r.push(chat('amy', 'hi'));
  s.r.flush();
  const before = JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  gaps({ spacing: 'tight', text_case: 'upper', names: false, bg_color: '123456', bg: 30 });
  assert.strictEqual(JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent])), before);
});

test('outline, shadow color and shadow method: on #chat only while changed, gone again when set back', (t) => {
  const s = setup(t, {});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  assert.strictEqual(s.root.style['--shadow'], R.SHADOWS[2]);
  s.r.setConfig({ outline: 2 });
  assert.deepStrictEqual(rootExtras(s), { cls: ['has-outline'], style: { '--tshadow': R.tshadow({ outline: 2 }), '--tshadow-room': '.06em' } });
  assert.strictEqual(s.root.style['--shadow'], R.SHADOWS[2], 'the line filter stays');
  s.r.setConfig({ outline: 3, outline_color: 'ffffff', shadow_color: '102030' });
  assert.strictEqual(s.root.style['--tshadow-room'], '.08em', 'the filter shadow needs no room: it draws past the clips');
  assert.ok(s.root.style['--tshadow'].split(', ').every((l) => / 0 #ffffff$/.test(l)));
  assert.strictEqual(s.root.style['--shadow'], R.shadowCss(2, '102030'));
  // shadow_style=text: the filter goes, the shadow is drawn as text layers after the outline's.
  s.r.setConfig({ outline: 1, shadow_style: 'text', shadow: 3, shadow_color: '102030' });
  assert.deepStrictEqual(rootExtras(s).cls, ['has-outline', 'shadow-text']);
  assert.strictEqual(s.root.style['--shadow'], 'none');
  assert.strictEqual(s.root.style['--tshadow'], R.tshadow({ outline: 1 }) + ', 0 0 4px #102030, 0 0 2px #102030, 2px 3px 8px rgba(16,32,48,.9)');
  assert.strictEqual(s.root.style['--tshadow-room'], '11px');
  s.r.setConfig({ shadow_style: 'text', shadow: 0 });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} }, 'no shadow: nothing to draw either way');
  assert.strictEqual(s.root.style['--shadow'], 'none');
  s.r.setConfig({ shadow_style: 'text' });
  assert.deepStrictEqual(rootExtras(s), { cls: ['shadow-text'], style: { '--tshadow': R.TEXT_SHADOWS[2], '--tshadow-room': '6px' } });
  s.r.setConfig({});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  assert.strictEqual(s.root.style['--shadow'], R.SHADOWS[2]);
  // None of it touches the lines: it is CSS on #chat.
  s.r.push(chat('amy', 'hi'));
  s.r.flush();
  const before = JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  s.r.setConfig({ outline: 2, shadow_style: 'text', shadow_color: 'ff0000', outline_color: '00ff00' });
  assert.strictEqual(JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent])), before);
});

test('accent_bar: chat lines get the class and their name color as --line-accent; both go again when it is off', (t) => {
  const s = setup(t, { accent_bar: true, first_msg: true }, { nameFor: (m) => ({ text: m.displayName, color: m.login === 'odd' ? 'red' : '#1E90FF' }) });
  s.r.push(chat('amy', 'hi'));
  s.r.push(chat('newbie', 'first!', { firstMsg: true }));
  s.r.push(chat('ann', 'listen', { announcement: 'GREEN' }));
  s.r.push(resub('bob', 'still here'));
  s.r.push(chat('odd', 'a color that is not hex'));
  s.r.flush();
  const shown = () => s.lines().map((l) => [l.className, l.style['--line-accent']]);
  assert.deepStrictEqual(shown(), [
    ['line accent', '#1E90FF'],
    ['line first-msg accent', '#1E90FF'],
    ['line announcement ann-green', undefined],
    ['line notice', undefined],
    ['line accent', '#1E90FF'],
    ['line accent', undefined]
  ]);
  s.r.setConfig({ first_msg: true });
  assert.deepStrictEqual(shown(), [['line', undefined], ['line first-msg', undefined], ['line announcement ann-green', undefined],
    ['line notice', undefined], ['line', undefined], ['line', undefined]], 'rebuilt without the bar or its color');
  s.r.setConfig({ first_msg: true, accent_bar: true });
  assert.strictEqual(shown()[0][1], '#1E90FF');
});

test('paint_images=static: a still rule per animated paint only while static; the paint sheet as before otherwise', (t) => {
  const still = { P1: '.paint-static .painted.p-P1{background-image:url("https://cdn.7tv.app/s")}', BAD: '.paint-static .p-BAD { INVALID }' };
  const s = setup(t, {}, {
    nameFor: (m) => ({ text: m.displayName, color: '#FFFFFF', paintId: m.login === 'cy' ? 'P2' : m.login === 'zed' ? 'BAD' : 'P1' }),
    paintRule: (id) => '.painted.p-' + id + '{background-image:url("https://cdn.7tv.app/' + id + '")}',
    paintStaticRule: (id) => still[id] || null
  });
  const sheet = () => s.doc.head.children.find((e) => e.getAttribute('data-tco') === 'paints').sheet.cssRules.slice();
  s.r.push(chat('amy', '1'));
  s.r.push(chat('cy', '2'));
  s.r.flush();
  // (A flush builds the newest message first.)
  assert.deepStrictEqual(sheet(), ['.painted.p-P2{background-image:url("https://cdn.7tv.app/P2")}',
    '.painted.p-P1{background-image:url("https://cdn.7tv.app/P1")}'], 'default: one rule per paint, no still rules');
  assert.ok(!s.root.classList.contains('paint-static'));
  s.r.setConfig({ paint_images: 'static' });
  assert.ok(s.root.classList.contains('paint-static'));
  assert.deepStrictEqual(sheet().slice(2), [still.P1], 'the paints in use get theirs at once; P2 (a gradient) has none');
  // A paint seen while static gets both; a rejected still rule leaves the paint itself.
  s.r.push(chat('zed', '3'));
  s.r.flush();
  assert.deepStrictEqual(sheet().slice(3), ['.painted.p-BAD{background-image:url("https://cdn.7tv.app/BAD")}']);
  assert.strictEqual(s.lines()[2].byClass('name')[0].className, 'name painted p-BAD');
  // Back to animated: the class goes, the still rules stay (unused without it), and none is added twice.
  s.r.setConfig({});
  assert.ok(!s.root.classList.contains('paint-static'));
  s.r.setConfig({ paint_images: 'static' });
  s.r.rerender();
  assert.strictEqual(sheet().length, 4);
  assert.strictEqual(s.r.stats().paints, 3);
});

test('overlay.css: the stage-3 rules (outline, text-only shadow, name-color bar) stay off by default and overridable', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  // text-shadow only under .has-outline / .shadow-text, never on the built-in SVG badges' letters, and painted
  // names keep none.
  const ts = Array.from(css.matchAll(/([^{}]+)\{[^}]*text-shadow:\s*([^;}]+)/g), (m) => [m[1].trim(), m[2].trim()]);
  assert.deepStrictEqual(ts, [
    [':where(.has-outline, .shadow-text) .line,\n:where(.has-outline, .shadow-text) .reply', 'var(--tshadow, none)'],
    [':where(.has-outline, .shadow-text) .badge.icon text', 'none'],
    ['.painted', 'none']
  ]);
  // Room for the outline and the text-only shadow where a line (a row without a box) clips its sides, and the
  // reply header lets them draw that far past its box: after .reply's own overflow: hidden, at its specificity.
  assert.match(css, /\n:where\(\.layout-horizontal:not\(\.has-bg\)\):where\(\.has-outline, \.shadow-text\) \.line \{\s*padding-left: var\(--tshadow-room, 0\);\s*padding-right: var\(--tshadow-room, 0\);\s*\}/);
  const reply = css.indexOf('\n.reply {'), room = css.indexOf('\n:where(.has-outline, .shadow-text) .reply {\n  overflow: clip;');
  assert.ok(reply > 0 && room > reply, 'after .reply { overflow: hidden }');
  assert.match(css, /\n:where\(\.has-outline, \.shadow-text\) \.reply \{\s*overflow: clip;\s*overflow-clip-margin: var\(--tshadow-room, 0\);\s*\}/);
  assert.doesNotMatch(css, /--outline-width/);
  // The name-color bar comes before .first-msg, so a first message's bar wins at the same specificity.
  const accent = css.indexOf('\n.line.accent {'), first = css.indexOf('\n.line.first-msg {');
  assert.ok(accent > 0 && accent < first);
  assert.match(css, /\n\.line\.accent \{\s*box-shadow: inset \.2em 0 0 var\(--line-accent, currentColor\);\s*padding-left: \.4em;\s*\}/);
  // Its room over .line.highlight's .3em: later, at .line.highlight's own specificity (:where), so Custom CSS written
  // as `.line.highlight { ... }` still wins.
  const hl = css.indexOf('\n.line.highlight {'), hlAccent = css.indexOf('\n.line.highlight:where(.accent) { padding-left: .4em; }');
  assert.ok(hl > 0 && hlAccent > hl, 'over .line.highlight\'s .3em');
  assert.doesNotMatch(css, /\.accent\.highlight|\.highlight\.accent/);
  ['has-outline', 'shadow-text', 'accent', 'paint-static'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

test('layout options: a class or a variable on #chat only while changed, gone again when set back', (t) => {
  const s = setup(t, {});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  s.r.setConfig({ text_align: 'right', line_width: 30, pad_x: 0, edge_fade: 3, row_sep: 'bar' });
  assert.deepStrictEqual(rootExtras(s), {
    cls: ['edge-fade', 'has-maxw', 'sep-bar', 'text-right'],
    style: { '--line-max': '30em', '--line-max-n': '35.294em', '--pad-x': '0px', '--edge-fade': '3em' }
  });
  s.r.setConfig({});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  const one = (k, v) => { s.r.setConfig({ [k]: v }); return rootExtras(s); };
  assert.deepStrictEqual(['left', 'center', 'right'].map((v) => one('text_align', v).cls), [[], ['text-center'], ['text-right']]);
  assert.deepStrictEqual(['none', 'dot', 'bar', 'diamond'].map((v) => one('row_sep', v).cls), [[], ['sep-dot'], ['sep-bar'], ['sep-diamond']]);
  assert.deepStrictEqual([0, 8, 9, 200].map((v) => one('pad_x', v).style), [{ '--pad-x': '0px' }, {}, { '--pad-x': '9px' }, { '--pad-x': '200px' }]);
  assert.deepStrictEqual([0, 1, 10].map((v) => one('edge_fade', v)), [{ cls: [], style: {} },
    { cls: ['edge-fade'], style: { '--edge-fade': '1em' } }, { cls: ['edge-fade'], style: { '--edge-fade': '10em' } }]);
  assert.deepStrictEqual([0, 5, 100].map((v) => one('line_width', v)), [{ cls: [], style: {} },
    { cls: ['has-maxw'], style: { '--line-max': '5em', '--line-max-n': '5.882em' } },
    { cls: ['has-maxw'], style: { '--line-max': '100em', '--line-max-n': '117.647em' } }]);
  // A notice's cap follows its size; without line_width there is none to follow.
  assert.strictEqual(one('line_width', 30).style['--line-max-n'], '35.294em');
  s.r.setConfig({ line_width: 30, notice_size: 100 });
  assert.strictEqual(rootExtras(s).style['--line-max-n'], '30em');
  s.r.setConfig({ notice_size: 120 });
  assert.deepStrictEqual(rootExtras(s).style, { '--notice-size': '1.2em' });
  // The classes stay in the other layout too (the stylesheet scopes each rule), so a layout switch keeps them.
  s.r.setConfig({ text_align: 'center', row_sep: 'dot', layout: 'horizontal' });
  assert.deepStrictEqual(rootExtras(s).cls, ['sep-dot', 'text-center']);
  // None of it touches the lines: it is CSS on #chat.
  s.r.setConfig({});
  s.r.push(chat('amy', 'hi'));
  s.r.push(resub('bob', 'still here'));
  s.r.flush();
  const before = JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  s.r.setConfig({ text_align: 'right', line_width: 20, pad_x: 30, edge_fade: 2, row_sep: 'diamond' });
  assert.strictEqual(JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent])), before);
});

test('overlay.css: the layout rules (stage 4) stay off by default, in their own layout, and overridable', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim());
  const at = (s) => css.indexOf('\n' + s);
  // pad_x: today's 8px as the fallback.
  assert.match(css, /\n#chat \{[^}]*\n  padding: 0 var\(--pad-x, 8px\);/);
  // text_align: a column only. A box's auto margin must never reach a row's flex items: unscoped, `.has-bg.text-right
  // .line` would beat `.layout-horizontal .line { margin: 0 }` and spread the row out.
  assert.deepStrictEqual(selectors.filter((s) => /text-(?:center|right)/.test(s)), [
    ':where(.layout-vertical.text-center) .lines', ':where(.layout-vertical.text-right) .lines',
    '.text-center:where(.layout-vertical.has-bg, .layout-vertical.has-maxw) .line',
    '.text-right:where(.layout-vertical.has-bg, .layout-vertical.has-maxw) .line']);
  assert.match(css, /\n\.text-center:where\([^)]*\) \.line \{ margin-left: auto; margin-right: auto; \}/);
  assert.match(css, /\n\.text-right:where\([^)]*\) \.line \{ margin-left: auto; \}/);
  assert.ok(at('.text-right:where(') > at('.has-bg .line {'), 'after the box\'s own margin, which it overrides at (0,2,0)');
  // line_width: class-only (0,2,0), after the row's rules it beats on order; notices get their own em's cap.
  assert.match(css, /\n\.has-maxw \.line \{ max-width: min\(100%, var\(--line-max, 100%\)\); \}/);
  assert.match(css, /\n\.has-maxw \.line\.notice \{ max-width: min\(100%, var\(--line-max-n, var\(--line-max, 100%\)\)\); \}/);
  assert.ok(at('.has-maxw .line {') > at('.layout-horizontal .line {') && at('.layout-horizontal .line {') > at('.has-bg .line {'));
  // edge_fade: on #chat (never .lines, which moves), the -webkit- property Chromium 103 has, toward the edge old
  // lines leave by, and never over more than half the source.
  const masks = Array.from(css.matchAll(/([^{}]+)\{[^}]*mask-image:\s*([^;}]+)/g), (m) => [m[1].trim(), m[2].trim()]);
  assert.deepStrictEqual(masks, [
    ['.edge-fade.layout-vertical.align-bottom', 'linear-gradient(to bottom, transparent, #000 min(var(--edge-fade, 2em), 50%))'],
    ['.edge-fade.layout-vertical.align-top', 'linear-gradient(to top, transparent, #000 min(var(--edge-fade, 2em), 50%))'],
    ['.edge-fade.layout-horizontal', 'linear-gradient(to right, transparent, #000 min(var(--edge-fade, 2em), 50%))']
  ]);
  assert.doesNotMatch(css, /[^-]mask-image/, 'only the prefixed property');
  // In a row the newest message starts after the fade.
  assert.match(css, /\n\.edge-fade\.layout-horizontal \.lines \{ padding-left: max\(var\(--pad-x, 8px\), min\(var\(--edge-fade, 2em\), 50%\)\); \}/);
  // row_sep: in a row only, never on .line::before (beside a reply's block header it would take a row of its own), a
  // fixed glyph per class in the text color, and an empty badge holder shown to carry it.
  const seps = selectors.filter((s) => /sep-/.test(s));
  assert.ok(seps.length >= 5);
  seps.forEach((s) => s.split(/,\s*(?=:where)/).forEach((one) => {
    assert.match(one, /^:where\(\.layout-horizontal(?:\)|\.|:not\(\.has-bg\)\))/, one);
    assert.match(one, / \.line \+ \.line > (?:\.reply \+ \*::before|:first-child:not\(\.reply\)::before|\.badges:empty)$/, one);
  }));
  assert.doesNotMatch(css, /\.line::before|\.line \+ \.line::before/);
  [['sep-dot', '\'\\2022\''], ['sep-bar', '\'|\''], ['sep-diamond', '\'\\25C6\'']].forEach(([c, glyph]) =>
    assert.ok(css.indexOf(':where(.layout-horizontal.' + c + ') .line + .line > :first-child:not(.reply)::before { content: ' + glyph + '; }') > 0, c));
  assert.match(css, /::before \{\s*margin-right: \.5em;\s*color: var\(--text-color, #fff\);\s*opacity: \.6;\s*\}/);
  // Without a box the row's gap is before the mark, so the same gap goes after it (same specificity, later).
  const after = ':where(.layout-horizontal:not(.has-bg)):where(.sep-dot, .sep-bar, .sep-diamond) .line + .line > :first-child:not(.reply)::before {\n  margin-right: var(--row-gap, 1em);\n}';
  assert.ok(css.indexOf(after) > at(':where(.layout-horizontal):where(.sep-dot, .sep-bar, .sep-diamond) .line + .line > .reply + *::before,'));
  assert.match(css, /\.line \+ \.line > \.badges:empty \{ display: inline; \}/);
  // No new rule starts with #chat, so Custom CSS on the documented selectors keeps winning.
  ['text-center', 'text-right', 'has-maxw', 'edge-fade', 'sep-'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

test('overlay.css: the stage-2 rules keep today\'s look by default and stay overridable', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // text_case never reaches the built-in SVG badges (Kick's OG): only names, colons, messages and reply headers.
  const caseRules = Array.from(css.matchAll(/([^{}]+)\{[^}]*(?:text-transform|font-variant-caps)[^}]*\}/g), (m) => m[1].trim());
  assert.strictEqual(caseRules.length, 3);
  caseRules.forEach((sel) => sel.split(',').forEach((one) =>
    assert.match(one.trim(), /^\.case-(?:upper|lower|smallcaps) \.(?:name|colon|message|reply)$/, one)));
  assert.doesNotMatch(css, /font-variant:/, 'font-variant-caps, not the shorthand that resets ligatures');
  // name_line: a column only, never a notice, and the message stays where a left-to-right line puts it.
  // names=0 cancels it (the builder greys it out then), so badges never sit on a row of their own.
  assert.match(css, /:where\(\.layout-vertical\.name-line:not\(\.no-names\) \.line:not\(\.notice\)\) \.message \{\s*display: block;\s*text-align: left;\s*text-align: -webkit-match-parent;\s*\}/);
  assert.match(css, /:where\(\.layout-vertical\.name-line:not\(\.no-names\) \.line:not\(\.notice\)\) \.colon \{ display: none; \}/);
  Array.from(css.matchAll(/([^{}]*\.name-line[^{}]*)\{/g), (m) => m[1]).forEach((sel) =>
    assert.match(sel, /\.name-line:not\(\.no-names\)/, sel));
  assert.match(css, /\.no-names \.name,\s*\.no-names \.colon \{ display: none; \}/);
  assert.match(css, /:where\(\.layout-vertical\.has-bg\)\.bg-full \.line \{ width: auto; \}/);
  // No new rule starts with #chat (Custom CSS on the documented selectors keeps winning).
  ['bg-full', 'no-names', 'name-line', 'case-'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

// ---------- sizes (stage 5) ----------

test('the sizes: a font-size or variable on #chat only while changed, gone again when set back', (t) => {
  const s = setup(t, {});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  const one = (k, v) => { s.r.setConfig({ [k]: v }); return rootExtras(s).style; };
  assert.deepStrictEqual([0, 8, 30, 96].map((v) => one('text_px', v)), [{}, { 'font-size': '8px' }, { 'font-size': '30px' }, { 'font-size': '96px' }]);
  assert.deepStrictEqual(one('text_px', 3), { 'font-size': '8px' }, 'a partial cfg\'s 1..7 is drawn as 8');
  assert.deepStrictEqual([50, 99, 100, 125, 200].map((v) => one('badge_size', v)),
    [{ '--badge-h': '0.5em' }, { '--badge-h': '0.99em' }, {}, { '--badge-h': '1.25em' }, { '--badge-h': '2em' }]);
  assert.deepStrictEqual([50, 100, 115, 125, 200].map((v) => one('emote_scale', v)),
    [{ '--emote-h': '0.875em' }, {}, { '--emote-h': '2.0125em' }, { '--emote-h': '2.1875em' }, { '--emote-h': '3.5em' }]);
  assert.deepStrictEqual(['normal', 'big', 'huge'].map((v) => one('emote_only', v)), [{}, { '--eo': '2' }, { '--eo': '3' }]);
  assert.deepStrictEqual(['1x', '2x', '3x'].map((v) => one('gif_size', v)),
    [{ '--gif-mul': '1', '--gif-margin': '-.3em .05em' }, { '--gif-mul': '2' }, {}]);
  assert.deepStrictEqual(one('giant_emotes', false), {}, 'giant_emotes is drawn on the lines only');
  // No class for any of them, in either layout.
  s.r.setConfig({ text_px: 40, badge_size: 150, emote_scale: 150, emote_only: 'huge', gif_size: '2x', layout: 'horizontal' });
  assert.deepStrictEqual(rootExtras(s).cls, []);
  s.r.setConfig({ layout: 'horizontal' });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
});

test('the sizes re-pick image files on lines already shown; set back, the lines are as before', (t) => {
  const tw = (name) => ({ provider: 'twitch', name: name, w: 28, h: 28,
    urls: { 1: 'https://e/' + name + '/1', 2: 'https://e/' + name + '/2', 4: 'https://e/' + name + '/4' } });
  const badge = { provider: 'twitch', title: 'VIP', urls: { 1: 'https://b/1', 2: 'https://b/2', 4: 'https://b/4' } };
  const s = setup(t, {}, {
    tokensFor: (m) => (m.text === 'only' ? [{ type: 'emote', emote: tw('Kappa'), sp: false, overlays: [] },
      { type: 'emote', emote: tw('Pog'), sp: true, overlays: [] }, { type: 'text', text: '\u{E0000}', sp: true }]
      : m.text === 'giant' ? [{ type: 'text', text: 'so big', sp: false }, { type: 'emote', emote: tw('Kappa'), sp: true, big: true, overlays: [] }]
        : [{ type: 'text', text: 'hi', sp: false }, { type: 'emote', emote: tw('Kappa'), sp: true, overlays: [] }]),
    badgesFor: () => [badge]
  });
  s.r.push(chat('amy', 'only'));
  s.r.push(chat('bob', 'giant'));
  s.r.push(chat('cy', 'words'));
  s.r.flush();
  const snap = () => s.lines().map((l) => [l.className, l.byClass('badge')[0].src]
    .concat(l.byClass('emote-stack').map((e) => e.className + ' ' + e.firstElementChild.src)));
  const lines = () => JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  const before = lines();
  assert.deepStrictEqual(snap(), [
    ['line', 'https://b/2', 'emote-stack https://e/Kappa/2', 'emote-stack https://e/Pog/2'],
    ['line', 'https://b/2', 'emote-stack big https://e/Kappa/4'],
    ['line', 'https://b/2', 'emote-stack https://e/Kappa/2']
  ]);
  s.r.setConfig({ emote_only: 'big' });
  assert.deepStrictEqual(snap(), [
    ['line emote-only', 'https://b/2', 'emote-stack https://e/Kappa/4', 'emote-stack https://e/Pog/4'],
    ['line', 'https://b/2', 'emote-stack big https://e/Kappa/4'],
    ['line', 'https://b/2', 'emote-stack https://e/Kappa/2']
  ], 'only the emote-only line (its U+E0000 suffix is blank) gets the class and bigger files');
  s.r.setConfig({ emote_only: 'big', layout: 'horizontal' });
  assert.deepStrictEqual(snap().map((l) => l[0]), ['line', 'line', 'line'], 'not in a row');
  s.r.setConfig({ giant_emotes: false });
  assert.deepStrictEqual(snap()[1], ['line', 'https://b/2', 'emote-stack https://e/Kappa/2'], 'no .big, no 3x file');
  s.r.setConfig({ text_px: 64, badge_size: 50 });
  assert.deepStrictEqual(snap(), [
    ['line', 'https://b/2', 'emote-stack https://e/Kappa/4', 'emote-stack https://e/Pog/4'],
    ['line', 'https://b/2', 'emote-stack big https://e/Kappa/4'],
    ['line', 'https://b/2', 'emote-stack https://e/Kappa/4']
  ], '64 px text: 112 px emotes; half-size badges are 32 px');
  s.r.setConfig({ emote_scale: 50, size: 'small' });
  assert.deepStrictEqual(snap()[2], ['line', 'https://b/1', 'emote-stack https://e/Kappa/1']);
  s.r.setConfig({});
  assert.strictEqual(lines(), before);
  assert.deepStrictEqual(snap()[0], ['line', 'https://b/2', 'emote-stack https://e/Kappa/2', 'emote-stack https://e/Pog/2']);
  // The img attributes stay the provider's 1x size: the stylesheet sets the drawn size.
  const img = s.lines()[0].byClass('badge')[0];
  assert.deepStrictEqual([img.getAttribute('width'), img.getAttribute('height')], ['18', '18']);
});

test('overlay.css: the size rules keep today\'s values as fallbacks and stay overridable', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  // badge_size: the badge's height and the built-in icon's width, a square slot with no width cap.
  const badge = /\n\.badge \{([^}]*)\}/.exec(css)[1];
  assert.match(badge, /\n  height: var\(--badge-h, 1em\);/);
  assert.match(badge, /aspect-ratio: 1 \/ 1;/);
  assert.doesNotMatch(badge, /max-width/);
  assert.match(css, /\n\.badge\.icon \{ width: var\(--badge-h, 1em\); overflow: visible; \}/);
  // gif_size: 3 emote heights unless --gif-mul says otherwise; at 1x an emote's margins. A row keeps emote height.
  const gif = /\n\.gif \{([^}]*)\}/.exec(css)[1];
  assert.match(gif, /\n  height: calc\(var\(--emote-h, 1\.75em\) \* var\(--gif-mul, 3\)\);/);
  assert.match(gif, /\n  max-height: calc\(var\(--emote-h, 1\.75em\) \* var\(--gif-mul, 3\)\);/);
  assert.match(gif, /\n  margin: var\(--gif-margin, \.1em 0\);/);
  const row = /\n\.layout-horizontal \.gif \{([^}]*)\}/.exec(css)[1];
  assert.match(row, /height: var\(--emote-h, 1\.75em\);[\s\S]*max-height: var\(--emote-h, 1\.75em\);[\s\S]*margin: -\.3em \.05em;/);
  // emote_only: only .emote-only lines, never a gigantified emote (.big keeps its 3x), at (0,2,0) like .emote-stack.big.
  const eo = Array.from(css.matchAll(/([^{}]+)\{[^}]*var\(--eo/g), (m) => m[1].trim());
  assert.deepStrictEqual(eo, [':where(.line.emote-only) .emote-stack:not(.big)']);
  assert.match(css, /\n:where\(\.line\.emote-only\) \.emote-stack:not\(\.big\) \{ --eh: calc\(var\(--emote-h, 1\.75em\) \* var\(--eo, 2\)\); \}/);
  // A very wide emote on such a line is fitted to the column (letterboxed in its box), only there: everywhere else
  // an emote keeps max-width: none, as before.
  assert.match(css, /\n:where\(\.line\.emote-only\) \.emote-stack:not\(\.big\) > \.emote \{ max-width: 100%; object-fit: contain; \}/);
  const caps = Array.from(css.matchAll(/([^{}]+)\{[^}]*max-width: 100%/g), (m) => m[1].trim())
    .filter((s) => /\.emote(?![\w-])/.test(s));
  assert.deepStrictEqual(caps, [':where(.line.emote-only) .emote-stack:not(.big) > .emote']);
  assert.match(/\n\.emote-stack > \.emote \{([^}]*)\}/.exec(css)[1], /\n  max-width: none;/);
  assert.match(css, /\n\.emote-stack\.big \{ --eh: calc\(var\(--emote-h, 1\.75em\) \* 3\); \}/);
  assert.match(css, /\n\.layout-horizontal \.emote-stack\.big \{ --eh: var\(--emote-h, 1\.75em\); \}/);
  // emote_scale is --emote-h, which every emote, cheer and GIF size already reads.
  assert.match(css, /\n\.emote-stack \{\n  --eh: var\(--emote-h, 1\.75em\);/);
  assert.match(css, /\n\.cheer-img \{\n  height: var\(--emote-h, 1\.75em\);/);
  // No new rule starts with #chat.
  ['emote-only', '--badge-h', '--gif-mul', '--eo'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});
