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

// renderer-css round 4: a Shared Chat message has two ids (its own and its source id), and a reply or a deletion may name
// either. Only the id the deletion named was taken out of reply headers, and only the id a message was pushed with was
// noted after a timeout.
const replyById = (parent, pid, login, text) => chat(login, text, { reply: { id: pid, userId: parent.userId, login: parent.login,
  name: parent.displayName, body: parent.text } });
[['the home id', 'the source id'], ['the source id', 'the home id']].forEach(([by, named]) => {
  test('Shared Chat: a deletion by ' + by + ' takes the header off a reply naming the message by ' + named, (t) => {
    const s = setup(t);
    const p = chat('pv', 'SECRET', { sourceId: 'src-' + nid });
    const del = by === 'the home id' ? p.id : p.sourceId, pid = by === 'the home id' ? p.sourceId : p.id;
    s.r.push(p);
    s.r.push(replyById(p, pid, 'rv', 'answer'));
    s.r.flush();
    assert.strictEqual(replyText(s.lines()[1]), '↪ @pv: SECRET');
    s.r.clearMessage(del);
    assert.deepStrictEqual(s.texts(), ['answer']);
    assert.strictEqual(replyText(s.lines()[0]), null, 'on screen');
    s.r.push(replyById(p, pid, 'late', 'what was it'));
    s.r.push(replyById(p, del, 'late2', 'and this'));
    s.r.flush();
    assert.deepStrictEqual(s.lines().map(replyText), [null, null, null], 'and on a reply that comes later');
    assert.ok(!/SECRET/.test(s.root.textContent));
  });
});

test('Shared Chat: a deletion of a message the renderer never had takes both ids the caller names (a robotty rm-deleted line)', (t) => {
  const s = setup(t);
  const p = { id: 'h-1', sourceId: 's-1', userId: 'u-pv', login: 'pv', displayName: 'pv', text: 'SECRET' };
  s.r.clearMessage('h-1', 's-1');
  s.r.push(replyById(p, 's-1', 'rv', 'answer'));
  s.r.push(replyById(p, 'h-1', 'rv2', 'answer 2'));
  s.r.flush();
  assert.deepStrictEqual(s.lines().map(replyText), [null, null]);
  assert.strictEqual(s.r.push(chat('pv', 'SECRET', { id: 'x-1', sourceId: 's-1' })), false, 'a copy by the other id is refused too');
  // A deletion the renderer learns the other id of only later (the message is noted after it): replies naming that one
  // lose the header too.
  s.r.clearMessage('h-2');
  s.r.note({ kind: 'chat', id: 'h-2', sourceId: 's-2', userId: 'u-pv', text: 'SECRET 2' });
  s.r.push(replyById({ userId: 'u-pv', login: 'pv', displayName: 'pv', text: 'SECRET 2' }, 's-2', 'rv3', 'answer 3'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[2]), null);
});

['push', 'note'].forEach((how) => {
  test('Shared Chat: back after a timeout, a reply naming the new message by its source id keeps its header (' + how + ')', (t) => {
    const s = setup(t);
    s.r.clearUser('u-pv');
    s.tick(60000);
    const back = chat('pv', 'fine words', { sourceId: 'src-' + nid });
    if (how === 'push') s.r.push(back);
    else s.r.note(back);
    s.r.push(replyById(back, back.sourceId, 'rv', 'answer'));
    s.r.push(replyById(back, back.id, 'rv2', 'answer 2'));
    s.r.flush();
    const replies = s.lines().filter((l) => l.byClass('reply').length || /answer/.test(l.textContent));
    assert.deepStrictEqual(replies.map(replyText), ['↪ @pv: fine words', '↪ @pv: fine words']);
    // A second timeout covers it by either id.
    s.r.clearUser('u-pv');
    assert.deepStrictEqual(replies.map(replyText), [null, null]);
  });
});

// A /clear (Twitch) or a chatroom clear (Kick) took the lines, but a reply sent after it still carries the cleared text
// (Twitch's reply-parent-msg-body, Kick's original_message): the header put it back on stream, as it did before a
// deletion or a ban was kept out of headers.
test('a chat clear keeps what it took out of later reply headers: on screen, queued, or already gone before it', (t) => {
  const s = setup(t, { max: 3 });
  const gone = chat('hater', 'SPAM ONE');
  s.r.push(gone);
  ['a', 'b', 'c'].forEach((n) => s.r.push(chat(n, n)));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['a', 'b', 'c'], 'the first one left the screen before the clear');
  const shown = chat('hater', 'SPAM TWO');
  s.r.push(shown);
  s.r.flush();
  s.r.hold(true);
  const queued = chat('hater', 'SPAM THREE');
  s.r.push(queued);
  s.r.clearAll();
  s.r.hold(false);
  assert.deepStrictEqual(s.texts(), []);
  [gone, shown, queued].forEach((p) => s.r.push(replyTo(p, 'amy', 'what was that')));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['what was that', 'what was that', 'what was that']);
  assert.deepStrictEqual(s.lines().map(replyText), [null, null, null]);
  assert.ok(!/SPAM/.test(s.root.textContent), 'no cleared text is drawn');
  // Said after the clear: a reply to it keeps its header. One the overlay never saw (from before it started) counts as
  // from before the clear.
  const after = chat('bob', 'fresh start');
  s.r.push(after);
  s.r.push(replyTo(after, 'amy', 'hi bob'));
  s.r.push(replyTo({ id: 'never-seen', userId: 'u-x', login: 'x', displayName: 'x', text: 'OLD SPAM' }, 'amy', 'eh'));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['fresh start', 'hi bob', 'eh']);
  assert.deepStrictEqual(s.lines().map(replyText), [null, '↪ @bob: fresh start', null]);
  // A copy of a cleared message delivered again is refused, as a deleted one is.
  assert.strictEqual(s.r.push(Object.assign({}, shown)), false);
});

test('a Twitch /clear in a combined chat keeps the headers of Kick replies, and a Kick clear those of Twitch ones', (t) => {
  const s = setup(t, { max: 20 });
  const isKick = (m) => m.platform === 'kick';
  const notKick = (m) => !isKick(m);
  const tw = chat('tw', 'TWITCH TEXT');
  const kk = chat('kk', 'KICK TEXT', { platform: 'kick', id: 'kick:1', userId: 'kick:9' });
  s.r.push(tw);
  s.r.push(kk);
  s.r.flush();
  s.r.clearAll(notKick);
  assert.deepStrictEqual(s.texts(), ['KICK TEXT']);
  s.r.push(replyTo(tw, 'amy', 'tw reply'));
  s.r.push(Object.assign(replyTo(kk, 'ann', 'kick reply'), { platform: 'kick', id: 'kick:2', userId: 'kick:8' }));
  s.r.push(Object.assign(replyTo({ id: 'kick:0', userId: 'kick:7', login: 'old', displayName: 'old', text: 'old kick' }, 'ann', 'kick reply 2'),
    { platform: 'kick', id: 'kick:3', userId: 'kick:8' }));
  s.r.flush();
  const header = (text) => replyText(s.lines().find((l) => l.byClass('message')[0].textContent === text));
  assert.strictEqual(header('tw reply'), null);
  assert.strictEqual(header('kick reply'), '↪ @kk: KICK TEXT');
  assert.strictEqual(header('kick reply 2'), '↪ @old: old kick', 'no Kick clear yet');
  // Now Kick's own clear, and a Twitch message after the Twitch one: its replies keep their header.
  const tw2 = chat('tw', 'after the clear');
  s.r.push(tw2);
  s.r.flush();
  s.r.clearAll(isKick);
  s.r.push(Object.assign(replyTo(kk, 'ann', 'kick reply 3'), { platform: 'kick', id: 'kick:4', userId: 'kick:8' }));
  s.r.push(replyTo(tw2, 'amy', 'tw reply 2'));
  s.r.flush();
  assert.strictEqual(header('kick reply 3'), null);
  assert.strictEqual(header('tw reply 2'), '↪ @tw: after the clear');
  // A new Twitch clear covers what was said since the old one.
  s.r.clearAll(notKick);
  s.r.push(replyTo(tw2, 'amy', 'tw reply 3'));
  s.r.flush();
  assert.strictEqual(header('tw reply 3'), null);
});

// A deletion, a ban and a clear are kept a day: a reply line still on screen after that got the moderated text back in its
// header as soon as anything redrew it (a 7TV emote set update, a badge load).
test('a reply whose quote was moderated keeps it out when its line is redrawn after the moderation has expired', (t) => {
  const s = setup(t);
  const del = chat('troll', 'DELETED WORDS');
  const ban = chat('banned', 'BANNED WORDS');
  const clr = chat('spam', 'CLEARED WORDS');
  [del, ban, clr].forEach((m) => s.r.push(m));
  s.r.flush();
  s.r.clearMessage(del.id);
  s.r.clearUser(ban.userId);
  s.r.clearAll();
  [del, ban, clr].forEach((m) => s.r.push(replyTo(m, 'amy', 'reply to ' + m.login)));
  s.r.flush();
  assert.deepStrictEqual(s.lines().map(replyText), [null, null, null]);
  s.tick(25 * 3600000);
  s.r.rerender();
  assert.deepStrictEqual(s.lines().map(replyText), [null, null, null]);
  assert.ok(!/WORDS/.test(s.root.textContent));
  // A reply that arrives now, quoting a message the overlay no longer knows was moderated, is drawn as it comes.
  s.r.push(replyTo(del, 'bob', 'late'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[3]), '↪ @troll: DELETED WORDS');
});

// They were kept 10 minutes (a deletion) and an hour (a timeout, ban or clear): a reply that came later, from a viewer
// replying to a deleted or greyed-out message in Chatterino, put the moderated text back on stream in its header.
test('a deletion, a timeout or ban and a chat clear are kept a day for the reply headers of later replies', (t) => {
  const s = setup(t, { max: 50 });
  const del = chat('troll', 'DELETED WORDS');
  const ban = chat('banned', 'BANNED WORDS');
  [del, ban].forEach((m) => s.r.push(m));
  s.r.flush();
  s.r.clearMessage(del.id);
  s.r.clearUser(ban.userId);
  const late = (ms, label) => {
    s.tick(ms);
    s.r.push(replyTo(del, 'amy', label + ' del'));
    s.r.push(replyTo(ban, 'amy', label + ' ban'));
    s.r.flush();
    return s.lines().slice(-2).map(replyText);
  };
  assert.deepStrictEqual(late(11 * 60000, '11 min'), [null, null]);
  assert.deepStrictEqual(late(50 * 60000, '61 min'), [null, null]);
  assert.deepStrictEqual(late(22 * 3600000, '23 h'), [null, null]);
  assert.ok(!/WORDS/.test(s.root.textContent));
  // After a day the overlay no longer knows: a reply then is drawn as it comes.
  assert.deepStrictEqual(late(3600000, '24 h'), ['↪ @troll: DELETED WORDS', '↪ @banned: BANNED WORDS']);
});

test('a chat clear is kept a day, as a ban is', (t) => {
  const s = setup(t);
  const old = { id: 'p0', userId: 'u-x', login: 'x', displayName: 'x', text: 'before' };
  s.r.clearAll();
  s.r.push(replyTo(old, 'amy', 'one'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[0]), null);
  s.tick(86399000);
  s.r.push(replyTo(old, 'amy', 'two'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[1]), null);
  s.tick(1000);
  s.r.push(replyTo(old, 'amy', 'three'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[2]), '↪ @x: before');
});

test('a chat clear is kept only while the overlay knows every message said since it', (t) => {
  // More messages since the clear than the overlay notes (shown or not): a reply to one from before it isn't expected.
  const s = setup(t, {}, { shouldShow: (m) => m.login !== 'filler' });
  s.r.clearAll();
  const R = renderer._internal;
  // The reply is a message too: with it, as many as are noted.
  for (let i = 0; i < R.DELETED_CAP - 1; i++) s.r.push(chat('filler', 'x'));
  s.r.push(replyTo({ id: 'p1', userId: 'u-x', login: 'x', displayName: 'x', text: 'before' }, 'amy', 'three'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[0]), null, 'still within the record');
  s.r.push(chat('filler', 'x'));
  s.r.push(replyTo({ id: 'p1', userId: 'u-x', login: 'x', displayName: 'x', text: 'before' }, 'amy', 'four'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[1]), '↪ @x: before');
});

// block_words and links=hide (overlay.js quotesHidden): asked each time a reply is drawn, so a live change takes the
// header away and gives it back.
test('deps.quoteHidden leaves a reply\'s header out as it is drawn; a block_words change redraws the replies only', (t) => {
  let hide = [];
  const built = [];
  const s = setup(t, {}, {
    tokensFor: (m) => { built.push(m.text); return [{ type: 'text', text: m.text, sp: false }]; },
    quoteHidden: (r) => hide.some((w) => r.body.indexOf(w) >= 0)
  });
  const parent = chat('amy', 'a spoiler here');
  s.r.push(parent);
  s.r.push(replyTo(parent, 'viewer', 'wow'));
  s.r.push(chat('bob', 'plain'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[1]), '↪ @amy: a spoiler here');
  hide = ['spoiler'];
  built.length = 0;
  s.r.setConfig({ block_words: ['spoiler'] });
  assert.strictEqual(replyText(s.lines()[1]), null);
  assert.deepStrictEqual(built, ['wow'], 'only the reply is rebuilt');
  assert.deepStrictEqual(s.texts(), ['a spoiler here', 'wow', 'plain'], 'no shouldShow here: every line stays');
  built.length = 0;
  s.r.setConfig({ block_words: ['spoiler'] });
  assert.deepStrictEqual(built, [], 'unchanged: nothing redrawn');
  hide = [];
  s.r.setConfig({ block_words: [] });
  assert.strictEqual(replyText(s.lines()[1]), '↪ @amy: a spoiler here', 'back with the setting');
  // A reply arriving while it applies has no header from the start.
  hide = ['spoiler'];
  s.r.setConfig({ block_words: ['spoiler'] });
  s.r.push(replyTo(parent, 'late', 'lol'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[3]), null);
});

