'use strict';
const test = require('node:test');
const assert = require('node:assert');
const irc = require('../js/irc.js');

// Minimal WebSocket stand-in driven by the test.
function fakeSockets() {
  const sockets = [];
  function FakeWS(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    sockets.push(this);
  }
  FakeWS.prototype.send = function (s) { this.sent.push(s); };
  FakeWS.prototype.close = function () { this.closed = true; };
  FakeWS.prototype.open = function () { if (this.onopen) this.onopen({}); };
  FakeWS.prototype.recv = function (data) { if (this.onmessage) this.onmessage({ data: data }); };
  FakeWS.prototype.serverClose = function (code) { if (this.onclose) this.onclose({ code: code || 1006, reason: '' }); };
  return { WS: FakeWS, sockets: sockets };
}

function setup(t, channel) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const f = fakeSockets();
  const lines = [];
  const statuses = [];
  const client = irc.createIrc({
    channel: channel || 'xqc',
    WebSocket: f.WS,
    onLine: function (p) { lines.push(p); },
    onStatus: function (s, d) { statuses.push([s, d]); }
  });
  client.start();
  return { f: f, lines: lines, statuses: statuses, client: client, sock: function (i) { return f.sockets[i]; } };
}

const PRIV = '@badges=;color=#FF0000;display-name=Foo;emotes=;id=abc-123;room-id=71092938;tmi-sent-ts=1790299061671;user-id=42 ' +
  ':foo!foo@foo.tmi.twitch.tv PRIVMSG #xqc :hello world';
const ROOMSTATE = '@emote-only=0;followers-only=1440;r9k=0;room-id=71092938;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #xqc';

test('handshake lines are sent in order on open', function (t) {
  const s = setup(t, '#XQC');
  const ws = s.sock(0);
  assert.strictEqual(ws.url, 'wss://irc-ws.chat.twitch.tv:443');
  assert.deepStrictEqual(ws.sent, []);
  ws.open();
  assert.strictEqual(ws.sent.length, 4);
  assert.strictEqual(ws.sent[0], 'CAP REQ :twitch.tv/tags twitch.tv/commands');
  assert.strictEqual(ws.sent[1], 'PASS SCHMOOPIIE');
  assert.match(ws.sent[2], /^NICK justinfan\d{5}$/);
  assert.strictEqual(ws.sent[3], 'JOIN #xqc');
  assert.deepStrictEqual(s.statuses.map(function (x) { return x[0]; }), ['open']);
  s.client.stop();
});

test('server PING is answered with PONG and not passed to onLine', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv('PING :tmi.twitch.tv\r\n');
  assert.strictEqual(ws.sent[ws.sent.length - 1], 'PONG :tmi.twitch.tv');
  ws.recv('PING\r\n');
  assert.strictEqual(ws.sent[ws.sent.length - 1], 'PONG :tmi.twitch.tv');
  assert.strictEqual(s.lines.length, 0);
  s.client.stop();
});

test('client PING every 60s; PONG (with or without prefix) clears the timeout', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  t.mock.timers.tick(60000);
  assert.strictEqual(ws.sent[ws.sent.length - 1], 'PING :tco');
  ws.recv(':tmi.twitch.tv PONG tmi.twitch.tv :tco\r\n');
  t.mock.timers.tick(10000);
  assert.strictEqual(s.f.sockets.length, 1);
  assert.strictEqual(ws.closed, false);
  t.mock.timers.tick(50000);
  assert.strictEqual(ws.sent.filter(function (l) { return l === 'PING :tco'; }).length, 2);
  ws.recv('PONG :tmi.twitch.tv\r\n');
  t.mock.timers.tick(20000);
  assert.strictEqual(ws.closed, false);
  assert.strictEqual(s.f.sockets.length, 1);
  assert.strictEqual(s.lines.length, 0);
  s.client.stop();
});

test('missing PONG triggers exactly one reconnect', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  t.mock.timers.tick(60000); // PING sent
  t.mock.timers.tick(10000); // no PONG -> drop
  assert.strictEqual(ws.closed, true);
  assert.strictEqual(ws.onclose, null, 'old socket handlers are detached');
  const closed = s.statuses.filter(function (x) { return x[0] === 'closed'; });
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0][1].reason, 'pong timeout');
  t.mock.timers.tick(1000); // first backoff step is <= 1000 ms
  assert.strictEqual(s.f.sockets.length, 2);
  t.mock.timers.tick(300000); // nothing else fires while the new socket is still connecting
  assert.strictEqual(s.f.sockets.length, 2);
  const ws2 = s.sock(1);
  ws2.open();
  assert.strictEqual(ws2.sent[0], 'CAP REQ :twitch.tv/tags twitch.tv/commands');
  assert.strictEqual(ws2.sent[3], 'JOIN #xqc');
  s.client.stop();
});

