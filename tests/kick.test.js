'use strict';
const test = require('node:test');
const assert = require('node:assert');
const kick = require('../js/kick.js');

// Minimal WebSocket stand-in driven by the test (same shape as tests/irc.test.js).
function fakeSockets() {
  const sockets = [];
  function FakeWS(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    sockets.push(this);
  }
  FakeWS.prototype.send = function (s) { this.sent.push(JSON.parse(s)); };
  FakeWS.prototype.close = function () { this.closed = true; };
  FakeWS.prototype.open = function () { if (this.onopen) this.onopen({}); };
  FakeWS.prototype.recv = function (frame) { if (this.onmessage) this.onmessage({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); };
  FakeWS.prototype.serverClose = function (code, reason) { if (this.onclose) this.onclose({ code: code || 1006, reason: reason || '' }); };
  return { WS: FakeWS, sockets: sockets };
}

function setup(t, room) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const f = fakeSockets();
  const events = [];
  const statuses = [];
  const client = kick.createKick({
    room: room === undefined ? '668' : room,
    WebSocket: f.WS,
    onEvent: (e) => events.push(e),
    onStatus: (s, d) => statuses.push([s, d])
  });
  client.start();
  return { f, events, statuses, client, sock: (i) => f.sockets[i], names: () => statuses.map((x) => x[0]) };
}

const CHANNEL = 'chatrooms.668.v2';
const ESTABLISHED = { event: 'pusher:connection_established', data: JSON.stringify({ socket_id: '1.2', activity_timeout: 120 }) };
const SUBSCRIBED = { event: 'pusher_internal:subscription_succeeded', data: '{}', channel: CHANNEL };

function chat(extra) {
  return Object.assign({
    id: '9d3f7c3e-1111-4222-8333-944455556666',
    chatroom_id: 668,
    content: 'hello [emote:37226:KEKW]',
    type: 'message',
    created_at: '2026-09-27T20:00:00+00:00',
    sender: { id: 12345, username: 'Some_Viewer', slug: 'some-viewer', identity: { color: '#E9113C', badges: [{ type: 'subscriber', text: 'Subscriber', count: 3 }, { type: 'moderator', text: 'Moderator' }] } }
  }, extra || {});
}
function frame(event, data, channel) {
  return { event: 'App\\Events\\' + event, data: JSON.stringify(data), channel: channel || CHANNEL };
}

// ---------- channel lookup and paste ----------
test('parseChannel reads the chatroom id, user id and safe sub badge images', () => {
  const c = kick.parseChannel({
    id: 668, user_id: 676, slug: 'xqc', chatroom: { id: 668 }, user: { username: 'xQc' },
    subscriber_badges: [
      { months: 6, badge_image: { src: 'https://files.kick.com/channel_subscriber_badges/2/original' } },
      { months: 1, badge_image: { src: 'https://files.kick.com/channel_subscriber_badges/1/original' } },
      { months: 3, badge_image: { src: 'https://evil.example/x.png' } },
      { months: 'x', badge_image: { src: 'https://files.kick.com/a' } }
    ]
  }, 'xqc');
  assert.deepStrictEqual(c, {
    chatroomId: '668', channelId: '668', userId: '676', slug: 'xqc', username: 'xQc',
    subBadges: [
      { months: 1, url: 'https://files.kick.com/channel_subscriber_badges/1/original' },
      { months: 6, url: 'https://files.kick.com/channel_subscriber_badges/2/original' }
    ]
  });
});