// block (overlay.js quotesHidden): a reply to a blocked user has no header, so the builder's live change redraws the
// replies on screen as a reload would draw them.
test('a block change redraws the reply headers as well: a user added loses them, a user taken off gets them back', (t) => {
  let blocked = [];
  const built = [];
  const s = setup(t, {}, {
    tokensFor: (m) => { built.push(m.text); return [{ type: 'text', text: m.text, sp: false }]; },
    quoteHidden: (r) => blocked.indexOf(r.login) >= 0
  });
  const parent = chat('amy', 'type !uptime');
  s.r.push(parent);
  s.r.push(replyTo(parent, 'viewer', 'gg thanks'));
  s.r.push(chat('bob', 'plain'));
  s.r.flush();
  assert.strictEqual(replyText(s.lines()[1]), '↪ @amy: type !uptime');
  blocked = ['amy'];
  built.length = 0;
  s.r.setConfig({ block: ['amy'] });
  assert.strictEqual(replyText(s.lines()[1]), null);
  assert.deepStrictEqual(built, ['gg thanks'], 'only the reply is rebuilt');
  blocked = [];
  s.r.setConfig({ block: [] });
  assert.strictEqual(replyText(s.lines()[1]), '↪ @amy: type !uptime', 'back once the user is taken off');
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

// ---------- animations (enter_style, enter_ms, fade_out_ms, exit_style) ----------

// One more renderer on a setup's document (the mocked clock is the setup's).
function another(s, cfg) {
  const root = s.doc.createElement('div');
  s.doc.body.appendChild(root);
  const r = renderer.createRenderer({ root: root, cfg: cfg, deps: {} });
  const linesEl = root.firstElementChild;
  return { r, root, linesEl, lines: () => linesEl.children };
}

test('every entrance hands off to the fade, in a column and in a row, and the fade still ends `fade` s after arrival', (t) => {
  const s = setup(t);
  const exits = { vertical: 'tco-out-slide', horizontal: 'tco-out-slide-x' };
  ['vertical', 'horizontal'].forEach((layout) => {
    Object.keys(R.ENTER).forEach((style) => {
      ['fade', 'slide'].forEach((exit) => {
        const x = another(s, { fade: 30, animate: true, layout: layout, enter_style: style, enter_ms: 300, fade_out_ms: 2000, exit_style: exit });
        x.r.push(chat('amy', 'a'));
        x.r.flush();
        const line = x.lines()[0];
        const name = R.ENTER[style][layout === 'horizontal' ? 1 : 0];
        const what = layout + ' ' + style + ' ' + exit;
        assert.strictEqual(line.style.animation, name + ' 300ms ease-out', what + ': the entrance alone');
        s.tick(300);
        x.linesEl.dispatch('animationend', { target: line, animationName: name });
        const out = exit === 'fade' ? 'tco-fade' : exits[layout];
        assert.strictEqual(line.style.animation, out + ' 2000ms linear 27700ms forwards', what + ': 300 + 27700 + 2000 = 30 s');
        x.linesEl.dispatch('animationend', { target: line, animationName: out });
        assert.strictEqual(x.lines().length, 0, what + ': the exit ending removes the line');
        assert.strictEqual(x.r.stats().ids, 0);
        x.r.destroy();
      });
    });
  });
});

test('the fade-out waits for the entrance, whatever its length; an entrance of any style hands off, whatever is set now', (t) => {
  // fade=2 with a 1.5 s fade-out: the fade-out starts 500 ms after arrival. A 180 ms entrance ends first, and the
  // fade waits for it as always.
  const s = setup(t, { fade: 2, animate: true, fade_out_ms: 1500 });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  assert.strictEqual(s.lines()[0].style.animation, 'tco-in 180ms ease-out');
  // Begun at 500 ms, the fade-out would take over opacity and cut a 1000 ms entrance short with a jump. So it waits
  // for this one too, then starts from full over the 1000 ms left: still gone 2 s after arrival.
  s.r.setConfig({ fade: 2, animate: true, fade_out_ms: 1500, enter_ms: 1000 });
  s.r.push(chat('bob', 'b'));
  s.r.flush();
  const b = s.lines()[1];
  assert.strictEqual(b.style.animation, 'tco-in 1000ms ease-out');
  s.tick(1000);
  s.linesEl.dispatch('animationend', { target: b, animationName: 'tco-in' });
  assert.strictEqual(b.style.animation, 'tco-fade 1000ms linear 0ms forwards');
  // A 500 ms one ends just as the fade-out begins.
  s.r.setConfig({ fade: 2, animate: true, fade_out_ms: 1500, enter_ms: 500 });
  s.r.push(chat('eve', 'e'));
  s.r.flush();
  assert.strictEqual(s.lines()[2].style.animation, 'tco-in 500ms ease-out');
  s.linesEl.dispatch('animationend', { target: s.lines()[2], animationName: 'tco-in' });
  assert.strictEqual(s.lines()[2].style.animation, 'tco-fade 1500ms linear 500ms forwards', 'no time has passed (mocked clock)');
  // A line that came in with one style hands off when that entrance ends, after the style changed.
  s.r.setConfig({ fade: 30, animate: true, enter_style: 'slide' });
  s.r.push(chat('cat', 'c'));
  s.r.flush();
  const c = s.lines()[3];
  assert.strictEqual(c.style.animation, 'tco-in 180ms ease-out');
  s.r.setConfig({ fade: 30, animate: true, enter_style: 'pop' });
  assert.strictEqual(c.style.animation, 'tco-in 180ms ease-out', 'a new style is for new lines');
  s.linesEl.dispatch('animationend', { target: c, animationName: 'tco-in' });
  assert.strictEqual(c.style.animation, 'tco-fade 1000ms linear 29000ms forwards');
  // An end that isn't one of the overlay's own changes nothing.
  s.r.push(chat('dan', 'd'));
  s.r.flush();
  const d = s.lines()[4];
  assert.strictEqual(d.style.animation, 'tco-in-pop 180ms ease-out');
  s.linesEl.dispatch('animationend', { target: d, animationName: 'my-own' });
  assert.strictEqual(d.style.animation, 'tco-in-pop 180ms ease-out');
  s.linesEl.dispatch('animationend', { target: d, animationName: 'tco-in-pop' });
  assert.strictEqual(d.style.animation, 'tco-fade 1000ms linear 29000ms forwards');
});

test('off the animation defaults the entrance is never cut short; at them, 1.5\'s timing to the letter', (t) => {
  // A fade-out as long as the whole stay, with a slide exit: begun at arrival it would hide the pop entirely.
  const s = setup(t, { fade: 3, animate: true, fade_out_ms: 3000, enter_style: 'pop', exit_style: 'slide', enter_ms: 600 });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const a = s.lines()[0];
  assert.strictEqual(a.style.animation, 'tco-in-pop 600ms ease-out');
  s.tick(600);
  s.linesEl.dispatch('animationend', { target: a, animationName: 'tco-in-pop' });
  assert.strictEqual(a.style.animation, 'tco-out-slide 2400ms linear 0ms forwards', '600 + 2400 = 3 s');
  // fade=1: any change to the four keeps the entrance whole, and the fade-out takes the rest of the second.
  const f = another(s, { fade: 1, animate: true, enter_ms: 200 });
  f.r.push(chat('bob', 'b'));
  f.r.flush();
  const b = f.lines()[0];
  assert.strictEqual(b.style.animation, 'tco-in 200ms ease-out');
  s.tick(200);
  f.linesEl.dispatch('animationend', { target: b, animationName: 'tco-in' });
  assert.strictEqual(b.style.animation, 'tco-fade 800ms linear 0ms forwards');
  // An entrance as long as the whole stay: the line goes as it ends.
  f.r.setConfig({ fade: 1, animate: true, enter_ms: 1000, enter_style: 'fade' });
  f.r.push(chat('cat', 'c'));
  f.r.flush();
  const c = f.lines()[f.lines().length - 1];
  assert.strictEqual(c.style.animation, 'tco-in-fade 1000ms ease-out');
  s.tick(1000);
  f.linesEl.dispatch('animationend', { target: c, animationName: 'tco-in-fade' });
  assert.strictEqual(c.parentNode, null);
  f.r.destroy();
  // At the defaults, as in 1.5: fade=1 puts both on at once, and a late entrance end starts the fade part-way.
  const d = another(s, { fade: 1, animate: true });
  d.r.push(chat('dan', 'd'));
  d.r.flush();
  assert.strictEqual(d.lines()[0].style.animation, 'tco-in 180ms ease-out, tco-fade 1000ms linear 0ms forwards');
  d.r.setConfig({ fade: 2, animate: true });
  d.r.push(chat('eve', 'e'));
  d.r.flush();
  const e = d.lines()[1];
  assert.strictEqual(e.style.animation, 'tco-in 180ms ease-out');
  s.tick(1100);
  d.linesEl.dispatch('animationend', { target: e, animationName: 'tco-in' });
  assert.strictEqual(e.style.animation, 'tco-fade 1000ms linear -100ms forwards');
  d.r.destroy();
});

test('a line still coming in keeps its entrance when the entrance length, fade-out length or exit changes', (t) => {
  const s = setup(t, { fade: 10, animate: true, enter_ms: 1000, enter_style: 'fade' });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const a = s.lines()[0];
  s.linesEl.dispatch('animationend', { target: a, animationName: 'tco-in-fade' });
  assert.strictEqual(a.style.animation, 'tco-fade 1000ms linear 9000ms forwards');
  s.tick(500);
  s.r.push(chat('bob', 'b'));
  s.r.flush();
  const b = s.lines()[1];
  assert.strictEqual(b.style.animation, 'tco-in-fade 1000ms ease-out');
  s.tick(300);
  // enter_ms is for new lines only: nothing is re-timed.
  s.r.setConfig({ fade: 10, animate: true, enter_ms: 950, enter_style: 'fade' });
  assert.deepStrictEqual([a.style.animation, b.style.animation], ['tco-fade 1000ms linear 9000ms forwards', 'tco-in-fade 1000ms ease-out']);
  // A new fade-out and exit: the line on screen is re-timed; the one coming in takes them as its entrance ends.
  s.r.setConfig({ fade: 10, animate: true, enter_ms: 950, enter_style: 'fade', fade_out_ms: 1250, exit_style: 'slide' });
  assert.strictEqual(a.style.animation, 'tco-out-slide 1250ms linear 7950ms forwards', '800 + 7950 + 1250 = 10 s');
  assert.strictEqual(b.style.animation, 'tco-in-fade 1000ms ease-out');
  s.tick(700);
  s.linesEl.dispatch('animationend', { target: b, animationName: 'tco-in-fade' });
  assert.strictEqual(b.style.animation, 'tco-out-slide 1250ms linear 7750ms forwards', '1000 + 7750 + 1250 = 10 s');
  // fade itself re-times every line, one coming in too, as in 1.5.
  s.r.push(chat('cat', 'c'));
  s.r.flush();
  const c = s.lines()[2];
  assert.strictEqual(c.style.animation, 'tco-in-fade 950ms ease-out');
  s.r.setConfig({ fade: 20, animate: true, enter_ms: 950, enter_style: 'fade', fade_out_ms: 1250, exit_style: 'slide' });
  assert.strictEqual(c.style.animation, 'tco-out-slide 1250ms linear 18750ms forwards');
});

test('fade-out length and exit: lines on screen are re-timed at once, still ending `fade` s after arrival', (t) => {
  const s = setup(t, { fade: 10, animate: false });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const line = s.lines()[0];
  assert.strictEqual(line.style.animation, 'tco-fade 1000ms linear 9000ms forwards');
  s.tick(2000);
  s.r.setConfig({ fade: 10, animate: false, fade_out_ms: 3000 });
  assert.strictEqual(line.style.animation, 'tco-fade 3000ms linear 5000ms forwards');
  s.r.setConfig({ fade: 10, animate: false, fade_out_ms: 3000, exit_style: 'slide' });
  assert.strictEqual(line.style.animation, 'tco-out-slide 3000ms linear 5000ms forwards');
  // The slide's direction follows the layout and the alignment.
  s.r.setConfig({ fade: 10, animate: false, fade_out_ms: 3000, exit_style: 'slide', align: 'top' });
  assert.strictEqual(line.style.animation, 'tco-out-slide-down 3000ms linear 5000ms forwards');
  s.r.setConfig({ fade: 10, animate: false, fade_out_ms: 3000, exit_style: 'slide', align: 'top', layout: 'horizontal' });
  assert.strictEqual(line.style.animation, 'tco-out-slide-x 3000ms linear 5000ms forwards');
  s.r.setConfig({ fade: 10, animate: false, fade_out_ms: 0, exit_style: 'slide', layout: 'horizontal' });
  assert.strictEqual(line.style.animation, 'tco-out-slide-x 0ms linear 8000ms forwards', 'no fade: gone at 10 s');
  // A new line takes them too, entrance or not.
  s.r.push(chat('bob', 'b'));
  s.r.flush();
  assert.strictEqual(s.lines()[1].style.animation, 'tco-out-slide-x 0ms linear 10000ms forwards');
  // The sweep is the backup when no animationend comes: at 10 s, as always.
  s.tick(7999);
  assert.strictEqual(s.lines().length, 2);
  s.tick(1001);
  assert.strictEqual(s.lines().length, 1);
});

test('the animation settings at their defaults change nothing on screen, and without fade they re-time nothing', (t) => {
  const s = setup(t, { animate: true });
  s.r.push(chat('amy', 'a'));
  s.r.flush();
  const line = s.lines()[0];
  assert.strictEqual(line.style.animation, 'tco-in 180ms ease-out');
  let flushes = 0;
  Object.defineProperty(s.linesEl, 'offsetHeight', { get: () => { flushes++; return 0; } });
  // No fade: no fade to re-time, and a new entrance is for new lines only.
  s.r.setConfig({ animate: true, enter_ms: 500, fade_out_ms: 0, exit_style: 'slide', enter_style: 'drop' });
  assert.strictEqual(line.style.animation, 'tco-in 180ms ease-out');
  assert.strictEqual(flushes, 0, 'restartFades never ran');
  // With fade, at the defaults: a layout switch re-times nothing it didn't before (the exit is tco-fade either way).
  const v = another(s, { fade: 30, animate: true });
  v.r.push(chat('bob', 'b'));
  v.r.flush();
  const b = v.lines()[0];
  v.r.setConfig({ fade: 30, animate: true, layout: 'horizontal' });
  assert.strictEqual(b.style.animation, 'tco-in 180ms ease-out');
  v.r.setConfig({ fade: 30, animate: true, layout: 'horizontal', enter_style: 'slide', enter_ms: 180, fade_out_ms: 1000, exit_style: 'fade' });
  assert.strictEqual(b.style.animation, 'tco-in 180ms ease-out', 'the defaults written out are the defaults');
  v.r.destroy();
});

test('hidden, then shown: lines are re-timed from arrival with the fade-out length and exit', (t) => {
  const s = setup(t, { fade: 6, animate: true, enter_style: 'pop', fade_out_ms: 2000, exit_style: 'slide', align: 'top' });
  s.doc.visibilityState = 'hidden';
  s.r.push(chat('amy', 'a'));
  s.tick(1500);
  assert.strictEqual(s.lines().length, 0);
  s.doc.visibilityState = 'visible';
  s.doc.dispatch('visibilitychange');
  assert.strictEqual(s.lines()[0].style.animation, 'tco-out-slide-down 2000ms linear 2500ms forwards', 'no entrance; 1.5 s already passed');
  s.tick(3000);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.strictEqual(s.lines()[0].style.animation, 'tco-out-slide-down 2000ms linear -500ms forwards', 'part-way through the exit');
  s.tick(1500);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.strictEqual(s.lines().length, 0, 'gone 6 s after arrival');
});

test('overlay.css: a keyframes rule for every name the renderer writes, animating opacity and transform only', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const frames = {};
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) frames[m[1]] = m[2];
  assert.deepStrictEqual(Object.keys(frames).sort(), R.ENTER_NAMES.concat(R.EXIT_NAMES).sort());
  Object.keys(frames).forEach((n) => {
    // Opacity and transform run off the main thread; transform-origin (or anything else) would not. scan alone
    // animates clip-path, and says so (README: it costs a little more).
    const props = Array.from(frames[n].matchAll(/([\w-]+):/g), (m) => m[1]);
    props.forEach((p) => assert.ok(p === 'opacity' || p === 'transform' || (/^tco-in-scan/.test(n) && p === 'clip-path'), n + ': ' + p));
    const fadesIn = R.ENTER_NAMES.indexOf(n) >= 0;
    assert.match(frames[n], fadesIn ? /from \{ opacity: 0;/ : /to \{ opacity: 0;/, n);
  });
  // 1.5's three are as they were.
  assert.match(css, /@keyframes tco-in \{\n {2}from \{ opacity: 0; transform: translateY\(\.4em\); \}\n {2}to \{ opacity: 1; transform: none; \}\n\}/);
  assert.match(css, /@keyframes tco-in-x \{\n {2}from \{ opacity: 0; transform: translateX\(\.6em\); \}\n {2}to \{ opacity: 1; transform: none; \}\n\}/);
  assert.match(css, /@keyframes tco-fade \{\n {2}from \{ opacity: 1; \}\n {2}to \{ opacity: 0; \}\n\}/);
  // pop keeps where the text starts: the left end by default, set by text_align's own rules in a column only.
  assert.match(frames['tco-in-pop'], /translateX\(var\(--pop-x, -7\.5%\)\) scale\(\.85\)/);
  assert.deepStrictEqual(Array.from(css.matchAll(/([^{}\n]+)\{[^}]*--pop-x:\s*([^;}]+)/g), (m) => [m[1].trim(), m[2].trim()]), [
    [':where(.layout-vertical.text-center) .lines', '0%'], [':where(.layout-vertical.text-right) .lines', '7.5%']]);
  assert.doesNotMatch(css, /transform-origin/);
});

test('decodeText: A-Z, a-z and digits past keep become random ones of their kind; nothing else changes', () => {
  const chars = Array.from('Ab9 héllo! 😀Z');
  assert.strictEqual(R.decodeText(chars, chars.length, () => 0.5), 'Ab9 héllo! 😀Z');
  const all = R.decodeText(chars, 0, () => 0);
  assert.strictEqual(all, 'Aa0 aéaaa! 😀A');
  assert.strictEqual(Array.from(R.decodeText(chars, 2, () => 0.99)).join(''), 'Ab9 zézzz! 😀Z');
});

test('enter_style=decode: the name and message letters settle over enter_ms, the line fades in, emotes and the rest stay', (t) => {
  const s = setup(t, { animate: true, enter_style: 'decode', enter_ms: 400 });
  s.r.push(chat('Amy42', 'Hello world 123'));
  s.r.flush();
  const line = s.lines()[0];
  const name = line.byClass('name')[0], msg = line.byClass('message')[0];
  assert.strictEqual(line.style.animation, 'tco-in-decode 400ms ease-out');
  // Scrambled at once, keeping the spaces and the length.
  assert.strictEqual(msg.textContent.length, 'Hello world 123'.length);
  assert.strictEqual(msg.textContent.charAt(5), ' ');
  assert.notStrictEqual(name.textContent + msg.textContent, 'Amy42Hello world 123');
  s.tick(200);
  // Half way: the first half of the characters (name first) are settled.
  assert.strictEqual(name.textContent, 'Amy42');
  assert.strictEqual(msg.textContent.slice(0, 4), 'Hell');
  s.tick(240);
  assert.deepStrictEqual([name.textContent, msg.textContent], ['Amy42', 'Hello world 123']);
  // Another style: nothing is scrambled.
  s.r.setConfig({ animate: true, enter_style: 'fade', enter_ms: 400 });
  s.r.push(chat('bob', 'plain'));
  s.r.flush();
  assert.strictEqual(s.lines()[1].byClass('message')[0].textContent, 'plain');
});

test('enter_style=decode: a line removed or destroyed mid-way stops; at most DECODE_MAX lines decode at once', (t) => {
  const s = setup(t, { animate: true, enter_style: 'decode', enter_ms: 1000, max: 50 });
  for (let i = 0; i < R.DECODE_MAX + 3; i++) s.r.push(chat('u' + i, 'message number ' + i));
  s.r.flush();
  const plain = s.lines().filter((l) => /^message number \d+$/.test(l.byClass('message')[0].textContent));
  assert.strictEqual(plain.length, 3, 'the burst past DECODE_MAX only fades in');
  s.tick(R.DECODE_TICK_MS * 3);
  s.r.destroy();
  s.tick(2000); // no timer left to write into the removed lines
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

// A row of lines, newest on the right edge of a W px wide chat; each character is 10 px. W may be a function (a source
// resized later); gap: px between lines (the row's flex gap; 0 by default).
function rowLayout(s, W, gap) {
  const width = typeof W === 'function' ? W : () => W;
  const g = gap || 0;
  const widths = () => s.lines().map((l) => l.textContent.length * 10);
  s.doc.layout = (el) => {
    const cw = width();
    if (el === s.root || el === s.linesEl) return { left: 0, right: cw, width: cw, top: 0, bottom: 50, height: 50 };
    const i = s.lines().indexOf(el);
    if (i < 0) return null;
    const w = widths();
    let right = cw;
    for (let j = w.length - 1; j > i; j--) right -= w[j] + g;
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

// ---------- smooth_scroll: the column's slide ----------

// A column of lines in an H px tall chat (x: a setup or another()), 30 px each (90 for a message starting "tall"),
// newest at the bottom, or at the top with align=top (top: true). .lines' transform is modelled the way the page
// draws it: translateY(n) shifts every line by n until the transition starts, which then takes the line home
// linearly over SLIDE_MS (frozen: never, as in a source that draws no frames). transition 'none' cancels a running
// one at the next style flush (any layout read), if it is still 'none' then; transform 'none' cancels it too; ''
// leaves it running (the initial `transition: all` still covers transform).
// moves: every start offset, in order; sets: every write to transform or transition.
function colLayout(s, x, H, opts) {
  opts = opts || {};
  const hOf = (l) => (/^tall/.test(l.byClass('message').map((m) => m.textContent).join('')) ? 90 : 30);
  let glide = null, transition = '', sets = 0;
  const offset = () => {
    if (!glide) return 0;
    if (glide.at === null || opts.frozen) return glide.n;
    return glide.n * Math.max(0, 1 - (Date.now() - glide.at) / R.SLIDE_MS);
  };
  const moves = [];
  const st = x.linesEl.style;
  Object.defineProperty(st, 'transition', { get: () => transition, set: (v) => { sets++; transition = v; } });
  Object.defineProperty(st, 'transform', {
    get: () => '',
    set: (v) => {
      sets++;
      const m = /^translateY\((-?[\d.]+)px\)$/.exec(v);
      if (m) { glide = { n: Number(m[1]), at: null }; moves.push(v); }
      else if (v === '' && glide && glide.at === null && /^transform /.test(transition)) glide.at = Date.now();
      else if (v !== '' || !glide || glide.at === null) glide = null;
    }
  });
  const prev = s.doc.layout;
  s.doc.layout = (el) => {
    if (transition === 'none' && glide && glide.at !== null) glide = null; // the style flush
    if (el === x.root || el === x.linesEl) return { left: 0, right: 400, width: 400, top: 0, bottom: H, height: H };
    const list = x.lines();
    const i = list.indexOf(el);
    if (i < 0) return prev ? prev(el) : null;
    const hs = list.map(hOf);
    let top = 0;
    if (opts.top) for (let j = 0; j < i; j++) top += hs[j];
    else { top = H - hs[i]; for (let j = i + 1; j < hs.length; j++) top -= hs[j]; }
    top += offset();
    return { left: 0, right: 400, width: 400, top: top, bottom: top + hs[i], height: hs[i] };
  };
  return { moves, transition: () => transition, home: () => glide === null, sets: () => sets };
}
const msgs = (x) => x.lines().map((l) => l.byClass('message').map((m) => m.textContent).join(''));
// Each message in turn into every renderer listed, a flush each, then the clock on by gap ms.
function feed(s, list, texts, gap) {
  texts.forEach((m) => {
    list.forEach((x) => { x.r.push(chat(m, m)); x.r.flush(); });
    s.tick(gap);
  });
}

test('smooth_scroll off (the default): a column reads no layout for a slide and never touches .lines', (t) => {
  const s = setup(t, { animate: true });
  const on = another(s, { animate: true, smooth_scroll: true });
  const off = colLayout(s, s, 300), lay = colLayout(s, on, 300);
  feed(s, [s, on], ['a', 'b', 'c'], 300);
  // One flush with an old line on screen: the trim reads the chat box and the oldest line (in view) and stops.
  let at = s.doc.reads;
  s.r.push(chat('d', 'd'));
  s.r.flush();
  assert.strictEqual(s.doc.reads - at, 2, 'the trim alone, as in 1.5');
  assert.deepStrictEqual([off.moves, off.sets()], [[], 0], 'no transform or transition ever written');
  // With smooth_scroll: the newest old line before and after, the chat height, and the style flush that starts it.
  at = s.doc.reads;
  on.r.push(chat('d', 'd'));
  on.r.flush();
  assert.strictEqual(s.doc.reads - at, 6);
  assert.deepStrictEqual(lay.moves, ['translateY(30px)', 'translateY(30px)', 'translateY(30px)']);
  // Left out of a partial cfg it is off, and animate=0 turns it off too.
  assert.strictEqual(R.glideOf(R.normalizeCfg({})), null);
  assert.strictEqual(R.glideOf(R.normalizeCfg({ smooth_scroll: true, animate: false })), null);
  on.r.destroy();
});

test('smooth_scroll: the old lines start where they were drawn and glide up (down with align=top) over SLIDE_MS', (t) => {
  const s = setup(t);
  [false, true].forEach((top) => {
    const x = another(s, { animate: true, smooth_scroll: true, align: top ? 'top' : 'bottom' });
    const lay = colLayout(s, x, 300, { top: top });
    feed(s, [x], ['a'], 300);
    assert.deepStrictEqual(lay.moves, [], 'the first line has nothing to push');
    const a = x.lines()[0];
    const was = a.getBoundingClientRect().top;
    x.r.push(chat('b', 'tall b'));
    x.r.flush();
    assert.deepStrictEqual(lay.moves, [top ? 'translateY(-90px)' : 'translateY(90px)'], 'the new line\'s height');
    assert.strictEqual(a.getBoundingClientRect().top, was, 'no jump');
    assert.strictEqual(lay.transition(), 'transform ' + R.SLIDE_MS + 'ms ease-out');
    s.tick(R.SLIDE_MS);
    assert.strictEqual(a.getBoundingClientRect().top, top ? 90 : 180, 'home');
    x.r.destroy();
  });
});

test('smooth_scroll: a new line mid-glide carries what was left; after SLIDE_MS nothing carries over', (t) => {
  const s = setup(t);
  [false, true].forEach((top) => {
    const x = another(s, { animate: true, smooth_scroll: true, align: top ? 'top' : 'bottom' });
    const lay = colLayout(s, x, 300, { top: top });
    feed(s, [x], ['a', 'b'], 0);
    s.tick(100); // 18 of the 30 px still to go
    feed(s, [x], ['c'], R.SLIDE_MS);
    feed(s, [x], ['d'], 0);
    const sign = top ? '-' : '';
    assert.deepStrictEqual(lay.moves, ['30px', '48px', '30px'].map((v) => 'translateY(' + sign + v + ')'));
    x.r.destroy();
  });
});

test('smooth_scroll: lines in view at the start of the glide survive the trim; a burst starts one view away at most', (t) => {
  const s = setup(t, { animate: true, smooth_scroll: true });
  const lay = colLayout(s, s, 100);
  feed(s, [s], ['a', 'b', 'c', 'd', 'e'], 300);
  // a ends 20 px above the chat, but the glide that put it there started 30 px lower, where it showed.
  assert.deepStrictEqual(msgs(s), ['a', 'b', 'c', 'd', 'e']);
  feed(s, [s], ['f'], 300);
  assert.deepStrictEqual(msgs(s), ['b', 'c', 'd', 'e', 'f'], 'the next flush trims it');
  s.r.hold(true);
  for (let i = 0; i < 10; i++) s.r.push(chat('g' + i, 'g' + i));
  s.r.hold(false);
  assert.strictEqual(lay.moves[lay.moves.length - 1], 'translateY(100px)', '300 px of new lines start one view down');
  // What shows at the start of that glide (100 px lower): g3, whose bottom is then at 20 px, and the lines below it.
  assert.deepStrictEqual(msgs(s), ['g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9']);
});

test('smooth_scroll with align=top: a line below the chat that showed at the start of the glide stays until the next', (t) => {
  const s = setup(t, { animate: true, smooth_scroll: true, align: 'top' });
  colLayout(s, s, 100, { top: true });
  feed(s, [s], ['a', 'b', 'c', 'd', 'e'], 300);
  // a's top is at 120, below the chat, but the glide started 30 px higher, where it showed.
  assert.deepStrictEqual(msgs(s), ['e', 'd', 'c', 'b', 'a']);
  feed(s, [s], ['f'], 300);
  assert.deepStrictEqual(msgs(s), ['f', 'e', 'd', 'c', 'b']);
});

test('smooth_scroll in a source that draws nothing (flushes from the fallback timer): no pile-up; on show, home', (t) => {
  const s = setup(t, { animate: true, smooth_scroll: true });
  const lay = colLayout(s, s, 300, { frozen: true });
  ['a', 'b0', 'b1', 'b2', 'b3', 'b4'].forEach((m) => { s.r.push(chat(m, m)); s.tick(R.FLUSH_FALLBACK_MS); });
  assert.strictEqual(s.lines().length, 6);
  // FLUSH_FALLBACK_MS >= SLIDE_MS: a glide that was never drawn is over by the next flush, so each starts from home.
  assert.deepStrictEqual(lay.moves, Array(5).fill('translateY(30px)'));
  // Shown again with the last glide long over: it is dropped before a frame can play it.
  s.tick(1000);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.ok(lay.home() && lay.transition() === '', 'cancelled, not left to run, and no inline value left');
  assert.strictEqual(s.lines()[5].getBoundingClientRect().top, 270);
  // Shown while one still runs: it plays on.
  s.r.push(chat('c', 'c'));
  s.tick(R.FLUSH_FALLBACK_MS + 100);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.ok(!lay.home() && /^transform /.test(lay.transition()));
  // A row too (renderer-css round 4; 1.5 left its slide to play on show, sweeping the whole row in from the right): a
  // slide whose time ran out goes home on show, and one still inside its SLIDE_MS plays on.
  const row = another(s, { animate: true, layout: 'horizontal' });
  const moves = rowLayout({ doc: s.doc, root: row.root, linesEl: row.linesEl, lines: row.lines }, 300);
  row.r.push(chat('a', 'x'));
  row.r.flush();
  row.r.push(chat('b', 'y'));
  row.r.flush();
  assert.strictEqual(moves.length, 1);
  assert.match(row.linesEl.style.transition, /^transform /, 'sliding');
  s.tick(1000);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.strictEqual(row.linesEl.style.transition, '', 'stopped, no inline transition left');
  assert.strictEqual(row.linesEl.style.transform, '', 'home');
  row.r.push(chat('c', 'z'));
  row.r.flush();
  assert.strictEqual(moves.length, 2);
  s.tick(100);
  s.doc.defaultView.dispatch('obsSourceVisibleChanged', { detail: { visible: true } });
  assert.match(row.linesEl.style.transition, /^transform /, 'a slide inside its time plays on');
  s.tick(1000);
  s.doc.dispatch('visibilitychange');
  assert.strictEqual(row.linesEl.style.transition, '', 'visibilitychange sends it home too');
  row.r.destroy();
});

test('smooth_scroll: turning it off, flipping align, switching layout, animate off or clearing all sends the lines home', (t) => {
  const s = setup(t, { animate: true, smooth_scroll: true });
  const lay = colLayout(s, s, 300);
  const cfg = { animate: true, smooth_scroll: true };
  feed(s, [s], ['a', 'b'], 300);
  [{ smooth_scroll: false }, { align: 'top' }, { layout: 'horizontal' }, { animate: false }].forEach((over) => {
    s.r.setConfig(cfg);
    s.tick(300);
    feed(s, [s], ['x'], 0);
    assert.ok(!lay.home(), 'gliding');
    s.r.setConfig(Object.assign({}, cfg, over));
    // Home with no inline transition left behind (a default page has none on .lines).
    assert.ok(lay.home() && lay.transition() === '', JSON.stringify(over));
  });
  // Turned on, nothing moves until a new line comes in; turned off again with nothing gliding, nothing is left either.
  s.r.setConfig({ animate: true });
  const n = lay.moves.length;
  s.r.setConfig(cfg);
  assert.ok(lay.home() && lay.moves.length === n);
  s.r.setConfig({ animate: true });
  assert.ok(lay.home() && lay.transition() === '');
  s.r.setConfig(cfg);
  // Cleared (a Twitch /clear) mid-glide: the glide stops, and the next line, with nothing to push, starts in place.
  feed(s, [s], ['y'], 0);
  assert.ok(!lay.home(), 'gliding');
  s.r.clearAll();
  assert.ok(lay.home() && lay.transition() === '', 'clearAll');
  const c = lay.moves.length;
  feed(s, [s], ['w'], 0);
  assert.ok(lay.home() && lay.moves.length === c);
  // A line removed from the middle is no glide: the lines above it close the gap at once.
  const mid = chat('m', 'm');
  s.r.push(mid);
  s.r.flush();
  feed(s, [s], ['z'], 300);
  const k = lay.moves.length;
  s.r.clearMessage(mid.id);
  assert.strictEqual(lay.moves.length, k);
});

// A row (x: another()) W px wide, each line 10 px per character, its slide modelled as colLayout's glide: translateX(n)
// until the transition starts, then home over SLIDE_MS; transition 'none' cancels a running one at the next style flush
// (any layout read), transform 'none' at once, and '' leaves it running.
function rowGlide(s, x, W) {
  let glide = null, transition = '';
  const st = x.linesEl.style;
  Object.defineProperty(st, 'transition', { get: () => transition, set: (v) => { transition = v; } });
  Object.defineProperty(st, 'transform', {
    get: () => '',
    set: (v) => {
      const m = /^translateX\((-?[\d.]+)px\)$/.exec(v);
      if (m) glide = { n: Number(m[1]), at: null };
      else if (v === '' && glide && glide.at === null && /^transform /.test(transition)) glide.at = Date.now();
      else if (v !== '' || !glide || glide.at === null) glide = null;
    }
  });
  s.doc.layout = (el) => {
    if (transition === 'none' && glide && glide.at !== null) glide = null; // the style flush
    if (el === x.root || el === x.linesEl) return { left: 0, right: W, width: W, top: 0, bottom: 50, height: 50 };
    const list = x.lines();
    const i = list.indexOf(el);
    if (i < 0) return null;
    const w = list.map((l) => l.textContent.length * 10);
    let right = W;
    for (let j = w.length - 1; j > i; j--) right -= w[j];
    return { left: right - w[i], right: right, width: w[i], top: 0, bottom: 50, height: 50 };
  };
  return { transition: () => transition, home: () => glide === null };
}

test('a row\'s slide stops where it is on a live switch to a column, animate off or clearing all; other changes leave it', (t) => {
  const s = setup(t);
  const row = { animate: true, layout: 'horizontal' };
  [{ layout: 'vertical' }, { layout: 'vertical', smooth_scroll: true }, { animate: false }, 'clearAll', { text_color: 'ff0000' },
    { align: 'top' }].forEach((over) => {
    const x = another(s, row);
    const lay = rowGlide(s, x, 300);
    x.r.push(chat('a', 'x'.repeat(7)));
    x.r.flush();
    s.tick(300);
    x.r.push(chat('b', 'y'.repeat(7)));
    x.r.flush();
    assert.ok(!lay.home() && /^transform /.test(lay.transition()), JSON.stringify(over) + ': sliding');
    s.tick(50);
    if (over === 'clearAll') x.r.clearAll();
    else x.r.setConfig(Object.assign({}, row, over));
    if (over.text_color || over.align) assert.ok(!lay.home(), JSON.stringify(over) + ': the slide plays on');
    else assert.ok(lay.home() && lay.transition() === '', JSON.stringify(over) + ': home, no inline transition left');
    x.r.destroy();
  });
});

test('smooth_scroll leaves the lines\' own entrances and fades exactly as they are without it', (t) => {
  const s = setup(t);
  const cfg = { animate: true, fade: 30, enter_style: 'pop', fade_out_ms: 2000 };
  const a = another(s, cfg), b = another(s, Object.assign({ smooth_scroll: true }, cfg));
  colLayout(s, a, 300);
  const lay = colLayout(s, b, 300);
  const anims = (x) => x.lines().map((l) => l.style.animation);
  feed(s, [a, b], ['p', 'q', 'r'], 50);
  assert.strictEqual(lay.moves.length, 2);
  assert.deepStrictEqual(anims(b), anims(a));
  [a, b].forEach((x) => x.r.setConfig(Object.assign({}, cfg, { smooth_scroll: x === b, fade_out_ms: 500 })));
  [a, b].forEach((x) => x.lines().forEach((l) => x.linesEl.dispatch('animationend', { target: l, animationName: 'tco-in-pop' })));
  assert.deepStrictEqual(anims(b), anims(a), 'the fade after the entrance');
  assert.match(anims(b)[0], /^tco-fade 500ms linear /);
  [a, b].forEach((x) => x.r.setConfig(Object.assign({}, cfg, { smooth_scroll: x === b, fade: 20 })));
  assert.deepStrictEqual(anims(b), anims(a), 're-timed');
  [a, b].forEach((x) => x.r.destroy());
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

test('gifs: a big GIF\'s original WebP falls back to the 200 px file, then to the tag\'s URL, then to the title', (t) => {
  const s = setup(t, { gifs: true, text_px: 96 }, { tokensFor: () => [{ type: 'gif', url: 'https://media.giphy.com/media/a/200.webp',
    orig: 'https://media.giphy.com/media/a/giphy.gif', title: 'party', sp: false }] });
  s.r.push(chat('amy', 'g'));
  s.r.flush();
  const img = s.lines()[0].byClass('gif')[0];
  assert.strictEqual(img.src, 'https://media.giphy.com/media/a/giphy.webp');
  img.onerror();
  assert.strictEqual(img.src, 'https://media.giphy.com/media/a/200.webp');
  img.onerror();
  assert.strictEqual(img.src, 'https://media.giphy.com/media/a/giphy.gif');
  img.onerror();
  assert.strictEqual(s.lines()[0].byClass('message')[0].textContent, 'party');
  // Back to a size the 200 px file covers: the line is drawn with it again.
  s.r.setConfig({ gifs: true, text_px: 24 });
  assert.strictEqual(s.lines()[0].byClass('gif')[0].src, 'https://media.giphy.com/media/a/200.webp');
});

test('gifs: a live gif_size change redraws a GIF already shown from the file that size needs, and back', (t) => {
  const tok = () => [{ type: 'gif', url: 'https://media.giphy.com/media/a/200.webp', orig: 'https://media.giphy.com/media/a/giphy.gif',
    title: 'party', sp: false }];
  // 40 px text: an emote is 70 px tall, so a GIF is 140 px at 2x (the 200 px file) and 210 px at 3x (the original).
  const s = setup(t, { gifs: true, text_px: 40, gif_size: '2x' }, { tokensFor: tok });
  s.r.push(chat('amy', 'g'));
  s.r.flush();
  const src = () => s.lines().map((l) => l.byClass('gif')[0].src);
  assert.deepStrictEqual(src(), ['https://media.giphy.com/media/a/200.webp']);
  s.r.setConfig({ gifs: true, text_px: 40, gif_size: '3x' });
  s.r.push(chat('bob', 'g'));
  s.r.flush();
  assert.deepStrictEqual(src(), ['https://media.giphy.com/media/a/giphy.webp', 'https://media.giphy.com/media/a/giphy.webp'],
    'the line shown before the change and a new one alike');
  s.r.setConfig({ gifs: true, text_px: 40, gif_size: '1x' });
  assert.deepStrictEqual(src(), ['https://media.giphy.com/media/a/200.webp', 'https://media.giphy.com/media/a/200.webp']);
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

// A v3 paint's still frame is found after the paint is drawn (overlay.js asks 7TV's CDN): the renderer cached "none" for
// good on the first answer, so the paint kept animating.
test('paint_images=static: a still frame not known yet (undefined) is asked again, and goes in at once when found', (t) => {
  const still = { P1: undefined, P2: undefined };
  const s = setup(t, { paint_images: 'static' }, {
    nameFor: (m) => ({ text: m.displayName, color: '#FFFFFF', paintId: m.login === 'amy' ? 'P1' : 'P2' }),
    paintRule: (id) => '.painted.p-' + id + '{background-image:url("https://cdn.7tv.app/' + id + '")}',
    paintStaticRule: (id) => still[id]
  });
  const sheet = () => s.doc.head.children.find((e) => e.getAttribute('data-tco') === 'paints').sheet.cssRules.slice();
  s.r.push(chat('amy', '1'));
  s.r.push(chat('bo', '2'));
  s.r.flush();
  assert.strictEqual(sheet().length, 2, 'the paints, no still rule yet');
  const rule = '.paint-static .painted.p-P1{background-image:url("https://cdn.7tv.app/P1/1x_static.webp")}';
  still.P1 = rule;
  s.r.stillReady('P1');
  assert.deepStrictEqual(sheet().slice(2), [rule], 'found: in at once, for the line already drawn');
  s.r.stillReady('P1');
  // P2 has none after all (null): cached, and asked no more.
  still.P2 = null;
  s.r.rerender(() => true);
  s.r.setConfig({ paint_images: 'static', size: 'large' });
  still.P2 = '.paint-static .painted.p-P2{background-image:url("https://cdn.7tv.app/late")}';
  s.r.rerender(() => true);
  s.r.stillReady('P2');
  assert.deepStrictEqual(sheet().slice(2), [rule]);
  // Not while paint_images is animated, and not for a paint not drawn.
  s.r.setConfig({});
  still.P3 = '.paint-static .painted.p-P3{background-image:url("https://cdn.7tv.app/x")}';
  s.r.stillReady('P3');
  assert.strictEqual(sheet().length, 3);
});

// 7TV's paint images are 32 px tall at 1x, and every paint rule used that file: a name drawn at text_px=96 (116 px tall)
// stretched it 3.6 times, blurry. The renderer asks for the file for the name's drawn size, as for emotes and badges.
test('paintScale: the 7TV paint file (1x to 4x) for a name\'s drawn height; medium and large keep 1x in OBS', () => {
  const cases = [[24, 1, 1], [18, 1, 1], [32, 1, 1], [33, 1, 1], [34, 1, 2], [40, 1, 2], [60, 1, 2], [66, 1, 2], [67, 1, 3],
    [96, 1, 3], [8, 1, 1], [24, 2, 2], [32, 2, 2], [96, 2, 4], [24, 3, 3], [24, 0, 1], [24, undefined, 1]];
  cases.forEach(([px, dpr, want]) => assert.strictEqual(R.paintScale(px, dpr), want, px + ' px at ' + dpr));
});

test('paints: each rule is made for the name\'s drawn size, and made again in place when that size changes', (t) => {
  const asked = [];
  const deps = {
    nameFor: (m) => ({ text: m.displayName, color: '#FFFFFF', paintId: m.login === 'cy' ? 'P2' : m.login === 'dee' ? 'P3' : 'P1' }),
    paintRule: (id, scale) => {
      asked.push(id + '@' + scale);
      return '.painted.p-' + id + '{background-image:url("https://cdn.7tv.app/' + id + '/' + scale + 'x.webp")}';
    },
    paintStaticRule: (id, scale) => id === 'P2' ? null
      : '.paint-static .painted.p-' + id + '{background-image:url("https://cdn.7tv.app/' + id + '/' + scale + 'x_static.webp")}'
  };
  const s = setup(t, {}, deps);
  const sheet = () => s.doc.head.children.filter((e) => e.getAttribute('data-tco') === 'paints')
    .map((e) => e.sheet.cssRules.slice());
  const rules = (sc, still) => ['.painted.p-P2{background-image:url("https://cdn.7tv.app/P2/' + sc + 'x.webp")}',
    '.painted.p-P1{background-image:url("https://cdn.7tv.app/P1/' + sc + 'x.webp")}'].concat(still
    ? ['.paint-static .painted.p-P1{background-image:url("https://cdn.7tv.app/P1/' + sc + 'x_static.webp")}'] : []);
  s.r.push(chat('amy', '1'));
  s.r.push(chat('cy', '2'));
  s.r.flush();
  const names = () => s.lines().map((l) => l.byClass('name')[0].className);
  assert.deepStrictEqual(sheet(), [rules(1)], 'medium: the 1x files, as always');
  s.r.setConfig({ size: 'large' });
  assert.deepStrictEqual(sheet(), [rules(1)], 'large: still 1x, nothing made again');
  assert.deepStrictEqual(asked, ['P2@1', 'P1@1']);
  s.r.setConfig({ text_px: 96, paint_images: 'static' });
  assert.deepStrictEqual(sheet(), [rules(3, true)], 'text_px=96: 3x, in the same <style>, one rule per paint');
  assert.deepStrictEqual(names(), ['name painted p-P1', 'name painted p-P2'], 'the names keep their classes');
  s.r.setConfig({ text_px: 60, paint_images: 'static' });
  assert.deepStrictEqual(sheet(), [rules(2, true)]);
  s.r.setConfig({});
  assert.deepStrictEqual(sheet(), [rules(1)], 'back to medium and animated');
  assert.strictEqual(s.r.stats().paints, 2);
  // A paint first seen at a size gets that size's file.
  s.r.setConfig({ text_px: 96 });
  s.r.push(chat('dee', '3'));
  s.r.flush();
  assert.deepStrictEqual(sheet(), [rules(3).concat(['.painted.p-P3{background-image:url("https://cdn.7tv.app/P3/3x.webp")}'])]);
});

test('paints: a HiDPI page (the builder preview) asks for the file for its pixel ratio', (t) => {
  const s = setup(t, {}, {
    nameFor: (m) => ({ text: m.displayName, color: '#FFFFFF', paintId: 'P1' }),
    paintRule: (id, scale) => '.painted.p-' + id + '{background-image:url("https://cdn.7tv.app/' + scale + 'x.webp")}'
  }, { dpr: 2 });
  s.r.push(chat('amy', '1'));
  s.r.flush();
  const st = s.doc.head.children.find((e) => e.getAttribute('data-tco') === 'paints');
  assert.deepStrictEqual(st.sheet.cssRules.slice(), ['.painted.p-P1{background-image:url("https://cdn.7tv.app/2x.webp")}']);
});

// The Kick chatroom the overlay found it had wrongly joined: its lines go, but nothing was moderated.
test('drop: the lines a predicate picks go, queued or shown, without noting a clear or a deletion', (t) => {
  const s = setup(t, { max: 20 });
  const isKick = (m) => m.platform === 'kick';
  const kk = chat('kk', 'wrong room', { platform: 'kick', id: 'kick:1', userId: 'kick:9' });
  s.r.push(chat('tw', 'twitch'));
  s.r.push(kk);
  s.r.flush();
  s.r.hold(true);
  s.r.push(chat('k2', 'queued', { platform: 'kick', id: 'kick:2', userId: 'kick:8' }));
  s.r.drop(isKick);
  s.r.hold(false);
  assert.deepStrictEqual(s.texts(), ['twitch']);
  // A reply quoting a Kick message the overlay never saw keeps its header (a clear would have taken it), and the dropped id
  // is not refused as deleted.
  s.r.push(Object.assign(replyTo({ id: 'kick:0', userId: 'kick:7', login: 'old', displayName: 'old', text: 'older kick' }, 'ann', 'kick reply'),
    { platform: 'kick', id: 'kick:3', userId: 'kick:6' }));
  assert.strictEqual(s.r.push(Object.assign({}, kk)), true);
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['twitch', 'kick reply', 'wrong room']);
  assert.strictEqual(replyText(s.lines()[1]), '↪ @old: older kick');
});

// History older than the lines shown is noted, not shown: a reply to it after a /clear or its author's timeout from before
// it keeps its header.
test('note: a message noted but not shown counts as said, after a clear and after its author\'s timeout', (t) => {
  const s = setup(t, { max: 20 });
  s.r.clearAll();
  const after = chat('bob', 'said after the clear');
  const unseen = chat('cy', 'never noted');
  s.r.note(after);
  s.r.clearUser('u-sam');
  const sam = chat('sam', 'back again');
  s.r.note(sam);
  [after, unseen, sam].forEach((m) => s.r.push(replyTo(m, 'amy', 're ' + m.login)));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['re bob', 're cy', 're sam'], 'noted messages are not shown');
  assert.deepStrictEqual(s.lines().map(replyText), ['↪ @bob: said after the clear', null, '↪ @sam: back again']);
});

// removeLine measured the row (two layout reads) for every line a trim, the max cap or a clear took from a row with marks,
// each after the last one's removal had dirtied the layout: ~150 ms for a 200-line backlog. Now once per batch.
test('row_sep: a backlog trimmed from a row with marks is measured once, not once per line; the marks come out the same', (t) => {
  const run = (sep) => {
    const s = setup(t, { layout: 'horizontal', animate: false, row_sep: sep, max: 200 });
    rowLayout(s, 300);
    s.r.hold(true);
    for (let i = 0; i < 200; i++) s.r.push(chat('a', 'x'.repeat(7))); // 100 px each: three fit
    const before = s.doc.reads;
    s.r.hold(false);
    const out = { reads: s.doc.reads - before, classes: s.lines().map((l) => l.className) };
    s.r.destroy();
    t.mock.timers.reset();
    return out;
  };
  const none = run('none'), dot = run('dot');
  assert.deepStrictEqual(none.classes, ['line', 'line', 'line']);
  assert.deepStrictEqual(dot.classes, ['line keep-sep', 'line', 'line'], 'the first line left keeps its mark');
  // The trim's one measurement (the row and its last victim) and dropLoneSep's check of the kept mark: 5, not 2 per line.
  assert.ok(dot.reads - none.reads <= 6, 'reads: ' + dot.reads + ' with marks, ' + none.reads + ' without');
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
  const hl = css.indexOf('\n.line.highlight {'), hlAccent = css.indexOf('\n.line.highlight:where(.accent, .first-msg, .role-bar) { padding-left: .4em; }');
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
  // A reply header quoting right-to-left text is a flex box (renderer-css round 3): it moves its parts as text-align does.
  assert.deepStrictEqual(selectors.filter((s) => /text-(?:center|right)/.test(s)), [
    ':where(.layout-vertical.text-center) .lines', ':where(.layout-vertical.text-right) .lines',
    '.text-center:where(.layout-vertical.has-bg, .layout-vertical.has-maxw) .line',
    '.text-right:where(.layout-vertical.has-bg, .layout-vertical.has-maxw) .line',
    ':where(.layout-vertical.text-center) .reply.rtl', ':where(.layout-vertical.text-right) .reply.rtl']);
  assert.match(css, /\n:where\(\.layout-vertical\.text-center\) \.reply\.rtl \{ justify-content: center; \}/);
  assert.match(css, /\n:where\(\.layout-vertical\.text-right\) \.reply\.rtl \{ justify-content: flex-end; \}/);
  assert.match(css, /\n\.text-center:where\([^)]*\) \.line \{ margin-left: auto; margin-right: auto; \}/);
  assert.match(css, /\n\.text-right:where\([^)]*\) \.line \{ margin-left: auto; \}/);
  assert.ok(at('.text-right:where(') > at('.has-bg .line {'), 'after the box\'s own margin, which it overrides at (0,2,0)');
  // line_width: class-only (0,2,0), after the row's rules it beats on order; notices get their own em's cap.
  assert.match(css, /\n\.has-maxw \.line \{ box-sizing: border-box; max-width: min\(100%, var\(--line-max, 100%\)\); \}/);
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
  // row_sep: in a row only, a fixed glyph per class in the text color, and an empty badge holder shown to carry it. In a
  // row along the bottom it is never on .line::before (beside a reply's block header it would take a row of its own); in
  // one along the top, where the header sits before its message on the same row (renderer-css round 3), the line itself
  // carries it, before the header, and its children never do.
  // A line after another, or one that keeps its mark after the line before it left out of view (.keep-sep, renderer-css
  // round 1), in :is() at the specificity of .line + .line. A notice's mark is the row's size (--row-em, on #chat).
  // name_line's own rules in a row (1.6.1: its marks, the space after them) have a test of their own (below).
  const seps = selectors.filter((s) => /sep-/.test(s) && !/name-line|^@property/.test(s));
  assert.ok(seps.length >= 5);
  let tops = 0, bottoms = 0;
  seps.forEach((s) => s.split(/,\s*(?=:where)/).forEach((one) => {
    assert.match(one, /^:where\(\.layout-horizontal(?:\)|\.|:not\(\.has-bg\)\))/, one);
    if (one === ':where(.layout-horizontal):where(.sep-dot, .sep-bar, .sep-diamond)') return; // --row-em
    if (/^:where\(\.layout-horizontal\.sep-(?:dot|bar|diamond)\)$/.test(one)) return; // --sep-w (renderer-css round 2)
    const edge = /^:where\(\.layout-horizontal\.align-(bottom|top)[.:)]/.exec(one);
    // A line with a bar or a tint, without a box: its mark before the bar and outside the tint (renderer-css round 2).
    const dec = /^:where\(\.layout-horizontal(?:\.align-(?:bottom|top))?:not\(\.has-bg\)\):where\(\.sep-dot, \.sep-bar, \.sep-diamond\) :is\(\.line \+ \.line, \.line\.keep-sep\):where\(([^)]*)\)( > \.reply \+ \*::before| > :first-child:not\(\.reply\)::before|::before)?$/.exec(one);
    if (dec) {
      const decos = ['.accent', '.first-msg', '.role-bar', '.announcement', '.highlight', '.mention', '.keyword', '.user-hl', '.role-tint'];
      assert.ok(dec[1].split(', ').every((c) => decos.indexOf(c) >= 0), one);
      // The line's own rules (border, padding) in both rows; the mark's on a child along the bottom, on the line along the top.
      assert.strictEqual(edge ? edge[1] : '', !dec[2] ? '' : dec[2] === '::before' ? 'top' : 'bottom', one);
      return;
    }
    // (.time: a time that carries the mark, stage 6.)
    const m = / :is\(\.line \+ \.line, \.line\.keep-sep\)(?:\.notice > :first-child::before| > (?:\.reply \+ \*::before|:first-child:not\(\.reply\)::before|\.badges:empty|\.reply \+ \.time::before|\.time:first-child::before)|(?:\.notice)?::before)$/.exec(one);
    assert.ok(m, one);
    assert.ok(edge, 'a row along the bottom or the top: ' + one);
    assert.strictEqual(edge[1], /:is\(\.line \+ \.line, \.line\.keep-sep\)(?:\.notice)?::before$/.test(one) ? 'top' : 'bottom', one);
    if (edge[1] === 'top') tops++; else bottoms++;
  }));
  assert.ok(tops >= 5 && bottoms >= 10, tops + ' ' + bottoms);
  assert.doesNotMatch(css, /\.line::before|\.line \+ \.line::before/);
  [['sep-dot', '\'\\2022\''], ['sep-bar', '\'|\''], ['sep-diamond', '\'\\25C6\'']].forEach(([c, glyph]) =>
    assert.ok(css.indexOf(':where(.layout-horizontal.align-bottom.' + c + ') :is(.line + .line, .line.keep-sep) > :first-child:not(.reply)::before,\n' +
      ':where(.layout-horizontal.align-top.' + c + ') :is(.line + .line, .line.keep-sep)::before { content: ' + glyph + '; }') > 0, c));
  assert.match(css, /::before \{\s*margin-right: \.5em;\s*color: var\(--text-color, #fff\);\s*opacity: \.6;\s*\}/);
  // Without a box the row's gap is before the mark, so the same gap goes after it (same specificity, later).
  const after = ':where(.layout-horizontal.align-top:not(.has-bg)):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep)::before {\n  margin-right: var(--row-gap, 1em);\n}';
  assert.ok(css.indexOf(after) > at(':where(.layout-horizontal.align-bottom):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep) > .reply + *::before,'));
  assert.match(css, /:is\(\.line \+ \.line, \.line\.keep-sep\) > \.badges:empty \{ display: inline; \}/);
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
  // name_line: never a notice, and in a column the message stays where a left-to-right line puts it (a row's cards, 1.6.1,
  // have a test of their own). The colon goes in either layout.
  // names=0 cancels it (the builder greys it out then), so badges never sit on a row of their own.
  assert.match(css, /:where\(\.layout-vertical\.name-line:not\(\.no-names\) \.line:not\(\.notice\)\) \.message \{\s*display: block;\s*text-align: left;\s*text-align: -webkit-match-parent;\s*\}/);
  assert.match(css, /\n:where\(\.name-line:not\(\.no-names\) \.line:not\(\.notice\)\) \.colon \{ display: none; \}/);
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
  // At 1x an emote's margins in a column: -.3em .05em at the usual emote size, and like an emote taller than its line
  // with emote_scale above 100 (never above the line, at most .2em below it), at a line_height below 135 and at
  // spacing=tight (--emote-hang), in a box (--emote-drop, follow-up round 1) and below line_height 120 (--emote-floor,
  // the same): the stylesheet's emote rule, with --emote-h for --eh.
  const room = 'var(--emote-hang, .3em), 2.05em - var(--emote-h, 1.75em), (2 * var(--line-height, 1.35) - .65) * 1em - var(--emote-h, 1.75em)';
  // With those .05em sides a GIF wider than its line is capped at the line less them (--gif-maxw; renderer-css round 3:
  // max-width: 100% put its end .05em past the line's), as .cheer-img is; 2x and 3x keep the stylesheet's 100%.
  assert.deepStrictEqual(['1x', '2x', '3x'].map((v) => one('gif_size', v)),
    [{ '--gif-mul': '1', '--gif-margin': 'calc(-1 * max(0em, min(.3em, var(--emote-drop, .3em), ' + room + '))) .05em ' +
      'calc(-1 * max(min(.2em, var(--emote-hang, .3em), var(--emote-floor, .2em)), min(var(--emote-drop, .3em), ' + room + ')))',
    '--gif-maxw': 'calc(100% - .1em)' },
    { '--gif-mul': '2' }, {}]);
  const emoteRule = /\n:where\(\.layout-vertical, \.layout-horizontal\) \.emote-stack \{\s*margin-top: ([^;]+);\s*margin-bottom: ([^;]+);/.exec(overlayCss());
  assert.ok(emoteRule, 'the emote rule');
  const flat = (x) => x.replace(/\s+/g, ' ').split('var(--eh)').join('var(--emote-h, 1.75em)');
  assert.strictEqual(flat(emoteRule[1]) + ' .05em ' + flat(emoteRule[2]), one('gif_size', '1x')['--gif-margin'], 'the same margins as an emote');
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
  // Its width capped at the line (100%), or at 1x the line less its .05em sides (--gif-maxw).
  assert.match(gif, /\n  max-width: var\(--gif-maxw, 100%\);/);
  const row = /\n\.layout-horizontal \.gif \{([^}]*)\}/.exec(css)[1];
  assert.match(row, /height: var\(--emote-h, 1\.75em\);[\s\S]*max-height: var\(--emote-h, 1\.75em\);[\s\S]*margin: calc\(/);
  // emote_only: only .emote-only lines, never a gigantified emote (.big keeps its 3x), at (0,2,0) like .emote-stack.big.
  const eo = Array.from(css.matchAll(/([^{}]+)\{[^}]*var\(--eo/g), (m) => m[1].trim());
  assert.deepStrictEqual(eo, [':where(.line.emote-only) .emote-stack:not(.big)']);
  assert.match(css, /\n:where\(\.line\.emote-only\) \.emote-stack:not\(\.big\) \{ --eh: calc\(var\(--emote-h, 1\.75em\) \* var\(--eo, 2\)\); \}/);
  // An emote wider than its line, on any line (renderer-css round 1: not only an emote-only one), is fitted to it,
  // letterboxed in its box; a w! emote (its width set inline) still stretches to fill its box.
  const caps = Array.from(css.matchAll(/([^{}]+)\{[^}]*max-width: 100%/g), (m) => m[1].trim())
    .filter((s) => /\.emote(?![\w-])/.test(s));
  assert.deepStrictEqual(caps, ['.emote-stack > .emote']);
  const img = /\n\.emote-stack > \.emote \{([^}]*)\}/.exec(css)[1];
  assert.match(img, /\n  max-width: 100%;\n  object-fit: contain;\n$/);
  assert.ok(css.indexOf('\n.emote-stack > .emote[style] { object-fit: fill; }') > css.indexOf('\n.emote-stack > .emote {'), 'w! after');
  assert.doesNotMatch(css, /\.emote-only\) \.emote-stack:not\(\.big\) > \.emote/);
  assert.match(css, /\n\.emote-stack\.big \{ --eh: calc\(var\(--emote-h, 1\.75em\) \* 3\); \}/);
  assert.match(css, /\n\.layout-horizontal \.emote-stack\.big \{ --eh: var\(--emote-h, 1\.75em\); \}/);
  // emote_scale is --emote-h, which every emote, cheer and GIF size already reads.
  assert.match(css, /\n\.emote-stack \{\n  --eh: var\(--emote-h, 1\.75em\);/);
  assert.match(css, /\n\.cheer-img \{\n  height: var\(--emote-h, 1\.75em\);/);
  // No new rule starts with #chat.
  ['emote-only', '--badge-h', '--gif-mul', '--eo'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

// ---------- names, timestamps and the reply header (stage 6) ----------

// Each child of a line as 'tag.class' (text nodes as their text), and the line's text.
function shape(line) {
  return line.childNodes.map((n) => (n.nodeType === 1 ? n.tagName.toLowerCase() + '.' + n.className : JSON.stringify(n.textContent)));
}

test('timestamps: a .time span after the reply header and before the badges, before a notice\'s text; gone again when off', (t) => {
  const ts = new Date(2026, 0, 1, 15, 7).getTime();
  const s = setup(t, { timestamps: '24h' }, {
    badgesFor: (m) => [{ provider: 'platform', icon: 'twitch', title: 'Twitch' }],
    nameFor: (m) => ({ text: m.displayName, color: '#1E90FF' })
  });
  const parent = chat('amy', 'first', { ts: ts });
  s.r.push(parent);
  s.r.push(replyTo(parent, 'bob', 'answer'));
  s.r.push(resub('cy', 'still here', { ts: ts }));
  s.r.push(resub('dee', 'no notice text', { ts: ts, systemMsg: '' }));
  s.r.push(chat('ed', 'no ts'));
  s.r.flush();
  const lines = s.lines();
  assert.deepStrictEqual(shape(lines[0]), ['span.time', 'span.badges', 'span.name', 'span.colon', 'span.message']);
  assert.strictEqual(lines[0].byClass('time')[0].textContent, '15:07');
  // The reply line has no ts of its own here: the header, then no time.
  assert.deepStrictEqual(shape(lines[1]), ['div.reply', 'span.badges', 'span.name', 'span.colon', 'span.message']);
  // A notice: its time, its platform icon, its text; the user's own line under it shows none.
  assert.deepStrictEqual(shape(lines[2]), ['span.time', 'span.badges', 'span.message']);
  assert.strictEqual(lines[2].className, 'line notice');
  assert.deepStrictEqual(shape(lines[3]), ['span.badges', 'span.name', 'span.colon', 'span.message']);
  // A notice with no text of its own isn't drawn, so the user's line carries the time.
  assert.deepStrictEqual(shape(lines[4]).slice(0, 2), ['span.time', 'span.badges']);
  assert.deepStrictEqual(shape(lines[5])[0], 'span.badges', 'no ts: no time, never the time now');
  const withTime = s.lines().map((l) => l.byClass('time').length);
  s.r.setConfig({ timestamps: '12h' });
  assert.strictEqual(lines[0].byClass('time')[0].textContent, '3:07');
  assert.deepStrictEqual(s.lines().map((l) => l.byClass('time').length), withTime);
  s.r.setConfig({});
  assert.deepStrictEqual(s.lines().map((l) => l.byClass('time').length), [0, 0, 0, 0, 0, 0]);
  // A reply with its own ts: the time after the header.
  s.r.setConfig({ timestamps: '24h' });
  s.r.push(chat('fay', 'x', { ts: ts, reply: { id: parent.id, userId: parent.userId, login: 'amy', name: 'amy', body: 'first' } }));
  s.r.flush();
  assert.deepStrictEqual(shape(s.lines()[s.lines().length - 1]), ['div.reply', 'span.time', 'span.badges', 'span.name', 'span.colon', 'span.message']);
});

test('timestamps: a resub\'s own line takes the time once its notice is swept (events off live), and keeps it', (t) => {
  const ts = new Date(2026, 0, 1, 15, 7).getTime();
  let events = true;
  const s = setup(t, { timestamps: '24h' }, { shouldShow: (m) => events || (m.kind !== 'notice' && !m.announcement) });
  s.r.push(resub('cy', 'six months', { ts: ts }));
  s.r.push(chat('amy', 'hi', { ts: ts }));
  s.r.flush();
  const times = () => s.lines().map((l) => (l.byClass('time')[0] || { textContent: '' }).textContent);
  assert.deepStrictEqual(times(), ['15:07', '', '15:07'], 'the notice carries it');
  const own = s.lines()[1];
  events = false;
  s.r.setConfig({ timestamps: '24h', events: false });
  assert.deepStrictEqual([s.lines().length, s.lines()[0], times()], [2, own, ['15:07', '15:07']]);
  // Back on: the swept notice doesn't return, so the line keeps the time, through any later rebuild.
  events = true;
  s.r.setConfig({ timestamps: '24h' });
  s.r.setConfig({ timestamps: '24h', name_sep: 'dash' });
  assert.deepStrictEqual(times(), ['15:07', '15:07']);
  // Timestamps off and on again: the same.
  s.r.setConfig({});
  s.r.setConfig({ timestamps: '12h' });
  assert.deepStrictEqual(times(), ['3:07', '3:07']);
  // A notice that is still drawn keeps its line's time to itself, after a rebuild too.
  s.r.push(resub('dee', 'one year', { ts: ts }));
  s.r.flush();
  s.r.setConfig({ timestamps: '24h' });
  assert.deepStrictEqual(times(), ['15:07', '15:07', '15:07', '']);
});

test('reply_style=name: "↪ @user" alone, live; an empty quoted message still reads "↪ @user: " in full', (t) => {
  const s = setup(t, {});
  const parent = chat('amy', 'the question');
  s.r.push(parent);
  s.r.push(replyTo(parent, 'bob', 'the answer'));
  s.r.push(chat('cy', 'empty', { reply: { id: 'p0', login: 'dee', name: 'dee', body: '' } }));
  s.r.flush();
  assert.deepStrictEqual(s.lines().map(replyText), [null, '↪ @amy: the question', '↪ @dee: ']);
  const header = s.lines()[1].byClass('reply')[0];
  assert.deepStrictEqual(shape(header), ['"↪ "', 'span.reply-name', '": "', 'span.reply-body']);
  s.r.setConfig({ reply_style: 'name' });
  assert.deepStrictEqual(s.lines().map(replyText), [null, '↪ @amy', '↪ @dee']);
  assert.deepStrictEqual(shape(s.lines()[1].byClass('reply')[0]), ['"↪ "', 'span.reply-name']);
  s.r.setConfig({ reply_style: 'name', replies: false });
  assert.deepStrictEqual(s.lines().map(replyText), [null, null, null]);
  s.r.setConfig({});
  assert.deepStrictEqual(s.lines().map(replyText), [null, '↪ @amy: the question', '↪ @dee: ']);
});

// renderer-css round 3: an ellipsis in a left-to-right box cut right-to-left text at its start, so a reply quoting Arabic or
// Hebrew showed its last words, and so did a long one in a row. Such a quote's header, and a row's line with such a
// message, get .rtl (the stylesheet gives the text a box of its own); left-to-right ones keep today's DOM.
test('right-to-left: a quote that starts right to left makes its header .rtl; a row\'s message makes its line .rtl, live', (t) => {
  const s = setup(t, {});
  s.r.push(chat('amy', 'مرحبا بالجميع', { reply: { id: 'p1', login: 'dee', name: 'dee', body: 'שלום עולם' } }));
  s.r.push(chat('bob', 'hello there', { reply: { id: 'p2', login: 'eve', name: 'eve', body: 'hi مرحبا' } }));
  s.r.push(chat('cy', '123 שלום'));
  s.r.flush();
  const state = () => s.lines().map((l) => [l.className, (l.byClass('reply')[0] || {}).className || null]);
  assert.deepStrictEqual(state(), [['line', 'reply rtl'], ['line', 'reply'], ['line', null]], 'a column wraps its messages');
  assert.deepStrictEqual(shape(s.lines()[0].byClass('reply')[0]), ['"↪ "', 'span.reply-name', '": "', 'span.reply-body'], 'the same parts');
  s.r.setConfig({ layout: 'horizontal' });
  assert.deepStrictEqual(state(), [['line rtl', 'reply rtl'], ['line', 'reply'], ['line rtl', null]]);
  // reply_style=name quotes nothing: a plain header.
  s.r.setConfig({ layout: 'horizontal', reply_style: 'name' });
  assert.deepStrictEqual(state(), [['line rtl', 'reply'], ['line', 'reply'], ['line rtl', null]]);
  s.r.setConfig({});
  assert.deepStrictEqual(state(), [['line', 'reply rtl'], ['line', 'reply'], ['line', null]]);
});

test('name_sep: the fixed text between name and message, live; /me keeps its space', (t) => {
  const s = setup(t, {}, { tokensFor: (m) => ({ items: [{ type: 'text', text: m.text, sp: false }], action: m.login === 'me' }) });
  s.r.push(chat('amy', 'hi'));
  s.r.push(chat('me', 'waves'));
  s.r.flush();
  const colons = () => s.lines().map((l) => l.byClass('colon')[0].textContent);
  assert.deepStrictEqual(colons(), [': ', ' ']);
  [['space', ' '], ['dash', ' – '], ['arrow', ' › '], ['colon', ': ']].forEach(([k, v]) => {
    s.r.setConfig({ name_sep: k });
    assert.deepStrictEqual(colons(), [v, ' '], k);
  });
  assert.strictEqual(s.lines()[0].textContent, 'amy: hi');
});

test('name_font: a class and --name-font on #chat only while set; the lines never change', (t) => {
  const s = setup(t, {});
  s.r.push(chat('amy', 'hi'));
  s.r.flush();
  const before = JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  s.r.setConfig({ name_font: 'Press Start 2P' });
  assert.deepStrictEqual(rootExtras(s), { cls: ['has-name-font'], style: { '--name-font': '"Press Start 2P"' } });
  s.r.setConfig({ name_font: 'monospace', font: 'Roboto' });
  assert.deepStrictEqual(rootExtras(s), { cls: ['has-name-font'], style: { '--name-font': 'monospace' } });
  assert.strictEqual(s.root.style['--font'], '"Roboto"');
  s.r.setConfig({ name_font: 'Bad"; } x{', font: 'Roboto' });
  assert.strictEqual(s.root.style['--name-font'], '"Bad x"', 'only letters, digits, spaces and dashes reach the value');
  [{}, { name_font: '' }, { name_font: 5 }].forEach((c) => {
    s.r.setConfig(c);
    assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} }, JSON.stringify(c));
  });
  assert.strictEqual(JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent])), before);
});

test('overlay.css: the stage-6 rules (name font, timestamps) are scoped and stay off by default', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim());
  // name_font: only under .has-name-font, never a bare .reply-name (a comma that loses the scope would reach every
  // reply header), and the message font after it as the fallback.
  const fonts = Array.from(css.matchAll(/([^{}]+)\{[^}]*font-family:\s*([^;}]+)/g), (m) => [m[1].trim(), m[2].trim()]);
  assert.deepStrictEqual(fonts, [
    ['#chat', 'var(--font, \'Inter\'), \'Inter\', \'Segoe UI\', Roboto, Arial, sans-serif'],
    [':where(.has-name-font) .name,\n:where(.has-name-font) .reply-name',
      'var(--name-font), var(--font, \'Inter\'), \'Inter\', \'Segoe UI\', Roboto, Arial, sans-serif']
  ]);
  selectors.filter((s) => /--name-font|has-name-font/.test(s)).forEach((sel) =>
    sel.split(',').forEach((one) => assert.match(one.trim(), /^:where\(\.has-name-font\) \.(?:name|reply-name)$/, one)));
  // timestamps: .time only, which nothing draws while they are off.
  assert.match(css, /\n\.time \{\n  opacity: \.7;\n  font-size: \.8em;\n  margin-right: \.35em;\n  white-space: nowrap;\n  font-variant-numeric: tabular-nums;\n\}/);
  // With row_sep, a line's .time carries the mark between messages: the mark (only it) undoes .time's smaller,
  // fainter text, so it is as tall, as faint and as far from the message as without timestamps. In a row along the top
  // the line itself carries it (renderer-css round 3), so there the time never does.
  // In a column a zero-width space after the time lets the line wrap there (follow-up round 1), and a row's notice sizes
  // its time from notice_size (its line keeps the row's size).
  const sepPre = ':where(.layout-horizontal.align-bottom):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep) > ';
  // A row's line with a right-to-left message puts its time in a grid column of its own (renderer-css round 3), and a
  // reply's line along the top edge keeps its time whole (round 4: a flex item that never shrinks).
  const ir = ':where(.layout-horizontal.align-top) .line.inline-reply';
  assert.deepStrictEqual(selectors.filter((s) => /\.time\b/.test(s)),
    ['.time', ':where(.layout-vertical) .time::after', ':where(.layout-horizontal .line.notice) > .time',
      ':where(.layout-horizontal) .line.rtl > .time',
      ir + '::before,\n' + ir + ' > .time,\n' + ir + ' > .badges,\n' + ir + ' > .colon',
      sepPre + '.reply + .time::before,\n' + sepPre + '.time:first-child::before',
      // name_line along the top edge (1.6.1): a reply's line is a grid of its two lines, its time on the name line.
      ':where(.layout-horizontal.align-top.name-line:not(.no-names)) .line.inline-reply > .time']);
  assert.match(css, /\.time:first-child::before \{\n  font-size: 1\.25em;\n  opacity: \.857;\n\}/);
  // It comes after the mark's own rules, which it beats (or ties) on specificity.
  assert.ok(css.indexOf('.time:first-child::before') > css.indexOf('::before { content: \'\\25C6\'; }'));
  ['has-name-font', '\\.time'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

// ---------- highlights (stage 7) ----------

test('highlight colors: a variable on #chat only while picked (r, g, b), gone again at Default; the lines never change', (t) => {
  const s = setup(t, {});
  s.r.push(chat('amy', 'hi', { msgId: 'highlighted-message' }));
  s.r.flush();
  const before = JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  s.r.setConfig({ mention_color: 'ff0000', keyword_color: '00ff00', points_color: '0000ff', broadcaster_color: '010203',
    mod_color: 'aabbcc', vip_color: 'fFfFfF' });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: { '--mention-rgb': '255, 0, 0', '--kw-rgb': '0, 255, 0',
    '--hl-rgb': '0, 0, 255', '--role-broadcaster-rgb': '1, 2, 3', '--role-mod-rgb': '170, 187, 204' } }, 'only checked hex: fFfFfF is not one');
  assert.strictEqual(JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent])), before);
  s.r.setConfig({ mention_color: '' });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
});

