/* Overlay bootstrap: config, staged loading, Twitch IRC and Kick chat handling, badge/emote/paint composition,
   live updates. */
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

  // Known bots by login (Twitch and Kick alike). Kick's own KickBot (timers, command answers) has no Bot badge: Kick gives
  // it its moderator and verified ones.
  var DEFAULT_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot',
    'soundalerts', 'sery_bot', 'kofistreambot', 'botrixoficial', 'botrix', 'kickbot', 'blerp', 'pokemoncommunitygame'];
  // The notices shown as notices, each with the switch under events that covers its type. Kick's sub, gift and host
  // notices use the same names (a Kick host arrives as a raid). A Prime sub upgraded to a paid one is a sub; a gift paid
  // forward to one viewer or to the community is a gift (Twitch sends the gift's own notice as well).
  var NOTICE_TYPES = { sub: 'event_subs', resub: 'event_subs', subgift: 'event_gifts', submysterygift: 'event_gifts',
    giftpaidupgrade: 'event_subs', anongiftpaidupgrade: 'event_subs', primepaidupgrade: 'event_subs',
    standardpayforward: 'event_gifts', communitypayforward: 'event_gifts', raid: 'event_raids', bitsbadgetier: 'event_bits_badge' };
  // role_filter: the roles (renderer.roleOf, the highest a chatter's badges give) each choice lets through. The
  // broadcaster always passes.
  var ROLE_PASS = { subs: { sub: 1, vip: 1, mod: 1, broadcaster: 1 }, vips: { vip: 1, mod: 1, broadcaster: 1 },
    mods: { mod: 1, broadcaster: 1 } };
  // How long live chat waits for the history backfill; the request is aborted at the same moment.
  var HISTORY_WAIT_MS = 4000;
  // History is third-party data: at most this many distinct Shared Chat rooms may be loaded because of it
  // (a real session has at most 6 channels).
  var MAX_HISTORY_ROOMS = 8;
  // A Kick chatroom that can't be looked up (and has no kick_room) shows a hint after this long.
  var KICK_HINT_MS = 10000;
  var KICK_BADGE_TITLES = { broadcaster: 'Broadcaster', moderator: 'Moderator', vip: 'VIP', og: 'OG', founder: 'Founder',
    verified: 'Verified', staff: 'Kick Staff', subscriber: 'Subscriber', sub_gifter: 'Sub Gifter' };
  // A Shared Chat room part that failed is retried on the room's next message after this delay (doubling).
  var PART_RETRY_MS = 30000;
  var PART_RETRY_MAX_MS = 300000;
  // The Kick channel's own 7TV set is kept like a room's (S.kickCtx), under this key, which is no Twitch room id: its
  // live updates and set switches reach Kick lines as the home channel's reach Twitch lines.
  var KICK_STV = 'kick';

  var T; // root.TCO, resolved at boot
  var S = null;

  function el(id) { return document.getElementById(id); }

  // ---------- status / hints ----------
  // Each source of a hint keeps its own line in #hint (S.hints), drawn in this order, so one never takes another's place:
  // settings (a broken settings.js), names (a refused channel name), nochan (no channel set), twitchIrc (Twitch's own
  // "suspended" NOTICE), twitchLookup (the channel lookup found no channel, or a suspended one: third-party data, cleared
  // when IRC joins the room, and not shown beside Twitch's own NOTICE, which says the same), kick (the Kick lookup or
  // chat, cleared when Kick chat joins). The others stay up.
  var HINT_ORDER = ['settings', 'names', 'nochan', 'twitchIrc', 'twitchLookup', 'kick'];
  function setHint(key, text, withLink) {
    if (!S) return;
    S.hints[key] = { text: text, link: !!withLink };
    drawHints();
  }
  function clearHint(key) {
    if (!S || !S.hints[key]) return;
    delete S.hints[key];
    drawHints();
  }
  function drawHints() {
    var h = el('hint');
    if (!h) return;
    while (h.children && h.children.length) h.removeChild(h.children[0]);
    h.textContent = '';
    var any = false, link = false;
    for (var i = 0; i < HINT_ORDER.length; i++) {
      var e = S.hints[HINT_ORDER[i]];
      if (!e || (HINT_ORDER[i] === 'twitchLookup' && S.hints.twitchIrc)) continue;
      var p = document.createElement('div');
      p.textContent = e.text;
      h.appendChild(p);
      any = true;
      link = link || e.link;
    }
    // Once, after the lines. Inside the builder's preview iframe the builder is already open, so skip the link there.
    if (link && root.parent === root) {
      var a = document.createElement('a');
      a.href = 'builder.html' + builderQuery();
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open the overlay builder';
      h.appendChild(a);
    }
    h.hidden = !any;
  }
  function builderQuery() {
    if (!S) return '';
    var q = [];
    if (S.cfg.channel) q.push('channel=' + encodeURIComponent(S.cfg.channel));
    if (S.cfg.kick) q.push('kick=' + encodeURIComponent(S.cfg.kick));
    return q.length ? '?' + q.join('&') : '';
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
  // The weights a font is requested in (config.fontWeights, which the builder's font check asks for too).
  function fontWeights(cfg) { return T.config.fontWeights(cfg); }

  // name + ':' + weights -> true (asked for) or 'failed'. A failed one is asked for again on a backoff of its own while
  // the overlay draws with it (fontRetry), and at once with retry (a reconnect, the network back), but never at once on a
  // live change: the builder's preview gets every one, and a font Google Fonts doesn't host would be asked for, and
  // refused, on each.
  var loadedFonts = {};
  // A failed stylesheet's own retries, on the backoff every other load has (util.retryDelay: 3 s, 10 s, 30 s, 60 s, then
  // every 5 min): an OBS start before the network is up (no 'online' event when only DNS wasn't ready), an outage IRC
  // rides out in under 30 s, a Kick-only overlay or one refused request no longer leave the fallback font on for the
  // whole stream. key -> { timer, n: retries so far }; dropped once the font loads.
  var fontRetry = {};
  // Google Fonts family names are case-sensitive in the request URL.
  function fontName(name) { return name && T.config.canonicalFont ? T.config.canonicalFont(name) : name; }
  // Whether the overlay draws with this font (and these weights) now: applyFonts' fonts.
  function fontInUse(key) {
    var c = S && S.cfg;
    if (!c) return false;
    var w = ':' + fontWeights(c);
    return fontName(c.font) + w === key || (!!c.name_font && fontName(c.name_font) + w === key);
  }
  function retryFontLater(name, key) {
    var r = fontRetry[key] || (fontRetry[key] = { timer: null, n: 0 });
    if (r.timer) return;
    r.timer = setTimeout(function () {
      r.timer = null;
      // A live change may have moved on from it: it is asked for again once it is back in use (applyFont).
      if (loadedFonts[key] === 'failed' && fontInUse(key)) applyFont(name, S.cfg, true);
    }, T.util.retryDelay(r.n++));
  }
  function applyFont(name, cfg, retry) {
    name = fontName(name);
    var weights = fontWeights(cfg), key = name + ':' + weights;
    if (!name || T.config.isSystemFont(name) || loadedFonts[key] === true) return;
    if (loadedFonts[key] === 'failed' && !retry) { retryFontLater(name, key); return; }
    // Generic families (system-ui, serif, ...) are never Google Fonts: a request for one is a wasted 400.
    if (T.renderer.isGenericFont && T.renderer.isGenericFont(name)) return;
    var r = fontRetry[key];
    if (r && r.timer) { clearTimeout(r.timer); r.timer = null; }
    loadedFonts[key] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') +
      ':wght@' + weights + '&display=swap';
    link.onload = function () { delete fontRetry[key]; };
    // A failed request (offline start, or a family Google doesn't host) is marked and asked for again later.
    link.onerror = function () {
      if (link.parentNode) link.parentNode.removeChild(link);
      loadedFonts[key] = 'failed';
      retryFontLater(name, key);
    };
    document.head.appendChild(link);
  }
  // Every font the overlay draws with: font, and name_font only while it is set (one more request then). retry: ask
  // again for one that failed.
  function applyFonts(cfg, retry) {
    applyFont(cfg.font, cfg, retry);
    if (cfg.name_font) applyFont(cfg.name_font, cfg, retry);
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
    if (e.roomId === KICK_STV) return scheduleRerender(isKick);
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

  // ---------- platforms ----------
  function isKick(m) { return !!m && m.platform === 'kick'; }
  function notKick(m) { return !isKick(m); }
  // Twitch data (IRC, Twitch-keyed badges and BTTV/FFZ) is only needed with a Twitch channel (or the demo).
  function twitchOn() { return !!(S.cfg.channel || S.cfg.demo); }
  // Each line says where it came from once two platforms share the overlay.
  function showPlatforms() { return !!(S.cfg.platform_icons && S.cfg.kick && twitchOn()); }
  function platformIcon(m) {
    return isKick(m)
      ? { provider: 'platform', icon: 'kick', title: 'Kick' }
      : { provider: 'platform', icon: 'twitch', title: 'Twitch' };
  }

  function lookupIn(maps) {
    return function (word) {
      for (var j = 0; j < maps.length; j++) {
        var e = maps[j].get(word);
        if (e) return e;
      }
      return null;
    };
  }

  // Kick chatters have 7TV only: the Kick channel's own set when it is known, else the Twitch channel's
  // (a multistream usually has the same one), then 7TV global.
  function kickLookup() {
    var maps = [];
    if (S.cfg.emotes_7tv) {
      var home = S.rooms.home();
      if (S.kickStv.size) maps.push(S.kickStv); // S.kickCtx.stv.emotes
      else if (home) maps.push(home.stv.emotes);
      maps.push(S.stvGlobal);
    }
    return lookupIn(maps);
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
    return lookupIn(maps);
  }

  // links=shorten: the links in a message's text as their host names, on Kick and Twitch lines alike.
  function shortened(items) { return S.cfg.links === 'shorten' ? T.renderer.shortenItems(items) : items; }

  function tokensFor(m) {
    if (isKick(m)) {
      return shortened(T.tokenizer.tokenize(m, { lookup: kickLookup(), bttvPrefixes: null, gifs: false }).items);
    }
    var room = roomFor(m);
    var r = T.tokenizer.tokenize(m, {
      lookup: makeLookup(room, m.userId),
      bttvPrefixes: S.cfg.emotes_bttv ? S.bttvPrefixes : null,
      gifs: S.cfg.gifs,
      cheerMap: cheerMapFor(m)
    });
    var items = r.items;
    if (S.cfg.replies && m.reply) items = T.tokenizer.stripReplyPrefix(items, m.reply);
    return shortened(items);
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

  // A Kick subscriber badge: the channel's own image for that many months when the channel lookup gave the
  // images, else the built-in icon.
  function kickSubImage(months) {
    var list = S.kickSubBadges, url = null;
    for (var i = 0; i < list.length; i++) if (list[i].months <= months || !url) url = list[i].url;
    return url;
  }

  function kickBadgesFor(m, out) {
    var cfg = S.cfg;
    if (!cfg.badges || !cfg.badges_kick) return out;
    var list = m.kickBadges || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var title = KICK_BADGE_TITLES[b.type];
      if (!title) continue;
      if (b.type === 'subscriber') {
        if (b.count > 0) title += ' (' + b.count + (b.count === 1 ? ' month)' : ' months)');
        var img = kickSubImage(b.count);
        if (img) { out.push({ provider: 'kick', title: title, urls: { 1: img, 2: img, 4: img } }); continue; }
      }
      out.push({ provider: 'kick', icon: 'kick-' + b.type, title: title });
    }
    return out;
  }

  // The app's own badge images (img/logos/Badge.svg, Beta.svg): an absolute URL on the hosted https page, as always,
  // and the relative path anywhere else (a local folder on file:, OBS's "Local file" source on http://absolute/, a local
  // http server), which renderer.pickUrl allows for exactly these two files.
  function localBadge(path) {
    var loc = root.location;
    return loc && loc.protocol === 'https:' && loc.href ? new URL(path, loc.href).href : path;
  }

  function badgesFor(m) {
    var cfg = S.cfg;
    var out = [];
    // The platform icon comes first, and is all a notice line shows.
    if (showPlatforms()) out.push(platformIcon(m));
    if (m.kind === 'notice') return out;
    if (isKick(m)) return kickBadgesFor(m, out);
    var uid = m.userId;
    var room = roomFor(m);
    if (cfg.badges && m.kind === 'chat' && m.login === 'masstarvt') {
      var badgeUrl = localBadge('img/logos/Badge.svg');
      out.push({ provider: 'developer', title: 'MasstarVT developer', urls: { 1: badgeUrl, 2: badgeUrl, 4: badgeUrl } });
    }
    if (cfg.badges && m.kind === 'chat' && ['masstarvt', 'evanaxel', 'ray_xash', 'musicalfox30'].indexOf(m.login) >= 0) {
      var betaBadgeUrl = localBadge('img/logos/Beta.svg');
      out.push({ provider: 'beta-tester', title: 'Beta Tester', urls: { 1: betaBadgeUrl, 2: betaBadgeUrl, 4: betaBadgeUrl } });
    }
    // The Shared Chat source avatar marks where a message came from, so it shows even with badges off.
    // During a session Twitch tags every line with its source room, the home channel's own lines included.
    if (cfg.shared && m.sourceRoomId && room && room.logo) {
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

    // The channel's FFZ custom mod/VIP badges belong to the FFZ switch: they show even with Twitch badges off.
    var ffzRoom = cfg.badges_ffz && room ? room.ffz : null;
    if (cfg.badges_twitch || ffzReplacer || (ffzRoom && (ffzRoom.modUrls || ffzRoom.vipUrls))) {
      var tagBadges = (m.mirrored ? m.sourceBadges : m.badges) || [];
      var channelSets = room ? room.twitchBadges : null;
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
        if (!cfg.badges_twitch) continue;
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

  // A config color (bare rrggbb, which config.js checked) as '#rrggbb'; '' for anything else.
  function cfgColor(v) { return typeof v === 'string' && /^[0-9a-f]{6}$/.test(v) ? '#' + v : ''; }

  // The box behind the names (bg with its bg_color) when it is light (util.lightBackdrop), else null: readable then
  // darkens light names (util.readableColor), as it lightens dark ones over dark video.
  function nameBackdrop(cfg) {
    if (!(cfg.bg > 0) || !cfgColor(cfg.bg_color)) return null;
    var b = T.util.boxBackdrop(cfg.bg_color, cfg.bg / 100);
    return T.util.lightBackdrop(b) ? b : null;
  }

  // The name color: name_color for everyone, else the chatter's own (Twitch's palette for one without, or
  // name_fallback), made readable by readable (lightened over dark video, darkened on a light box). A color picked in
  // the settings is drawn as picked.
  function nameFor(m) {
    var cfg = S.cfg;
    var color = cfgColor(cfg.name_color) || (m.color ? '' : cfgColor(cfg.name_fallback));
    if (!color) {
      color = m.color || T.util.defaultColor(m.userId, m.login);
      if (cfg.readable) color = T.util.readableColor(color, cfg.readable_level / 10, nameBackdrop(cfg));
    }
    var paintId = null;
    if (S.cfg.paints && m.userId && !isKick(m)) {
      var eff = effective(m.userId);
      if (eff.paint && S.stv.paints.has(eff.paint)) paintId = eff.paint;
    }
    return { text: m.displayName || m.login || '', color: color, paintId: paintId };
  }

  // scale: the paint files for the name's drawn size (renderer.js paintScale), as paintCss.ruleFor takes it.
  function paintRule(id, scale) {
    var p = S.stv.paints.get(id);
    return p ? T.paintCss.ruleFor(p, scale) : null;
  }
  // paint_images=static: the paint's still frame (the renderer asks only then, for a paint it draws). A paint in 7TV's
  // older v3 format (when the v4 paint list failed, or one newer than the list) names one image and not whether it is
  // animated: the still frame beside it is asked for once, and the renderer gets undefined (ask again) meanwhile.
  function paintStaticRule(id, scale) {
    var p = S.stv.paints.get(id);
    if (!p) return null;
    var rule = T.paintCss.staticRuleFor(p, scale);
    return rule || probeStill(id, p);
  }
  var stillProbes = new Map(); // paint id -> 'pending' | 'none' (no still frame, or none to look for)
  function probeStill(id, p) {
    var st = stillProbes.get(id);
    if (st) return st === 'pending' ? undefined : null;
    var url = T.paintCss.v3StillUrl(p);
    if (!url || typeof root.Image !== 'function') return null;
    stillProbes.set(id, 'pending');
    var probe = new root.Image();
    probe.onload = function () {
      // A still paint has no such file (404): only one that loads is a still frame.
      var cur = S.stv.paints.get(id);
      if (cur && T.paintCss.setStill(cur, url)) {
        stillProbes.delete(id);
        if (S.renderer.stillReady) S.renderer.stillReady(id);
      } else {
        stillProbes.set(id, 'none');
      }
    };
    probe.onerror = function () { stillProbes.set(id, 'none'); };
    probe.src = url;
    return undefined;
  }

  // A reply's text without its leading "@Parent" (it is shown without it).
  function replyStripped(m, text) {
    if (!m.reply || text.charAt(0) !== '@') return text;
    var items = T.tokenizer.stripReplyPrefix([{ type: 'text', text: text, sp: false }], m.reply);
    return items.length && items[0].type === 'text' ? items[0].text : '';
  }
  // A chat line's text as it is drawn (tokensFor), for block_words: a Twitch reply without its leading "@Parent" while
  // replies are on (with replies=0 it is drawn, and matched); a Kick line as Kick sends it (a Kick reply's text doesn't
  // name the parent); with links=shorten, each link as the host it is drawn as. The renderer's keywords go by the same
  // rule (renderer.shownText).
  function shownText(m, cfg) {
    var t = m.text || '';
    return T.renderer.drawnText(cfg.replies && !isKick(m) ? replyStripped(m, t) : t, cfg);
  }

  // "!cmd", also when sent as a reply ("@Parent !cmd", shown without the "@Parent" prefix). command_prefixes: the
  // signs a command starts with ('!' by default).
  function isCommand(m) {
    return T.renderer.filtersFor(S.cfg).command.test(replyStripped(m, m.text || ''));
  }

  // Whether a notice type's own switch under events is on (each is on unless set to false, so a cfg without them
  // shows every type, as before they existed).
  function typeOn(cfg, type) {
    return !Object.prototype.hasOwnProperty.call(NOTICE_TYPES, type) || cfg[NOTICE_TYPES[type]] !== false;
  }

  // min_length counts the text as shown: without the /me wrapper and the duplicate-bypass suffix (tokenizer.cleanText)
  // and, where it isn't drawn, a reply's "@Parent" (by shownText's rule: a Twitch reply's while replies are on; with
  // replies=0 it is drawn and counted, and a Kick line counts as Kick sends it), in characters as they are seen
  // (Intl.Segmenter's graphemes, in Chromium 103 too: an emoji is one, with a skin tone or as a flag or family as well).
  // Emote codes count as their letters. Spaces and invisible (default-ignorable) characters at either end don't count:
  // Chatterino and 7TV send a repeated message with
  // ' U+E0000' after it, and a zero-width space or word joiner is drawn as nothing too. Only at the ends, so the joiner
  // inside an emoji sequence stays (and an emoji's own variation sign or tag characters are part of its grapheme anyway).
  // With links=shorten a link counts as the host it is drawn as.
  var EDGE_BLANK_RE = /^[\s\p{Default_Ignorable_Code_Point}]+|[\s\p{Default_Ignorable_Code_Point}]+$/gu;
  var graphemes;
  function textLength(m) {
    var raw = T.tokenizer.cleanText(m.text || '', m.action).text;
    var t = T.renderer.drawnText(S.cfg.replies && !isKick(m) ? replyStripped(m, raw) : raw, S.cfg).replace(EDGE_BLANK_RE, '');
    if (graphemes === undefined) {
      graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
    }
    return Array.from(graphemes ? graphemes.segment(t) : t).length;
  }

  // The filters for chat lines only (announcements, a resub's own text and notice text shown as chat too; notices go by
  // the event switches). Each is skipped at its default.
  function chatShown(m, cfg) {
    var pass = Object.prototype.hasOwnProperty.call(ROLE_PASS, cfg.role_filter) ? ROLE_PASS[cfg.role_filter] : null;
    if (pass && pass[T.renderer.roleOf(m)] !== 1) return false;
    var allow = cfg.allow_users;
    if (Array.isArray(allow) && allow.length && allow.indexOf(m.login || '') < 0) return false;
    if (cfg.block_words && cfg.block_words.length && T.renderer.hasWords(shownText(m, cfg), T.renderer.filtersFor(cfg).block)) return false;
    if (cfg.min_length > 0 && textLength(m) < cfg.min_length) return false;
    if (cfg.links === 'hide' && T.renderer.hasLink(m.text)) return false;
    return true;
  }

  function shouldShow(m) {
    var cfg = S.cfg;
    var login = m.login || '';
    if (login && cfg.block.indexOf(login) >= 0) return false;
    // A platform's own Bot badge marks a bot whatever its name.
    if (!cfg.bots && platformBot(m)) return false;
    // The channel's BTTV bot list names Twitch accounts: it doesn't cover Kick lines. A Shared Chat partner's own BTTV bot
    // list covers its mirrored lines.
    if (isHiddenBot(login, m)) return false;
    if (cfg.hide_commands && m.kind === 'chat' && isCommand(m)) return false;
    if (!cfg.events && (m.kind === 'notice' || m.announcement)) return false;
    // The switches under events: a notice by its type (on Twitch and Kick; a resub's own text line is chat, so it
    // stays), and an announcement as a whole message, as events=0 hides it.
    if (m.kind === 'notice' && !typeOn(cfg, m.type)) return false;
    if (m.announcement && cfg.event_announcements === false) return false;
    if (m.mirrored && !cfg.shared) return false;
    if (m.kind === 'chat' && !chatShown(m, cfg)) return false;
    return true;
  }

  // Whether bots=0 hides what this login says on the line m (a reply's parent: said where the reply is): a known bot, the
  // home channel's BTTV bots on a Twitch line, a Shared Chat partner's on its own lines.
  function isHiddenBot(login, m) {
    if (S.cfg.bots || !login) return false;
    if (DEFAULT_BOTS.indexOf(login) >= 0) return true;
    var home = S.rooms.home();
    if (home && home.bttv.bots.has(login) && !isKick(m)) return true;
    if (m && m.mirrored) {
      var src = S.rooms.get(m.sourceRoomId);
      if (src && src.bttv.bots.has(login)) return true;
    }
    return false;
  }

  // Whether a badge list (irc-parse's [{set, version}]) has a badge of this set.
  function hasBadgeSet(list, set) {
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].set === set) return true;
    return false;
  }
  // A line whose sender has its platform's own Bot badge: Kick's (kick.js), or Twitch's Chat Bot badge (bot-badge), which
  // the broadcaster gives an app bot added to the channel (a Shared Chat line carries its own channel's badges too).
  function platformBot(m) {
    if (isKick(m)) return m.kickBot === true;
    return hasBadgeSet(m.badges, 'bot-badge') || hasBadgeSet(m.sourceBadges, 'bot-badge');
  }

  // The chat lines the overlay was given, shown or not (deliver, and the history lines only noted), by id and by Shared
  // Chat source id (a reply on another channel may name either): a reply's header goes by its parent's own line when the
  // overlay has it (quotesHidden). And the senders seen with a platform's Bot badge, by user id: a reply's parent carries
  // no badges. Kick ids are 'kick:' ids, so they never meet Twitch's.
  function remember(m) {
    if (!m || m.kind !== 'chat') return;
    var id = T.util.idStr(m.id), sid = T.util.idStr(m.sourceId);
    if (id) S.said.set(id, m);
    if (sid && sid !== id) S.said.set(sid, m);
    var uid = T.util.idStr(m.userId);
    if (uid && platformBot(m)) S.botIds.set(uid, true);
    if (isKick(m) && id && m.ts > S.kickTs) S.kickTs = m.ts;
  }
  // A reply's parent as its own line came, when the overlay was given it.
  function saidParent(r) {
    var id = T.util.idStr(r.id);
    var p = id ? S.said.peek(id) : null;
    return p && typeof p === 'object' ? p : null;
  }

  // Whether bots=0 hides a reply's parent (r, quoted on the line m): by its own line when the overlay has it (its badges
  // and its channel), else by what the reply says of it: Kick's Bot badge in the reply's data (kick.js), a sender seen
  // with a platform's Bot badge, a known bot, or one on a BTTV bot list: the home channel's, or any Shared Chat partner's
  // loaded (a viewer's reply may quote a partner channel's line).
  function quotedBot(r, login, m, parent) {
    if (S.cfg.bots) return false;
    if (parent) return platformBot(parent) || isHiddenBot(parent.login || '', parent);
    var uid = T.util.idStr(r.userId);
    if (r.bot === true || (uid && S.botIds.has(uid))) return true;
    if (isHiddenBot(login, m)) return true;
    if (!login || isKick(m)) return false;
    var hit = false;
    S.rooms.forEach(function (ctx) { if (!hit && ctx.bttv.bots.has(login)) hit = true; });
    return hit;
  }

  // A reply's header would quote a blocked user (block), or a message the filters hide: a hidden bot's (bots=0), a command
  // (hide_commands), or one with a blocked word (block_words) or a link (links=hide). The reply shows without it. The
  // renderer asks as it draws the line (deps.quoteHidden, with the reply's message m), so a live change redraws the
  // headers, and the reply itself stays on the message: its "@Parent" is still left out of its text and of the filters.
  // reply_style=name quotes nothing, but still names the user, so a blocked one's header goes there too (a bot's or a
  // command's name-only header stays: it puts none of their text on stream). A parent the overlay was given is judged as
  // its own line was (shouldShow); one it wasn't, by the reply's data (parentHidden).
  function quotesHidden(r, m) {
    var cfg = S.cfg;
    var login = r && typeof r.login === 'string' ? r.login.toLowerCase() : '';
    if (login && Array.isArray(cfg.block) && cfg.block.indexOf(login) >= 0) return true;
    if (!r || typeof r.body !== 'string' || !r.body || cfg.reply_style === 'name') return false;
    var line = m && typeof m === 'object' ? m : null;
    var parent = saidParent(r);
    if (quotedBot(r, login, line, parent)) return true;
    var f = T.renderer.filtersFor(cfg);
    if (parent) {
      if (cfg.hide_commands && isCommand(parent)) return true;
      if (cfg.block_words && cfg.block_words.length && T.renderer.hasWords(shownText(parent, cfg), f.block)) return true;
      return cfg.links === 'hide' && T.renderer.hasLink(parent.text);
    }
    return parentHidden(r, line, cfg, f);
  }
  // A parent the overlay never had, by its text in the reply. A Twitch parent that was itself a reply starts with
  // "@Name", which its own line was judged without (isCommand; shownText while replies are on): it was one when the
  // thread it is in started with another message (reply-thread-parent-msg-id). Without that tag (an old or crafted
  // line), and on Kick (whose reply data doesn't say), it is tested both ways for a command, and as sent for the words.
  function parentHidden(r, m, cfg, f) {
    var body = r.body, rest = body.replace(/^@\S+\s+/, '');
    var thread = !isKick(m) && typeof r.threadId === 'string' && r.threadId !== '';
    var wasReply = thread && r.threadId !== r.id;
    if (cfg.hide_commands && (thread ? f.command.test(wasReply ? rest : body) : f.command.test(rest) || f.command.test(body))) return true;
    // The words as its own line was matched (shownText): without its "@Name" only where that wasn't drawn.
    var said = wasReply && cfg.replies ? rest : body;
    if (cfg.block_words && cfg.block_words.length && T.renderer.hasWords(T.renderer.drawnText(said, cfg), f.block)) return true;
    return cfg.links === 'hide' && T.renderer.hasLink(body);
  }

  // ---------- rooms ----------
  function fillMap(target, source) {
    target.clear();
    source.forEach(function (v, k) { target.set(k, v); });
  }

  // Loader parts for a room: [{name, fn, apply}]. fresh: bypass HTTP caches (reconnect refetches).
  function roomParts(ctx, isHome, fresh) {
    var cfg = S.cfg;
    var parts = [];
    if (!isHome) {
      parts.push({ name: 'user', fn: function () { return T.twitchBadges.lookupUserById(ctx.id); }, apply: function (u) {
        if (u) { ctx.login = u.login || ctx.login; ctx.displayName = u.displayName || ctx.displayName; ctx.logo = u.logo || null; }
      } });
    }
    if (cfg.badges && cfg.badges_twitch) {
      parts.push({ name: 'twitch-channel-badges', fn: function () { return T.twitchBadges.loadChannel(ctx.id); }, apply: function (m) {
        ctx.twitchBadges = m || new Map();
      } });
    }
    if (cfg.emotes_7tv) {
      parts.push({ name: '7tv-channel', fn: function () { return T.seventv.loadChannel(ctx.id); }, apply: function (r) {
        if (!r) return;
        var oldSetId = ctx.stv.setId;
        fillMap(ctx.stv.emotes, r.emotes);
        ctx.stv.setId = r.setId || null;
        ctx.stv.ownerId = r.ownerId || null;
        ctx.stv.connIndex = r.connIndex;
        if (isHome) {
          S.stv.registerChannelSet(ctx.id, ctx.stv.setId, ctx.stv.emotes, ctx.stv.ownerId, ctx.stv.connIndex);
          subscribeSet(ctx.stv, oldSetId);
        }
      } });
    }
    // A room's BTTV data is also its bot list (the home channel's, and a Shared Chat partner's for its own lines), so
    // bots=0 loads it even with BTTV emotes off.
    if (cfg.emotes_bttv || !cfg.bots) {
      parts.push({ name: 'bttv-channel', fn: function () { return T.bttv.loadChannel(ctx.id, fresh ? { fresh: true } : undefined); }, apply: function (r) {
        if (!r) return;
        ctx.bttv.bots = r.bots || new Set();
        if (S.cfg.emotes_bttv) fillMap(ctx.bttv.emotes, r.emotes);
        // Bot lines that arrived before the list did are dropped now (one pass over the lines on screen), and the reply
        // headers quoting them (on any channel's line) are drawn again without the quote.
        if (!S.cfg.bots && ctx.bttv.bots.size && S.renderer && S.renderer.refilter) {
          S.renderer.refilter();
          scheduleRerender(function (m) { return !!m.reply; });
        }
      } });
    }
    if (cfg.emotes_ffz || (cfg.badges && cfg.badges_ffz)) {
      parts.push({ name: 'ffz-room', fn: function () { return T.ffz.loadRoom(ctx.id); }, apply: function (r) {
        if (!r) return;
        fillMap(ctx.ffz.emotes, r.emotes);
        ctx.ffz.modUrls = r.modUrls || null;
        ctx.ffz.vipUrls = r.vipUrls || null;
        ctx.ffz.userBadges = r.userBadges || new Map();
      } });
    }
    return parts;
  }

  // Runs parts in parallel; each one applies (and rerenders the room) as soon as it lands.
  // Resolves with the names of the parts that failed. ctx.parts keeps each one's state: loading, ok, or (failed) none.
  function runParts(ctx, parts) {
    return Promise.all(parts.map(function (p) {
      ctx.parts[p.name] = 'loading';
      return Promise.resolve().then(p.fn).then(function (res) {
        // A throwing apply counts as that part failing (retried later), not as a rejected Promise.all.
        try { p.apply(res); } catch (e) {
          T.util.warn('shared-chat room', ctx.id, p.name, 'apply failed:', e && e.message);
          delete ctx.parts[p.name];
          return false;
        }
        ctx.parts[p.name] = 'ok';
        changed({ roomId: ctx.id });
        return true;
      }, function (e) {
        T.util.warn('shared-chat room', ctx.id, p.name, 'failed:', e && e.message);
        delete ctx.parts[p.name];
        return false;
      });
    })).then(function (ok) {
      var failed = [];
      for (var i = 0; i < ok.length; i++) if (!ok[i]) failed.push(parts[i].name);
      return failed;
    });
  }

  // Failed parts are retried lazily, on one of the room's later messages (no timers).
  function noteFailedParts(ctx, failed, delay) {
    ctx.retry = failed.length ? { names: failed, at: T.util.now() + delay, delay: delay, busy: false } : null;
  }

  function loadSourceRoom(ctx) {
    var parts = roomParts(ctx, false);
    return runParts(ctx, parts).then(function (failed) {
      if (failed.length >= parts.length) throw new Error('room ' + ctx.id + ' failed to load');
      noteFailedParts(ctx, failed, PART_RETRY_MS);
      return ctx;
    });
  }

  function retryParts(ctx) {
    var r = ctx.retry;
    r.busy = true;
    var parts = roomParts(ctx, false).filter(function (p) { return r.names.indexOf(p.name) >= 0; });
    runParts(ctx, parts).then(function (failed) {
      if (ctx.retry === r) noteFailedParts(ctx, failed, Math.min(r.delay * 2, PART_RETRY_MAX_MS));
    }, function () { r.busy = false; });
  }

  function ensureSourceRoom(id) {
    id = T.util.idStr(id);
    if (!id || id === S.homeId || !/^\d+$/.test(id)) return;
    S.rooms.touch(id);
    var ctx = S.rooms.get(id);
    if (ctx) {
      var r = ctx.retry;
      if (r && !r.busy && T.util.now() >= r.at) retryParts(ctx);
      return;
    }
    S.rooms.ensure(id);
  }

  // Mirrored line accepted by the renderer: load (or keep alive) its source room.
  function noteSourceRoom(m) {
    var id = T.util.idStr(m.sourceRoomId);
    if (!/^\d+$/.test(id) || id === S.homeId) return; // junk or home ids must not use up the history cap
    if (m.historical && !S.rooms.get(id) && !S.histRooms.has(id)) {
      if (S.histRooms.size >= MAX_HISTORY_ROOMS) return; // the line still shows, without the room's extras
      S.histRooms.add(id);
    }
    ensureSourceRoom(id);
  }

  function onRoomId(id, user) {
    id = T.util.idStr(id);
    if (!/^\d+$/.test(id)) return;
    if (S.homeId) {
      if (S.homeId === id && user) {
        var h = S.rooms.home();
        if (h) {
          var oldLogo = h.logo;
          h.logo = user.logo || h.logo;
          h.displayName = user.displayName || h.displayName;
          // Home lines already shown during Shared Chat get the avatar once it is known.
          if (h.logo !== oldLogo) changed({ roomId: id });
        }
      }
      return;
    }
    S.homeId = id;
    S.homeAt = T.util.now();
    var ctx = S.rooms.setHome(id, S.cfg.channel);
    if (user) { ctx.logo = user.logo || null; ctx.displayName = user.displayName || ''; }
    clearHint('twitchLookup');
    var parts = roomParts(ctx, true);
    parts.forEach(function (p) {
      var settled = track(p.name, p.fn, function (res) { p.apply(res); changed({ roomId: id }); }, true);
      if (p.name === 'bttv-channel') settled.then(S.homeBotsDone);
    });
    S.homeRegistered = true;
    checkHold();
    if (!S.cfg.demo) startLive(id);
  }

  // Refetch channel emote data that live sockets may have missed while disconnected. Each part is a tracked
  // load ('reload:<part>'), so a failure is logged, shown with debug=1 and retried with the usual backoff.
  // A reload already in flight is shared by later triggers.
  function reloadHome(names) {
    var ctx = S.rooms.home();
    if (!ctx) return;
    roomParts(ctx, true, true).forEach(function (p) {
      if (names.indexOf(p.name) < 0) return;
      var key = 'reload:' + p.name;
      var prev = S.loads.get(key);
      if (prev) {
        if (prev.status === 'pending') return;
        prev.cancel();
        S.loads.delete(key);
      }
      var gen = ctx.stv.switchGen || 0;
      track(key, p.fn, function (res) {
        // A 7TV set switch that landed meanwhile is newer than this refetch.
        if (p.name === '7tv-channel' && (ctx.stv.switchGen || 0) !== gen) return;
        p.apply(res);
        changed({ roomId: ctx.id });
      });
    });
  }
  function reloadHomeVolatile() {
    // The 7TV EventAPI refetches its set itself after a reconnect (onReady), and missed nothing if it stayed up.
    reloadHome(S.stvEvents ? ['bttv-channel', 'ffz-room'] : ['7tv-channel', 'bttv-channel', 'ffz-room']);
  }

  // ---------- live sockets ----------
  // The 7TV EventAPI socket, one for the overlay: the Twitch channel's cosmetics and entitlements, and live changes to
  // the 7TV sets of the Twitch channel and of the Kick channel (S.kickCtx), whichever asks for it first.
  function ensureStvEvents() {
    var cfg = S.cfg;
    if (S.stvEvents || cfg.demo || !(cfg.emotes_7tv || cfg.paints || (cfg.badges && cfg.badges_7tv))) return S.stvEvents;
    var hellos = 0;
    S.stvEvents = T.seventv.createEventClient({
      state: S.stv,
      // 7TV has no resume: after a reconnect, refetch the channel sets in case updates were missed.
      onReady: function () {
        if (++hellos > 1 && S.cfg.emotes_7tv) {
          reloadHome(['7tv-channel']);
          reloadKickSet();
        }
      }
    });
    var home = S.rooms.home();
    if (home) {
      S.stvEvents.addChannel(home.id);
      S.stvChannel = home.id;
      subscribeSet(home.stv);
    }
    subscribeSet(S.kickCtx.stv);
    S.stvEvents.start();
    return S.stvEvents;
  }
  // A 7TV set the overlay draws from (the home channel's, the Kick channel's), and its owner (set switches), on the
  // EventAPI. oldSetId: the set it had before, dropped unless the other one still uses it.
  function subscribeSet(stv, oldSetId) {
    var ev = S.stvEvents;
    if (!ev) return;
    if (stv.setId) ev.addObject('emote_set.update', stv.setId);
    if (stv.ownerId) ev.addObject('user.update', stv.ownerId);
    // A reload that found a different (or no) set drops the old one's subscription.
    if (ev.removeObject && oldSetId && oldSetId !== stv.setId && !setInUse(oldSetId)) ev.removeObject('emote_set.update', oldSetId);
  }
  function setInUse(setId) {
    var home = S.rooms.home();
    return !!(home && home.stv.setId === setId) || S.kickCtx.stv.setId === setId;
  }

  function startLive(roomId) {
    var cfg = S.cfg;
    var ev = ensureStvEvents();
    // A socket the Kick channel's set opened before the Twitch channel was known: the channel joins it.
    if (ev && S.stvChannel !== roomId) {
      ev.addChannel(roomId);
      S.stvChannel = roomId;
      var home = S.rooms.home();
      if (home) subscribeSet(home.stv);
    }
    if (!S.bttvLive && (cfg.emotes_bttv || (cfg.badges && cfg.badges_bttv))) {
      S.bttvLive = T.bttv.createLive({
        roomId: roomId,
        onEmoteAdd: function (e) {
          var h = S.rooms.home();
          if (!h || !e || !S.cfg.emotes_bttv) return;
          T.bttv.upsertEmote(h.bttv.emotes, e);
          changed({ roomId: roomId });
        },
        onEmoteUpdate: function (e) {
          var h = S.rooms.home();
          if (!h || !e || !S.cfg.emotes_bttv) return;
          T.bttv.upsertEmote(h.bttv.emotes, e); // an update can rename the code
          changed({ roomId: roomId });
        },
        onEmoteRemove: function (emoteId) {
          var h = S.rooms.home();
          if (!h || !S.cfg.emotes_bttv) return;
          T.bttv.removeEmoteById(h.bttv.emotes, emoteId);
          changed({ roomId: roomId });
        },
        onUser: function (userId, data) {
          userId = T.util.idStr(userId);
          if (!userId || !data) return;
          S.bttvUsers.set(userId, { badge: data.badge || null, emotes: S.cfg.emotes_bttv && data.emotes || null });
          changed({ userId: userId });
        },
        // The socket only carries changes made while it is open: after a reconnect, refetch the channel.
        // (Called by bttv.createLive when it supports it; an older bttv.js just ignores the option.)
        onReopen: function () { if (S.cfg.emotes_bttv) reloadHome(['bttv-channel']); }
      });
      S.bttvLive.start();
    }
  }

  function onSetSwitch(roomId, newSetId) {
    // The Kick channel's set (KICK_STV), else the home channel's: only those are subscribed, so fall back to the home
    // when the id isn't a known room.
    var kick = roomId === KICK_STV;
    var ctx = kick ? S.kickCtx : (roomId && S.rooms.get(roomId)) || S.rooms.home();
    if (!ctx) return;
    var switchKey = kick ? '7tv-set-switch:kick' : '7tv-set-switch';
    if (newSetId === null) {
      // The owner turned their set off, or one of their rooms switched and which isn't known: confirm over REST, the
      // channel reload clears the set (and its routing) when there really is none now.
      var pend = S.loads.get(switchKey);
      if (pend) { pend.cancel(); S.loads.delete(switchKey); }
      ctx.stv.wantSet = null;
      ctx.stv.switchGen = (ctx.stv.switchGen || 0) + 1;
      // A reload still in flight was started for an older generation and would stand down: restart it.
      var reloadKey = kick ? 'reload:7tv-kick-channel' : 'reload:7tv-channel';
      var rl = S.loads.get(reloadKey);
      if (rl) { rl.cancel(); S.loads.delete(reloadKey); }
      if (S.cfg.emotes_7tv) {
        if (kick) reloadKickSet();
        else reloadHome(['7tv-channel']);
      }
      return;
    }
    if (!T.seventv.isUlid(newSetId)) return;
    ctx.stv.wantSet = newSetId;
    ctx.stv.switchGen = (ctx.stv.switchGen || 0) + 1; // makes an older reload of the channel's set stand down
    var prev = S.loads.get(switchKey);
    if (prev) { prev.cancel(); S.loads.delete(switchKey); }
    track(switchKey, function () { return T.seventv.loadSet(newSetId); }, function (m) {
      if (ctx.stv.wantSet !== newSetId) return; // superseded by a later switch
      var oldSetId = ctx.stv.setId;
      fillMap(ctx.stv.emotes, m || new Map());
      ctx.stv.setId = newSetId;
      S.stv.registerChannelSet(ctx.id, newSetId, ctx.stv.emotes, ctx.stv.ownerId, ctx.stv.connIndex);
      // Drop the old set's subscription (when seventv.js offers it), so switches don't pile them up.
      subscribeSet(ctx.stv, oldSetId);
      changed({ roomId: ctx.id });
    });
  }

  // ---------- chat handling ----------
  // Whether chatters' 7TV paints or badges are drawn and, for those without a 7TV client, looked up (stv_lookup).
  function stvStyleOn(c) { return !!(c.stv_lookup && (c.paints || (c.badges && c.badges_7tv))); }

  function noteUser(m) {
    if (!m.userId || S.cfg.demo || isKick(m)) return;
    S.recentUsers.set(m.userId, T.util.now());
    if (S.stvLookup && stvStyleOn(S.cfg)) S.stvLookup.want(m.userId);
  }

  // Paints or 7TV badges turned on live (the builder's preview): the chatters on screen, and those seen lately (lines
  // still queued too), are looked up now, as a reload would. Each one once: the lookup skips ids it knows or has queued.
  function lookUpShown() {
    S.renderer.rerender(function (m) {
      if (m.userId && !isKick(m)) S.stvLookup.want(m.userId);
      return false;
    });
    S.recentUsers.map.forEach(function (at, uid) { S.stvLookup.want(uid); });
  }

  function deliver(m) {
    if (S.historyPending && !m.historical) {
      S.liveBuffer.push(m);
      return;
    }
    // A reply to a blocked user keeps its reply: its header, which would quote them, is left out as it is drawn
    // (quotesHidden), so its "@Parent" still goes from its text and the filters, and a live block change redraws it.
    // Only lines the renderer accepted (not filtered out) load rooms and queue 7TV lookups. A filtered line still goes
    // to the renderer, which notes that it was said (a Shared Chat partner's while shared=0 too): a reply quoting it keeps
    // its header after a /clear or a timeout from before it.
    remember(m);
    if (!S.renderer.push(m)) return;
    if (m.mirrored) noteSourceRoom(m);
    noteUser(m);
    wantCheers(m);
  }

  // A line said but not shown (history older than the lines shown): the renderer notes it (a /clear or a timeout from
  // before it then leaves a reply quoting it its header), and so does the overlay (remember).
  function noteSaid(m) {
    remember(m);
    if (S.renderer.note) S.renderer.note(m);
  }

  // ---------- a channel's own cheermotes ----------
  // A partner's or affiliate's own cheermotes ('sodaCheer100'), looked up (twitchBadges.loadCheermotes) the first time a
  // bits message in that channel has a word that looks like a cheer and no global cheermote is: the home channel's, or a
  // Shared Chat partner's for its own lines (a cheer is said in one channel, with that channel's cheermotes). Its lines
  // with bits are drawn again once they are known. room id -> {map, busy, retryAt, delay}: a failed lookup is asked again
  // on a later such message, PART_RETRY_MS after (doubling), as a partner's failed parts are.
  function cheerMapFor(m) {
    var e = S.cheerMaps.peek(T.util.idStr(roomIdOf(m)));
    return e && e.map && e.map.size ? e.map : null;
  }
  function wantCheers(m) {
    if (S.cfg.demo || isKick(m) || !(m.bits > 0)) return;
    var id = T.util.idStr(roomIdOf(m));
    if (!/^\d+$/.test(id)) return;
    var e = S.cheerMaps.get(id);
    if (e && (e.map || e.busy || T.util.now() < e.retryAt)) return;
    if (!T.tokenizer.unknownCheers(m.text)) return;
    var entry = { map: null, busy: true, retryAt: 0, delay: e ? e.delay : PART_RETRY_MS };
    S.cheerMaps.set(id, entry);
    T.twitchBadges.loadCheermotes(id).then(function (map) {
      entry.busy = false;
      entry.map = map;
      if (map && map.size) scheduleRerender(function (x) { return !isKick(x) && x.bits > 0 && T.util.idStr(roomIdOf(x)) === id; });
    }, function (err) {
      entry.busy = false;
      entry.retryAt = T.util.now() + entry.delay;
      entry.delay = Math.min(entry.delay * 2, PART_RETRY_MAX_MS);
      T.util.warn('cheermotes for', id, 'failed:', err && err.message);
    });
  }

  // A PRIVMSG as the chat message deliver takes.
  function chatFrom(p) {
    var m = T.ircParse.toChatMessage(p);
    if (!m.roomId && S.homeId) m.roomId = S.homeId;
    if (m.msgId === 'highlighted-message') m.highlight = true;
    return m;
  }

  function handlePrivmsg(p) {
    deliver(chatFrom(p));
  }

  function handleUsernotice(p) {
    var n = T.ircParse.toNoticeMessage(p);
    if (n.historical) return;
    if (!n.roomId && S.homeId) n.roomId = S.homeId;
    if (n.mirrored && n.type !== 'announcement') {
      // A partner channel's sub/raid notice is not shown, but the message its viewer typed with it is.
      // (The home channel's own copy of a Shared Chat notice has source-room-id == room-id: skip it.)
      if (n.text && n.sourceRoomId && n.sourceRoomId !== n.roomId) {
        n.kind = 'chat';
        deliver(n);
      }
      return;
    }
    if (n.type === 'announcement') {
      n.kind = 'chat';
      n.announcement = n.announceColor || 'PRIMARY';
      return deliver(n);
    }
    if (n.type === 'submysterygift' && n.communityGiftId) S.giftIds.set(n.communityGiftId, true);
    if (n.type === 'subgift' && n.communityGiftId && S.giftIds.has(n.communityGiftId)) return;
    // Twitch's system-msg for this one is a placeholder ("bits badge tier notification").
    if (n.type === 'bitsbadgetier') {
      var th = parseInt(n.params && n.params.threshold, 10);
      var amount = th >= 1000000 && th % 1000000 === 0 ? th / 1000000 + 'M' : th >= 1000 && th % 1000 === 0 ? th / 1000 + 'K' : String(th);
      if (th > 0) n.systemMsg = (n.displayName || n.login || 'Someone') + ' just earned a new ' + amount + ' Bits badge!';
    }
    if (S.cfg.events && NOTICE_TYPES[n.type] && typeOn(S.cfg, n.type)) return deliver(n);
    // Not shown as a notice (events off, or this type's switch): still show the user's own attached message as chat.
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
    else if (!p.params[1]) {
      // A Twitch /clear leaves the Kick lines of a combined chat alone.
      if (S.cfg.kick) S.renderer.clearAll(notKick);
      else S.renderer.clearAll();
    }
  }

  // ---------- Kick ----------
  function onKickEvent(ev) {
    if (!ev) return;
    // While Twitch history loads, live lines are buffered: keep Kick events in order with them.
    if (S.historyPending) {
      S.liveBuffer.push({ __kick: ev });
      return;
    }
    // While Kick's own recent chat is asked again after a rejoin (refetchKick), its live events wait for it.
    if (S.kickGap) {
      S.kickBuffer.push(ev);
      return;
    }
    switch (ev.type) {
      case 'message':
      case 'notice':
        return deliver(ev.msg);
      case 'delete': return S.renderer.clearMessage(ev.id);
      case 'ban': return S.renderer.clearUser(ev.userId);
      case 'clear': return S.renderer.clearAll(isKick);
    }
  }

  // Kick's hint stays until Kick chat joins (onKickStatus); a later one takes its line.
  function kickHint(text) {
    setHint('kick', text, true);
  }

  function onKickStatus(status, detail) {
    S.kickStatus = status;
    if (status === 'joined') {
      // The network works: a font stylesheet that failed is asked for again (a Kick-only overlay has no IRC rejoin).
      applyFonts(S.cfg, true);
      clearHint('kick');
      // Every join after the first is a rejoin (one after a Pusher error code sends no 'closed' before it): what the
      // outage missed is asked for. So is the start-up history when it didn't come.
      var again = S.kickJoined;
      S.kickJoined = true;
      if (again || !S.kickHistoryLanded) refetchKick();
    } else if (status === 'closed' || status === 'fatal') {
      if (S.kickGapAbort) S.kickGapAbort();
      if (status === 'fatal') {
        kickHint('Kick refused the chat connection' + (detail && detail.code ? ' (error ' + detail.code + ')' : '') +
          '. Kick may have changed its chat server; check for an overlay update.');
      }
    }
  }

  function connectKick(room) {
    if (S.kick) return;
    S.kickRoom = String(room);
    S.kick = T.kick.createKick({ room: room, onEvent: onKickEvent, onStatus: onKickStatus });
    S.kick.start();
  }

  // kick_room named another chatroom than Kick's own answer gives the channel (an id left over from a channel retyped in
  // an older builder, or a typo): the overlay leaves it for the channel's own. The wrong room's lines go, those on screen
  // and those waiting for history, as lines that were never this channel's, not as moderation (replies keep headers).
  function moveKickRoom(room) {
    T.util.warn('kick: kick_room ' + S.kickRoom + ' is not ' + S.cfg.kick + '\'s chatroom (' + room + '); joining that one');
    if (S.kick) { S.kick.stop(); S.kick = null; }
    if (S.kickGapAbort) S.kickGapAbort();
    S.liveBuffer = S.liveBuffer.filter(function (m) { return !m.__kick; });
    S.kickBuffer = [];
    if (S.renderer.drop) S.renderer.drop(isKick);
    // The new room's first join is no rejoin, and the wrong room's lines are no point to ask after.
    S.kickJoined = false;
    S.kickTs = 0;
    S.kickStatus = 'resolving';
    connectKick(room);
  }

  // The channel lookup's extras: the channel's sub badge images, and its own 7TV set (by Kick user id).
  function applyKickChannel(c) {
    S.kickChannel = c; // its channel id and chatroom: the Kick history (loadKickHistory)
    S.kickSubBadges = c.subBadges || [];
    if (c.userId && S.cfg.emotes_7tv) {
      S.kickCtx.userId = String(c.userId);
      track('7tv-kick-channel', loadKickSet, applyKickSet);
    }
    scheduleRerender(isKick);
    // A lookup that failed at start (OBS before the network) and got through later: Kick's recent chat is asked now.
    if (!S.historyStarting && !S.kickHistoryLanded) refetchKick();
  }
  function loadKickSet() { return T.seventv.loadChannel(S.kickCtx.userId, 'kick'); }
  // The Kick channel's 7TV set (loadChannel's answer): its emotes for Kick lines, routed and subscribed for live
  // changes like the home channel's. null (no 7TV account, or the glitch loadChannel reports so) keeps what is there.
  function applyKickSet(r) {
    if (r) {
      var k = S.kickCtx.stv, oldSetId = k.setId;
      fillMap(k.emotes, r.emotes);
      k.setId = r.setId || null;
      k.ownerId = r.ownerId || null;
      k.connIndex = r.connIndex;
      S.stv.registerChannelSet(KICK_STV, k.setId, k.emotes, k.ownerId, k.connIndex);
      // A Kick-only overlay has no other reason to open the 7TV socket (which subscribes the set as it opens).
      if (S.stvEvents) subscribeSet(k, oldSetId);
      else ensureStvEvents();
    }
    scheduleRerender(isKick);
  }
  // Refetch the Kick channel's set (a 7TV reconnect may have missed changes, or a switch is to be confirmed), as
  // reloadHome does the home channel's: tracked, retried, and standing down for a newer set switch.
  function reloadKickSet() {
    var k = S.kickCtx;
    if (!k.userId || !S.cfg.emotes_7tv) return;
    var key = 'reload:7tv-kick-channel';
    var prev = S.loads.get(key);
    if (prev) {
      if (prev.status === 'pending') return;
      prev.cancel();
      S.loads.delete(key);
    }
    var gen = k.stv.switchGen || 0;
    track(key, loadKickSet, function (r) {
      if ((k.stv.switchGen || 0) !== gen) return;
      applyKickSet(r);
    });
  }

  // Kick's chat socket needs the numeric chatroom id. kick_room (set by the builder) connects at once; without
  // it the channel API is asked, which Kick may refuse to other sites (Cloudflare), so a hint says what to do.
  function startKick() {
    var cfg = S.cfg;
    S.kickStatus = 'resolving';
    var lookup = function () { return T.kick.lookupChannel(cfg.kick); };
    if (cfg.kick_room) {
      connectKick(cfg.kick_room);
      // Chat already works: the lookup only adds the channel's sub badge images and its 7TV set, and is retried like
      // every other load (backoff, back online, after an outage) when it fails, so a start before the network is up
      // doesn't leave them out for the whole stream. A channel Kick doesn't know (null) is simply left at that. One
      // that names another chatroom for the channel (lookupChannel checks the answer is this channel's) wins over a
      // stale kick_room.
      S.kickLookup = track('kick-channel', lookup, function (c) {
        if (!c) return;
        if (c.chatroomId && String(c.chatroomId) !== S.kickRoom) moveKickRoom(c.chatroomId);
        applyKickChannel(c);
      });
      return;
    }
    S.kickLookup = track('kick-channel', lookup, function (c) {
      if (!c) {
        kickHint('Kick channel "' + cfg.kick + '" was not found. Check the name in your overlay URL or settings.js.');
        return;
      }
      applyKickChannel(c);
      connectKick(c.chatroomId);
    });
    setTimeout(function () {
      if (!S.kick && !S.hints.kick) {
        kickHint('Couldn\'t look up the Kick chatroom for "' + cfg.kick + '". Set its chatroom id (kick_room) in the builder.');
      }
    }, KICK_HINT_MS);
  }

  function onLine(p) {
    if (!p) return;
    if (p.tags && !p.tags.historical) noteTwitchTs(p);
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
          setHint('twitchIrc', 'Channel "' + S.cfg.channel + '" does not exist or is suspended.', true);
        }
        return;
    }
  }

  function onIrcStatus(status, detail) {
    S.ircStatus = status;
    if (status === 'joined') {
      if (detail && detail.tags && detail.tags['room-id']) onRoomId(detail.tags['room-id']);
      if (S.closedAt && T.util.now() - S.closedAt > 30000) {
        // Only home data loaded before the outage can be stale (not data first loaded during the rejoin).
        if (S.homeAt && S.homeAt <= S.closedAt) reloadHomeVolatile();
        S.loads.forEach(function (ctl) { if (ctl.status === 'failed') ctl.retryNow(); });
        // The network is back: cut short the (much longer) 7TV/BTTV socket backoffs. kick() is a no-op
        // for a socket that is connected.
        if (S.stvEvents) S.stvEvents.kick();
        if (S.bttvLive) S.bttvLive.kick();
      }
      // After any outage, however short: a font stylesheet that failed in it is asked for again now (one that loaded,
      // or is still loading, is left alone), and what the outage missed is asked for (refetchGap). So is the start-up
      // history when it never came (OBS started before the network was up): a first connect that hangs sends no
      // 'closed', so that isn't waited for.
      if (S.closedAt) applyFonts(S.cfg, true);
      if (S.closedAt || !S.historyLanded) refetchGap();
      S.closedAt = 0;
      clearHint('twitchLookup');
    } else if (status === 'closed') {
      if (!S.closedAt) S.closedAt = T.util.now();
      if (S.gapAbort) S.gapAbort();
    }
  }

  // The history's chat lines that are shown (list: chat and moderation lines, oldest first): the newest `want` that the
  // filters let through (shouldShow) and that no later line in the history deletes, times out or clears, as indexes,
  // newest first. A /clear ends the search: nothing before it is shown (stop: the index after it, else 0).
  function historyPicks(list, want) {
    var goneIds = new Set(), goneUsers = new Set(), picks = [];
    for (var i = list.length - 1; i >= 0 && picks.length < want; i--) {
      var p = list[i], tags = p.tags;
      if (p.command === 'CLEARMSG') {
        if (tags['target-msg-id']) goneIds.add(tags['target-msg-id']);
      } else if (p.command === 'CLEARCHAT') {
        if (tags['target-user-id']) goneUsers.add(tags['target-user-id']);
        else if (!p.params[1]) return { picks: picks, stop: i + 1 };
      } else if (tags['rm-deleted'] === undefined && !goneIds.has(tags.id) && !goneUsers.has(tags['user-id']) &&
          shouldShow(chatFrom(p))) {
        picks.push(i);
      }
    }
    return { picks: picks, stop: 0 };
  }
  // The first of the history lines whose chat lines are shown (the oldest pick, when there are `want`).
  function historyStart(list, want) {
    var r = historyPicks(list, want);
    return r.picks.length >= want ? r.picks[want - 1] : r.stop;
  }

  // robotty's limit counts raw lines of every kind (notices, deletions, timeouts), and the filters hide more (bots,
  // commands, blocked users): so more are asked for, and the newest `history` chat lines that show are shown.
  function historyLimit(n) { return Math.min(800, n * 4 + 20); }

  // History comes from a third-party service: only chat and moderation lines are replayed.
  function historyLines(lines) {
    var list = (Array.isArray(lines) ? lines : []).filter(function (p) {
      return !!p && (p.command === 'PRIVMSG' || p.command === 'CLEARCHAT' || p.command === 'CLEARMSG');
    });
    list.forEach(function (p) { p.tags = p.tags || {}; p.params = p.params || []; });
    return list;
  }
  // A Twitch line's server time (tmi-sent-ts), 0 without one.
  function sentAt(p) {
    var ts = Number(p && p.tags && p.tags['tmi-sent-ts']);
    return ts > 0 && isFinite(ts) ? ts : 0;
  }
  // The newest Twitch server time the overlay has seen, live or in history (S.twitchTs): a refetch after an outage
  // replays what is newer (refetchGap).
  function noteTwitchTs(p) {
    var ts = sentAt(p);
    if (ts > S.twitchTs) S.twitchTs = ts;
  }

  // Replays the history lines (oldest first; from: the first whose chat lines are shown), with the Kick lines kick
  // (oldest first, each to be shown) put in among them by time.
  function replayHistory(list, from, kick) {
    var k = 0;
    list.forEach(function (p, i) {
      var ts = sentAt(p);
      while (ts && k < kick.length && kick[k].ts < ts) deliver(kick[k++]);
      noteTwitchTs(p);
      // Already moderated: not shown, but recorded as deleted so replies quoting it get no header.
      if (p.tags['rm-deleted'] !== undefined) { if (p.tags.id) S.renderer.clearMessage(p.tags.id); return; }
      p.tags.historical = '1';
      if (p.command === 'PRIVMSG' && i < from) {
        // Older than the lines shown: not shown, but noted as said, in order with the moderation replayed around it, so
        // a timeout or /clear from before it doesn't take the header off a later reply quoting it.
        noteSaid(chatFrom(p));
        return;
      }
      // Skip lines that also arrived live while history was loading (the live copy is buffered).
      if (p.command === 'PRIVMSG' && p.tags.id && S.irc && S.irc.markSeen(p.tags.id)) return;
      onLine(p);
    });
    while (k < kick.length) deliver(kick[k++]);
  }

  // The live chat (and moderation) that waited for history, in order.
  function flushLive() {
    var buf = S.liveBuffer;
    S.liveBuffer = [];
    buf.forEach(function (m) {
      if (m.__clear) handleClearchat(m.__clear);
      else if (m.__kick) onKickEvent(m.__kick);
      else deliver(m);
    });
  }

  // The Kick channel's recent messages, for the start-up history, once the channel lookup (S.kickLookup) has given the
  // channel's id: both are kick.com's API, which may refuse other sites (then there are none, as before). cb(list, how)
  // once, [] for none, by HISTORY_WAIT_MS from now; how: 'answered' (kick.com answered, [] when there are none),
  // 'failed' (asked, but no answer), 'none' (not asked: no channel id yet).
  function loadKickHistory(cb) {
    var until = T.util.now() + HISTORY_WAIT_MS, how = 'none';
    Promise.resolve(S.kickLookup).then(function () {
      var c = S.kickChannel, left = until - T.util.now();
      if (!c || !c.channelId || left <= 0) return null;
      how = 'failed';
      return T.kick.loadHistory(c.channelId, c.chatroomId, { timeout: left });
    }).then(function (l) {
      cb(l || [], l ? 'answered' : how);
    }, function (e) {
      T.util.warn('kick history load failed', e && e.message);
      cb([], how);
    });
  }

  // bots=0: the bot lists a history's picks (historyPicks of list, oldest first) depend on, known before they are made, so
  // a bot whose list lands later doesn't take a shown line's place (its line would go, and nothing come in its stead): the
  // home channel's BTTV list (S.homeBots), and the BTTV list of each Shared Chat partner whose lines are among the picks,
  // whose room is loaded for it now (as showing its lines would; MAX_HISTORY_ROOMS at most), round after round as lines
  // that go let older ones in. cb() once they are known, or at once without bots=0 or a Twitch channel; gone(): the
  // caller stopped waiting (its HISTORY_WAIT_MS deadline picks with what is known).
  function whenBotsKnown(list, want, cb, gone) {
    var asked = {}, home = false;
    function round() {
      if (gone()) return;
      if (S.cfg.bots || !S.cfg.channel || !list.length) { cb(); return; }
      var waits = [];
      if (!home) { home = true; waits.push(S.homeBots); }
      var picks = historyPicks(list, want).picks;
      for (var i = 0; i < picks.length; i++) {
        var t = list[picks[i]].tags, id = T.util.idStr(t['source-room-id']);
        if (!id || id === T.util.idStr(t['room-id']) || asked[id]) continue;
        asked[id] = true;
        var room = historyRoom(id);
        if (room) waits.push(room);
      }
      if (!waits.length) { cb(); return; }
      Promise.all(waits).then(round, round);
    }
    round();
  }
  // A Shared Chat room a history line comes from, loaded (or kept) for it: its load's promise, null for a room the
  // history may not load (junk, the home room, or MAX_HISTORY_ROOMS already).
  function historyRoom(id) {
    if (!/^\d+$/.test(id) || id === S.homeId) return null;
    if (!S.rooms.get(id) && !S.histRooms.has(id)) {
      if (S.histRooms.size >= MAX_HISTORY_ROOMS) return null;
      S.histRooms.add(id);
    }
    return S.rooms.ensure(id);
  }

  // history=N: the recent chat shown on start, Twitch's from recent-messages and Kick's from kick.com. Live chat (both
  // platforms, and moderation) waits in S.liveBuffer until both have come, HISTORY_WAIT_MS at most (each request is
  // aborted then, so late history is not downloaded and parsed for nothing). Together they show the newest N chat lines
  // the filters let through, of either platform, in time order, picked once the bot lists they depend on are known
  // (whenBotsKnown). One that never came is asked again later: Twitch's when IRC (re)joins (refetchGap), Kick's when Kick
  // chat (re)joins or the channel lookup gets through (refetchKick).
  function startHistory() {
    var cfg = S.cfg;
    var twitch = !!cfg.channel, kick = !!cfg.kick;
    if (!cfg.history || cfg.demo || !(twitch || kick)) return;
    S.historyPending = true;
    S.historyStarting = true;
    var got = { twitch: twitch ? null : [], kick: kick ? null : [] }, done = false, kickHow = 'none', list = null;
    function land(which, v, answered) {
      if (done) return;
      got[which] = Array.isArray(v) ? v : [];
      if (which === 'twitch') S.historyLanded = !!answered;
      else { kickHow = answered; S.kickHistoryLanded = answered === 'answered'; }
      if (!got.twitch || !got.kick) return;
      list = historyLines(got.twitch);
      whenBotsKnown(list, cfg.history, finish, function () { return done; });
    }
    function finish() {
      if (done) return;
      done = true;
      S.historyPending = false;
      S.historyStarting = false;
      if (!list) list = historyLines(got.twitch);
      var want = cfg.history;
      var kickShown = (got.kick || []).filter(function (m) { return !!m && isKick(m) && shouldShow(m); }).slice(-want);
      var from, kickKept = [];
      if (!kickShown.length) {
        from = historyStart(list, want);
      } else {
        // The newest `want` of both: the Twitch lines that make it decide where Twitch's shown lines start.
        var tw = historyPicks(list, want);
        var picks = tw.picks.map(function (i) { return { ts: sentAt(list[i]), i: i }; })
          .concat(kickShown.map(function (m) { return { ts: Number(m.ts) || 0, m: m }; }))
          .sort(function (a, b) { return b.ts - a.ts; }).slice(0, want);
        var kept = picks.filter(function (x) { return x.m === undefined; }).length;
        if (kept === tw.picks.length) from = tw.picks.length >= want ? tw.picks[want - 1] : tw.stop;
        else from = kept ? tw.picks[kept - 1] : list.length;
        kickKept = picks.filter(function (x) { return x.m !== undefined; }).map(function (x) { return x.m; })
          .sort(function (a, b) { return a.ts - b.ts; });
      }
      replayHistory(list, from, kickKept);
      flushLive();
      // Kick's got nothing because the channel lookup hadn't given the channel's id yet: it is asked for once it has.
      if (kick && kickHow === 'none') refetchKick();
    }
    setTimeout(finish, HISTORY_WAIT_MS);
    if (twitch) {
      T.irc.loadHistory(cfg.channel, historyLimit(cfg.history), { timeout: HISTORY_WAIT_MS }).then(function (l) {
        land('twitch', l, true);
      }, function (e) {
        T.util.warn('history load failed', e && e.message);
        land('twitch', [], false);
      });
    }
    if (kick) loadKickHistory(function (l, how) { land('kick', l, how); });
  }

  // ---------- after an IRC outage ----------
  // Twitch doesn't send again what was said, deleted or cleared while the overlay's socket was down (a network blip, a
  // Twitch RECONNECT, the PC asleep): a message a mod deleted, or a user banned, then stayed on stream. After a rejoin,
  // while history is on, recent-messages is asked again, once per outage, and live chat waits for it (HISTORY_WAIT_MS at
  // most) as at start: every deletion in it is applied, whenever the line was said (robotty marks a deleted line
  // rm-deleted; it keeps no CLEARMSG), and its lines sent after the newest the overlay had seen (S.twitchTs, Twitch's own
  // clock, so the PC's doesn't matter) are replayed in order, timeouts and /clears included, the newest `history` of its
  // chat lines shown. A new outage drops the request, and the next rejoin asks from the same point (S.gapAfter).
  // When the start-up history never came (OBS started before the network was up, or recent-messages failed) and no
  // Twitch line has been seen since, the whole of it is asked for at the next join, as at start: the newest `history`
  // chat lines, however old (no outage to reach back over).
  var GAP_SLACK_MS = 70000; // the longest a dead socket goes unnoticed (irc.js: a PING every 60 s, 10 s for its PONG)
  function refetchGap() {
    var cfg = S.cfg;
    if (!cfg.history || !cfg.channel || cfg.demo || S.historyPending) return;
    var whole = !S.historyLanded && !S.twitchTs;
    var after = whole ? 0 : S.gapAfter || S.twitchTs || (S.closedAt ? Math.max(S.closedAt - GAP_SLACK_MS, 1) : 0);
    if (!after && !whole) return;
    S.gapAfter = after;
    S.historyPending = true;
    var done = false, list = null, gap = null;
    // ok: lines came; keep: a new outage cut it short (the next rejoin asks from the same point).
    function finish(ok, keep) {
      if (done) return;
      done = true;
      S.gapAbort = null;
      S.historyPending = false;
      if (!keep) S.gapAfter = 0;
      if (ok && list) {
        S.historyLanded = true;
        if (whole) replayHistory(list, historyStart(list, cfg.history), []);
        else replayGap(list, gap);
      }
      flushLive();
    }
    S.gapAbort = function () { finish(false, true); };
    // By then the lines that came are replayed, whether the bot lists they wait for are known or not.
    setTimeout(function () { finish(true, false); }, HISTORY_WAIT_MS);
    // Enough lines to reach back over the lines on screen (cfg.max), for their deletions.
    var limit = whole ? historyLimit(cfg.history) : Math.min(800, Math.max(historyLimit(cfg.history), cfg.max * 2));
    T.irc.loadHistory(cfg.channel, limit, { timeout: HISTORY_WAIT_MS }).then(function (l) {
      if (done) return;
      list = historyLines(l);
      if (!whole) gap = gapLines(list, after);
      whenBotsKnown(whole ? list : gap, cfg.history, function () { finish(true, false); }, function () { return done; });
    }, function (e) {
      T.util.warn('history refetch failed', e && e.message);
      finish(false, false);
    });
  }
  // The refetched lines (oldest first) said in an outage that began after `after` (a Twitch server time): not deletions
  // (replayGap applies them all), nor a line that came live since the rejoin (it waits in the buffer).
  function gapLines(list, after) {
    return list.filter(function (p) {
      if (sentAt(p) <= after || p.command === 'CLEARMSG' || p.tags['rm-deleted'] !== undefined) return false;
      return !(p.command === 'PRIVMSG' && p.tags.id && S.irc && S.irc.markSeen(p.tags.id));
    });
  }
  // The refetched lines (list, oldest first): every deletion in them, then the gap's lines (gapLines).
  function replayGap(list, gap) {
    list.forEach(function (p) {
      if (p.command === 'PRIVMSG' && p.tags['rm-deleted'] !== undefined && p.tags.id) S.renderer.clearMessage(p.tags.id);
      else if (p.command === 'CLEARMSG' && p.tags['target-msg-id']) S.renderer.clearMessage(p.tags['target-msg-id']);
    });
    var from = historyStart(gap, S.cfg.history);
    gap.forEach(function (p, i) {
      noteTwitchTs(p);
      p.tags.historical = '1';
      if (p.command === 'PRIVMSG' && i < from) {
        noteSaid(chatFrom(p));
        return;
      }
      onLine(p);
    });
  }

  // ---------- after a Kick outage ----------
  // Pusher doesn't send again what was said, deleted or banned while the Kick socket was down: a message a Kick mod
  // deleted, or a user banned, stayed on stream, and what was said meanwhile never came. After a rejoin, while history is
  // on, kick.com's recent chat (its newest ~25, which leaves out deleted messages and a banned user's) is asked again,
  // once per rejoin, and live Kick events wait for it (HISTORY_WAIT_MS at most; Twitch chat goes on). Its lines said
  // since the newest Kick line the overlay had seen (S.kickTs, Kick's own clock) and not seen yet are shown, the newest
  // `history` of them, the rest noted; and a Kick line the overlay had, said strictly between the oldest and newest of
  // them but not among them, was deleted or its sender banned meanwhile: it goes. (kick.com gives times to the second,
  // so the lines of the two seconds at the ends may be missing for no reason.) The same request is the start-up Kick
  // history when that never came: no Kick line seen yet, the newest `history` of its lines are shown.
  function refetchKick() {
    var cfg = S.cfg, c = S.kickChannel;
    if (!cfg.history || cfg.demo || !cfg.kick || S.historyStarting || S.kickGap || !c || !c.channelId) return;
    var after = S.kickTs, done = false;
    var gap = S.kickGap = {};
    function finish(list) {
      if (done) return;
      done = true;
      if (S.kickGap === gap) S.kickGap = null;
      S.kickGapAbort = null;
      if (list) {
        S.kickHistoryLanded = true;
        replayKick(list, after);
      }
      flushKick();
    }
    S.kickGapAbort = function () { finish(null); };
    setTimeout(function () { finish(null); }, HISTORY_WAIT_MS);
    // fresh: not the browser's copy of the start-up request (kick.com lets it be kept for 10 s).
    T.kick.loadHistory(c.channelId, S.kickRoom || c.chatroomId, { timeout: HISTORY_WAIT_MS, fresh: true }).then(function (l) {
      finish(Array.isArray(l) ? l : []);
    }, function (e) {
      T.util.warn('kick history refetch failed', e && e.message);
      finish(null);
    });
  }
  // kick.com's recent Kick lines (oldest first) after a rejoin; after: the newest Kick time seen before it.
  function replayKick(list, after) {
    var ids = {}, lo = Infinity, hi = -Infinity;
    list = list.filter(function (m) { return !!m && isKick(m) && !!m.id; });
    list.forEach(function (m) {
      ids[m.id] = true;
      if (m.ts < lo) lo = m.ts;
      if (m.ts > hi) hi = m.ts;
    });
    var gone = [];
    S.said.map.forEach(function (m, id) {
      if (isKick(m) && id === m.id && m.ts > lo && m.ts < hi && !ids[id]) gone.push(id);
    });
    gone.forEach(function (id) { S.renderer.clearMessage(id); });
    // Not a line that came live since the rejoin: it waits in the buffer.
    var waiting = {};
    S.kickBuffer.concat(S.liveBuffer.map(function (x) { return x.__kick; })).forEach(function (ev) {
      if (ev && ev.type === 'message' && ev.msg && ev.msg.id) waiting[ev.msg.id] = true;
    });
    var gap = list.filter(function (m) { return m.ts >= after && !S.said.has(m.id) && !waiting[m.id]; });
    var shown = gap.filter(shouldShow).slice(-S.cfg.history);
    gap.forEach(function (m) {
      m.historical = true;
      if (shown.indexOf(m) >= 0) deliver(m);
      else noteSaid(m);
    });
  }
  // The live Kick events that waited for refetchKick, in order: still before any that wait for a Twitch history.
  function flushKick() {
    var buf = S.kickBuffer;
    S.kickBuffer = [];
    if (S.historyPending) {
      S.liveBuffer = buf.map(function (ev) { return { __kick: ev }; }).concat(S.liveBuffer);
      return;
    }
    buf.forEach(onKickEvent);
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
    if (cfg.badges && cfg.badges_twitch && twitchOn()) {
      track('twitch-global-badges', T.twitchBadges.loadGlobal, function (m) { S.twitchGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.emotes_7tv) {
      track('7tv-global', T.seventv.loadGlobal, function (m) { S.stvGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.emotes_bttv && twitchOn()) {
      track('bttv-global', T.bttv.loadGlobal, function (r) {
        S.bttvGlobal = r.emotes;
        S.bttvPrefixes = r.prefixes;
        changed({ all: true });
      }, true);
    }
    if (cfg.emotes_ffz && twitchOn()) {
      track('ffz-global', T.ffz.loadGlobal, function (m) { S.ffzGlobal = m; changed({ all: true }); }, true);
    }
    if (cfg.channel) {
      track('channel-user', function () { return T.twitchBadges.lookupUser(cfg.channel); }, function (u) {
        // An answer for some other login (a third-party lookup) is not this channel: let IRC's ROOMSTATE decide.
        if (u && u.login && u.login !== cfg.channel) {
          T.util.warn('channel lookup returned', u.login, 'for', cfg.channel);
          u = null;
        }
        if (!u) {
          setTimeout(function () {
            if (!S.homeId) setHint('twitchLookup', 'Channel "' + cfg.channel + '" was not found. Check the name in your overlay URL or settings.js.', true);
          }, 10000);
          return;
        }
        if (u.banned) {
          // Third-party data: not sticky, so a successful IRC join (Twitch's own answer) clears it.
          if (!S.homeId) setHint('twitchLookup', 'Channel "' + cfg.channel + '" is suspended, so its chat is unavailable.', true);
          return;
        }
        onRoomId(u.id, u);
      }, false);
    }
  }

  // Paints and third-party badges are keyed by Twitch user id: a Kick-only overlay needs none of them.
  function startTier2() {
    var cfg = S.cfg;
    if (!twitchOn()) return;
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
    if (cfg.badges && cfg.badges_homies && twitchOn()) {
      // One loader per list, all filling one index: a list that fails retries on its own. homies_lists=light
      // leaves out the big chatterinohomies.com list (the last one).
      var homies = T.extraBadges.createHomies();
      var lists = cfg.homies_lists === 'light' ? T.extraBadges.HOMIES_LIGHT_COUNT : T.extraBadges.HOMIES_COUNT;
      for (var i = 0; i < lists; i++) {
        (function (i) {
          track('homies-badges-' + i, function () { return T.extraBadges.loadHomiesSource(i, homies); }, function () {
            S.homies = homies;
            changed({ all: true });
          });
        })(i);
      }
    }
  }

  // ---------- debug ----------
  function renderDebug() {
    var d = el('debug');
    if (!d) return;
    d.hidden = false;
    var parts = ['irc:' + (S.cfg.demo ? 'demo' : S.cfg.channel ? S.ircStatus : 'off')];
    if (S.cfg.kick) parts.push('kick:' + (S.cfg.demo ? 'demo' : S.kickStatus));
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
    applyFonts(next);
    S.renderer.setConfig(next);
    // The box behind the names decides how readable colors them (nameFor): a box turned light, or another light one,
    // redraws the names on screen (the renderer redraws on readable itself).
    if (next.readable && String(nameBackdrop(prev)) !== String(nameBackdrop(next))) scheduleRerender(true);
    if (S.stvLookup && !next.demo && stvStyleOn(next) && !stvStyleOn(prev)) lookUpShown();
    // Data for badge providers / paints that were off at boot was never loaded: load it now.
    var turnedOn = ['badges', 'paints'].concat(keys.filter(function (k) { return k.indexOf('badges_') === 0; }))
      .some(function (k) { return next[k] && !prev[k]; });
    // bots=0 needs the home channel's BTTV bot list, which bots=1 does not load.
    if (turnedOn || (prev.bots && !next.bots)) {
      ensureLoaders();
      // ... and each Shared Chat partner's data, for its own lines (its channel badges, FFZ room badges, BTTV bot list).
      loadPartnerParts();
    }
  }

  // Each Shared Chat room already loaded (or loading) fetched the parts the settings used then: now the ones they use
  // that it has neither loaded nor is loading. The user lookup is wanted whatever the settings (one that failed waits for
  // its retry). A part that fails is retried on one of the room's later messages, as any part (retryParts).
  function loadPartnerParts() {
    S.rooms.forEach(function (ctx) {
      if (ctx.id === S.homeId) return;
      var parts = roomParts(ctx, false).filter(function (p) { return p.name !== 'user' && !ctx.parts[p.name]; });
      if (!parts.length) return;
      runParts(ctx, parts).then(function (failed) {
        if (!failed.length) return;
        var names = ctx.retry ? ctx.retry.names.slice() : [];
        for (var i = 0; i < failed.length; i++) if (names.indexOf(failed[i]) < 0) names.push(failed[i]);
        noteFailedParts(ctx, names, PART_RETRY_MS);
      });
    });
  }

  function ensureLoaders() {
    startTier1();
    startTier2();
    startTier3();
    var home = S.rooms.home();
    if (home) {
      roomParts(home, true).forEach(function (p) {
        var settled = track(p.name, p.fn, function (res) { p.apply(res); changed({ roomId: home.id }); });
        if (p.name === 'bttv-channel') settled.then(S.homeBotsDone);
      });
      if (!S.cfg.demo) startLive(home.id);
    }
  }

  // ---------- boot ----------
  // A Twitch or Kick channel name the overlay can't use, said where it was written: in place of "No channel set", and
  // when the other platform's chat loads, so a typo doesn't leave one platform out without a word.
  function refusedHint(bad) {
    var out = [];
    var say = function (r, what, rule) {
      if (!r) return;
      var v = Array.from(r.value);
      out.push(what + ' "' + (v.length > 40 ? v.slice(0, 40).join('') + '…' : r.value) + '" in ' +
        (r.from === 'url' ? 'the overlay URL' : 'settings.js') + ' isn\'t a valid name: use ' + rule + ' only.');
    };
    say(bad.channel, 'Twitch channel', 'letters, numbers and _');
    say(bad.kick, 'Kick channel', 'letters, numbers, _ and -');
    return out.join(' ');
  }

  function boot() {
    if (S) return;
    T = root.TCO;
    // The page's query, a '#' typed in a value and what follows it included (config.pageQuery).
    var query = T.config.pageQuery(root.location);
    var cfg = T.config.parse(query, root.TCO_SETTINGS);
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
      homeAt: 0,
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
      cheerMaps: new T.util.LRU(16),
      histRooms: new Set(),
      said: new T.util.LRU(1000),
      botIds: new T.util.LRU(500),
      historyPending: false,
      historyStarting: false,
      historyLanded: false,
      liveBuffer: [],
      twitchTs: 0,
      gapAfter: 0,
      gapAbort: null,
      kickTs: 0,
      kickJoined: false,
      kickHistoryLanded: false,
      kickGap: null,
      kickGapAbort: null,
      kickBuffer: [],
      kick: null,
      kickLookup: null,
      kickChannel: null,
      kickRoom: '',
      kickStatus: 'idle',
      hints: {},
      kickStv: new Map(),
      kickSubBadges: [],
      stvChannel: null,
      demo: null
    };
    // The Kick channel's 7TV set as a room's: emotes (S.kickStv), set, owner, its connection index in the owner's 7TV
    // account, the switch in flight; userId: the Kick user id it loads by.
    S.kickCtx = { id: KICK_STV, userId: '', stv: { emotes: S.kickStv, setId: null, ownerId: null, connIndex: -1 } };
    // Settles once the home channel's BTTV data (its bot list) has loaded or failed once (whenBotsKnown).
    S.homeBots = new Promise(function (resolve) { S.homeBotsDone = function () { resolve(); }; });
    S.bus.on('changed', onChanged);
    S.stv = T.seventv.createState({
      bus: S.bus,
      onSetSwitch: onSetSwitch,
      loadSet: T.seventv.loadSet, // refetches a personal set that was evicted or skipped
      wantPersonal: function () { return !!S.cfg.emotes_7tv; } // read live: personal sets only while 7TV emotes are on
    });
    S.rooms = T.rooms.createRooms({ load: loadSourceRoom });

    S.renderer = T.renderer.createRenderer({
      root: chatEl,
      cfg: cfg,
      deps: { tokensFor: tokensFor, badgesFor: badgesFor, nameFor: nameFor, paintRule: paintRule, paintStaticRule: paintStaticRule,
        shouldShow: shouldShow, quoteHidden: quotesHidden }
    });
    S.renderer.hold(true);
    applyFonts(cfg);

    var sErr = settingsError();
    if (sErr) setHint('settings', 'settings.js has an error: ' + sErr, true);
    // A refused channel name stays up (sticky) over a chat that loads: the URL or settings.js is wrong.
    var badName = sErr || cfg.demo ? '' : refusedHint(T.config.refusedChannels(query, root.TCO_SETTINGS));
    if (badName) setHint('names', badName, true);
    // Without a channel there is nothing to show: load nothing (also when settings.js is broken).
    if (!cfg.channel && !cfg.kick && !cfg.demo) {
      if (!sErr && !badName) {
        setHint('nochan', 'No channel set. Add ?channel=yourname (Twitch) or ?kick=yourname (Kick) to the overlay URL, or use the builder.', true);
      }
      return;
    }

    if (root.addEventListener) root.addEventListener('message', onMessage);
    if (cfg.debug) setInterval(renderDebug, 2000);

    if (cfg.demo) {
      S.demo = T.demo.createDemo({
        getState: function () { return S; },
        feed: function (line) { onLine(T.ircParse.parseLine(line)); },
        feedKick: function (event, data) { onKickEvent(T.kick.parseEvent(event, data)); }
      });
    } else {
      S.stvLookup = T.seventv.createLookup({
        state: S.stv,
        isRelevant: function (uid) { return S.recentUsers.has(uid) || S.renderer.hasUser(uid); },
        onResult: function (uid) { changed({ userId: uid }); }
      });
    }

    startTier1();
    // Kick first: the Kick history waits for its channel lookup. (Neither socket delivers anything before history is
    // set up: both open asynchronously.)
    if (cfg.kick && !cfg.demo) startKick();
    startHistory();
    if (cfg.channel && !cfg.demo) {
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

    if (root.addEventListener) root.addEventListener('online', function () {
      if (S.irc) S.irc.kick();
      if (S.kick) S.kick.kick();
      if (S.stvEvents) S.stvEvents.kick();
      if (S.bttvLive) S.bttvLive.kick();
      S.loads.forEach(function (ctl) { if (ctl.status === 'failed') ctl.retryNow(); });
      applyFonts(S.cfg, true); // a font stylesheet that failed offline
    });
    // (The renderer itself flushes on visibilitychange / obsSourceVisibleChanged.)
    setInterval(function () {
      // Rooms with lines still on screen stay loaded, so a later rerender keeps their emotes and avatar.
      // (One walk over the lines every 5 minutes; the predicate never asks for a rebuild.)
      S.renderer.rerender(function (m) { if (m.mirrored) S.rooms.touch(m.sourceRoomId); return false; });
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
