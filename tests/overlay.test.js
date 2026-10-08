'use strict';
// Boots the real js/overlay.js in Node. Network loaders, IRC, sockets and the renderer are replaced by
// recording stubs; everything else (config, parsing, rooms, tokenizer, loader retries) is the real code.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'js');
// overlay.html order
const ORDER = ['util', 'config', 'irc-parse', 'badge-resolve', 'paint-css', 'tokenizer', 'irc', 'kick', 'twitch-badges',
  'seventv', 'bttv', 'ffz', 'extra-badges', 'rooms', 'icons', 'renderer', 'demo', 'overlay'];
const HOME = '100';
const PARTNER = '200';

function fakeEl(tag) {
  return {
    tagName: tag, hidden: true, textContent: '', children: [], parentNode: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
  };
}

const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise((r) => setImmediate(r)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

// opts: { search, settings, errors, stubs(T, h) }  ->  harness h
async function boot(t, opts) {
  opts = opts || {};
  if (!t.timersOn) { // a test may boot twice; an older boot's timers only touch its own state
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1e12 });
    t.timersOn = true;
  }
  const warn = console.warn;
  const log = console.log;
  console.warn = function () {};
  console.log = function () {};
  t.after(() => {
    console.warn = warn;
    console.log = log;
    ['TCO', 'TCO_NO_AUTOBOOT', 'TCO_SETTINGS', '__tcoErrors', 'document', 'location', 'parent', 'addEventListener']
      .forEach((k) => { delete globalThis[k]; });
  });
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(JS)) delete require.cache[k]; });
  delete globalThis.TCO;

  const h = {
    calls: [], pushed: [], cleared: [], rerenders: 0, refilters: 0, listeners: {}, links: [],
    els: { chat: fakeEl('div'), hint: fakeEl('div'), debug: fakeEl('div') },
    irc: null, kick: null, stv: null, bttvLive: null, lookupWants: [], clearPreds: [],
    called(name) { return this.calls.filter((c) => c[0] === name); },
    feed(raw) { this.irc.receive(globalThis.TCO.ircParse.parseLine(raw)); },
    S() { return globalThis.TCO.overlay.state(); }
  };
  const head = fakeEl('head');
  head.appendChild = function (c) { c.parentNode = this; h.links.push(c); return c; };
  globalThis.document = {
    readyState: 'complete',
    head: head,
    getElementById: (id) => h.els[id] || null,
    createElement: (tag) => fakeEl(tag)
  };
  globalThis.TCO_NO_AUTOBOOT = true;
  globalThis.location = { search: 'search' in opts ? opts.search : '?channel=home' };
  globalThis.parent = globalThis;
  globalThis.addEventListener = (type, fn) => { (h.listeners[type] = h.listeners[type] || []).push(fn); };
  if (opts.settings) globalThis.TCO_SETTINGS = opts.settings;
  if (opts.errors) globalThis.__tcoErrors = opts.errors;

  ORDER.forEach((n) => require(path.join(JS, n + '.js')));
  const T = globalThis.TCO;

  function stub(obj, name, label, impl) {
    obj[name] = function () {
      const args = Array.from(arguments);
      h.calls.push([label].concat(args));
      return impl.apply(null, args);
    };
  }
  const ok = (v) => () => Promise.resolve(typeof v === 'function' ? v() : v);
  const never = () => new Promise(() => {});
  stub(T.twitchBadges, 'loadGlobal', 'twitch-global', ok(() => new Map()));
  stub(T.twitchBadges, 'loadChannel', 'twitch-channel', ok(() => new Map()));
  stub(T.twitchBadges, 'lookupUser', 'lookupUser', (login) => Promise.resolve({ id: HOME, login: login, displayName: login, logo: null, banned: false }));
  stub(T.twitchBadges, 'lookupUserById', 'lookupUserById', (id) => Promise.resolve({ id: id, login: 'u' + id, displayName: 'U' + id, logo: null }));
  stub(T.seventv, 'loadGlobal', '7tv-global', ok(() => new Map()));
  stub(T.seventv, 'loadChannel', '7tv-channel', ok(() => ({ emotes: new Map(), setId: null, ownerId: null })));
  stub(T.seventv, 'loadCatalog', '7tv-catalog', never);
  stub(T.seventv, 'loadSet', '7tv-set', ok(() => new Map()));
  stub(T.bttv, 'loadGlobal', 'bttv-global', ok(() => ({ emotes: new Map(), prefixes: new Set() })));
  stub(T.bttv, 'loadChannel', 'bttv-channel', ok(() => ({ emotes: new Map(), bots: new Set() })));
  stub(T.bttv, 'loadStaffBadges', 'bttv-badges', ok(() => new Map()));
  stub(T.ffz, 'loadGlobal', 'ffz-global', ok(() => new Map()));
  stub(T.ffz, 'loadRoom', 'ffz-room', ok(() => ({ emotes: new Map(), modUrls: null, vipUrls: null, userBadges: new Map() })));
  stub(T.ffz, 'loadBadges', 'ffz-badges', ok(() => ({ defs: new Map(), users: new Map() })));
  stub(T.extraBadges, 'loadChatterino', 'chatterino', ok(() => new Map()));
  stub(T.extraBadges, 'loadFfzap', 'ffzap', ok(() => new Map()));
  stub(T.extraBadges, 'loadHomiesSource', 'homies', (i, into) => Promise.resolve(into));
  stub(T.irc, 'loadHistory', 'history', ok(() => []));
  // Kick's channel API is refused by default (what a CORS / Cloudflare block looks like).
  stub(T.kick, 'lookupChannel', 'kick-lookup', () => Promise.reject(new TypeError('Failed to fetch')));
  T.kick.createKick = function (o) {
    h.kick = { opts: o, started: 0, kicks: 0, start() { this.started++; }, kick() { this.kicks++; },
      send(event, data) { o.onEvent(globalThis.TCO.kick.parseEvent('App\\Events\\' + event, JSON.stringify(data))); } };
    return h.kick;
  };
  T.irc.createIrc = function (o) {
    const seen = new Set();
    h.irc = {
      onLine: o.onLine, onStatus: o.onStatus, kicks: 0,
      start() {}, kick() { this.kicks++; },
      markSeen(id) { const had = seen.has(id); seen.add(id); return had; },
      // like irc.js: a live PRIVMSG id is remembered (and a repeat dropped) before onLine
      receive(p) {
        if (p.command === 'PRIVMSG' && p.tags.id) { if (seen.has(p.tags.id)) return; seen.add(p.tags.id); }
        o.onLine(p);
      }
    };
    return h.irc;
  };
  const createState = T.seventv.createState;
  T.seventv.createState = function (o) { h.onSetSwitch = o.onSetSwitch; h.stvStateOpts = o; return createState(o); };
  T.seventv.createEventClient = function (o) {
    h.stv = { opts: o, kicks: 0, objects: [], removed: [], addChannel() {}, start() {},
      addObject(type, id) { this.objects.push(id); }, removeObject(type, id) { this.removed.push(id); }, kick() { this.kicks++; } };
    return h.stv;
  };
  T.seventv.createLookup = function () { return { want(uid) { h.lookupWants.push(uid); } }; };
  T.bttv.createLive = function (o) { h.bttvLive = { opts: o, kicks: 0, start() {}, kick() { this.kicks++; } }; return h.bttvLive; };
  T.renderer.createRenderer = function (o) {
    h.deps = o.deps;
    return {
      push(m) { if (!o.deps.shouldShow(m)) return false; h.pushed.push(m); return true; },
      clearUser(u) { h.cleared.push('user:' + u); },
      clearAll(pred) {
        if (pred) { h.clearPreds.push(pred); h.cleared.push('some'); } else h.cleared.push('all');
      },
      clearMessage(id) { h.cleared.push('msg:' + id); },
      rerender(pred) {
        h.rerenders++;
        h.pushed.forEach((m) => { if (typeof pred === 'function') pred(m); });
        return 0;
      },
      refilter() { h.refilters++; h.pushed = h.pushed.filter((m) => o.deps.shouldShow(m)); },
      setConfig() {}, hold() {}, hasUser() { return false; }, stats() { return null; }
    };
  };
  if (opts.stubs) opts.stubs(T, h);
  T.overlay.boot();
  await settle();
  return h;
}