test('highlights live: turning one on re-marks the lines already drawn, and off again leaves them as they were', (t) => {
  const s = setup(t, { channel: 'home' });
  s.r.push(chat('amy', 'hello @home'));
  s.r.push(chat('bob', 'gg wp', { badges: [{ set: 'moderator', version: '1' }] }));
  s.r.push(chat('cy', 'points!', { msgId: 'highlighted-message' }));
  s.r.push(chat('dee', 'Stream starts soon', { announcement: 'BLUE', badges: [{ set: 'moderator', version: '1' }] }));
  s.r.flush();
  const cls = () => s.lines().map((l) => l.className);
  const snap = () => JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  const before = snap();
  assert.deepStrictEqual(cls(), ['line', 'line', 'line highlight', 'line announcement ann-blue']);
  s.r.setConfig({ channel: 'home', mentions: 'at' });
  assert.deepStrictEqual(cls(), ['line mention', 'line', 'line highlight', 'line announcement ann-blue']);
  s.r.setConfig({ channel: 'home', mentions: 'at', keywords: ['GG'], role_style: 'tint' });
  assert.deepStrictEqual(cls(), ['line mention', 'line keyword role-mod', 'line highlight', 'line announcement ann-blue']);
  s.r.setConfig({ channel: 'home', keywords: ['gg'], highlight_users: ['amy'], role_style: 'bar', points_highlight: false });
  assert.deepStrictEqual(cls(), ['line user-hl', 'line keyword role-mod role-bar', 'line', 'line announcement ann-blue']);
  s.r.setConfig({ channel: 'home', role_style: 'tint' });
  assert.deepStrictEqual(cls(), ['line', 'line role-mod role-tint', 'line highlight', 'line announcement ann-blue']);
  s.r.setConfig({ channel: 'home' });
  assert.strictEqual(snap(), before);
  // A new line after a change is marked at once (the matchers of the new cfg).
  s.r.setConfig({ channel: 'home', keywords: ['later'] });
  s.r.push(chat('eve', 'see you later'));
  s.r.flush();
  assert.strictEqual(s.lines()[4].className, 'line keyword');
});

