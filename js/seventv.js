/* 7TV: emotes (v3 REST, v4 GQL fallback), paint/badge catalog, EventAPI routing + entitlements, GQL style lookup. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var paintCss = typeof require === 'function' ? require('./paint-css.js') : root.TCO.paintCss;
  var api = factory(root, util, paintCss);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).seventv = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, paintCss) {
  'use strict';

  var V3 = 'https://7tv.io/v3';
  var V3_GQL = 'https://7tv.io/v3/gql';
  var V4_GQL = 'https://7tv.io/v4/gql';
  var EVENTS_URL = 'wss://events.7tv.io/v3';

  var ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
  var NIL_RE = /^0+$/;
  var TWITCH_ID_RE = /^\d+$/;
  var FILE_RE = /^([1-4])x\.webp$/;        // animated-or-static main file; never the *_static names
  var SUB_TYPE_RE = /^(emote|emote_set|user|entitlement|cosmetic)\.(\*|create|update|delete)$/;
  var PERSONAL_FLAGS = 4 | 8;              // EmoteSet Personal | Commercial (special/event sets)

  var EMOTE_ITEMS = 'items{alias flags{zeroWidth} emote{id flags{defaultZeroWidth} images{url mime scale width height frameCount}}}';
  var Q_GLOBAL_V4 = '{emoteSets{global{emotes{' + EMOTE_ITEMS + '}}}}';
  var Q_CHANNEL_V4 = 'query($id:String!){users{userByConnection(platform:TWITCH, platformId:$id){id style{activeEmoteSetId ' +
    'activeEmoteSet{id emotes{' + EMOTE_ITEMS + '}}}}}}';
  var Q_SET_V4 = 'query($id:Id!){emoteSets{emoteSet(id:$id){id emotes{' + EMOTE_ITEMS + '}}}}';
  var Q_CATALOG_V4 = '{paints{paints{id name data{layers{id opacity ty{__typename ' +
    '...on PaintLayerTypeSingleColor{color{hex}} ' +
    '...on PaintLayerTypeLinearGradient{angle repeating stops{at color{hex}}} ' +
    '...on PaintLayerTypeRadialGradient{repeating shape stops{at color{hex}}} ' +
    '...on PaintLayerTypeImage{images{url mime scale frameCount}}}} ' +
    'shadows{color{hex} offsetX offsetY blur}}}} badges{badges{id name description images{url mime scale frameCount}}}}';
  var Q_CATALOG_V3 = '{cosmetics{paints{id name function color angle shape image_url repeat stops{at color} ' +
    'shadows{x_offset y_offset radius color}} badges{id name tooltip host{url files{name format width height}}}}}';

  // ---------- ids ----------
  function isUlid(s) { return typeof s === 'string' && ULID_RE.test(s); }
  // A usable object id: a ULID that is not the all-zero placeholder 7TV puts on entitlements/unknown users.
  function validId(s) { return isUlid(s) && !NIL_RE.test(s); }

  // ---------- normalizers (pure) ----------
  // v3 host {url:'//cdn.7tv.app/emote/<id>', files:[{name:'1x.webp', static_name, width, height, format}]}
  function v3Files(host) {
    if (!host || !Array.isArray(host.files)) return null;
    var base = util.absUrl(host.url); // protocol-relative -> https:
    if (!base) return null;
    var urls = {}, sizes = {}, keys = [];
    for (var i = 0; i < host.files.length; i++) {
      var f = host.files[i];
      if (!f || typeof f.name !== 'string') continue;
      if (f.format && String(f.format).toUpperCase() !== 'WEBP') continue;
      var m = FILE_RE.exec(f.name);
      if (!m) continue;
      var url = base + '/' + f.name;
      if (!util.isSafeUrl(url)) continue;
      var k = Number(m[1]);
      if (!urls[k]) keys.push(k);
      urls[k] = url;
      sizes[k] = { w: Number(f.width) || 0, h: Number(f.height) || 0 };
    }
    return keys.length ? { urls: urls, size: oneX(sizes, keys) } : null;
  }

  // v4 images [{url, mime, scale, width?, height?, frameCount}] in no fixed order: webp only, animated preferred.
  function v4Images(images) {
    if (!Array.isArray(images)) return null;
    var webp = images.filter(function (im) {
      return im && im.mime === 'image/webp' && im.scale >= 1 && im.scale <= 4 && util.isSafeUrl(im.url);
    });
    var anim = webp.filter(function (im) { return (im.frameCount || 1) > 1; });
    var pool = anim.length ? anim : webp;
    var urls = {}, sizes = {}, keys = [];
    for (var i = 0; i < pool.length; i++) {
      var im = pool[i];
      var k = Math.round(im.scale);
      // Static assets can list both "1x.webp" and "1x_static.webp": keep the main file.
      if (urls[k] && /_static\./.test(im.url)) continue;
      if (!urls[k]) keys.push(k);
      urls[k] = im.url;
      sizes[k] = { w: Number(im.width) || 0, h: Number(im.height) || 0 };
    }
    return keys.length ? { urls: urls, size: oneX(sizes, keys) } : null;
  }

  // 1x dimensions, derived from the smallest scale when 1x is missing.
  function oneX(sizes, keys) {
    if (sizes[1] && sizes[1].w && sizes[1].h) return sizes[1];
    var k = Math.min.apply(Math, keys);
    var s = sizes[k];
    return s && s.w && s.h ? { w: Math.round(s.w / k), h: Math.round(s.h / k) } : { w: 28, h: 28 };
  }

  // v3 ActiveEmote {id, name(alias), flags, data:{id, name, flags, host}} -> Emote
  function normalizeActiveEmoteV3(ae) {
    var data = ae && ae.data;
    if (!data || !data.host) return null;
    var id = util.idStr(ae.id || data.id);
    var name = typeof ae.name === 'string' ? ae.name : '';
    if (!id || !name) return null;
    var img = v3Files(data.host);
    if (!img) return null;
    return {
      provider: '7tv', id: id, name: name, w: img.size.w, h: img.size.h, urls: img.urls,
      zw: !!((ae.flags & 1) || (data.flags & 256))
    };
  }

  // v4 EmoteSetEmote {alias, flags{zeroWidth}, emote{id, flags{defaultZeroWidth}, images[]}} -> Emote
  function normalizeEmoteV4(item) {
    var em = item && item.emote;
    if (!em) return null;
    var id = util.idStr(em.id);
    var name = typeof item.alias === 'string' ? item.alias : '';
    if (!id || !name) return null;
    var img = v4Images(em.images);
    if (!img) return null;
    return {
      provider: '7tv', id: id, name: name, w: img.size.w, h: img.size.h, urls: img.urls,
      zw: !!((item.flags && item.flags.zeroWidth) || (em.flags && em.flags.defaultZeroWidth))
    };
  }

  // v3 badge (cosmetic.create / v3 GQL) {id, name, tooltip, host} -> Badge
  function normalizeBadgeV3(data) {
    if (!data) return null;
    var img = v3Files(data.host);
    if (!img) return null;
    return { provider: '7tv', title: String(data.tooltip || data.name || '7TV'), urls: img.urls };
  }

  // v4 badge {id, name, description, images[]} -> Badge
  function normalizeBadgeV4(b) {
    if (!b) return null;
    var img = v4Images(b.images);
    if (!img) return null;
    return { provider: '7tv', title: String(b.description || b.name || '7TV'), urls: img.urls };
  }

  function mapFrom(list, fn) {
    var m = new Map();
    if (!Array.isArray(list)) return m;
    for (var i = 0; i < list.length; i++) {
      var e = fn(list[i]);
      if (e) m.set(e.name, e);
    }
    return m;
  }

  // ---------- loaders ----------
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function gql(url, query, variables, timeout) {
    var body = { query: query };
    if (variables) body.variables = variables;
    return util.postJson(url, body, null, { timeout: timeout || 10000 }).then(function (r) {
      if (!r || util.isNotFound(r)) throw new Error('7tv gql: empty response from ' + url);
      if (r.errors && r.errors.length) throw new Error('7tv gql: ' + ((r.errors[0] && r.errors[0].message) || 'error'));
      if (!r.data) throw new Error('7tv gql: no data');
      return r.data;
    });
  }

  function globalV3() {
    return util.fetchJson(V3 + '/emote-sets/global', { timeout: 10000 }).then(function (r) {
      if (!r || util.isNotFound(r) || !Array.isArray(r.emotes)) throw new Error('7tv global: bad v3 response');
      return mapFrom(r.emotes, normalizeActiveEmoteV3);
    });
  }

  function globalV4() {
    return gql(V4_GQL, Q_GLOBAL_V4, null, 20000).then(function (d) {
      var s = d.emoteSets && d.emoteSets.global;
      var items = s && s.emotes && s.emotes.items;
      if (!Array.isArray(items)) throw new Error('7tv global: bad v4 response');
      return mapFrom(items, normalizeEmoteV4);
    });
  }

  function loadGlobal() {
    return globalV3().catch(function (err) {
      util.warn('7tv global v3 failed, trying v4 GQL:', err && err.message);
      return globalV4();
    });
  }

  // null = the channel has no 7TV account (not an error). An account with no active set gives an empty
  // map and setId null, so the owner is still registered and a set turned on mid-stream is picked up.
  function noSet(ownerId) {
    var oid = util.idStr(ownerId);
    return validId(oid) ? { emotes: new Map(), setId: null, ownerId: oid } : null;
  }

  function channelV3(id) {
    return util.fetchJson(V3 + '/users/twitch/' + id, { timeout: 20000 }).then(function (r) {
      if (!r || util.isNotFound(r) || !r.user) return null;
      if (!r.emote_set) {
        // An active set id with no set object is a glitch on 7TV's side, not "no set": fail so the
        // loader retries and falls back to v4, instead of wiping the emotes already shown.
        if (validId(util.idStr(r.emote_set_id))) throw new Error('7tv channel: active set ' + util.idStr(r.emote_set_id) + ' did not resolve');
        return noSet(r.user.id);
      }
      return {
        emotes: mapFrom(r.emote_set.emotes, normalizeActiveEmoteV3),
        setId: util.idStr(r.emote_set_id || r.emote_set.id) || null,
        ownerId: util.idStr(r.user.id) || null
      };
    });
  }

  function channelV4(id) {
    return gql(V4_GQL, Q_CHANNEL_V4, { id: id }, 20000).then(function (d) {
      var u = d.users && d.users.userByConnection;
      var set = u && u.style && u.style.activeEmoteSet;
      // Same glitch as v3 (id set, set missing): null keeps the emotes already shown.
      if (!set) return u && !validId(util.idStr(u.style && u.style.activeEmoteSetId)) ? noSet(u.id) : null;
      return {
        emotes: mapFrom(set.emotes && set.emotes.items, normalizeEmoteV4),
        setId: util.idStr(u.style.activeEmoteSetId || set.id) || null,
        ownerId: util.idStr(u.id) || null
      };
    });
  }

  // v3 REST; on network error / 5xx / timeout retry once, then v4 GQL.
  function loadChannel(roomId) {
    var id = util.idStr(roomId);
    if (!TWITCH_ID_RE.test(id)) return Promise.resolve(null);
    return channelV3(id).catch(function (err) {
      util.log('7tv channel v3 failed, retrying once:', err && err.message);
      return wait(1500).then(function () { return channelV3(id); });
    }).catch(function (err) {
      util.warn('7tv channel v3 failed twice, trying v4 GQL:', err && err.message);
      return channelV4(id);
    });
  }

  function setV4(id) {
    return gql(V4_GQL, Q_SET_V4, { id: id }, 20000).then(function (d) {
      var s = d.emoteSets && d.emoteSets.emoteSet;
      var items = s && s.emotes && s.emotes.items;
      // No set: fail (and retry) rather than wipe the emotes the overlay already shows.
      if (!Array.isArray(items)) throw new Error('7tv set: bad v4 response');
      return mapFrom(items, normalizeEmoteV4);
    });
  }

  // v3 REST, then v4 GQL when v3 fails (network error / 5xx / timeout).
  function loadSet(setId) {
    var id = util.idStr(setId);
    if (!validId(id)) return Promise.reject(new Error('7tv: invalid emote set id'));
    return util.fetchJson(V3 + '/emote-sets/' + id, { timeout: 20000 }).then(function (r) {
      if (!r || util.isNotFound(r)) return new Map();
      return mapFrom(r.emotes, normalizeActiveEmoteV3);
    }, function (err) {
      util.warn('7tv set v3 failed, trying v4 GQL:', err && err.message);
      return setV4(id);
    });
  }

  // One malformed catalog entry is skipped instead of failing the whole catalog.
  function tryNorm(fn, x) {
    try { return fn(x); } catch (e) { util.warn('7tv catalog: skipped a malformed entry', e && e.message); return null; }
  }

  function catalogV4() {
    return gql(V4_GQL, Q_CATALOG_V4, null, 20000).then(function (d) {
      var paints = new Map(), badges = new Map();
      // Array.isArray: a hostile {length: 1e12} must not spin the loop.
      var pl = d.paints && Array.isArray(d.paints.paints) ? d.paints.paints : [];
      var bl = d.badges && Array.isArray(d.badges.badges) ? d.badges.badges : [];
      for (var i = 0; i < pl.length; i++) {
        var p = tryNorm(paintCss.fromV4, pl[i]);
        if (p) paints.set(p.id, p);
      }
      for (var j = 0; j < bl.length; j++) {
        var b = bl[j] && validId(bl[j].id) ? tryNorm(normalizeBadgeV4, bl[j]) : null;
        if (b) badges.set(bl[j].id, b);
      }
      if (!paints.size && !badges.size) throw new Error('7tv catalog: empty v4 response');
      return { paints: paints, badges: badges };
    });
  }

  function catalogV3() {
    return gql(V3_GQL, Q_CATALOG_V3, null, 30000).then(function (d) {
      var c = d.cosmetics || {};
      var paints = new Map(), badges = new Map();
      var pl = Array.isArray(c.paints) ? c.paints : [], bl = Array.isArray(c.badges) ? c.badges : [];
      for (var i = 0; i < pl.length; i++) {
        var p = tryNorm(paintCss.fromV3, pl[i]);
        if (p) paints.set(p.id, p);
      }
      for (var j = 0; j < bl.length; j++) {
        var b = bl[j] && validId(bl[j].id) ? tryNorm(normalizeBadgeV3, bl[j]) : null;
        if (b) badges.set(bl[j].id, b);
      }
      if (!paints.size && !badges.size) throw new Error('7tv catalog: empty v3 response');
      return { paints: paints, badges: badges };
    });
  }

  function loadCatalog() {
    return catalogV4().catch(function (err) {
      util.warn('7tv catalog v4 failed, trying v3 GQL:', err && err.message);
      return catalogV3();
    });
  }

  // ---------- emote set change application ----------
  function findKey(map, id, name) {
    if (name && map.has(name) && (!id || map.get(name).id === id)) return name;
    if (!id) return null;
    var found = null;
    map.forEach(function (e, k) { if (found === null && e && e.id === id) found = k; });
    return found;
  }

  function isEmoteChange(c) { return c && (c.key === 'emotes' || c.key === undefined); }

  // Well above 7TV's own set capacity: pushes past it are ignored so a hostile stream cannot grow a set.
  var MAX_SET_EMOTES = 5000;

  // ChangeMap {id, pushed:[{value}], pulled:[{old_value}], updated:[{old_value, value}]}; pulled data may be null.
  function applySetChanges(map, body) {
    var changed = false, i, c, k;
    var pulled = Array.isArray(body.pulled) ? body.pulled : [];
    for (i = 0; i < pulled.length; i++) {
      c = pulled[i];
      if (!isEmoteChange(c) || !c.old_value) continue;
      k = findKey(map, util.idStr(c.old_value.id), c.old_value.name);
      if (k !== null) { map.delete(k); changed = true; }
    }
    var updated = Array.isArray(body.updated) ? body.updated : [];
    for (i = 0; i < updated.length; i++) {
      c = updated[i];
      if (!isEmoteChange(c) || !c.value) continue;
      var ov = c.old_value || {};
      k = findKey(map, util.idStr(ov.id || c.value.id), ov.name);
      var prev = k !== null ? map.get(k) : null;
      var next = normalizeActiveEmoteV3(c.value);
      if (!next && prev && typeof c.value.name === 'string' && c.value.name) {
        // Rename without image data: reuse the old entry under the new alias.
        next = {};
        for (var f in prev) next[f] = prev[f];
        next.name = c.value.name;
      }
      if (!next) continue;
      if (k !== null) map.delete(k);
      map.set(next.name, next);
      changed = true;
    }
    var pushed = Array.isArray(body.pushed) ? body.pushed : [];
    for (i = 0; i < pushed.length; i++) {
      c = pushed[i];
      if (!isEmoteChange(c)) continue;
      var e = normalizeActiveEmoteV3(c.value);
      if (!e || (map.size >= MAX_SET_EMOTES && !map.has(e.name))) continue;
      map.set(e.name, e);
      changed = true;
    }
    return changed;
  }

  // ---------- state: catalog, channel/personal sets, entitlements ----------
  // Long-run caps (a stream can run for hours); exported for tests.
  var CAPS = { personalSets: 2000, userCos: 20000, gqlStyle: 20000, extraCosmetics: 2000, refetch: 2000 };
  var REFETCH_RETRY = 300000; // a personal set that failed to load is tried again after 5 min
  var SET_GRACE = 10000;

  // opts: { bus (util.Emitter), onSetSwitch(roomId, newSetId | null, ownerId),
  //         loadSet(setId)? (refetches an evicted personal set), wantPersonal()? (false: ignore personal sets) }
  function createState(opts) {
    opts = opts || {};
    var bus = opts.bus || null;
    var paints = new Map();
    var badges = new Map();
    var personalSets = new util.LRU(CAPS.personalSets);   // setId -> Map<name, Emote>
    var userCos = new util.LRU(CAPS.userCos);             // twitch userId -> {paint, badge, sets:Set}
    var gqlStyle = new util.LRU(CAPS.gqlStyle);           // twitch userId -> {paint, badge} | null
    var refetch = new util.LRU(CAPS.refetch);             // personal setId -> time a refetch may start again
    var extraPaints = 0, extraBadges = 0;                 // entries added by cosmetic.create
    var setRooms = new Map();                 // channel setId -> Map<roomId, emotesMap>
    var roomSet = new Map();                  // roomId -> channel setId
    var ownerRoom = new Map();                // channel owner's 7TV id -> roomId
    var switched = new Map();                 // ownerId -> last set id announced via onSetSwitch

    function emit(x) { if (bus) bus.emit('changed', x); }

    function registerOwner(roomId, ownerId) {
      var rid = util.idStr(roomId), oid = util.idStr(ownerId);
      if (!rid || !validId(oid)) return false;
      ownerRoom.set(oid, rid);
      return true;
    }

    // Route emote_set.update for setId into emotesMap (the RoomContext's own Map).
    // A null setId (the channel has no active set) drops the room's old routing.
    function registerChannelSet(roomId, setId, emotesMap, ownerId) {
      var rid = util.idStr(roomId), sid = util.idStr(setId);
      if (ownerId !== undefined && ownerId !== null) registerOwner(rid, ownerId);
      if (!rid || !(emotesMap instanceof Map)) return false;
      unroute(rid);
      // A registered set supersedes any switch still in flight for this room's owner, so a stale
      // "last announced" entry can never suppress a later switch.
      ownerRoom.forEach(function (r, oid) { if (r === rid) switched.delete(oid); });
      if (!validId(sid)) return false;
      roomSet.set(rid, sid);
      var rooms = setRooms.get(sid);
      if (!rooms) { rooms = new Map(); setRooms.set(sid, rooms); }
      rooms.set(rid, emotesMap);
      return true;
    }

    function unroute(rid) {
      var old = roomSet.get(rid);
      if (old === undefined) return;
      roomSet.delete(rid);
      var rooms = setRooms.get(old);
      if (rooms) {
        rooms.delete(rid);
        if (!rooms.size) setRooms.delete(old);
      }
    }

    // Drop routing for an evicted room (EventAPI subscriptions are never removed).
    function forgetRoom(roomId) {
      var rid = util.idStr(roomId);
      unroute(rid);
      ownerRoom.forEach(function (r, oid) { if (r === rid) { ownerRoom.delete(oid); switched.delete(oid); } });
    }

    function mergeCatalog(cat) {
      if (cat && cat.paints) cat.paints.forEach(function (p, id) { if (!paints.has(id)) paints.set(id, p); });
      if (cat && cat.badges) cat.badges.forEach(function (b, id) { if (!badges.has(id)) badges.set(id, b); });
      emit({ all: true });
    }

    function wantPersonal() { return !opts.wantPersonal || !!opts.wantPersonal(); }

    function onSetCreate(body) {
      var obj = body.object || {};
      var id = util.idStr(obj.id || body.id);
      if (!validId(id) || !((obj.flags | 0) & PERSONAL_FLAGS) || !wantPersonal()) return;
      // Emotes follow in emote_set.update pushed[]; a re-sent create carries the full list again.
      personalSets.set(id, new Map());
    }

    function onSetUpdate(body) {
      var id = util.idStr(body.id);
      if (!validId(id)) return;
      var rooms = setRooms.get(id);
      if (rooms) {
        rooms.forEach(function (map, rid) {
          if (applySetChanges(map, body)) emit({ roomId: rid });
        });
      }
      var personal = personalSets.get(id);
      if (personal && applySetChanges(personal, body)) emit({ setId: id });
    }

    function onCosmetic(body) {
      var obj = body.object;
      var data = obj && obj.data;
      if (!data) return;
      var id = util.idStr(obj.id || data.id || body.id);
      if (!validId(id)) return;
      var kind = String(obj.kind || '').toUpperCase();
      // The maps are never pruned (lines refer to them by id), so only so many unknown ids are taken.
      if (kind === 'PAINT') {
        if (paints.has(id) || extraPaints >= CAPS.extraCosmetics) return;
        var src = data;
        if (data.id !== id) { src = {}; for (var k in data) src[k] = data[k]; src.id = id; }
        var p = paintCss.fromV3(src);
        if (p) { paints.set(id, p); extraPaints++; emit({ all: true }); }
      } else if (kind === 'BADGE') {
        if (badges.has(id) || extraBadges >= CAPS.extraCosmetics) return;
        var b = normalizeBadgeV3(data);
        if (b) { badges.set(id, b); extraBadges++; emit({ all: true }); }
      }
    }

    function twitchIdOf(user) {
      var conns = user && Array.isArray(user.connections) ? user.connections : [];
      for (var i = 0; i < conns.length; i++) {
        var c = conns[i];
        if (c && String(c.platform).toUpperCase() === 'TWITCH') {
          var id = util.idStr(c.id);
          if (id) return id;
        }
      }
      return '';
    }

    function onEntitlement(body, create) {
      var obj = body.object || {};
      var kind = String(obj.kind || '').toUpperCase();
      var ref = util.idStr(obj.ref_id);
      var uid = twitchIdOf(obj.user);
      if (!uid || !validId(ref)) return;
      if (kind !== 'PAINT' && kind !== 'BADGE' && kind !== 'EMOTE_SET') return;
      var entry = userCos.get(uid);
      var changed = false;
      if (!entry) {
        if (!create) return; // the server only deletes what it created on this socket
        entry = { paint: null, badge: null, sets: new Set() };
        changed = true;      // an entry now overrides any GQL style
      }
      if (kind === 'PAINT') {
        if (create) { if (entry.paint !== ref) changed = true; entry.paint = ref; }
        else if (entry.paint === ref) { entry.paint = null; changed = true; }
      } else if (kind === 'BADGE') {
        if (create) { if (entry.badge !== ref) changed = true; entry.badge = ref; }
        else if (entry.badge === ref) { entry.badge = null; changed = true; }
      } else if (create) {
        if (!entry.sets.has(ref)) { changed = true; entry.setAt = util.now(); }
        entry.sets.add(ref);
      } else if (entry.sets.delete(ref)) {
        changed = true;
      }
      userCos.set(uid, entry);
      if (changed) emit({ userId: uid });
    }

    // body.updated:[{key:'connections', value:[{key:'emote_set_id', old_value, value}, {key:'emote_set', value:{id}}]}]
    function onUserUpdate(body) {
      var ownerId = util.idStr(body.id);
      var rid = ownerRoom.get(ownerId);
      if (!rid) return;
      var byId = '', bySet = '', cleared = false;
      var upd = Array.isArray(body.updated) ? body.updated : [];
      for (var i = 0; i < upd.length; i++) {
        var u = upd[i];
        if (!u || u.key !== 'connections' || !Array.isArray(u.value)) continue;
        for (var j = 0; j < u.value.length; j++) {
          var v = u.value[j];
          if (!v) continue;
          if (v.key === 'emote_set_id' && v.value !== v.old_value && !byId) {
            byId = util.idStr(v.value);
            if (!validId(byId) && validId(util.idStr(v.old_value))) cleared = true; // set turned off
          } else if (v.key === 'emote_set' && v.value && typeof v.value === 'object' && !bySet) bySet = util.idStr(v.value.id);
        }
      }
      var next = validId(byId) ? byId : bySet;
      // Dedupe against the last announced set while a switch is pending (so A->B->A still reaches
      // onSetSwitch), else against the registered one.
      var cur = switched.has(ownerId) ? switched.get(ownerId) : roomSet.get(rid);
      if (!validId(next)) {
        // The owner turned their set off: announce null once (the overlay confirms it with a reload).
        if (!cleared || !cur) return;
        switched.set(ownerId, '');
        if (opts.onSetSwitch) opts.onSetSwitch(rid, null, ownerId);
        return;
      }
      if (cur === next) return;
      switched.set(ownerId, next);
      if (opts.onSetSwitch) opts.onSetSwitch(rid, next, ownerId);
    }

    function handleDispatch(type, body) {
      if (!body || typeof body !== 'object') return;
      switch (type) {
        case 'emote_set.create': onSetCreate(body); break;
        case 'emote_set.update': onSetUpdate(body); break;
        case 'cosmetic.create': onCosmetic(body); break;
        case 'entitlement.create': onEntitlement(body, true); break;
        case 'entitlement.delete': onEntitlement(body, false); break;
        case 'user.update': onUserUpdate(body); break;
        default: break; // presences also deliver types we never subscribed to
      }
    }

    // Entitlements (validated) win whenever present; GQL style is the fallback. Sets only come from entitlements.
    function effective(userId) {
      var uid = util.idStr(userId);
      var c = userCos.get(uid);
      if (c) return { paint: c.paint, badge: c.badge, sets: Array.from(c.sets) };
      var g = gqlStyle.get(uid);
      if (g) return { paint: g.paint || null, badge: g.badge || null, sets: [] };
      return { paint: null, badge: null, sets: [] };
    }

    function userEmoteMaps(userId) {
      var c = userCos.get(util.idStr(userId));
      var out = [];
      if (!c) return out;
      c.sets.forEach(function (sid) {
        var m = personalSets.get(sid);
        if (m) { if (m.size) out.push(m); } else if (!(util.now() - c.setAt < SET_GRACE)) refetchSet(sid);
      });
      return out;
    }

    // 7TV sends a personal set's emote_set.create once per socket session, so a set evicted from
    // personalSets (or skipped while personal emotes were off) is fetched again, once, when needed.
    // A just-granted set gets SET_GRACE for its own emote_set.create to arrive first.
    function refetchSet(sid) {
      if (!opts.loadSet || !wantPersonal()) return;
      var at = refetch.peek(sid);
      if (at !== undefined && util.now() < at) return;
      refetch.set(sid, Infinity); // in flight
      Promise.resolve().then(function () { return opts.loadSet(sid); }).then(function (m) {
        refetch.delete(sid);
        if (!(m instanceof Map) || personalSets.has(sid)) return; // a fresh emote_set.create won
        personalSets.set(sid, m);
        if (m.size) emit({ setId: sid });
      }).catch(function (err) {
        refetch.set(sid, util.now() + REFETCH_RETRY);
        util.log('7tv personal set refetch failed:', err && err.message);
      });
    }

    function setGqlStyle(userId, v) {
      var uid = util.idStr(userId);
      if (!uid) return;
      gqlStyle.set(uid, v ? { paint: v.paint || null, badge: v.badge || null } : null);
    }

    function hasUser(userId) {
      var uid = util.idStr(userId);
      return userCos.has(uid) || gqlStyle.has(uid);
    }

    return {
      paints: paints,
      badges: badges,
      personalSets: personalSets,
      userCos: userCos,
      gqlStyle: gqlStyle,
      registerChannelSet: registerChannelSet,
      registerOwner: registerOwner,
      forgetRoom: forgetRoom,
      channelSetOf: function (roomId) { return roomSet.get(util.idStr(roomId)) || null; },
      mergeCatalog: mergeCatalog,
      handleDispatch: handleDispatch,
      effective: effective,
      userEmoteMaps: userEmoteMaps,
      setGqlStyle: setGqlStyle,
      hasUser: hasUser
    };
  }

  // ---------- EventAPI client ----------
  var CHANNEL_TYPES = ['cosmetic.create', 'entitlement.create', 'entitlement.delete', 'emote_set.*'];
  var DEFAULT_HEARTBEAT = 45000;
  var MAX_SUBS = 400; // server limit is 500 incl. one hidden presence topic per channel

  // opts: { state, onReady(helloData)?, WebSocket?, url? }
  function createEventClient(opts) {
    opts = opts || {};
    var state = opts.state;
    var subs = new Map();   // JSON key -> {type, condition}
    var live = null;        // ctl of the connection that has sent Hello
    var dog = null;
    var heartbeat = DEFAULT_HEARTBEAT;
    var stats = { hellos: 0, acks: 0, dispatches: 0, errors: 0, lastEnd: null };
    var client = null;

    function frame(s) { return JSON.stringify({ op: 35, d: { type: s.type, condition: s.condition } }); }

    function add(type, condition) {
      var key = JSON.stringify([type, condition]);
      if (subs.has(key)) return true;
      if (subs.size >= MAX_SUBS) { util.warn('7TV EventAPI: subscription cap reached, skipping', type); return false; }
      var s = { type: type, condition: condition };
      subs.set(key, s);
      if (live && live.isOpen()) live.send(frame(s));
      return true;
    }

    function addChannel(roomId) {
      var id = util.idStr(roomId);
      if (!TWITCH_ID_RE.test(id)) return false;
      for (var i = 0; i < CHANNEL_TYPES.length; i++) add(CHANNEL_TYPES[i], { ctx: 'channel', platform: 'TWITCH', id: id });
      return true;
    }

    // Only real ULIDs: a missing/placeholder object_id makes the server close the whole socket (4002).
    function addObject(type, objectId) {
      var oid = util.idStr(objectId);
      if (typeof type !== 'string' || !SUB_TYPE_RE.test(type) || !validId(oid)) return false;
      return add(type, { object_id: oid });
    }

    // Undoes addObject (e.g. the old set after a channel set switch), so switches don't pile up subscriptions.
    function removeObject(type, objectId) {
      var oid = util.idStr(objectId);
      var key = JSON.stringify([type, { object_id: oid }]);
      var s = subs.get(key);
      if (!s) return false;
      subs.delete(key);
      if (live && live.isOpen()) live.send(JSON.stringify({ op: 36, d: { type: s.type, condition: s.condition } }));
      return true;
    }

    function armWatchdog(ctl) {
      if (dog !== null) ctl.clearTimer(dog);
      dog = ctl.setTimeout(function () {
        dog = null;
        util.warn('7TV EventAPI: no traffic for', 3 * heartbeat, 'ms, reconnecting');
        ctl.reconnect('watchdog');
      }, 3 * heartbeat);
    }

    function onHello(d, ctl) {
      stats.hellos++;
      // Out-of-range values (seconds instead of ms, or past the 32-bit timer range) would make the
      // watchdog fire at once and reconnect in a loop.
      var hb = Number(d.heartbeat_interval);
      heartbeat = hb >= 1000 && hb <= 600000 ? hb : DEFAULT_HEARTBEAT;
      armWatchdog(ctl);
      live = ctl;
      subs.forEach(function (s) { ctl.send(frame(s)); });
      if (opts.onReady) {
        try { opts.onReady(d); } catch (e) { util.warn('7TV onReady threw', e); }
      }
    }

    function onEnd(d, ctl) {
      var code = Number(d.code);
      stats.lastEnd = { code: code, message: String(d.message || '') };
      util.warn('7TV EventAPI end of stream:', code, d.message || '');
      if (code === 4000 || code === 4006 || code === 4012) {
        ctl.reconnect('end ' + code, { delay: util.jitter(0, 2000) });
      } else if (code === 4005 || code === 4007) {
        ctl.reconnect('end ' + code, { delay: util.jitter(60000, 80000) });
      } else if (code === 4001 || code === 4002 || code === 4010) {
        util.warn('7TV EventAPI rejected a client payload (bug); retrying in 5 min');
        ctl.reconnect('end ' + code, { delay: 300000 });
      }
      // other codes: the close that follows goes through the normal backoff
    }

    function onMessage(data, ctl) {
      var m;
      try { m = JSON.parse(data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      armWatchdog(ctl);
      var d = m.d || {};
      switch (m.op) {
        case 0:
          stats.dispatches++;
          if (state && d.type) {
            try { state.handleDispatch(d.type, d.body); } catch (e) { util.warn('7TV dispatch', d.type, 'threw', e); }
          }
          break;
        case 1: onHello(d, ctl); break;
        case 4: ctl.reconnect('server reconnect', { delay: util.jitter(0, 2000) }); break;
        case 5: stats.acks++; break;
        case 6: stats.errors++; util.warn('7TV EventAPI error:', d.message || '', d.fields || ''); break;
        case 7: onEnd(d, ctl); break;
        default: break; // 2 heartbeat
      }
    }

    function ensureClient() {
      if (client) return client;
      client = new util.SocketClient({
        name: '7tv',
        url: opts.url || EVENTS_URL,
        WebSocket: opts.WebSocket,
        baseDelay: 2000,
        maxDelay: 300000,
        onOpen: function (ctl) {
          live = null;
          dog = null;
          heartbeat = DEFAULT_HEARTBEAT;
          armWatchdog(ctl); // also covers a server that never says Hello
        },
        onMessage: onMessage,
        onClose: function (ev) {
          live = null;
          util.log('7TV EventAPI closed', ev && ev.code, ev && ev.reason);
        }
      });
      return client;
    }

    return {
      start: function () { ensureClient().start(); },
      stop: function () { if (client) client.stop('stopped'); live = null; },
      kick: function () { if (client) client.kick(); },
      addChannel: addChannel,
      addObject: addObject,
      removeObject: removeObject,
      stats: function () {
        return {
          state: client ? client.state : 'idle', subs: subs.size, hellos: stats.hellos, acks: stats.acks,
          dispatches: stats.dispatches, errors: stats.errors, lastEnd: stats.lastEnd
        };
      },
      subsForTest: function () {
        var out = [];
        subs.forEach(function (s) { out.push({ op: 35, d: { type: s.type, condition: s.condition } }); });
        return out;
      }
    };
  }

  // ---------- GQL style lookup for chatters without entitlement data ----------
  var LOOKUP_BATCH = 50;       // complexity 5/alias, cap 400
  var LOOKUP_GAP = 5000;       // lets batches fill in a busy chat (at most 12 requests a minute)
  var LOOKUP_DEBOUNCE = 300;   // a lone new chatter is still looked up at once
  var LOOKUP_QUEUE_CAP = 500;
  var LOOKUP_TRIES = 3;        // a batch that keeps failing is dropped, so it cannot block the queue
  var LOOKUP_FAIL_TTL = 5 * 60000; // an id whose own lookup failed is not asked again for 5 minutes
  var LOOKUP_FAIL_CAP = 2000;
  var ALIAS_RE = /^u(\d+)$/;

  // opts: { state, isRelevant(userId)?, onResult(userId)?, post(body)? (tests) }
  function createLookup(opts) {
    opts = opts || {};
    var state = opts.state;
    var post = opts.post || function (body) { return util.postJson(V4_GQL, body, null, { timeout: 10000 }); };
    var queue = [];
    var pending = new Set();   // queued or in flight
    var timer = null, inFlight = false, lastAt = -Infinity, failDelay = 0, stopped = false;
    var retry = null;          // a failed batch, sent again on its own before the queue
    var counts = { requests: 0, errors: 0, found: 0 };
    // Ids whose alias came back as a partial error -> when. Not asked again for LOOKUP_FAIL_TTL, so a
    // user 7TV always fails on does not take a batch slot (and a request) on every message.
    var failedAt = new util.LRU(LOOKUP_FAIL_CAP);

    function known(id) {
      if (state.userCos.has(id) || state.gqlStyle.has(id)) return true;
      var t = failedAt.peek(id);
      if (t === undefined) return false;
      if (util.now() - t < LOOKUP_FAIL_TTL) return true;
      failedAt.delete(id);
      return false;
    }

    function trim() { while (queue.length > LOOKUP_QUEUE_CAP) pending.delete(queue.shift()); }

    function schedule(ms) {
      if (stopped || timer !== null || inFlight || !(queue.length || retry)) return;
      var delay = Math.max(ms, lastAt + LOOKUP_GAP - util.now(), 0);
      timer = setTimeout(run, delay);
    }

    function want(userId) {
      var id = util.idStr(userId);
      if (stopped || !TWITCH_ID_RE.test(id) || pending.has(id) || known(id)) return false;
      queue.push(id);
      pending.add(id);
      trim();
      schedule(LOOKUP_DEBOUNCE);
      return true;
    }

    function run() {
      timer = null;
      if (stopped || inFlight) return;
      var batch = retry || [];
      retry = null;
      while (!batch.tries && queue.length && batch.length < LOOKUP_BATCH) {
        var id = queue.shift();
        if (known(id) || (opts.isRelevant && !opts.isRelevant(id))) { pending.delete(id); continue; }
        batch.push(id);
      }
      if (!batch.length) return;
      var tries = batch.tries || 0;
      var parts = batch.map(function (uid, i) {
        return 'u' + i + ':userByConnection(platform:TWITCH, platformId:"' + uid + '"){style{activePaintId activeBadgeId}}';
      });
      inFlight = true;
      lastAt = util.now();
      counts.requests++;
      Promise.resolve().then(function () {
        return post({ query: 'query{users{' + parts.join(' ') + '}}' });
      }).then(function (r) {
        var users = r && !util.isNotFound(r) && r.data && r.data.users;
        if (!users || typeof users !== 'object') throw new Error('7tv lookup: bad response');
        // A partial error names its alias in path ['users', 'u<i>']: keep the aliases that resolved and
        // cache nothing for the failed ones (asked again after LOOKUP_FAIL_TTL). An error that names no alias
        // fails the whole batch.
        var failed = {};
        var errs = Array.isArray(r.errors) ? r.errors : [];
        for (var e = 0; e < errs.length; e++) {
          var m = errs[e] && Array.isArray(errs[e].path) ? ALIAS_RE.exec(String(errs[e].path[1])) : null;
          if (!m) throw new Error('7tv lookup: ' + ((errs[e] && errs[e].message) || 'error'));
          failed[m[1]] = true;
        }
        inFlight = false;
        failDelay = 0;
        if (stopped) return;
        for (var i = 0; i < batch.length; i++) {
          var uid = batch[i];
          pending.delete(uid);
          if (failed[i]) { failedAt.set(uid, util.now()); continue; }
          if (!Object.prototype.hasOwnProperty.call(users, 'u' + i)) continue; // cache nothing
          var st = users['u' + i] && users['u' + i].style;
          var v = st ? { paint: util.idStr(st.activePaintId) || null, badge: util.idStr(st.activeBadgeId) || null } : null;
          state.setGqlStyle(uid, v);
          if (v && (v.paint || v.badge)) {
            counts.found++;
            if (opts.onResult) {
              try { opts.onResult(uid); } catch (e) { util.warn('7tv lookup onResult threw', e); }
            }
          }
        }
        schedule(0);
      }).catch(function (err) {
        inFlight = false;
        counts.errors++;
        if (stopped) return;
        failDelay = failDelay ? Math.min(60000, failDelay * 2) : 2000;
        if (tries + 1 >= LOOKUP_TRIES) {
          // Give up on these ids (uncached, so a later message asks again) and let the rest through.
          util.log('7tv lookup failed', LOOKUP_TRIES, 'times, dropping', batch.length, 'ids:', err && err.message);
          batch.forEach(function (uid) { pending.delete(uid); });
        } else {
          util.log('7tv lookup failed, retrying in', failDelay, 'ms:', err && err.message);
          // The same ids go back to the head as a batch of their own (ids stay in `pending`).
          retry = batch.slice();
          retry.tries = tries + 1;
        }
        schedule(failDelay);
      });
    }

    return {
      want: want,
      stop: function () { stopped = true; if (timer !== null) { clearTimeout(timer); timer = null; } },
      stats: function () {
        return { queued: queue.length + (retry ? retry.length : 0), inFlight: inFlight, requests: counts.requests, errors: counts.errors, found: counts.found };
      }
    };
  }

  return {
    isUlid: isUlid,
    validId: validId,
    normalizeActiveEmoteV3: normalizeActiveEmoteV3,
    normalizeEmoteV4: normalizeEmoteV4,
    normalizeBadgeV3: normalizeBadgeV3,
    normalizeBadgeV4: normalizeBadgeV4,
    applySetChanges: applySetChanges,
    loadGlobal: loadGlobal,
    loadChannel: loadChannel,
    loadSet: loadSet,
    loadCatalog: loadCatalog,
    createState: createState,
    createEventClient: createEventClient,
    createLookup: createLookup,
    CHANNEL_TYPES: CHANNEL_TYPES,
    CAPS: CAPS,
    // individual sources, for live checks
    _sources: {
      globalV3: globalV3, globalV4: globalV4, channelV3: channelV3, channelV4: channelV4,
      catalogV4: catalogV4, catalogV3: catalogV3
    }
  };
});