// IRC helpers
let n = 0;
function priv(login, text, extra, room) {
  n++;
  const tags = Object.assign({ id: 'm' + n, 'user-id': 'u-' + login, 'display-name': login, 'room-id': room || HOME }, extra || {});
  const t = Object.keys(tags).map((k) => k + '=' + tags[k]).join(';');
  return '@' + t + ' :' + login + '!' + login + '@' + login + '.tmi.twitch.tv PRIVMSG #home :' + text;
}
function usernotice(msgId, login, text, extra) {
  n++;
  const tags = Object.assign({ id: 'n' + n, 'msg-id': msgId, login: login, 'user-id': 'u-' + login, 'display-name': login,
    'room-id': HOME, 'system-msg': 'sys' }, extra || {});
  const t = Object.keys(tags).map((k) => k + '=' + tags[k]).join(';');
  return '@' + t + ' :tmi.twitch.tv USERNOTICE #home' + (text ? ' :' + text : '');
}
const ROOMSTATE = '@room-id=' + HOME + ' :tmi.twitch.tv ROOMSTATE #home';
function join(h) { h.irc.onStatus('joined', globalThis.TCO.ircParse.parseLine(ROOMSTATE)); }
const texts = (h) => h.pushed.map((m) => m.text);

test('filters: block list, known bots, !commands (also as replies); replies to blocked users lose the quote', async (t) => {
  const h = await boot(t, { search: '?channel=home&block=spammer&hide_commands=1' });
  join(h);
  h.feed(priv('nightbot', 'bot line'));
  h.feed(priv('spammer', 'spam'));
  h.feed(priv('viewer', '!points'));
  h.feed(priv('viewer', '@Nightbot !discord', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'nightbot', 'reply-parent-display-name': 'Nightbot' }));
  h.feed(priv('viewer', '@Nightbot', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'nightbot', 'reply-parent-display-name': 'Nightbot' }));
  h.feed(priv('viewer', '@spammer lol', { 'reply-parent-msg-id': 'y', 'reply-parent-user-login': 'spammer', 'reply-parent-display-name': 'spammer', 'reply-parent-msg-body': 'blocked\\swords' }));
  h.feed(priv('viewer', 'real line'));
  assert.deepStrictEqual(texts(h), ['@Nightbot', '@spammer lol', 'real line']);
  assert.ok(h.pushed[0].reply, 'a normal reply keeps its header');
  assert.strictEqual(h.pushed[1].reply, null, 'the blocked user\'s words are not quoted');
});

test('bots=0: the BTTV bot lists (home, and a Shared Chat partner\'s) are applied, also to lines already shown', async (t) => {
  const bttv = deferred();
  const h = await boot(t, {
    stubs(T) {
      const orig = T.bttv.loadChannel;
      T.bttv.loadChannel = function (id, o) {
        orig(id, o);
        if (id === HOME) return bttv.promise;
        return Promise.resolve({ emotes: new Map(), bots: new Set(['partnerbot']) });
      };
    }
  });
  join(h);
  h.feed(priv('custombot', 'early bot line'));
  assert.deepStrictEqual(texts(h), ['early bot line']);
  bttv.resolve({ emotes: new Map(), bots: new Set(['custombot']) });
  await settle();
  assert.ok(h.refilters >= 1, 'lines on screen are filtered again once the bot list lands');
  assert.deepStrictEqual(texts(h), []);
  h.feed(priv('partnerbot', 'first', { 'source-room-id': PARTNER }));
  await settle();
  h.feed(priv('partnerbot', 'second', { 'source-room-id': PARTNER }));
  assert.ok(!texts(h).includes('second'), 'the partner\'s own bot list hides its bot');
});

test('badges_homies=0 and stv_lookup=0 are honoured; hidden chatters are never looked up', async (t) => {
  let h = await boot(t, { search: '?channel=home&hide_commands=1' });
  join(h);
  h.feed(priv('viewer', 'hi'));
  h.feed(priv('cmdonly', '!gamble'));
  t.mock.timers.tick(20000);
  await settle();
  // one retrying loader per Homies list, all filling one index
  assert.deepStrictEqual(h.called('homies').map((c) => c[1]), [0, 1, 2].slice(0, globalThis.TCO.extraBadges.HOMIES_COUNT));
  assert.strictEqual(new Set(h.called('homies').map((c) => c[2])).size, 1);
  assert.deepStrictEqual(h.lookupWants, ['u-viewer'], 'a filtered chatter is not queued for a 7TV lookup');

  h = await boot(t, { search: '?channel=home&badges_homies=0&stv_lookup=0' });
  join(h);
  h.feed(priv('viewer', 'hi'));
  t.mock.timers.tick(20000);
  await settle();
  assert.strictEqual(h.called('homies').length, 0);
  assert.deepStrictEqual(h.lookupWants, []);
});