test('RECONNECT triggers a jittered reconnect (<= 2 s) and old frames are ignored', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(':tmi.twitch.tv RECONNECT\r\n');
  assert.strictEqual(ws.closed, true);
  assert.strictEqual(s.f.sockets.length, 1);
  assert.deepStrictEqual(s.statuses[s.statuses.length - 1], ['closed', { code: 0, reason: 'server' }]);
  t.mock.timers.tick(2000);
  assert.strictEqual(s.f.sockets.length, 2);
  // a late RECONNECT/close from the old socket cannot reach the client any more
  assert.strictEqual(ws.onmessage, null);
  t.mock.timers.tick(60000);
  assert.strictEqual(s.f.sockets.length, 2);
  assert.strictEqual(s.lines.length, 0);
  s.client.stop();
});

test('server close reports closed and reconnects with backoff', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.serverClose(1006);
  const closed = s.statuses.filter(function (x) { return x[0] === 'closed'; });
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0][1].code, 1006);
  t.mock.timers.tick(1000);
  assert.strictEqual(s.f.sockets.length, 2);
  s.client.stop();
});

test('NOTICE * before 001 reconnects; after 001 it is a normal line', function (t) {
  const origWarn = console.warn;
  console.warn = function () {};
  t.after(function () { console.warn = origWarn; });
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(':tmi.twitch.tv NOTICE * :Improperly formatted auth\r\n');
  assert.strictEqual(ws.closed, true);
  assert.strictEqual(s.lines.length, 0);
  t.mock.timers.tick(1000);
  assert.strictEqual(s.f.sockets.length, 2);
  const ws2 = s.sock(1);
  ws2.open();
  ws2.recv(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!\r\n:tmi.twitch.tv NOTICE * :something\r\n');
  assert.strictEqual(ws2.closed, false);
  assert.deepStrictEqual(s.lines.map(function (p) { return p.command; }), ['001', 'NOTICE']);
  s.client.stop();
});

test('duplicate PRIVMSG/USERNOTICE ids are delivered once, even across reconnects', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(PRIV + '\r\n' + PRIV + '\r\n');
  ws.recv(PRIV + '\r\n');
  const un = '@id=un-1;msg-id=sub;system-msg=x;room-id=1 :tmi.twitch.tv USERNOTICE #xqc';
  ws.recv(un + '\r\n' + un + '\r\n');
  const noId = ':foo!foo@foo.tmi.twitch.tv PRIVMSG #xqc :no id';
  ws.recv(noId + '\r\n' + noId + '\r\n');
  assert.deepStrictEqual(s.lines.map(function (p) { return p.command + ':' + (p.tags.id || ''); }),
    ['PRIVMSG:abc-123', 'USERNOTICE:un-1', 'PRIVMSG:', 'PRIVMSG:']);
  ws.serverClose(1006);
  t.mock.timers.tick(1000);
  const ws2 = s.sock(1);
  ws2.open();
  ws2.recv(PRIV + '\r\n');
  assert.strictEqual(s.lines.length, 4);
  assert.strictEqual(s.client.markSeen('abc-123'), true);
  assert.strictEqual(s.client.markSeen('hist-1'), false);
  ws2.recv(PRIV.replace('id=abc-123', 'id=hist-1') + '\r\n');
  assert.strictEqual(s.lines.length, 4);
  s.client.stop();
});

test('multi-line frames are split in order; first ROOMSTATE per connection fires joined', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(':tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n' + ROOMSTATE + '\r\n' + PRIV + '\r\n' +
    '@ban-duration=30;room-id=71092938;target-user-id=42;tmi-sent-ts=1 :tmi.twitch.tv CLEARCHAT #xqc :foo\r\n');
  assert.deepStrictEqual(s.lines.map(function (p) { return p.command; }), ['CAP', 'ROOMSTATE', 'PRIVMSG', 'CLEARCHAT']);
  const joined = s.statuses.filter(function (x) { return x[0] === 'joined'; });
  assert.strictEqual(joined.length, 1);
  assert.strictEqual(joined[0][1].tags['room-id'], '71092938');
  ws.recv('@r9k=1;room-id=71092938 :tmi.twitch.tv ROOMSTATE #xqc\r\n');
  assert.strictEqual(s.statuses.filter(function (x) { return x[0] === 'joined'; }).length, 1);
  assert.strictEqual(s.lines[s.lines.length - 1].command, 'ROOMSTATE');
  s.client.stop();
});