test('parseChannel refuses another channel, a missing chatroom and junk', () => {
  assert.strictEqual(kick.parseChannel({ slug: 'someone-else', chatroom: { id: 1 } }, 'xqc'), null);
  assert.strictEqual(kick.parseChannel({ slug: 'xqc', chatroom: {} }, 'xqc'), null);
  assert.strictEqual(kick.parseChannel({ slug: 'xqc', chatroom: { id: '1 OR 1' } }, 'xqc'), null);
  assert.strictEqual(kick.parseChannel(null, 'xqc'), null);
  assert.strictEqual(kick.parseChannel('text', 'xqc'), null);
  // A username's underscores are hyphens in its slug.
  assert.strictEqual(kick.parseChannel({ slug: 'adin-ross', chatroom: { id: 5 } }, 'adin_ross').chatroomId, '5');
  // The channel's own id (its recent messages are kept under it): its chatroom's often differs; junk gives ''.
  assert.strictEqual(kick.parseChannel({ id: 875396, slug: 'adinross', chatroom: { id: 875062 } }, 'adinross').channelId, '875396');
  assert.strictEqual(kick.parseChannel({ id: '1 OR 1', slug: 'xqc', chatroom: { id: 668 } }, 'xqc').channelId, '');
  assert.strictEqual(kick.parseChannel({ slug: 'xqc', chatroom: { id: 668 } }, 'xqc').channelId, '');
});

// Kick chat started empty ("Kick chat has no recent-message history"): kick.com keeps the newest ~25 under the channel's
// id, each a ChatMessageEvent's data (newest first, keyed chat_id = the channel id, without the chatroom id).
test('loadHistory: the channel\'s recent messages as historical lines of the joined chatroom, oldest first', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T12:00:00Z') });
  const calls = [];
  const item = (id, at, content, extra) => Object.assign({ id: id, chat_id: 875396, user_id: 5, content: content, type: 'message',
    metadata: null, created_at: at, sender: { id: 5, slug: 'fan', username: 'Fan', identity: { color: '#E9113C', badges: [] } } }, extra || {});
  let body = { status: { error: false }, data: { messages: [
    item('c3', '2026-10-08T11:59:30Z', 'newest [emote:37226:KEKW]'),
    item('c2', '2026-10-08T11:59:00Z', 'a reply', { type: 'reply', metadata: { original_sender: { id: 7, username: 'Pal' },
      original_message: { id: 'p1', content: 'hi' } } }),
    item('c1', '2026-10-08T11:58:00Z', 'oldest'),
    item('old', '2026-10-06T11:58:00Z', 'two days ago'),
    item('', '2026-10-08T11:58:00Z', 'no id'), 'junk', null, [1]
  ], cursor: '1', pinned_message: item('pin', '2026-10-08T11:00:00Z', 'pinned') } };
  const caches = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(url);
    caches.push(init && init.cache);
    const txt = typeof body === 'string' ? body : JSON.stringify(body);
    return { status: body === 404 ? 404 : 200, ok: body !== 404, headers: { get: () => null }, text: async () => txt };
  });
  const list = await kick.loadHistory('875396', '875062', { timeout: 3000 });
  // kick.com lets its answer be kept for 10 s, and Cloudflare's edge keeps it whatever the request asks: a copy from
  // before an outage (or from before the overlay joined) left out what was said and deleted since. Every request has an
  // address of its own, so the answer is kick.com's as of now; still a plain GET (no preflight).
  assert.match(calls[0], /^https:\/\/kick\.com\/api\/v2\/channels\/875396\/messages\?_=\d+$/);
  await kick.loadHistory('875396', '875062', { timeout: 3000 });
  assert.match(calls[1], /^https:\/\/kick\.com\/api\/v2\/channels\/875396\/messages\?_=\d+$/);
  assert.notStrictEqual(calls[1], calls[0], 'a second request in the same millisecond gets an address of its own');
  assert.deepStrictEqual(caches, [undefined, undefined]);
  calls.pop();
  assert.deepStrictEqual(list.map((m) => [m.id, m.roomId, m.text, m.historical]), [
    ['kick:c1', 'kick:875062', 'oldest', true], ['kick:c2', 'kick:875062', 'a reply', true], ['kick:c3', 'kick:875062', 'newest KEKW', true]]);
  assert.strictEqual(list[2].kickEmotes, '37226:7-10');
  assert.strictEqual(list[1].reply.name, 'Pal');
  assert.strictEqual(list[0].ts, Date.parse('2026-10-08T11:58:00Z'));
  // Nothing to load without both ids; none found, or an unexpected answer.
  assert.deepStrictEqual(await kick.loadHistory('', '875062'), []);
  assert.deepStrictEqual(await kick.loadHistory('1/../x', '875062'), []);
  assert.strictEqual(calls.length, 1);
  body = 404;
  assert.deepStrictEqual(await kick.loadHistory('875396', '875062'), []);
  body = { data: { messages: 'x' } };
  await assert.rejects(kick.loadHistory('875396', '875062'), /unexpected history response/);
});

