/* Anonymous Twitch IRC client (handshake, keepalive, reconnect, dedupe) and recent-messages history. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var ircParse = typeof require === 'function' ? require('./irc-parse.js') : root.TCO.ircParse;
  var api = factory(root, util, ircParse);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).irc = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, ircParse) {
  'use strict';

  var IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
  var HISTORY_URL = 'https://recent-messages.robotty.de/api/v2/recent-messages/';
  var PING_EVERY = 60000;
  var PONG_TIMEOUT = 10000;
  var LOGIN_RE = /^[a-z0-9_]{1,25}$/;
  var MAX_HISTORY_LINE = 16384;

  function normLogin(s) {
    return String(s || '').trim().replace(/^#/, '').toLowerCase();
  }

  function safeCall(fn, a, b) {
    if (typeof fn !== 'function') return;
    try { fn(a, b); } catch (e) { util.warn('irc callback threw', e); }
  }

  // opts: { channel, onLine(parsed), onStatus(status, detail), WebSocket?, url? }
  // status: 'open'; 'joined' (first ROOMSTATE of each connection, detail = parsed line);
  //         'closed' (socket closed or we dropped it to reconnect, detail = {code, reason}).
  function createIrc(opts) {
    opts = opts || {};
    var channel = normLogin(opts.channel);
    var seen = new util.LRU(2000); // PRIVMSG/USERNOTICE ids, kept across reconnects
    var conn = null; // per-connection state: { gen, registered, joined, pong }
    var stopped = true;

    function status(s, detail) { safeCall(opts.onStatus, s, detail); }

    // Drop the current connection on purpose; SocketClient ignores this while a reconnect is pending.
    function drop(ctl, reason, o) {
      conn = null;
      ctl.reconnect(reason, o);
      status('closed', { code: 0, reason: reason });
    }

    function sendPing(ctl) {
      var c = conn;
      if (!c || c.gen !== ctl.gen || c.pong) return;
      ctl.send('PING :tco');
      c.pong = ctl.setTimeout(function () {
        c.pong = null;
        if (conn === c) drop(ctl, 'pong timeout');
      }, PONG_TIMEOUT);
    }

    function onOpen(ctl) {
      conn = { gen: ctl.gen, registered: false, joined: false, pong: null };
      ctl.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ctl.send('PASS SCHMOOPIIE');
      ctl.send('NICK justinfan' + util.randInt(10000, 99999));
      if (channel) ctl.send('JOIN #' + channel);
      ctl.setInterval(function () { sendPing(ctl); }, PING_EVERY);
      status('open');
    }

    function onMessage(data, ctl) {
      var c = conn;
      if (!c || c.gen !== ctl.gen) return;
      var lines = ircParse.parseFrame(data);
      for (var i = 0; i < lines.length; i++) {
        if (stopped) return;
        var p = lines[i];
        var cmd = p.command;
        if (cmd === 'PING') {
          ctl.send('PONG :' + (p.params.length ? p.params[p.params.length - 1] : 'tmi.twitch.tv'));
          continue;
        }
        if (cmd === 'PONG') { // match the command: a bare PING is answered without a prefix
          if (c.pong) { ctl.clearTimer(c.pong); c.pong = null; }
          continue;
        }
        if (cmd === 'RECONNECT') {
          if (conn === c) drop(ctl, 'server', { delay: util.jitter(0, 2000) });
          continue;
        }
        if (cmd === '001') {
          c.registered = true;
        } else if (cmd === 'NOTICE' && !c.registered && p.params[0] === '*') {
          // "Improperly formatted auth" etc.: the server keeps the socket open, so retry with a new nick.
          util.warn('irc login rejected:', p.params[p.params.length - 1] || '');
          if (conn === c) drop(ctl, 'login rejected');
          continue;
        } else if (cmd === 'PRIVMSG' || cmd === 'USERNOTICE') {
          var id = p.tags.id;
          if (id) {
            if (seen.has(id)) continue;
            seen.set(id, true);
          }
        } else if (cmd === 'ROOMSTATE' && !c.joined) {
          c.joined = true;
          status('joined', p);
        }
        safeCall(opts.onLine, p);
      }
    }

    function onClose(ev) {
      conn = null;
      status('closed', { code: ev && ev.code, reason: (ev && ev.reason) || '' });
    }

    var client = new util.SocketClient({
      name: 'irc',
      url: opts.url || IRC_URL,
      WebSocket: opts.WebSocket,
      baseDelay: 1000,
      maxDelay: 30000,
      onOpen: onOpen,
      onMessage: onMessage,
      onClose: onClose
    });

    return {
      start: function () { stopped = false; client.start(); },
      stop: function () { stopped = true; conn = null; client.stop('stopped'); },
      kick: function () { client.kick(); },
      // Record a message id (e.g. from history); returns true when it was already seen.
      markSeen: function (id) {
        if (!id) return false;
        var had = seen.has(id);
        seen.set(id, true);
        return had;
      }
    };
  }

  // Recent chat backfill: { messages: [raw IRC lines] } -> parsed lines (tags include historical=1).
  function loadHistory(login, limit) {
    var l = normLogin(login);
    var n = Math.floor(Number(limit));
    if (!LOGIN_RE.test(l) || !(n > 0)) return Promise.resolve([]);
    if (n > 800) n = 800;
    return util.fetchJson(HISTORY_URL + encodeURIComponent(l) + '?limit=' + n, { timeout: 10000 }).then(function (r) {
      if (!r || util.isNotFound(r)) return [];
      if (r.error) util.log('history:', r.error_code || r.error);
      // Third-party input: keep only the newest n entries, skip anything longer than a real IRC line can
      // be (8191 bytes of tags + 512 of text), and trim line endings linearly.
      var msgs = Array.isArray(r.messages) ? r.messages.slice(-n) : [];
      var out = [];
      for (var i = 0; i < msgs.length; i++) {
        var s = msgs[i];
        if (typeof s !== 'string' || s.length > MAX_HISTORY_LINE) continue;
        var p = ircParse.parseLine(ircParse.trimEol(s));
        if (p) out.push(p);
      }
      return out;
    });
  }

  return {
    IRC_URL: IRC_URL,
    HISTORY_URL: HISTORY_URL,
    createIrc: createIrc,
    loadHistory: loadHistory
  };
});