test('overlay.css: the stage-7 rules (tints, role bar) are class-only, ordered, and keep 1.5.2\'s channel-points look', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = (s) => css.indexOf('\n' + s);
  // The channel-points tint: today's purple as the fallback, in the color and in both gradient stops, the selector
  // kept at (0,2,0).
  assert.match(css, /\n\.line\.highlight \{\n  background-color: rgba\(var\(--hl-rgb, 145, 70, 255\), \.35\);/);
  assert.match(css, /\n:where\(\.has-bg\) \.line\.highlight \{[^}]*background-image: linear-gradient\(rgba\(var\(--hl-rgb, 145, 70, 255\), \.35\), rgba\(var\(--hl-rgb, 145, 70, 255\), \.35\)\);/);
  assert.doesNotMatch(css, /rgba\(145, 70, 255/, 'no purple left that --hl-rgb misses');
  // The role bar: after the name-color bar, before the first-message bar (the same specificity, so the later wins).
  assert.ok(at('.line.accent {') < at('.line.role-bar {') && at('.line.role-bar {') < at('.line.first-msg {'));
  assert.match(css, /\n\.line\.role-bar \{\n  box-shadow: inset \.2em 0 0 rgb\(var\(--role-rgb, 233, 25, 22\)\);\n  padding-left: \.4em;\n\}/);
  [['broadcaster', '233, 25, 22'], ['mod', '0, 173, 3'], ['vip', '224, 5, 185']].forEach(([r, rgb]) =>
    assert.ok(css.indexOf('\n.line.role-' + r + ' { --role-rgb: var(--role-' + r + '-rgb, ' + rgb + '); }') >= 0, r));
  // The tints: their colors' fallbacks, the shape .highlight has, over the box with bg, room for a bar; after the
  // channel-points rules and before the announcement's.
  assert.ok(css.indexOf('\n.line.mention { --line-tint: rgba(var(--mention-rgb, 233, 25, 22), .35); }') >= 0);
  assert.ok(css.indexOf('\n.line.keyword,\n.line.user-hl { --line-tint: rgba(var(--kw-rgb, 255, 179, 26), .35); }') >= 0);
  assert.ok(css.indexOf('\n.line.role-tint { --line-tint: rgba(var(--role-rgb, 233, 25, 22), .35); }') >= 0);
  assert.match(css, /\n\.line\.mention,\n\.line\.keyword,\n\.line\.user-hl,\n\.line\.role-tint \{\n  background-color: var\(--line-tint\);\n  border-radius: \.3em;\n  padding-left: \.3em;\n  padding-right: \.3em;\n\}/);
  assert.match(css, /\n:where\(\.has-bg\) \.line\.mention,\n:where\(\.has-bg\) \.line\.keyword,\n:where\(\.has-bg\) \.line\.user-hl,\n:where\(\.has-bg\) \.line\.role-tint \{\n  background-color: rgba\(var\(--bg-rgb, 0, 0, 0\), var\(--bg-alpha, 0\)\);\n  background-image: linear-gradient\(var\(--line-tint\), var\(--line-tint\)\);\n  border-radius: var\(--bg-radius, \.3em\);\n  padding-left: \.4em;\n  padding-right: \.4em;\n\}/);
  assert.ok(at(':where(.has-bg) .line.highlight {') < at('.line.mention {') && at(':where(.has-bg) .line.mention,') < at('.line.announcement {'));
  assert.ok(at('.line.highlight:where(.accent, .first-msg, .role-bar) { padding-left: .4em; }') > at('.line.highlight {'));
  assert.ok(at('.line.mention:where(.accent, .first-msg, .role-bar),') > at('.line.mention,\n.line.keyword'));
  // Every rule that names a new class is (0,2,0) at most: classes only (a :where() adds nothing), never #chat. (row_sep's
  // rules for a line with a bar or a tint, renderer-css round 2, are at .line + .line's (0,2,0) through :is(); their mark's
  // ::before is held to the row_sep rules' own shape in the stage-4 test.)
  const sels = Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim())
    .filter((s) => /mention|keyword|user-hl|role-/.test(s) && !/::before/.test(s) && !/name-line/.test(s));
  assert.ok(sels.length >= 10, 'the scan finds them');
  sels.forEach((sel) => sel.split(/,\n/).forEach((one) => {
    // :is() of single classes counts as one class (follow-up round 1: the bar side of a barred line in a box).
    const bare = one.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '').replace(':is(.line + .line, .line.keep-sep)', '.line.keep-sep')
      .replace(/:is\(\.[\w-]+(?:, \.[\w-]+)*\)/g, '.is');
    assert.doesNotMatch(bare, /#|\[|:/, one);
    assert.ok((bare.match(/\.[\w-]+/g) || []).length <= 2, one + ' is (0,2,0) at most');
  }));
  ['mention', 'keyword', 'user-hl', 'role-'].forEach((c) => assert.doesNotMatch(css, new RegExp('#chat[^{]*' + c)));
});

