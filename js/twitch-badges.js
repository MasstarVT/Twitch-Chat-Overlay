/* Twitch global/channel chat badges (IVR, falling back to Twitch GQL), IVR user lookups, and a channel's own cheermotes
   (Twitch GQL). */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var badgeResolve = typeof require === 'function' ? require('./badge-resolve.js') : root.TCO.badgeResolve;
  var api = factory(root, util, badgeResolve);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).twitchBadges = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, badgeResolve) {
  'use strict';

  var IVR = 'https://api.ivr.fi/v2/twitch/';
  var GQL_URL = 'https://gql.twitch.tv/gql';
  var GQL_HEADERS = { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' };
  var BADGE_FIELDS = '{setID version title imageURL(size:QUADRUPLE)}';
  var ID_RE = /^\d+$/;
  var LOGIN_RE = /^[a-z0-9_]{1,25}$/;
  var AVATAR_HOST_RE = /(^|\.)jtvnw\.net$/; // Twitch profile images (the Shared Chat avatar badge); same as the builder

  function badPayload(what) { return new Error('unexpected ' + what + ' payload'); }

  function gqlError(json) {
    var e = json && Array.isArray(json.errors) && json.errors[0];
    return new Error('GQL error' + (e && e.message ? ': ' + e.message : ''));
  }
  function hasErrors(json) { return !!(json && Array.isArray(json.errors) && json.errors.length); }

  // IVR badge list (bare Helix-like array) -> Map<setId, Map<version, badge>>. Throws on any other shape.
  function parseIvrBadges(json) {
    if (!Array.isArray(json)) throw badPayload('IVR badges');
    return badgeResolve.fromHelixLike(json);
  }

  // GQL {data:{badges:[...]}} -> Map. Throws on errors / missing data.
  function parseGqlGlobal(json) {
    var data = json && json.data;
    if (!data || !Array.isArray(data.badges)) throw hasErrors(json) ? gqlError(json) : badPayload('GQL badges');
    return badgeResolve.fromGqlFlat(data.badges);
  }

  // GQL {data:{user:{broadcastBadges:[...]}}} -> Map. A null user (unknown id) is an empty Map.
  function parseGqlChannel(json) {
    var data = json && json.data;
    if (!data) throw hasErrors(json) ? gqlError(json) : badPayload('GQL channel badges');
    if (!data.user) {
      if (hasErrors(json)) throw gqlError(json);
      return new Map();
    }
    // A field error (user present, broadcastBadges null) is a failed load, not "no badges": throw so it retries.
    if (!Array.isArray(data.user.broadcastBadges) && hasErrors(json)) throw gqlError(json);
    return badgeResolve.fromGqlFlat(data.user.broadcastBadges || []);
  }

  // IVR's logo is the 600x600 profile image; the avatar badge is drawn at 1em, so ask the CDN for 70x70.
  // e.g. .../xqc-profile_image-9298dca608632101-600x600.jpeg or .../<uuid>-profile_image-300x300.png
  var LOGO_SIZE_RE = /(-profile_image-(?:[0-9a-f]+-)?)\d+x\d+(\.(?:png|jpe?g|gif|webp))$/i;
  function smallLogo(u) {
    if (!util.isSafeUrl(u, AVATAR_HOST_RE)) return null;
    return u.replace(LOGO_SIZE_RE, function (all, head, ext) { return head + '70x70' + ext; });
  }

  // IVR user lookup (bare array) -> {id, login, displayName, logo, banned} or null.
  function parseUser(json, login) {
    if (!Array.isArray(json) || !json.length) return null;
    var u = null;
    for (var i = 0; i < json.length && login; i++) {
      if (json[i] && String(json[i].login || '').toLowerCase() === login) { u = json[i]; break; }
    }
    if (!u && login) return null; // an answer for another login is not this user
    u = u || json[0];
    var id = util.idStr(u && u.id);
    if (!ID_RE.test(id)) return null;
    var lg = String(u.login || '').toLowerCase();
    return {
      id: id,
      login: lg,
      displayName: typeof u.displayName === 'string' && u.displayName ? u.displayName : lg,
      logo: smallLogo(u.logo),
      banned: !!u.banned
    };
  }

  function gql(query, timeout) {
    return util.postJson(GQL_URL, { query: query }, GQL_HEADERS, { timeout: timeout || 10000 });
  }

  function loadGlobal() {
    return util.fetchJson(IVR + 'badges/global', { timeout: 5000 }).then(function (json) {
      var sets = parseIvrBadges(json);
      if (!sets.size) throw new Error('IVR global badges empty');
      return sets;
    }).catch(function (err) {
      util.warn('IVR global badges failed, trying GQL:', err && err.message);
      return gql('query{badges' + BADGE_FIELDS + '}').then(function (json) {
        var sets = parseGqlGlobal(json);
        if (!sets.size) throw new Error('GQL global badges empty');
        return sets;
      });
    });
  }

  function loadChannel(roomId) {
    var id = util.idStr(roomId);
    if (!ID_RE.test(id)) return Promise.reject(new Error('invalid room id: ' + id));
    return util.fetchJson(IVR + 'badges/channel?id=' + id, { timeout: 10000 }).then(function (json) {
      if (util.isNotFound(json)) return new Map();
      return parseIvrBadges(json); // [] -> empty Map
    }).catch(function (err) {
      util.warn('IVR channel badges failed for', id, '- trying GQL:', err && err.message);
      return gql('query{user(id:"' + id + '"){broadcastBadges' + BADGE_FIELDS + '}}').then(parseGqlChannel);
    });
  }

  function fetchUser(query, login) {
    return util.fetchJson(IVR + 'user?' + query, { timeout: 10000 }).then(function (json) {
      if (util.isNotFound(json)) return null;
      return parseUser(json, login);
    }, function (err) {
      if (err && err.status === 400) return null; // IVR rejects logins that fail its own pattern
      throw err;
    });
  }

  function lookupUser(login) {
    var l = String(login || '').trim().toLowerCase();
    if (!LOGIN_RE.test(l)) return Promise.resolve(null);
    return fetchUser('login=' + encodeURIComponent(l), l);
  }

  function lookupUserById(id) {
    var s = util.idStr(id);
    if (!ID_RE.test(s)) return Promise.resolve(null);
    return fetchUser('id=' + s, null);
  }

  // ---------- channel cheermotes ----------
  // A channel's own cheermotes (a partner's or affiliate's 'sodaCheer100'), from the same public GQL endpoint the badge
  // fallback uses: {data:{user:{cheer:{cheerGroups:[{templateURL, nodes:[{prefix, type, tiers:[{bits}]}]}]}}}}. Twitch
  // fills a group's templateURL by placeholder name (TIER, BACKGROUND, ANIMATION, SCALE, EXTENSION; PREFIX in the global
  // one), so only one on the cheer CDN with those is kept. Returns Map<lower-case prefix, {prefix, tiers (ascending bits),
  // template}>; empty for a channel with none (or no such user). A display-only group (Charity) isn't cheered with.
  var CHEER_CDN_RE = /^d3aqoihi2n8ty8\.cloudfront\.net$/;
  var CHEER_PREFIX_RE = /^[A-Za-z0-9]{1,30}$/;
  var CHEER_SLOTS_RE = /\b(?:PREFIX|TIER|BACKGROUND|ANIMATION|SCALE|EXTENSION)\b/g;
  function cheerTemplate(t) {
    if (typeof t !== 'string' || !util.isSafeUrl(t, CHEER_CDN_RE)) return null;
    if (!/\bTIER\b/.test(t) || !/\bSCALE\b/.test(t) || !/\bEXTENSION\b/.test(t)) return null;
    // Filled in, it must still be a plain https URL on the CDN.
    var sample = t.replace(CHEER_SLOTS_RE, 'x');
    return util.isSafeUrl(sample, CHEER_CDN_RE) && !/[?#]/.test(sample) ? t : null;
  }
  function parseCheermotes(json) {
    var data = json && json.data;
    if (!data) throw hasErrors(json) ? gqlError(json) : badPayload('GQL cheermotes');
    var out = new Map();
    var cheer = data.user && data.user.cheer;
    if (!cheer) {
      if (data.user && hasErrors(json)) throw gqlError(json);
      return out;
    }
    var groups = Array.isArray(cheer.cheerGroups) ? cheer.cheerGroups.slice(0, 20) : [];
    for (var g = 0; g < groups.length; g++) {
      var template = cheerTemplate(groups[g] && groups[g].templateURL);
      var nodes = template && Array.isArray(groups[g].nodes) ? groups[g].nodes.slice(0, 50) : [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || n.type === 'DISPLAY_ONLY' || typeof n.prefix !== 'string' || !CHEER_PREFIX_RE.test(n.prefix)) continue;
        var key = n.prefix.toLowerCase();
        if (out.has(key)) continue;
        var tiers = [];
        var list = Array.isArray(n.tiers) ? n.tiers.slice(0, 20) : [];
        for (var k = 0; k < list.length; k++) {
          var b = Number(list[k] && list[k].bits);
          if (b >= 1 && b <= 10000000 && b % 1 === 0 && tiers.indexOf(b) < 0) tiers.push(b);
        }
        if (!tiers.length) continue;
        tiers.sort(function (a, c) { return a - c; });
        out.set(key, { prefix: n.prefix, tiers: tiers, template: template });
      }
    }
    return out;
  }
  function loadCheermotes(roomId) {
    var id = util.idStr(roomId);
    if (!ID_RE.test(id)) return Promise.reject(new Error('invalid room id: ' + id));
    return gql('query{user(id:"' + id + '"){cheer{cheerGroups{templateURL nodes{prefix type tiers{bits}}}}}}').then(parseCheermotes);
  }

  return {
    parseIvrBadges: parseIvrBadges,
    parseGqlGlobal: parseGqlGlobal,
    parseGqlChannel: parseGqlChannel,
    parseUser: parseUser,
    loadGlobal: loadGlobal,
    loadChannel: loadChannel,
    lookupUser: lookupUser,
    lookupUserById: lookupUserById,
    parseCheermotes: parseCheermotes,
    loadCheermotes: loadCheermotes
  };
});
