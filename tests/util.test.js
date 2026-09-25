'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const util = require('../js/util.js');

describe('small helpers', () => {
  test('jitter and randInt stay within bounds', (t) => {
    let r = 0;
    t.mock.method(Math, 'random', () => r);
    assert.equal(util.jitter(0, 2000), 0);
    assert.equal(util.randInt(10000, 99999), 10000);
    r = 0.999999;
    assert.ok(util.jitter(0, 2000) < 2000);
    assert.equal(util.randInt(10000, 99999), 99999);
    t.mock.restoreAll();
    for (let i = 0; i < 500; i++) {
      const j = util.jitter(60000, 80000);
      assert.ok(j >= 60000 && j < 80000);
      const n = util.randInt(1, 3);
      assert.ok(n === 1 || n === 2 || n === 3);
    }
  });

  test('absUrl makes protocol-relative urls https', () => {
    assert.equal(util.absUrl('//cdn.frankerfacez.com/emote/1/1'), 'https://cdn.frankerfacez.com/emote/1/1');
    assert.equal(util.absUrl('https://a.example/x'), 'https://a.example/x');
    assert.equal(util.absUrl(''), null);
    assert.equal(util.absUrl(null), null);
    assert.equal(util.absUrl(5), null);
  });

  test('idStr normalizes ids to trimmed strings', () => {
    assert.equal(util.idStr(12345), '12345');
    assert.equal(util.idStr(' 42 '), '42');
    assert.equal(util.idStr(null), '');
    assert.equal(util.idStr(undefined), '');
    assert.equal(util.idStr(0), '0');
  });

  test('isSafeUrl requires https, an allowed host and no quote/paren/space/backslash/control chars', () => {
    const giphy = /(^|\.)giphy\.com$/;
    assert.equal(util.isSafeUrl('https://media2.giphy.com/media/3oFzm0o2jMKftsaBoc/giphy.gif?cid=abc&rid=giphy.gif&ct=g', giphy), true);
    assert.equal(util.isSafeUrl('https://giphy.com/x.gif', giphy), true);
    assert.equal(util.isSafeUrl('http://media.giphy.com/x.gif', giphy), false);
    assert.equal(util.isSafeUrl('https://evilgiphy.com/x.gif', giphy), false);
    assert.equal(util.isSafeUrl('https://giphy.com.evil.net/x.gif', giphy), false);
    assert.equal(util.isSafeUrl('https://media.giphy.com@evil.net/x.gif', giphy), false);
    assert.equal(util.isSafeUrl('https://media.giphy.com:8443/x.gif', giphy), false);
    ['"', "'", '(', ')', ' ', '\\', '<', '>', '\n', '\u0000', '\u007f'].forEach((c) => {
      assert.equal(util.isSafeUrl('https://media.giphy.com/x' + c + '.gif', giphy), false, 'char ' + JSON.stringify(c));
    });
    assert.equal(util.isSafeUrl('javascript:alert(1)'), false);
    assert.equal(util.isSafeUrl('//cdn.7tv.app/x.webp', /^cdn\.7tv\.app$/), false);
    assert.equal(util.isSafeUrl('https://CDN.7TV.APP/x.webp', /^cdn\.7tv\.app$/), true);
    assert.equal(util.isSafeUrl('https://a.example/' + 'x'.repeat(3000)), false);
    assert.equal(util.isSafeUrl(null), false);
    assert.equal(util.isSafeUrl('https://any.example/x'), true, 'no host filter means any https host');
  });

  test('Emitter delivers to every handler and survives a throwing one', (t) => {
    t.mock.method(console, 'warn', () => {});
    const e = new util.Emitter();
    const got = [];
    e.on('changed', (x) => got.push(['a', x]));
    e.on('changed', () => { throw new Error('boom'); });
    e.on('changed', (x) => got.push(['b', x]));
    e.emit('changed', { roomId: '1' });
    e.emit('nobody-listens', 1);
    assert.deepEqual(got, [['a', { roomId: '1' }], ['b', { roomId: '1' }]]);
  });
});

