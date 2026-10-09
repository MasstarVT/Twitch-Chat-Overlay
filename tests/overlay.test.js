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
    irc: null, kick: null, kickClients: [], stv: null, stvClients: 0, bttvLive: null, lookupWants: [], clearPreds: [],
    refused: [], dropped: [], noted: [], redrawn: [],
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
  stub(T.twitchBadges, 'loadCheermotes', 'cheermotes', ok(() => new Map()));
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
  stub(T.kick, 'loadHistory', 'kick-history', ok(() => []));
  T.kick.createKick = function (o) {
    h.kick = { opts: o, started: 0, kicks: 0, stopped: 0, start() { this.started++; }, kick() { this.kicks++; },
      stop() { this.stopped++; },
      send(event, data) { o.onEvent(globalThis.TCO.kick.parseEvent('App\\Events\\' + event, JSON.stringify(data))); } };
    h.kickClients.push(h.kick);
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
    h.stvClients++;
    h.stv = { opts: o, kicks: 0, objects: [], removed: [], channels: [], started: 0, addChannel(id) { this.channels.push(id); },
      start() { this.started++; },
      addObject(type, id) { this.objects.push(id); }, removeObject(type, id) { this.removed.push(id); }, kick() { this.kicks++; } };
    return h.stv;
  };
  T.seventv.createLookup = function () { return { want(uid) { h.lookupWants.push(uid); } }; };
  T.bttv.createLive = function (o) { h.bttvLive = { opts: o, kicks: 0, start() {}, kick() { this.kicks++; } }; return h.bttvLive; };
  if (opts.realRenderer) {
    // The real renderer, drawing into a tests/fake-dom.js document.
    const fdoc = require('./fake-dom.js').createDocument();
    const chat = fdoc.createElement('div');
    fdoc.body.appendChild(chat);
    h.els.chat = chat;
    const real = T.renderer.createRenderer;
    T.renderer.createRenderer = function (o) { h.deps = o.deps; return real(o); };
    h.lines = () => chat.firstElementChild.children;
  } else {
    T.renderer.createRenderer = function (o) {
      h.deps = o.deps;
      return {
        push(m) { if (!o.deps.shouldShow(m)) { h.refused.push(m); return false; } h.pushed.push(m); return true; },
        note(m) { h.noted.push(m); },
        clearUser(u) { h.cleared.push('user:' + u); },
        clearAll(pred) {
          if (pred) { h.clearPreds.push(pred); h.cleared.push('some'); } else h.cleared.push('all');
        },
        clearMessage(id) { h.cleared.push('msg:' + id); },
        drop(pred) { h.dropped.push(pred); h.pushed = h.pushed.filter((m) => !pred(m)); },
        rerender(pred) {
          h.rerenders++;
          const hit = [];
          h.pushed.forEach((m) => { if (typeof pred === 'function' && pred(m)) hit.push(m); });
          h.redrawn.push(hit);
          return 0;
        },
        refilter() { h.refilters++; h.pushed = h.pushed.filter((m) => o.deps.shouldShow(m)); },
        setConfig() {}, hold() {}, hasUser() { return false; }, stats() { return null; }
      };
    };
  }
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
  const toSpammer = { 'reply-parent-msg-id': 'y', 'reply-parent-user-login': 'spammer', 'reply-parent-display-name': 'Spammer',
    'reply-parent-msg-body': 'blocked\\swords' };
  h.feed(priv('nightbot', 'bot line'));
  h.feed(priv('spammer', 'spam'));
  h.feed(priv('viewer', '!points'));
  h.feed(priv('viewer', '@Nightbot !discord', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'nightbot', 'reply-parent-display-name': 'Nightbot' }));
  h.feed(priv('viewer', '@Nightbot', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'nightbot', 'reply-parent-display-name': 'Nightbot' }));
  h.feed(priv('viewer', '@Spammer lol', toSpammer));
  // A command sent as a reply to a blocked user is hidden like any other reply's.
  h.feed(priv('viewer', '@Spammer !points', toSpammer));
  h.feed(priv('viewer', 'real line'));
  assert.deepStrictEqual(texts(h), ['@Nightbot', '@Spammer lol', 'real line']);
  assert.ok(h.pushed[0].reply, 'a normal reply keeps its header');
  assert.strictEqual(h.deps.quoteHidden(h.pushed[0].reply), false);
  // A reply to a blocked user stays a reply: its header is left out as the line is drawn, and its "@Spammer" with it.
  assert.strictEqual(h.pushed[1].reply.login, 'spammer');
  assert.strictEqual(h.deps.quoteHidden(h.pushed[1].reply), true, 'the blocked user\'s words are not quoted');
  assert.deepStrictEqual(h.deps.tokensFor(h.pushed[1]).map((i) => i.text), ['lol']);
  // reply_style=name quotes nothing, but the blocked user's name is left out too.
  sender(h)({ reply_style: 'name' });
  assert.strictEqual(h.deps.quoteHidden(h.pushed[1].reply), true);
  assert.strictEqual(h.deps.quoteHidden(h.pushed[0].reply), false);
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

test('bots=0 with BTTV emotes off: a Shared Chat partner\'s BTTV bot list still loads, at boot and when bots turns off live', async (t) => {
  const stubs = (T) => {
    const orig = T.bttv.loadChannel;
    T.bttv.loadChannel = function (id, o) {
      orig(id, o);
      return Promise.resolve({ emotes: new Map(), bots: new Set(id === PARTNER ? ['partnerbot'] : []) });
    };
  };
  const rooms = (h) => h.called('bttv-channel').map((c) => c[1]).sort();
  let h = await boot(t, { search: '?channel=home&emotes_bttv=0', stubs: stubs });
  join(h);
  h.feed(priv('partnerbot', 'first', { 'source-room-id': PARTNER }));
  await settle();
  h.feed(priv('partnerbot', 'second', { 'source-room-id': PARTNER }));
  assert.deepStrictEqual(rooms(h), [HOME, PARTNER]);
  assert.deepStrictEqual(texts(h), [], 'a bot line shown before the list landed goes too');
  // bots=1 with the emotes off loads no BTTV channel data at all, home or partner.
  h = await boot(t, { search: '?channel=home&emotes_bttv=0&bots=1', stubs: stubs });
  join(h);
  h.feed(priv('viewer', 'partner viewer line', { 'source-room-id': PARTNER }));
  await settle();
  assert.deepStrictEqual(rooms(h), []);
  // Turned off live (the builder's preview): the partner rooms already loaded fetch their lists as well.
  sender(h)({ bots: false });
  await settle();
  assert.deepStrictEqual(rooms(h), [HOME, PARTNER]);
  h.feed(priv('partnerbot', 'after the switch', { 'source-room-id': PARTNER }));
  assert.deepStrictEqual(texts(h), ['partner viewer line']);
});

