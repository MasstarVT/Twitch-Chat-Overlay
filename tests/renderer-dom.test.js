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