// kick.com's list leaves out a deleted message and a banned user's, but a reply keeps its own copy of the message it
// answers: a reply quoting one said between the list's oldest and newest message, and not among them, put what a mod
// took away back on stream in its header. The reply says so (gone), and the overlay leaves the quote out.
test('loadHistory: a reply quoting a message kick.com left out of its list (inside its time span) is marked gone', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T12:00:00Z') });
  const at = (s) => '2026-10-08T11:' + s + '+00:00';
  const item = (id, time, extra) => Object.assign({ id: id, chat_id: 1, user_id: 5, content: 'x', type: 'message', metadata: null,
    created_at: time, sender: { id: 5, username: 'Fan', identity: { badges: [] } } }, extra || {});
  const reply = (id, time, pid, ptime) => item(id, time, { type: 'reply', metadata: JSON.stringify({
    original_sender: { id: 7, username: 'Troll' },
    original_message: Object.assign({ id: pid, content: 'removed words' }, ptime ? { created_at: ptime } : {}) }) });
  const messages = [
    item('newest', at('59:00')),
    reply('r-gone', at('58:00'), 'p-gone', at('50:00')), // inside the span, not in the list: deleted, or its sender banned
    reply('r-kept', at('57:00'), 'p-kept', at('45:00')), // in the list
    reply('r-old', at('56:00'), 'p-old', at('10:00')), // older than the list: nothing to judge it by
    reply('r-edge', at('55:00'), 'p-edge', at('40:00')), // the oldest's second (kick.com's times are to the second)
    reply('r-notime', at('54:00'), 'p-notime', null), // no time in the reply's data
    reply('r-junk', at('53:00'), 'p-junk', at('48:00')), // in the list, as an entry the overlay can't read
    item('p-junk', at('48:00'), { sender: null }),
    item('p-kept', at('45:00')),
    item('oldest', at('40:00'))
  ];
  t.mock.method(globalThis, 'fetch', async () => {
    const txt = JSON.stringify({ data: { messages: messages } });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => txt };
  });
  const list = await kick.loadHistory('875396', '875062');
  assert.deepStrictEqual(list.filter((m) => m.reply).map((m) => [m.id, !!m.reply.gone]), [
    ['kick:r-junk', false], ['kick:r-notime', false], ['kick:r-edge', false], ['kick:r-old', false], ['kick:r-kept', false],
    ['kick:r-gone', true]]);
  assert.ok(list.filter((m) => m.reply && m.id !== 'kick:r-gone').every((m) => !('gone' in m.reply)), 'others keep their shape');
  // The newest's second is no proof either.
  messages.unshift(reply('r-new', at('59:30'), 'p-new', at('59:30')));
  assert.ok(!('gone' in (await kick.loadHistory('875396', '875062')).pop().reply));
});

test('roomFromText takes the number or the whole channel API page', () => {
  assert.strictEqual(kick.roomFromText(' 668 '), '668');
  assert.strictEqual(kick.roomFromText(668), '668');
  assert.strictEqual(kick.roomFromText(JSON.stringify({ id: 1, slug: 'xqc', chatroom: { id: 668, chatable_type: 'x' } })), '668');
  assert.strictEqual(kick.roomFromText('... "chatroom":{"id":4598,"chatable_type":"App\\\\Models\\\\Channel" ... (cut off'), '4598');
  assert.strictEqual(kick.roomFromText('{"chatroom_id": 77, "oops"'), '77');
  ['', 'abc', '1'.repeat(13), '{"chatroom":{}}', null, undefined, true].forEach((v) => assert.strictEqual(kick.roomFromText(v), '', String(v)));
});

