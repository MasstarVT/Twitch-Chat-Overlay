/* Mix It Up (the streamer's desktop bot): YouTube live chat read from its local overlay socket -> overlay messages. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).mixitup = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  // Mix It Up's overlay server (8111 unless the streamer changed it). A Chat widget whose Display Option is 'Single Widget
  // URL' is served at http://localhost:<port>/overlay/<guid> and talks over ws://localhost:<port>/ws/<guid>/: the guid is
  // both the endpoint's id and the widget's. A socket joins its endpoint as it connects. An unknown guid, a disabled widget
  // or another endpoint's link connects too, and never hears a word of the widget's: so the client says
  // {"Type":"ConnectionStart","Data":""} on open, as Mix It Up's own overlay page does, and an enabled widget answers with
  // its HTML (an 'Add' packet naming the widget's guid). That answer, or any of the widget's chat, means the link works.
  // A widget disabled while the socket is open takes its HTML away (a 'Remove' naming it) and says nothing more; one
  // reset or edited takes it away and gives it again (Remove, then Add).
  var DEFAULT_PORT = 8111;
  var GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  var GUID_RE = new RegExp('^' + GUID + '$', 'i');
  var BARE_GUID_RE = new RegExp('^(?:\\{(' + GUID + ')\\}|(' + GUID + '))$', 'i');
  // The widget's link, or its socket's, on this computer only: nothing between '//' and the host (no user@), nothing
  // after the host but a port. The link may carry a query or a hash, which is dropped.
  var LINK_RE = new RegExp('^https?://(?:localhost|127\\.0\\.0\\.1)(?::(\\d{1,5}))?/overlay/(' + GUID + ')/?(?:[?#]\\S*)?$', 'i');
  var SOCKET_RE = new RegExp('^wss?://(?:localhost|127\\.0\\.0\\.1)(?::(\\d{1,5}))?/ws/(' + GUID + ')/?$', 'i');
  // Mix It Up's default endpoint: it carries every widget's traffic, other widgets' add and remove calls among it.
  var ZERO_GUID = '00000000-0000-0000-0000-000000000000';
  var MIN_PORT = 1024, MAX_PORT = 65535;
  // YouTube's live chat message ids ('LCC.CjgKDQoL...'): base64 and URL-escaped text. Permissive, but no space, control,
  // quote, angle bracket or backslash, which no real id holds.
  var MSG_ID_RE = /^[^\s\u0000-\u001f\u007f-\u009f<>"'`\\]{1,512}$/;
  // A YouTube channel id ('UC' and 22 base64url characters), the stable key of a chatter.
  var USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var HEX_RE = /^#[0-9a-f]{6}$/i;
  // StreamingPlatformTypeEnum.YouTube.
  var YOUTUBE = 3;
  // Hostile-input bounds, far above anything Mix It Up sends (YouTube allows 200 characters per message, one part per
  // word; each add carries the sender's whole user, ~4.4 KB, and a frame may batch hundreds). Text past MAX_CPS code
  // points is dropped, as the tokenizer would.
  var MAX_FRAME = 8 * 1024 * 1024, MAX_PACKETS = 500, MAX_PARTS = 500, MAX_CPS = 1000, MAX_PART = 2 * MAX_CPS;
  var MAX_EMOTES = 100, MAX_NAME = 100, MAX_EMOTE_NAME = 100, MAX_ROLES = 50;
  // UserRoleEnum, by number (Newtonsoft writes the set as numbers) or by name: the role badge each one gives.
  // Subscriber (600) comes with YouTubeMember (601) on YouTube.
  var ROLE_NUMBERS = { 900: 'owner', 800: 'moderator', 601: 'member', 600: 'member' };
  var ROLE_NAMES = { streamer: 'owner', moderator: 'moderator', youtubemember: 'member', subscriber: 'member' };
  // Most important first.
  var BADGE_TYPES = ['owner', 'moderator', 'member'];
  var HELLO = JSON.stringify({ Type: 'ConnectionStart', Data: '' });
  var TEST_REPLY = JSON.stringify({ Type: 'Test', Data: '' });
  // A socket that never opens: Mix It Up is on this computer, so 8 s is plenty.
  var CONNECT_TIMEOUT = 8000;
  // An open socket that hasn't heard from the widget by then is the wrong one (see above), or one Mix It Up took while it
  // was still starting and never gave the widget: it is dropped and made again.
  var READY_MS = 6000;
  var hasOwn = Object.prototype.hasOwnProperty;

  function safeCall(fn, a) {
    if (typeof fn !== 'function') return;
    try { fn(a); } catch (e) { util.warn('mixitup callback threw', e); }
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // ---------- the widget's link ----------
  // A GUID in any case, bare or in braces -> lower case; '' for anything else, and for the default endpoint's.
  function cleanGuid(v) {
    if (typeof v !== 'string' || v.length > 64) return '';
    var m = BARE_GUID_RE.exec(v.trim());
    var g = m ? (m[1] || m[2]).toLowerCase() : '';
    return g === ZERO_GUID ? '' : g;
  }
  // A port (digits, or an integer) from 1024 to 65535; none given is Mix It Up's default. 0 for anything else.
  function cleanPort(v) {
    if (v === undefined || v === null || v === '') return DEFAULT_PORT;
    var s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
    if (!/^\d{1,5}$/.test(s)) return 0;
    var n = Number(s);
    return n >= MIN_PORT && n <= MAX_PORT ? n : 0;
  }

  // What the streamer pasted -> { guid, port }, or null. The widget's GUID on its own (Mix It Up's default port), its
  // link (http://localhost:8111/overlay/<guid>) or its socket's (ws://localhost:8111/ws/<guid>/). Nothing else: another
  // host, a path of another shape, a port below 1024 or the default endpoint's all-zeros GUID.
  function parseLink(text) {
    if (typeof text !== 'string' || text.length > 2048) return null;
    var s = text.trim();
    var m = BARE_GUID_RE.exec(s), guid, port;
    if (m) {
      guid = m[1] || m[2];
      port = DEFAULT_PORT;
    } else {
      m = LINK_RE.exec(s) || SOCKET_RE.exec(s);
      if (!m) return null;
      guid = m[2];
      port = cleanPort(m[1]);
    }
    guid = guid.toLowerCase();
    if (guid === ZERO_GUID || !port) return null;
    return { guid: guid, port: port };
  }

  // The widget's socket and page, built only from a checked GUID and port ('' if either is not one).
  function wsUrl(guid, port) {
    var g = cleanGuid(guid), p = cleanPort(port);
    return g && p ? 'ws://localhost:' + p + '/ws/' + g + '/' : '';
  }
  function widgetUrl(guid, port) {
    var g = cleanGuid(guid), p = cleanPort(port);
    return g && p ? 'http://localhost:' + p + '/overlay/' + g : '';
  }

  // ---------- messages ----------
  // Ids are namespaced ('youtube:<id>') so Twitch and Kick moderation and lookups never touch YouTube lines.
  function idOf(v) {
    return typeof v === 'string' && MSG_ID_RE.test(v) ? 'youtube:' + v : '';
  }
  // A chatter: its YouTube channel id, or failing that Mix It Up's own id for them (a GUID).
  function userKey(user) {
    if (!isObj(user)) return '';
    var pid = user.PlatformID;
    if (typeof pid === 'string' && USER_ID_RE.test(pid)) return 'youtube:' + pid;
    var g = typeof user.ID === 'string' && GUID_RE.test(user.ID) ? user.ID.toLowerCase() : '';
    return g && g !== ZERO_GUID ? 'youtube:' + g : '';
  }

  function isYouTube(v) {
    return v === YOUTUBE || (typeof v === 'string' && v.length < 20 && v.trim().toLowerCase() === 'youtube');
  }

  // s cut to at most n code points, never inside a surrogate pair.
  function cutCps(s, n) {
    if (s.length <= n) return s;
    var a = Array.from(s);
    return a.length <= n ? s : a.slice(0, n).join('');
  }
  // A long string cut to MAX_PART code units before any other work, never inside a surrogate pair.
  function clip(s) {
    if (s.length <= MAX_PART) return s;
    var c = s.charCodeAt(MAX_PART - 1);
    return s.slice(0, c >= 0xd800 && c <= 0xdbff ? MAX_PART - 1 : MAX_PART);
  }
  function cpLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) n++;
      else { var d = s.charCodeAt(i + 1); n++; if (d >= 0xdc00 && d <= 0xdfff) i++; }
    }
    return n;
  }

  // A YouTube name as shown: no control characters and no bidi overrides (which would turn the rest of the line around),
  // at most MAX_NAME code points. Spaces, dots and any script stay: a YouTube name can't be a Twitch login. A name of
  // nothing but invisible characters (zero-width spaces and joiners, direction marks, word joiners, BOMs, Hangul fillers,
  // tag characters) is no name: ''.
  var NAME_STRIP_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
  var INVISIBLE_RE = /[\s\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2060-\u2064\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/gu;
  function cleanName(v) {
    if (typeof v !== 'string') return '';
    var s = cutCps(clip(v).replace(NAME_STRIP_RE, '').trim(), MAX_NAME).trim();
    return s.replace(INVISIBLE_RE, '') ? s : '';
  }
  // The login a YouTube name is matched by (the block list, allow_users, highlight_users): in lower case, without a
  // leading '@' (Mix It Up takes it off already), and '-' read as '_' as config.normalizeLogin writes those lists (a
  // YouTube handle may hold '-' and '.'; '.' stays).
  function loginOf(name) {
    return (name.replace(/^@+/, '') || name).toLowerCase().replace(/-/g, '_');
  }

  // The chatter's roles -> their role badges ({ type }), most important first, each once.
  function roleType(r) {
    var key = typeof r === 'number' ? (r % 1 === 0 ? String(r) : '') : typeof r === 'string' && r.length <= 40 ? r.trim().toLowerCase() : '';
    if (hasOwn.call(ROLE_NUMBERS, key)) return ROLE_NUMBERS[key];
    return hasOwn.call(ROLE_NAMES, key) ? ROLE_NAMES[key] : '';
  }
  function parseRoles(roles) {
    var have = Object.create(null), out = [];
    if (!Array.isArray(roles)) return out;
    for (var i = 0; i < roles.length && i < MAX_ROLES; i++) {
      var t = roleType(roles[i]);
      if (t) have[t] = true;
    }
    for (var j = 0; j < BADGE_TYPES.length; j++) if (have[BADGE_TYPES[j]]) out.push({ type: BADGE_TYPES[j] });
    return out;
  }

  function emoteUrl(v) {
    var u = typeof v === 'string' ? util.absUrl(v) : null;
    return u && util.isSafeUrl(u) ? u : '';
  }

  // Mix It Up's message parts -> { text, emotes }. YouTube's text comes one word per Text part (split at spaces), and a
  // YouTube emoji or BetterTTV emote as an Emote part: its name (':hand-pink-waving:', 'monkaS') is the word in the text,
  // and emotes maps that word to its image (https only; with another URL the word stays text). An emote without a name is
  // ':emoji-1:', ':emoji-2:'... by image. emotes has no prototype, so words like '__proto__' are only keys; at most
  // MAX_EMOTES of them, each a whole word of the text (the text is cut before an emote that doesn't fit).
  var LINE_BREAK_RE = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
  var EMOTE_NAME_STRIP_RE = /[\s\u0000-\u001f\u007f-\u009f]+/g;
  function readParts(list) {
    var words = [], cps = 0, emotes = Object.create(null), count = 0, unnamed = Object.create(null), nUnnamed = 0;
    if (!Array.isArray(list)) return { text: '', emotes: emotes };
    for (var i = 0; i < list.length && i < MAX_PARTS; i++) {
      var p = list[i];
      if (!isObj(p) || typeof p.Type !== 'string') continue;
      var type = p.Type.toLowerCase(), word = '', url = '';
      if (type === 'text') {
        word = typeof p.Content === 'string' ? clip(p.Content).replace(LINE_BREAK_RE, ' ').trim() : '';
      } else if (type === 'emote') {
        url = emoteUrl(p.Content);
        word = typeof p.Name === 'string' ? cutCps(clip(p.Name).replace(EMOTE_NAME_STRIP_RE, ''), MAX_EMOTE_NAME) : '';
        if (!word && url) word = hasOwn.call(unnamed, url) ? unnamed[url] : (unnamed[url] = ':emoji-' + (++nUnnamed) + ':');
      }
      if (!word) continue;
      var room = MAX_CPS - cps - (words.length ? 1 : 0), len = cpLen(word);
      if (len > room) {
        if (!url && room > 0) words.push(cutCps(word, room).trim());
        break;
      }
      words.push(word);
      cps += len + (words.length > 1 ? 1 : 0);
      if (url && !hasOwn.call(emotes, word) && count < MAX_EMOTES) {
        emotes[word] = url;
        count++;
      }
    }
    return { text: words.join(' ').trim(), emotes: emotes };
  }

  function base(guid) {
    return {
      platform: 'youtube',
      id: '',
      sourceId: '',
      roomId: 'youtube:' + cleanGuid(guid),
      sourceRoomId: '',
      mirrored: false,
      userId: '',
      login: '',
      displayName: '',
      color: '',
      badges: [],
      sourceBadges: [],
      kickBadges: [],
      youtubeBadges: [],
      ts: Date.now(),
      historical: false,
      text: '',
      action: false,
      emotes: '',
      kickEmotes: '',
      youtubeEmotes: Object.create(null),
      gifs: '',
      bits: 0,
      msgId: '',
      firstMsg: false,
      reply: null
    };
  }

  // Mix It Up sends no time: a line is stamped when it arrives (now: a function or a number, for tests).
  function stamp(now) {
    var t = NaN;
    if (typeof now === 'function') {
      try { t = Number(now()); } catch (e) { t = NaN; }
    } else if (typeof now === 'number') t = now;
    return isFinite(t) && t > 0 ? t : Date.now();
  }

  // The chat widget's 'add' parameters -> a chat message in the renderer's shape (see irc-parse.js), or null. Only a
  // YouTube one: the widget sends every platform's chat unless the streamer picked some, and the overlay reads Twitch and
  // Kick itself. guid: the widget's, for roomId.
  function toMessage(params, now, guid) {
    if (!isObj(params) || !isYouTube(params.Platform)) return null;
    var user = isObj(params.User) ? params.User : null;
    var id = idOf(params.MessageID), uid = userKey(user);
    var name = user ? cleanName(user.DisplayName) || cleanName(user.Username) : '';
    if (!id || !uid || !name) return null;
    var body = readParts(params.Message);
    if (!body.text) return null;
    var m = base(guid);
    m.id = id;
    m.userId = uid;
    m.login = loginOf(name);
    m.displayName = name;
    // null unless the streamer gave YouTube names colors in Mix It Up (ColorInApp is an app resource key, never a color).
    m.color = typeof user.Color === 'string' && HEX_RE.test(user.Color) ? user.Color : '';
    m.youtubeBadges = parseRoles(user.Roles);
    m.ts = stamp(now);
    m.kind = 'chat';
    m.text = body.text;
    m.youtubeEmotes = body.emotes;
    return m;
  }

  // One packet -> an event, or null. Only Function calls on the chat widget matter, with Mix It Up's connection test and
  // the widget's HTML coming and going (an 'Add', its answer to ConnectionStart, and a 'Remove': only their guid is
  // read). Clear packets are about HTML too; Debug and ResponsiveVoice are not chat.
  function packetEvent(p, want, now) {
    if (!isObj(p)) return null;
    if (p.Type === 'Test') return { type: 'test' };
    if (p.Type === 'Add' || p.Type === 'Remove') {
      var hid = isObj(p.Data) ? cleanGuid(p.Data.ID) : '';
      if (!hid || (want !== null && hid !== want)) return null;
      return { type: p.Type === 'Add' ? 'widget' : 'gone', id: hid };
    }
    if (p.Type !== 'Function') return null;
    var d = p.Data;
    if (!isObj(d) || typeof d.FunctionName !== 'string' || d.FunctionName.length > 40) return null;
    // Another widget's call (when the endpoint is shared).
    if (want !== null && typeof d.ID === 'string') {
      var wid = cleanGuid(d.ID);
      if (!wid || wid !== want) return null;
    }
    var params = isObj(d.Parameters) ? d.Parameters : {};
    switch (d.FunctionName.toLowerCase()) {
      case 'add': {
        var m = toMessage(params, now, want || '');
        return m ? { type: 'message', msg: m } : null;
      }
      case 'remove': {
        // A deleted message (any platform's: the id is namespaced, so another platform's matches no YouTube line).
        if (params.MessageID !== undefined && params.MessageID !== null) {
          var mid = idOf(params.MessageID);
          return mid ? { type: 'delete', id: mid } : null;
        }
        // A banned or timed-out chatter: only a YouTube one (Mix It Up doesn't send YouTube's yet).
        var u = isObj(params.User) ? params.User : null;
        var bid = u && isYouTube(u.Platform) ? userKey(u) : '';
        if (!bid) return null;
        return { type: 'ban', userId: bid, login: loginOf(cleanName(u.DisplayName) || cleanName(u.Username) || cleanName(params.Username)) };
      }
      // 'clear' is no YouTube clear: the widget calls it when any platform's chat is cleared (a Twitch /clear), and Mix It
      // Up clears nothing on YouTube. A message YouTube takes away still comes as a remove.
    }
    return null;
  }

  // A socket frame (the JSON text, or it parsed) -> its events in order ([] for anything unreadable):
  // { type: 'message', msg }, { type: 'delete', id }, { type: 'ban', userId, login }, and for the client itself,
  // { type: 'test' } (Mix It Up's connection test), { type: 'widget', id } (the widget's HTML arrived) and
  // { type: 'gone', id } (it was taken away: the widget was disabled, reset or edited).
  // Mix It Up sends one packet or, batched, an array of them. opts: { now, guid }: with a guid, a call or HTML naming
  // another widget is left out.
  function parsePacket(data, opts) {
    opts = isObj(opts) ? opts : {};
    var list = data;
    if (typeof data === 'string') {
      if (data.length > MAX_FRAME) return [];
      try { list = JSON.parse(data); } catch (e) { return []; }
    }
    if (isObj(list)) list = [list];
    if (!Array.isArray(list)) return [];
    var want = typeof opts.guid === 'string' && opts.guid ? cleanGuid(opts.guid) : null;
    var out = [];
    for (var i = 0; i < list.length && i < MAX_PACKETS; i++) {
      var ev = packetEvent(list[i], want, opts.now);
      if (ev) out.push(ev);
    }
    return out;
  }

  // ---------- socket client ----------
  // opts: { guid, port, onEvent(ev), onStatus(status), WebSocket?, url?, now?, readyMs? }
  // onEvent gets the widget's message, delete and ban events (parsePacket), in order. onStatus gets one object:
  //   { type: 'open' }: a socket opened (ConnectionStart is said at once);
  //   { type: 'ready' }: the widget answered ConnectionStart or sent chat: the link works. Once a connection, and again
  //     each time the widget comes back after it was taken away (a 'Remove' naming it: unready, as if just opened);
  //   { type: 'silent' }: a connection not ready readyMs (6 s) after it opened, or after the widget was taken away: the
  //     wrong link, a disabled widget, or Mix It Up still starting. The socket is dropped (no 'closed' for it) and made
  //     again with backoff, so it comes once a connection;
  //   { type: 'closed', code, reason }: each drop and each failed attempt (a run of them with no 'open' means Mix It Up
  //     isn't running, or its overlay server is off);
  //   { type: 'fatal', message }: start() with an invalid GUID or port: nothing to connect to.
  // Nothing after stop(). Mix It Up's connection test ('Test') is answered here, not passed on. Mix It Up keeps nothing
  // for a socket that is down, and a refused localhost socket costs nothing: retries come every 0.25-4 s, and a ready
  // connection starts the backoff over.
  function createMixItUp(opts) {
    opts = opts || {};
    var guid = cleanGuid(opts.guid);
    var port = cleanPort(opts.port);
    var url = guid && port ? (typeof opts.url === 'string' && opts.url ? opts.url : wsUrl(guid, port)) : '';
    var readyMs = typeof opts.readyMs === 'number' && opts.readyMs > 0 ? opts.readyMs : READY_MS;
    var stopped = true;
    var timer = null; // the connect timeout of the attempt under way
    var conn = null; // the open connection: { gen, ready, timer (its readiness timeout) }
    var client = null;

    function status(s) { if (!stopped) safeCall(opts.onStatus, s); }
    function clearTimer() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    // util.SocketClient retries without a word when a socket can't be made (a refused address throws) or never opens:
    // each is a failed attempt too, so the socket is made here and the attempt timed here.
    function Socket(u) {
      clearTimer();
      var WS = opts.WebSocket || root.WebSocket, ws;
      try {
        ws = new WS(u);
      } catch (e) {
        status({ type: 'closed', code: 0, reason: 'socket refused' });
        throw e;
      }
      timer = setTimeout(function () {
        timer = null;
        if (stopped) return;
        status({ type: 'closed', code: 0, reason: 'connect timeout' });
        client.scheduleReconnect('connect timeout');
      }, CONNECT_TIMEOUT);
      return ws;
    }

    // Not ready (yet, or any more): readyMs from now the connection is silent unless the widget is heard from.
    function unready(c, ctl) {
      c.ready = false;
      if (c.timer !== null) ctl.clearTimer(c.timer);
      c.timer = ctl.setTimeout(function () {
        c.timer = null;
        if (conn !== c || c.ready || stopped) return;
        conn = null;
        status({ type: 'silent' });
        ctl.reconnect('no answer from the widget');
      }, readyMs);
    }

    function onOpen(ctl) {
      clearTimer();
      var c = conn = { gen: ctl.gen, ready: false, timer: null };
      unready(c, ctl);
      status({ type: 'open' });
      if (conn === c) ctl.send(HELLO);
    }

    function ready(c, ctl) {
      c.ready = true;
      if (c.timer !== null) { ctl.clearTimer(c.timer); c.timer = null; }
      client.backoff.reset();
      status({ type: 'ready' });
    }

    // Mix It Up never goes quiet for long while it runs, but a quiet socket is no sign of a dead one: no keepalive.
    function onMessage(data, ctl) {
      var c = conn;
      if (stopped || !c || c.gen !== ctl.gen || typeof data !== 'string') return;
      var evs = parsePacket(data, { guid: guid, now: opts.now });
      var answered = false;
      for (var i = 0; i < evs.length; i++) {
        if (stopped || conn !== c || !ctl.isOpen()) return;
        var ev = evs[i];
        if (ev.type === 'test') {
          if (!answered) { answered = true; ctl.send(TEST_REPLY); }
          continue;
        }
        // The widget's HTML was taken away (disabled, or reset or edited and about to come back).
        if (ev.type === 'gone') {
          unready(c, ctl);
          continue;
        }
        if (!c.ready) {
          ready(c, ctl);
          if (stopped || conn !== c || !ctl.isOpen()) return;
        }
        if (ev.type !== 'widget') safeCall(opts.onEvent, ev);
      }
    }

    function onClose(ev) {
      clearTimer();
      conn = null;
      var code = ev && typeof ev.code === 'number' ? ev.code : 0;
      status({ type: 'closed', code: code, reason: ev && typeof ev.reason === 'string' ? ev.reason.slice(0, 200) : '' });
    }

    client = new util.SocketClient({
      name: 'mixitup',
      url: url,
      WebSocket: Socket,
      baseDelay: 500,
      maxDelay: 4000,
      connectTimeout: 0,
      onOpen: onOpen,
      onMessage: onMessage,
      onClose: onClose
    });

    return {
      guid: guid,
      port: port,
      start: function () {
        if (!url) {
          safeCall(opts.onStatus, { type: 'fatal', message: guid ? 'invalid Mix It Up port' : 'invalid Mix It Up widget link' });
          return;
        }
        stopped = false;
        client.start();
      },
      stop: function () { stopped = true; conn = null; clearTimer(); client.stop('stopped'); },
      mixitup: function () { client.kick(); }
    };
  }

  return {
    DEFAULT_PORT: DEFAULT_PORT,
    BADGE_TYPES: BADGE_TYPES.slice(),
    parseLink: parseLink,
    wsUrl: wsUrl,
    widgetUrl: widgetUrl,
    userKey: userKey,
    idOf: idOf,
    loginOf: loginOf,
    toMessage: toMessage,
    parsePacket: parsePacket,
    createMixItUp: createMixItUp
  };
});