// A Shared Chat partner room loads the data the settings use when it is first seen; one turned on later in the builder's
// preview must reach the partner rooms already loaded too, as a reload would.
test('a badge switch turned on live loads each Shared Chat partner\'s own badge data too (channel badges, FFZ room badges)', async (t) => {
  const cdn = (id) => 'https://static-cdn.jtvnw.net/badges/v1/CHANNEL' + id + '/1';
  const ffzMod = (id) => 'https://cdn.frankerfacez.com/room-badge/mod/' + id + '/1';
  const stubs = (T) => {
    const tw = T.twitchBadges.loadChannel;
    T.twitchBadges.loadChannel = function (id) {
      tw(id);
      return Promise.resolve(new Map([['subscriber', new Map([['12', { set: 'subscriber', version: '12', title: 'Sub', urls: { 1: cdn(id) } }]])]]));
    };
    const ffz = T.ffz.loadRoom;
    T.ffz.loadRoom = function (id) {
      ffz(id);
      return Promise.resolve({ emotes: new Map(), modUrls: { 1: ffzMod(id) }, vipUrls: null, userBadges: new Map() });
    };
  };
  const rooms = (h, label) => h.called(label).map((c) => c[1]).sort();
  const badges = (h, provider) => h.deps.badgesFor(h.pushed[h.pushed.length - 1]).filter((b) => b.provider === provider).map((b) => b.urls[1]);
  const partnerLine = (badge) => priv('partnerfan', 'partner line', { 'source-room-id': PARTNER, 'source-badges': badge });

  // Twitch badges off at boot: the partner room never fetched its channel badges, so its subscriber's badge would be
  // Twitch's generic one (here none: the global set is empty).
  let h = await boot(t, { search: '?channel=home&history=0&badges_twitch=0', stubs: stubs });
  join(h);
  h.feed(partnerLine('subscriber/12'));
  await settle();
  assert.deepStrictEqual(rooms(h, 'twitch-channel'), []);
  sender(h)({ badges_twitch: true });
  await settle();
  assert.deepStrictEqual(rooms(h, 'twitch-channel'), [HOME, PARTNER]);
  assert.deepStrictEqual(badges(h, 'twitch'), [cdn(PARTNER)], 'the line already shown: the partner channel\'s own badge');
  h.feed(partnerLine('subscriber/12'));
  assert.deepStrictEqual(badges(h, 'twitch'), [cdn(PARTNER)], 'and a later line');
  // Off and on again: what is loaded stays, nothing is fetched twice.
  sender(h)({ badges_twitch: false });
  sender(h)({ badges_twitch: true });
  await settle();
  assert.deepStrictEqual(rooms(h, 'twitch-channel'), [HOME, PARTNER]);

  // The badges master switch, the same.
  h = await boot(t, { search: '?channel=home&history=0&badges=0', stubs: stubs });
  join(h);
  h.feed(partnerLine('subscriber/12'));
  await settle();
  sender(h)({ badges: true });
  await settle();
  assert.deepStrictEqual(rooms(h, 'twitch-channel'), [HOME, PARTNER]);
  assert.deepStrictEqual(badges(h, 'twitch'), [cdn(PARTNER)]);

  // FFZ emotes and badges off at boot: no room fetched its FFZ data. FFZ badges on live: the partner's custom
  // moderator badge shows on its line.
  h = await boot(t, { search: '?channel=home&history=0&emotes_ffz=0&badges_ffz=0', stubs: stubs });
  join(h);
  h.feed(partnerLine('moderator/1'));
  await settle();
  assert.deepStrictEqual(rooms(h, 'ffz-room'), []);
  sender(h)({ badges_ffz: true });
  await settle();
  assert.deepStrictEqual(rooms(h, 'ffz-room'), [HOME, PARTNER]);
  assert.deepStrictEqual(badges(h, 'ffz'), [ffzMod(PARTNER)]);

  // One that fails is retried on a later line of the partner's, as any part of a room.
  let down = true;
  h = await boot(t, { search: '?channel=home&history=0&badges_twitch=0', stubs(T) {
    stubs(T);
    const ok = T.twitchBadges.loadChannel;
    T.twitchBadges.loadChannel = (id) => (id === PARTNER && down ? Promise.reject(new Error('down')) : ok(id));
  } });
  join(h);
  h.feed(partnerLine('subscriber/12'));
  await settle();
  sender(h)({ badges_twitch: true });
  await settle();
  const room = h.S().rooms.get(PARTNER);
  assert.deepStrictEqual(room.retry && room.retry.names, ['twitch-channel-badges']);
  assert.strictEqual(room.parts['twitch-channel-badges'], undefined);
  down = false;
  t.mock.timers.tick(30000);
  h.feed(partnerLine('subscriber/12'));
  await settle();
  assert.strictEqual(room.retry, null);
  assert.strictEqual(room.parts['twitch-channel-badges'], 'ok');
  assert.deepStrictEqual(badges(h, 'twitch'), [cdn(PARTNER)]);

  // At the defaults every room loaded all of it already: a switch turned on live fetches nothing of the partner's again.
  h = await boot(t, { search: '?channel=home&history=0', stubs: stubs });
  join(h);
  h.feed(partnerLine('subscriber/12'));
  await settle();
  const partnerCalls = () => h.calls.filter((c) => c[1] === PARTNER).map((c) => c[0]).sort();
  assert.deepStrictEqual(partnerCalls(), ['7tv-channel', 'bttv-channel', 'ffz-room', 'lookupUserById', 'twitch-channel']);
  sender(h)({ badges_7tv: false });
  sender(h)({ badges_7tv: true });
  sender(h)({ bots: false });
  await settle();
  assert.deepStrictEqual(partnerCalls(), ['7tv-channel', 'bttv-channel', 'ffz-room', 'lookupUserById', 'twitch-channel']);
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
  // 5 chat lines are shown: more raw lines are asked for (4 * 5 + 20), as notices and hidden lines count toward the limit.
  assert.deepStrictEqual(h.called('history'), [['history', 'home', 40, { timeout: 4000 }]]);

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

// Kick chat started empty ("Kick chat has no recent-message history"): kick.com keeps a channel's newest messages under
// its channel id, which the channel lookup gives.
test('Kick history: loaded once the lookup gives the channel id; the newest N shown; live Kick chat waits for it', async (t) => {
  const kmsg = (id, sec, text, extra) => Object.assign(globalThis.TCO.kick.toMessage(kickChat('kfan', text, {
    id: id, created_at: new Date(1e12 - (60 - sec) * 1000).toISOString() })), { historical: true }, extra || {});
  const look = (room) => ({ chatroomId: room || '668', channelId: '700', userId: '', slug: 'kickname', username: 'kickname', subBadges: [] });
  let hist;
  let h = await boot(t, { search: '?kick=kickname&history=2', stubs(T) {
    T.kick.lookupChannel = () => Promise.resolve(look());
    T.kick.loadHistory = (ch, room, o) => {
      h0.kickHist = [ch, room, o];
      hist = deferred();
      return hist.promise;
    };
  } });
  assert.deepStrictEqual(h0.kickHist, ['700', '668', { timeout: 4000 }], 'the channel id, the chatroom joined, the wait left');
  h.kick.send('ChatMessageEvent', kickChat('live', 'live while it loads'));
  assert.deepStrictEqual(texts(h), [], 'live Kick chat waits');
  hist.resolve([kmsg('a', 1, 'oldest'), kmsg('b', 2, 'nightbot', { login: 'nightbot' }), kmsg('c', 3, 'middle'), kmsg('d', 4, 'newest')]);
  await settle();
  assert.deepStrictEqual(texts(h), ['middle', 'newest', 'live while it loads'], 'the newest 2 the filters let through, then live');
  assert.ok(h.pushed[0].historical);
  // A lookup that fails (Cloudflare) gives no history and holds nothing back for long; history=0 asks for none.
  h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  assert.deepStrictEqual(h.called('kick-history'), []);
  h.kick.send('ChatMessageEvent', kickChat('live', 'at once'));
  assert.deepStrictEqual(texts(h), ['at once']);
  h = await boot(t, { search: '?kick=kickname&history=0', stubs(T) { T.kick.lookupChannel = () => Promise.resolve(look()); } });
  assert.deepStrictEqual(h.called('kick-history'), []);
  // With kick_room naming a stale chatroom, the lookup's own is the one the lines are keyed by.
  h = await boot(t, { search: '?kick=kickname&kick_room=1', stubs(T) {
    T.kick.lookupChannel = () => Promise.resolve(look('668'));
    T.kick.loadHistory = (ch, room) => { h0.kickHist = [ch, room]; return Promise.resolve([]); };
  } });
  assert.deepStrictEqual(h0.kickHist, ['700', '668']);
  // A stalled request holds live chat back for 4 s at most.
  h = await boot(t, { search: '?kick=kickname', stubs(T) {
    T.kick.lookupChannel = () => Promise.resolve(look());
    T.kick.loadHistory = () => new Promise(() => {});
  } });
  h.kick.send('ChatMessageEvent', kickChat('live', 'late'));
  t.mock.timers.tick(3999);
  assert.deepStrictEqual(texts(h), []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(texts(h), ['late']);
});

test('Twitch and Kick history: one history between them, the newest N of both, in time order', async (t) => {
  const P = (raw) => globalThis.TCO.ircParse.parseLine(raw);
  const at = (sec) => String(1e12 - (60 - sec) * 1000);
  const kmsg = (id, sec, text) => Object.assign(globalThis.TCO.kick.toMessage(kickChat('kfan', text, {
    id: id, created_at: new Date(1e12 - (60 - sec) * 1000).toISOString() })), { historical: true });
  const h = await boot(t, { search: '?channel=home&kick=kickname&history=4', stubs(T) {
    T.kick.lookupChannel = () => Promise.resolve({ chatroomId: '668', channelId: '700', userId: '', slug: 'kickname', username: 'k', subBadges: [] });
    T.kick.loadHistory = () => Promise.resolve([kmsg('k1', 1, 'kick 1'), kmsg('k3', 3, 'kick 3'), kmsg('k6', 6, 'kick 6')]);
    T.irc.loadHistory = () => Promise.resolve([priv('z', 'twitch 0', { 'tmi-sent-ts': at(0) }),
      '@room-id=' + HOME + ';tmi-sent-ts=' + at(0.5) + ' :tmi.twitch.tv CLEARCHAT #home',
      priv('a', 'twitch 2', { 'tmi-sent-ts': at(2) }), priv('b', 'twitch 4', { 'tmi-sent-ts': at(4) }),
      priv('c', 'twitch 5', { 'tmi-sent-ts': at(5) })].map(P));
  } });
  join(h);
  await settle();
  // Kick 1 is older than the 4 shown; the /clear (Twitch's, before kick 1) never touches Kick lines.
  assert.deepStrictEqual(texts(h), ['kick 3', 'twitch 4', 'twitch 5', 'kick 6']);
  assert.deepStrictEqual(h.cleared, ['some']);
  assert.deepStrictEqual(h.noted.map((m) => m.text), ['twitch 0', 'twitch 2'], 'older Twitch lines are noted as said');
});

// Twitch doesn't send again what was said, deleted or cleared while the socket was down: a line a mod deleted in an
// outage stayed on stream, and the lines said in it never came.
test('after an IRC outage: recent-messages is asked again; its deletions apply, the gap\'s lines and timeouts replay', async (t) => {
  const P = (raw) => globalThis.TCO.ircParse.parseLine(raw);
  const at = (sec) => String(1e12 + sec * 1000);
  const asks = [];
  const h = await boot(t, { search: '?channel=home&history=2', stubs(T) {
    T.irc.loadHistory = (l, n, o) => { const d = deferred(); asks.push({ n: n, o: o, d: d }); return d.promise; };
  } });
  asks[0].d.resolve([]);
  await settle();
  join(h);
  h.feed(priv('troll', 'slur here', { id: 's1', 'tmi-sent-ts': at(1) }));
  h.feed(priv('pal', 'last before the gap', { id: 'p1', 'tmi-sent-ts': at(2) }));
  assert.deepStrictEqual(texts(h), ['slur here', 'last before the gap']);
  h.irc.onStatus('closed');
  t.mock.timers.tick(40000);
  join(h);
  assert.strictEqual(asks.length, 2, 'asked again on the rejoin');
  assert.deepStrictEqual([asks[1].n, asks[1].o], [100, { timeout: 4000 }], 'enough lines to reach the 50 on screen');
  h.feed(priv('live', 'after the rejoin', { id: 'l1', 'tmi-sent-ts': at(60) }));
  assert.deepStrictEqual(texts(h).slice(2), [], 'live chat waits for it');
  asks[1].d.resolve([
    priv('old', 'before the gap, not shown', { id: 'o1', 'tmi-sent-ts': at(0) }),
    '@room-id=' + HOME + ';target-user-id=u-old;tmi-sent-ts=' + at(0) + ' :tmi.twitch.tv CLEARCHAT #home :old',
    priv('troll', 'slur here', { id: 's1', 'tmi-sent-ts': at(1), 'rm-deleted': '1' }),
    priv('pal', 'last before the gap', { id: 'p1', 'tmi-sent-ts': at(2) }),
    priv('a', 'missed one', { id: 'g1', 'tmi-sent-ts': at(10) }),
    '@room-id=' + HOME + ';target-user-id=u-troll;tmi-sent-ts=' + at(11) + ' :tmi.twitch.tv CLEARCHAT #home :troll',
    priv('b', 'missed two', { id: 'g2', 'tmi-sent-ts': at(12) }),
    priv('c', 'missed three', { id: 'g3', 'tmi-sent-ts': at(13) }),
    priv('live', 'after the rejoin', { id: 'l1', 'tmi-sent-ts': at(60) })
  ].map(P));
  await settle();
  assert.deepStrictEqual(h.cleared, ['msg:s1', 'user:u-troll'], 'the deletion from before the gap, the timeout in it; not the older one');
  assert.deepStrictEqual(texts(h).slice(2), ['missed two', 'missed three', 'after the rejoin'], 'the newest 2 of the gap, then live');
  assert.ok(h.pushed[2].historical);
  assert.deepStrictEqual(h.noted.map((m) => m.text), ['missed one']);
  // A new outage while the request is out drops it; the next rejoin asks from the same point.
  h.irc.onStatus('closed');
  join(h);
  assert.strictEqual(asks.length, 3);
  h.feed(priv('live', 'waiting', { id: 'l2', 'tmi-sent-ts': at(70) }));
  h.irc.onStatus('closed');
  assert.deepStrictEqual(texts(h).slice(-1), ['waiting'], 'the waiting live chat goes on');
  join(h);
  assert.strictEqual(asks.length, 4);
  asks[3].d.resolve([priv('d', 'missed in the second gap', { id: 'g4', 'tmi-sent-ts': at(65) }),
    priv('live', 'waiting', { id: 'l2', 'tmi-sent-ts': at(70) })].map(P));
  await settle();
  assert.deepStrictEqual(texts(h).slice(-2), ['waiting', 'missed in the second gap']);
  asks[2].d.resolve([priv('x', 'too late', { id: 'x1', 'tmi-sent-ts': at(66) })].map(P));
  await settle();
  assert.ok(!texts(h).includes('too late'), 'a dropped request\'s answer is ignored');
  // A stalled request holds live chat back for 4 s at most.
  h.irc.onStatus('closed');
  join(h);
  h.feed(priv('live', 'held', { id: 'l3', 'tmi-sent-ts': at(90) }));
  t.mock.timers.tick(4000);
  assert.deepStrictEqual(texts(h).slice(-1), ['held']);
});

test('after an IRC outage: no request with history=0, in the demo, or while the start-up history is still out', async (t) => {
  let h = await boot(t, { search: '?channel=home&history=0' });
  join(h);
  h.irc.onStatus('closed');
  join(h);
  assert.strictEqual(h.called('history').length, 0);
  h = await boot(t, { stubs(T) { T.irc.loadHistory = () => new Promise(() => {}); } });
  h.irc.onStatus('closed');
  join(h);
  assert.strictEqual(h.S().gapAbort, null, 'the start-up history covers it');
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

// The builder posts every live change to its preview: a font Google Fonts doesn't host (one installed on the PC, which
// the help suggests) answers 400, and was asked for again on each slider step, toggle or color pick.
test('a font stylesheet that failed is not asked for again at once on a live change, only at a reconnect or back online', async (t) => {
  const css2 = (family) => 'https://fonts.googleapis.com/css2?family=' + family + ':wght@400;600;700;800&display=swap';
  const hrefs = (h) => h.links.map((l) => l.href);
  const h = await boot(t, { search: '?channel=home&history=0&font=Gotham' });
  join(h);
  assert.deepStrictEqual(hrefs(h), [css2('Gotham')]);
  h.links[0].onerror();
  const send = sender(h);
  for (let i = 1; i <= 5; i++) send({ bg: 10 * i });
  send({ font: 'Roboto' });
  send({ font: 'Gotham' });
  send({ name_font: 'Zzzz Notreal' });
  h.links[2].onerror();
  send({ shadow: 1 });
  send({ name_font: '' });
  send({ name_font: 'Zzzz Notreal' });
  assert.deepStrictEqual(hrefs(h), [css2('Gotham'), css2('Roboto'), css2('Zzzz+Notreal')], 'each asked for once');
  // Back online, both are asked for again, once.
  h.listeners.online.forEach((fn) => fn());
  send({ bg: 70 });
  assert.deepStrictEqual(hrefs(h).slice(3), [css2('Gotham'), css2('Zzzz+Notreal')]);
  // And after a reconnect, however short the outage (before their own backoff, below, asks for them).
  h.links[3].onerror();
  h.links[4].onerror();
  send({ bg: 80 });
  assert.strictEqual(h.links.length, 5);
  h.irc.onStatus('closed');
  t.mock.timers.tick(2000);
  join(h);
  assert.deepStrictEqual(hrefs(h).slice(5), [css2('Gotham'), css2('Zzzz+Notreal')]);
});

// OBS starting with the PC before the network is up: the stylesheet failed, and only an 'online' event (none when the
// adapter was up and DNS was not) or an IRC rejoin after more than 30 s asked for it again, so the overlay could draw
// the fallback font for the whole stream (a Kick-only overlay has no IRC at all).
test('a font stylesheet that failed is asked for again on its own backoff (3 s, 10 s, 30 s, 60 s, then 5 min) until it loads', async (t) => {
  const h = await boot(t, { search: '?channel=home&history=0' });
  join(h);
  const steps = [3000, 10000, 30000, 60000, 300000, 300000];
  steps.forEach((ms, i) => {
    h.links[i].onerror();
    t.mock.timers.tick(ms - 1);
    assert.strictEqual(h.links.length, i + 1, 'not before ' + ms + ' ms');
    t.mock.timers.tick(1);
    assert.strictEqual(h.links.length, i + 2, 'after ' + ms + ' ms');
  });
  assert.ok(h.links.every((l) => /family=Inter:wght@400;600;700;800&/.test(l.href)));
  h.links[h.links.length - 1].onload();
  t.mock.timers.tick(3600000);
  assert.strictEqual(h.links.length, steps.length + 1, 'loaded: never asked for again');
});

test('a font stylesheet that failed is asked for again when IRC rejoins after a short outage, and when Kick joins', async (t) => {
  let h = await boot(t, { search: '?channel=home&history=0' });
  join(h);
  h.links[0].onerror();
  h.irc.onStatus('closed');
  t.mock.timers.tick(1000);
  join(h);
  assert.strictEqual(h.links.length, 2, 'a 1 s outage');
  h.irc.onStatus('closed');
  join(h);
  assert.strictEqual(h.links.length, 2, 'in flight: not asked twice');
  h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  h.links[0].onerror();
  h.kick.opts.onStatus('joined');
  assert.strictEqual(h.links.length, 2, 'Kick only');
});

// The backoff keeps the builder's rule: a live change never asks at once, and a font no longer drawn isn't asked for.
test('a failed font\'s backoff skips it while a live change has moved on, and asks again a step after it is back', async (t) => {
  const css2 = (family) => 'https://fonts.googleapis.com/css2?family=' + family + ':wght@400;600;700;800&display=swap';
  const h = await boot(t, { search: '?channel=home&history=0&font=Gotham' });
  join(h);
  const send = sender(h);
  h.links[0].onerror();
  send({ font: 'Roboto' });
  t.mock.timers.tick(3000);
  assert.deepStrictEqual(h.links.map((l) => l.href), [css2('Gotham'), css2('Roboto')], 'Gotham isn\'t drawn: not asked for');
  send({ font: 'Gotham' });
  assert.strictEqual(h.links.length, 2, 'not at once');
  t.mock.timers.tick(9999);
  assert.strictEqual(h.links.length, 2);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(h.links.slice(2).map((l) => l.href), [css2('Gotham')], 'the next step');
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
  // A link that failed is asked for again with the weights of the moment, at reconnect or when back online (not on a
  // live change: see above).
  a.links[2].onerror();
  send(a, { name_weight: 'heavy', font: 'Open Sans' });
  assert.strictEqual(a.links.length, 3);
  a.listeners.online.forEach((fn) => fn());
  assert.deepStrictEqual(hrefs(a).slice(3), [css2('Open+Sans', '400;600;700;800')]);
});

test('name_font: a second Google Fonts link only while it is set, and asked again wherever the font is', async (t) => {
  const css2 = (family) => 'https://fonts.googleapis.com/css2?family=' + family + ':wght@400;600;700;800&display=swap';
  const hrefs = (h) => h.links.map((l) => l.href);
  // (Each boot is a fresh overlay on a fresh document: the live checks below use the last one.)
  const b = await boot(t, { search: '?channel=home&name_font=press%20start%202p' });
  assert.deepStrictEqual(hrefs(b), [css2('Inter'), css2('Press+Start+2P')], 'Google\'s spelling, after the message font');
  for (const nf of ['Arial', 'system-ui', 'Inter']) {
    const c = await boot(t, { search: '?channel=home&name_font=' + encodeURIComponent(nf) });
    assert.deepStrictEqual(hrefs(c), [css2('Inter')], nf + ': installed, generic or already asked for');
  }
  const a = await boot(t);
  assert.deepStrictEqual(hrefs(a), [css2('Inter')], 'the default: the one link, as before');
  // Live from the builder: set, cleared (nothing more to load), set again (loaded once).
  globalThis.parent = {};
  const send = (h, cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
  send(a, { name_font: 'Bangers' });
  assert.deepStrictEqual(hrefs(a), [css2('Inter'), css2('Bangers')]);
  assert.strictEqual(a.S().cfg.name_font, 'Bangers');
  send(a, { name_font: '' });
  assert.strictEqual(a.S().cfg.name_font, '', 'a cleared field reaches the overlay');
  send(a, { name_font: 'Bangers' });
  assert.strictEqual(a.links.length, 2);
  // A name font that failed (offline) is asked for again when the network is back, and after a reconnect.
  a.links[1].onerror();
  a.listeners.online.forEach((fn) => fn());
  assert.deepStrictEqual(hrefs(a).slice(2), [css2('Bangers')]);
  a.links[2].onerror();
  join(a);
  a.irc.onStatus('closed');
  t.mock.timers.tick(45000);
  join(a);
  assert.deepStrictEqual(hrefs(a).slice(3), [css2('Bangers')]);
});

test('a Google family with a word in capitals, typed in lower case, is asked for in Google\'s spelling', async (t) => {
  const css2 = (family) => 'https://fonts.googleapis.com/css2?family=' + family + ':wght@400;600;700;800&display=swap';
  const h = await boot(t, { search: '?channel=home&font=dm%20serif%20text&name_font=noto+serif+sc' });
  // Not Dm+Serif+Text or Noto+Serif+Sc, which Google Fonts answers with 400.
  assert.deepStrictEqual(h.links.map((l) => l.href), [css2('DM+Serif+Text'), css2('Noto+Serif+SC')]);
});

test('nameFor: colorless chatters keep Twitch\'s palette (Twitch and Kick); name_color, name_fallback and readable_level', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=1' });
  const S = h.S();
  const util = globalThis.TCO.util;
  const tw = { userId: '1007', login: 'plainviewer', displayName: 'PlainViewer', color: '' };
  const kick = { platform: 'kick', userId: 'kick:9000002', login: 'kickplain', displayName: 'KickPlain', color: '' };
  const blue = { userId: '1008', login: 'darkname', displayName: 'DarkName', color: '#0000FF' };
  const color = (m, over) => {
    const keep = S.cfg;
    S.cfg = Object.assign({}, keep, over || {});
    try { return h.deps.nameFor(m).color; } finally { S.cfg = keep; }
  };
  // At the defaults, as in 1.5.2: the palette color by id (or login), then lightened.
  [tw, kick].forEach((m) => assert.strictEqual(color(m), util.readableColor(util.defaultColor(m.userId, m.login)), m.login));
  assert.strictEqual(color(blue), util.readableColor('#0000FF'));
  assert.strictEqual(color(blue, { readable: false }), '#0000FF');
  // name_fallback: only for the chatters without a color, as picked (never lightened).
  [tw, kick].forEach((m) => assert.strictEqual(color(m, { name_fallback: '000033' }), '#000033', m.login));
  assert.strictEqual(color(blue, { name_fallback: '000033' }), util.readableColor('#0000FF'));
  // name_color: everyone, as picked, over the fallback too; a paint still wins in the renderer (paintId unchanged).
  [tw, kick, blue].forEach((m) => assert.strictEqual(color(m, { name_color: '101010', name_fallback: '000033' }), '#101010', m.login));
  // readable_level: the contrast target, times 10.
  assert.strictEqual(color(blue, { readable_level: 70 }), util.readableColor('#0000FF', 7));
  assert.notStrictEqual(color(blue, { readable_level: 70 }), color(blue));
  assert.strictEqual(color(blue, { readable_level: 45 }), color(blue));
  // Anything but six checked hex digits is no color (config.js never lets one through; this checks again).
  ['red', '#ff8800', 'ff8800;x', 'fff', '', 5, null, { toString: () => 'ff8800' }].forEach((v) => {
    assert.strictEqual(color(tw, { name_color: v, name_fallback: v }), util.readableColor(util.defaultColor(tw.userId, tw.login)), String(v));
  });
  // Live from the builder (through config.coerce): '#F80' is ff8800, and Default ('') takes it back.
  globalThis.parent = {};
  const send = (cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
  send({ name_color: '#F80', readable_level: 60, name_sep: 'dash', timestamps: '12h', reply_style: 'name' });
  assert.deepStrictEqual([S.cfg.name_color, S.cfg.readable_level, S.cfg.name_sep, S.cfg.timestamps, S.cfg.reply_style],
    ['ff8800', 60, 'dash', '12h', 'name']);
  assert.strictEqual(h.deps.nameFor(tw).color, '#ff8800');
  send({ name_color: '' });
  assert.strictEqual(h.deps.nameFor(tw).color, util.readableColor(util.defaultColor(tw.userId, tw.login), 6));
});

test('highlights live from the builder: through config.coerce, the words and users as lists; the names nameFor gives stay', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=1' });
  const S = h.S();
  const tw = { userId: '1006', login: 'helpfulmod', displayName: 'HelpfulMod', color: '#00AD03', badges: [{ set: 'moderator', version: '1' }] };
  const before = h.deps.nameFor(tw);
  globalThis.parent = {};
  const send = (cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
  // An item is read as a string is: 'bad name!' is the login 'bad' and 'name!', which is no login.
  send({ mentions: 'NAME', keywords: ['Good  Game', 'gg,wp'], highlight_users: ['@PaintedPal', 'bad name!', 'not.valid'], points_highlight: false,
    role_style: 'bar', mod_color: '#00AD03', keyword_color: 'nope', mention_color: 'f80', channel: 'other' });
  assert.deepStrictEqual([S.cfg.mentions, S.cfg.keywords, S.cfg.highlight_users, S.cfg.points_highlight, S.cfg.role_style,
    S.cfg.mod_color, S.cfg.keyword_color, S.cfg.mention_color], ['name', ['good game', 'gg', 'wp'], ['paintedpal', 'bad'], false, 'bar',
    '00ad03', '', 'ff8800']);
  assert.strictEqual(S.cfg.channel, 'home', 'the channel is a reload key: never sent live');
  // The roles and tints are the renderer's: nameFor (the name and its color) is as before.
  assert.deepStrictEqual(h.deps.nameFor(tw), before);
  send({ keywords: '', highlight_users: [] });
  assert.deepStrictEqual([S.cfg.keywords, S.cfg.highlight_users], [[], []]);
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

test('the developer and Beta Tester badges are drawn on every origin: hosted https, a local folder, OBS local files, local http', async (t) => {
  const h = await boot(t);
  join(h);
  await settle();
  const parse = globalThis.TCO.ircParse;
  const R = globalThis.TCO.renderer._internal;
  const dev = parse.toChatMessage(parse.parseLine(priv('MasstarVT', 'hello')));
  const drawn = () => R.badgeModels(h.deps.badgesFor(dev), 1).map((b) => b.title + ' ' + b.url);
  // Hosted (and the builder's preview there): absolute https URLs, as always.
  globalThis.location.protocol = 'https:';
  globalThis.location.href = 'https://chat.masstar.org/overlay.html?channel=home';
  assert.deepStrictEqual(drawn(), ['MasstarVT developer https://chat.masstar.org/img/logos/Badge.svg',
    'Beta Tester https://chat.masstar.org/img/logos/Beta.svg']);
  // Elsewhere the page's own relative files: a local folder (file:), OBS's "Local file" (http://absolute/), a local or
  // LAN server. The renderer allows exactly these two paths.
  ['file:///C:/overlay/overlay.html', 'http://absolute/C:/overlay/overlay.html', 'http://localhost:8080/overlay.html',
    'http://192.168.1.5:8080/overlay.html'].forEach((href) => {
    globalThis.location.protocol = href.slice(0, href.indexOf(':') + 1);
    globalThis.location.href = href + '?channel=home';
    assert.deepStrictEqual(drawn(), ['MasstarVT developer img/logos/Badge.svg', 'Beta Tester img/logos/Beta.svg'], href);
  });
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

// Kick's StreamElements bot posts as "@StreamElements" with Kick's Bot badge (a real frame, tests/fixtures). Its login
// once kept the '@', which no bot list, block entry or allow_users entry (config.normalizeLogin takes the '@' off) could
// ever name: its ads showed at the defaults and couldn't be blocked.
test('Kick: "@StreamElements" is hidden by bots=0, block=streamelements (or @streamelements); its Bot badge counts too', async (t) => {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'kick-streamelements.json'), 'utf8'));
  const se = JSON.parse(f.data);
  se.chatroom_id = 668;
  const run = async (q) => {
    const h = await boot(t, { search: '?kick=kickname&kick_room=668' + q });
    h.kick.send('ChatMessageEvent', kickChat('KickFan', 'normal viewer line'));
    h.kick.send('ChatMessageEvent', se);
    // Another account with Kick's Bot badge, under a name no bot list has.
    h.kick.send('ChatMessageEvent', kickChat('ChannelHelper', 'timer', { sender: { id: 31, username: 'ChannelHelper', identity: { badges: [{ type: 'bot' }] } } }));
    return h;
  };
  const se1 = /^Dzik Energy/;
  let h = await run('');
  assert.deepStrictEqual(texts(h), ['normal viewer line'], 'the defaults (bots=0)');
  h = await run('&bots=1');
  assert.strictEqual(texts(h).length, 3);
  assert.match(texts(h)[1], se1);
  assert.strictEqual(h.deps.nameFor(h.pushed[1]).text, '@StreamElements', 'shown as Kick sends it');
  for (const b of ['streamelements', '%40streamelements', '@StreamElements']) {
    h = await run('&bots=1&block=' + b);
    assert.deepStrictEqual(texts(h), ['normal viewer line', 'timer'], 'block=' + b);
  }
  h = await run('&bots=1&allow_users=streamelements');
  assert.strictEqual(texts(h).length, 1);
  assert.match(texts(h)[0], se1);
  // A Kick reply quoting it loses the header while it is blocked.
  h = await run('&block=streamelements');
  h.kick.send('ChatMessageEvent', kickChat('Viewer', 'lol', { type: 'reply',
    metadata: { original_sender: { id: 55807129, username: '@StreamElements' }, original_message: { id: 'd7e968e1-0449-4b52-b795-fe35290ecd1f', content: 'ad' } } }));
  const reply = h.pushed[h.pushed.length - 1];
  assert.strictEqual(reply.text, 'lol');
  assert.strictEqual(h.deps.quoteHidden(reply.reply), true);
});

// Kick spells a username's underscores as hyphens in its kick.com/<slug> link. Copied from there into a list of names,
// the name was once dropped (config.normalizeLogin took only [a-z0-9_]), so the chatter was never blocked or allowed.
test('Kick: a chatter named Mr_Mammal is blocked or allowed by mr-mammal, as kick.com spells it, or by the kick.com link', async (t) => {
  const run = async (q) => {
    const h = await boot(t, { search: '?kick=kickname&kick_room=668' + q });
    h.kick.send('ChatMessageEvent', kickChat('Mr_Mammal', 'mammal line'));
    h.kick.send('ChatMessageEvent', kickChat('KickFan', 'fan line'));
    return h;
  };
  assert.deepStrictEqual(texts(await run('&block=mr-mammal')), ['fan line']);
  assert.deepStrictEqual(texts(await run('&block=' + encodeURIComponent('https://kick.com/Mr-Mammal'))), ['fan line']);
  assert.deepStrictEqual(texts(await run('&allow_users=mr-mammal')), ['mammal line']);
  assert.deepStrictEqual(texts(await run('')), ['mammal line', 'fan line']);
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

// A local folder whose settings.js names one Kick channel and its chatroom id, opened as overlay.html?kick=other: the
// overlay joined the settings.js channel's chat (with the other channel's sub badges and 7TV set on top).
test('Kick: a URL naming another channel than settings.js looks it up instead of joining the settings.js chatroom', async (t) => {
  const lookups = [];
  const stubs = (T) => {
    T.kick.lookupChannel = (slug) => {
      lookups.push(slug);
      return Promise.resolve({ chatroomId: slug === 'channel-a' ? '111' : '222', userId: '', slug: slug, username: slug, subBadges: [] });
    };
  };
  let h = await boot(t, { search: '?kick=channel-b', settings: { kick: 'channel-a', kick_room: '111' }, stubs });
  assert.strictEqual(h.S().cfg.kick_room, '');
  assert.strictEqual(h.kick.opts.room, '222', 'channel-b\'s own chat');
  assert.deepStrictEqual(lookups, ['channel-b']);
  h = await boot(t, { search: '?kick=channel-a', settings: { kick: 'channel-a', kick_room: '111' }, stubs });
  assert.strictEqual(h.kick.opts.room, '111', 'the same channel keeps its id');
});

// With kick_room the lookup only adds the sub badge images and the channel's 7TV set. Asked once, a failure at startup
// (OBS starting before the network is up) left them out for the whole stream; now it is retried like any load.
test('Kick with kick_room: a channel lookup that failed is retried (backoff, back online), then adds badges and 7TV', async (t) => {
  let n = 0;
  const h = await boot(t, {
    search: '?kick=kickname&kick_room=668',
    stubs(T) {
      T.kick.lookupChannel = () => (++n === 1 ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ chatroomId: '668', userId: '676', slug: 'kickname', username: 'KickName',
          subBadges: [{ months: 1, url: 'https://files.kick.com/sub/1' }] }));
      T.seventv.loadChannel = (id, plat) => Promise.resolve(plat === 'kick'
        ? { emotes: new Map([['KickSet', { name: 'KickSet' }]]), setId: null, ownerId: null } : null);
    }
  });
  assert.strictEqual(h.kick.started, 1, 'chat connects at once');
  assert.strictEqual(n, 1);
  assert.strictEqual(h.S().loads.get('kick-channel').status, 'failed');
  assert.strictEqual(h.S().kickSubBadges.length, 0);
  // The network is back.
  h.listeners.online.forEach((fn) => fn());
  await settle();
  assert.strictEqual(n, 2);
  assert.strictEqual(h.S().kickSubBadges.length, 1);
  assert.strictEqual(h.S().kickStv.size, 1, 'the Kick channel\'s own 7TV set');
  assert.strictEqual(h.kick.started, 1, 'the chat socket is left as it is');
  assert.strictEqual(h.els.hint.hidden, true);
  // On its own too, after 3 s.
  n = 0;
  const g = await boot(t, {
    search: '?kick=kickname&kick_room=668',
    stubs(T) { T.kick.lookupChannel = () => (++n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(null)); }
  });
  t.mock.timers.tick(3000);
  await settle();
  assert.strictEqual(n, 2);
  assert.strictEqual(g.S().loads.get('kick-channel').status, 'ok', 'a channel Kick doesn\'t know is no failure');
  t.mock.timers.tick(20000);
  await settle();
  assert.strictEqual(g.els.hint.hidden, true, 'chat works with kick_room: no hint');
});

test('Kick: a refused app key shows a hint that joining clears', async (t) => {
  const h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  h.kick.opts.onStatus('fatal', { code: 4001, message: 'x' });
  assert.strictEqual(h.els.hint.hidden, false);
  assert.match(h.els.hint.children[0].textContent, /Kick refused the chat connection \(error 4001\)/);
  h.kick.opts.onStatus('joined');
  assert.strictEqual(h.els.hint.hidden, true);
});

// The hint had one slot: the Kick lookup's hint replaced a sticky Twitch one (a refused channel name, a suspended channel),
// and Kick joining then hid the slot, so the streamer was never told again. Each source now keeps its own line.
test('hints: each source keeps its own line; Kick joining clears only Kick\'s, an IRC join only the lookup\'s', async (t) => {
  const hint = (h) => (h.els.hint.hidden ? null : h.els.hint.children.map((c) => (c.tagName === 'a' ? 'LINK ' + c.href : c.textContent)));
  const stall = (T) => { const d = deferred(); T.kick.lookupChannel = () => d.promise; return d; };
  let look;
  // (1) A refused Twitch name, Kick's lookup stalled: both lines at 10 s, one link; Kick joins and only its line goes.
  let h = await boot(t, { search: '?channel=bad%20name&kick=kickname', stubs(T) { look = stall(T); } });
  const bad = 'Twitch channel "bad name" in the overlay URL isn\'t a valid name: use letters, numbers and _ only.';
  assert.deepStrictEqual(hint(h), [bad, 'LINK builder.html?kick=kickname']);
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(hint(h), [bad, 'Couldn\'t look up the Kick chatroom for "kickname". Set its chatroom id (kick_room) in the builder.',
    'LINK builder.html?kick=kickname']);
  look.resolve({ chatroomId: '668', userId: '', slug: 'kickname', username: 'kickname', subBadges: [] });
  await settle();
  h.kick.opts.onStatus('joined');
  assert.deepStrictEqual(hint(h), [bad, 'LINK builder.html?kick=kickname'], 'the refused name is still said');
  // (2) A suspended channel (Twitch's NOTICE), the lookup's "not found" (not shown beside Twitch's own answer) and Kick's
  // hint: Kick joining clears only its own; the NOTICE's stays.
  h = await boot(t, { search: '?channel=home&kick=kickname', stubs(T) {
    look = stall(T);
    T.twitchBadges.lookupUser = () => Promise.resolve(null);
  } });
  h.feed('@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #home :This channel does not exist or has been suspended.');
  t.mock.timers.tick(10000);
  const suspended = 'Channel "home" does not exist or is suspended.';
  const notFound = 'Channel "home" was not found. Check the name in your overlay URL or settings.js.';
  assert.deepStrictEqual(hint(h).slice(0, 2), [suspended, 'Couldn\'t look up the Kick chatroom for "kickname". Set its chatroom id (kick_room) in the builder.']);
  look.resolve({ chatroomId: '668', userId: '', slug: 'kickname', username: 'kickname', subBadges: [] });
  await settle();
  h.kick.opts.onStatus('joined');
  assert.deepStrictEqual(hint(h), [suspended, 'LINK builder.html?channel=home&kick=kickname']);
  assert.ok(h.S().hints.twitchLookup, 'kept, behind Twitch\'s own answer');
  join(h);
  assert.deepStrictEqual(hint(h), [suspended, 'LINK builder.html?channel=home&kick=kickname']);
  // (3) As before: a Kick hint alone goes when Kick joins, a lookup's alone when IRC joins.
  h = await boot(t, { search: '?kick=kickname&kick_room=668' });
  h.kick.opts.onStatus('fatal', { code: 4001, message: 'x' });
  assert.strictEqual(hint(h).length, 2);
  h.kick.opts.onStatus('joined');
  assert.strictEqual(hint(h), null);
  h = await boot(t, { search: '?channel=home', stubs(T) { T.twitchBadges.lookupUser = () => Promise.resolve(null); } });
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(hint(h), [notFound, 'LINK builder.html?channel=home']);
  join(h);
  assert.strictEqual(hint(h), null);
  // (4) Last (the errors stay set until the test ends): a broken settings.js, then the lookup's "not found": an IRC join
  // clears that one only.
  h = await boot(t, { search: '?channel=home', errors: [{ file: 'settings.js', msg: 'Unexpected token' }],
    stubs(T) { T.twitchBadges.lookupUser = () => Promise.resolve(null); } });
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(hint(h), ['settings.js has an error: Unexpected token', notFound, 'LINK builder.html?channel=home']);
  join(h);
  assert.deepStrictEqual(hint(h), ['settings.js has an error: Unexpected token', 'LINK builder.html?channel=home']);
});

// ---------- event switches and chat filters ----------
// The builder's live updates, as the preview frame gets them.
function sender(h) {
  globalThis.parent = {};
  return (cfg) => h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: cfg } }));
}
const chatMsg = (raw) => globalThis.TCO.ircParse.toChatMessage(globalThis.TCO.ircParse.parseLine(raw));

test('event switches: a type that is off keeps its viewer\'s own message as chat; Kick notices go by type; live too', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&event_subs=0&event_bits_badge=0&event_announcements=0' });
  join(h);
  h.feed(usernotice('resub', 'fan', 'still here'));
  h.feed(usernotice('sub', 'newbie', ''));
  h.feed(usernotice('giftpaidupgrade', 'upgrader', ''));
  h.feed(usernotice('raid', 'raider', ''));
  h.feed(usernotice('bitsbadgetier', 'cheerer', 'wow', { 'msg-param-threshold': '1000' }));
  h.feed(usernotice('announcement', 'mod', 'big news', { 'msg-param-color': 'BLUE' }));
  h.feed(priv('cheerer', 'Cheer100 cheers always show', { bits: '100' }));
  h.kick.send('SubscriptionEvent', { chatroom_id: 668, username: 'KickSub', months: 3 });
  h.kick.send('StreamHostEvent', { chatroom_id: 668, host_username: 'KickHost', number_viewers: 5 });
  const seen = () => h.pushed.map((m) => m.kind + ':' + (m.type || '') + ':' + (m.text || ''));
  assert.deepStrictEqual(seen(), ['chat:resub:still here', 'notice:raid:', 'chat:bitsbadgetier:wow',
    'chat::Cheer100 cheers always show', 'notice:raid:']);
  // The resub's text keeps its type, but it is a chat line: the switches never hide it.
  const resubText = h.pushed[0];
  // Live from the builder: the switches go through config.coerce, and each notice goes by its own type.
  const send = sender(h);
  send({ event_subs: '1', event_raids: false, event_announcements: 'nope' });
  const S = h.S();
  assert.deepStrictEqual([S.cfg.event_subs, S.cfg.event_raids, S.cfg.event_announcements], [true, false, false]);
  assert.strictEqual(h.deps.shouldShow(h.pushed[1]), false, 'a Twitch raid');
  assert.strictEqual(h.deps.shouldShow(h.pushed[4]), false, 'a Kick host is a raid');
  assert.strictEqual(h.deps.shouldShow(resubText), true);
  send({ event_subs: false });
  assert.strictEqual(h.deps.shouldShow(resubText), true, 'the viewer\'s own message stays');
  const ann = h.pushed.length;
  send({ event_announcements: true });
  h.feed(usernotice('announcement', 'mod', 'big news', { 'msg-param-color': 'BLUE' }));
  assert.deepStrictEqual(seen().slice(ann), ['chat:announcement:big news']);
  send({ events: false, event_announcements: true });
  assert.strictEqual(h.deps.shouldShow(h.pushed[ann]), false, 'events=0 still hides every one');
});

// Twitch sends these without the viewer's own text: dropped from the notice types, nothing showed at all.
test('event switches: a Prime-to-paid sub upgrade is a sub notice, a pay-it-forward gift a gift notice', async (t) => {
  const sys = (s) => ({ 'system-msg': s.replace(/ /g, '\\s') }); // an IRC tag value: spaces escaped
  const feedAll = (h) => {
    h.feed(usernotice('primepaidupgrade', 'upgrader', '', sys('upgrader converted from a Prime sub to a Tier 1 sub!')));
    h.feed(usernotice('standardpayforward', 'payer', '', sys('payer is paying forward the Gift they got from gifter to friend!')));
    h.feed(usernotice('communitypayforward', 'payer2', '', sys('payer2 is paying forward the Gift they got from gifter to the community!')));
  };
  const seen = (h) => h.pushed.map((m) => m.kind + ':' + m.type + ':' + m.systemMsg);
  let h = await boot(t, { search: '?channel=home&history=0' });
  join(h);
  feedAll(h);
  assert.deepStrictEqual(seen(h), ['notice:primepaidupgrade:upgrader converted from a Prime sub to a Tier 1 sub!',
    'notice:standardpayforward:payer is paying forward the Gift they got from gifter to friend!',
    'notice:communitypayforward:payer2 is paying forward the Gift they got from gifter to the community!']);
  // Each goes by its own switch, live too; events=0 hides them all.
  const send = sender(h);
  send({ event_subs: false });
  assert.deepStrictEqual(h.pushed.map((m) => h.deps.shouldShow(m)), [false, true, true]);
  send({ event_subs: true, event_gifts: false });
  assert.deepStrictEqual(h.pushed.map((m) => h.deps.shouldShow(m)), [true, false, false]);
  send({ event_gifts: true, events: false });
  assert.deepStrictEqual(h.pushed.map((m) => h.deps.shouldShow(m)), [false, false, false]);
  for (const q of ['events=0', 'event_subs=0', 'event_gifts=0']) {
    h = await boot(t, { search: '?channel=home&history=0&' + q });
    join(h);
    feedAll(h);
    assert.deepStrictEqual(h.pushed.map((m) => m.type), q === 'events=0' ? [] : q === 'event_subs=0'
      ? ['standardpayforward', 'communitypayforward'] : ['primepaidupgrade'], q);
  }
});

test('chat filters: words, links and length hide chat lines only; a reply quoting a hidden message loses the quote', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&block_words=spoiler,bad%20words&links=hide&min_length=4' });
  join(h);
  const reply = (body) => ({ 'reply-parent-msg-id': 'p', 'reply-parent-user-login': 'someone', 'reply-parent-display-name': 'Someone',
    'reply-parent-msg-body': body });
  ['the SPOILER is here', 'no spoilers', 'such bad  words', 'see https://x.com/a', 'example.com is fine', 'gg', 'LUL!'].forEach((s) =>
    h.feed(priv('viewer', s)));
  h.feed(priv('viewer', '@Someone gg', reply('hi')));
  h.feed(priv('viewer', '\u0001ACTION hi\u0001'));
  h.feed(priv('viewer', 'hi ͏'));
  h.feed(priv('viewer', 'okay then', reply('the\\sspoiler\\sis\\shere')));
  h.feed(priv('viewer', 'right then', reply('look\\shttps://x.com')));
  h.feed(priv('viewer', 'fine reply', reply('all\\sgood')));
  h.feed(usernotice('resub', 'fan', 'spoiler'));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'kick spoiler line'));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'kick www.example.org/x'));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'kick is fine'));
  assert.deepStrictEqual(texts(h), ['no spoilers', 'example.com is fine', 'LUL!', 'okay then', 'right then', 'fine reply', 'spoiler',
    'kick is fine']);
  // The reply stays on the message; its header is left out as the line is drawn (deps.quoteHidden).
  assert.deepStrictEqual(h.pushed.slice(3, 6).map((m) => !!m.reply), [true, true, true]);
  assert.deepStrictEqual(h.pushed.slice(3, 6).map((m) => h.deps.quoteHidden(m.reply)), [true, true, false],
    'the quote goes with what it quotes');
  // The resub notice stays; the text line under it is a chat line, which the renderer checks on its own.
  const resub = h.pushed[6];
  assert.strictEqual(resub.kind, 'notice');
  assert.strictEqual(h.deps.shouldShow(globalThis.TCO.renderer._internal.userPart(resub)), false);
  // Live: the patterns are rebuilt for the new settings.
  const send = sender(h);
  send({ block_words: 'Fine', links: 'show', min_length: '0' });
  assert.deepStrictEqual(['the SPOILER is here', 'see https://x.com/a', 'gg', 'fine', 'so FINE'].map((s) =>
    h.deps.shouldShow(chatMsg(priv('viewer', s)))), [true, true, true, false, false]);
  send({ block_words: [], min_length: 3 });
  // Characters as seen: an emoji with its variation sign or skin tone, a flag and a family are one each.
  assert.deepStrictEqual(['gg', 'LUL', '  gg  ', '👋👋', '👋👋👋', '❤️❤️', '👍🏽👍🏽', '🇺🇸🇺🇸', '👨‍👩‍👧👨‍👩‍👧', '👍🏽👍🏽👍🏽']
    .map((s) => h.deps.shouldShow(chatMsg(priv('viewer', s)))), [false, true, false, false, true, false, false, false, false, true]);
  // A repeated message's invisible duplicate suffix (Chatterino and 7TV send ' \u{E0000}') and other invisible characters
  // at either end are not counted: they are drawn as nothing.
  const shown = (list) => list.map((s) => h.deps.shouldShow(chatMsg(priv('viewer', s))));
  assert.deepStrictEqual(shown(['gg \u{E0000}', 'gg\u{E0000}', 'gg \u{E0000}\u{E0000}', '​gg​', 'gg⁠', 'LUL \u{E0000}']),
    [false, false, false, false, false, true]);
  send({ min_length: 4 });
  assert.deepStrictEqual(shown(['gg \u{E0000}', 'o7 \u{E0000}', 'LUL \u{E0000}', 'ggg​', 'okay \u{E0000}', 'okay', '👨‍👩‍👧👨‍👩‍👧 \u{E0000}']),
    [false, false, false, false, true, true, false]);
  // A reply whose quote goes keeps its parent, so its "@Someone" is still left out of the length and the command check.
  send({ block_words: 'spoiler', links: 'hide', min_length: 4, hide_commands: true });
  const n = h.pushed.length;
  h.feed(priv('viewer', '@Someone ok', reply('a\\sspoiler\\shere')));
  h.feed(priv('viewer', '@Someone !cmd2', reply('see\\shttps://x.com')));
  h.feed(priv('viewer', '@Someone fine2', reply('a\\sspoiler\\shere')));
  assert.deepStrictEqual(texts(h).slice(n), ['@Someone fine2']);
  assert.strictEqual(h.deps.quoteHidden(h.pushed[n].reply), true, 'kept, with its header left out');
  // Decided as the line is drawn: back once the word is gone; reply_style=name keeps it (it quotes nothing).
  send({ block_words: [] });
  assert.strictEqual(h.deps.quoteHidden(h.pushed[n].reply), false);
  send({ block_words: 'spoiler', reply_style: 'name' });
  assert.strictEqual(h.deps.quoteHidden(h.pushed[n].reply), false);
  assert.strictEqual(h.deps.quoteHidden(undefined), false);
});