test('apiUrl builds the channel API link from a normalized name', () => {
  assert.strictEqual(kick.apiUrl('https://kick.com/XQC'), 'https://kick.com/api/v2/channels/xqc');
  assert.strictEqual(kick.apiUrl('<bad name>'), 'https://kick.com/api/v2/channels/');
});

test('lookupChannel: success, 404 (with the hyphen spelling tried) and a blocked request', async (t) => {
  const calls = [];
  let reply = () => ({ status: 200, body: { slug: 'xqc', user_id: 676, chatroom: { id: 668 }, user: { username: 'xQc' } } });
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    const r = reply(url);
    if (r.throws) throw new TypeError('Failed to fetch');
    const txt = JSON.stringify(r.body || {});
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: () => null }, text: async () => txt };
  });
  const c = await kick.lookupChannel('XQC');
  assert.strictEqual(c.chatroomId, '668');
  assert.strictEqual(calls[0], 'https://kick.com/api/v2/channels/xqc');

  calls.length = 0;
  reply = () => ({ status: 404 });
  assert.strictEqual(await kick.lookupChannel('adin_ross'), null);
  assert.deepStrictEqual(calls, ['https://kick.com/api/v2/channels/adin_ross', 'https://kick.com/api/v2/channels/adin-ross']);

  reply = () => ({ throws: true }); // what a CORS refusal looks like to fetch
  await assert.rejects(kick.lookupChannel('xqc'), /Failed to fetch/);
  reply = () => ({ status: 200, body: { slug: 'xqc' } });
  await assert.rejects(kick.lookupChannel('xqc'), /unexpected channel response/);
  await assert.rejects(kick.lookupChannel('bad name'), /invalid channel name/);
});

// ---------- messages ----------
test('splitEmotes turns [emote:id:name] into names plus code-point ranges', () => {
  assert.deepStrictEqual(kick.splitEmotes('hello'), { text: 'hello', emotes: '' });
  assert.deepStrictEqual(kick.splitEmotes('[emote:37226:KEKW] hi'), { text: 'KEKW hi', emotes: '37226:0-3' });
  // An emoji before an emote counts as one code point; repeats group under one id; adjacent emotes work.
  assert.deepStrictEqual(kick.splitEmotes('😀 [emote:1:a][emote:2:bb] [emote:1:a]'), { text: '😀 abb a', emotes: '1:2-2,6-6/2:3-4' });
  // Malformed tokens stay text.
  assert.deepStrictEqual(kick.splitEmotes('[emote:x:y] [emote:1:] [emote::a] [emote:1:a'), { text: '[emote:x:y] emote [emote::a] [emote:1:a', emotes: '1:12-16' });
  assert.deepStrictEqual(kick.splitEmotes(null), { text: '', emotes: '' });
  assert.strictEqual(kick.splitEmotes('x'.repeat(5000)).text.length, 2000);
});