// ---------- renderer-css fixes (round 1) ----------

function overlayCss() {
  return require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'overlay.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
}
// A selector list split at its top-level commas (not the ones inside :where()).
function selectorList(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
// The padding-left the stylesheet gives a line with these classes (in a column without a box), as the cascade picks it
// among the rules on .line itself (`.line.x` with any :where() of more classes): the last of the most specific.
function linePadLeft(css, classes) {
  let best = null;
  let order = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    order++;
    const decl = /(?:^|;)\s*padding-left:\s*([^;]+?)\s*(?:;|$)/.exec(m[2]);
    if (!decl) continue;
    for (const sel of selectorList(m[1])) {
      const s = /^\.line((?:\.[\w-]+)*)(?::where\(([^()]*)\))?$/.exec(sel);
      if (!s) continue;
      const own = s[1].split('.').filter(Boolean);
      if (!own.every((c) => classes.includes(c))) continue;
      if (s[2] !== undefined && !s[2].split(',').some((alt) => alt.trim().split('.').filter(Boolean).every((c) => classes.includes(c)))) continue;
      const spec = 1 + own.length;
      if (!best || spec >= best.spec) best = { spec: spec, order: order, value: decl[1] };
    }
  }
  return best ? best.value : null;
}

test('overlay.css: a name wider than its line breaks like a long word, instead of running out of its box', () => {
  const css = overlayCss();
  const wraps = Array.from(css.matchAll(/([^{}]+)\{[^}]*overflow-wrap:\s*([^;}]+)/g), (m) => [selectorList(m[1]), m[2].trim()]);
  assert.deepStrictEqual(wraps, [[['.name', '.message'], 'anywhere']]);
  // A row never wraps: its lines are nowrap and end in an ellipsis, so a long name there changes nothing.
  assert.match(/\n\.layout-horizontal \.line \{([^}]*)\}/.exec(css)[1], /white-space: nowrap;/);
});

test('overlay.css: a Windows contrast theme (forced colors) leaves the chat as OBS draws it, in the builder preview and the home demos', () => {
  // Follow-up round 2 (pre-existing): the builder keeps its preview stage out of forced colors, but the preview is a
  // document of its own (overlay.html in an iframe), forced on its own: text, names, boxes, tints, the outline and the bars
  // all drew in the theme's colors (shadows dropped), so the colors picked showed nothing of what OBS, which never forces
  // colors, draws.
  const css = overlayCss();
  const rules = Array.from(css.matchAll(/([^{}]+)\{[^}]*forced-color-adjust:\s*([^;}]+)/g), (m) => [m[1].trim(), m[2].trim()]);
  assert.deepStrictEqual(rules, [['#chat', 'none']], 'the chat only (inherited by every line): the status hint and debug line keep the theme');
  assert.doesNotMatch(/\n\.tco-hint \{([^}]*)\}/.exec(css)[1], /forced-color-adjust/);
  // The stages around the preview and the home demos keep their drawn scene too (the overlay's white text would otherwise
  // sit on the theme's canvas color).
  const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', 'css', f), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(read('home.css'), /\n@media \(forced-colors: active\) \{\n  \.stage,\n  \.ticker \{ forced-color-adjust: none; \}\n\}/);
  assert.match(read('builder.css'), /@media \(forced-colors: active\) \{[^@]*\n  \.stage \{ forced-color-adjust: none; \}/);
});

test('overlay.css: a cheer wider than its line is fitted to it, as emotes and GIFs are; one that only doesn\'t fit moves on whole', () => {
  // Follow-up round 2 (pre-existing): `.cheer { white-space: nowrap }` kept its image and amount one unbreakable run, and
  // the image had no max-width, so a cheer wider than its line (line_width, emote_scale, text_px, a narrow source) ran out
  // of its box and off the column.
  const css = overlayCss();
  // The image: never wider than the cheer's box less its .05em sides, letterboxed like an emote's.
  const img = /\n\.cheer-img \{([^}]*)\}/.exec(css)[1];
  assert.match(img, /\n  margin: -\.3em \.05em;\n  max-width: calc\(100% - \.1em\);\n  object-fit: contain;\n$/);
  // In a column the cheer is one box at most its line wide: it moves to the next row whole when it only doesn't fit, and
  // its amount goes under its image only when the cheer alone is wider than its line.
  const col = /\n:where\(\.layout-vertical\) \.cheer \{([^}]*)\}/.exec(css);
  assert.ok(col, 'the column rule');
  assert.strictEqual(col[1], '\n  display: inline-block;\n  max-width: 100%;\n  white-space: normal;\n');
  // A row never wraps (its lines end in an ellipsis): there it stays one inline run, as always. Same specificity, so the
  // column rule comes after.
  assert.match(css, /\n\.cheer \{ white-space: nowrap; \}/);
  assert.ok(css.indexOf('\n:where(.layout-vertical) .cheer {') > css.indexOf('\n.cheer {'));
});

test('overlay.css: a bar beside a line keeps its room under any tint, a first message\'s channel-points highlight too', () => {
  const css = overlayCss();
  assert.strictEqual(linePadLeft(css, ['line', 'first-msg']), '.4em', 'the helper finds the bar\'s room');
  const bars = ['accent', 'role-bar', 'first-msg'], tints = ['highlight', 'mention', 'keyword', 'user-hl', 'role-tint'];
  tints.forEach((t) => assert.strictEqual(linePadLeft(css, ['line', t]), '.3em', t + ' alone'));
  bars.forEach((b) => {
    assert.strictEqual(linePadLeft(css, ['line', b]), '.4em', b + ' alone');
    tints.forEach((t) => {
      if (b === 'role-bar' && t === 'role-tint') return; // role_style is one or the other
      assert.strictEqual(linePadLeft(css, ['line', b, t]), '.4em', b + ' with ' + t);
    });
  });
  // The class order lineClasses writes for a first message highlighted with channel points.
  assert.strictEqual(R.lineClasses({ firstMsg: true, msgId: 'highlighted-message' }, { first_msg: true }, 'chat', false), 'line first-msg highlight');
  // Custom CSS written as `.line.highlight { ... }` still wins: the room is given at .line.highlight's own specificity.
  assert.strictEqual(linePadLeft(css + '\n.line.highlight { padding-left: 2px; }', ['line', 'first-msg', 'highlight']), '2px');
});

test('overlay.css: a reply header clips .3em past its line above and below, and its margins take that back', () => {
  // renderer-css round 2: it clipped at its line box, so at a line_height below about 130 the tails of g, j, p, q, y and
  // the accents of capitals were cut off flat (and Vietnamese or Thai marks at the default). Follow-up round 1: and .1em
  // before its start, where the ↪ (drawn by a fallback font) has a sliver of ink that was cut off flat.
  const css = overlayCss();
  const rule = /\n\.reply \{([^}]*)\}/.exec(css)[1];
  const decl = (k) => { const m = new RegExp('\\n  ' + k + ': ([^;]+);').exec(rule); return m && m[1]; };
  assert.deepStrictEqual(['overflow', 'text-overflow', 'white-space', 'padding-top', 'padding-bottom', 'padding-left', 'margin-top',
    'margin-bottom', 'margin-left'].map(decl), ['hidden', 'ellipsis', 'nowrap', '.3em', '.3em', '.1em', '-.3em', '-.3em', '-.1em']);
  assert.strictEqual(decl('padding-right'), null);
  // Nothing else gives .reply a padding or a margin at those sides (a row's only caps its width, and along the top adds a
  // gap after it), so each pair cancels.
  const others = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
    .filter((m) => m[1].trim() !== '.reply' && m[1].split(',').some((x) => /\.reply\s*$/.test(x)));
  assert.ok(others.length >= 4, others.map((m) => m[1].trim()).join(' | '));
  others.forEach((m) => assert.doesNotMatch(m[2], /(?:^|[;\n])\s*(?:padding(?:-\w+)?|margin|margin-(?:top|bottom|left|block\w*|inline-start))\s*:/, m[1].trim()));
});

test('overlay.css: a row\'s line clips with room past its edges, so ink a little past them (the reply header\'s ↪) is drawn whole', () => {
  // Follow-up round 1 (pre-existing): overflow-x: clip cut a row's line at its padding box, so without a box the ↪ that
  // starts a reply header lost the sliver of ink left of where it starts (the header's own room was cut by the line).
  const css = overlayCss();
  const at = (s) => css.indexOf('\n' + s);
  assert.match(/\n\.layout-horizontal \.line \{([^}]*)\}/.exec(css)[1], /\n  overflow-x: clip;\n  text-overflow: ellipsis;\n/);
  // Without a box (whose .4em padding is room enough, and whose rounded corners would clip it), at the row line's own
  // specificity and after it; both axes, as Chromium 103 wants for the margin.
  assert.match(css, /\n\.layout-horizontal:where\(:not\(\.has-bg\)\) \.line \{\n  overflow: clip;\n  overflow-clip-margin: 1em;\n\}/);
  assert.ok(at('.layout-horizontal:where(:not(.has-bg)) .line {') > at('.layout-horizontal .line {'));
  // A row_sep mark's barred line keeps its own bigger room, at the same specificity and later.
  assert.ok(at(':where(.layout-horizontal:not(.has-bg)):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep):where(.accent,') >
    at('.layout-horizontal:where(:not(.has-bg)) .line {'));
});

test('overlay.css: in a row along the top edge a reply header sits before its message, on the same row and baseline', () => {
  // renderer-css round 3 (pre-existing since the horizontal layout): the row lines its messages up by their top there, so
  // the header's block put the reply's own message a header lower than the others, and cut it off in a one-row source.
  const css = overlayCss();
  // Follow-up round 1: the row lines its messages up by their baseline (the same at the top while every message has a
  // chat line's room above it; a notice_size above 100 has more).
  assert.match(css, /\n#chat\.layout-horizontal\.align-top \.lines \{ align-items: baseline; \}/);
  const rule = /\n:where\(\.layout-horizontal\.align-top\) \.reply \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the top row\'s header rule, at .reply\'s own specificity (Custom CSS on .reply still wins)');
  const decls = {};
  rule[1].split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  // inline-block keeps the 15em cap and the ellipsis. It clips by paint containment with overflow visible (follow-up
  // round 1): in Chromium 103 (OBS 28 to 30) an inline-block whose overflow isn't visible, clip too, takes its bottom
  // margin edge as its baseline, which lifted the header's text ~6 px above the message's.
  assert.deepStrictEqual(decls, { display: 'inline-block', 'vertical-align': 'baseline', overflow: 'visible', contain: 'paint', 'margin-right': '.5em' });
  assert.ok(css.indexOf('\n:where(.layout-horizontal.align-top) .reply {') > css.indexOf('\n.reply {'), 'after .reply, which it ties');
  assert.ok(css.indexOf('\n:where(.layout-horizontal.align-top) .reply {') > css.indexOf('\n:where(.has-outline, .shadow-text) .reply {'),
    'after the outline\'s header rule (overflow: clip there), which it ties');
  assert.match(css, /\n\.layout-horizontal \.reply \{ max-width: 15em; \}/);
  // Only there: a row along the bottom, and a column, keep the block header.
  const inline = [];
  Array.from(css.matchAll(/([^{}]+)\{[^}]*display:\s*inline/g), (m) => m[1].trim())
    .forEach((s) => s.split(/,\s*/).forEach((one) => { if (/\.reply$/.test(one)) inline.push(one); }));
  assert.deepStrictEqual(inline, [':where(.layout-horizontal.align-top) .reply']);
  // Follow-up round 1: never wider than half the row or half of line_width's cap (it took a whole short row, so the reply's
  // name and message were cut off), in px worked out on #chat: a registered length with a big initial value (a value that
  // doesn't work leaves the 15em cap alone), at (0,2,0) after the row's 15em rule, so Custom CSS on it still wins.
  assert.match(css, /\n@property --reply-max \{ syntax: '<length>'; inherits: true; initial-value: 100000px; \}/);
  assert.match(css, /\n:where\(\.layout-horizontal\.align-top\) \{\n  --reply-max: min\(50vw - \(var\(--pad-x, 8px\) \+ max\(var\(--pad-x, 8px\), min\(var\(--edge-fade, 0px\), 50vw\)\)\) \/ 2, var\(--line-max, 200vw\) \/ 2\);\n\}/);
  assert.match(css, /\n\.layout-horizontal:where\(\.align-top\) \.reply \{ max-width: min\(15em, var\(--reply-max\)\); \}/);
  assert.ok(css.indexOf('\n.layout-horizontal:where(.align-top) .reply {') > css.indexOf('\n.layout-horizontal .reply {'));
  // The row's own sides, as the stylesheet sets them: pad_x on #chat, and edge_fade's room at the row's left end.
  assert.match(css, /\n\.edge-fade\.layout-horizontal \.lines \{ padding-left: max\(var\(--pad-x, 8px\), min\(var\(--edge-fade, 2em\), 50%\)\); \}/);
  assert.match(css, /\n  padding: 0 var\(--pad-x, 8px\);\n/);
});

// renderer-css round 3 (pre-existing: the reply header's ellipsis, and a row's at the source's width; line_width made it
// every long message in a row): a box that ends in an ellipsis runs left to right, so right-to-left text in it lost its
// start (on the right) and kept its last words. Text that starts right to left (.rtl, renderer.js) is a box of its own,
// whose line takes its direction from its text, ending in its own ellipsis; left-to-right lines keep every rule as before.
test('overlay.css: a right-to-left quote or row message is a box of its own that ends in its own ellipsis', () => {
  const css = overlayCss();
  const decls = (sel) => {
    const m = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => r[1].trim() === sel).map((r) => [r[0], r[2]])[0];
    assert.ok(m, sel);
    const d = {};
    m[1].split(';').forEach((x) => { const i = x.indexOf(':'); if (i > 0) d[x.slice(0, i).trim()] = x.slice(i + 1).trim(); });
    return d;
  };
  // The quote's own direction: unicode-bidi: plaintext on it (and on a chat line's message), as before.
  assert.match(css, /\n\.line:not\(\.notice\) \.message,\n\.reply-body \{ unicode-bidi: plaintext; \}/);
  // The header: a flex row on the text's baseline; the ↪ and ': ' keep their spaces; the quote takes the room left (at
  // least 1.2em, a whole ellipsis, or its own width if less) up to its own width; the name keeps its width unless it alone
  // leaves the quote less; each clips its sides (overflow-x only: its text still passes its line above and below) with
  // room that its margins take back. Along the top edge of a row it stays inline, on the message's baseline.
  assert.deepStrictEqual(decls('.reply.rtl'), { display: 'flex', 'align-items': 'baseline', 'white-space': 'pre' });
  assert.deepStrictEqual(decls('.reply.rtl > .reply-name,\n.reply.rtl > .reply-body'), { 'min-width': '0', 'white-space': 'nowrap',
    'overflow-x': 'clip', 'text-overflow': 'ellipsis', padding: '0 calc(.1em + var(--tshadow-room, 0px))',
    margin: '0 calc(-.1em - var(--tshadow-room, 0px))' });
  assert.deepStrictEqual(decls('.reply.rtl > .reply-body'), { flex: '1 0 1.2em', 'max-width': 'max-content' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal.align-top) .reply.rtl'), { display: 'inline-flex' });
  assert.ok(css.indexOf('\n:where(.layout-horizontal.align-top) .reply.rtl {') > css.indexOf('\n:where(.layout-horizontal.align-top) .reply {'),
    'after the top row\'s header rule, which it ties');
  // A row's line: a grid of its parts, the message last and the only one that takes what is left; the name the only other
  // one that gives way; a reply header along the bottom edge across every column on a row of its own.
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl'), { display: 'grid',
    'grid-template-columns': 'max-content max-content max-content max-content minmax(0, max-content) max-content minmax(0, 1fr)',
    'align-items': 'baseline' });
  const col = (part) => decls(':where(.layout-horizontal) .line.rtl > ' + part)['grid-column'];
  assert.deepStrictEqual(['.reply', '.time', '.badges', '.name', '.colon', '.message'].map(col), ['2', '3', '4', '5', '6', '7']);
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl::before'), { 'grid-column': '1' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal.align-bottom) .line.rtl > .reply'), { 'grid-column': '1 / -1', 'grid-row': '1' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl > .colon'), { 'grid-column': '6', 'white-space': 'pre' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl > .name,\n:where(.layout-horizontal) .line.rtl > .message'), { 'min-width': '0',
    'overflow-x': 'clip', 'text-overflow': 'ellipsis', padding: '0 calc(.1em + var(--tshadow-room, 0px))',
    margin: '0 calc(-.1em - var(--tshadow-room, 0px))' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl > .message'), { 'grid-column': '7', 'max-width': 'max-content',
    'padding-left': 'min(.1em + var(--tshadow-room, 0px), 100%)', 'margin-left': 'calc(-1 * min(.1em + var(--tshadow-room, 0px), 100%))' });
  // The end-of-message box moves into the message (a grid would make the line's own one an empty item), as on a reply's
  // line along the top edge (.inline-reply, a flex row: round 4).
  assert.match(css, /\n:where\(\.layout-horizontal\) \.line\.rtl > \.message::after,\n:where\(\.layout-horizontal\.align-top\) \.line\.inline-reply > \.message::after,\n:where\(\.layout-horizontal\.name-line:not\(\.no-names\)\) \.line:not\(\.notice\) > \.message::after,\n\.layout-horizontal \.line::after \{\n  content: '';/);
  assert.deepStrictEqual(decls(':where(.layout-horizontal) .line.rtl::after'), { content: 'none' });
  assert.ok(css.indexOf('\n:where(.layout-horizontal) .line.rtl::after {') > css.indexOf('\n.layout-horizontal .line::after {'), 'after it');
  // Only .rtl lines and headers: every selector naming it is on such a line or header, the line's ones in a row only.
  const rtl = [];
  Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim()).forEach((s) => s.split(/,\n/).forEach((one) => { if (/\.rtl\b/.test(one)) rtl.push(one); }));
  // (name_line in a row, 1.6.1: a right-to-left message is a block of its own there, so its line is no grid.)
  assert.strictEqual(rtl.length, 21);
  rtl.forEach((one) => assert.match(one, /^(?:\.reply\.rtl\b|:where\(\.layout-(?:vertical|horizontal)(?:[^()]|\([^()]*\))*\) \.(?:reply|line)\.rtl\b)/, one));
  rtl.filter((one) => /\.line\.rtl/.test(one)).forEach((one) => assert.match(one, /^:where\(\.layout-horizontal/, one));
});