// A Twitch reply's text starts with "@Parent", which isn't drawn while replies are on: block_words once matched it, so
// block_words=simp hid every reply to the chatter Simp (and none of Simp's own lines).
test('block_words: a reply\'s "@Parent" is matched only where it is drawn (replies=0); a Kick line as Kick sends it', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&block_words=simp' });
  join(h);
  const toSimp = { 'reply-parent-msg-id': 'p', 'reply-parent-user-id': 'u-simp', 'reply-parent-user-login': 'simp',
    'reply-parent-display-name': 'Simp', 'reply-parent-msg-body': 'hello\\sall' };
  h.feed(priv('simp', 'hello all'));
  h.feed(priv('amy', '@Simp thanks for the sub!', toSimp));
  h.feed(priv('amy', '@simp nice play', toSimp));
  h.feed(priv('amy', '@Simp what a simp', toSimp));
  h.feed(priv('amy', 'what a simp'));
  // A Kick reply's text doesn't name its parent: an "@Simp" there was typed, and is drawn.
  h.kick.send('ChatMessageEvent', kickChat('kfan', '@Simp hi', { type: 'reply',
    metadata: { original_sender: { id: 1, username: 'Simp' }, original_message: { id: 'k-p', content: 'yo' } } }));
  assert.deepStrictEqual(texts(h), ['hello all', '@Simp thanks for the sub!', '@simp nice play']);
  // replies=0 draws the "@Simp": then it is matched.
  const send = sender(h);
  send({ replies: false });
  assert.deepStrictEqual(h.pushed.slice(1).map((m) => h.deps.shouldShow(m)), [false, false]);
  send({ replies: true });
  assert.deepStrictEqual(h.pushed.slice(1).map((m) => h.deps.shouldShow(m)), [true, true]);
});