// A Kick message can hold line breaks (BotRix: "CHECK YOUR CHAT RANK\nhttps://..."): the word after one was read together
// with the word before it, so a 7TV emote's name next to a line break was drawn as text.
test('splitEmotes: a line break or tab is a space, so the words beside it are read on their own; emote ranges stay', () => {
  assert.deepStrictEqual(kick.splitEmotes('GG\n[emote:37226:KEKW]\nKEKW\nnice'), { text: 'GG KEKW KEKW nice', emotes: '37226:3-6' });
  assert.deepStrictEqual(kick.splitEmotes('KEKW\r\n[emote:1:abc]\tKEKW'), { text: 'KEKW  abc KEKW', emotes: '1:6-8' });
  assert.strictEqual(kick.splitEmotes('a\u2028b\u2029c\u0085d\u000be\u000cf').text, 'a b c d e f');
  const tokenizer = require('../js/tokenizer.js');
  const kekw = { id: '7tv-kekw', code: 'KEKW', provider: '7tv', urls: { 1: 'https://cdn.7tv.app/emote/x/1x.webp' } };
  const m = kick.toMessage(chat({ content: 'GG\n[emote:37226:KEKW]\nKEKW\nnice' }));
  const items = tokenizer.tokenize(m, { lookup: (w) => (w === 'KEKW' ? kekw : null), bttvPrefixes: null, gifs: false }).items;
  assert.deepStrictEqual(items.map((i) => i.type === 'emote' ? 'emote:' + i.emote.provider : i.type + ':' + i.text),
    ['text:GG', 'emote:kick', 'emote:7tv', 'text:nice']);
  // A reply's quote goes through the same reading.
  const r = kick.toMessage(chat({ type: 'reply', metadata: { original_sender: { id: 7, username: 'Pal' },
    original_message: { id: 'p1', content: 'line one\nKEKW' } } }));
  assert.strictEqual(r.reply.body, 'line one KEKW');
});

test('toMessage builds a namespaced chat message', () => {
  const m = kick.toMessage(chat());
  assert.strictEqual(m.platform, 'kick');
  assert.strictEqual(m.kind, 'chat');
  assert.strictEqual(m.id, 'kick:9d3f7c3e-1111-4222-8333-944455556666');
  assert.strictEqual(m.userId, 'kick:12345');
  assert.strictEqual(m.roomId, 'kick:668');
  assert.strictEqual(m.login, 'some_viewer');
  assert.strictEqual(m.displayName, 'Some_Viewer');
  assert.strictEqual(m.color, '#E9113C');
  assert.strictEqual(m.text, 'hello KEKW');
  assert.strictEqual(m.kickEmotes, '37226:6-9');
  assert.strictEqual(m.emotes, '');
  assert.deepStrictEqual(m.badges, []);
  assert.deepStrictEqual(m.kickBadges, [{ type: 'subscriber', text: 'Subscriber', count: 3 }, { type: 'moderator', text: 'Moderator', count: 0 }]);
  assert.strictEqual(m.ts, Date.parse('2026-09-27T20:00:00+00:00'));
  assert.strictEqual(m.reply, null);
  assert.strictEqual(m.mirrored, false);
});