test('a throwing onLine does not lose the rest of the frame', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const f = fakeSockets();
  const got = [];
  const origWarn = console.warn;
  console.warn = function () {};
  try {
    const client = irc.createIrc({
      channel: 'xqc', WebSocket: f.WS,
      onLine: function (p) { got.push(p.command); if (got.length === 1) throw new Error('boom'); }
    });
    client.start();
    f.sockets[0].open();
    f.sockets[0].recv(ROOMSTATE + '\r\n' + PRIV + '\r\n');
    assert.deepStrictEqual(got, ['ROOMSTATE', 'PRIVMSG']);
    client.stop();
  } finally {
    console.warn = origWarn;
  }
});

test('stop() closes the socket and prevents reconnects', function (t) {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  s.client.stop();
  assert.strictEqual(ws.closed, true);
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 1);
});

test('loadHistory fetches robotty and parses lines', async function (t) {
  const calls = [];
  const lines = [
    '@badges=;historical=1;id=h1;rm-received-ts=1790299061000;room-id=71092938;tmi-sent-ts=1790299061000;user-id=1;flags;user-type ' +
      ':a!a@a.tmi.twitch.tv PRIVMSG #xqc :hi',
    '@login=a;room-id=71092938;target-msg-id=h1;tmi-sent-ts=1790299062000;historical=1;rm-received-ts=1790299062000 :tmi.twitch.tv CLEARMSG #xqc :hi\r\n',
    42
  ];
  t.mock.method(globalThis, 'fetch', async function (url, init) {
    calls.push([url, init]);
    return { status: 200, ok: true, text: async function () { return JSON.stringify({ messages: lines, error: null, error_code: null }); } };
  });
  const out = await irc.loadHistory('XQC', 20);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'https://recent-messages.robotty.de/api/v2/recent-messages/xqc?limit=20');
  assert.strictEqual(calls[0][1].headers, undefined, 'simple GET, no custom headers');
  assert.deepStrictEqual(out.map(function (p) { return p.command; }), ['PRIVMSG', 'CLEARMSG']);
  assert.strictEqual(out[0].tags.historical, '1');
  assert.strictEqual(out[0].tags.flags, '');
  assert.strictEqual(out[1].params[1], 'hi');
});

test('loadHistory: invalid login or limit 0 skips the request; 404 gives []', async function (t) {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async function () {
    n++;
    return { status: 404, ok: false, text: async function () { return ''; } };
  });
  assert.deepStrictEqual(await irc.loadHistory('bad name!', 10), []);
  assert.deepStrictEqual(await irc.loadHistory('xqc', 0), []);
  assert.strictEqual(n, 0);
  assert.deepStrictEqual(await irc.loadHistory('xqc', 5), []);
  assert.strictEqual(n, 1);
});

test('loadHistory keeps only the newest `limit` lines and skips oversized entries', async function (t) {
  const line = function (id) {
    return '@historical=1;id=' + id + ';rm-received-ts=1;room-id=1;tmi-sent-ts=1;user-id=1 :a!a@a.tmi.twitch.tv PRIVMSG #xqc :hi';
  };
  const lines = [line('old1'), line('old2'), line('k1'), '@id=big;x=' + 'a'.repeat(20000) + ' :a!a@a PRIVMSG #xqc :x', line('k2'), line('k3')];
  t.mock.method(globalThis, 'fetch', async function () {
    return { status: 200, ok: true, text: async function () { return JSON.stringify({ messages: lines }); } };
  });
  const out = await irc.loadHistory('xqc', 4);
  assert.deepStrictEqual(out.map(function (p) { return p.tags.id; }), ['k1', 'k2', 'k3']);
});

test('loadHistory trims trailing CR/LF (linear trim) before parsing', async function (t) {
  const junk = '\n'.repeat(15000) + 'x'; // a newline run that is not trailing
  const trailing = ':tmi.twitch.tv PRIVMSG #xqc :ok' + '\r\n'.repeat(5000);
  t.mock.method(globalThis, 'fetch', async function () {
    return { status: 200, ok: true, text: async function () { return JSON.stringify({ messages: [junk, trailing, '\r\n\n'] }); } };
  });
  const out = await irc.loadHistory('xqc', 10);
  const ok = out.filter(function (p) { return p.command === 'PRIVMSG'; });
  assert.strictEqual(ok.length, 1);
  assert.strictEqual(ok[0].params[1], 'ok');
});