describe('LRU', () => {
  test('evicts the least recently used entry; get and set bump', () => {
    const l = new util.LRU(3);
    l.set('a', 1).set('b', 2).set('c', 3);
    assert.equal(l.get('a'), 1); // bump a
    l.set('d', 4); // evicts b
    assert.equal(l.has('b'), false);
    assert.deepEqual([...l.map.keys()], ['c', 'a', 'd']);
    l.set('c', 33); // re-set bumps c
    l.set('e', 5); // evicts a
    assert.deepEqual([...l.map.keys()], ['d', 'c', 'e']);
    assert.equal(l.get('c'), 33);
    assert.equal(l.size, 3);
  });

  test('peek does not bump; missing get does not insert; delete works', () => {
    const l = new util.LRU(2);
    l.set('x', 1).set('y', 2);
    assert.equal(l.peek('x'), 1);
    l.set('z', 3); // x was only peeked, so it is still the oldest
    assert.equal(l.has('x'), false);
    assert.equal(l.get('nope'), undefined);
    assert.equal(l.size, 2);
    assert.equal(l.delete('y'), true);
    assert.equal(l.size, 1);
  });
});

describe('pickScale', () => {
  const urls = { 1: 'u1', 2: 'u2', 4: 'u4' };
  test('returns the smallest scale >= want, else the largest', () => {
    assert.equal(util.pickScale(urls, 0), 'u1');
    assert.equal(util.pickScale(urls, 1), 'u1');
    assert.equal(util.pickScale(urls, 2), 'u2');
    assert.equal(util.pickScale(urls, 3), 'u4');
    assert.equal(util.pickScale(urls, 4), 'u4');
    assert.equal(util.pickScale(urls, 8), 'u4');
    assert.equal(util.pickScale({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' }, 3), 'c');
  });
  test('handles sparse maps (FFZ mod_urls with only "1") and empty values', () => {
    assert.equal(util.pickScale({ '1': 'only1' }, 4), 'only1');
    assert.equal(util.pickScale({ 2: 'u2', 4: 'u4' }, 1), 'u2');
    assert.equal(util.pickScale({ 1: 'u1', 2: null, 4: 'u4' }, 2), 'u4');
    assert.equal(util.pickScale({ 1: '', 2: undefined }, 1), null);
    assert.equal(util.pickScale({}, 2), null);
    assert.equal(util.pickScale(null, 2), null);
  });
});

describe('colors', () => {
  function contrastVsBlack(hex) {
    const rgb = util.parseHex(hex);
    const lin = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return (L + 0.05) / 0.05;
  }

  test('readableColor lightens dark colors (#0000FF) toward white', () => {
    const out = util.readableColor('#0000FF');
    assert.notEqual(out.toLowerCase(), '#0000ff');
    const a = util.parseHex('#0000FF');
    const b = util.parseHex(out);
    for (let i = 0; i < 3; i++) assert.ok(b[i] >= a[i], 'channel ' + i + ' did not get lighter');
    assert.ok(contrastVsBlack(out) > contrastVsBlack('#0000FF'));
    assert.ok(contrastVsBlack(out) >= 4.5, 'blue reaches 4.5:1 within 8 steps');
    assert.ok(contrastVsBlack(util.readableColor('#000000')) >= 4.5);
  });

  test('readableColor leaves already-readable colors unchanged', () => {
    assert.equal(util.readableColor('#FFFFFF').toLowerCase(), '#ffffff');
    assert.equal(util.readableColor('#1E90FF').toLowerCase(), '#1e90ff');
  });

  test('readableColor passes through unparseable input', () => {
    assert.equal(util.readableColor('red'), 'red');
    assert.equal(util.readableColor(''), '');
  });

  test('defaultColor is the Twitch palette by userId % 15 and is stable', () => {
    assert.equal(util.TWITCH_PALETTE.length, 15);
    assert.ok(util.TWITCH_PALETTE.includes('#008000'));
    assert.equal(util.defaultColor('71092938'), util.TWITCH_PALETTE[71092938 % 15]);
    assert.equal(util.defaultColor(71092938), util.defaultColor('71092938'));
    assert.equal(util.defaultColor('22484632', 'forsen'), util.defaultColor('22484632', 'forsen'));
  });

  test('defaultColor hashes non-numeric ids / logins deterministically', () => {
    const a = util.defaultColor('', 'somelogin');
    assert.ok(util.TWITCH_PALETTE.includes(a));
    assert.equal(util.defaultColor('', 'somelogin'), a);
    assert.equal(util.defaultColor(undefined, 'somelogin'), a);
    const d = util.defaultColor('demo-1');
    assert.ok(util.TWITCH_PALETTE.includes(d));
    assert.equal(util.defaultColor('demo-1'), d);
  });

  test('intToRgba decodes 7TV packed RGBA int32', () => {
    assert.equal(util.intToRgba(-1857617921), 'rgba(145,70,255,1)');
    assert.equal(util.intToRgba(-1), 'rgba(255,255,255,1)');
    assert.equal(util.intToRgba(970071807), 'rgba(57,210,30,1)');
    assert.equal(util.intToRgba(-33449217), 'rgba(254,1,154,1)');
    assert.equal(util.intToRgba(-16729089), 'rgba(255,0,187,1)');
    assert.equal(util.intToRgba(0x80808080 | 0), 'rgba(128,128,128,0.502)');
    assert.equal(util.intToRgba(null), null);
    assert.equal(util.intToRgba('5'), null);
    assert.equal(util.intToRgba(NaN), null);
  });
});

describe('fetchJson / postJson (fetch mocked)', () => {
  function respond(status, body) {
    return async () => new Response(body, { status });
  }

  test('GET sends no custom headers and omits credentials', async (t) => {
    let seen;
    t.mock.method(globalThis, 'fetch', async (url, init) => { seen = init; return new Response('{"a":1}', { status: 200 }); });
    const r = await util.fetchJson('https://api.example/x', { timeout: 5000 });
    assert.deepEqual(r, { a: 1 });
    assert.equal(seen.method, 'GET');
    assert.equal(seen.headers, undefined);
    assert.equal(seen.credentials, 'omit');
  });

  test('404 resolves to a notFound marker; 5xx rejects with HttpError; empty body is null', async (t) => {
    t.mock.method(globalThis, 'fetch', respond(404, '{"error":"nope"}'));
    const nf = await util.fetchJson('https://api.example/404');
    assert.equal(util.isNotFound(nf), true);
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', respond(503, 'down'));
    await assert.rejects(util.fetchJson('https://api.example/503'), (e) => e instanceof util.HttpError && e.status === 503);
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', respond(200, ''));
    assert.equal(await util.fetchJson('https://api.example/empty'), null);
    assert.equal(util.isNotFound(null), false);
  });

  test('times out through AbortController', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const p = util.fetchJson('https://api.example/slow', { timeout: 20000 });
    t.mock.timers.tick(8000); // headers timeout (8 s default)
    await assert.rejects(p, (e) => e.timeout === true);
  });

  test('postJson adds Content-Type and merges extra headers', async (t) => {
    let seen;
    t.mock.method(globalThis, 'fetch', async (url, init) => { seen = init; return new Response('{"data":{}}', { status: 200 }); });
    await util.postJson('https://gql.example/gql', { query: '{x}' }, { 'Client-ID': 'abc' }, { timeout: 1000 });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.headers['Content-Type'], 'application/json');
    assert.equal(seen.headers['Client-ID'], 'abc');
    assert.equal(seen.body, '{"query":"{x}"}');
  });
});

describe('loadWithRetry', () => {
  const flush = () => new Promise((r) => setImmediate(r));

  test('retries failures after 3 s then 10 s, and reports success once', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    let calls = 0;
    const done = [];
    const ctl = util.loadWithRetry('thing', () => { calls++; if (calls < 3) throw new Error('net'); return 'ok'; }, (r) => done.push(r));
    await flush();
    assert.equal(calls, 1);
    assert.equal(ctl.status, 'failed');
    t.mock.timers.tick(2999); await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(1); await flush();
    assert.equal(calls, 2);
    t.mock.timers.tick(10000); await flush();
    assert.equal(calls, 3);
    assert.deepEqual(done, ['ok']);
    assert.equal(ctl.status, 'ok');
    assert.equal(ctl.isDone(), true);
    t.mock.timers.tick(600000); await flush();
    assert.equal(calls, 3);
  });

  test('retryNow skips the wait; cancel stops retries', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    let calls = 0;
    const ctl = util.loadWithRetry('x', () => { calls++; return Promise.reject(new Error('fail')); });
    await flush();
    ctl.retryNow(); await flush();
    assert.equal(calls, 2);
    ctl.cancel();
    t.mock.timers.tick(600000); await flush();
    assert.equal(calls, 2);
  });
});

