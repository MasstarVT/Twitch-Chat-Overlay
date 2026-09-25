/* FrankerFaceZ: global and room emotes, room mod/VIP/user badges, and the global badge list (API v1). */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).ffz = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  var API = 'https://api.frankerfacez.com/v1/';
  var SCALES = [1, 2, 4];
  var ROOM_RE = /^\d+$/;
  var HIDDEN = 1;

  function badPayload(what) { return new Error('unexpected ' + what + ' payload'); }
  function dim(v) { var n = Number(v); return n > 0 ? n : 28; }

  // {'1':url,'2'?:url,'4'?:url} -> {1,2,4} with absolute https urls, or null when none are usable.
  function scaleUrls(map) {
    if (!map || typeof map !== 'object') return null;
    var out = null;
    for (var i = 0; i < SCALES.length; i++) {
      var u = util.absUrl(map[SCALES[i]]);
      if (u && util.isSafeUrl(u)) { out = out || {}; out[SCALES[i]] = u; }
    }
    return out;
  }

  // FFZ emote -> Emote, or null. Hidden modifiers (flags&1) only restyle the previous emote;
  // other modifiers are zero-width overlays. (The API's own `hidden` field is unrelated.)
  function normalizeEmote(e) {
    if (!e || e.id === undefined || e.id === null || typeof e.name !== 'string' || !e.name) return null;
    var urls = scaleUrls(e.animated) || scaleUrls(e.urls);
    if (!urls) return null;
    var flags = Number(e.modifier_flags) || 0;
    var mod = !!e.modifier;
    return {
      provider: 'ffz',
      id: String(e.id),
      name: e.name,
      w: dim(e.width),
      h: dim(e.height),
      urls: urls,
      zw: mod && !(flags & HIDDEN),
      hidden: mod && !!(flags & HIDDEN),
      flags: flags
    };
  }

  function addSet(map, set) {
    var list = set && set.emoticons;
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var em = normalizeEmote(list[i]);
      if (em && !map.has(em.name)) map.set(em.name, em);
    }
  }

  // /v1/set/global/ids -> Map<name, Emote>, default_sets only (user-restricted sets are skipped).
  function parseGlobal(json) {
    var map = new Map();
    if (util.isNotFound(json)) return map;
    if (!json || !json.sets || !Array.isArray(json.default_sets)) throw badPayload('FFZ global');
    for (var i = 0; i < json.default_sets.length; i++) addSet(map, json.sets[String(json.default_sets[i])]);
    return map;
  }

  // {badgeId:[twitch ids (numbers)]} -> Map<userId String, badgeId String[]>. keep(badgeId) filters.
  function invertIds(obj, keep) {
    var map = new Map();
    if (!obj || typeof obj !== 'object') return map;
    Object.keys(obj).forEach(function (badgeId) {
      var ids = obj[badgeId];
      if (!Array.isArray(ids) || (keep && !keep(badgeId))) return;
      for (var i = 0; i < ids.length; i++) {
        var uid = util.idStr(ids[i]);
        if (!uid) continue;
        var list = map.get(uid);
        if (!list) map.set(uid, [badgeId]);
        else if (list.indexOf(badgeId) < 0) list.push(badgeId);
      }
    });
    return map;
  }

  function emptyRoom() { return { emotes: new Map(), modUrls: null, vipUrls: null, userBadges: new Map() }; }

  // /v1/room/id/{id} -> {emotes, modUrls, vipUrls, userBadges}. mod_urls may hold only '1' (xqc).
  function parseRoom(json) {
    if (util.isNotFound(json) || json === null) return emptyRoom();
    var room = json && json.room;
    if (!room || typeof room !== 'object') throw badPayload('FFZ room');
    var out = emptyRoom();
    var sets = json.sets || {};
    if (room.set !== undefined && room.set !== null && sets[String(room.set)]) {
      addSet(out.emotes, sets[String(room.set)]);
    } else {
      Object.keys(sets).forEach(function (k) { addSet(out.emotes, sets[k]); });
    }
    out.modUrls = scaleUrls(room.mod_urls);
    if (!out.modUrls && typeof room.moderator_badge === 'string') out.modUrls = scaleUrls({ 1: room.moderator_badge });
    out.vipUrls = room.vip_badge && typeof room.vip_badge === 'object' ? scaleUrls(room.vip_badge) : null;
    out.userBadges = invertIds(room.user_badge_ids);
    return out;
  }

  // /v1/badges/ids -> {defs:Map<badgeId,{id,title,color,urls,replaces,provider,bg}>, users:Map<userId,badgeId[]>}.
  function parseBadges(json) {
    var defs = new Map();
    if (util.isNotFound(json)) return { defs: defs, users: new Map() };
    if (!json || !Array.isArray(json.badges)) throw badPayload('FFZ badges');
    for (var i = 0; i < json.badges.length; i++) {
      var b = json.badges[i];
      var id = util.idStr(b && b.id);
      var urls = b && (scaleUrls(b.urls) || scaleUrls({ 1: b.image }));
      if (!id || !urls) continue;
      var color = typeof b.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.color) ? b.color : null;
      defs.set(id, {
        id: id,
        provider: 'ffz',
        title: String(b.title || b.name || 'FFZ'),
        color: color,
        bg: color || undefined,
        urls: urls,
        replaces: typeof b.replaces === 'string' && b.replaces ? b.replaces : null
      });
    }
    var users = invertIds(json.users, function (badgeId) { return defs.has(badgeId); });
    return { defs: defs, users: users };
  }

  function loadGlobal() {
    return util.fetchJson(API + 'set/global/ids', { timeout: 10000 }).then(parseGlobal);
  }

  function loadRoom(roomId) {
    var id = util.idStr(roomId);
    if (!ROOM_RE.test(id)) return Promise.reject(new Error('invalid room id: ' + id));
    return util.fetchJson(API + 'room/id/' + id, { timeout: 10000 }).then(parseRoom);
  }

  function loadBadges() {
    return util.fetchJson(API + 'badges/ids', { timeout: 15000 }).then(parseBadges);
  }

  return {
    scaleUrls: scaleUrls,
    normalizeEmote: normalizeEmote,
    parseGlobal: parseGlobal,
    parseRoom: parseRoom,
    parseBadges: parseBadges,
    loadGlobal: loadGlobal,
    loadRoom: loadRoom,
    loadBadges: loadBadges
  };
});