test('block: a reply to a blocked user goes through min_length and the command check like any reply; live, headers follow', async (t) => {
  const h = await boot(t, { search: '?channel=home&history=0&block=spammer&hide_commands=1&min_length=4' });
  join(h);
  const to = (login) => ({ 'reply-parent-msg-id': 'p-' + login, 'reply-parent-user-login': login, 'reply-parent-display-name': login,
    'reply-parent-msg-body': 'something' });
  const show = (s, login) => h.deps.shouldShow(chatMsg(priv('viewer', s, to(login))));
  // The "@name" is left out of the length and the command check, whoever is answered.
  assert.deepStrictEqual(['@spammer !uptime', '@spammer gg', '@spammer okay then'].map((s) => show(s, 'spammer')), [false, false, true]);
  assert.deepStrictEqual(['@friend !uptime', '@friend gg', '@friend okay then'].map((s) => show(s, 'friend')), [false, false, true]);
  // With '@' as a command sign a reply still shows (README), a reply to a blocked user too.
  const send = sender(h);
  send({ command_prefixes: '!@', min_length: 0 });
  assert.deepStrictEqual([show('@spammer that was rude', 'spammer'), show('@friend that was nice', 'friend')], [true, true]);
  assert.strictEqual(h.deps.shouldShow(chatMsg(priv('viewer', '@spammer hi'))), false, 'naming someone is still hidden');
  // Live: the block list decides the header as the line is drawn, so adding a user drops it and taking them off
  // brings it back (as a reload would draw it).
  h.feed(priv('viewer', '@HelpfulMod gg thanks', { 'reply-parent-msg-id': 'q', 'reply-parent-user-login': 'helpfulmod',
    'reply-parent-display-name': 'HelpfulMod', 'reply-parent-msg-body': 'be\\snice' }));
  const line = h.pushed[h.pushed.length - 1];
  assert.strictEqual(line.text, '@HelpfulMod gg thanks');
  assert.strictEqual(h.deps.quoteHidden(line.reply), false);
  send({ block: 'spammer, HelpfulMod' });
  assert.strictEqual(h.deps.quoteHidden(line.reply), true);
  assert.deepStrictEqual(h.deps.tokensFor(line).map((i) => i.text), ['gg thanks']);
  send({ block: '' });
  assert.strictEqual(h.deps.quoteHidden(line.reply), false);
});

