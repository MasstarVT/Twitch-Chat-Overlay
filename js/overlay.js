/* Overlay bootstrap: config, staged loading, IRC handling, badge/emote/paint composition, live updates. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).overlay = api;
  if (typeof document !== 'undefined' && document.getElementById && !root.TCO_NO_AUTOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.boot(); });
    else api.boot();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var DEFAULT_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot',
    'soundalerts', 'sery_bot', 'kofistreambot', 'botrixoficial', 'blerp', 'pokemoncommunitygame'];
  var NOTICE_TYPES = { sub: 1, resub: 1, subgift: 1, submysterygift: 1, giftpaidupgrade: 1,
    anongiftpaidupgrade: 1, raid: 1, bitsbadgetier: 1 };

  var T; // root.TCO, resolved at boot
  var S = null;

  function el(id) { return document.getElementById(id); }

  // ---------- status / hints ----------
  // Sticky hints (suspended channel, broken settings.js) are not cleared by later joins.
  function showHint(text, withLink, sticky) {
    var h = el('hint');
    if (!h) return;
    if (S) S.hintSticky = !!sticky;
    h.textContent = '';
    var p = document.createElement('div');
    p.textContent = text;
    h.appendChild(p);
    // Inside the builder's preview iframe the builder is already open, so skip the link there.
    if (withLink && root.parent === root) {
      var a = document.createElement('a');
      a.href = 'index.html' + (S && S.cfg.channel ? '?channel=' + encodeURIComponent(S.cfg.channel) : '');
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open the overlay builder';
      h.appendChild(a);
    }
    h.hidden = false;
  }
  function hideHint() {
    if (S && S.hintSticky) return;
    var h = el('hint');
    if (h) h.hidden = true;
  }

  function settingsError() {
    var errs = root.__tcoErrors || [];
    for (var i = 0; i < errs.length; i++) {
      if (/settings\.js/i.test(errs[i].file || '')) {
        var msg = errs[i].msg || '';
        // file:// pages get the muted "Script error." message
        return !msg || /^script error\.?$/i.test(msg) ? 'syntax error (see the browser console)' : msg;
      }
    }
    return null;
  }

  // ---------- fonts ----------
  var loadedFonts = {};
  function applyFont(name) {
    // Google Fonts family names are case-sensitive in the request URL.
    if (name && T.config.canonicalFont) name = T.config.canonicalFont(name);
    if (!name || T.config.isSystemFont(name) || loadedFonts[name]) return;
    loadedFonts[name] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') +
      ':wght@400;600;700;800&display=swap';
    document.head.appendChild(link);
  }

  // ---------- loading helpers ----------
  // Starts a retrying load; returns a promise that settles on the first success or failure.
  // Idempotent per name: a loader that already exists is not started again.
  function track(name, fn, onDone, tier1) {
    if (S.loads.has(name)) return Promise.resolve();
    var settle;
    var p = new Promise(function (r) { settle = r; });
    var ctl = T.util.loadWithRetry(name, function () {
      return Promise.resolve().then(fn).catch(function (e) { settle(); throw e; });
    }, function (res) {
      try { onDone(res); } catch (e) { T.util.warn('apply failed:', name, e); }
      settle();
    });
    S.loads.set(name, ctl);
    if (tier1) {
      S.tier1.push(p);
      p.then(checkHold);
    }
    return p;
  }

  function changed(e) { S.bus.emit('changed', e); }

  // ---------- rerender coalescing ----------
  var pendingPreds = [];
  var rerenderTimer = null;
  function scheduleRerender(pred) {
    pendingPreds.push(pred);
    if (rerenderTimer) return;
    rerenderTimer = setTimeout(function () {
      rerenderTimer = null;
      var preds = pendingPreds;
      pendingPreds = [];
      var all = preds.indexOf(true) >= 0;
      S.renderer.rerender(function (m) {
        if (all) return true;
        for (var i = 0; i < preds.length; i++) if (preds[i](m)) return true;
        return false;
      });
    }, 120);
  }

  function roomIdOf(m) { return m.mirrored ? m.sourceRoomId : (S.homeId || m.roomId); }

  function onChanged(e) {
    if (!e) return;
    if (e.all) return scheduleRerender(true);
    if (e.roomId) return scheduleRerender(function (m) { return roomIdOf(m) === e.roomId; });
    if (e.userId) return scheduleRerender(function (m) { return m.userId === e.userId; });
    if (e.setId) return scheduleRerender(function (m) { return effective(m.userId).sets.indexOf(e.setId) >= 0; });
  }

  // ---------- composition ----------
  function effective(userId) {
    if (S.demo) {
      var d = S.demo.effective(userId);
      if (d) return d;
    }
    return S.stv.effective(userId);
  }

  function roomFor(m) {
    if (m.mirrored) return S.rooms.get(m.sourceRoomId);
    return S.rooms.home();
  }

  function makeLookup(room, userId) {
    var cfg = S.cfg;
    var maps = [];
    if (cfg.emotes_7tv) {
      var personal = S.stv.userEmoteMaps(userId);
      for (var i = 0; i < personal.length; i++) maps.push(personal[i]);
    }
    if (cfg.emotes_bttv) {
      var bu = S.bttvUsers.peek(userId);
      if (bu && bu.emotes) maps.push(bu.emotes);
    }
    if (room) {
      if (cfg.emotes_7tv) maps.push(room.stv.emotes);
      if (cfg.emotes_bttv) maps.push(room.bttv.emotes);
      if (cfg.emotes_ffz) maps.push(room.ffz.emotes);
    }
    if (cfg.emotes_7tv) maps.push(S.stvGlobal);
    if (cfg.emotes_bttv) maps.push(S.bttvGlobal);
    if (cfg.emotes_ffz) maps.push(S.ffzGlobal);
    return function (word) {
      for (var j = 0; j < maps.length; j++) {
        var e = maps[j].get(word);
        if (e) return e;
      }
      return null;
    };
  }

  function tokensFor(m) {
    var room = roomFor(m);
    var r = T.tokenizer.tokenize(m, {
      lookup: makeLookup(room, m.userId),
      bttvPrefixes: S.cfg.emotes_bttv ? S.bttvPrefixes : null,
      gifs: S.cfg.gifs
    });
    var items = r.items;
    if (S.cfg.replies && m.reply) items = T.tokenizer.stripReplyPrefix(items, m.reply);
    return items;
  }

  function ffzBadge(id, bgOverride) {
    var d = S.ffzBadges.defs.get(String(id));
    if (!d || !d.urls) return null;
    return { provider: 'ffz', title: d.title, urls: d.urls, bg: bgOverride || d.color || undefined, replaces: d.replaces || null, id: d.id };
  }

  function pushAll(out, list) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
  }

  function badgesFor(m) {
    var cfg = S.cfg;
    var out = [];
    var uid = m.userId;
    var room = roomFor(m);
    // The Shared Chat source avatar marks where a message came from, so it shows even with badges off.
    if (m.mirrored && room && room.logo) {
      out.push({ provider: 'avatar', title: room.displayName || room.login || 'Shared chat', urls: { 1: room.logo, 2: room.logo, 4: room.logo } });
    }
    if (!cfg.badges) return out;

    // FFZ badges for this user: global list plus the room's user_badge_ids.
    // A Bot badge (replaces:'moderator') takes the Twitch moderator badge's place.
    var ffzIds = [];
    if (cfg.badges_ffz && uid) {
      ffzIds = (S.ffzBadges.users.get(uid) || []).slice();
      var roomIds = room && room.ffz.userBadges ? (room.ffz.userBadges.get(uid) || []) : [];
      for (var q = 0; q < roomIds.length; q++) if (ffzIds.indexOf(roomIds[q]) < 0) ffzIds.push(roomIds[q]);
    }
    var ffzReplacer = null;
    for (var f = 0; f < ffzIds.length; f++) {
      var fb = ffzBadge(ffzIds[f]);
      if (fb && fb.replaces === 'moderator') { ffzReplacer = fb; break; }
    }
    var usedReplacer = false;

    if (cfg.badges_twitch) {
      var tagBadges = m.mirrored ? m.sourceBadges : m.badges;
      var channelSets = room ? room.twitchBadges : null;
      var ffzRoom = cfg.badges_ffz && room ? room.ffz : null;
      for (var i = 0; i < tagBadges.length; i++) {
        var b = tagBadges[i];
        if (b.set === 'moderator') {
          if (ffzReplacer) { out.push(ffzReplacer); usedReplacer = true; continue; }
          if (ffzRoom && ffzRoom.modUrls) { out.push({ provider: 'ffz', title: 'Moderator', urls: ffzRoom.modUrls, bg: '#34AE0A' }); continue; }
        }
        if (b.set === 'vip' && ffzRoom && ffzRoom.vipUrls) {
          out.push({ provider: 'ffz', title: 'VIP', urls: ffzRoom.vipUrls });
          continue;
        }
        var r = T.badgeResolve.resolve(b.set, b.version, channelSets, S.twitchGlobal);
        if (r) out.push({ provider: 'twitch', title: r.title, urls: r.urls });
      }
    }
    if (!uid) return out;

    if (S.demo) {
      pushAll(out, S.demo.extraBadges(uid).filter(function (b) { return b && cfg['badges_' + b.provider] !== false; }));
    }
    if (cfg.badges_chatterino) pushAll(out, S.chatterino.get(uid));
    for (var g = 0; g < ffzIds.length; g++) {
      var gb = ffzBadge(ffzIds[g]);
      if (!gb || (usedReplacer && gb.id === ffzReplacer.id)) continue;
      out.push(gb);
    }
    if (cfg.badges_ffzap) pushAll(out, S.ffzap.get(uid));
    if (cfg.badges_bttv) {
      pushAll(out, S.bttvStaff.get(uid));
      var bu = S.bttvUsers.peek(uid);
      if (bu && bu.badge) out.push(bu.badge);
    }
    if (cfg.badges_7tv) {
      var eff = effective(uid);
      var sb = eff.badge ? S.stv.badges.get(eff.badge) : null;
      if (sb) out.push(sb);
    }
    if (cfg.badges_homies) pushAll(out, S.homies.get(uid));
    return out;
  }

  function nameFor(m) {
    var color = m.color || T.util.defaultColor(m.userId, m.login);
    if (S.cfg.readable) color = T.util.readableColor(color);
    var paintId = null;
    if (S.cfg.paints && m.userId) {
      var eff = effective(m.userId);
      if (eff.paint && S.stv.paints.has(eff.paint)) paintId = eff.paint;
    }
    return { text: m.displayName || m.login || '', color: color, paintId: paintId };
  }

  function paintRule(id) {
    var p = S.stv.paints.get(id);
    return p ? T.paintCss.ruleFor(p) : null;
  }

  function shouldShow(m) {
    var cfg = S.cfg;
    var login = m.login || '';
    if (login && cfg.block.indexOf(login) >= 0) return false;
    if (!cfg.bots && login) {
      if (DEFAULT_BOTS.indexOf(login) >= 0) return false;
      var home = S.rooms.home();
      if (home && home.bttv.bots.has(login)) return false;
    }
    if (cfg.hide_commands && m.kind === 'chat' && /^\s*!/.test(m.text || '')) return false;
    if (!cfg.events && (m.kind === 'notice' || m.announcement)) return false;
    if (m.mirrored && !cfg.shared) return false;
    return true;
  }

  // ---------- rooms ----------
  function fillMap(target, source) {
    target.clear();
    source.forEach(function (v, k) { target.set(k, v); });
  }

  // Loader parts for a room: [{name, fn, apply}]
  function roomParts(ctx, isHome) {
    var cfg = S.cfg;
    var parts = [];
    if (!isHome) {
      parts.push({ name: 'user', fn: function () { return T.twitchBadges.lookupUserById(ctx.id); }, apply: function (u) {
        if (u) { ctx.login = u.login || ctx.login; ctx.displayName = u.displayName || ctx.displayName; ctx.logo = u.logo || null; }
        ctx.loaded.user = true;
      } });
    }
    if (cfg.badges && cfg.badges_twitch) {
      parts.push({ name: 'twitch-channel-badges', fn: function () { return T.twitchBadges.loadChannel(ctx.id); }, apply: function (m) {
        ctx.twitchBadges = m || new Map();
        ctx.loaded.badges = true;
      } });
    }
    if (cfg.emotes_7tv) {
      parts.push({ name: '7tv-channel', fn: function () { return T.seventv.loadChannel(ctx.id); }, apply: function (r) {
        ctx.loaded.stv = true;
        if (!r) return;
        fillMap(ctx.stv.emotes, r.emotes);
        ctx.stv.setId = r.setId || null;
        ctx.stv.ownerId = r.ownerId || null;
        if (isHome) {
          S.stv.registerChannelSet(ctx.id, ctx.stv.setId, ctx.stv.emotes, ctx.stv.ownerId);
          if (S.stvEvents) {
            if (ctx.stv.setId) S.stvEvents.addObject('emote_set.update', ctx.stv.setId);
            if (ctx.stv.ownerId) S.stvEvents.addObject('user.update', ctx.stv.ownerId);
          }
        }
      } });
    }
    // The home channel's BTTV data is also its bot list (used by bots=0), so load it even with BTTV emotes off.
    if (cfg.emotes_bttv || isHome) {
      parts.push({ name: 'bttv-channel', fn: function () { return T.bttv.loadChannel(ctx.id); }, apply: function (r) {
        ctx.loaded.bttv = true;
        if (!r) return;
        ctx.bttv.bots = r.bots || new Set();
        if (S.cfg.emotes_bttv) fillMap(ctx.bttv.emotes, r.emotes);
      } });
    }
    if (cfg.emotes_ffz || (cfg.badges && cfg.badges_ffz)) {
      parts.push({ name: 'ffz-room', fn: function () { return T.ffz.loadRoom(ctx.id); }, apply: function (r) {
        ctx.loaded.ffz = true;
        if (!r) return;
        fillMap(ctx.ffz.emotes, r.emotes);
        ctx.ffz.modUrls = r.modUrls || null;
        ctx.ffz.vipUrls = r.vipUrls || null;
        ctx.ffz.userBadges = r.userBadges || new Map();
      } });
    }
    return parts;
  }

  function loadSourceRoom(ctx) {
    var parts = roomParts(ctx, false);
    return Promise.all(parts.map(function (p) {
      return Promise.resolve().then(p.fn).then(function (res) { p.apply(res); return true; }, function (e) {
        T.util.warn('shared-chat room', ctx.id, p.name, 'failed:', e && e.message);
        return false;
      });
    })).then(function (ok) {
      if (ok.indexOf(true) < 0) throw new Error('room ' + ctx.id + ' failed to load');
      changed({ roomId: ctx.id });
      return ctx;
    });
  }

  function ensureSourceRoom(id) {
    if (!id || id === S.homeId) return;
    S.rooms.touch(id);
    if (S.rooms.get(id)) return;
    S.rooms.ensure(id);
  }

  function onRoomId(id, user) {
    id = T.util.idStr(id);
    if (!/^\d+$/.test(id)) return;
    if (S.homeId) {
      if (S.homeId === id && user) {
        var h = S.rooms.home();
        if (h) { h.logo = user.logo || h.logo; h.displayName = user.displayName || h.displayName; }
      }
      return;
    }
    S.homeId = id;
    var ctx = S.rooms.setHome(id, S.cfg.channel);
    if (user) { ctx.logo = user.logo || null; ctx.displayName = user.displayName || ''; }
    hideHint();
    var parts = roomParts(ctx, true);
    parts.forEach(function (p) {
      track(p.name, p.fn, function (res) { p.apply(res); changed({ roomId: id }); }, true);
    });
    S.homeRegistered = true;
    checkHold();
    if (!S.cfg.demo) startLive(id);
  }

  // Refetch channel emote data that live sockets may have missed while disconnected.
  function reloadHome(names) {
    var ctx = S.rooms.home();
    if (!ctx) return;
    roomParts(ctx, true).forEach(function (p) {
      if (names.indexOf(p.name) < 0) return;
      Promise.resolve().then(p.fn).then(function (res) { p.apply(res); changed({ roomId: ctx.id }); }, function () {});
    });
  }
  function reloadHomeVolatile() { reloadHome(['7tv-channel', 'bttv-channel', 'ffz-room']); }

  // ---------- live sockets ----------
  function startLive(roomId) {
    var cfg = S.cfg;
    if (!S.stvEvents && (cfg.emotes_7tv || cfg.paints || (cfg.badges && cfg.badges_7tv))) {
      var hellos = 0;
      S.stvEvents = T.seventv.createEventClient({
        state: S.stv,
        // 7TV has no resume: after a reconnect, refetch the channel set in case updates were missed.
        onReady: function () { if (++hellos > 1 && S.cfg.emotes_7tv) reloadHome(['7tv-channel']); }
      });
      S.stvEvents.addChannel(roomId);
      var home = S.rooms.home();
      if (home && home.stv.setId) S.stvEvents.addObject('emote_set.update', home.stv.setId);
      if (home && home.stv.ownerId) S.stvEvents.addObject('user.update', home.stv.ownerId);
      S.stvEvents.start();
    }
    if (!S.bttvLive && (cfg.emotes_bttv || (cfg.badges && cfg.badges_bttv))) {
      S.bttvLive = T.bttv.createLive({
        roomId: roomId,
        onEmoteAdd: function (e) {
          var h = S.rooms.home();
          if (!h || !e) return;
          T.bttv.upsertEmote(h.bttv.emotes, e);
          changed({ roomId: roomId });
        },
        onEmoteUpdate: function (e) {
          var h = S.rooms.home();
          if (!h || !e) return;
          T.bttv.upsertEmote(h.bttv.emotes, e); // an update can rename the code
          changed({ roomId: roomId });
        },
        onEmoteRemove: function (emoteId) {
          var h = S.rooms.home();
          if (!h) return;
          T.bttv.removeEmoteById(h.bttv.emotes, emoteId);
          changed({ roomId: roomId });
        },
        onUser: function (userId, data) {
          userId = T.util.idStr(userId);
          if (!userId || !data) return;
          S.bttvUsers.set(userId, { badge: data.badge || null, emotes: data.emotes || new Map() });
          changed({ userId: userId });
        }
      });
      S.bttvLive.start();
    }
  }

  function onSetSwitch(roomId, newSetId) {
    // Only the home channel's set is subscribed, so fall back to it when the id isn't a known room.
    var ctx = (roomId && S.rooms.get(roomId)) || S.rooms.home();
    if (!ctx || !T.seventv.isUlid(newSetId)) return;
    ctx.stv.wantSet = newSetId;
    var prev = S.loads.get('7tv-set-switch');
    if (prev) { prev.cancel(); S.loads.delete('7tv-set-switch'); }
    track('7tv-set-switch', function () { return T.seventv.loadSet(newSetId); }, function (m) {
      if (ctx.stv.wantSet !== newSetId) return; // superseded by a later switch
      fillMap(ctx.stv.emotes, m || new Map());
      ctx.stv.setId = newSetId;
      S.stv.registerChannelSet(ctx.id, newSetId, ctx.stv.emotes, ctx.stv.ownerId);
      if (S.stvEvents) S.stvEvents.addObject('emote_set.update', newSetId);
      changed({ roomId: ctx.id });
    });
  }

  // ---------- chat handling ----------
  function noteUser(m) {
    if (!m.userId || S.cfg.demo) return;
    S.recentUsers.set(m.userId, T.util.now());
    if (S.stvLookup && S.cfg.stv_lookup && (S.cfg.paints || (S.cfg.badges && S.cfg.badges_7tv))) S.stvLookup.want(m.userId);
  }

  function deliver(m) {
    if (S.historyPending && !m.historical) {
      S.liveBuffer.push(m);
      return;
    }
    if (m.mirrored) {
      if (!S.cfg.shared) return;
      ensureSourceRoom(m.sourceRoomId);
    }
    noteUser(m);
    S.renderer.push(m);
  }

  function handlePrivmsg(p) {
    var m = T.ircParse.toChatMessage(p);
    if (!m.roomId && S.homeId) m.roomId = S.homeId;
    if (m.msgId === 'highlighted-message') m.highlight = true;
    deliver(m);
  }

  function handleUsernotice(p) {
    var n = T.ircParse.toNoticeMessage(p);
    if (n.historical) return;
    if (!n.roomId && S.homeId) n.roomId = S.homeId;
    if (n.mirrored && n.type !== 'announcement') return;
    if (n.type === 'announcement') {
      n.kind = 'chat';
      n.announcement = n.announceColor || 'PRIMARY';
      return deliver(n);
    }
    if (n.type === 'submysterygift' && n.communityGiftId) S.giftIds.set(n.communityGiftId, true);
    if (n.type === 'subgift' && n.communityGiftId && S.giftIds.has(n.communityGiftId)) return;
    if (S.cfg.events && NOTICE_TYPES[n.type]) return deliver(n);
    // Not shown as a notice: still show the user's own attached message as chat.
    if (n.text) {
      n.kind = 'chat';
      deliver(n);
    }
  }

  function handleClearchat(p) {
    // While history loads, live messages are buffered: queue the clear in order with them.
    if (S.historyPending && !p.tags.historical) {
      S.liveBuffer.push({ __clear: p });
      return;
    }
    var target = p.tags['target-user-id'];
    if (target) S.renderer.clearUser(target);
    else if (!p.params[1]) S.renderer.clearAll();
  }

  function onLine(p) {
    if (!p) return;
    switch (p.command) {
      case 'PRIVMSG': return handlePrivmsg(p);
      case 'USERNOTICE': return handleUsernotice(p);
      case 'CLEARCHAT': return handleClearchat(p);
      case 'CLEARMSG': return S.renderer.clearMessage(p.tags['target-msg-id']);
      case 'ROOMSTATE':
        if (p.tags['room-id']) onRoomId(p.tags['room-id']);
        return;
      case 'NOTICE':
        if (p.tags['msg-id'] === 'msg_channel_suspended' && !p.tags.historical) {
          showHint('Channel "' + S.cfg.channel + '" does not exist or is suspended.', true, true);
        }
        return;
    }
  }

  function onIrcStatus(status, detail) {
    S.ircStatus = status;
    if (status === 'joined') {
      if (detail && detail.tags && detail.tags['room-id']) onRoomId(detail.tags['room-id']);
      if (S.closedAt && T.util.now() - S.closedAt > 30000) {
        reloadHomeVolatile();
        S.loads.forEach(function (ctl) { if (ctl.status === 'failed') ctl.retryNow(); });
      }
      S.closedAt = 0;
      S.joined = true;
      hideHint();
    } else if (status === 'closed') {
      if (!S.closedAt) S.closedAt = T.util.now();
    }
  }

  function startHistory() {
    var cfg = S.cfg;
    if (!cfg.history || !cfg.channel || cfg.demo) return;
    S.historyPending = true;
    var done = false;
    function finish(lines) {
      if (done) return;
      done = true;
      S.historyPending = false;
      (lines || []).forEach(function (p) {
        // History comes from a third-party service: only replay chat and moderation lines.
        if (!p || (p.command !== 'PRIVMSG' && p.command !== 'CLEARCHAT' && p.command !== 'CLEARMSG')) return;
        p.tags = p.tags || {};
        if (p.tags['rm-deleted'] !== undefined) return; // already moderated
        p.tags.historical = '1';
        // Skip lines that also arrived live while history was loading (the live copy is buffered).
        if (p.command === 'PRIVMSG' && p.tags.id && S.irc && S.irc.markSeen(p.tags.id)) return;
        onLine(p);
      });
      var buf = S.liveBuffer;
      S.liveBuffer = [];
      buf.forEach(function (m) {
        if (m.__clear) handleClearchat(m.__clear);
        else deliver(m);
      });
    }
    setTimeout(function () { finish([]); }, 4000);
    T.irc.loadHistory(cfg.channel, cfg.history).then(finish, function (e) {
      T.util.warn('history load failed', e && e.message);
      finish([]);
    });
  }

  // ---------- startup hold ----------
  function checkHold() {
    if (!S.holding) return;
    if (S.cfg.channel && !S.homeRegistered) return;
    Promise.all(S.tier1.slice()).then(function () {
      if (S.tier1.length && S.holding) releaseHold();
    });
  }
  function releaseHold() {
    if (!S.holding) return;
    S.holding = false;
    S.renderer.hold(false);
  }

  // ---------- tiers ----------
  function startTier1() {
    var cfg = S.cfg;
    if (cfg.badges && cfg.badges_twitch) {
      track('twitch-global-badges', T.twitchBadges.loadGlobal, function (m) { S.twitchGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.emotes_7tv) {
      track('7tv-global', T.seventv.loadGlobal, function (m) { S.stvGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.emotes_bttv) {
      track('bttv-global', T.bttv.loadGlobal, function (r) {
        S.bttvGlobal = r.emotes;
        S.bttvPrefixes = r.prefixes;
        changed({ all: true });
      }, true);
    }
    if (cfg.emotes_ffz) {
      track('ffz-global', T.ffz.loadGlobal, function (m) { S.ffzGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.channel) {
      track('channel-user', function () { return T.twitchBadges.lookupUser(cfg.channel); }, function (u) {
        if (!u) {
          S.userMissing = true;
          setTimeout(function () {
            if (!S.homeId) showHint('Channel "' + cfg.channel + '" was not found. Check the name in your overlay URL or settings.js.', true);
          }, 10000);
          return;
        }
        if (u.banned) {
          showHint('Channel "' + cfg.channel + '" is suspended, so its chat is unavailable.', true, true);
          return;
        }
        onRoomId(u.id, u);
      }, false);
    }
  }

  function startTier2() {
    var cfg = S.cfg;
    if (cfg.paints || (cfg.badges && cfg.badges_7tv) || cfg.demo) {
      track('7tv-catalog', T.seventv.loadCatalog, function (c) {
        S.stv.mergeCatalog(c);
        if (S.demo) S.demo.onCatalog();
      });
    }
    if (!cfg.badges) return;
    if (cfg.badges_ffz) {
      track('ffz-badges', T.ffz.loadBadges, function (r) { S.ffzBadges = r; changed({ all: true }); });
    }
    if (cfg.badges_bttv) {
      track('bttv-badges', T.bttv.loadStaffBadges, function (m) { S.bttvStaff = m; changed({ all: true }); });
    }
    if (cfg.badges_chatterino) {
      track('chatterino-badges', T.extraBadges.loadChatterino, function (m) { S.chatterino = m; changed({ all: true }); });
    }
    if (cfg.badges_ffzap) {
      track('ffzap-badges', T.extraBadges.loadFfzap, function (m) { S.ffzap = m; changed({ all: true }); });
    }
  }

  function startTier3() {
    var cfg = S.cfg;
    if (cfg.badges && cfg.badges_homies) {
      track('homies-badges', T.extraBadges.loadHomies, function (m) { S.homies = m; changed({ all: true }); });
    }
  }

  // ---------- debug ----------
  function renderDebug() {
    var d = el('debug');
    if (!d) return;
    d.hidden = false;
    var parts = ['irc:' + (S.cfg.demo ? 'demo' : S.ircStatus)];
    S.loads.forEach(function (ctl, name) { parts.push(name + ':' + ctl.status); });
    var home = S.rooms.home();
    parts.push('emotes 7tv ' + S.stvGlobal.size + '/' + (home ? home.stv.emotes.size : 0) +
      ' bttv ' + S.bttvGlobal.size + '/' + (home ? home.bttv.emotes.size : 0) +
      ' ffz ' + S.ffzGlobal.size + '/' + (home ? home.ffz.emotes.size : 0));
    parts.push('paints ' + S.stv.paints.size + ' 7tvUsers ' + S.stv.userCos.size + ' gql ' + S.stv.gqlStyle.size);
    var st = S.renderer.stats ? S.renderer.stats() : null;
    if (st) parts.push('lines ' + st.lines + ' queued ' + st.queued);
    d.textContent = parts.join(' | ');
  }

  // ---------- builder live config ----------
  function onMessage(e) {
    if (!root.parent || root.parent === root || e.source !== root.parent) return;
    var d = e.data;
    if (!d || d.type !== 'tco-config' || !d.cfg || typeof d.cfg !== 'object') return;
    var next = {};
    for (var k in S.cfg) next[k] = S.cfg[k];
    var keys = T.config.LIVE_KEYS;
    for (var i = 0; i < keys.length; i++) {
      var v = T.config.coerce(keys[i], d.cfg[keys[i]]);
      if (v !== undefined) next[keys[i]] = v;
    }
    var prev = S.cfg;
    S.cfg = next;
    applyFont(next.font);
    S.renderer.setConfig(next);
    // Data for badge providers / paints that were off at boot was never loaded: load it now.
    var turnedOn = ['badges', 'paints'].concat(keys.filter(function (k) { return k.indexOf('badges_') === 0; }))
      .some(function (k) { return next[k] && !prev[k]; });
    if (turnedOn) ensureLoaders();
  }

  function ensureLoaders() {
    startTier1();
    startTier2();
    startTier3();
    var home = S.rooms.home();
    if (home) {
      roomParts(home, true).forEach(function (p) {
        track(p.name, p.fn, function (res) { p.apply(res); changed({ roomId: home.id }); });
      });
      if (!S.cfg.demo) startLive(home.id);
    }
  }

  // ---------- boot ----------
  function boot() {
    if (S) return;
    T = root.TCO;
    var cfg = T.config.parse(root.location ? root.location.search : '', root.TCO_SETTINGS);
    T.util.setDebug(cfg.debug);
    var chatEl = el('chat');

    S = {
      cfg: cfg,
      bus: new T.util.Emitter(),
      loads: new Map(),
      tier1: [],
      holding: true,
      homeId: null,
      homeRegistered: false,
      joined: false,
      ircStatus: 'idle',
      closedAt: 0,
      twitchGlobal: new Map(),
      stvGlobal: new Map(),
      bttvGlobal: new Map(),
      bttvPrefixes: new Set(),
      ffzGlobal: new Map(),
      ffzBadges: { defs: new Map(), users: new Map() },
      chatterino: new Map(),
      ffzap: new Map(),
      bttvStaff: new Map(),
      homies: new Map(),
      bttvUsers: new T.util.LRU(5000),
      recentUsers: new T.util.LRU(500),
      giftIds: new T.util.LRU(200),
      historyPending: false,
      liveBuffer: [],
      demo: null
    };
    S.bus.on('changed', onChanged);
    S.stv = T.seventv.createState({ bus: S.bus, onSetSwitch: onSetSwitch });
    S.rooms = T.rooms.createRooms({ load: loadSourceRoom });

    S.renderer = T.renderer.createRenderer({
      root: chatEl,
      cfg: cfg,
      deps: { tokensFor: tokensFor, badgesFor: badgesFor, nameFor: nameFor, paintRule: paintRule, shouldShow: shouldShow }
    });
    S.renderer.hold(true);
    applyFont(cfg.font);

    var sErr = settingsError();
    if (sErr) showHint('settings.js has an error: ' + sErr, true, true);
    else if (!cfg.channel && !cfg.demo) {
      showHint('No channel set. Add ?channel=yourname to the overlay URL, or use the builder.', true);
      return;
    }

    if (root.addEventListener) root.addEventListener('message', onMessage);
    if (cfg.debug) setInterval(renderDebug, 2000);

    if (cfg.demo) {
      S.demo = T.demo.createDemo({
        getState: function () { return S; },
        feed: function (line) { onLine(T.ircParse.parseLine(line)); }
      });
    } else {
      S.stvLookup = T.seventv.createLookup({
        state: S.stv,
        isRelevant: function (uid) { return S.recentUsers.has(uid) || S.renderer.hasUser(uid); },
        onResult: function (uid) { changed({ userId: uid }); }
      });
    }

    startTier1();
    if (cfg.channel && !cfg.demo) {
      startHistory();
      S.irc = T.irc.createIrc({ channel: cfg.channel, onLine: onLine, onStatus: onIrcStatus });
      S.irc.start();
    }
    // Release the startup hold once tier-1 loads settle, or after 2.5 s at most.
    setTimeout(releaseHold, 2500);
    checkHold();

    var tier1All = Promise.all(S.tier1.slice());
    var t2started = false;
    function tier2() {
      if (t2started) return;
      t2started = true;
      startTier2();
      setTimeout(startTier3, 5000);
    }
    tier1All.then(tier2);
    setTimeout(tier2, 3000);

    if (S.demo) S.demo.start();

    root.addEventListener('online', function () {
      if (S.irc) S.irc.kick();
      if (S.stvEvents) S.stvEvents.kick();
      if (S.bttvLive) S.bttvLive.kick();
      S.loads.forEach(function (ctl) { if (ctl.status === 'failed') ctl.retryNow(); });
    });
    // (The renderer itself flushes on visibilitychange / obsSourceVisibleChanged.)
    setInterval(function () {
      var evicted = S.rooms.sweep() || [];
      evicted.forEach(function (id) { if (S.stv.forgetRoom) S.stv.forgetRoom(id); });
    }, 300000);
  }

  return {
    boot: boot,
    state: function () { return S; },
    DEFAULT_BOTS: DEFAULT_BOTS
  };
});
