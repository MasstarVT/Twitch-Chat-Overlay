/* BetterTTV: global/channel emotes, staff badges, and the live socket (emote changes, Pro badges, Pro personal emotes). */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).bttv = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  // Cached routes reject CORS preflight: plain GETs only (util.fetchJson sends no headers).
  var API = 'https://api.betterttv.net/3/cached/';
  var CDN = 'https://cdn.betterttv.net/emote/';
  var WS_URL = 'wss://sockets.betterttv.net/ws';
  var REFRESH_MS = 45 * 60 * 1000;
  var EMOTE_ID_RE = /^[A-Za-z0-9]{1,64}$/;
  var ROOM_RE = /^\d+$/;
  // Zero-width is a client-side list (not an API flag), applied to the global set only.
  var ZW_CODES = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);

  function badPayload(what) { return new Error('unexpected ' + what + ' payload'); }
  // A size under 1 px (0.001, 1e-20) is a broken payload, not a real emote: use the default.
  function dim(v) { var n = Number(v); return n >= 1 && n < 10000 ? n : 28; }
  function safeUrl(u) { var a = util.absUrl(u); return a && util.isSafeUrl(a) ? a : null; }

  // BTTV emote -> Emote, or null when the id/code is unusable. 3x is 4x the 1x size.
  function normalizeEmote(e, isGlobal) {
    if (!e || typeof e.code !== 'string' || !e.code) return null;
    var id = util.idStr(e.id);
    if (!EMOTE_ID_RE.test(id)) return null;
    var base = CDN + id + '/';
    return {
      provider: 'bttv',
      id: id,
      name: e.code,
      w: dim(e.width),
      h: dim(e.height),
      urls: { 1: base + '1x.webp', 2: base + '2x.webp', 4: base + '3x.webp' },
      zw: !!isGlobal && ZW_CODES.has(e.code)
    };
  }

  // Adds channel-scope emotes by code; the first entry for a code wins.
  function addEmotes(map, list) {
    if (!Array.isArray(list)) return map;
    for (var i = 0; i < list.length; i++) {
      var em = normalizeEmote(list[i], false);
      if (em && !map.has(em.name)) map.set(em.name, em);
    }
    return map;
  }

  // /3/cached/emotes/global -> {emotes, prefixes}. modifier:true entries are prefix modifiers (h!, w!, ...).
  function parseGlobal(json) {
    var out = { emotes: new Map(), prefixes: new Set() };
    if (util.isNotFound(json)) return out;
    if (!Array.isArray(json)) throw badPayload('BTTV global');
    for (var i = 0; i < json.length; i++) {
      var e = json[i];
      if (!e || typeof e.code !== 'string' || !e.code) continue;
      if (e.modifier) { out.prefixes.add(e.code); continue; }
      var em = normalizeEmote(e, true);
      if (em && !out.emotes.has(em.name)) out.emotes.set(em.name, em);
    }
    return out;
  }

  // /3/cached/users/twitch/{id} -> {emotes, bots}. Shared emotes match on `code` (the channel alias).
  function parseChannel(json) {
    var out = { emotes: new Map(), bots: new Set() };
    if (util.isNotFound(json) || json === null) return out;
    if (typeof json !== 'object' || Array.isArray(json)) throw badPayload('BTTV channel');
    addEmotes(out.emotes, json.channelEmotes);
    addEmotes(out.emotes, json.sharedEmotes);
    if (Array.isArray(json.bots)) {
      for (var i = 0; i < json.bots.length; i++) {
        var b = util.idStr(json.bots[i]).toLowerCase();
        if (b) out.bots.add(b);
      }
    }
    return out;
  }

  // /3/cached/badges/twitch -> Map<twitchUserId, Badge[]> (staff/translator badges, one svg for every scale).
  function parseStaffBadges(json) {
    var map = new Map();
    if (util.isNotFound(json)) return map;
    if (!Array.isArray(json)) throw badPayload('BTTV badges');
    for (var i = 0; i < json.length; i++) {
      var u = json[i];
      var id = util.idStr(u && u.providerId);
      var svg = u && u.badge && safeUrl(u.badge.svg);
      if (!id || !svg) continue;
      var badge = { provider: 'bttv', title: String(u.badge.description || 'BetterTTV'), urls: { 1: svg, 2: svg, 4: svg } };
      var list = map.get(id);
      if (list) list.push(badge); else map.set(id, [badge]);
    }
    return map;
  }

  // Socket lookup_user data -> {userId, badge:Badge|null, emotes:Map}. badge can be null even for Pro users.
  function parseLookupUser(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.provider && d.provider !== 'twitch') return null;
    var userId = util.idStr(d.providerId);
    if (!userId) return null;
    var url = d.badge && safeUrl(d.badge.url);
    return {
      userId: userId,
      badge: url ? { provider: 'bttv', title: 'BTTV Pro', urls: { 1: url, 2: url, 4: url } } : null,
      emotes: addEmotes(new Map(), d.emotes)
    };
  }

  // Helpers for applying live events to a code-keyed emote Map.
  function removeEmoteById(map, emoteId) {
    var id = String(emoteId), removed = false;
    map.forEach(function (e, code) {
      if (e && e.id === id) { map.delete(code); removed = true; }
    });
    return removed;
  }
  // A live emote_update may carry only {id, code}; its w/h are then 0 (see createLive) and the size
  // is taken from the entry it replaces, so a renamed wide emote stays wide.
  function upsertEmote(map, emote) {
    if (!emote) return;
    if (!emote.w || !emote.h) {
      var old = null, id = String(emote.id);
      map.forEach(function (e) { if (!old && e && e.id === id) old = e; });
      if (!emote.w) emote.w = old ? old.w : 28;
      if (!emote.h) emote.h = old ? old.h : 28;
    }
    removeEmoteById(map, emote.id); // an update may rename the code
    map.set(emote.name, emote);
  }

  function loadGlobal() {
    return util.fetchJson(API + 'emotes/global', { timeout: 10000 }).then(parseGlobal);
  }

  // opts.fresh revalidates with BTTV instead of taking the browser's cached copy (the route is served with
  // max-age=300): a reload after an outage must not bring back emotes the live socket has since changed.
  function loadChannel(roomId, opts) {
    var id = util.idStr(roomId);
    if (!ROOM_RE.test(id)) return Promise.reject(new Error('invalid room id: ' + id));
    var req = { timeout: 10000 };
    if (opts && opts.fresh) req.cache = 'no-cache';
    return util.fetchJson(API + 'users/twitch/' + id, req).then(parseChannel);
  }

  function loadStaffBadges() {
    return util.fetchJson(API + 'badges/twitch', { timeout: 10000 }).then(parseStaffBadges);
  }

  // Live socket for one channel. Callbacks: onEmoteAdd(emote), onEmoteUpdate(emote), onEmoteRemove(emoteId),
  // onUser(userId, {badge, emotes}), onReopen(). The socket does not replay events, so onReopen fires when it
  // opens again after a drop (not after the planned 45-minute refresh): the caller refetches the channel then.
  // opts.WebSocket may be injected (tests).
  function createLive(opts) {
    opts = opts || {};
    var roomId = util.idStr(opts.roomId);
    function noop() {}
    if (!ROOM_RE.test(roomId)) {
      util.warn('bttv: invalid room id for live updates:', roomId);
      return { start: noop, stop: noop, kick: noop };
    }
    var channel = 'twitch:' + roomId;

    function call(fn, a, b) { if (typeof fn === 'function') fn(a, b); }

    function onMessage(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg.name !== 'string') return;
      var d = msg.data || {};
      switch (msg.name) {
        case 'emote_create':
        case 'emote_update': {
          if (d.channel !== channel) return;
          var em = normalizeEmote(d.emote, false);
          if (!em) return;
          if (msg.name === 'emote_create') { call(opts.onEmoteAdd, em); return; }
          // An update is a patch: a missing size is filled in by upsertEmote from the entry it replaces.
          if (!(Number(d.emote.width) >= 1)) em.w = 0;
          if (!(Number(d.emote.height) >= 1)) em.h = 0;
          call(opts.onEmoteUpdate, em);
          return;
        }
        case 'emote_delete': {
          if (d.channel !== channel) return;
          var id = util.idStr(d.emoteId);
          if (id) call(opts.onEmoteRemove, id);
          return;
        }
        case 'lookup_user': {
          var u = parseLookupUser(d);
          if (u) call(opts.onUser, u.userId, { badge: u.badge, emotes: u.emotes });
          return;
        }
        default:
          return;
      }
    }

    // opens counts socket opens. plannedGen is the connection generation that started the 45-minute
    // refresh: scheduleReconnect and _connect each add one to the generation, so only the socket the
    // refresh itself opens has gen === plannedGen + 2. A refresh whose socket fails by any path (close,
    // connect timeout, constructor error) goes through another reconnect and counts as a drop.
    var opens = 0, plannedGen = -10;

    // Never send broadcast_me: an overlay must not announce itself as a chatter.
    var client = new util.SocketClient({
      name: 'bttv',
      url: WS_URL,
      WebSocket: opts.WebSocket,
      baseDelay: 5000,
      maxDelay: 300000,
      onOpen: function (ctl) {
        ctl.send(JSON.stringify({ name: 'join_channel', data: { name: channel } }));
        ctl.setTimeout(function () {
          plannedGen = ctl.gen;
          ctl.reconnect('refresh', { delay: util.jitter(0, 2000) });
        }, REFRESH_MS);
        var again = opens++ > 0 && ctl.gen !== plannedGen + 2;
        if (again) {
          try { call(opts.onReopen); } catch (e) { util.warn('bttv onReopen threw', e); }
        }
      },
      onMessage: function (data) { onMessage(data); }
    });

    return {
      start: function () { client.start(); },
      stop: function () { client.stop('stopped'); },
      kick: function () { client.kick(); }
    };
  }

  return {
    ZW_CODES: ZW_CODES,
    REFRESH_MS: REFRESH_MS,
    normalizeEmote: normalizeEmote,
    parseGlobal: parseGlobal,
    parseChannel: parseChannel,
    parseStaffBadges: parseStaffBadges,
    parseLookupUser: parseLookupUser,
    upsertEmote: upsertEmote,
    removeEmoteById: removeEmoteById,
    loadGlobal: loadGlobal,
    loadChannel: loadChannel,
    loadStaffBadges: loadStaffBadges,
    createLive: createLive
  };
});
