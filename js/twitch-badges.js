/* Twitch global/channel chat badges (IVR, falling back to Twitch GQL) and IVR user lookups. */
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
    return badgeResolve.fromGqlFlat(data.user.broadcastBadges || []);
  }

  // IVR user lookup (bare array) -> {id, login, displayName, logo, banned} or null.
  function parseUser(json, login) {
    if (!Array.isArray(json) || !json.length) return null;
    var u = null;
    for (var i = 0; i < json.length && login; i++) {
      if (json[i] && String(json[i].login || '').toLowerCase() === login) { u = json[i]; break; }
    }
    u = u || json[0];
    var id = util.idStr(u && u.id);
    if (!ID_RE.test(id)) return null;
    var lg = String(u.login || '').toLowerCase();
    return {
      id: id,
      login: lg,
      displayName: typeof u.displayName === 'string' && u.displayName ? u.displayName : lg,
      logo: util.isSafeUrl(u.logo) ? u.logo : null,
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

  return {
    parseIvrBadges: parseIvrBadges,
    parseGqlGlobal: parseGqlGlobal,
    parseGqlChannel: parseGqlChannel,
    parseUser: parseUser,
    loadGlobal: loadGlobal,
    loadChannel: loadChannel,
    lookupUser: lookupUser,
    lookupUserById: lookupUserById
  };
});