// min_length counts what is drawn, as block_words matches it: a Twitch reply's "@Parent" is left out only while replies
// is on; with replies=0 it is drawn, and counted, and a Kick reply's text (which Kick never prefixes) counts whole.
test('min_length: a reply\'s "@Parent" counts where it is drawn (replies=0, and a Kick reply that typed it)', async (t) => {
  const toBob = { 'reply-parent-msg-id': 'p', 'reply-parent-user-id': 'u-bob', 'reply-parent-user-login': 'bob',
    'reply-parent-display-name': 'Bob', 'reply-parent-msg-body': 'hi' };
  const kickReply = (content) => kickChat('kfan', content, { type: 'reply',
    metadata: { original_sender: { id: 1, username: 'friend' }, original_message: { id: 'k-p', content: 'yo' } } });
  let h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&replies=0&min_length=8' });
  join(h);
  h.feed(priv('viewer', '@Bob hello', toBob));
  h.feed(priv('viewer', 'abcdefghij'));
  h.feed(priv('viewer', '@Bob hi', toBob));
  h.kick.send('ChatMessageEvent', kickReply('@friend gg'));
  assert.deepStrictEqual(texts(h), ['@Bob hello', 'abcdefghij', '@friend gg'], 'counted as drawn: 10 characters each');
  assert.deepStrictEqual(h.deps.tokensFor(h.pushed[0]).map((i) => i.text), ['@Bob hello'], 'drawn whole');
  // block_words agrees: the drawn "@Bob" is matched.
  const send = sender(h);
  send({ block_words: 'bob', min_length: 0 });
  assert.strictEqual(h.deps.shouldShow(h.pushed[0]), false);
  // Live: replies on leaves the "@Bob" out of the drawing and of the count; the Kick reply still counts whole.
  send({ block_words: [], min_length: 8, replies: true });
  assert.deepStrictEqual(h.pushed.map((m) => h.deps.shouldShow(m)), [false, true, true]);
  h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&min_length=8' });
  join(h);
  h.feed(priv('viewer', '@Bob hello', toBob));
  h.kick.send('ChatMessageEvent', kickReply('@friend gg'));
  assert.deepStrictEqual(texts(h), ['@friend gg'], 'replies on: "hello" is 5');
});

