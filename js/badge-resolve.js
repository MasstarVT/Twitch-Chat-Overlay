/* Twitch badge set/version resolution against channel + global badge maps. Pure. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).badgeResolve = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var CDN_RE = /^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[0-9a-f-]{36}\/[123]$/i;
  // Every Twitch badge image is on static-cdn.jtvnw.net; any other URL from IVR or GQL is dropped.
  var HOST_RE = /^https:\/\/static-cdn\.jtvnw\.net\/[^\s"'()<>\\]*$/i;

  function cdnUrl(u) { return typeof u === 'string' && HOST_RE.test(u) ? u : null; }

  function addBadge(sets, setId, version, badge) {
    var m = sets.get(setId);
    if (!m) { m = new Map(); sets.set(setId, m); }
    m.set(String(version), badge);
  }

  // IVR (Helix-shaped, bare array): [{set_id, versions:[{id, image_url_1x, image_url_2x, image_url_4x, title}]}]
  function fromHelixLike(list) {
    var sets = new Map();
    if (!Array.isArray(list)) return sets;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !s.set_id || !Array.isArray(s.versions)) continue;
      for (var j = 0; j < s.versions.length; j++) {
        var v = s.versions[j];
        var u1 = v && cdnUrl(v.image_url_1x);
        if (!u1 || v.id === undefined) continue;
        var u2 = cdnUrl(v.image_url_2x) || u1;
        addBadge(sets, s.set_id, v.id, {
          set: s.set_id,
          version: String(v.id),
          title: v.title || s.set_id,
          urls: { 1: u1, 2: u2, 4: cdnUrl(v.image_url_4x) || u2 }
        });
      }
    }
    return sets;
  }

  // Twitch GQL: [{setID, version, title, imageURL}] where imageURL ends in /1, /2 or /3.
  function fromGqlFlat(list) {
    var sets = new Map();
    if (!Array.isArray(list)) return sets;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || !b.setID || b.version === undefined || !cdnUrl(b.imageURL)) continue;
      var base = b.imageURL.replace(/\/[123]$/, '');
      addBadge(sets, b.setID, b.version, {
        set: b.setID,
        version: String(b.version),
        title: b.title || b.setID,
        urls: { 1: base + '/1', 2: base + '/2', 4: base + '/3' }
      });
    }
    return sets;
  }

  function get(sets, setId, version) {
    if (!sets) return null;
    var m = sets.get(setId);
    if (!m) return null;
    return m.get(String(version)) || null;
  }

  function tierBlock(v) { return v >= 3000 ? 3000 : v >= 2000 ? 2000 : 0; }

  function highestAtOrBelow(sets, setId, v, sameBlock) {
    if (!sets) return null;
    var m = sets.get(setId);
    if (!m) return null;
    var best = null, bestV = -1;
    m.forEach(function (badge, key) {
      var k = parseInt(key, 10);
      if (!isFinite(k) || String(k) !== key) return;
      if (sameBlock && tierBlock(k) !== tierBlock(v)) return;
      if (k <= v && k > bestV) { best = badge; bestV = k; }
    });
    return best;
  }

  // Resolve a badge from the `badges` tag. Returns {set, version, title, urls} or null (skip).
  function resolve(setId, version, channelSets, globalSets) {
    var b = get(channelSets, setId, version) || get(globalSets, setId, version);
    if (b) return b;
    var v = parseInt(version, 10);
    if (!isFinite(v)) return null;
    if (setId === 'subscriber') {
      return highestAtOrBelow(channelSets, 'subscriber', v, true) || get(globalSets, 'subscriber', '0');
    }
    if (setId === 'bits') {
      return highestAtOrBelow(channelSets, 'bits', v, false) || highestAtOrBelow(globalSets, 'bits', v, false);
    }
    return null;
  }

  return {
    CDN_RE: CDN_RE,
    fromHelixLike: fromHelixLike,
    fromGqlFlat: fromGqlFlat,
    get: get,
    resolve: resolve
  };
});