// renderer-css round 4: along the top edge of a row a reply's header sits before its message, capped at half the row or
// line, but its own time, platform icon and badges came out of the other half, so at line_width 10-20 or in a narrow source
// the reply's name was cut short or not drawn (the quoted name the only one left on the line). The line is a flex row of
// its parts there (.inline-reply): the header gives way first, the name only once the parts before it and the name don't
// fit, and the message keeps a whole ellipsis.
test('overlay.css: a reply\'s line along the top edge is a flex row in which the header gives way before the name', () => {
  const css = overlayCss();
  const P = ':where(.layout-horizontal.align-top) .line.inline-reply';
  const decls = (sel) => {
    const m = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => r[1].trim() === sel)[0];
    assert.ok(m, sel);
    const d = {};
    m[2].split(';').forEach((x) => { const i = x.indexOf(':'); if (i > 0) d[x.slice(0, i).trim()] = x.slice(i + 1).trim(); });
    return d;
  };
  assert.deepStrictEqual(decls(P), { display: 'flex', 'align-items': 'baseline' });
  assert.deepStrictEqual(decls(P + '::before,\n' + P + ' > .time,\n' + P + ' > .badges,\n' + P + ' > .colon'), { flex: 'none' });
  assert.deepStrictEqual(decls(P + '::after'), { content: 'none' });
  assert.deepStrictEqual(decls(P + ' > .colon'), { 'white-space': 'pre' });
  const head = decls(P + ' > .reply');
  assert.deepStrictEqual(Object.keys(head), ['flex', 'min-width', 'clip-path']);
  assert.strictEqual(head.flex, '0 1000000 auto', 'a million times the name\'s flex-shrink');
  assert.strictEqual(head['min-width'], '0');
  // The clip-path, with no room of its own: its .1em of room for the ↪'s ink (its padding) cut off at the left and nothing
  // past its empty content at the right (an outline's clip margin showed the ↪ there), so it draws nothing; else 1em out
  // on every side. 100% is its border box (that room and its content).
  assert.strictEqual(head['clip-path'], 'inset(-1em max(-1em, 10000 * (.1em - 100%)) -1em max(-1em, .1em + 10000 * (.1em - 100%)))');
  const insets = (contentEm) => {
    const w = 0.1 + contentEm; // 100%: the border box, in the header's em
    return { right: Math.max(-1, 10000 * (0.1 - w)), left: Math.max(-1, 0.1 + 10000 * (0.1 - w)) };
  };
  const none = insets(0);
  assert.ok(Math.abs(none.left - 0.1) < 1e-9 && Math.abs(none.right) < 1e-9, 'no room: an empty clip ' + JSON.stringify(none));
  // One layout unit (1/64 px) of room in an 18 px header (the .75em of a 24 px row) already lifts the cut.
  assert.deepStrictEqual(insets(1 / 64 / 18), { right: -1, left: -1 });
  assert.deepStrictEqual(decls(P + ' > .name,\n' + P + ' > .message'), { 'min-width': '0', 'overflow-x': 'clip', 'text-overflow': 'ellipsis',
    padding: '0 calc(.1em + var(--tshadow-room, 0px))', margin: '0 calc(-.1em - var(--tshadow-room, 0px))' });
  assert.deepStrictEqual(decls(P + ' > .name'), { flex: '0 1 auto', 'background-origin': 'content-box' });
  assert.deepStrictEqual(decls(P + ' > .message'), { flex: '1 0 1.2em', 'max-width': 'max-content' });
  // After the .rtl grid's rules, which they tie, so a right-to-left reply's line along the top edge is the flex row too.
  assert.ok(css.indexOf('\n' + P + ' {') > css.indexOf('\n:where(.layout-horizontal) .line.rtl > .message {'));
  // The header keeps its cap (half the row or line, at most 15em) and its paint containment (the ellipsis).
  assert.match(css, /\n\.layout-horizontal:where\(\.align-top\) \.reply \{ max-width: min\(15em, var\(--reply-max\)\); \}/);
  // Only along the top edge, only on such a line (with name_line, 1.6.1, a grid of its two lines: a test of its own).
  const NL = ':where(.layout-horizontal.align-top.name-line:not(.no-names)) .line.inline-reply';
  Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim()).forEach((s) => s.split(/,\n/).forEach((one) => {
    if (/inline-reply/.test(one)) assert.ok(one.indexOf(P) === 0 || one.indexOf(NL) === 0, one);
  }));
});

test('a reply\'s line gets .inline-reply only in a row along the top edge, live with align, layout and replies', (t) => {
  const s = setup(t, { layout: 'horizontal', align: 'top', animate: false });
  const p = chat('amy', 'question');
  s.r.push(p);
  s.r.push(replyTo(p, 'bob', 'answer'));
  s.r.flush();
  const cls = () => s.lines().map((l) => l.className);
  assert.deepStrictEqual(cls(), ['line', 'line inline-reply']);
  s.r.setConfig({ layout: 'horizontal', align: 'bottom', animate: false });
  assert.deepStrictEqual(cls(), ['line', 'line'], 'a bottom row keeps the header on a row of its own');
  s.r.setConfig({ layout: 'horizontal', align: 'top', animate: false });
  assert.deepStrictEqual(cls(), ['line', 'line inline-reply']);
  s.r.setConfig({ layout: 'vertical', align: 'top', animate: false });
  assert.deepStrictEqual(cls().sort(), ['line', 'line'], 'nor a column');
  s.r.setConfig({ layout: 'horizontal', align: 'top', animate: false, replies: false });
  assert.deepStrictEqual(cls(), ['line', 'line'], 'no header, no class');
  s.r.setConfig({ layout: 'horizontal', align: 'top', animate: false });
  assert.deepStrictEqual(cls(), ['line', 'line inline-reply']);
  // A header taken off (its parent deleted) takes the class along.
  s.r.clearMessage(p.id);
  assert.deepStrictEqual(cls(), ['line']);
  // A right-to-left reply's line is both.
  s.r.push(replyTo(chat('cy', 'hi'), 'dee', 'مرحبا بكم'));
  s.r.flush();
  assert.strictEqual(s.lines()[1].className, 'line rtl inline-reply');
});

// A column rule's emote margins worked out as numbers (em) from the rule's own text: eh the image's height (--eh, or
// --emote-h for a cheer), L the line_height, hang --emote-hang (twice --line-gap in a column without a box; the .3em
// fallback with one). o.drop: --emote-drop (.2em in a box, else its .3em fallback); o.floor: --emote-floor (a column's,
// colFloor; a row has the .2em fallback).
function emoteMargins(css, sel, eh, L, hang, o) {
  o = Object.assign({ drop: 0.3, floor: 0.2 }, o);
  const m = new RegExp('\\n' + sel.replace(/[.()]/g, '\\$&') + ' \\{\\s*margin-top: ([^;]+);\\s*margin-bottom: ([^;]+);').exec(css);
  assert.ok(m, sel);
  const js = (x) => x.replace(/var\(--eh\)|var\(--emote-h, 1\.75em\)/g, '(' + eh + ')').replace(/var\(--line-height, 1\.35\)/g, '(' + L + ')')
    .replace(/var\(--emote-hang, \.3em\)/g, '(' + hang + ')').replace(/var\(--emote-drop, \.3em\)/g, '(' + o.drop + ')')
    .replace(/var\(--emote-floor, \.2em\)/g, '(' + o.floor + ')').replace(/(\d*\.?\d+)em\b/g, '$1').replace(/\bcalc\(/g, '(')
    .replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(');
  return [m[1], m[2]].map((x) => {
    assert.doesNotMatch(js(x), /var\(|--/, x);
    return Math.round(Function('return ' + js(x))() * 1000) / 1000 + 0;
  });
}
// --emote-floor as a column sets it, for line_height L (em).
function colFloor(css, L) {
  const m = /\n:where\(\.layout-vertical\) \{ --emote-floor: ([^;]+); \}/.exec(css);
  assert.ok(m, 'the column\'s --emote-floor');
  return cssEm(m[1], 1.75, L, 1);
}
// A column's margins: without a box (hang: --emote-hang), or in one (bg: --emote-drop .2em, the .3em hang fallback).
function colMargins(css, sel, eh, L, hang, bg) {
  return emoteMargins(css, sel, eh, L, bg ? 0.3 : hang, { floor: colFloor(css, L), drop: bg ? 0.2 : 0.3 });
}

const EMOTE_SEL = ':where(.layout-vertical, .layout-horizontal) .emote-stack';
const CHEER_SEL = ':where(.layout-vertical, .layout-horizontal) .cheer-img';

test('overlay.css: an emote or cheer taller than its line grows the line in a column, never reaching above it', () => {
  const css = overlayCss();
  const at = (s) => css.indexOf('\n' + s);
  assert.ok(at(EMOTE_SEL + ' {') > at('.emote-stack {'), 'emotes, after the shorthand');
  assert.ok(at(CHEER_SEL + ' {') > at('.cheer-img {'), 'cheers, after the shorthand');
  assert.ok(at(EMOTE_SEL + ' {') > at(':where(.line.emote-only) .emote-stack:not(.big)'), '--eh is set by then');
  // --eh carries every height (emote_scale, emote_only, gigantified), and the shorthand keeps today's -.3em .05em.
  assert.match(/\n\.emote-stack \{([^}]*)\}/.exec(css)[1], /\n  margin: -\.3em \.05em;/);
  // The margins: -.3em while the image is at most the usual 1.75em (today's look), none above and .2em below once it is
  // .3em taller, in between on the way there. In a row too (renderer-css round 3; the row's own test is below).
  [[EMOTE_SEL, 'emotes'], [CHEER_SEL, 'cheers']].forEach(([sel, what]) => {
    const at135 = (eh) => colMargins(css, sel, eh, 1.35, 0.3);
    assert.deepStrictEqual([1.75, 0.875, 1.9, 2.05, 2.1875, 3.5, 5.25].map(at135),
      [[-0.3, -0.3], [-0.3, -0.3], [-0.15, -0.2], [0, -0.2], [0, -0.2], [0, -0.2], [0, -0.2]], what);
  });
});

test('overlay.css: in a box an emote, cheer or 1x GIF reaches no further below its line than the box\'s .2em padding', () => {
  // Follow-up round 1 (pre-existing): a box is .2em + 1.35em + .2em, one emote tall, but an emote's middle is the text's
  // (half its x-height above the baseline), a little below its line's middle in most fonts: with -.3em it stuck out of
  // the bottom of its box (1.3 px at medium, 2.7 px at large in Inter). --emote-drop caps it at the box's padding.
  const css = overlayCss();
  assert.match(css, /\n:where\(\.has-bg\) \{ --emote-drop: \.2em; \}/);
  assert.match(/\n\.has-bg \.line \{([^}]*)\}/.exec(css)[1], /\n  padding: \.2em \.4em;\n/);
  // Only in a box: without one every margin is as before.
  assert.deepStrictEqual(Array.from(css.matchAll(/([^{}]+)\{[^}]*--emote-drop:/g), (m) => m[1].trim()), [':where(.has-bg)']);
  [[EMOTE_SEL, 'emotes'], [CHEER_SEL, 'cheers']].forEach(([sel, what]) => {
    const bg = (eh, L) => colMargins(css, sel, eh, L, 0.3, true);
    const nobg = (eh, L) => colMargins(css, sel, eh, L, 0.3, false);
    // The bottom never past -.2em, whatever the size or line_height. Follow-up round 2: the top comes to -.2em with it
    // (it stayed -.3em): `vertical-align: middle` centres the margin box, so unequal margins lifted the image by half the
    // difference (.05em), twice as far into a reply header or a name_line name above it as without a box. The line grows
    // by the rest instead.
    assert.deepStrictEqual([1.75, 0.875, 1.9, 2.05, 3.5, 5.25].map((eh) => bg(eh, 1.35)),
      [[-0.2, -0.2], [-0.2, -0.2], [-0.15, -0.2], [0, -0.2], [0, -0.2], [0, -0.2]], what);
    assert.deepStrictEqual([1, 1.2, 1.3, 1.5, 2].map((L) => bg(1.75, L)), [[0, -0.1], [0, -0.2], [-0.2, -0.2], [-0.2, -0.2], [-0.2, -0.2]], what + ' line_height');
    [0.875, 1.75, 1.9, 2.1875, 3.5, 5.25].forEach((eh) => [1, 1.1, 1.25, 1.35, 1.5, 2].forEach((L) => {
      const b = bg(eh, L), n = nobg(eh, L);
      assert.ok(b[1] >= -0.2, what + ' ' + eh + ' ' + L);
      // How far the image rises off the text's middle (half the top margin less the bottom one): never more in a box.
      assert.ok(b[1] - b[0] <= n[1] - n[0] + 1e-9, what + ' lifted in a box: ' + eh + ' ' + L + ' ' + b + ' vs ' + n);
    }));
  });
});

test('overlay.css: at a line_height below 135, and at spacing=tight without a box, a column\'s emotes keep clear of the lines next to them', () => {
  // renderer-css round 2: the 2.05em above took no account of either, so a 1.75em emote kept its -.3em margins and reached
  // into the name row (name_line), a reply header, the text above it or the next line's emotes.
  const css = overlayCss();
  assert.match(css, /\n:where\(\.layout-vertical:not\(\.has-bg\)\) \{ --emote-hang: calc\(2 \* var\(--line-gap, \.15em\)\); \}/);
  // Follow-up round 1: below line_height 120 the .2em it may still reach below its line comes down with the line height
  // (half of it, less .4em: the room above the next row's letters), so it no longer reaches into the next row of a
  // wrapped message. A column's only (a row never wraps); 120 and up it is the .2em (or more) as before.
  assert.deepStrictEqual([1, 1.1, 1.2, 1.35, 2].map((L) => colFloor(css, L)), [0.1, 0.15, 0.2, 0.275, 0.6]);
  assert.deepStrictEqual(Array.from(css.matchAll(/([^{}]+)\{[^}]*--emote-floor:/g), (m) => m[1].trim()), [':where(.layout-vertical)']);
  [[EMOTE_SEL, 'emotes'], [CHEER_SEL, 'cheers']].forEach(([sel, what]) => {
    const em = (eh, L, hang) => colMargins(css, sel, eh, L, hang);
    // line_height: below 135 the threshold comes down twice as fast, so the line grows instead (100 to 120: none above,
    // .2em below, less below 120); at 135 and up nothing changes.
    assert.deepStrictEqual([1, 1.1, 1.2, 1.25, 1.3, 1.35, 1.5, 2].map((L) => em(1.75, L, 0.3)),
      [[0, -0.1], [0, -0.15], [0, -0.2], [-0.1, -0.2], [-0.2, -0.2], [-0.3, -0.3], [-0.3, -0.3], [-0.3, -0.3]], what + ' line_height');
    assert.deepStrictEqual([1, 1.5].map((L) => em(2.1875, L, 0.3)), [[0, -0.1], [0, -0.2]], what + ': taller ones');
    // spacing: twice the gap between two lines' text, tight's .05em a side; normal, loose and extra keep -.3em. With a box
    // (the fallback .3em) nothing changes.
    assert.deepStrictEqual([0.1, 0.3, 0.6, 1].map((h) => em(1.75, 1.35, h)), [[-0.1, -0.1], [-0.3, -0.3], [-0.3, -0.3], [-0.3, -0.3]], what + ' spacing');
    assert.deepStrictEqual(em(1.75, 1, 0.1), [0, -0.1], what + ': both');
    assert.deepStrictEqual(em(2.1875, 1.35, 0.1), [0, -0.1], what + ': taller at tight');
  });
});

// A length expression from overlay.css as a number of em: eh --emote-h (and --eh), L the line_height, badge --badge-h,
// drop --emote-drop (.3em without a box).
function cssEm(x, eh, L, badge, drop) {
  const js = x.replace(/\s+/g, ' ').replace(/var\(--eh\)|var\(--emote-h, 1\.75em\)/g, '(' + eh + ')')
    .replace(/var\(--line-height, 1\.35\)/g, '(' + L + ')').replace(/var\(--badge-h, 1em\)/g, '(' + badge + ')')
    .replace(/var\(--emote-hang, \.3em\)/g, '(.3)').replace(/var\(--emote-drop, \.3em\)/g, '(' + (drop === undefined ? 0.3 : drop) + ')')
    .replace(/(\d*\.?\d+)em\b/g, '$1').replace(/\bcalc\(/g, '(')
    .replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(');
  assert.doesNotMatch(js, /var\(|--/, x);
  return Math.round(Function('return ' + js)() * 1000) / 1000 + 0;
}
// A declaration's value split at its top-level spaces ('calc(a b) .05em calc(c)' is three).
function topLevel(v) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of v.replace(/\s+/g, ' ').trim()) {
    if (ch === ' ' && depth === 0) { out.push(cur); cur = ''; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    cur += ch;
  }
  return out.concat(cur);
}

test('overlay.css: in a row an emote, cheer or GIF taller than its line stays clear of a reply header and inside its box, and every message lines up', () => {
  // renderer-css round 3: a row kept the fixed -.3em margins, so an emote taller than its line (emote_scale above about
  // 110, Big & bold, line_height below 135) still reached .3em above it, across a reply header's text and out of its bg
  // box. And a row lines its messages up by their box's edge, so a message with a bigger emote, cheer, GIF or badge
  // (badge_size) sat higher (lower with align=top) than plain ones.
  const css = overlayCss();
  // A row's emotes and cheers take the column's rule; --emote-hang is a column's only, so a row has its .3em fallback.
  assert.deepStrictEqual(Array.from(css.matchAll(/([^{}]+)\{[^}]*--emote-hang:/g), (m) => m[1].trim()), [':where(.layout-vertical:not(.has-bg))']);
  // A row never wraps, so it has no --emote-floor (the .2em fallback); in a box --emote-drop (.2em) as in a column.
  const sizes = [[1.75, 1.35], [0.875, 1.35], [1.9, 1.35], [2.1875, 1.35], [2.625, 1.35], [3.5, 1.35], [1.75, 1], [1.75, 1.25], [2.1875, 1], [1.75, 2]];
  const want = sizes.map(([eh, L]) => emoteMargins(css, EMOTE_SEL, eh, L, 0.3));
  const wantBg = sizes.map(([eh, L]) => emoteMargins(css, EMOTE_SEL, eh, L, 0.3, { drop: 0.2 }));
  assert.deepStrictEqual(want.slice(0, 4), [[-0.3, -0.3], [-0.3, -0.3], [-0.15, -0.2], [0, -0.2]], 'none above once taller than its line');
  assert.deepStrictEqual(want.slice(6, 7), [[0, -0.2]], 'line_height 100: .2em below, as before');
  assert.deepStrictEqual(wantBg.slice(0, 4), [[-0.2, -0.2], [-0.2, -0.2], [-0.15, -0.2], [0, -0.2]], 'in a box (equal, follow-up round 2)');
  assert.deepStrictEqual(sizes.map(([eh, L]) => emoteMargins(css, CHEER_SEL, eh, L, 0.3)), want, 'cheers');
  assert.deepStrictEqual(sizes.map(([eh, L]) => emoteMargins(css, CHEER_SEL, eh, L, 0.3, { drop: 0.2 })), wantBg, 'cheers in a box');
  // A row's GIF (emote height there): the same margins, with .05em at its sides as before.
  const gif = /\n\.layout-horizontal \.gif \{([^}]*)\}/.exec(css)[1];
  const parts = topLevel(/\n  margin: ([^;]+);/.exec(gif)[1]);
  assert.strictEqual(parts.length, 3);
  assert.strictEqual(parts[1], '.05em');
  assert.deepStrictEqual(sizes.map(([eh, L]) => [cssEm(parts[0], eh, L, 1), cssEm(parts[2], eh, L, 1)]), want, 'GIFs');
  assert.deepStrictEqual(sizes.map(([eh, L]) => [cssEm(parts[0], eh, L, 1, 0.2), cssEm(parts[2], eh, L, 1, 0.2)]), wantBg, 'GIFs in a box');
  assert.doesNotMatch(gif, /emote-hang|emote-floor/);
  // Every message in a row ends in an empty inline box whose line-height is the tallest image's margin box (an emote's
  // height less its margins, or a badge), on the same middle line: then all their line boxes, and so their text, line up.
  // Inline (no display, width or height): an inline-block would keep a space at the end of a message from collapsing.
  const sp = /\n\.layout-horizontal \.line::after \{([^}]*)\}/.exec(css);
  assert.ok(sp, 'the spacer');
  const d = {};
  sp[1].split(/;\s*\n/).forEach((x) => { const i = x.indexOf(':'); if (i > 0) d[x.slice(0, i).trim()] = x.slice(i + 1).replace(/;\s*$/, '').trim(); });
  assert.deepStrictEqual(Object.keys(d), ['content', 'line-height', 'vertical-align']);
  assert.deepStrictEqual([d.content, d['vertical-align']], ['\'\'', 'middle']);
  [1, 0.5, 1.25, 2].forEach((badge) => sizes.forEach(([eh, L], i) => {
    const box = Math.round((eh + want[i][0] + want[i][1]) * 1000) / 1000;
    assert.strictEqual(cssEm(d['line-height'], eh, L, badge), Math.max(badge, box), eh + ' ' + L + ' ' + badge);
    const boxBg = Math.round((eh + wantBg[i][0] + wantBg[i][1]) * 1000) / 1000;
    assert.strictEqual(cssEm(d['line-height'], eh, L, badge, 0.2), Math.max(badge, boxBg), 'bg ' + eh + ' ' + L + ' ' + badge);
  }));
  // At the defaults it is an emote's 1.15em, which already fits a 1.35em line (in Inter): nothing moves. In a box, 1.35em.
  assert.strictEqual(cssEm(d['line-height'], 1.75, 1.35, 1), 1.15);
  assert.strictEqual(cssEm(d['line-height'], 1.75, 1.35, 1, 0.2), 1.35);
  // Badges keep no vertical margins, so their margin box is their height.
  assert.doesNotMatch(/\n\.badge \{([^}]*)\}/.exec(css)[1], /margin(?:-top|-bottom)?:/);
});