test('role_filter and allow_users: chat lines only, from the badge tags (Twitch, Kick, Shared Chat); the broadcaster always', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0' });
  join(h);
  const send = sender(h);
  const tw = (badges, extra) => chatMsg(priv('u' + badges.replace(/\W/g, ''), 'hi', Object.assign({ badges: badges }, extra || {})));
  const lines = {
    plain: tw(''), sub: tw('subscriber/3'), founder: tw('founder/0'), vip: tw('vip/1'), mod: tw('moderator/1'),
    lead: tw('lead_moderator/1'), caster: tw('broadcaster/1'),
    partnerMod: tw('', { 'source-room-id': PARTNER, 'source-badges': 'moderator/1' }),
    kickVip: { platform: 'kick', kind: 'chat', login: 'kv', text: 'hi', kickBadges: [{ type: 'vip' }] },
    kickOg: { platform: 'kick', kind: 'chat', login: 'ko', text: 'hi', kickBadges: [{ type: 'og' }] }
  };
  const notice = { kind: 'notice', type: 'raid', login: 'raider', systemMsg: 'raid!', badges: [] };
  const shown = () => Object.keys(lines).filter((k) => h.deps.shouldShow(lines[k]));
  assert.strictEqual(shown().length, 10);
  send({ role_filter: 'subs' });
  assert.deepStrictEqual(shown(), ['sub', 'founder', 'vip', 'mod', 'lead', 'caster', 'partnerMod', 'kickVip']);
  send({ role_filter: 'vips' });
  assert.deepStrictEqual(shown(), ['vip', 'mod', 'lead', 'caster', 'partnerMod', 'kickVip']);
  send({ role_filter: 'MODS' });
  assert.deepStrictEqual(shown(), ['mod', 'lead', 'caster', 'partnerMod']);
  assert.strictEqual(h.deps.shouldShow(notice), true, 'notices follow the event switches');
  // allow_users: only these users' chat lines, along with every other filter; notices unaffected.
  send({ role_filter: 'all', allow_users: '@UMODERATOR1, kv' });
  assert.deepStrictEqual(shown(), ['mod', 'kickVip']);
  assert.strictEqual(h.deps.shouldShow(notice), true);
  send({ role_filter: 'vips', allow_users: 'umoderator1,kv,u' });
  assert.deepStrictEqual(shown(), ['mod', 'partnerMod', 'kickVip']);
  send({ role_filter: 'all', allow_users: '' });
  assert.strictEqual(shown().length, 10);
});

test('command_prefixes: each sign as itself (- and ^ too), a reply\'s @name still skipped; live through config.coerce', async (t) => {
  const h = await boot(t, { search: '?channel=home&hide_commands=1&command_prefixes=!-%3F' });
  join(h);
  assert.strictEqual(h.S().cfg.command_prefixes, '!-?');
  const show = (s, extra) => h.deps.shouldShow(chatMsg(priv('viewer', s, extra)));
  // '!-?' as a range would take the digits, quotes and commas between them.
  assert.deepStrictEqual(['!cmd', '-cmd', '?cmd', '  ?cmd', '0 digits', '"quote', ',comma', '/slash', 'a?'].map((s) => show(s)),
    [false, false, false, false, true, true, true, true, true]);
  assert.strictEqual(show('@Nightbot ?help', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'nightbot',
    'reply-parent-display-name': 'Nightbot' }), false, 'after a reply\'s @name');
  const send = sender(h);
  send({ command_prefixes: '^' });
  assert.deepStrictEqual(['^cmd', 'hello', '!cmd'].map((s) => show(s)), [false, true, true], '^ is no negation');
  send({ command_prefixes: 'nope' });
  assert.strictEqual(h.S().cfg.command_prefixes, '^', 'an invalid value is not taken');
  send({ command_prefixes: '@#' });
  assert.deepStrictEqual(['@home hi', '#tag', '!cmd'].map((s) => show(s)), [false, false, true]);
  assert.strictEqual(show('@Someone hi', { 'reply-parent-msg-id': 'x', 'reply-parent-user-login': 'someone',
    'reply-parent-display-name': 'Someone' }), true, 'a reply still shows');
  send({ hide_commands: false });
  assert.strictEqual(show('#tag'), true, 'only with hide_commands');
});

test('links=shorten: Twitch and Kick text shows each link as its host, never as a link; live', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&links=shorten' });
  join(h);
  h.feed(priv('viewer', 'look https://clips.twitch.tv/abc?x=1 now Kappa', { emotes: '25:41-45' }));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'kick www.example.org/page [emote:37226:KEKW]'));
  const [tw, kk] = h.pushed;
  const text = (items) => items.map((i) => (i.type === 'text' ? i.text : i.type + ':' + i.emote.name));
  assert.deepStrictEqual(text(h.deps.tokensFor(tw)), ['look clips.twitch.tv now', 'emote:Kappa']);
  assert.deepStrictEqual(text(h.deps.tokensFor(kk)), ['kick www.example.org', 'emote:KEKW']);
  assert.strictEqual(tw.text, 'look https://clips.twitch.tv/abc?x=1 now Kappa', 'the message itself is unchanged');
  assert.strictEqual(h.deps.shouldShow(tw), true);
  sender(h)({ links: 'show' });
  assert.deepStrictEqual(text(h.deps.tokensFor(tw)), ['look https://clips.twitch.tv/abc?x=1 now', 'emote:Kappa']);
  assert.deepStrictEqual(text(h.deps.tokensFor(kk)), ['kick www.example.org/page', 'emote:KEKW']);
});

// ---------- overlay-runtime follow-up fixes ----------

// A kick_room left from an older builder URL (it kept the old channel's id when a Kick name was retyped) or mistyped: the
// overlay stayed in that chatroom for the whole stream, though its own lookup, which got through, named another one.
test('Kick with kick_room: a lookup that gives the channel another chatroom moves the overlay there; the wrong room\'s lines go', async (t) => {
  const answer = (room) => ({ chatroomId: room, userId: '', slug: 'newchan', username: 'NewChan',
    subBadges: [{ months: 1, url: 'https://files.kick.com/sub/1' }] });
  const look = deferred();
  let h = await boot(t, { search: '?channel=home&kick=newchan&kick_room=111&history=0', stubs(T) { T.kick.lookupChannel = () => look.promise; } });
  join(h);
  const wrong = h.kick;
  assert.strictEqual(wrong.opts.room, '111', 'kick_room is joined at once');
  wrong.send('ChatMessageEvent', kickChat('elsewhere', 'another channel\'s chat'));
  h.feed(priv('viewer', 'twitch line'));
  look.resolve(answer('222'));
  await settle();
  assert.strictEqual(wrong.stopped, 1, 'the wrong chatroom is left');
  assert.deepStrictEqual(h.kickClients.map((k) => k.opts.room), ['111', '222']);
  assert.strictEqual(h.kick.started, 1);
  assert.deepStrictEqual(texts(h), ['twitch line'], 'its lines go, Twitch\'s stay');
  assert.deepStrictEqual(h.cleared, [], 'as lines that were never the channel\'s, not as moderation');
  assert.strictEqual(h.S().kickSubBadges.length, 1, 'the lookup\'s extras apply as before');
  h.kick.send('ChatMessageEvent', kickChat('fan', 'the channel\'s own chat'));
  assert.deepStrictEqual(texts(h), ['twitch line', 'the channel\'s own chat']);

  // Kick events still waiting for Twitch history go too.
  const hist = deferred(), look2 = deferred();
  h = await boot(t, { search: '?channel=home&kick=newchan&kick_room=111', stubs(T) {
    T.kick.lookupChannel = () => look2.promise;
    T.irc.loadHistory = () => hist.promise;
  } });
  join(h);
  h.kick.send('ChatMessageEvent', kickChat('elsewhere', 'buffered wrong line'));
  h.feed(priv('viewer', 'buffered twitch line'));
  look2.resolve(answer('222'));
  await settle();
  h.kick.send('ChatMessageEvent', kickChat('fan', 'right line'));
  hist.resolve([]);
  await settle();
  assert.deepStrictEqual(texts(h), ['buffered twitch line', 'right line']);

  // The same chatroom, a channel Kick doesn't know (null) or a lookup that fails: kick_room stays.
  for (const lookup of [() => Promise.resolve(answer('111')), () => Promise.resolve(null), () => Promise.reject(new TypeError('Failed to fetch'))]) {
    h = await boot(t, { search: '?kick=newchan&kick_room=111', stubs(T) { T.kick.lookupChannel = lookup; } });
    await settle();
    assert.deepStrictEqual(h.kickClients.map((k) => [k.opts.room, k.stopped]), [['111', 0]]);
  }
});
// The Kick channel's 7TV set was loaded once and never registered or subscribed: emotes added or removed mid-stream, and
// set switches, never reached Kick lines, and a Kick-only overlay had no 7TV live socket at all.
const STV_OWNER = '01GJTZ1F90000AXQX83F1Y559G';
const SET_A = '01FE9DRF000009TR6M9N941CYW';
const SET_B = '01HB76NJV00002MN9KWN633MB1';
const SET_C = '01JJJ74CRHZBRMCM8F4Y2WBN6R';
const stvEmote = (name) => ({ provider: '7tv', id: 'e-' + name, name: name, w: 28, h: 28, urls: { 1: 'https://cdn.7tv.app/emote/e-' + name + '/1x.webp' } });
const v3Emote = (name) => ({ id: 'e-' + name, name: name, flags: 0, data: { id: 'e-' + name, flags: 0,
  host: { url: '//cdn.7tv.app/emote/e-' + name, files: [{ name: '1x.webp', format: 'WEBP', width: 28, height: 28 }] } } });
const setSwitch = (index, from, to) => ({ id: STV_OWNER, updated: [{ key: 'connections', index: index, nested: true,
  value: [{ key: 'emote_set_id', old_value: from, value: to }] }] });
const emoteNames = (h, m) => h.deps.tokensFor(m).filter((i) => i.type === 'emote').map((i) => i.emote.name);
// A streamer whose Twitch and Kick channels are one 7TV account (connections 0 and 1), both on set A at first. k.kickLoads:
// the Kick user ids its set was loaded by.
function kick7tv(k) {
  return function (T) {
    T.kick.lookupChannel = () => Promise.resolve({ chatroomId: '668', userId: '77', slug: 'kickname', username: 'KickName', subBadges: [] });
    T.seventv.loadChannel = (id, plat) => {
      if (plat === 'kick') k.kickLoads.push(id);
      return Promise.resolve({ emotes: new Map([['OLD', stvEmote('OLD')]]), setId: SET_A, ownerId: STV_OWNER, connIndex: plat === 'kick' ? 1 : 0 });
    };
    T.seventv.loadSet = (id) => Promise.resolve(new Map([['IN_' + id.slice(-4), stvEmote('IN_' + id.slice(-4))]]));
  };
}

test('Kick 7TV: the Kick channel\'s set gets live updates (one dispatch for a set Twitch shares), Kick lines redraw, reconnects refetch', async (t) => {
  const k = { kickLoads: [] };
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0', stubs: kick7tv(k) });
  join(h);
  await settle();
  const S = h.S();
  h.kick.send('ChatMessageEvent', kickChat('fan', 'NEW OLD'));
  h.feed(priv('viewer', 'NEW OLD'));
  const [kk, tw] = h.pushed;
  assert.deepStrictEqual([emoteNames(h, kk), emoteNames(h, tw)], [['OLD'], ['OLD']]);
  assert.deepStrictEqual(h.stv.channels, [HOME], 'one socket, following the Twitch channel');
  assert.ok(h.stv.objects.includes(SET_A) && h.stv.objects.includes(STV_OWNER));
  t.mock.timers.tick(200);
  h.redrawn.length = 0;
  // The streamer adds an emote to the set both channels use: one dispatch reaches both.
  S.stv.handleDispatch('emote_set.update', { id: SET_A, pushed: [{ key: 'emotes', value: v3Emote('NEW') }] });
  t.mock.timers.tick(120);
  assert.deepStrictEqual([emoteNames(h, kk), emoteNames(h, tw)], [['NEW', 'OLD'], ['NEW', 'OLD']]);
  assert.ok(h.redrawn.some((hit) => hit.includes(kk)), 'the Kick line already shown is redrawn');
  // ... and removes one.
  S.stv.handleDispatch('emote_set.update', { id: SET_A, pulled: [{ key: 'emotes', old_value: { id: 'e-OLD', name: 'OLD' } }] });
  assert.deepStrictEqual(emoteNames(h, kk), ['NEW']);
  // A 7TV reconnect (7TV has no resume) refetches the Kick set as well as the Twitch one.
  assert.deepStrictEqual(k.kickLoads, ['77']);
  h.stv.opts.onReady();
  h.stv.opts.onReady();
  await settle();
  assert.deepStrictEqual(k.kickLoads, ['77', '77']);
});