test('toMessage: replies (object or JSON-string metadata), bad colors, unknown badges, invalid ids', () => {
  const meta = { original_sender: { id: 7, username: 'Parent' }, original_message: { id: 'abc-1', content: 'hi [emote:5:Pog]' } };
  const r = kick.toMessage(chat({ type: 'reply', metadata: meta }));
  assert.deepStrictEqual(r.reply, { id: 'kick:abc-1', userId: 'kick:7', login: 'parent', name: 'Parent', body: 'hi Pog' });
  assert.deepStrictEqual(kick.toMessage(chat({ type: 'reply', metadata: JSON.stringify(meta) })).reply, r.reply);
  assert.strictEqual(kick.toMessage(chat({ type: 'reply', metadata: '{bad' })).reply, null);
  assert.strictEqual(kick.toMessage(chat({ type: 'message', metadata: meta })).reply, null);
  // The parent's sender with Kick's Bot badge (kick.com's data gives its badges, as the sender's or the message's): the
  // reply says so (bots=0 leaves the quote out). Only then, so other replies keep their shape.
  const botMeta = (where) => {
    const o = JSON.parse(JSON.stringify(meta));
    const ident = { color: '#53FC19', badges: [{ type: 'moderator' }, { type: 'bot', text: 'Bot' }] };
    if (where === 'sender') o.original_sender.identity = ident;
    else o.original_message.sender = { id: 7, username: 'Parent', identity: ident };
    return JSON.stringify(o);
  };
  assert.strictEqual(kick.toMessage(chat({ type: 'reply', metadata: botMeta('sender') })).reply.bot, true);
  assert.strictEqual(kick.toMessage(chat({ type: 'reply', metadata: botMeta('message') })).reply.bot, true);
  const plain = JSON.parse(JSON.stringify(meta));
  plain.original_sender.identity = { badges: [{ type: 'moderator' }, { type: 'verified' }] };
  assert.ok(!('bot' in kick.toMessage(chat({ type: 'reply', metadata: plain })).reply));
  // The quoted message's own time, when the reply's data gives it (kick.com's history does): kick.loadHistory judges by
  // it whether kick.com left the message out. Only then, so other replies keep their shape.
  const timed = JSON.parse(JSON.stringify(meta));
  timed.original_message.created_at = '2026-10-09T08:46:12+00:00';
  assert.strictEqual(kick.toMessage(chat({ type: 'reply', metadata: timed })).reply.ts, Date.parse('2026-10-09T08:46:12Z'));
  timed.original_message.created_at = 'soon';
  assert.ok(!('ts' in kick.toMessage(chat({ type: 'reply', metadata: timed })).reply));

  const s = chat().sender;
  const odd = kick.toMessage(chat({ sender: Object.assign({}, s, { identity: { color: 'red', badges: [{ type: 'weird' }, { type: 'VIP', count: -2 }, { type: 'vip' }] } }) }));
  assert.strictEqual(odd.color, '');
  assert.deepStrictEqual(odd.kickBadges, [{ type: 'vip', text: '', count: 0 }]);

  assert.strictEqual(kick.toMessage(chat({ id: '../x' })), null);
  assert.strictEqual(kick.toMessage(chat({ id: '' })), null);
  assert.strictEqual(kick.toMessage(chat({ sender: { id: 'a b', username: 'x' } })), null);
  assert.strictEqual(kick.toMessage(chat({ sender: { id: 1, username: '' } })), null);
  assert.strictEqual(kick.toMessage(null), null);
});

// tests/fixtures/kick-streamelements.json: a real frame from Kick's StreamElements bot (captured from Kick's Pusher socket,
// 2026-10-08). Its name is "@StreamElements", and it carries Kick's Bot badge, which the overlay doesn't draw.
test('a Kick name with a leading "@" (Kick\'s StreamElements bot) is matched without it; Kick\'s Bot badge marks a bot', () => {
  const f = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'kick-streamelements.json'), 'utf8'));
  const m = kick.parseEvent(f.event, f.data).msg;
  assert.strictEqual(m.login, 'streamelements', 'what block, allow_users and the bot list name');
  assert.strictEqual(m.displayName, '@StreamElements', 'shown as Kick sends it');
  assert.strictEqual(m.kickBot, true);
  assert.deepStrictEqual(m.kickBadges.map((b) => b.type), ['moderator', 'verified'], 'the Bot badge is not drawn');
  assert.ok(!('kickBot' in kick.toMessage(chat())), 'other messages keep their shape');
  assert.strictEqual(kick.toMessage(chat({ sender: { id: 3, username: 'x', identity: { badges: [{ type: 'BOT' }] } } })).kickBot, true);
  // A reply quoting it, a notice about it and a ban of it name it the same way.
  const meta = { original_sender: { id: 55807129, username: '@StreamElements' }, original_message: { id: 'abc-1', content: 'ad' } };
  const reply = kick.toMessage(chat({ type: 'reply', metadata: meta })).reply;
  assert.deepStrictEqual([reply.login, reply.name], ['streamelements', '@StreamElements']);
  const ban = kick.parseEvent('App\\Events\\UserBannedEvent', JSON.stringify({ user: { id: 5, username: '@Bot' } }));
  assert.deepStrictEqual(ban, { type: 'ban', userId: 'kick:5', login: 'bot' });
  assert.strictEqual(kick.parseEvent('App\\Events\\SubscriptionEvent', JSON.stringify({ username: '@Fan', months: 1 })).msg.login, 'fan');
  assert.deepStrictEqual(['@@x', 'Some_Viewer', '@', 'a@b'].map((s) => kick.loginOf(s)), ['x', 'some_viewer', '@', 'a@b']);
});

