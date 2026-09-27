/* Room registry: the home room plus lazily loaded Shared Chat source rooms (dedupe, failure cache, idle eviction). */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).rooms = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  function newContext(id, login) {
    var l = login ? String(login).trim().toLowerCase() : '';
    return {
      id: util.idStr(id),
      login: l,
      displayName: l,
      logo: null,
      twitchBadges: new Map(),
      stv: { emotes: new Map(), setId: null, ownerId: null },
      bttv: { emotes: new Map(), bots: new Set() },
      ffz: { emotes: new Map(), modUrls: null, vipUrls: null, userBadges: new Map() },
      retry: null, // Shared Chat rooms: parts that failed, retried on a later message (set by the overlay)
      lastSeen: util.now()
    };
  }

  // opts: { load(ctx) -> Promise (fills ctx; reject = failed), failureTtl, idleTtl }
  function createRooms(opts) {
    opts = opts || {};
    var load = typeof opts.load === 'function' ? opts.load : function () { return Promise.resolve(); };
    var failureTtl = typeof opts.failureTtl === 'number' ? opts.failureTtl : 300000;
    var idleTtl = typeof opts.idleTtl === 'number' ? opts.idleTtl : 1800000;
    var entries = new Map(); // id -> { ctx, promise, failedAt }
    var homeId = null;

    // The home room is filled by the caller, never through load().
    function setHome(id, login) {
      id = util.idStr(id);
      if (!id) return null;
      var e = entries.get(id);
      if (!e || e.failedAt) {
        e = { ctx: newContext(id, login), promise: null, failedAt: 0 };
        entries.set(id, e);
      } else if (login && !e.ctx.login) {
        e.ctx.login = String(login).trim().toLowerCase();
        if (!e.ctx.displayName) e.ctx.displayName = e.ctx.login;
      }
      e.promise = Promise.resolve(e.ctx);
      e.ctx.lastSeen = util.now();
      homeId = id;
      return e.ctx;
    }

    function home() {
      var e = homeId ? entries.get(homeId) : null;
      return e ? e.ctx : null;
    }

    // Loaded or still loading; null when unknown or failed.
    function get(id) {
      var e = entries.get(util.idStr(id));
      return e && !e.failedAt ? e.ctx : null;
    }

    function ensure(id) {
      id = util.idStr(id);
      if (!id) return Promise.resolve(null);
      var t = util.now();
      var e = entries.get(id);
      if (e) {
        if (!e.failedAt) { e.ctx.lastSeen = t; return e.promise; }
        if (t - e.failedAt < failureTtl) return Promise.resolve(null);
        entries.delete(id);
      }
      var ctx = newContext(id, '');
      var entry = { ctx: ctx, promise: null, failedAt: 0 };
      var settle;
      entry.promise = new Promise(function (res) { settle = res; }); // set before load() in case it re-enters
      entries.set(id, entry);
      var p;
      try { p = Promise.resolve(load(ctx)); } catch (err) { p = Promise.reject(err); }
      p.then(function () { settle(ctx); }, function (err) {
        util.warn('room load failed:', id, err && err.message ? err.message : err);
        if (id === homeId) { settle(ctx); return; }
        if (entries.get(id) === entry) entry.failedAt = util.now();
        settle(null);
      });
      return entry.promise;
    }

    function touch(id) {
      var e = entries.get(util.idStr(id));
      if (e && !e.failedAt) e.ctx.lastSeen = util.now();
    }

    // Evict idle non-home rooms (and expired failures). Returns the evicted ids.
    function sweep() {
      var t = util.now();
      var gone = [];
      entries.forEach(function (e, id) {
        if (id === homeId) return;
        if (e.failedAt ? t - e.failedAt >= failureTtl : t - e.ctx.lastSeen > idleTtl) gone.push(id);
      });
      for (var i = 0; i < gone.length; i++) entries.delete(gone[i]);
      return gone;
    }

    // fn(ctx, id) for every loaded or loading room, home included.
    function forEach(fn) {
      var list = [];
      entries.forEach(function (e) { if (!e.failedAt) list.push(e.ctx); });
      for (var i = 0; i < list.length; i++) fn(list[i], list[i].id);
    }

    return {
      setHome: setHome,
      home: home,
      get: get,
      ensure: ensure,
      touch: touch,
      sweep: sweep,
      forEach: forEach
    };
  }

  return {
    newContext: newContext,
    createRooms: createRooms
  };
});