test('Kick 7TV: a set switch on the streamer\'s Kick connection reaches Kick lines only, a Twitch one Twitch lines only', async (t) => {
  const k = { kickLoads: [] };
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0', stubs: kick7tv(k) });
  join(h);
  await settle();
  const S = h.S(), home = S.rooms.home();
  S.stv.handleDispatch('user.update', setSwitch(1, SET_A, SET_B));
  await settle();
  assert.strictEqual(S.kickCtx.stv.setId, SET_B);
  assert.deepStrictEqual(Array.from(S.kickStv.keys()), ['IN_' + SET_B.slice(-4)]);
  assert.strictEqual(home.stv.setId, SET_A, 'the Twitch channel keeps its set');
  assert.deepStrictEqual(Array.from(home.stv.emotes.keys()), ['OLD']);
  assert.ok(h.stv.objects.includes(SET_B));
  assert.deepStrictEqual(h.stv.removed, [], 'set A stays subscribed: the Twitch channel still uses it');
  S.stv.handleDispatch('user.update', setSwitch(0, SET_A, SET_C));
  await settle();
  assert.strictEqual(home.stv.setId, SET_C);
  assert.strictEqual(S.kickCtx.stv.setId, SET_B);
  assert.deepStrictEqual(h.stv.removed, [SET_A], 'now nothing uses set A');
  S.stv.handleDispatch('emote_set.update', { id: SET_B, pushed: [{ key: 'emotes', value: v3Emote('KICKNEW') }] });
  assert.ok(S.kickStv.has('KICKNEW') && !home.stv.emotes.has('KICKNEW'));
  // The Kick connection's set turned off: confirmed over REST, as the Twitch one's is.
  S.stv.handleDispatch('user.update', setSwitch(1, SET_B, null));
  await settle();
  assert.deepStrictEqual(k.kickLoads, ['77', '77']);
});

test('Kick 7TV: a Kick-only overlay opens the 7TV live socket for the Kick channel\'s set; none with 7TV emotes off', async (t) => {
  const k = { kickLoads: [] };
  const h = await boot(t, { search: '?kick=kickname&kick_room=668', stubs: kick7tv(k) });
  await settle();
  assert.strictEqual(h.stvClients, 1);
  assert.strictEqual(h.stv.started, 1);
  assert.deepStrictEqual(h.stv.channels, [], 'no Twitch channel to follow');
  assert.deepStrictEqual(h.stv.objects.slice().sort(), [STV_OWNER, SET_A].sort());
  h.kick.send('ChatMessageEvent', kickChat('fan', 'NEW'));
  h.S().stv.handleDispatch('emote_set.update', { id: SET_A, pushed: [{ key: 'emotes', value: v3Emote('NEW') }] });
  assert.deepStrictEqual(emoteNames(h, h.pushed[0]), ['NEW']);
  const g = await boot(t, { search: '?kick=kickname&kick_room=668&emotes_7tv=0', stubs: kick7tv({ kickLoads: [] }) });
  await settle();
  assert.strictEqual(g.stvClients, 0);
});

// user.update names the connection whose set changed by its index; the overlay sent every switch to the Twitch channel.
test('7TV: a Twitch-only overlay leaves a set switch on the streamer\'s Kick connection alone', async (t) => {
  const h = await boot(t, { search: '?channel=home&history=0', stubs: kick7tv({ kickLoads: [] }) });
  join(h);
  await settle();
  const home = h.S().rooms.home();
  h.S().stv.handleDispatch('user.update', setSwitch(1, SET_A, SET_B));
  await settle();
  assert.strictEqual(home.stv.setId, SET_A);
  assert.deepStrictEqual(Array.from(home.stv.emotes.keys()), ['OLD']);
  h.S().stv.handleDispatch('user.update', setSwitch(0, SET_A, SET_C));
  await settle();
  assert.strictEqual(home.stv.setId, SET_C);
});
// Turned on live in the builder's preview, paints or 7TV badges loaded the catalog but looked nobody up: the chatters on
// screen (and anyone who spoke while it was off) stayed unpainted until they spoke again, unlike after a reload.
test('paints or 7TV badges turned on live: the chatters already shown or seen lately are looked up, as on a reload', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&paints=0&badges_7tv=0' });
  join(h);
  h.feed(priv('amy', 'hello'));
  h.feed(priv('bob', 'hi'));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'kick hi'));
  assert.deepStrictEqual(h.lookupWants, []);
  const wanted = () => Array.from(new Set(h.lookupWants)).sort();
  const send = sender(h);
  send({ paints: true });
  assert.deepStrictEqual(wanted(), ['u-amy', 'u-bob'], 'Kick chatters are never looked up by Twitch id');
  // Off, a new chatter, then on again: everyone is asked for (the lookup skips those it knows).
  send({ paints: false });
  h.feed(priv('cy', 'hey'));
  h.lookupWants.length = 0;
  send({ paints: true });
  assert.deepStrictEqual(wanted(), ['u-amy', 'u-bob', 'u-cy']);
  // Another 7TV switch while one is already on looks nobody up again.
  h.lookupWants.length = 0;
  send({ badges_7tv: true });
  assert.deepStrictEqual(h.lookupWants, []);
  // 7TV badges alone do it too.
  send({ paints: false, badges_7tv: false });
  h.lookupWants.length = 0;
  send({ badges_7tv: true });
  assert.deepStrictEqual(wanted(), ['u-amy', 'u-bob', 'u-cy']);
});

// deliver dropped a partner's line before the renderer while shared=0, so after a /clear (or a timeout) the renderer never
// knew it was said: a home viewer's reply to it lost its header, as if it were a message from before the clear.
test('shared=0: a reply to what a Shared Chat partner says after a /clear or a timeout keeps its header', async (t) => {
  const h = await boot(t, { search: '?channel=home&history=0&shared=0', realRenderer: true });
  join(h);
  t.mock.timers.tick(3000);
  await settle();
  const replyTo = (id, login, body, text) => priv('amy', text, { 'reply-parent-msg-id': id, 'reply-parent-user-id': 'u-' + login,
    'reply-parent-user-login': login, 'reply-parent-display-name': login, 'reply-parent-msg-body': body.replace(/ /g, '\\s') });
  const headers = () => {
    t.mock.timers.tick(300);
    return h.lines().map((l) => { const r = l.byClass('reply')[0]; return r ? r.textContent : null; });
  };
  h.feed(priv('pat', 'partner before', { id: 'p0', 'source-room-id': PARTNER }));
  h.feed('@room-id=' + HOME + ' :tmi.twitch.tv CLEARCHAT #home');
  h.feed(priv('pat', 'partner after', { id: 'p1', 'source-room-id': PARTNER }));
  h.feed(replyTo('p1', 'pat', 'partner after', '@pat yes'));
  h.feed(replyTo('p0', 'pat', 'partner before', '@pat no'));
  assert.deepStrictEqual(headers(), ['↪ @pat: partner after', null], 'a message from before the clear still loses it');
  // A partner chatter timed out, then back: a reply to what they say afterwards keeps it.
  h.feed('@room-id=' + HOME + ';target-user-id=u-sam :tmi.twitch.tv CLEARCHAT #home :sam');
  h.feed(priv('sam', 'sam is back', { id: 's1', 'source-room-id': PARTNER }));
  h.feed(replyTo('s1', 'sam', 'sam is back', '@sam welcome'));
  assert.deepStrictEqual(headers().slice(-1), ['↪ @sam: sam is back']);
  assert.ok(h.lines().every((l) => !/partner|sam is back/.test(l.byClass('message').map((m) => m.textContent).join(''))),
    'the partner\'s own lines still don\'t show');
});

// bots=0 (the default) hid Nightbot's line, but a viewer's reply to it put the bot's text, link and all, back on stream in
// its header; the same for the channel's BTTV bots, a Shared Chat partner's, and a command that hide_commands hides.
test('a reply quoting a hidden bot (bots=0, the default) or command (hide_commands) shows without the quote; live too', async (t) => {
  const bttv = deferred();
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0', realRenderer: true, stubs(T) {
    const orig = T.bttv.loadChannel;
    T.bttv.loadChannel = function (id, o) {
      orig(id, o);
      return id === HOME ? bttv.promise : Promise.resolve({ emotes: new Map(), bots: new Set(['partnerbot']) });
    };
  } });
  join(h);
  t.mock.timers.tick(3000);
  await settle();
  const headers = async () => {
    t.mock.timers.tick(300);
    await settle();
    t.mock.timers.tick(300);
    return h.lines().map((l) => { const r = l.byClass('reply')[0]; return r ? r.textContent : null; });
  };
  const to = (login, body, extra) => Object.assign({ 'reply-parent-msg-id': 'p-' + login, 'reply-parent-user-login': login,
    'reply-parent-display-name': login, 'reply-parent-msg-body': body.replace(/ /g, '\\s') }, extra || {});
  h.feed(priv('nightbot', 'Follow on twitter https://twitter.com/x'));
  h.feed(priv('amy', '@nightbot thanks', to('nightbot', 'Follow on twitter https://twitter.com/x')));
  h.feed(priv('amy', '@chanbot yay', to('chanbot', 'Raffle starts now')));
  h.feed(priv('amy', '@gambler lol rip', to('gambler', '!gamble all')));
  h.kick.send('ChatMessageEvent', kickChat('kfan', 'ty', { type: 'reply',
    metadata: { original_sender: { id: 9, username: '@StreamElements' }, original_message: { id: 'k-se', content: 'Follow the channel!' } } }));
  h.feed(priv('pat', '@partnerbot ok', Object.assign(to('partnerbot', 'partner raffle'), { 'source-room-id': PARTNER })));
  // The channel's BTTV bot list and the partner's land after the lines: their quotes go then.
  assert.deepStrictEqual(await headers(), [null, '↪ @chanbot: Raffle starts now', '↪ @gambler: !gamble all', null, null]);
  bttv.resolve({ emotes: new Map(), bots: new Set(['chanbot']) });
  await settle();
  assert.deepStrictEqual(await headers(), [null, null, '↪ @gambler: !gamble all', null, null]);
  assert.deepStrictEqual(h.lines().map((l) => l.byClass('message').map((m) => m.textContent).join('')),
    ['thanks', 'yay', 'lol rip', 'ty', 'ok'], 'the replies themselves stay, without their "@name"');
  const send = sender(h);
  send({ hide_commands: true });
  assert.deepStrictEqual(await headers(), [null, null, null, null, null]);
  send({ hide_commands: true, command_prefixes: '?' });
  assert.deepStrictEqual((await headers())[2], '↪ @gambler: !gamble all');
  // A name-only header quotes nothing: it stays.
  send({ hide_commands: true, reply_style: 'name' });
  assert.deepStrictEqual(await headers(), ['↪ @nightbot', '↪ @chanbot', '↪ @gambler', '↪ @StreamElements', '↪ @partnerbot']);
  // bots=1 shows the bots, and the quotes.
  send({ bots: true, hide_commands: false, reply_style: 'full' });
  assert.deepStrictEqual(await headers(), ['↪ @nightbot: Follow on twitter https://twitter.com/x', '↪ @chanbot: Raffle starts now',
    '↪ @gambler: !gamble all', '↪ @StreamElements: Follow the channel!', '↪ @partnerbot: partner raffle']);
  // Called with the reply alone (no message), the home lists apply.
  send({ bots: false });
  assert.strictEqual(h.deps.quoteHidden({ login: 'chanbot', body: 'x' }), true);
  assert.strictEqual(h.deps.quoteHidden({ login: 'partnerbot', body: 'x' }), false);
});

// A channel's own cheermotes showed as plain text ('sodaCheer100'): they are looked up (Twitch GQL) the first time a bits
// message in that channel needs them, the home channel's and a Shared Chat partner's each for its own lines.
test('channel cheermotes: looked up once per channel on a cheer no global cheermote is; partner lines use the partner\'s', async (t) => {
  const T = 'https://d3aqoihi2n8ty8.cloudfront.net/partner-actions/ID/u/TIER/BACKGROUND/ANIMATION/SCALE.EXTENSION';
  const maps = {
    [HOME]: new Map([['homecheer', { prefix: 'homeCheer', tiers: [1, 100], template: T.replace('ID', HOME) }]]),
    [PARTNER]: new Map([['partcheer', { prefix: 'partCheer', tiers: [1, 100], template: T.replace('ID', PARTNER) }]])
  };
  let fail = false;
  const calls = [];
  const h = await boot(t, { search: '?channel=home&history=0', stubs(T2) {
    T2.twitchBadges.loadCheermotes = (id) => {
      calls.push(id);
      return fail ? Promise.reject(new Error('GQL down')) : Promise.resolve(maps[id] || new Map());
    };
  } });
  join(h);
  const kinds = (m) => h.deps.tokensFor(m).map((i) => i.type + ':' + (i.type === 'cheer' ? i.prefix + '/' + i.tier : i.text));
  h.feed(priv('fan', 'Cheer100 global only', { bits: '100' }));
  h.feed(priv('fan', 'homeCheer100 and gg2 without bits'));
  assert.deepStrictEqual(calls, [], 'a global cheer, or no bits: nothing to look up');
  h.feed(priv('fan', 'homeCheer100 nice', { bits: '100' }));
  await settle();
  h.feed(priv('fan', 'homeCheer1 again partCheer1', { bits: '2' }));
  assert.deepStrictEqual(calls, [HOME], 'once per channel');
  assert.deepStrictEqual(kinds(h.pushed[2]), ['cheer:homeCheer/100', 'text:nice']);
  const redraws = h.rerenders;
  t.mock.timers.tick(200);
  assert.ok(h.rerenders > redraws && h.redrawn[h.redrawn.length - 1].indexOf(h.pushed[2]) >= 0, 'its lines with bits are drawn again');
  assert.deepStrictEqual(kinds(h.pushed[3]), ['cheer:homeCheer/1', 'text:again partCheer1'], 'a partner\'s prefix isn\'t the home channel\'s');
  // A Shared Chat partner's line: the partner's own.
  h.feed(priv('pat', 'partCheer100 homeCheer1', { bits: '101', 'source-room-id': PARTNER }));
  await settle();
  assert.deepStrictEqual(calls, [HOME, PARTNER]);
  assert.deepStrictEqual(kinds(h.pushed[4]), ['cheer:partCheer/100', 'text:homeCheer1']);
  // A failed lookup is asked again only on a later cheer, after a while.
  fail = true;
  h.feed(priv('pat', 'otherCheer5', { bits: '5', 'source-room-id': '300' }));
  await settle();
  h.feed(priv('pat', 'otherCheer5', { bits: '5', 'source-room-id': '300' }));
  await settle();
  assert.deepStrictEqual(calls.slice(2), ['300']);
  t.mock.timers.tick(31000);
  fail = false;
  h.feed(priv('pat', 'otherCheer5', { bits: '5', 'source-room-id': '300' }));
  await settle();
  assert.deepStrictEqual(calls.slice(2), ['300', '300']);
});