test('parseEvent maps every Kick event, with string or object data', () => {
  const ev = (name, d) => kick.parseEvent('App\\Events\\' + name, JSON.stringify(d));
  assert.strictEqual(ev('ChatMessageEvent', chat()).type, 'message');
  assert.strictEqual(kick.parseEvent('App\\Events\\ChatMessageEvent', chat()).msg.userId, 'kick:12345');
  assert.deepStrictEqual(ev('MessageDeletedEvent', { id: 'x', message: { id: 'abc-1' } }), { type: 'delete', id: 'kick:abc-1' });
  assert.deepStrictEqual(ev('UserBannedEvent', { id: 'x', user: { id: 55, username: 'Troll' }, permanent: true }), { type: 'ban', userId: 'kick:55', login: 'troll' });
  assert.deepStrictEqual(ev('ChatroomClearEvent', { id: 'x' }), { type: 'clear' });

  const sub = ev('SubscriptionEvent', { chatroom_id: 668, username: 'Fan', months: 1 });
  assert.strictEqual(sub.type, 'notice');
  assert.strictEqual(sub.msg.kind, 'notice');
  assert.strictEqual(sub.msg.type, 'sub');
  assert.strictEqual(sub.msg.systemMsg, 'Fan subscribed!');
  assert.strictEqual(sub.msg.login, 'fan');
  assert.strictEqual(sub.msg.platform, 'kick');
  assert.strictEqual(ev('SubscriptionEvent', { username: 'Fan', months: 7 }).msg.systemMsg, 'Fan subscribed for 7 months!');
  assert.strictEqual(ev('GiftedSubscriptionsEvent', { gifter_username: 'Rich', gifted_usernames: ['a', 'b', 'c'] }).msg.systemMsg, 'Rich gifted 3 subs!');
  assert.strictEqual(ev('GiftedSubscriptionsEvent', { gifter_username: 'Rich', gifted_usernames: ['Lucky'] }).msg.systemMsg, 'Rich gifted a sub to Lucky!');
  assert.strictEqual(ev('GiftedSubscriptionsEvent', { gifter_username: 'Rich', gifted_usernames: [] }), null);
  const host = ev('StreamHostEvent', { host_username: 'Friend', number_viewers: 42, optional_message: '' });
  assert.strictEqual(host.msg.type, 'raid');
  assert.strictEqual(host.msg.systemMsg, 'Friend is hosting with 42 viewers!');

  assert.strictEqual(ev('PollUpdateEvent', {}), null);
  assert.strictEqual(kick.parseEvent('pusher:ping', '{}'), null);
  assert.strictEqual(kick.parseEvent('App\\Events\\ChatMessageEvent', '{not json'), null);
  assert.strictEqual(kick.parseEvent('App\\Events\\ChatMessageEvent', 'x'.repeat(70000)), null);
  assert.strictEqual(kick.parseEvent(null, '{}'), null);
});

// ---------- Pusher client ----------
test('subscribes to the chatroom after connection_established and reports joined', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  assert.strictEqual(ws.url, kick.WS_URL);
  assert.match(ws.url, /^wss:\/\/ws-us2\.pusher\.com\/app\/[0-9a-f]+\?protocol=7&/);
  ws.open();
  assert.deepStrictEqual(ws.sent, []);
  ws.recv(ESTABLISHED);
  assert.deepStrictEqual(ws.sent, [{ event: 'pusher:subscribe', data: { auth: '', channel: CHANNEL } }]);
  ws.recv({ event: 'pusher_internal:subscription_succeeded', data: '{}', channel: 'chatrooms.1.v2' });
  assert.deepStrictEqual(s.names(), ['open']);
  ws.recv(SUBSCRIBED);
  ws.recv(SUBSCRIBED);
  assert.deepStrictEqual(s.names(), ['open', 'joined']);
  s.client.stop();
});