test('overlay.css: line_width caps a message with its bar or tint, so with text_align their bars and tints line up', () => {
  // renderer-css round 3: in a column without a box a line is content-box, so a bar's .4em or a tint's .3em a side came
  // on top of the cap: every kind of line had its own width, and with text_align=right/center their bars were staggered.
  const css = overlayCss();
  assert.match(css, /\n\.has-maxw \.line \{ box-sizing: border-box; max-width: min\(100%, var\(--line-max, 100%\)\); \}/);
  // A box and a row are border-box already, and nothing gives a capped line content-box back.
  assert.match(/\n\.has-bg \.line \{([^}]*)\}/.exec(css)[1], /box-sizing: border-box;/);
  assert.match(/\n\.layout-horizontal \.line \{([^}]*)\}/.exec(css)[1], /box-sizing: border-box;/);
  assert.doesNotMatch(css, /box-sizing: content-box/);
  // The paddings it now holds: the bars' .4em, the tints' .3em a side, the announcement's .5em.
  ['accent', 'role-bar', 'first-msg', 'highlight', 'mention', 'keyword', 'user-hl', 'role-tint', 'announcement'].forEach((c) =>
    assert.ok(Number(linePadLeft(css, ['line', c]).replace('em', '')) > 0, c));
});

test('row_sep: the line after one that left out of view at the left edge keeps its mark (.keep-sep), on a rerender too', (t) => {
  const row = { layout: 'horizontal', animate: false, row_sep: 'bar' };
  const s = setup(t, row);
  rowLayout(s, 300);
  const b = chat('b', 'y'.repeat(17)); // 200 px
  s.r.push(chat('a', 'x'.repeat(7))); // 100 px
  s.r.push(b);
  s.r.flush();
  assert.deepStrictEqual(s.lines().map((l) => l.className), ['line', 'line']);
  s.r.push(chat('c', 'z'.repeat(12))); // 150 px: a now ends at -50, out of view, and the trim takes it
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['y'.repeat(17), 'z'.repeat(12)]);
  assert.deepStrictEqual(s.lines().map((l) => l.className), ['line keep-sep', 'line'], 'b\'s mark, in view, stays');
  // A rerender (a keyword now marks b) builds the class list anew: the mark stays, and stays when it goes again.
  s.r.setConfig(Object.assign({ keywords: ['y'.repeat(17)] }, row));
  assert.deepStrictEqual(s.lines().map((l) => l.className), ['line keyword keep-sep', 'line']);
  s.r.setConfig(row);
  assert.deepStrictEqual(s.lines().map((l) => l.className), ['line keep-sep', 'line']);
  // A first line that leaves in view (b reaches 150 px) takes the mark after it along, as before.
  s.r.clearMessage(b.id);
  assert.deepStrictEqual(s.lines().map((l) => [l.className, l.textContent]), [['line', 'c: ' + 'z'.repeat(12)]]);
});

[[300, ['line keep-sep', 'line'], 'out of'], [600, ['line', 'line'], 'in']].forEach(([W, want, where]) => {
  test('row_sep: a fade that runs out on the first line ' + where + ' view ' + (where === 'in' ? 'takes the next line\'s mark along' : 'keeps the next line\'s mark'), (t) => {
    const s = setup(t, { layout: 'horizontal', animate: true, row_sep: 'dot', fade: 10 });
    rowLayout(s, W);
    s.r.push(chat('a', 'x'.repeat(7)));
    s.r.flush();
    s.tick(4000);
    s.r.push(chat('b', 'y'.repeat(17)));
    s.r.push(chat('c', 'z'.repeat(12)));
    s.r.flush();
    assert.strictEqual(s.lines().length, 3, 'a is in view at the start of the slide, so it stays');
    s.tick(6500); // a's fade runs out (the sweep), with a now at its place after the slide
    assert.deepStrictEqual(s.texts(), ['y'.repeat(17), 'z'.repeat(12)]);
    assert.deepStrictEqual(s.lines().map((l) => l.className), want);
  });
});

[{ layout: 'horizontal', animate: false }, { layout: 'horizontal', animate: false, row_sep: 'none' }, { row_sep: 'bar' }].forEach((cfg) => {
  test('row_sep: no .keep-sep without a mark (row_sep=none, the default) or in a column: ' + JSON.stringify(cfg), (t) => {
    const s = setup(t, cfg);
    rowLayout(s, 300);
    s.r.push(chat('a', 'x'.repeat(7)));
    s.r.push(chat('b', 'y'.repeat(17)));
    s.r.flush();
    s.r.push(chat('c', 'z'.repeat(12)));
    s.r.flush();
    assert.ok(s.lines().length >= 2);
    assert.ok(s.lines().every((l) => l.className === 'line'), s.lines().map((l) => l.className).join());
  });
});

test('overlay.css: row_sep without a box puts a barred or tinted message\'s mark before its bar and outside its tint', () => {
  // renderer-css round 2: the mark was drawn inside the message after its left padding, so the bar (accent, role, first
  // message, announcement) came before the mark, right after the message before it, and the tint wrapped round the mark.
  const css = overlayCss();
  const P = ':where(.layout-horizontal:not(.has-bg)):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep)';
  const D = ':where(.accent, .first-msg, .role-bar, .announcement, .highlight, .mention, .keyword, .user-hl, .role-tint)';
  const rule = (sel) => {
    const at = css.indexOf('\n' + sel + ' {');
    assert.ok(at >= 0, sel);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    const o = {};
    body.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    return o;
  };
  const line = rule(P + D);
  assert.deepStrictEqual(line, { '--sep-pad': '.3em', 'border-left': 'calc(var(--sep-w) + var(--row-gap, 1em)) solid transparent',
    'background-clip': 'padding-box', overflow: 'clip', 'overflow-clip-margin': '5em' });
  assert.deepStrictEqual(rule(P + ':where(.accent, .first-msg, .role-bar)'), { '--sep-pad': '.4em' });
  assert.deepStrictEqual(rule(P + ':where(.announcement)'), { '--sep-pad': '.5em' });
  const round = 'calc(var(--sep-w) + var(--row-gap, 1em) + .3em) .3em';
  assert.deepStrictEqual(rule(P + ':where(.highlight, .mention, .keyword, .user-hl, .role-tint)'),
    { 'border-top-left-radius': round, 'border-bottom-left-radius': round }, 'the tint\'s corners: .3em inside the border');
  // The mark: on the line's first part along the bottom (after a reply's block header), on the line itself along the top
  // (renderer-css round 3: there the header sits before the message, and the mark before it).
  const Pb = P.replace('.layout-horizontal:not', '.layout-horizontal.align-bottom:not');
  const Pt = P.replace('.layout-horizontal:not', '.layout-horizontal.align-top:not');
  const markSel = Pb + D + ' > .reply + *::before,\n' + Pb + D + ' > :first-child:not(.reply)::before,\n' + Pt + D + '::before';
  const mark = rule(markSel);
  assert.deepStrictEqual(mark, { display: 'inline-block', width: 'var(--sep-w)', 'text-align': 'center',
    'margin-left': 'calc(-1 * (var(--sep-w) + var(--row-gap, 1em) + var(--sep-pad)))', 'margin-right': 'calc(var(--row-gap, 1em) + var(--sep-pad))' });
  assert.ok(css.indexOf('\n' + markSel) > css.lastIndexOf('margin-right: var(--row-gap, 1em);'), 'after the plain mark\'s gap, which it ties');
  // Each line's own padding: the bars' .4em, the tints' .3em, the announcement's .5em (the line's, over both).
  assert.match(css, /\n\.line\.accent \{[^}]*padding-left: \.4em;/);
  assert.match(css, /\n\.line\.announcement \{[^}]*padding-left: \.5em;/);
  // The numbers, at every row gap (spacing) and mark: the mark starts at the line's left edge, the bar right after the
  // border (the mark and the gap), and the name where its padding puts it. The clip room covers the widest border.
  const w = { 'sep-dot': 0.5, 'sep-bar': 0.36, 'sep-diamond': 0.86 };
  Object.keys(w).forEach((c) => assert.ok(css.indexOf('\n:where(.layout-horizontal.' + c + ') { --sep-w: ' + String(w[c]).replace(/^0/, '') + 'em; }') >= 0, c));
  [0.5, 1, 1.5, 2].forEach((g) => Object.keys(w).forEach((c) => [0.3, 0.4, 0.5].forEach((p) => {
    const border = w[c] + g, contentLeft = border + p;
    const markLeft = contentLeft - (w[c] + g + p), after = markLeft + w[c] + (g + p);
    assert.ok(Math.abs(markLeft) < 1e-9 && Math.abs(after - contentLeft) < 1e-9, g + ' ' + c + ' ' + p);
    assert.ok(5 >= border + 0.5, 'clip room for ' + c + ' at ' + g);
  })));
});

// renderer-css round 2: a kept mark used to stay for good, so the row could later show it in view before the first
// message with nothing ahead of it.
function keptRow(t, cfg, opts) {
  const o = opts || {};
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const doc = createDocument();
  let resized = null;
  doc.defaultView.ResizeObserver = function (cb) { resized = cb; this.observe = () => {}; this.disconnect = () => {}; };
  if (o.gap) doc.defaultView.getComputedStyle = () => ({ columnGap: o.gap + 'px' });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const r = renderer.createRenderer({ root: root, cfg: cfg, deps: o.deps || {} });
  t.after(() => r.destroy());
  const s = { doc, root, r, linesEl: root.firstElementChild, lines: () => root.firstElementChild.children,
    texts: () => root.firstElementChild.children.map((l) => l.byClass('message').map((m) => m.textContent).join('')),
    tick: (ms) => t.mock.timers.tick(ms), resize: () => { resized([]); t.mock.timers.tick(0); } };
  s.W = o.W || 300;
  rowLayout(s, () => s.W, o.gap);
  return s;
}
const classes = (s) => s.lines().map((l) => l.className);

// refilter (renderer-css round 4): a bot list that lands later takes the newer lines its bots sent (overlay.js), and no
// trim followed to drop the kept mark.
const hiddenIds = new Set();
[['clearMessage', (s, c) => s.r.clearMessage(c.id)], ['clearUser', (s, c) => s.r.clearUser(c.userId)],
  ['clearAll(pred)', (s, c) => s.r.clearAll((m) => m.id === c.id)],
  ['refilter', (s, c) => { hiddenIds.add(c.id); s.r.refilter(); }]].forEach(([how, del]) => {
  test('row_sep: a kept mark goes once deleting the newer lines brings its line into view with nothing before it: ' + how, (t) => {
    const s = keptRow(t, { layout: 'horizontal', animate: false, row_sep: 'bar' }, { deps: { shouldShow: (m) => !hiddenIds.has(m.id) } });
    s.r.push(chat('a', 'x'.repeat(7))); // 100 px
    s.r.push(chat('b', 'y'.repeat(17))); // 200 px
    s.r.flush();
    const c = chat('c', 'z'.repeat(12)); // 150 px: a ends at -50 and goes, b keeps its mark at -50..150
    s.r.push(c);
    s.r.flush();
    assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
    del(s, c); // b alone at 100..300: 100 px of empty row before its mark
    assert.deepStrictEqual(s.texts(), ['y'.repeat(17)]);
    assert.deepStrictEqual(classes(s), ['line'], 'in the same call, not a frame later');
    // It doesn't come back on a rerender (a keyword now marks b).
    s.r.setConfig({ layout: 'horizontal', animate: false, row_sep: 'bar', keywords: ['y'.repeat(17)] });
    assert.deepStrictEqual(classes(s), ['line keyword']);
  });
});

test('row_sep: a kept mark goes once a wider source brings its line into view with nothing before it', (t) => {
  const s = keptRow(t, { layout: 'horizontal', animate: false, row_sep: 'dot' });
  s.r.push(chat('a', 'x'.repeat(7)));
  s.r.push(chat('b', 'y'.repeat(17)));
  s.r.flush();
  s.r.push(chat('c', 'z'.repeat(12)));
  s.r.flush();
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
  s.W = 320; // b at -30..170: still out of view at the left edge, so it keeps its mark
  s.resize();
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
  s.W = 700; // b at 350..550
  s.resize();
  assert.deepStrictEqual(classes(s), ['line', 'line']);
});

test('row_sep: a kept mark stays while its line starts within the row\'s gap of the left edge (the line before it would still be out of view)', (t) => {
  // A 24 px gap between messages: c is 60 px, so b sits at 16..216 and a ends at -8, out of view, and is trimmed.
  const s = keptRow(t, { layout: 'horizontal', animate: false, row_sep: 'diamond' }, { gap: 24 });
  s.r.push(chat('a', 'x'.repeat(7)));
  s.r.push(chat('b', 'y'.repeat(17)));
  s.r.flush();
  s.r.push(chat('c', 'zzz'));
  s.r.flush();
  assert.deepStrictEqual(s.texts(), ['y'.repeat(17), 'zzz']);
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line'], 'b\'s mark, in view, stays');
  s.resize();
  s.r.setConfig({ layout: 'horizontal', animate: false, row_sep: 'diamond' });
  s.tick(0);
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line'], 'and stays on the next trim');
  // One more px of source puts b 17 px in: still within the gap.
  s.W = 301;
  s.resize();
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
});

[[{ layout: 'vertical' }, 'a switch to a column'], [{ row_sep: 'none' }, 'row_sep=none']].forEach(([change, what]) => {
  test('row_sep: ' + what + ' ends a kept mark, so a row drawn again marks only lines after another', (t) => {
    const row = { layout: 'horizontal', animate: false, row_sep: 'bar' };
    const s = keptRow(t, row);
    s.r.push(chat('a', 'x'.repeat(7)));
    s.r.push(chat('b', 'y'.repeat(17)));
    s.r.flush();
    s.r.push(chat('c', 'z'.repeat(12)));
    s.r.flush();
    assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
    s.r.setConfig(Object.assign({}, row, change));
    assert.deepStrictEqual(classes(s), ['line', 'line']);
    s.r.setConfig(row);
    assert.deepStrictEqual(classes(s), ['line', 'line']);
  });
});

test('overlay.css: a notice\'s row_sep mark, and the space after it, are the row\'s size, not its smaller text\'s', () => {
  const css = overlayCss();
  assert.match(css, /\n@property --row-em \{ syntax: '<length>'; inherits: true; initial-value: 0px; \}/);
  // On every row since follow-up round 1 (a notice's parts take their line height from it too, below).
  assert.ok(css.indexOf('\n:where(.layout-horizontal) { --row-em: 1em; }') > 0, 'set wherever a mark is drawn');
  // On its first part along the bottom, on the notice line itself along the top (renderer-css round 3).
  const rule = '\n:where(.layout-horizontal.align-bottom):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep).notice > ' +
    ':first-child::before,\n:where(.layout-horizontal.align-top):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep).notice::before ' +
    '{\n  font-size: var(--row-em);\n  line-height: 0;\n}';
  assert.ok(css.indexOf(rule) > css.indexOf('.time:first-child::before {\n  font-size: 1.25em;'), 'after the time\'s rule, which it ties');
  // Notices only (name_line's empty first line too, 1.6.1): a chat line's em is the row's.
  const uses = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => /var\(--row-em\)/.test(r[2]));
  assert.strictEqual(uses.length, 3);
  uses.forEach((r) => selectorList(r[1]).forEach((one) => assert.match(one, /\.notice\b/, one)));
});

test('overlay.css: in a row a notice\'s line keeps the row\'s size, so its text sits on the chat text\'s baseline', () => {
  // Follow-up round 1 (pre-existing): a row lines its messages up by their box's edge, and a notice's whole line was drawn
  // in notice_size's smaller em: its strut, padding and end spacer were shorter around its baseline, so its text sat 2.4 px
  // below the chat text on a bottom row and 3.5 px above it on a top row (5 px at notice_size=150).
  const css = overlayCss();
  const at = (s) => css.indexOf('\n' + s);
  assert.match(css, /\n\.line\.notice \{ font-size: var\(--notice-size, \.85em\); \}/, 'a column\'s notice as before');
  assert.ok(at(':where(.layout-horizontal) .line.notice { font-size: inherit; }') > at('.line.notice {'), 'after it, which it ties');
  // Its parts in notice_size (of the row's em now), its time .8 of that as anywhere; at the parts' own specificity or less,
  // so Custom CSS on .time or .message still wins; after .time's own rule.
  assert.ok(at(':where(.layout-horizontal .line.notice) > * { font-size: var(--notice-size, .85em); }') > 0);
  assert.ok(at(':where(.layout-horizontal .line.notice) > .time { font-size: calc(.8 * var(--notice-size, .85em)); }') > at('.time {'));
  // A bigger notice (notice_size above 100) along the bottom: its parts' lines never taller than a chat line, so it grows
  // upward only; along the top the row lines its messages up by their baseline.
  // With name_line (1.6.1) in either row: its text is on the line under an empty one.
  assert.match(css, /\n:where\(\.layout-horizontal\.align-bottom \.line\.notice\) > \*,\n:where\(\.layout-horizontal\.name-line:not\(\.no-names\) \.line\.notice\) > \* \{\n  line-height: min\(var\(--line-height, 1\.35\) \* var\(--row-em\), var\(--line-height, 1\.35\) \* 1em\);\n\}/);
  assert.match(css, /\n#chat\.layout-horizontal\.align-top \.lines \{ align-items: baseline; \}/);
  // line_width: a row's notice line is in the row's em, so its cap is --line-max (as a chat line's), after the column's.
  assert.ok(at(':where(.layout-horizontal).has-maxw .line.notice { max-width: min(100%, var(--line-max, 100%)); }') >
    at('.has-maxw .line.notice { max-width: min(100%, var(--line-max-n, var(--line-max, 100%))); }'));
});

// ---------- renderer-css follow-up fixes (round 1) ----------

test('timestamps: a resub\'s own line takes the time once its notice line is trimmed off the edge, and keeps it', (t) => {
  // A notice's text line shows no time while its notice is drawn. A filter sweep redrew it once the notice went, but the
  // trim (a column's top edge, a row's left edge) took the notice alone and redrew nothing: the line stayed without a time.
  const ts = new Date(2026, 0, 1, 15, 7).getTime();
  const s = setup(t, { timestamps: '24h', animate: false });
  colLayout(s, s, 100); // 30 px lines, newest at the bottom of a 100 px column
  const times = () => s.lines().map((l) => (l.byClass('time')[0] || { textContent: '' }).textContent);
  s.r.push(resub('cy', 'six months', { ts: ts }));
  s.r.push(chat('amy', 'one', { ts: ts }));
  s.r.flush();
  assert.deepStrictEqual(times(), ['15:07', '', '15:07'], 'the notice carries it');
  const own = s.lines()[1];
  // Two more lines: the notice ends at -20 px (out of view), its text line at 10 px (still in view).
  s.r.push(chat('amy', 'two', { ts: ts }));
  s.r.push(chat('amy', 'three', { ts: ts }));
  s.r.flush();
  s.tick(0);
  assert.deepStrictEqual(s.lines().map((l) => l.className), ['line', 'line', 'line', 'line'], 'the notice line went');
  assert.strictEqual(s.lines()[0], own, 'the same line element');
  assert.deepStrictEqual(times(), ['15:07', '15:07', '15:07', '15:07']);
  // Through a later rebuild too.
  s.r.setConfig({ timestamps: '24h', animate: false, name_sep: 'dash' });
  assert.deepStrictEqual(times(), ['15:07', '15:07', '15:07', '15:07']);
});

test('overlay.css: with names=0 a column\'s line may wrap after the time, so an emote too wide for the room after it fits', () => {
  // Follow-up round 1: names=0 hides the name and the colon (the only space after the time), so nothing let the line
  // wrap between the time and a gigantified emote, emote_only emote or GIF too wide for the rest of the row: it ran off
  // the line (52 px past a 360 px source).
  const css = overlayCss();
  assert.match(css, /\n:where\(\.layout-vertical\) \.time::after \{\n  content: '\\200B';\n  white-space: normal;\n\}/);
  // A zero-width space: the time keeps its size; never in a row (which never wraps), and no other ::after on .time.
  assert.deepStrictEqual(Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim()).filter((s) => /\.time::after/.test(s)),
    [':where(.layout-vertical) .time::after']);
  assert.match(/\n\.time \{([^}]*)\}/.exec(css)[1], /white-space: nowrap;/);
});