test('homies_lists=light loads only the two small Homies lists, never the chatterinohomies.com one', async (t) => {
  const h = await boot(t, { search: '?channel=home&homies_lists=light' });
  const EB = globalThis.TCO.extraBadges;
  assert.deepStrictEqual([EB.HOMIES_COUNT, EB.HOMIES_LIGHT_COUNT], [3, 2]);
  join(h);
  t.mock.timers.tick(20000);
  await settle();
  assert.deepStrictEqual(h.called('homies').map((c) => c[1]), [0, 1]);
  assert.strictEqual(h.S().cfg.homies_lists, 'light');
  // It isn't a live setting: the builder reloads the preview for it, and a live message can't change it.
  assert.strictEqual(globalThis.TCO.config.LIVE_KEYS.indexOf('homies_lists'), -1);
});

test('paints: the renderer gets the still-frame rule from the paint data, next to the usual one', async (t) => {
  const h = await boot(t);
  const pc = globalThis.TCO.paintCss;
  const img = (url, frames) => ({ url: url, mime: 'image/webp', scale: 1, frameCount: frames });
  const base = 'https://cdn.7tv.app/paint/P1/layer/L1/';
  const p = pc.fromV4({ id: 'P1', data: { layers: [{ ty: { __typename: 'PaintLayerTypeImage',
    images: [img(base + '1x.webp', 30), img(base + '1x_static.webp', 1)] } }] } });
  h.S().stv.paints.set('P1', p);
  assert.strictEqual(h.deps.paintRule('P1'), pc.ruleFor(p));
  assert.strictEqual(h.deps.paintStaticRule('P1'), '.paint-static .painted.p-P1{background-image:url("' + base + '1x_static.webp")}');
  assert.strictEqual(h.deps.paintStaticRule('nope'), null);
});

test('BTTV channel data: skipped with emotes_bttv=0 and bots=1, loaded for the bot list with bots=0', async (t) => {
  let h = await boot(t, { search: '?channel=home&emotes_bttv=0&bots=1' });
  join(h);
  await settle();
  assert.strictEqual(h.called('bttv-channel').length, 0);
  h = await boot(t, { search: '?channel=home&emotes_bttv=0' });
  join(h);
  await settle();
  assert.strictEqual(h.called('bttv-channel').length, 1);
});

test('events: a community gift shows once; bits badge text is readable; Shared Chat resub text shows', async (t) => {
  const h = await boot(t);
  join(h);
  h.feed(usernotice('submysterygift', 'gifter', '', { 'msg-param-community-gift-id': 'G1' }));
  for (let i = 0; i < 5; i++) h.feed(usernotice('subgift', 'gifter', '', { 'msg-param-community-gift-id': 'G1' }));
  assert.strictEqual(h.pushed.filter((m) => m.kind === 'notice').length, 1);

  h.pushed.length = 0;
  h.feed(usernotice('sharedchatnotice', 'partnerviewer', 'partner resub message', { 'source-msg-id': 'resub', 'source-room-id': PARTNER }));
  h.feed(usernotice('sharedchatnotice', 'homeviewer', 'home copy', { 'source-msg-id': 'resub', 'source-room-id': HOME }));
  assert.deepStrictEqual(h.pushed.map((m) => m.kind + ':' + m.text), ['chat:partner resub message']);

  h.pushed.length = 0;
  h.feed(usernotice('bitsbadgetier', 'cheerer', '', { 'system-msg': 'bits\\sbadge\\stier\\snotification', 'msg-param-threshold': '1000' }));
  assert.strictEqual(h.pushed[0].systemMsg, 'cheerer just earned a new 1K Bits badge!');
});

test('rerenders are coalesced: 50 change events -> one pass', async (t) => {
  const h = await boot(t);
  join(h);
  await settle();
  t.mock.timers.tick(200);
  const before = h.rerenders;
  for (let i = 0; i < 50; i++) h.S().bus.emit('changed', { userId: 'u' + i });
  t.mock.timers.tick(119);
  assert.strictEqual(h.rerenders, before);
  t.mock.timers.tick(1);
  assert.strictEqual(h.rerenders, before + 1);
});

test('history: only chat/moderation lines replay, moderated and duplicate lines are skipped, live lines wait in order', async (t) => {
  const hist = deferred();
  const h = await boot(t, {
    search: '?channel=home&history=50',
    stubs(T) {
      T.irc.loadHistory = (l, lim, o) => { h0.args = [l, lim, o]; return hist.promise; };
      T.twitchBadges.lookupUser = () => new Promise(() => {}); // slow IVR: history lands before the room id is known
    }
  });
  h.feed(priv('live', 'live one', { id: 'dup' }));
  h.feed('@room-id=' + HOME + ';target-user-id=u-troll :tmi.twitch.tv CLEARCHAT #home :troll');
  h.feed(priv('live', 'live two'));
  assert.deepStrictEqual(texts(h), [], 'live chat waits for history');
  const P = globalThis.TCO.ircParse.parseLine;
  hist.resolve([
    P('@room-id=666 :tmi.twitch.tv ROOMSTATE #home'),
    P('@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #home :x'),
    P(usernotice('resub', 'old', 'old resub')),
    P(priv('old', 'deleted', { 'rm-deleted': '1', id: 'gone' })),
    P(priv('troll', 'old troll line')),
    P(priv('old', 'old line')),
    P(priv('live', 'live one', { id: 'dup' }))
  ]);
  await settle();
  join(h);
  assert.strictEqual(h.S().homeId, HOME, 'a history ROOMSTATE cannot set the home room');
  assert.strictEqual(h.els.hint.hidden, true, 'a history NOTICE shows nothing');
  assert.deepStrictEqual(texts(h), ['old troll line', 'old line', 'live one', 'live two']);
  // the moderated history line is recorded as deleted (replies quoting it get no header)
  assert.deepStrictEqual(h.cleared, ['msg:gone', 'user:u-troll'], 'the buffered live CLEARCHAT runs after history, in order');
  assert.deepStrictEqual(h0.args[2], { timeout: 4000 }, 'the request is aborted when the overlay stops waiting');
});
const h0 = {};

test('history: on by default with 5 lines; history=0 (URL or settings.js) and demo=1 make no request', async (t) => {
  let h = await boot(t);
  assert.deepStrictEqual(h.called('history'), [['history', 'home', 5, { timeout: 4000 }]]);

  h = await boot(t, { search: '?channel=home&history=0' });
  assert.strictEqual(h.called('history').length, 0, 'history=0 never asks recent-messages');
  assert.strictEqual(h.S().historyPending, false);
  join(h);
  h.feed(priv('viewer', 'live line'));
  assert.deepStrictEqual(texts(h), ['live line'], 'live chat is not held back');

  h = await boot(t, { search: '?channel=home&demo=1' });
  assert.strictEqual(h.called('history').length, 0, 'the demo loads no history');
  assert.strictEqual(h.irc, null, 'the demo does not connect to chat');

  // last: boot() leaves TCO_SETTINGS in place until the test ends
  h = await boot(t, { settings: { history: 0 } });
  assert.strictEqual(h.called('history').length, 0, 'settings.js can turn it off');
});