describe('Backoff', () => {
  test('exponential caps with jitter in [cap/2, cap], capped at max, reset()', (t) => {
    let r = 0;
    t.mock.method(Math, 'random', () => r);
    const lo = new util.Backoff(1000, 30000);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(() => lo.next()), [500, 1000, 2000, 4000, 8000, 15000, 15000]);
    r = 0.999999;
    const hi = new util.Backoff(1000, 30000);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(() => hi.next()), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    hi.reset();
    assert.equal(hi.next(), 1000);
  });

  test('random draws always stay within [cap/2, cap]', () => {
    const b = new util.Backoff(2000, 300000);
    for (let i = 0; i < 2000; i++) {
      const cap = Math.min(300000, 2000 * Math.pow(2, b.attempts));
      const d = b.next();
      assert.ok(d >= cap / 2 && d <= cap, d + ' not in [' + cap / 2 + ', ' + cap + ']');
      if (i % 25 === 24) b.reset();
    }
  });
});

describe('SocketClient', () => {
  function fakeWsFactory(opts) {
    const sockets = [];
    function FakeWS(url) {
      if (opts && opts.throwFirst && sockets.length === 0 && !FakeWS.threw) { FakeWS.threw = true; throw new Error('bad url'); }
      this.url = url;
      this.sent = [];
      this.closeCalls = 0;
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
      sockets.push(this);
    }
    FakeWS.prototype.send = function (s) { this.sent.push(s); };
    FakeWS.prototype.close = function () { this.closeCalls++; };
    // Browser-side events: they fire whatever handler is attached at that moment.
    FakeWS.prototype.fireOpen = function () { if (this.onopen) this.onopen({}); };
    FakeWS.prototype.fireMessage = function (d) { if (this.onmessage) this.onmessage({ data: d }); };
    FakeWS.prototype.fireError = function () { if (this.onerror) this.onerror({}); };
    FakeWS.prototype.fireClose = function (code) { if (this.onclose) this.onclose({ code: code || 1006 }); };
    return { FakeWS, sockets };
  }

  // Math.random -> 0 makes every backoff delay exactly cap/2 (base 1000: 500, 1000, 2000, ...).
  function setup(t, opts, wsOpts) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
    t.mock.method(Math, 'random', () => 0);
    t.mock.method(console, 'warn', () => {});
    const { FakeWS, sockets } = fakeWsFactory(wsOpts);
    const ev = { open: 0, messages: [], closes: [], ctl: null };
    const client = new util.SocketClient(Object.assign({
      name: 'test',
      url: 'wss://example.test/ws',
      WebSocket: FakeWS,
      baseDelay: 1000,
      maxDelay: 30000,
      stableMs: 60000,
      onOpen(ctl) { ev.open++; ev.ctl = ctl; },
      onMessage(d) { ev.messages.push(d); },
      onClose(e) { ev.closes.push(e.code); }
    }, opts));
    return { client, sockets, ev, tick: (ms) => t.mock.timers.tick(ms) };
  }

  test('connects, opens, sends through ctl and delivers messages', (t) => {
    const s = setup(t);
    s.client.start();
    assert.equal(s.sockets.length, 1);
    assert.equal(s.sockets[0].url, 'wss://example.test/ws');
    assert.equal(s.client.state, 'connecting');
    assert.equal(s.client.send('early'), false);
    s.sockets[0].fireOpen();
    assert.equal(s.client.state, 'open');
    assert.equal(s.client.isOpen(), true);
    assert.equal(s.ev.open, 1);
    assert.equal(s.ev.ctl.isOpen(), true);
    assert.equal(s.ev.ctl.send('PING :tco'), true);
    assert.equal(s.client.send('direct'), true);
    assert.deepEqual(s.sockets[0].sent, ['PING :tco', 'direct']);
    s.sockets[0].fireMessage('hello');
    assert.deepEqual(s.ev.messages, ['hello']);
    s.client.start(); // no-op while running
    assert.equal(s.sockets.length, 1);
  });

  test('url may be a function, evaluated per connection', (t) => {
    let n = 0;
    const s = setup(t, { url: () => 'wss://example.test/' + (++n) });
    s.client.start();
    s.sockets[0].fireClose();
    s.tick(500);
    assert.deepEqual(s.sockets.map((w) => w.url), ['wss://example.test/1', 'wss://example.test/2']);
  });

  test('close schedules exactly one reconnect after the backoff delay, and backoff grows', (t) => {
    const s = setup(t);
    s.client.start();
    s.sockets[0].fireOpen();
    s.sockets[0].fireClose(1006);
    assert.deepEqual(s.ev.closes, [1006]);
    assert.equal(s.client.state, 'waiting');
    s.tick(499);
    assert.equal(s.sockets.length, 1);
    s.tick(1);
    assert.equal(s.sockets.length, 2);
    s.sockets[1].fireClose(); // failed connect: next delay is 1000
    s.tick(999);
    assert.equal(s.sockets.length, 2);
    s.tick(1);
    assert.equal(s.sockets.length, 3);
    s.tick(600000);
    assert.equal(s.sockets.length, 3);
  });

  test('error + protocol reconnect + close produce exactly one new socket', (t) => {
    const s = setup(t);
    s.client.start();
    const ws0 = s.sockets[0];
    ws0.fireOpen();
    const ctl = s.ev.ctl;
    const queuedClose = ws0.onclose; // a browser may still deliver an already-queued close event
    ws0.fireError();
    assert.equal(s.client.state, 'open', 'error only logs');
    ctl.reconnect('server RECONNECT', { delay: 100 });
    assert.equal(s.client.state, 'waiting');
    assert.equal(ws0.closeCalls, 1, 'old socket is closed on teardown');
    assert.equal(ws0.onclose, null, 'old handlers are detached');
    ctl.reconnect('duplicate'); // stale gen: ignored
    s.client.scheduleReconnect('direct duplicate'); // already pending: ignored
    ws0.fireClose(1000); // detached: nothing happens
    queuedClose.call(ws0, { code: 1006 }); // gen guard: ignored
    assert.deepEqual(s.ev.closes, []);
    s.tick(99);
    assert.equal(s.sockets.length, 1);
    s.tick(1);
    assert.equal(s.sockets.length, 2);
    s.tick(600000);
    assert.equal(s.sockets.length, 2);
  });

  test('a reconnect requested from onClose wins over the default backoff (e.g. 7TV 4005)', (t) => {
    const s = setup(t, {
      onClose(e, ctl) { if (e.code === 4005) ctl.reconnect('rate limited', { delay: 70000 }); }
    });
    s.client.start();
    s.sockets[0].fireOpen();
    s.sockets[0].fireError();
    s.sockets[0].fireClose(4005);
    s.tick(69999);
    assert.equal(s.sockets.length, 1);
    s.tick(1);
    assert.equal(s.sockets.length, 2);
    s.tick(600000);
    assert.equal(s.sockets.length, 2);
  });

  test('repeated server-requested reconnects escalate through the backoff', (t) => {
    const s = setup(t);
    s.client.start();
    const at = []; // delay before each new socket appears
    let prev = 0;
    for (let i = 0; i < 7; i++) {
      s.sockets[i].fireOpen();
      s.ev.ctl.reconnect('server RECONNECT', { delay: 100 });
      let waited = 0;
      while (s.sockets.length === i + 1) { s.tick(100); waited += 100; }
      at.push(waited);
      assert.ok(waited >= prev, 'delays never shrink: ' + at.join(','));
      prev = waited;
    }
    // Math.random = 0: first uses the requested 100 ms, then 1000, 2000, 4000, ... capped at maxDelay/2.
    assert.deepEqual(at, [100, 1000, 2000, 4000, 8000, 15000, 15000]);
    s.client.stop();
  });

  test('a single server-requested reconnect after a stable period keeps its small delay', (t) => {
    const s = setup(t);
    s.client.start();
    // Escalate first: an unstable phase of repeated requests.
    for (let i = 0; i < 3; i++) {
      s.sockets[i].fireOpen();
      s.ev.ctl.reconnect('server RECONNECT', { delay: 100 });
      s.tick(5000);
    }
    assert.equal(s.sockets.length, 4);
    assert.ok(s.client.backoff.attempts >= 3);
    // Now stay connected for stableMs: the next request uses the requested jitter again.
    s.sockets[3].fireOpen();
    s.tick(60000);
    assert.equal(s.client.backoff.attempts, 0);
    s.ev.ctl.reconnect('server RECONNECT', { delay: 100 });
    s.tick(99);
    assert.equal(s.sockets.length, 4);
    s.tick(1);
    assert.equal(s.sockets.length, 5);
    s.client.stop();
  });

  test('a larger explicit delay is kept even while the backoff is escalated', (t) => {
    const s = setup(t);
    s.client.start();
    s.sockets[0].fireOpen();
    s.ev.ctl.reconnect('server RECONNECT', { delay: 100 });
    s.tick(100);
    s.sockets[1].fireOpen();
    s.ev.ctl.reconnect('rate limited', { delay: 70000 }); // backoff says 1000; 70000 wins
    s.tick(69999);
    assert.equal(s.sockets.length, 2);
    s.tick(1);
    assert.equal(s.sockets.length, 3);
    s.client.stop();
  });

  test('gen guard: events and ctl calls from a replaced socket are ignored', (t) => {
    const s = setup(t);
    s.client.start();
    const ws0 = s.sockets[0];
    const h = { open: ws0.onopen, message: ws0.onmessage, error: ws0.onerror, close: ws0.onclose };
    ws0.fireOpen();
    const ctl0 = s.ev.ctl;
    ws0.fireClose();
    s.tick(500);
    const ws1 = s.sockets[1];
    ws1.fireOpen();
    assert.equal(s.ev.open, 2);
    h.message.call(ws0, { data: 'stale' });
    h.open.call(ws0, {});
    h.error.call(ws0, {});
    h.close.call(ws0, { code: 1006 });
    assert.deepEqual(s.ev.messages, []);
    assert.equal(s.ev.open, 2);
    assert.deepEqual(s.ev.closes, [1006]); // only the real close of ws0
    assert.equal(s.client.state, 'open');
    assert.equal(ctl0.send('x'), false);
    assert.equal(ctl0.isOpen(), false);
    ctl0.reconnect('stale');
    ctl0.stop('stale');
    assert.equal(s.client.state, 'open');
    assert.deepEqual(ws1.sent, []);
    s.tick(600000);
    assert.equal(s.sockets.length, 2);
  });

  test('stop() while waiting cancels the pending reconnect', (t) => {
    const s = setup(t);
    s.client.start();
    s.sockets[0].fireClose();
    assert.equal(s.client.state, 'waiting');
    s.client.stop('bye');
    assert.equal(s.client.state, 'stopped');
    s.tick(600000);
    assert.equal(s.sockets.length, 1);
  });

  test('stop() while open closes the socket and a late close does not reconnect', (t) => {
    const s = setup(t);
    s.client.start();
    const ws = s.sockets[0];
    ws.fireOpen();
    const lateClose = ws.onclose;
    s.client.stop();
    assert.equal(ws.closeCalls, 1);
    assert.equal(ws.onclose, null);
    lateClose.call(ws, { code: 1000 });
    ws.fireClose(1000);
    s.tick(600000);
    assert.equal(s.sockets.length, 1);
    assert.equal(s.client.send('x'), false);
    s.client.kick(); // kick only acts while waiting
    assert.equal(s.sockets.length, 1);
    s.client.start(); // a stopped client can be started again
    assert.equal(s.sockets.length, 2);
  });

  test('ctl.stop() from onClose prevents the reconnect (e.g. 7TV 4001)', (t) => {
    const s = setup(t, { onClose(e, ctl) { if (e.code === 4001) ctl.stop('fatal'); } });
    s.client.start();
    s.sockets[0].fireOpen();
    s.sockets[0].fireClose(4001);
    assert.equal(s.client.state, 'stopped');
    s.tick(600000);
    assert.equal(s.sockets.length, 1);
  });

  test('backoff resets only after stableMs of an open connection', (t) => {
    const s = setup(t);
    s.client.start();
    s.sockets[0].fireClose(); s.tick(500); // attempt 1
    s.sockets[1].fireClose(); s.tick(1000); // attempt 2
    s.sockets[2].fireClose(); s.tick(2000); // attempt 3
    assert.equal(s.sockets.length, 4);
    // Opens but drops 1 ms before stableMs: backoff keeps growing (next delay 4000).
    s.sockets[3].fireOpen();
    s.tick(59999);
    s.sockets[3].fireClose();
    s.tick(3999);
    assert.equal(s.sockets.length, 4);
    s.tick(1);
    assert.equal(s.sockets.length, 5);
    // Stays open for stableMs: the next drop starts from the base delay again.
    s.sockets[4].fireOpen();
    s.tick(60000);
    assert.equal(s.client.backoff.attempts, 0);
    s.sockets[4].fireClose();
    s.tick(499);
    assert.equal(s.sockets.length, 5);
    s.tick(1);
    assert.equal(s.sockets.length, 6);
  });

  test('ctl timers are cleared on teardown and never fire for a dead connection', (t) => {
    let ticks = 0, fired = 0;
    const s = setup(t, {
      onOpen(ctl) {
        ctl.setInterval(() => ticks++, 1000);
        ctl.setTimeout(() => fired++, 5000);
      }
    });
    s.client.start();
    s.sockets[0].fireOpen();
    s.tick(2500);
    assert.equal(ticks, 2);
    assert.equal(s.client.timers.length, 3); // interval + timeout + stable-reset timer
    s.sockets[0].fireClose();
    assert.equal(s.client.timers.length, 0);
    s.tick(10000); // the reconnect happens, but the new socket never opens
    assert.equal(ticks, 2);
    assert.equal(fired, 0);
  });

  test('ctl.setTimeout removes itself once fired; ctl.clearTimer cancels', (t) => {
    let fired = 0, cleared = 0;
    const s = setup(t, {
      onOpen(ctl) {
        ctl.setTimeout(() => fired++, 1000);
        const id = ctl.setInterval(() => cleared++, 100);
        ctl.clearTimer(id);
      }
    });
    s.client.start();
    s.sockets[0].fireOpen();
    assert.equal(s.client.timers.length, 2); // timeout + stable-reset timer
    s.tick(1000);
    assert.equal(fired, 1);
    assert.equal(cleared, 0);
    assert.equal(s.client.timers.length, 1);
  });

  test('kick() reconnects at once while waiting and resets the backoff', (t) => {
    const s = setup(t);
    s.client.start();
    s.sockets[0].fireClose(); s.tick(500);
    s.sockets[1].fireClose(); // waiting 1000 ms
    s.client.kick();
    assert.equal(s.sockets.length, 3);
    assert.equal(s.client.backoff.attempts, 0);
    s.tick(600000); // the cancelled timer must not fire
    assert.equal(s.sockets.length, 3);
    s.sockets[2].fireOpen();
    s.client.kick(); // no-op while open
    assert.equal(s.sockets.length, 3);
  });

  test('a throwing WebSocket constructor schedules a reconnect', (t) => {
    const s = setup(t, {}, { throwFirst: true });
    s.client.start();
    assert.equal(s.sockets.length, 0);
    assert.equal(s.client.state, 'waiting');
    s.tick(500);
    assert.equal(s.sockets.length, 1);
    assert.equal(s.client.state, 'connecting');
  });
});

test('VERSION matches package.json and every ?v= cache buster', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pkg = require('../package.json');
  assert.strictEqual(require('../js/util.js').VERSION, pkg.version);
  for (const page of ['overlay.html', 'index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const vs = [...html.matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
    assert.ok(vs.length > 0, page + ' has cache busters');
    vs.forEach((v) => assert.strictEqual(v, pkg.version, page + ' ?v=' + v));
  }
});