// Kick's StreamElements bot is named "@StreamElements": a viewer's reply to it was headed "↪ @@StreamElements: …".
test('Kick: a reply to "@StreamElements" is headed "@StreamElements" (both reply styles, bots=1); a Twitch header is unchanged', async (t) => {
  const h = await boot(t, { search: '?channel=home&kick=kickname&kick_room=668&history=0&bots=1', realRenderer: true });
  join(h);
  t.mock.timers.tick(3000);
  await settle();
  const names = () => { t.mock.timers.tick(300); return h.lines().map((l) => l.byClass('reply-name').map((n) => n.textContent).join('')); };
  h.kick.send('ChatMessageEvent', kickChat('Viewer', 'thanks', { type: 'reply',
    metadata: { original_sender: { id: 9000002, username: '@StreamElements' }, original_message: { id: 'k-se', content: 'Follow the channel!' } } }));
  h.feed(priv('amy', '@Bob hi', { 'reply-parent-msg-id': 'p', 'reply-parent-user-login': 'bob', 'reply-parent-display-name': 'Bob',
    'reply-parent-msg-body': 'yo' }));
  assert.deepStrictEqual(names(), ['@StreamElements', '@Bob']);
  assert.strictEqual(h.lines()[0].byClass('reply')[0].textContent, '↪ @StreamElements: Follow the channel!');
  sender(h)({ reply_style: 'name' });
  t.mock.timers.tick(300);
  await settle();
  assert.deepStrictEqual(names(), ['@StreamElements', '@Bob']);
});

// The overlay asked recent-messages for exactly `history` raw lines, and notices, moderation lines and hidden bots among
// them left fewer chat lines on screen.
test('history=N shows the newest N chat lines the filters let through; moderation in the history still applies', async (t) => {
  const P = (raw) => globalThis.TCO.ircParse.parseLine(raw);
  const all = [
    priv('a', 'one'), priv('b', 'two'), priv('troll', 'troll line'), priv('c', 'three'), priv('nightbot', 'Follow the stream!'),
    usernotice('resub', 'x', 'resub text'), priv('d', 'four'), priv('x', 'deleted', { 'rm-deleted': '1' }),
    priv('y', 'gone later', { id: 'gl' }),
    '@room-id=' + HOME + ';target-msg-id=gl :tmi.twitch.tv CLEARMSG #home :gone later', priv('e', 'five'),
    '@room-id=' + HOME + ';target-user-id=u-troll :tmi.twitch.tv CLEARCHAT #home :troll', priv('streamelements', 'an ad'),
    priv('f', 'six')
  ];
  let asked = 0;
  const msgs = (h) => { t.mock.timers.tick(300); return h.lines().map((l) => l.byClass('message').map((m) => m.textContent).join('')); };
  let h = await boot(t, { realRenderer: true, stubs(T) {
    T.irc.loadHistory = (l, limit) => { asked = limit; return Promise.resolve(all.slice(-limit).map(P)); };
  } });
  join(h);
  t.mock.timers.tick(3000);
  await settle();
  assert.strictEqual(asked, 40);
  assert.deepStrictEqual(msgs(h), ['two', 'three', 'four', 'five', 'six']);

  // Lines older than those shown are still known as said: after a /clear in the history, a reply to one of them keeps its
  // header, and one to a message from before the clear doesn't.
  const hist = [priv('a', 'before the clear', { id: 'h0' }), '@room-id=' + HOME + ' :tmi.twitch.tv CLEARCHAT #home',
    priv('b', 'after one', { id: 'h1' }), priv('c', 'after two', { id: 'h2' }), priv('d', 'after three', { id: 'h3' }),
    priv('e', 'after four', { id: 'h4' })];
  h = await boot(t, { search: '?channel=home&history=2', realRenderer: true, stubs(T) {
    T.irc.loadHistory = () => Promise.resolve(hist.map(P));
  } });
  join(h);
  t.mock.timers.tick(3000);
  await settle();
  assert.deepStrictEqual(msgs(h), ['after three', 'after four']);
  const reply = (id, login, body) => priv('amy', 'yes', { 'reply-parent-msg-id': id, 'reply-parent-user-id': 'u-' + login,
    'reply-parent-user-login': login, 'reply-parent-display-name': login, 'reply-parent-msg-body': body.replace(/ /g, '\\s') });
  h.feed(reply('h1', 'b', 'after one'));
  h.feed(reply('h0', 'a', 'before the clear'));
  msgs(h);
  assert.deepStrictEqual(h.lines().slice(-2).map((l) => { const r = l.byClass('reply')[0]; return r ? r.textContent : null; }),
    ['↪ @b: after one', null]);
});
// links=shorten draws a link as its host, but block_words, min_length and a quoted header's check read the whole link.
test('links=shorten: block_words, min_length and a quote\'s check go by the host a link is drawn as', async (t) => {
  const h = await boot(t, { search: '?channel=home&history=0&links=shorten&block_words=clip,spoiler&min_length=20' });
  const show = (text) => h.deps.shouldShow(chatMsg(priv('viewer', text)));
  const clip = 'look at this https://www.twitch.tv/somebody/clip/FunnyClipName';
  const slug = 'https://clips.twitch.tv/LongClipSlug'; // drawn as clips.twitch.tv: 15 characters
  assert.deepStrictEqual([show(clip), show(slug), show('a clip here, long enough to show')], [true, false, false]);
  assert.strictEqual(h.deps.quoteHidden({ login: 'x', body: 'see https://x.com/spoiler' }), false, 'the header draws x.com');
  assert.strictEqual(h.deps.quoteHidden({ login: 'x', body: 'spoiler alert' }), true);
  // links=show: the whole link is drawn, matched and counted.
  sender(h)({ links: 'show' });
  assert.deepStrictEqual([show(clip), show(slug)], [false, true]);
  assert.strictEqual(h.deps.quoteHidden({ login: 'x', body: 'see https://x.com/spoiler' }), true);
});

// paint_images=static never stilled a paint in 7TV's older v3 format: it names one image and not whether it is animated.
test('paint_images=static: a v3 image paint\'s still frame is asked for once, and used when it loads; a still paint is left', async (t) => {
  const probes = [];
  globalThis.Image = function () { probes.push(this); };
  t.after(() => { delete globalThis.Image; });
  const h = await boot(t, { search: '?channel=home&history=0&paint_images=static' });
  const S = h.S(), pc = globalThis.TCO.paintCss;
  const base = 'https://cdn.7tv.app/paint/01FQB6K5T0000BDD0YMN21KEXX/layer/01JAMR1DWJ14HBYADTC6Q634WR/';
  const v3 = (id) => pc.fromV3({ id: id, function: 'URL', image_url: base + '1x.webp', stops: [], shadows: [] });
  S.stv.paints.set('ANIM', v3('ANIM'));
  S.stv.paints.set('STILL', v3('STILL'));
  const ready = [];
  S.renderer.stillReady = (id) => ready.push(id);
  assert.strictEqual(h.deps.paintStaticRule('ANIM'), undefined, 'not known yet');
  assert.strictEqual(h.deps.paintStaticRule('ANIM'), undefined);
  assert.strictEqual(h.deps.paintStaticRule('STILL'), undefined);
  assert.deepStrictEqual(probes.map((p) => p.src), [base + '1x_static.webp', base + '1x_static.webp'], 'once per paint');
  probes[0].onload();
  probes[1].onerror(); // 7TV keeps no still frame beside a still image
  assert.deepStrictEqual(ready, ['ANIM']);
  assert.strictEqual(h.deps.paintStaticRule('ANIM'),
    '.paint-static .painted.p-ANIM{background-image:url("' + base + '1x_static.webp")}');
  assert.strictEqual(h.deps.paintStaticRule('STILL'), null);
  // A gradient has nothing to still: nothing is asked for.
  S.stv.paints.set('GRAD', pc.fromV3({ id: 'GRAD', function: 'LINEAR_GRADIENT', stops: [{ at: 0, color: -1 }], shadows: [] }));
  assert.strictEqual(h.deps.paintStaticRule('GRAD'), null);
  assert.strictEqual(probes.length, 2);
});

// A '#' typed in a hand-written URL started the fragment: that value and every setting after it were lost.
test('a \'#\' typed in an overlay URL value is part of it, and the settings after it are read', async (t) => {
  const run = async (href) => {
    const q = href.indexOf('?'), f = href.indexOf('#', q);
    const h = await boot(t, { search: f < 0 ? href.slice(q) : href.slice(q, f), stubs() { globalThis.location.href = href; } });
    return h.S().cfg;
  };
  const at = 'https://chat.masstar.org/overlay.html';
  let c = await run(at + '?channel=home&text_color=#ff8800&size=large');
  assert.deepStrictEqual([c.text_color, c.size], ['ff8800', 'large']);
  c = await run(at + '?channel=home&keywords=c#,java&fade=30');
  assert.deepStrictEqual([c.keywords, c.fade], [['c#', 'java'], 30]);
  c = await run(at + '?channel=home&command_prefixes=!#&max=20');
  assert.deepStrictEqual([c.command_prefixes, c.max], ['!#', 20]);
  c = await run(at + '?channel=#xqc&size=large');
  assert.deepStrictEqual([c.channel, c.size], ['xqc', 'large']);
  c = await run(at + '?channel=home&block_words=c#');
  assert.deepStrictEqual(c.block_words, ['c#'], 'a # at the very end too');
  c = await run(at + '?channel=home&size=small&bots=1#frag');
  assert.deepStrictEqual([c.size, c.bots], ['small', true], 'a real fragment after a whole value leaves it');
  // A list of names ahead of a fragment or a bare '#' at the end stays whole: block was emptied (the bot showed again)
  // and allow_users too (the filter went off).
  c = await run(at + '?channel=home&block=nightbot#top');
  assert.deepStrictEqual(c.block, ['nightbot']);
  c = await run(at + '?channel=home&allow_users=alice#');
  assert.deepStrictEqual(c.allow_users, ['alice']);
  c = await run(at + '?channel=home&highlight_users=alice,bob#top');
  assert.deepStrictEqual(c.highlight_users, ['alice', 'bob']);
});

// ?channel=xqc! (or 'xqc.', 'my channel', kick=bad!name) was refused as if no channel were set: the hint said to add one.
test('an invalid channel or Kick name says so, also while the other platform\'s chat loads', async (t) => {
  let h = await boot(t, { search: '?channel=xqc!' });
  assert.strictEqual(h.els.hint.hidden, false);
  assert.strictEqual(h.els.hint.children[0].textContent,
    'Twitch channel "xqc!" in the overlay URL isn\'t a valid name: use letters, numbers and _ only.');
  assert.strictEqual(h.calls.length, 0, 'nothing loads');
  h = await boot(t, { search: '?kick=bad!name' });
  assert.strictEqual(h.els.hint.children[0].textContent,
    'Kick channel "bad!name" in the overlay URL isn\'t a valid name: use letters, numbers, _ and - only.');
  // The other platform's chat loads, and the hint stays (a join doesn't clear it).
  h = await boot(t, { search: '?channel=my%20channel&kick=kickname&kick_room=668' });
  assert.ok(h.kick, 'Kick chat loads');
  h.kick.opts.onStatus('joined');
  assert.strictEqual(h.els.hint.hidden, false);
  assert.match(h.els.hint.children[0].textContent, /^Twitch channel "my channel" in the overlay URL/);
  h = await boot(t, { search: '?channel=home&kick=bad!name' });
  join(h);
  assert.strictEqual(h.els.hint.hidden, false);
  assert.match(h.els.hint.children[0].textContent, /^Kick channel "bad!name"/);
  // No channel at all, and a valid one: as before.
  h = await boot(t, { search: '' });
  assert.match(h.els.hint.children[0].textContent, /^No channel set\./);
  h = await boot(t, { search: '?channel=home' });
  join(h);
  assert.strictEqual(h.els.hint.hidden, true);
  // settings.js, said as such (last: boot() leaves TCO_SETTINGS in place until the test ends).
  h = await boot(t, { search: '', settings: { channel: 'xqc.' } });
  assert.match(h.els.hint.children[0].textContent, /^Twitch channel "xqc\." in settings\.js isn't a valid name/);
});