test('history (default): a slow or failing recent-messages service holds live chat back for 4 s at most', async (t) => {
  let h = await boot(t, { stubs(T) { T.irc.loadHistory = () => new Promise(() => {}); } });
  join(h);
  h.feed(priv('viewer', 'live one'));
  assert.deepStrictEqual(texts(h), [], 'live chat waits for history');
  t.mock.timers.tick(3999);
  assert.deepStrictEqual(texts(h), []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(texts(h), ['live one']);
  h.feed(priv('viewer', 'live two'));
  assert.deepStrictEqual(texts(h), ['live one', 'live two']);

  h = await boot(t, { stubs(T) { T.irc.loadHistory = () => Promise.reject(new Error('503')); } });
  join(h);
  h.feed(priv('viewer', 'live'));
  assert.deepStrictEqual(texts(h), ['live'], 'a failed request does not hold chat back');
});

test('history cannot make the overlay load more than a few Shared Chat rooms', async (t) => {
  const P = (raw) => globalThis.TCO.ircParse.parseLine(raw);
  const h = await boot(t, {
    search: '?channel=home&history=100',
    stubs(T) {
      T.irc.loadHistory = () => Promise.resolve(Array.from({ length: 30 }, (_, i) => P(priv('p' + i, 'x', { 'source-room-id': String(1000 + i) }))));
    }
  });
  join(h);
  t.mock.timers.tick(10);
  await settle();
  assert.strictEqual(h.pushed.length, 30, 'every line still shows');
  assert.strictEqual(h.called('lookupUserById').length, 8);
  h.feed(priv('live', 'live partner', { 'source-room-id': '5000' }));
  await settle();
  assert.strictEqual(h.called('lookupUserById').length, 9, 'live Shared Chat is not capped');
});

test('Shared Chat room: a part that failed is retried on a later message, with backoff', async (t) => {
  let ffzFails = 2;
  const h1 = { ffz: [] };
  const h = await boot(t, {
    stubs(T) {
      T.ffz.loadRoom = (id) => { h1.ffz.push(id); return id === PARTNER && ffzFails-- > 0 ? Promise.reject(new Error('down')) : Promise.resolve({ emotes: new Map(), userBadges: new Map() }); };
    }
  });
  join(h);
  await settle();
  h1.ffz.length = 0;
  h.feed(priv('p', 'one', { 'source-room-id': PARTNER }));
  await settle();
  assert.deepStrictEqual(h1.ffz, [PARTNER]);
  const users = h.called('lookupUserById').length;
  t.mock.timers.tick(29000);
  h.feed(priv('p', 'two', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(h1.ffz.length, 1, 'not before the retry delay');
  t.mock.timers.tick(1000);
  h.feed(priv('p', 'three', { 'source-room-id': PARTNER }));
  h.feed(priv('p', 'four', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(h1.ffz.length, 2, 'retried once, not once per message');
  assert.strictEqual(h.called('lookupUserById').length, users, 'only the failed part is retried');
  t.mock.timers.tick(30000);
  h.feed(priv('p', 'five', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(h1.ffz.length, 2, 'the delay doubles after a second failure');
  t.mock.timers.tick(30000);
  h.feed(priv('p', 'six', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(h1.ffz.length, 3);
  assert.strictEqual(h.S().rooms.get(PARTNER).retry, null, 'all parts loaded');
});

test('Shared Chat room: a part whose apply throws counts as failed and is still retried', async (t) => {
  let ffzBad = 2;
  const h = await boot(t, {
    stubs(T) {
      // a malformed answer makes the apply step (fillMap) throw
      T.ffz.loadRoom = (id) => Promise.resolve(id === PARTNER && ffzBad-- > 0
        ? { emotes: { forEach() { throw new Error('bad shape'); } } }
        : { emotes: new Map(), userBadges: new Map() });
    }
  });
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  join(h);
  await settle();
  h.feed(priv('p', 'one', { 'source-room-id': PARTNER }));
  await settle();
  const room = h.S().rooms.get(PARTNER);
  assert.ok(room, 'the room loads (its other parts worked)');
  assert.deepStrictEqual(room.retry && room.retry.names, ['ffz-room']);
  t.mock.timers.tick(30000);
  h.feed(priv('p', 'two', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(room.retry.busy, false, 'a second throw does not leave the retry stuck busy');
  t.mock.timers.tick(60000);
  h.feed(priv('p', 'three', { 'source-room-id': PARTNER }));
  await settle();
  assert.strictEqual(room.retry, null, 'retried until it applied');
  assert.strictEqual(unhandled, 0);
});

test('history: non-numeric source room ids do not use up the history room cap', async (t) => {
  const P = (raw) => globalThis.TCO.ircParse.parseLine(raw);
  const h = await boot(t, {
    search: '?channel=home&history=100',
    stubs(T) {
      T.irc.loadHistory = () => Promise.resolve(
        Array.from({ length: 10 }, (_, i) => P(priv('j' + i, 'x', { 'source-room-id': 'junk' + i })))
          .concat(Array.from({ length: 3 }, (_, i) => P(priv('p' + i, 'x', { 'source-room-id': String(1000 + i) })))));
    }
  });
  join(h);
  t.mock.timers.tick(10);
  await settle();
  assert.strictEqual(h.called('lookupUserById').length, 3, 'the real partner rooms still load');
  assert.strictEqual(h.S().histRooms.size, 3);
});

test('7TV: a home reload that finds a different set drops the old set\'s subscription', async (t) => {
  let stvCalls = 0;
  const h = await boot(t, {
    stubs(T) {
      T.seventv.loadChannel = () => {
        stvCalls++;
        return Promise.resolve({ emotes: new Map(), setId: stvCalls === 1 ? '01AAAAAAAAAAAAAAAAAAAAAAAA' : '01CCCCCCCCCCCCCCCCCCCCCCCC', ownerId: null });
      };
    }
  });
  join(h);
  await settle();
  h.stv.opts.onReady();
  h.stv.opts.onReady(); // Hello #2: reload
  await settle();
  assert.strictEqual(stvCalls, 2);
  assert.ok(h.stv.objects.includes('01CCCCCCCCCCCCCCCCCCCCCCCC'));
  assert.deepStrictEqual(h.stv.removed, ['01AAAAAAAAAAAAAAAAAAAAAAAA']);
});

test('Shared Chat rooms stay loaded while their lines are on screen', async (t) => {
  const h = await boot(t);
  join(h);
  h.feed(priv('p', 'partner line', { 'source-room-id': PARTNER }));
  await settle();
  for (let i = 0; i < 9; i++) t.mock.timers.tick(300000); // 45 min, no partner message
  assert.ok(h.S().rooms.get(PARTNER), 'kept: a line of it is still shown');
  h.pushed.length = 0;
  for (let i = 0; i < 7; i++) t.mock.timers.tick(300000);
  assert.strictEqual(h.S().rooms.get(PARTNER), null, 'evicted once its lines are gone and it is idle');
});

test('Shared Chat source avatar marks every channel in a session, the home channel included', async (t) => {
  const user = deferred();
  const h = await boot(t, { stubs(T) { T.twitchBadges.lookupUser = () => user.promise; } }); // slow IVR: ROOMSTATE sets the home first
  join(h);
  h.feed(priv('partner', 'partner line', { 'source-room-id': PARTNER }));
  h.feed(priv('homeviewer', 'home line in session', { 'source-room-id': HOME }));
  h.feed(priv('homeviewer', 'home line, no session'));
  await settle();

  h.S().rooms.get(PARTNER).logo = 'https://cdn.example/partner.png';
  const [mirrored, homeShared, homeSolo] = h.pushed;
  const avatar = (message) => h.deps.badgesFor(message).find((badge) => badge.provider === 'avatar');
  assert.strictEqual(avatar(mirrored).urls[1], 'https://cdn.example/partner.png', 'the partner channel is marked');
  assert.strictEqual(avatar(homeShared), undefined, 'no home avatar until the home logo is known');

  t.mock.timers.tick(200);
  const before = h.rerenders;
  user.resolve({ id: HOME, login: 'home', displayName: 'Home', logo: 'https://cdn.example/home.png', banned: false });
  await settle();
  t.mock.timers.tick(200);
  assert.strictEqual(h.rerenders, before + 1, 'lines already shown pick up the home avatar');
  assert.deepStrictEqual(avatar(homeShared), { provider: 'avatar', title: 'Home',
    urls: { 1: 'https://cdn.example/home.png', 2: 'https://cdn.example/home.png', 4: 'https://cdn.example/home.png' } },
    'the home channel\'s own lines are marked during a session');
  assert.strictEqual(avatar(homeSolo), undefined, 'outside a session home lines stay unmarked');

  h.S().cfg.shared = false;
  assert.strictEqual(avatar(mirrored), undefined, 'disabling Shared Chat hides the source avatar');
  assert.strictEqual(avatar(homeShared), undefined);
});

test('channel lookup: a suspended flag from IVR is not sticky; an answer for another login is ignored', async (t) => {
  let h = await boot(t, { stubs(T) { T.twitchBadges.lookupUser = (l) => Promise.resolve({ id: HOME, login: l, banned: true }); } });
  assert.strictEqual(h.els.hint.hidden, false);
  join(h);
  assert.strictEqual(h.els.hint.hidden, true, 'IRC joining the room wins over the third-party flag');

  h = await boot(t, { stubs(T) { T.twitchBadges.lookupUser = () => Promise.resolve({ id: '2002', login: 'someoneelse' }); } });
  assert.strictEqual(h.S().homeId, null);
  join(h);
  assert.strictEqual(h.S().homeId, HOME);
});

test('broken settings.js and no channel: shows the error and loads nothing', async (t) => {
  const h = await boot(t, { search: '', errors: [{ file: 'settings.js', msg: 'Unexpected token' }] });
  assert.match(h.els.hint.children[0].textContent, /settings\.js has an error: Unexpected token/);
  assert.strictEqual(h.calls.length, 0);
});

test('reconnect: refetches are fresh, tracked and retried; a newer 7TV set switch wins; sockets are kicked', async (t) => {
  let bttvFail = false;
  const reload7tv = deferred();
  let stvCalls = 0;
  const h2 = { bttv: [] };
  const h = await boot(t, {
    stubs(T) {
      T.bttv.loadChannel = (id, o) => { h2.bttv.push(o); return bttvFail ? Promise.reject(new Error('502')) : Promise.resolve({ emotes: new Map(), bots: new Set() }); };
      T.seventv.loadChannel = () => { stvCalls++; return stvCalls === 1 ? Promise.resolve({ emotes: new Map([['A', { id: 'a' }]]), setId: '01AAAAAAAAAAAAAAAAAAAAAAAA', ownerId: null }) : reload7tv.promise; };
      T.seventv.loadSet = () => Promise.resolve(new Map([['B', { id: 'b' }]]));
    }
  });
  join(h);
  await settle();
  const S = h.S();
  const home = S.rooms.home();
  assert.strictEqual(h2.bttv.length, 1);
  assert.strictEqual(h2.bttv[0], undefined, 'the first load may use the HTTP cache');

  // 7TV socket reconnects (Hello #2) -> reload; meanwhile the streamer switches sets.
  h.stv.opts.onReady();
  h.stv.opts.onReady();
  await settle();
  assert.strictEqual(stvCalls, 2);
  h.onSetSwitch(HOME, '01BBBBBBBBBBBBBBBBBBBBBBBB');
  await settle();
  assert.ok(home.stv.emotes.has('B'));
  reload7tv.resolve({ emotes: new Map([['A', { id: 'a' }]]), setId: '01AAAAAAAAAAAAAAAAAAAAAAAA', ownerId: null });
  await settle();
  assert.ok(home.stv.emotes.has('B') && !home.stv.emotes.has('A'), 'the stale reload does not restore set A');
  assert.deepStrictEqual(h.stv.removed, ['01AAAAAAAAAAAAAAAAAAAAAAAA'], 'the old set is unsubscribed');

  // IRC outage > 30 s: BTTV + FFZ are refetched fresh (7TV refetches on its own Hello), sockets are kicked.
  bttvFail = true;
  h.irc.onStatus('closed');
  t.mock.timers.tick(45000);
  join(h);
  await settle();
  assert.strictEqual(stvCalls, 2, '7TV is not fetched twice');
  assert.deepStrictEqual(h2.bttv[h2.bttv.length - 1], { fresh: true });
  assert.strictEqual(h.stv.kicks, 1);
  assert.strictEqual(h.bttvLive.kicks, 1);
  assert.strictEqual(S.loads.get('reload:bttv-channel').status, 'failed', 'a failed refetch is tracked (debug=1 shows it)');
  bttvFail = false;
  const before = h2.bttv.length;
  t.mock.timers.tick(3000);
  await settle();
  assert.strictEqual(h2.bttv.length, before + 1, 'and retried');
  assert.strictEqual(S.loads.get('reload:bttv-channel').status, 'ok');

  // The BTTV socket reopening refetches its channel (fresh).
  h.bttvLive.opts.onReopen();
  await settle();
  assert.strictEqual(h2.bttv.length, before + 2);
});

test('7TV: the owner turning their set off is confirmed over REST, then clears it; personal sets follow emotes_7tv', async (t) => {
  let stvCalls = 0;
  const later = deferred();
  const h = await boot(t, {
    stubs(T) {
      T.seventv.loadChannel = () => {
        stvCalls++;
        if (stvCalls === 1) return Promise.resolve({ emotes: new Map([['A', { id: 'a' }]]), setId: '01AAAAAAAAAAAAAAAAAAAAAAAA', ownerId: null });
        return stvCalls === 2 ? later.promise : Promise.resolve({ emotes: new Map(), setId: null, ownerId: null });
      };
    }
  });
  join(h);
  await settle();
  const S = h.S();
  const home = S.rooms.home();
  assert.ok(home.stv.emotes.has('A'));
  assert.strictEqual(typeof h.stvStateOpts.loadSet, 'function', 'evicted personal sets can be refetched');
  assert.strictEqual(h.stvStateOpts.wantPersonal(), true);
  // A reload already in flight (older generation) is restarted, not left to stand down.
  h.stv.opts.onReady();
  h.stv.opts.onReady();
  await settle();
  assert.strictEqual(stvCalls, 2);
  h.onSetSwitch(HOME, null);
  await settle();
  assert.strictEqual(stvCalls, 3);
  assert.strictEqual(home.stv.emotes.size, 0);
  assert.strictEqual(home.stv.setId, null);
  later.resolve({ emotes: new Map([['A', { id: 'a' }]]), setId: '01AAAAAAAAAAAAAAAAAAAAAAAA', ownerId: null });
  await settle();
  assert.strictEqual(home.stv.emotes.size, 0, 'the older reload does not bring the set back');

  const h2 = await boot(t, { search: '?channel=home&emotes_7tv=0' });
  assert.strictEqual(h2.stvStateOpts.wantPersonal(), false);
});

test('reconnect: home data first loaded during the rejoin is not fetched twice', async (t) => {
  const h = await boot(t, { stubs(T) { T.twitchBadges.lookupUser = () => Promise.reject(new Error('offline')); } });
  h.irc.onStatus('closed');
  t.mock.timers.tick(45000);
  join(h);
  await settle();
  assert.strictEqual(h.called('ffz-room').length, 1);
  assert.strictEqual(h.called('bttv-channel').length, 1);
});

test('a font stylesheet that failed is requested again when the network returns', async (t) => {
  const h = await boot(t);
  assert.strictEqual(h.links.length, 1);
  h.links[0].onerror();
  assert.strictEqual(h.links[0].parentNode, null);
  h.listeners.online.forEach((fn) => fn());
  assert.strictEqual(h.links.length, 2);
  h.listeners.online.forEach((fn) => fn());
  assert.strictEqual(h.links.length, 2, 'a loaded font is not requested again');
});

test('font weights: Light and Black add 300 and 900 to the Google Fonts request, only while one is chosen', async (t) => {
  const css2 = (family, w) => 'https://fonts.googleapis.com/css2?family=' + family + ':wght@' + w + '&display=swap';
  const hrefs = (h) => h.links.map((l) => l.href);
  const a = await boot(t, { search: '?channel=home&text_weight=light&font=Open%20Sans' });
  assert.deepStrictEqual(hrefs(a), [css2('Open+Sans', '300;400;600;700;800')]);
  globalThis.parent = {};
  const send = (h, cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
  send(a, { text_weight: 'light', name_weight: 'black' });
  assert.deepStrictEqual(hrefs(a).slice(1), [css2('Open+Sans', '300;400;600;700;800;900')]);
  send(a, { text_weight: 'bold', name_weight: 'heavy' });
  assert.deepStrictEqual(hrefs(a).slice(2), [css2('Open+Sans', '400;600;700;800')], 'the usual four');
  send(a, { text_weight: 'regular', name_weight: 'semibold', font: 'Open Sans' });
  assert.strictEqual(a.links.length, 3, 'weights it already has ask for nothing');
  send(a, { name_weight: 'black', font: 'Arial' });
  assert.strictEqual(a.links.length, 3, 'an installed font is never requested');
  // A link that failed is asked for again with the weights of the moment, at reconnect or when back online.
  a.links[2].onerror();
  send(a, { name_weight: 'heavy', font: 'Open Sans' });
  assert.deepStrictEqual(hrefs(a).slice(3), [css2('Open+Sans', '400;600;700;800')]);
});

test('emote precedence: 7TV personal > BTTV personal > channel (7TV, BTTV, FFZ) > global (7TV, BTTV, FFZ)', async (t) => {
  const h = await boot(t);
  join(h);
  await settle();
  const S = h.S();
  const home = S.rooms.home();
  const em = (src) => ({ id: src, name: 'KEKW', urls: { 1: 'https://cdn.example/' + src + '.webp' }, w: 28, h: 28 });
  const layers = [
    ['ffz-global', (e) => S.ffzGlobal.set('KEKW', e)],
    ['bttv-global', (e) => S.bttvGlobal.set('KEKW', e)],
    ['7tv-global', (e) => S.stvGlobal.set('KEKW', e)],
    ['ffz-channel', (e) => home.ffz.emotes.set('KEKW', e)],
    ['bttv-channel', (e) => home.bttv.emotes.set('KEKW', e)],
    ['7tv-channel', (e) => home.stv.emotes.set('KEKW', e)],
    ['bttv-personal', (e) => S.bttvUsers.set('u-viewer', { badge: null, emotes: new Map([['KEKW', e]]) })],
    ['7tv-personal', (e) => { S.stv.userEmoteMaps = (uid) => (uid === 'u-viewer' ? [new Map([['KEKW', e]])] : []); }]
  ];
  const m = globalThis.TCO.ircParse.toChatMessage(globalThis.TCO.ircParse.parseLine(priv('viewer', 'KEKW')));
  layers.forEach(([src, add]) => {
    add(em(src));
    const item = h.deps.tokensFor(m).find((i) => i.type === 'emote');
    assert.strictEqual(item && item.emote.id, src, src + ' wins over everything below it');
  });
});

test('FFZ custom mod/VIP badges follow the FFZ switch, not the Twitch one', async (t) => {
  const h = await boot(t, { search: '?channel=home&badges_twitch=0' });
  join(h);
  await settle();
  const home = h.S().rooms.home();
  home.ffz.modUrls = { 1: 'https://cdn.frankerfacez.com/mod.png' };
  const m = globalThis.TCO.ircParse.toChatMessage(globalThis.TCO.ircParse.parseLine(priv('mod', 'hi', { badges: 'moderator/1,subscriber/12' })));
  const b = h.deps.badgesFor(m);
  assert.deepStrictEqual(b.map((x) => x.provider + ':' + x.title), ['ffz:Moderator']);
});

test('MasstarVT developer badge comes before all other badges', async (t) => {
  const h = await boot(t);
  join(h);
  await settle();
  h.S().twitchGlobal.set('moderator', new Map([['1', {
    title: 'Moderator', urls: { 1: 'https://cdn.example/mod.png' }
  }]]));
  globalThis.location.protocol = 'https:';
  globalThis.location.href = 'https://owner.github.io/project/overlay.html?channel=home';

  const parse = globalThis.TCO.ircParse;
  const developer = parse.toChatMessage(parse.parseLine(priv('MasstarVT', 'hello', { badges: 'moderator/1' })));
  const other = parse.toChatMessage(parse.parseLine(priv('viewer', 'hello')));
  const badges = h.deps.badgesFor(developer);

  assert.deepStrictEqual(badges.map((badge) => badge.provider), ['developer', 'beta-tester', 'twitch']);
  assert.strictEqual(badges[0].urls[1], 'https://owner.github.io/project/img/logos/Badge.svg');
  assert.ok(!h.deps.badgesFor(other).some((badge) => badge.provider === 'developer'));
});

test('Beta Tester badge is assigned to the listed accounts', async (t) => {
  const h = await boot(t);
  join(h);
  await settle();
  globalThis.location.protocol = 'https:';
  globalThis.location.href = 'https://owner.github.io/project/overlay.html?channel=home';

  const parse = globalThis.TCO.ircParse;
  for (const login of ['MasstarVT', 'EvanAxel', 'ray_xash', 'Musicalfox30']) {
    const message = parse.toChatMessage(parse.parseLine(priv(login, 'hello')));
    const badges = h.deps.badgesFor(message);
    const beta = badges.find((badge) => badge.provider === 'beta-tester');

    assert.ok(beta, login + ' receives the Beta Tester badge');
    assert.strictEqual(beta.title, 'Beta Tester');
    assert.strictEqual(beta.urls[1], 'https://owner.github.io/project/img/logos/Beta.svg');
  }

  const other = parse.toChatMessage(parse.parseLine(priv('viewer', 'hello')));
  assert.ok(!h.deps.badgesFor(other).some((badge) => badge.provider === 'beta-tester'));
});

// ---------- errors.js ----------
function runErrors(state) {
  const handlers = { error: [], DOMContentLoaded: [] };
  const win = {
    addEventListener: (t, fn) => handlers[t].push(fn),
    removeEventListener: (t, fn) => { handlers[t] = handlers[t].filter((f) => f !== fn); }
  };
  const doc = { get readyState() { return state.readyState; }, addEventListener: (t, fn) => handlers[t].push(fn) };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'errors.js'), 'utf8'), { window: win, document: doc });
  return { win, fire: (e) => handlers.error.forEach((fn) => fn(e)), ready: () => handlers.DOMContentLoaded.forEach((fn) => fn()) };
}

test('errors.js: attributes muted errors to settings.js until util.js ran, caps the list, stops after boot', () => {
  const state = { readyState: 'interactive' };
  const r = runErrors(state);
  r.fire({ filename: '', message: 'Script error.' });
  assert.strictEqual(r.win.__tcoErrors[0].file, 'settings.js');
  assert.strictEqual(r.win.__tcoErrors[0].msg, 'Script error.');
  r.win.TCO = {};
  r.fire({ filename: '', message: 'later' });
  assert.strictEqual(r.win.__tcoErrors[1].file, '');
  for (let i = 0; i < 50; i++) r.fire({ filename: 'x.js', message: 'spam' });
  assert.strictEqual(r.win.__tcoErrors.length, 20);
  const r2 = runErrors({ readyState: 'interactive' });
  r2.ready();
  r2.fire({ filename: 'x.js', message: 'after boot' });
  assert.strictEqual(r2.win.__tcoErrors.length, 0);
});

// ---------- Kick ----------
let kn = 0;
function kickChat(login, content, extra) {
  kn++;
  return Object.assign({ id: 'k' + kn, chatroom_id: 668, content: content, type: 'message', created_at: '2026-09-27T20:00:00Z',
    sender: { id: 5000 + kn, username: login, slug: login, identity: { color: '#53FC19', badges: [] } } }, extra || {});
}

test('Kick only: connects with kick_room, loads no Twitch data, and shows Kick lines without platform icons', async (t) => {
  const h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  assert.strictEqual(h.kick.opts.room, '668');
  assert.strictEqual(h.kick.started, 1);
  assert.strictEqual(h.irc, null);
  ['lookupUser', 'history', 'twitch-global', 'bttv-global', 'ffz-global'].forEach((n) => assert.deepStrictEqual(h.called(n), [], n));
  assert.strictEqual(h.called('7tv-global').length, 1, '7TV global emotes still apply to Kick chat');
  assert.deepStrictEqual(h.called('kick-lookup').map((c) => c[1]), ['kickname'], 'extras are looked up once');
  t.mock.timers.tick(6000);
  await settle();
  ['7tv-catalog', 'ffz-badges', 'bttv-badges', 'chatterino', 'ffzap', 'homies'].forEach((n) => assert.deepStrictEqual(h.called(n), [], n));
  assert.strictEqual(h.els.hint.hidden, true, 'with kick_room set a refused lookup is fine');

  h.kick.send('ChatMessageEvent', kickChat('KickViewer', 'hi [emote:37226:KEKW]', {
    sender: { id: 77, username: 'KickViewer', identity: { color: '#53FC19', badges: [{ type: 'moderator' }, { type: 'subscriber', count: 2 }] } }
  }));
  assert.deepStrictEqual(texts(h), ['hi KEKW']);
  const m = h.pushed[0];
  assert.strictEqual(m.platform, 'kick');
  assert.deepStrictEqual(h.deps.badgesFor(m), [
    { provider: 'kick', icon: 'kick-moderator', title: 'Moderator' },
    { provider: 'kick', icon: 'kick-subscriber', title: 'Subscriber (2 months)' }
  ]);
  const items = h.deps.tokensFor(m);
  assert.deepStrictEqual(items.map((i) => i.type === 'emote' ? i.emote.provider + ':' + i.emote.name : i.text), ['hi', 'kick:KEKW']);
  assert.deepStrictEqual(h.lookupWants, [], 'Kick users are never looked up on 7TV by Twitch id');
  assert.match(h.S().cfg.kick, /kickname/);
});

test('Twitch + Kick: platform icons on every line (toggled live), Kick badges switch, and a Twitch /clear spares Kick', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0' });
  join(h);
  h.feed(priv('viewer', 'from twitch'));
  h.kick.send('ChatMessageEvent', kickChat('kickviewer', 'from kick', {
    sender: { id: 9, username: 'kickviewer', identity: { badges: [{ type: 'vip' }] } }
  }));
  h.kick.send('SubscriptionEvent', { chatroom_id: 668, username: 'Fan', months: 1 });
  assert.deepStrictEqual(texts(h), ['from twitch', 'from kick', '']);
  const [tw, kk, sub] = h.pushed;
  assert.deepStrictEqual(h.deps.badgesFor(tw)[0], { provider: 'platform', icon: 'twitch', title: 'Twitch' });
  assert.deepStrictEqual(h.deps.badgesFor(kk), [
    { provider: 'platform', icon: 'kick', title: 'Kick' },
    { provider: 'kick', icon: 'kick-vip', title: 'VIP' }
  ]);
  assert.deepStrictEqual(h.deps.badgesFor(sub), [{ provider: 'platform', icon: 'kick', title: 'Kick' }]);
  assert.strictEqual(sub.systemMsg, 'Fan subscribed!');

  // Live changes from the builder preview.
  globalThis.parent = {};
  const send = (cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
  send({ platform_icons: false, badges_kick: false });
  assert.deepStrictEqual(h.deps.badgesFor(kk), []);
  assert.strictEqual(h.deps.badgesFor(tw).some((b) => b.provider === 'platform'), false);
  send({ platform_icons: true, badges_kick: true, events: false });
  assert.strictEqual(h.deps.shouldShow(sub), false, 'events=0 hides Kick notices too');

  // Twitch /clear: only Twitch lines. Kick's own clear: only Kick lines.
  h.feed('@room-id=' + HOME + ' :tmi.twitch.tv CLEARCHAT #home');
  h.kick.send('ChatroomClearEvent', { id: 'x' });
  assert.deepStrictEqual(h.cleared, ['some', 'some']);
  assert.deepStrictEqual(h.clearPreds.map((p) => [p(tw), p(kk)]), [[true, false], [false, true]]);

  // Kick moderation uses namespaced ids.
  h.kick.send('UserBannedEvent', { user: { id: 9, username: 'kickviewer' } });
  h.kick.send('MessageDeletedEvent', { message: { id: 'abc-1' } });
  assert.deepStrictEqual(h.cleared.slice(2), ['user:kick:9', 'msg:kick:abc-1']);
});

test('Kick: the block list and bot list cover Kick names; a Twitch channel\'s BTTV bot list does not', async (t) => {
  const h = await boot(t, {
    search: '?channel=home&kick=kickname&kick_room=668&history=0&block=troll',
    stubs(T) { T.bttv.loadChannel = () => Promise.resolve({ emotes: new Map(), bots: new Set(['samename']) }); }
  });
  join(h);
  await settle();
  ['troll', 'botrix', 'samename', 'fine'].forEach((n) => h.kick.send('ChatMessageEvent', kickChat(n, n + ' says hi')));
  h.feed(priv('samename', 'twitch bot line'));
  assert.deepStrictEqual(texts(h), ['samename says hi', 'fine says hi']);
});

test('Kick: events wait for Twitch history, in order with Twitch lines', async (t) => {
  const hist = deferred();
  const h = await boot(t, {
    search: '?channel=home&kick=kickname&kick_room=668',
    stubs(T) { T.irc.loadHistory = () => hist.promise; }
  });
  join(h);
  h.kick.send('ChatMessageEvent', kickChat('a', 'kick 1'));
  h.feed(priv('b', 'twitch 1'));
  h.kick.send('UserBannedEvent', { user: { id: 1, username: 'x' } });
  assert.deepStrictEqual(texts(h), []);
  assert.deepStrictEqual(h.cleared, []);
  hist.resolve([]);
  await settle();
  assert.deepStrictEqual(texts(h), ['kick 1', 'twitch 1']);
  assert.deepStrictEqual(h.cleared, ['user:kick:1']);
});

test('Kick without kick_room: the channel lookup finds the chatroom; a refused lookup shows how to set it', async (t) => {
  let h = await boot(t, {
    search: '?kick=kickname',
    stubs(T) {
      T.kick.lookupChannel = () => Promise.resolve({ chatroomId: '4598', userId: '676', slug: 'kickname', username: 'KickName',
        subBadges: [{ months: 1, url: 'https://files.kick.com/sub/1' }, { months: 6, url: 'https://files.kick.com/sub/6' }] });
    }
  });
  assert.strictEqual(h.kick.opts.room, '4598');
  assert.deepStrictEqual(h.called('7tv-channel').map((c) => c.slice(1)), [['676', 'kick']], 'the Kick channel\'s own 7TV set');
  h.kick.send('ChatMessageEvent', kickChat('fan', 'hi', { sender: { id: 1, username: 'fan', identity: { badges: [{ type: 'subscriber', count: 8 }] } } }));
  assert.deepStrictEqual(h.deps.badgesFor(h.pushed[0]), [{ provider: 'kick', title: 'Subscriber (8 months)', urls: { 1: 'https://files.kick.com/sub/6', 2: 'https://files.kick.com/sub/6', 4: 'https://files.kick.com/sub/6' } }]);
  t.mock.timers.tick(11000);
  assert.strictEqual(h.els.hint.hidden, true);

  h = await boot(t, { search: '?kick=kickname' });
  assert.strictEqual(h.kick, null);
  t.mock.timers.tick(11000);
  assert.strictEqual(h.els.hint.hidden, false);
  assert.match(h.els.hint.children[0].textContent, /Kick chatroom for "kickname".*kick_room/);
  assert.strictEqual(h.els.hint.children[1].href, 'builder.html?kick=kickname');
});

test('Kick: a refused app key shows a hint that joining clears', async (t) => {
  const h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  h.kick.opts.onStatus('fatal', { code: 4001, message: 'x' });
  assert.strictEqual(h.els.hint.hidden, false);
  assert.match(h.els.hint.children[0].textContent, /Kick refused the chat connection \(error 4001\)/);
  h.kick.opts.onStatus('joined');
  assert.strictEqual(h.els.hint.hidden, true);
});
