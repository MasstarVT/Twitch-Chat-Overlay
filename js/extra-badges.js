/* Third-party badge lists keyed by Twitch user id: Chatterino, FFZ:AP and Chatterino Homies (3 lists). */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).extraBadges = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  var CHATTERINO_URL = 'https://api.chatterino.com/badges';
  var FFZAP_URL = 'https://api.ffzap.com/v1/supporters';
  var FFZAP_BADGE = 'https://api.ffzap.com/v1/user/badge/';
  var FFZAP_BG = '#755000';
  // Merged in this order. The chatterinohomies list is ~4 MB, one entry per user.
  var HOMIES_SOURCES = [
    { url: 'https://itzalex.github.io/badges', timeout: 10000 },
    { url: 'https://itzalex.github.io/badges2', timeout: 10000 },
    { url: 'https://chatterinohomies.com/api/badges/list', timeout: 20000 }
  ];
  var ID_RE = /^\d+$/;
  var HEX_RE = /^#[0-9a-f]{3,8}$/i;
  var FAILED = {};

  function badPayload(what) { return new Error('unexpected ' + what + ' payload'); }
  function safeUrl(u) { var a = util.absUrl(u); return a && util.isSafeUrl(a) ? a : null; }

  // image1/2/3 are 18/36/72 px -> keys 1, 2, 4.
  function imageUrls(b) {
    var u1 = safeUrl(b.image1), u2 = safeUrl(b.image2), u3 = safeUrl(b.image3);
    if (!u1 && !u2 && !u3) return null;
    var urls = {};
    if (u1) urls[1] = u1;
    if (u2) urls[2] = u2;
    if (u3) urls[4] = u3;
    return urls;
  }

  // Skips empty ids (badges2 lists users [""]) and exact duplicates for the same user.
  function addBadge(map, userId, badge) {
    var id = util.idStr(userId);
    if (!id) return;
    var list = map.get(id);
    if (!list) { map.set(id, [badge]); return; }
    var key = util.pickScale(badge.urls, 1);
    for (var i = 0; i < list.length; i++) {
      if (list[i].title === badge.title && util.pickScale(list[i].urls, 1) === key) return;
    }
    list.push(badge);
  }

  // {badges:[{tooltip, image1..3, users:[id]} | {tooltip, image1..3, userId}]} -> Map<userId, Badge[]>.
  function parseBadgeList(json, provider, map) {
    map = map || new Map();
    if (util.isNotFound(json)) return map;
    if (!json || !Array.isArray(json.badges)) throw badPayload(provider);
    for (var i = 0; i < json.badges.length; i++) {
      var b = json.badges[i];
      if (!b || typeof b !== 'object') continue;
      var urls = imageUrls(b);
      if (!urls) continue;
      var badge = { provider: provider, title: String(b.tooltip || ''), urls: urls };
      if (Array.isArray(b.users)) {
        for (var j = 0; j < b.users.length; j++) addBadge(map, b.users[j], badge);
      } else if (b.userId !== undefined) {
        addBadge(map, b.userId, badge);
      }
    }
    return map;
  }

  function parseChatterino(json) { return parseBadgeList(json, 'chatterino'); }
  function parseHomies(json, map) { return parseBadgeList(json, 'homies', map); }

  // ChatIS colour rules: tier 1 #755000; tier 2 badge_color; tier 3 badge_color only when badge_is_colored==0.
  function ffzapBg(s) {
    var color = typeof s.badge_color === 'string' && HEX_RE.test(s.badge_color) ? s.badge_color : null;
    var tier = Number(s.tier);
    if (tier === 2) return color || FFZAP_BG;
    if (tier === 3) return s.badge_is_colored == 0 ? (color || FFZAP_BG) : undefined; // loose: 0 or "0"; absent -> none
    return FFZAP_BG;
  }

  // [{id, tier, badge_color?, badge_is_colored?}] -> Map<userId, Badge[]>.
  function parseFfzap(json) {
    var map = new Map();
    if (util.isNotFound(json)) return map;
    if (!Array.isArray(json)) throw badPayload('FFZ:AP');
    for (var i = 0; i < json.length; i++) {
      var s = json[i];
      var id = util.idStr(s && s.id);
      if (!ID_RE.test(id)) continue;
      var base = FFZAP_BADGE + id + '/';
      var badge = { provider: 'ffzap', title: 'FFZ:AP Supporter', urls: { 1: base + '1', 2: base + '2', 4: base + '3' } };
      var bg = ffzapBg(s);
      if (bg) badge.bg = bg;
      addBadge(map, id, badge);
    }
    return map;
  }

  function loadChatterino() {
    return util.fetchJson(CHATTERINO_URL, { timeout: 10000 }).then(parseChatterino);
  }

  function loadFfzap() {
    return util.fetchJson(FFZAP_URL, { timeout: 10000 }).then(parseFfzap);
  }

  // Loads all three lists in parallel; rejects only when every list fails.
  function loadHomies() {
    var pending = HOMIES_SOURCES.map(function (src) {
      return util.fetchJson(src.url, { timeout: src.timeout }).catch(function (err) {
        util.warn('Homies list failed:', src.url, '-', err && err.message);
        return FAILED;
      });
    });
    return Promise.all(pending).then(function (results) {
      var map = new Map();
      var ok = 0;
      for (var i = 0; i < results.length; i++) {
        if (results[i] === FAILED) continue;
        try {
          parseHomies(results[i], map);
          ok++;
        } catch (e) {
          util.warn('Homies list unreadable:', HOMIES_SOURCES[i].url, '-', e.message);
        }
      }
      if (!ok) throw new Error('all Homies badge lists failed');
      return map;
    });
  }

  return {
    parseBadgeList: parseBadgeList,
    parseChatterino: parseChatterino,
    parseHomies: parseHomies,
    parseFfzap: parseFfzap,
    loadChatterino: loadChatterino,
    loadFfzap: loadFfzap,
    loadHomies: loadHomies
  };
});
