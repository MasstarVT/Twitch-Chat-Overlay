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
  // A user's badges from several lists are kept in this order, whichever list arrives first.
  // The chatterinohomies list is ~4 MB, one entry per user.
  var HOMIES_SOURCES = [
    { url: 'https://itzalex.github.io/badges', timeout: 10000 },
    { url: 'https://itzalex.github.io/badges2', timeout: 10000 },
    { url: 'https://chatterinohomies.com/api/badges/list', timeout: 20000 }
  ];
  // util.fetchJson caps bodies at 8 MB by default; the Homies lists get headroom over that.
  var HOMIES_MAX_BYTES = 16 * 1024 * 1024;
  var ID_RE = /^\d+$/;
  var HEX_RE = /^#[0-9a-f]{3,8}$/i;
  var FAILED = {};
  // chatterinohomies gives each user their own badge at cdn/badges/<uuid>/{18,36,72}.webp.
  var HOMIES_CDN = 'https://cdn.chatterinohomies.com/badges/';
  var HOMIES_UUID_RE = /^https:\/\/cdn\.chatterinohomies\.com\/badges\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/36\.webp$/;

  function badPayload(what) { return new Error('unexpected ' + what + ' payload'); }
  function safeUrl(u) { var a = util.absUrl(u); return a && util.isSafeUrl(a) ? a : null; }

  // image1/2/3 are 18/36/72 px -> keys 1, 2, 4. Badges are always requested at 2x or more, so the
  // 18 px image is only kept when it is the only one.
  function imageUrls(b) {
    var u1 = safeUrl(b.image1), u2 = safeUrl(b.image2), u3 = safeUrl(b.image3);
    if (!u1 && !u2 && !u3) return null;
    var urls = {};
    if (u1 && !u2 && !u3) urls[1] = u1;
    if (u2) urls[2] = u2;
    if (u3) urls[4] = u3;
    return urls;
  }

  // Skips empty ids (badges2 lists users [""]) and exact duplicates for the same user.
  // In a Homies index, src is the list the badge came from: badges stay in list order, and of two
  // duplicates the one from the earlier list is kept.
  function addBadge(map, userId, badge, src) {
    var id = util.idStr(userId);
    if (!id) return;
    var homies = map instanceof Homies;
    if (homies) map.rank.set(badge, src);
    var list = map.get(id); // a Homies index unpacks the user's packed badge first
    if (!list) { (homies ? map.lists : map).set(id, [badge]); return; }
    var key = util.pickScale(badge.urls, 1);
    for (var i = 0; i < list.length; i++) {
      if (list[i].title === badge.title && util.pickScale(list[i].urls, 1) === key) {
        if (!homies || map.srcOf(list[i]) <= src) return;
        list.splice(i, 1);
        break;
      }
    }
    if (homies) map.insert(list, badge, src); else list.push(badge);
  }

  // Homies badges by user id, read like a Map<userId, Badge[]> (get, has, forEach, size).
  // The chatterinohomies list is ~9,400 users with one badge each on its own CDN (~5 MB as Badge objects),
  // so those are kept packed as one string, uuid + title, and become a Badge the first time the user chats.
  // rank holds the source list of each Badge in the index (list 0/1 badges are shared, a few hundred objects).
  function Homies() { this.lists = new Map(); this.packed = new Map(); this.rank = new WeakMap(); }
  Homies.prototype.srcOf = function (b) { return this.rank.get(b) || 0; };
  // Inserts after every badge from the same or an earlier list.
  Homies.prototype.insert = function (list, b, src) {
    var i = list.length;
    while (i > 0 && this.srcOf(list[i - 1]) > src) i--;
    list.splice(i, 0, b);
  };
  Homies.prototype.unpackBadge = function (p) {
    var b = unpackHomie(p);
    this.rank.set(b, packedSrc(p));
    return b;
  };
  // Moves a user's packed badge onto their list, in list order.
  Homies.prototype.unpack = function (uid) {
    var p = this.packed.get(uid);
    if (p === undefined) return;
    this.packed.delete(uid);
    var list = this.lists.get(uid);
    if (list) this.insert(list, this.unpackBadge(p), packedSrc(p)); else this.lists.set(uid, [this.unpackBadge(p)]);
  };
  Homies.prototype.get = function (uid) {
    this.unpack(uid);
    return this.lists.get(uid);
  };
  Homies.prototype.has = function (uid) { return this.lists.has(uid) || this.packed.has(uid); };
  // Does not unpack into the index, so a walk leaves it small; but it builds a Badge per packed entry
  // (~9,400), so a caller that wants just one list should use first().
  Homies.prototype.forEach = function (fn) {
    var self = this, packed = this.packed, lists = this.lists;
    lists.forEach(function (list, uid) {
      var p = packed.get(uid);
      if (p === undefined) { fn(list, uid); return; }
      var copy = list.slice();
      self.insert(copy, self.unpackBadge(p), packedSrc(p));
      fn(copy, uid);
    });
    packed.forEach(function (p, uid) { if (!lists.has(uid)) fn([self.unpackBadge(p)], uid); });
  };
  // Some user's badge list without walking the index (null when empty). Builds at most one Badge.
  Homies.prototype.first = function () {
    var e = this.lists.keys().next();
    if (!e.done) return this.get(e.value);
    e = this.packed.values().next();
    return e.done ? null : [this.unpackBadge(e.value)];
  };
  Object.defineProperty(Homies.prototype, 'size', {
    get: function () {
      var n = this.lists.size, lists = this.lists;
      this.packed.forEach(function (p, uid) { if (!lists.has(uid)) n++; });
      return n;
    }
  });

  // A packed entry is one digit (its source list), the uuid, then the title.
  function packedSrc(p) { return p.charCodeAt(0) - 48; }
  function unpackHomie(p) {
    var base = HOMIES_CDN + p.slice(1, 37) + '/';
    return { provider: 'homies', title: p.slice(37), urls: { 2: base + '36.webp', 4: base + '72.webp' } };
  }

  // A single-user chatterinohomies entry as uuid + title, or null when it has any other shape.
  function packHomie(b, src) {
    if (typeof b.image2 !== 'string') return null;
    var m = HOMIES_UUID_RE.exec(b.image2);
    if (!m) return null;
    var base = HOMIES_CDN + m[1] + '/';
    if (b.image1 !== base + '18.webp' || b.image3 !== base + '72.webp') return null;
    // uuid + title is a rope that holds on to both pieces (and the uuid, a slice, to the whole URL);
    // the JSON round trip turns it into one flat string, about a third of the size.
    return JSON.parse(JSON.stringify(String(src) + m[1] + String(b.tooltip || '')));
  }

  function createHomies() { return new Homies(); }

  // {badges:[{tooltip, image1..3, users:[id]} | {tooltip, image1..3, userId}]} -> Map<userId, Badge[]>.
  // map may be a Homies index, which packs single-user chatterinohomies entries; src (0-9) is then the
  // list's place in HOMIES_SOURCES, which orders each user's badges.
  function parseBadgeList(json, provider, map, src) {
    map = map || new Map();
    src = src > 0 && src < 10 ? Math.floor(src) : 0;
    if (util.isNotFound(json)) return map;
    if (!json || !Array.isArray(json.badges)) throw badPayload(provider);
    for (var i = 0; i < json.badges.length; i++) {
      var b = json.badges[i];
      if (!b || typeof b !== 'object') continue;
      if (map instanceof Homies && !Array.isArray(b.users) && b.userId !== undefined) {
        var uid = util.idStr(b.userId);
        var p = uid && !map.has(uid) ? packHomie(b, src) : null;
        if (p !== null) { map.packed.set(uid, p); continue; }
      }
      var urls = imageUrls(b);
      if (!urls) continue;
      var badge = { provider: provider, title: String(b.tooltip || ''), urls: urls };
      if (Array.isArray(b.users)) {
        for (var j = 0; j < b.users.length; j++) addBadge(map, b.users[j], badge, src);
      } else if (b.userId !== undefined) {
        addBadge(map, b.userId, badge, src);
      }
    }
    return map;
  }

  function parseChatterino(json) { return parseBadgeList(json, 'chatterino'); }
  // src: the list's index in HOMIES_SOURCES (default 0).
  function parseHomies(json, map, src) { return parseBadgeList(json, 'homies', map || new Homies(), src); }

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

  // Loads Homies list i (0..HOMIES_SOURCES.length-1) into a Homies index (a new one when none is given).
  // Each list can be its own retrying loader, so one that fails is fetched again without the others.
  function loadHomiesSource(i, into) {
    var src = HOMIES_SOURCES[i];
    if (!src) return Promise.reject(new Error('no Homies list ' + i));
    return util.fetchJson(src.url, { timeout: src.timeout, maxBytes: HOMIES_MAX_BYTES }).then(function (json) { return parseHomies(json, into, i); });
  }

  // Loads all three lists in parallel; rejects only when every list fails.
  function loadHomies() {
    var pending = HOMIES_SOURCES.map(function (src) {
      return util.fetchJson(src.url, { timeout: src.timeout, maxBytes: HOMIES_MAX_BYTES }).catch(function (err) {
        util.warn('Homies list failed:', src.url, '-', err && err.message);
        return FAILED;
      });
    });
    return Promise.all(pending).then(function (results) {
      var map = new Homies();
      var ok = 0;
      for (var i = 0; i < results.length; i++) {
        if (results[i] === FAILED) continue;
        try {
          parseHomies(results[i], map, i);
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
    createHomies: createHomies,
    HOMIES_COUNT: HOMIES_SOURCES.length,
    parseFfzap: parseFfzap,
    loadChatterino: loadChatterino,
    loadFfzap: loadFfzap,
    loadHomies: loadHomies,
    loadHomiesSource: loadHomiesSource
  };
});
