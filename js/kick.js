/* Kick chat: channel lookup, the anonymous Pusher chat socket, and Kick events -> overlay messages. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var config = typeof require === 'function' ? require('./config.js') : root.TCO.config;
  var api = factory(root, util, config);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).kick = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, config) {
  'use strict';

  // Kick's public Pusher app, the one kick.com's own web client joins. Kick has rotated the key before: a
  // rotation shows up as a pusher:error 4001 (app does not exist), and only these two lines change.
  var PUSHER_KEY = '32cbd69e4b950bf97679';
  var PUSHER_CLUSTER = 'us2';
  var WS_URL = 'wss://ws-' + PUSHER_CLUSTER + '.pusher.com/app/' + PUSHER_KEY + '?protocol=7&client=js&version=8.4.0&flash=false';
  var CHANNEL_API = 'https://kick.com/api/v2/channels/';
  var EMOTE_CDN = 'https://files.kick.com/emotes/';
  var ROOM_RE = /^\d{1,12}$/;
  var ID_RE = /^[A-Za-z0-9-]{1,64}$/; // message uuids and numeric user ids
  var HEX_RE = /^#[0-9a-f]{6}$/i;
  // Hostile-input bounds, far above anything Kick sends (500 characters per message).
  var MAX_FRAME = 65536, MAX_CONTENT = 2000, MAX_NAME = 64, MAX_BADGES = 8;
  var PONG_TIMEOUT = 30000;
  var IDLE_CHECK_MS = 5000;
  var DEFAULT_ACTIVITY_S = 120;
  // Kick badge types the overlay draws (js/icons.js has one icon per type).
  var BADGE_TYPES = { broadcaster: 1, moderator: 1, vip: 1, og: 1, founder: 1, verified: 1, staff: 1, subscriber: 1, sub_gifter: 1 };
  var EV = 'App\\Events\\';
  var hasOwn = Object.prototype.hasOwnProperty;

  function safeCall(fn, a, b) {
    if (typeof fn !== 'function') return;
    try { fn(a, b); } catch (e) { util.warn('kick callback threw', e); }
  }

  function kickId(v) {
    var s = util.idStr(v);
    return ID_RE.test(s) ? 'kick:' + s : '';
  }
  function roomKey(v) {
    var s = util.idStr(v);
    return ROOM_RE.test(s) ? 'kick:' + s : '';
  }
  // A Kick username as shown: no control characters, at most MAX_NAME characters.
  function cleanName(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    return String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
  }
  // The login a Kick name is matched by (the block list, allow_users, highlight_users, the bot list, a reply's quote): in
  // lower case and without a leading '@'. Kick's StreamElements bot is "@StreamElements", and config.normalizeLogin takes
  // the '@' off what the streamer types, so 'streamelements' names it. The name is still shown as Kick sends it.
  function loginOf(name) {
    return name.replace(/^@+/, '').toLowerCase() || name.toLowerCase();
  }

  function apiUrl(slug) {
    return CHANNEL_API + encodeURIComponent(config.normalizeKick(slug));
  }

  // ---------- channel lookup ----------
  // Kick's channel JSON -> { chatroomId, channelId, userId, slug, username, subBadges: [{months, url}] }, or null.
  // channelId: the channel's own id (its recent messages are kept under it, not under the chatroom's; '' if missing).
  // wantSlug: the channel asked for; a reply for another channel is refused.
  function parseChannel(r, wantSlug) {
    if (!r || typeof r !== 'object') return null;
    var room = util.idStr(r.chatroom && typeof r.chatroom === 'object' ? r.chatroom.id : r.chatroom_id);
    if (!ROOM_RE.test(room)) return null;
    var slug = config.normalizeKick(r.slug);
    var want = config.normalizeKick(wantSlug);
    if (want && slug && slug !== want && slug !== want.replace(/_/g, '-')) return null;
    var uid = util.idStr(r.user_id);
    var cid = util.idStr(r.id);
    var user = r.user && typeof r.user === 'object' ? r.user : {};
    var subs = [];
    var list = Array.isArray(r.subscriber_badges) ? r.subscriber_badges.slice(0, 50) : [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var months = Number(b && b.months);
      var src = b && b.badge_image && typeof b.badge_image === 'object' ? b.badge_image.src : null;
      if (months >= 0 && months % 1 === 0 && months < 10000 && util.isSafeUrl(src, /^files\.kick\.com$/)) {
        subs.push({ months: months, url: src });
      }
    }
    subs.sort(function (a, c) { return a.months - c.months; });
    return {
      chatroomId: room,
      channelId: ROOM_RE.test(cid) ? cid : '',
      userId: ROOM_RE.test(uid) ? uid : '',
      slug: slug || want,
      username: cleanName(user.username) || slug || want,
      subBadges: subs
    };
  }

  // kick.com's channel API. It sits behind Cloudflare and may refuse cross-site requests: callers fall back
  // to a chatroom id set by hand (kick_room). null = no such channel.
  function lookupChannel(slug, opts) {
    var s = config.normalizeKick(slug);
    if (!s) return Promise.reject(new Error('kick: invalid channel name'));
    var o = { timeout: (opts && opts.timeout) || 10000, maxBytes: 2 * 1024 * 1024 };
    function get(name) {
      return util.fetchJson(CHANNEL_API + encodeURIComponent(name), o).then(function (r) {
        if (util.isNotFound(r)) return null;
        var c = parseChannel(r, s);
        if (!c) throw new Error('kick: unexpected channel response');
        return c;
      });
    }
    // Kick slugs spell a username's underscores as hyphens.
    return get(s).then(function (c) {
      return c || s.indexOf('_') < 0 ? c : get(s.replace(/_/g, '-'));
    });
  }

  // What someone pasted for the chatroom id: the number itself, or the whole channel API page.
  function roomFromText(text) {
    if (typeof text !== 'string' && typeof text !== 'number') return '';
    var s = String(text).trim();
    if (ROOM_RE.test(s)) return s;
    if (!s || s.length > 4 * 1024 * 1024) return '';
    try {
      var c = parseChannel(JSON.parse(s));
      if (c) return c.chatroomId;
    } catch (e) { /* not JSON: look for the field */ }
    var m = /"chatroom"\s*:\s*\{\s*"id"\s*:\s*(\d{1,12})[,}\s]/.exec(s) || /"chatroom_id"\s*:\s*(\d{1,12})[,}\s]/.exec(s);
    return m ? m[1] : '';
  }

  // ---------- messages ----------
  // "[emote:37226:KEKW] hi" -> { text: 'KEKW hi', emotes: '37226:0-3' }. The emote list uses the Twitch emotes
  // tag format (id:start-end, code points) so the tokenizer maps it like Twitch emotes.
  var EMOTE_TOKEN_RE = /\[emote:(\d{1,12}):([^\[\]]{0,100})\]/g;
  function cpLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) n++;
      else { var d = s.charCodeAt(i + 1); n++; if (d >= 0xdc00 && d <= 0xdfff) i++; }
    }
    return n;
  }
  // A Kick message can hold line breaks (BotRix sends "CHECK YOUR CHAT RANK\nhttps://...", and viewers can send several
  // lines), which a line draws as spaces anyway: each one is a space here, so the word after it is read on its own (a 7TV
  // emote's name, a link, a blocked word) as the tokenizer splits words at spaces. One character for one, so the emote
  // codes' code-point ranges stay as they are.
  var LINE_BREAK_RE = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
  function splitEmotes(content) {
    var src = typeof content === 'string' ? content : '';
    if (src.length > MAX_CONTENT) src = src.slice(0, MAX_CONTENT);
    src = src.replace(LINE_BREAK_RE, ' ');
    var text = '', cp = 0, last = 0, byId = Object.create(null), order = [];
    EMOTE_TOKEN_RE.lastIndex = 0;
    var m;
    while ((m = EMOTE_TOKEN_RE.exec(src))) {
      var before = src.slice(last, m.index);
      text += before;
      cp += cpLen(before);
      var name = m[2].replace(/\s+/g, '') || 'emote';
      var len = cpLen(name);
      if (!byId[m[1]]) { byId[m[1]] = []; order.push(m[1]); }
      byId[m[1]].push(cp + '-' + (cp + len - 1));
      text += name;
      cp += len;
      last = m.index + m[0].length;
    }
    text += src.slice(last);
    var groups = [];
    for (var i = 0; i < order.length; i++) groups.push(order[i] + ':' + byId[order[i]].join(','));
    return { text: text, emotes: groups.join('/') };
  }

  function parseBadges(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    var seen = Object.create(null);
    for (var i = 0; i < list.length && i < 50 && out.length < MAX_BADGES; i++) {
      var b = list[i];
      var type = b && typeof b.type === 'string' ? b.type.toLowerCase() : '';
      if (!hasOwn.call(BADGE_TYPES, type) || seen[type]) continue;
      seen[type] = 1;
      var count = Number(b.count);
      out.push({
        type: type,
        text: typeof b.text === 'string' ? util.capMarks(cleanName(b.text).slice(0, 40)) : '',
        count: count >= 0 && count % 1 === 0 && count < 1e6 ? count : 0
      });
    }
    return out;
  }

  // Kick's own Bot badge (StreamElements, Botrix and other verified bots carry it): not drawn, but the bot filter
  // (bots=0) hides the sender's lines whatever its name.
  function hasBotBadge(list) {
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length && i < 50; i++) {
      var b = list[i];
      if (b && typeof b.type === 'string' && b.type.toLowerCase() === 'bot') return true;
    }
    return false;
  }

  // Kick has sent metadata both as an object and as a JSON string.
  function objectOf(v) {
    if (v && typeof v === 'object') return v;
    if (typeof v === 'string' && v.length < 16384) {
      try { var o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
    }
    return null;
  }

  function replyOf(d) {
    var meta = objectOf(d.metadata);
    if (!meta) return null;
    var os = objectOf(meta.original_sender), om = objectOf(meta.original_message);
    if (!os || !om) return null;
    var name = cleanName(os.username);
    var id = kickId(om.id);
    if (!name || !id) return null;
    var r = { id: id, userId: kickId(os.id), login: loginOf(name), name: name, body: splitEmotes(om.content).text };
    // The parent's sender with Kick's Bot badge, when the reply's data says so (kick.com's history gives the badges):
    // bots=0 then leaves the quote out, as it hides the bot's own lines. Set only then, so other replies keep their shape.
    var osIdent = objectOf(os.identity), omSender = objectOf(om.sender), omIdent = omSender && objectOf(omSender.identity);
    if (hasBotBadge(osIdent && osIdent.badges) || hasBotBadge(omIdent && omIdent.badges)) r.bot = true;
    // When the quoted message was said, when the reply's data gives it (kick.com's history does): loadHistory judges by
    // it whether kick.com left that message out of its list. Set only then, so other replies keep their shape.
    var pts = typeof om.created_at === 'string' ? Date.parse(om.created_at) : NaN;
    if (isFinite(pts)) r.ts = pts;
    return r;
  }

  function base(d) {
    return {
      platform: 'kick',
      id: '',
      sourceId: '',
      roomId: roomKey(d && d.chatroom_id),
      sourceRoomId: '',
      mirrored: false,
      userId: '',
      login: '',
      displayName: '',
      color: '',
      badges: [],
      sourceBadges: [],
      kickBadges: [],
      ts: Date.now(),
      historical: false,
      text: '',
      action: false,
      emotes: '',
      kickEmotes: '',
      gifs: '',
      bits: 0,
      msgId: '',
      firstMsg: false,
      reply: null
    };
  }

  // ChatMessageEvent data -> a chat message in the renderer's shape (see irc-parse.js), or null.
  // Ids are namespaced ('kick:<id>') so Twitch moderation and Twitch-keyed lookups never touch Kick lines.
  function toMessage(d) {
    if (!d || typeof d !== 'object') return null;
    var s = d.sender && typeof d.sender === 'object' ? d.sender : null;
    var id = kickId(d.id), uid = s ? kickId(s.id) : '';
    var name = s ? cleanName(s.username) : '';
    if (!id || !uid || !name) return null;
    var ident = s.identity && typeof s.identity === 'object' ? s.identity : {};
    var body = splitEmotes(d.content);
    var ts = Date.parse(d.created_at);
    var m = base(d);
    m.id = id;
    m.userId = uid;
    m.login = loginOf(name);
    m.displayName = name;
    m.color = typeof ident.color === 'string' && HEX_RE.test(ident.color) ? ident.color : '';
    m.kickBadges = parseBadges(ident.badges);
    // Set only on a bot's lines, so every other message keeps its shape.
    if (hasBotBadge(ident.badges)) m.kickBot = true;
    m.ts = isFinite(ts) ? ts : Date.now();
    m.kind = 'chat';
    m.text = body.text;
    m.kickEmotes = body.emotes;
    m.reply = d.type === 'reply' ? replyOf(d) : null;
    return m;
  }

  // Sub, gift and host events -> a notice line (kind 'notice', like a Twitch USERNOTICE without user text).
  // login is the person the notice is about, so the block list covers it.
  function toNotice(type, systemMsg, login, d) {
    var m = base(d);
    m.kind = 'notice';
    m.type = type;
    m.msgId = type;
    m.login = loginOf(login);
    m.systemMsg = systemMsg;
    m.params = {};
    m.communityGiftId = '';
    m.announceColor = '';
    return m;
  }

  function count(v, max) {
    var n = Number(v);
    return n >= 0 && n % 1 === 0 && n <= max ? n : 0;
  }

  // A Pusher event -> { type: 'message'|'notice'|'delete'|'ban'|'clear', ... } or null.
  // data may be the JSON string Pusher sends or an already parsed object.
  function parseEvent(event, data) {
    if (typeof event !== 'string' || event.indexOf(EV) !== 0) return null;
    var d = typeof data === 'string' ? (data.length <= MAX_FRAME ? objectOf(data) : null) : objectOf(data);
    if (!d) return null;
    var name, m;
    switch (event.slice(EV.length)) {
      case 'ChatMessageEvent':
        m = toMessage(d);
        return m ? { type: 'message', msg: m } : null;
      case 'MessageDeletedEvent': {
        var msg = objectOf(d.message);
        var mid = kickId(msg && msg.id);
        return mid ? { type: 'delete', id: mid } : null;
      }
      case 'UserBannedEvent': {
        var u = objectOf(d.user);
        var bid = kickId(u && u.id);
        return bid ? { type: 'ban', userId: bid, login: loginOf(cleanName(u.username)) } : null;
      }
      case 'ChatroomClearEvent':
        return { type: 'clear' };
      case 'SubscriptionEvent': {
        name = cleanName(d.username);
        if (!name) return null;
        var months = count(d.months, 1000);
        m = months > 1
          ? toNotice('resub', name + ' subscribed for ' + months + ' months!', name, d)
          : toNotice('sub', name + ' subscribed!', name, d);
        return { type: 'notice', msg: m };
      }
      case 'GiftedSubscriptionsEvent': {
        var gifted = Array.isArray(d.gifted_usernames) ? d.gifted_usernames : [];
        var n = Math.min(gifted.length, 100000);
        if (!n) return null;
        name = cleanName(d.gifter_username) || 'Anonymous';
        var text = n === 1 && cleanName(gifted[0])
          ? name + ' gifted a sub to ' + cleanName(gifted[0]) + '!'
          : name + ' gifted ' + n + ' subs!';
        return { type: 'notice', msg: toNotice(n === 1 ? 'subgift' : 'submysterygift', text, name, d) };
      }
      case 'StreamHostEvent': {
        name = cleanName(d.host_username);
        if (!name) return null;
        var viewers = count(d.number_viewers, 1e8);
        var raid = name + ' is hosting' + (viewers ? ' with ' + viewers + ' viewer' + (viewers === 1 ? '' : 's') : '') + '!';
        return { type: 'notice', msg: toNotice('raid', raid, name, d) };
      }
    }
    return null;
  }

  // ---------- recent messages ----------
  // The channel's newest chat messages (kick.com keeps about 25, under the channel's id; its chatroom id gives none), as
  // the overlay's start-up history: kick.com's API, behind Cloudflare like the channel lookup, so it may be refused (then
  // there is none, as before). Each is a ChatMessageEvent's data without the chatroom id, which the lines are keyed by
  // (chatroomId, the one the overlay joined), so it is set on a copy. Oldest first, marked historical; at most HISTORY_MAX,
  // none older than a day (robotty keeps Twitch's that long), and [] when there are none. Every request has an address of
  // its own (?_=): kick.com lets its answer be kept for 10 s, and Cloudflare's edge serves that copy whatever the request
  // asks, so an answer from before an outage (or from before the overlay joined) left out what was said and deleted since.
  // kick.com's list leaves out a deleted message and a banned user's, but a reply keeps its own copy of the message it
  // answers: a reply quoting a message said strictly between the list's oldest and newest (its times are to the second, so
  // the messages of those two seconds may be missing for no reason) and not in it is marked (reply.gone): the message was
  // deleted, or its sender banned, and the header would put it back on stream.
  var HISTORY_MAX = 50, HISTORY_AGE_MS = 86400000;
  var historyBust = 0;
  function loadHistory(channelId, chatroomId, opts) {
    var ch = util.idStr(channelId), room = util.idStr(chatroomId);
    if (!ROOM_RE.test(ch) || !ROOM_RE.test(room)) return Promise.resolve([]);
    var o = { timeout: (opts && opts.timeout) || 10000, maxBytes: 2 * 1024 * 1024 };
    historyBust = Math.max(Date.now(), historyBust + 1);
    return util.fetchJson(CHANNEL_API + ch + '/messages?_=' + historyBust, o).then(function (r) {
      if (!r || util.isNotFound(r)) return [];
      var data = r.data && typeof r.data === 'object' ? r.data : null;
      if (!data || !Array.isArray(data.messages)) throw new Error('kick: unexpected history response');
      var list = data.messages.slice(0, HISTORY_MAX), now = Date.now(), out = [];
      // Every entry kick.com listed counts for what it left out, also one the overlay doesn't show (too old, unreadable).
      var listed = {}, lo = Infinity, hi = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
        var lid = kickId(d.id), at = Date.parse(d.created_at);
        if (lid) listed[lid] = true;
        if (isFinite(at)) {
          if (at < lo) lo = at;
          if (at > hi) hi = at;
        }
        var copy = {};
        for (var k in d) if (hasOwn.call(d, k)) copy[k] = d[k];
        copy.chatroom_id = room;
        var m = isFinite(at) && now - at < HISTORY_AGE_MS ? toMessage(copy) : null;
        if (!m) continue;
        m.historical = true;
        out.push(m);
      }
      out.forEach(function (m) {
        var rp = m.reply;
        if (rp && !hasOwn.call(listed, rp.id) && rp.ts > lo && rp.ts < hi) rp.gone = true;
      });
      out.sort(function (a, b) { return a.ts - b.ts; });
      return out;
    });
  }

  // ---------- Pusher client ----------
  // opts: { room: chatroom id, onEvent(ev), onStatus(status, detail), WebSocket?, url? }
  // status: 'open'; 'joined' (subscribed); 'closed' ({code, reason}); 'fatal' ({code, message}: Kick refused
  // the app key or the connection for good; the client stops).
  function createKick(opts) {
    opts = opts || {};
    var room = util.idStr(opts.room);
    var channel = ROOM_RE.test(room) ? 'chatrooms.' + room + '.v2' : '';
    var conn = null; // per connection: { gen, joined, pong, last (ms of the last frame), activity (s) }
    var stopped = true;

    function status(s, detail) { safeCall(opts.onStatus, s, detail); }

    function fatal(ctl, code, message) {
      conn = null;
      status('fatal', { code: code, message: message || '' });
      ctl.stop('pusher error ' + code);
    }

    // Pusher's close/error codes: 4000-4099 never reconnect, 4100-4199 reconnect after a while,
    // 4200-4299 reconnect now.
    function onPusherCode(ctl, code, message) {
      if (code >= 4000 && code < 4100) { fatal(ctl, code, message); return true; }
      if (code >= 4200 && code < 4300) { conn = null; ctl.reconnect('pusher ' + code, { delay: 0 }); return true; }
      if (code >= 4100 && code < 4200) { conn = null; ctl.reconnect('pusher ' + code); return true; }
      return false;
    }

    function send(ctl, event, data) { ctl.send(JSON.stringify({ event: event, data: data })); }

    // Pusher's keepalive: after activity_timeout seconds without a frame, ping; no answer in 30 s, reconnect.
    function checkIdle(ctl) {
      var c = conn;
      if (!c || c.gen !== ctl.gen || c.pong || Date.now() - c.last < c.activity * 1000) return;
      send(ctl, 'pusher:ping', {});
      c.pong = ctl.setTimeout(function () {
        c.pong = null;
        if (conn !== c) return;
        conn = null;
        ctl.reconnect('pong timeout');
        status('closed', { code: 0, reason: 'pong timeout' });
      }, PONG_TIMEOUT);
    }

    function onOpen(ctl) {
      conn = { gen: ctl.gen, joined: false, pong: null, last: Date.now(), activity: DEFAULT_ACTIVITY_S };
      ctl.setInterval(function () { checkIdle(ctl); }, IDLE_CHECK_MS);
      status('open');
    }

    function onMessage(data, ctl) {
      var c = conn;
      if (!c || c.gen !== ctl.gen || stopped) return;
      if (typeof data !== 'string' || data.length > MAX_FRAME) return;
      var f;
      try { f = JSON.parse(data); } catch (e) { return; }
      if (!f || typeof f !== 'object' || typeof f.event !== 'string') return;
      // Any frame proves the connection is alive.
      c.last = Date.now();
      if (c.pong) { ctl.clearTimer(c.pong); c.pong = null; }
      switch (f.event) {
        case 'pusher:connection_established': {
          var info = objectOf(f.data) || {};
          var t = Number(info.activity_timeout);
          if (t >= 10 && t <= 600) c.activity = Math.floor(t);
          if (channel) send(ctl, 'pusher:subscribe', { auth: '', channel: channel });
          return;
        }
        case 'pusher:ping':
          send(ctl, 'pusher:pong', {});
          return;
        case 'pusher:pong':
          return;
        case 'pusher:error': {
          var err = objectOf(f.data) || {};
          var code = Number(err.code);
          util.warn('kick: pusher error', code, err.message || '');
          onPusherCode(ctl, code, typeof err.message === 'string' ? err.message.slice(0, 200) : '');
          return;
        }
        case 'pusher_internal:subscription_succeeded':
          if (f.channel === channel && !c.joined) { c.joined = true; status('joined'); }
          return;
      }
      if (f.channel !== channel) return;
      var ev = parseEvent(f.event, f.data);
      if (ev) safeCall(opts.onEvent, ev);
    }

    function onClose(ev, ctl) {
      conn = null;
      var code = ev && ev.code;
      status('closed', { code: code, reason: (ev && ev.reason) || '' });
      if (code >= 4000 && code < 4100) fatal(ctl, code, ev.reason);
      else if (code >= 4200 && code < 4300) ctl.reconnect('pusher ' + code, { delay: 0 });
    }

    var client = new util.SocketClient({
      name: 'kick',
      url: opts.url || WS_URL,
      WebSocket: opts.WebSocket,
      baseDelay: 1000,
      maxDelay: 30000,
      onOpen: onOpen,
      onMessage: onMessage,
      onClose: onClose
    });

    return {
      room: room,
      start: function () {
        if (!channel) { status('fatal', { code: 0, message: 'invalid chatroom id' }); return; }
        stopped = false;
        client.start();
      },
      stop: function () { stopped = true; conn = null; client.stop('stopped'); },
      kick: function () { client.kick(); }
    };
  }

  return {
    WS_URL: WS_URL,
    CHANNEL_API: CHANNEL_API,
    EMOTE_CDN: EMOTE_CDN,
    BADGE_TYPES: Object.keys(BADGE_TYPES),
    apiUrl: apiUrl,
    parseChannel: parseChannel,
    lookupChannel: lookupChannel,
    loadHistory: loadHistory,
    roomFromText: roomFromText,
    splitEmotes: splitEmotes,
    parseBadges: parseBadges,
    loginOf: loginOf,
    toMessage: toMessage,
    parseEvent: parseEvent,
    createKick: createKick
  };
});