test('overlay.css: in a box a highlighted or tinted line keeps the box\'s .4em sides, and a barred line\'s bar side is never rounder than .4em', () => {
  // Follow-up round 1: `.line.highlight` (and the tints) set .3em at the sides and came after `.has-bg .line`'s .4em, at the
  // same specificity, so in a column of boxes their text started .1em left of every other box's.
  const css = overlayCss();
  const rule = (sel) => { const m = new RegExp('\\n' + sel.replace(/[.()]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css); assert.ok(m, sel); return m[1]; };
  const at = (s) => css.indexOf('\n' + s);
  assert.match(rule(':where(.has-bg) .line.highlight'), /\n  padding-left: \.4em;\n  padding-right: \.4em;\n/);
  assert.match(rule(':where(.has-bg) .line.mention,\n:where(.has-bg) .line.keyword,\n:where(.has-bg) .line.user-hl,\n:where(.has-bg) .line.role-tint'),
    /\n  padding-left: \.4em;\n  padding-right: \.4em;\n/);
  assert.match(rule('.has-bg .line'), /\n  padding: \.2em \.4em;\n/);
  // After the .3em rules and the bars' room, which they tie; before the announcement's .5em, which still wins.
  assert.ok(at(':where(.has-bg) .line.highlight {') > at('.line.highlight:where(.accent, .first-msg, .role-bar)'));
  assert.ok(at(':where(.has-bg) .line.mention,') > at('.line.mention:where(.accent, .first-msg, .role-bar),'));
  assert.ok(at(':where(.has-bg) .line.mention,') < at('.line.announcement {'));
  // Without a box the tints keep .3em (the column helper only reads rules on .line itself).
  ['highlight', 'mention', 'keyword', 'user-hl', 'role-tint'].forEach((c) => assert.strictEqual(linePadLeft(css, ['line', c]), '.3em', c));
  // bg_shape=pill: a bar is an inset shadow, which follows the corners, so its side is capped like the announcement's;
  // a tinted line keeps its .3em with round. (0,2,0), after every box rule that sets the corners.
  const bars = rule(':where(.has-bg) .line:is(.accent, .first-msg, .role-bar)');
  const tinted = rule(':where(.has-bg) .line:is(.accent, .first-msg, .role-bar):where(.highlight, .mention, .keyword, .user-hl, .role-tint)');
  assert.match(bars, /\n  border-top-left-radius: min\(var\(--bg-radius, \.4em\), \.4em\);\n  border-bottom-left-radius: min\(var\(--bg-radius, \.4em\), \.4em\);\n/);
  assert.match(tinted, /\n  border-top-left-radius: min\(var\(--bg-radius, \.3em\), \.4em\);\n  border-bottom-left-radius: min\(var\(--bg-radius, \.3em\), \.4em\);\n/);
  assert.ok(at(':where(.has-bg) .line:is(.accent') > at(':where(.has-bg) .line.mention,') &&
    at(':where(.has-bg) .line:is(.accent, .first-msg, .role-bar):where(') > at(':where(.has-bg) .line:is(.accent, .first-msg, .role-bar) {'));
});

// ---------- horizontal 1.6.1: name_line in a row, row_align, row_grow ----------

test('row_align and row_grow: a class on #chat only off their defaults, in either layout; row_align never redraws a line', (t) => {
  const s = setup(t, {});
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  const one = (k, v, more) => { s.r.setConfig(Object.assign({ [k]: v }, more)); return rootExtras(s); };
  assert.deepStrictEqual(['left', 'center', 'right'].map((v) => one('row_align', v).cls), [['row-left'], ['row-center'], []]);
  assert.deepStrictEqual([true, false].map((v) => one('row_grow', v).cls), [['row-grow'], []]);
  assert.deepStrictEqual(one('row_align', 'bogus'), { cls: [], style: {} }, 'a partial cfg\'s bad value is the default');
  // The stylesheet scopes them to a row; the classes stay across a layout switch, as text_align's and row_sep's do.
  assert.deepStrictEqual(one('row_align', 'center', { row_grow: true, layout: 'horizontal' }), { cls: ['row-center', 'row-grow'], style: {} });
  s.r.setConfig({ layout: 'horizontal' });
  assert.deepStrictEqual(rootExtras(s), { cls: [], style: {} });
  s.r.push(chat('amy', 'hi'));
  s.r.push(resub('bob', 'still here'));
  s.r.flush();
  const lines = () => JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  const before = lines();
  s.r.setConfig({ layout: 'horizontal', row_align: 'left' });
  assert.strictEqual(lines(), before);
});

// A row as the stylesheet lays it out with row_align: W px wide, gap px between messages, each character 10 px (as
// rowLayout). Messages that don't fill it sit at its left end, in its middle or at its right end; a full row ends at the
// right edge, its oldest messages past the left one. .lines has no padding here. moves: every slide's start offset.
function alignedRow(s, W, gap, align) {
  const width = typeof W === 'function' ? W : () => W;
  const g = gap || 0;
  s.doc.defaultView.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px', columnGap: g + 'px' });
  s.doc.layout = (el) => {
    const cw = width();
    if (el === s.root || el === s.linesEl) return { left: 0, right: cw, width: cw, top: 0, bottom: 50, height: 50 };
    const list = s.lines(), i = list.indexOf(el);
    if (i < 0) return null;
    const w = list.map((l) => l.textContent.length * 10);
    const free = cw - w.reduce((a, b) => a + b, 0) - g * (w.length - 1);
    let x = free < 0 ? free : align === 'left' ? 0 : align === 'center' ? free / 2 : free;
    for (let j = 0; j < i; j++) x += w[j] + g;
    return { left: x, right: x + w[i], width: w[i], top: 0, bottom: 50, height: 50 };
  };
  const moves = [];
  let tf = '';
  Object.defineProperty(s.linesEl.style, 'transform', { get: () => tf, set: (v) => { tf = v; if (v && v !== 'none') moves.push(v); } });
  return moves;
}

// Four 100 px messages one at a time into a 300 px row, then a fifth: the slide each new one starts (how far the newest
// old message moved left as it went in). The row fills at the third and overflows at the fourth.
[['right', ['translateX(100px)', 'translateX(100px)', 'translateX(100px)']],
  ['left', ['translateX(100px)']],
  ['center', ['translateX(50px)', 'translateX(50px)', 'translateX(100px)']]].forEach(([align, want]) => {
  test('row_align=' + align + ': a new message slides the row only as far as the old ones moved; once full, as at right', (t) => {
    const s = setup(t, { layout: 'horizontal', animate: true, row_align: align });
    const moves = alignedRow(s, 300, 0, align);
    ['a', 'b', 'c', 'd'].forEach((n) => { s.r.push(chat(n, 'x'.repeat(7))); s.r.flush(); s.tick(1000); });
    assert.deepStrictEqual(moves, want);
    assert.strictEqual(s.lines().length, 4, 'nothing trimmed: the first message is in view at the start of the last slide');
    // Full: the next one slides 100 px as at right, and the trim takes the message out of view at its start.
    s.r.push(chat('e', 'x'.repeat(7)));
    s.r.flush();
    assert.deepStrictEqual(moves.slice(want.length), ['translateX(100px)']);
    s.tick(1000);
    s.r.push(chat('f', ''));
    s.r.flush();
    assert.deepStrictEqual(s.lines().map((l) => l.textContent.charAt(0)), ['c', 'd', 'e', 'f']);
  });
});

// A message leaving a row that doesn't fill the source: at left the ones after it, at center all of them, glide into
// its room from where they were drawn (`left`, eased over SLIDE_MS) instead of jumping; nothing glides at right (the
// default) or with animate=0, and no inline style is left behind once the glide is over.
// Each message here is 130 px ('a: ' + 10 letters), 20 px apart: its room is 150 px (75 px each way at center).
[['left', { b: '150px', c: '150px' }], ['center', { a: '-75px', c: '75px' }], ['right', {}]].forEach(([align, want]) => {
  test('row_align=' + align + ': the messages left behind glide into a leaving message\'s room', (t) => {
    const s = setup(t, { layout: 'horizontal', animate: true, row_align: align });
    alignedRow(s, 600, 20, align);
    const msgs = ['a', 'b', 'c'].map((n) => chat(n, n.repeat(10)));
    msgs.forEach((m) => s.r.push(m));
    s.r.flush();
    s.tick(1000);
    // Each glide starts where the message was drawn (its offset from its new place)...
    const starts = {};
    s.lines().forEach((l) => {
      let v = '';
      Object.defineProperty(l.style, 'left', { configurable: true, get: () => v,
        set: (x) => { v = x; if (x && x !== '0px') starts[l.textContent.charAt(0)] = x; } });
    });
    s.r.clearMessage(msgs[align === 'left' ? 0 : 1].id);
    assert.deepStrictEqual(starts, want);
    // ...and is eased to 0.
    s.lines().forEach((l) => {
      const k = l.textContent.charAt(0);
      if (!want[k]) { assert.ok(!l.style.left, k + ' did not move'); return; }
      assert.strictEqual(l.style.position, 'relative');
      assert.strictEqual(l.style.left, '0px', k + ' eases home');
      assert.match(l.style.transition, /^left 250ms ease-out$/);
    });
    s.tick(400);
    s.lines().forEach((l) => {
      assert.ok(!l.style.left && !l.style.position && !l.style.transition, 'no inline glide style left on ' + l.textContent);
    });
  });
});

test('row_align=left: no glide with animate=0', (t) => {
  const s = setup(t, { layout: 'horizontal', animate: false, row_align: 'left' });
  alignedRow(s, 600, 20, 'left');
  const msgs = ['a', 'b'].map((n) => chat(n, n.repeat(10)));
  msgs.forEach((m) => s.r.push(m));
  s.r.flush();
  s.r.clearMessage(msgs[0].id);
  s.lines().forEach((l) => assert.ok(!l.style.left && !l.style.position));
});

// A trim that would leave the row short of the source moves the rest at once (to its left end, or half that), after
// the slide's offset was measured with them in: at left and center, a message out of view goes only once the row still
// fills the source without it.
[['right', ['b', 'c'], ['c', 'd'], ['c', 'd', 'e']], ['left', ['a', 'b', 'c'], ['b', 'c', 'd'], ['c', 'd', 'e']],
  ['center', ['a', 'b', 'c'], ['b', 'c', 'd'], ['c', 'd', 'e']]].forEach(([align, one, two, three]) => {
  test('row_align=' + align + ': the trim takes a message out of view only while the row still fills the source without it', (t) => {
    const s = setup(t, { layout: 'horizontal', animate: false, row_align: align });
    alignedRow(s, 300, 20, align);
    const first = () => s.lines().map((l) => l.textContent.charAt(0));
    // 100 + 20 + 100 + 20 + 170 = 410 px: a at -110..-10 is out of view, b starts at 10 (at 0 once a went, left aligned).
    s.r.push(chat('a', 'x'.repeat(7)));
    s.r.push(chat('b', 'y'.repeat(7)));
    s.r.push(chat('c', 'z'.repeat(14)));
    s.r.flush();
    assert.deepStrictEqual(first(), one);
    // d (100 px) pushes them further out: now a leaves the row still full.
    s.r.push(chat('d', 'w'.repeat(7)));
    s.r.flush();
    assert.deepStrictEqual(first(), two);
    s.r.push(chat('e', 'v'.repeat(7)));
    s.r.flush();
    assert.deepStrictEqual(first(), three);
  });
});

test('row_align=left: a kept row_sep mark goes once the row has room at its right end (its first message at the left, in view)', (t) => {
  const row = { layout: 'horizontal', animate: false, row_sep: 'bar', row_align: 'left' };
  const s = setup(t, row);
  let W = 300;
  alignedRow(s, () => W, 0, 'left');
  s.r.push(chat('a', 'x'.repeat(7))); // 100 px
  s.r.push(chat('b', 'y'.repeat(17))); // 200 px
  s.r.flush();
  const c = chat('c', 'z'.repeat(12)); // 150 px: a at -150..-50 goes (b at -50..150 still fills the row), b keeps its mark
  s.r.push(c);
  s.r.flush();
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
  // A wider source that the two still fill (350 px in 320): b at -30..170, the mark stays.
  W = 320;
  s.r.setConfig(row);
  s.tick(0);
  assert.deepStrictEqual(classes(s), ['line keep-sep', 'line']);
  // c deleted: b alone, at the left end of the row (0..200) with room after it. At right it would sit at 100..300, past
  // the gap after the left edge; at left it sits right there, so the room decides.
  s.r.clearMessage(c.id);
  assert.deepStrictEqual(s.texts(), ['y'.repeat(17)]);
  assert.deepStrictEqual(classes(s), ['line']);
});

test('row_grow: a live switch redraws a row\'s emote-only and gigantified lines from the files for their column size, and back', (t) => {
  const tw = (name) => ({ provider: 'twitch', name: name, w: 28, h: 28,
    urls: { 1: 'https://e/' + name + '/1', 2: 'https://e/' + name + '/2', 4: 'https://e/' + name + '/4' } });
  const s = setup(t, { layout: 'horizontal', emote_only: 'big' }, {
    tokensFor: (m) => (m.text === 'only' ? [{ type: 'emote', emote: tw('Kappa'), sp: false, overlays: [] }]
      : m.text === 'giant' ? [{ type: 'text', text: 'so big', sp: false }, { type: 'emote', emote: tw('Pog'), sp: true, big: true, overlays: [] }]
        : [{ type: 'text', text: 'hi', sp: false }, { type: 'emote', emote: tw('Kappa'), sp: true, overlays: [] }])
  });
  s.r.push(chat('amy', 'only'));
  s.r.push(chat('bob', 'giant'));
  s.r.push(chat('cy', 'words'));
  s.r.flush();
  const snap = () => s.lines().map((l) => [l.className].concat(l.byClass('emote-stack').map((e) => e.className + ' ' + e.firstElementChild.src)));
  const lines = () => JSON.stringify(s.lines().map((l) => [l.className, Object.assign({}, l.style), l.textContent]));
  const flat = [['line', 'emote-stack https://e/Kappa/2'], ['line', 'emote-stack big https://e/Pog/2'], ['line', 'emote-stack https://e/Kappa/2']];
  assert.deepStrictEqual(snap(), flat, 'a row: everything at emote height (42 px: the 2x files), the .big class kept');
  const before = lines();
  s.r.setConfig({ layout: 'horizontal', emote_only: 'big', row_grow: true });
  assert.deepStrictEqual(snap(), [['line emote-only', 'emote-stack https://e/Kappa/4'], ['line', 'emote-stack big https://e/Pog/4'],
    ['line', 'emote-stack https://e/Kappa/2']], '84 and 126 px: the 4x files; a line with words as before');
  assert.ok(s.root.classList.contains('row-grow'));
  s.r.setConfig({ layout: 'horizontal', emote_only: 'big' });
  assert.deepStrictEqual(snap(), flat);
  assert.strictEqual(lines(), before);
  assert.ok(!s.root.classList.contains('row-grow'));
});

test('overlay.css: name_line in a row makes each message a card of two lines, scoped to a row with names shown', () => {
  const css = overlayCss();
  const decls = (sel) => {
    const m = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => r[1].trim() === sel)[0];
    assert.ok(m, sel);
    const d = {};
    m[2].split(';').forEach((x) => { const i = x.indexOf(':'); if (i > 0) d[x.slice(0, i).trim()] = x.slice(i + 1).trim(); });
    return d;
  };
  const at = (s) => css.indexOf('\n' + s);
  const NL = ':where(.layout-horizontal.name-line:not(.no-names))';
  // The message: a box of its own on the line under the name, that never wraps (the row's white-space) and ends in an
  // ellipsis of its own, with room at its ends for an outline, a shadow or ink past them; at the left like a column's.
  assert.deepStrictEqual(decls(':where(.layout-horizontal.name-line:not(.no-names) .line:not(.notice)) > .message'), { display: 'block',
    'overflow-x': 'clip', 'text-overflow': 'ellipsis', padding: '0 calc(.1em + var(--tshadow-room, 0px))',
    margin: '0 calc(-.1em - var(--tshadow-room, 0px))', 'text-align': '-webkit-match-parent' });
  assert.match(css, /> \.message \{\n  display: block;\n  overflow-x: clip;\n  text-overflow: ellipsis;\n[^}]*text-align: left;\n  text-align: -webkit-match-parent;\n\}/);
  // The colon goes in either layout; the row's end-of-message box moves into the message (after the rule it ties).
  assert.match(css, /\n:where\(\.name-line:not\(\.no-names\) \.line:not\(\.notice\)\) \.colon \{ display: none; \}/);
  assert.deepStrictEqual(decls(NL + ' .line:not(.notice)::after'), { content: 'none' });
  assert.ok(at(NL + ' .line:not(.notice)::after {') > at('.layout-horizontal .line::after {'));
  // A right-to-left message is a block of its own anyway: no grid (after the grid's rule, which it ties).
  assert.deepStrictEqual(decls(NL + ' .line.rtl'), { display: 'block' });
  assert.ok(at(NL + ' .line.rtl {') > at(':where(.layout-horizontal) .line.rtl {'));
  // The name line: an empty box as tall as a badge, on the badges' middle line.
  assert.deepStrictEqual(decls(':where(.layout-horizontal.name-line:not(.no-names) .line:not(.notice)) > .name::after'),
    { content: '\'\'', 'line-height': 'var(--badge-h, 1em)', 'vertical-align': 'middle' });
  // A notice: an empty first line (a zero-width space) as tall as a name line, in the row's size; after the top row's
  // notice mark rule (line-height 0), which it ties.
  const notice = NL + ' :is(.line, .line + .line, .line.keep-sep).notice::before';
  assert.deepStrictEqual(decls(notice), { content: '\'\\200B\'', display: 'block', 'font-size': 'var(--row-em)',
    'line-height': 'max(var(--line-height, 1.35) * var(--row-em), var(--badge-h, 1em))' });
  assert.ok(at(notice + ' {') > at(':where(.layout-horizontal.align-bottom):where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep).notice > :first-child::before,'));
  // Along the top edge a reply's line is a grid: the mark, the header, the time, the badges and the name on its first
  // row (the header gives way, down to nothing; the name keeps its width), the message across the whole card under them.
  // After the flex row's rules.
  const G = ':where(.layout-horizontal.align-top.name-line:not(.no-names)) .line.inline-reply';
  assert.deepStrictEqual(decls(G), { display: 'grid', 'align-items': 'baseline',
    'grid-template-columns': 'max-content minmax(0, max-content) max-content max-content max-content minmax(0, 1fr)' });
  assert.deepStrictEqual([G + '::before', G + ' > .reply', G + ' > .time', G + ' > .badges', G + ' > .name', G + ' > .message']
    .map((sel) => decls(sel)['grid-area']), ['1 / 1', '1 / 2', '1 / 3', '1 / 4', '1 / 5', '2 / 1 / 3 / -1']);
  assert.ok(at(G + ' {') > at(':where(.layout-horizontal.align-top) .line.inline-reply > .message {'));
  // row_sep: the mark in a slot of its glyph's width, and the line under it as far in as the name after it (--sep-hang,
  // a length worked out on #chat); without a box a barred or tinted card has its mark in its border already.
  assert.match(css, /\n@property --sep-hang \{ syntax: '<length>'; inherits: true; initial-value: 0px; \}/);
  assert.deepStrictEqual(decls(NL + ':where(.sep-dot, .sep-bar, .sep-diamond)'), { '--sep-hang': 'calc(var(--sep-w) + var(--row-gap, 1em))' });
  assert.deepStrictEqual(decls(':where(.layout-horizontal.has-bg.name-line:not(.no-names)):where(.sep-dot, .sep-bar, .sep-diamond)'),
    { '--sep-hang': 'calc(var(--sep-w) + .5em)' });
  assert.deepStrictEqual(decls(NL + ':where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep):not(.notice) > .message'),
    { 'margin-left': 'calc(var(--sep-hang) - .1em - var(--tshadow-room, 0px))' });
  assert.deepStrictEqual(decls(NL + ':where(.sep-dot, .sep-bar, .sep-diamond) :is(.line + .line, .line.keep-sep).notice > :first-child'),
    { 'margin-left': 'var(--sep-hang)' });
  // Every rule naming .name-line: names shown, in a row (or the column's own two, and the colon's in either), never #chat.
  Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].trim()).forEach((s) => selectorList(s).forEach((one) => {
    if (!/name-line/.test(one)) return;
    assert.match(one, /\.name-line:not\(\.no-names\)/, one);
    assert.match(one, /^:where\((?:\.layout-horizontal[\w.:()-]*|\.layout-vertical\.name-line[^)]*\)?|\.name-line)/, one);
    assert.doesNotMatch(one, /#chat/, one);
  }));
});

test('overlay.css: row_align moves a row that isn\'t full with auto margins alone, which a full row never takes', () => {
  const css = overlayCss();
  const rows = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => /row-(?:left|center)/.test(r[1]))
    .map((r) => r[1].trim() + ' {' + r[2] + '}');
  assert.deepStrictEqual(rows, [':where(.layout-horizontal.row-left) .line:last-child { margin-right: auto; }',
    ':where(.layout-horizontal.row-center) .line:first-child { margin-left: auto; }',
    ':where(.layout-horizontal.row-center) .line:last-child { margin-right: auto; }']);
  // After `.layout-horizontal .line { margin: 0 }`, which they tie at (0,2,0); the row still packs at its end.
  assert.ok(css.indexOf('\n:where(.layout-horizontal.row-left)') > css.indexOf('\n.layout-horizontal .line {'));
  assert.match(css, /\n#chat\.layout-horizontal \.lines \{[^}]*justify-content: flex-end;/);
});

test('overlay.css: row_grow draws a row\'s big images at their column sizes, growing their message away from the row\'s edge', () => {
  const css = overlayCss();
  const at = (s) => css.indexOf('\n' + s);
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).filter((r) => /row-grow/.test(r[1]));
  assert.deepStrictEqual(rules.map((r) => r[1].trim()), ['.layout-horizontal:where(.row-grow) .emote-stack.big',
    '.layout-horizontal:where(.row-grow) .gif',
    ':where(.layout-horizontal.row-grow.align-bottom) :is(.emote-stack.big, .line.emote-only .emote-stack, .gif)',
    ':where(.layout-horizontal.row-grow.align-top) :is(.emote-stack.big, .line.emote-only .emote-stack, .gif)']);
  assert.strictEqual(rules[0][2].trim(), '--eh: calc(var(--emote-h, 1.75em) * 3);');
  assert.ok(at('.layout-horizontal:where(.row-grow) .emote-stack.big') > at('.layout-horizontal .emote-stack.big'), 'after the row\'s own, which it ties');
  assert.ok(at('.layout-horizontal:where(.row-grow) .gif') > at('.layout-horizontal .gif {'), 'after the row\'s own, which it ties');
  // The GIF's box (reserved up front, 16:9) at gif_size's height; its margins an emote's for that height (the row's own
  // rule with --emote-h times --gif-mul), so a 1x GIF is as the row draws it without row_grow.
  const H = 'var(--emote-h, 1.75em) * var(--gif-mul, 3)';
  const gif = rules[1][2].replace(/\s+/g, ' ');
  assert.ok(gif.indexOf('width: calc(' + H + ' * 16 / 9);') >= 0 && gif.indexOf('height: calc(' + H + ');') >= 0 &&
    gif.indexOf('max-height: calc(' + H + ');') >= 0, gif);
  const rowGif = /\n\.layout-horizontal \.gif \{[^}]*margin: ([^;]+);/.exec(css)[1].replace(/\s+/g, ' ');
  assert.strictEqual(/margin: ([^;]+);/.exec(gif)[1], rowGif.split('- var(--emote-h, 1.75em)').join('- ' + H));
  assert.deepStrictEqual(rules.slice(2).map((r) => r[2].trim()), ['vertical-align: bottom;', 'vertical-align: top;']);
  // Off (no class) the row is as before: GIFs and gigantified emotes at emote height.
  assert.match(css, /\n\.layout-horizontal \.emote-stack\.big \{ --eh: var\(--emote-h, 1\.75em\); \}/);
});