test('chat events on our channel reach onEvent; other channels and junk are ignored', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(ESTABLISHED);
  ws.recv(SUBSCRIBED);
  ws.recv(frame('ChatMessageEvent', chat()));
  ws.recv(frame('ChatMessageEvent', chat({ id: 'other-1' }), 'chatrooms.1.v2'));
  ws.recv('not json');
  ws.recv(JSON.stringify({ event: 'App\\Events\\ChatMessageEvent', channel: CHANNEL, data: JSON.stringify(chat({ content: 'x'.repeat(70000) })) }));
  ws.recv(frame('MessageDeletedEvent', { message: { id: 'abc-1' } }));
  assert.deepStrictEqual(s.events.map((e) => e.type), ['message', 'delete']);
  assert.strictEqual(s.events[0].msg.text, 'hello KEKW');
  s.client.stop();
});

test('answers pusher:ping, and pings after activity_timeout of silence', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: '1.2', activity_timeout: 30 }) });
  ws.sent.length = 0;
  ws.recv({ event: 'pusher:ping', data: {} });
  assert.deepStrictEqual(ws.sent, [{ event: 'pusher:pong', data: {} }]);
  ws.sent.length = 0;
  t.mock.timers.tick(25000);
  assert.deepStrictEqual(ws.sent, []);
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(ws.sent, [{ event: 'pusher:ping', data: {} }]);
  ws.recv({ event: 'pusher:pong', data: {} });
  t.mock.timers.tick(30000);
  assert.strictEqual(s.f.sockets.length, 1, 'answered: no reconnect');
  s.client.stop();
});

test('no pong within 30 s: reconnect', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(ESTABLISHED);
  t.mock.timers.tick(125000);
  assert.deepStrictEqual(ws.sent[ws.sent.length - 1], { event: 'pusher:ping', data: {} });
  t.mock.timers.tick(30000);
  assert.ok(ws.closed);
  assert.deepStrictEqual(s.names().slice(-1), ['closed']);
  t.mock.timers.tick(30000);
  assert.strictEqual(s.f.sockets.length, 2);
  s.client.stop();
});

test('pusher:error 4001 (app key refused) stops for good and reports fatal', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv({ event: 'pusher:error', data: { code: 4001, message: 'App key 32cb not in this cluster' } });
  assert.deepStrictEqual(s.statuses.slice(-1), [['fatal', { code: 4001, message: 'App key 32cb not in this cluster' }]]);
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 1);
});

test('close 4000-4099 stops; 4200-4299 reconnects at once; 4100-4199 backs off', (t) => {
  const s = setup(t);
  s.sock(0).open();
  s.sock(0).serverClose(4201);
  t.mock.timers.tick(0);
  assert.strictEqual(s.f.sockets.length, 2, '4201: reconnect now');
  s.sock(1).open();
  s.sock(1).serverClose(4100);
  t.mock.timers.tick(0);
  assert.strictEqual(s.f.sockets.length, 2, '4100: waits');
  t.mock.timers.tick(30000);
  assert.strictEqual(s.f.sockets.length, 3);
  s.sock(2).open();
  s.sock(2).serverClose(4004, 'over quota');
  assert.deepStrictEqual(s.names().slice(-1), ['fatal']);
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 3, '4004: never again');
});

test('an invalid chatroom id never connects', (t) => {
  const s = setup(t, 'abc');
  assert.strictEqual(s.f.sockets.length, 0);
  assert.deepStrictEqual(s.statuses, [['fatal', { code: 0, message: 'invalid chatroom id' }]]);
});
