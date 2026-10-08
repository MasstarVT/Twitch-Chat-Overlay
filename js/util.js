/* Shared helpers: fetch with timeouts/retry, a reconnecting socket client, LRU, colors. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).util = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var VERSION = '1.5.3';

  // ---------- logging ----------
  var debugEnabled = false;
  function setDebug(on) { debugEnabled = !!on; }
  function log() {
    if (!debugEnabled) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[TCO]');
    console.log.apply(console, args);
  }
  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[TCO]');
    console.warn.apply(console, args);
  }

  // ---------- small utils ----------
  function now() { return Date.now(); }
  function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function jitter(minMs, maxMs) { return minMs + Math.random() * (maxMs - minMs); }
  function absUrl(u) {
    if (typeof u !== 'string' || !u) return null;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return u;
  }
  function isSafeUrl(u, hostRe) {
    if (typeof u !== 'string' || u.length > 2048) return false;
    if (/["'\\\s<>()\u0000-\u001f\u007f]/.test(u)) return false;
    var m = /^https:\/\/([^\/?#:]+)(?:[\/?#]|$)/i.exec(u);
    if (!m) return false;
    return hostRe ? hostRe.test(m[1].toLowerCase()) : true;
  }
  // Zalgo: a long run of combining marks stacks glyphs far above and below the line, over other
  // messages. Keep the first 4 marks of a run (enough for Indic, Thai, Vietnamese and emoji sequences);
  // format and other invisible (default-ignorable, e.g. ZWJ, CGJ, unassigned U+E0000) characters between
  // marks don't restart the count and go with the extras.
  var MARK_RUN_RE = /((?:[\p{Mn}\p{Me}][\p{Cf}\p{Default_Ignorable_Code_Point}]*){4})[\p{Mn}\p{Me}\p{Cf}\p{Default_Ignorable_Code_Point}]+/gu;
  function capMarks(s) { return typeof s === 'string' ? s.replace(MARK_RUN_RE, '$1') : s; }
  function idStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  // ---------- LRU (Map insertion order) ----------
  function LRU(max) {
    this.max = max || 1000;
    this.map = new Map();
  }
  LRU.prototype.get = function (k) {
    if (!this.map.has(k)) return undefined;
    var v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  };
  LRU.prototype.peek = function (k) { return this.map.get(k); };
  LRU.prototype.has = function (k) { return this.map.has(k); };
  LRU.prototype.set = function (k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return this;
  };
  LRU.prototype.delete = function (k) { return this.map.delete(k); };
  Object.defineProperty(LRU.prototype, 'size', { get: function () { return this.map.size; } });

  // ---------- tiny event emitter ----------
  function Emitter() { this.handlers = {}; }
  Emitter.prototype.on = function (type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
    return this;
  };
  Emitter.prototype.emit = function (type, data) {
    var list = this.handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { warn('handler for', type, 'threw', e); }
    }
  };

  // ---------- fetch ----------
  function HttpError(status, url) {
    this.name = 'HttpError';
    this.status = status;
    this.message = 'HTTP ' + status + ' for ' + url;
  }
  HttpError.prototype = Object.create(Error.prototype);

  // Largest body read by default (decoded bytes). The biggest real payloads are a big channel's 7TV
  // user (~2.4 MB) and the Homies badge list (~4 MB); a broken or hostile host can't make us buffer more.
  var MAX_BODY_BYTES = 8 * 1024 * 1024;

  function tooLarge(url, max) {
    var e = new Error('response over ' + max + ' bytes for ' + url);
    e.tooLarge = true;
    return e;
  }

  // Read a body as text, giving up (and aborting the download) once it passes max bytes.
  function readText(res, url, max, ctrl) {
    var len = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length')) : 0;
    if (len > max) { if (ctrl) ctrl.abort(); return Promise.reject(tooLarge(url, max)); }
    var body = res.body;
    if (!body || typeof body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
      return res.text().then(function (txt) {
        if (txt.length > max) throw tooLarge(url, max);
        return txt;
      });
    }
    var reader = body.getReader(), dec = new TextDecoder(), parts = [], n = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { parts.push(dec.decode()); return parts.join(''); }
        n += r.value.byteLength;
        if (n > max) {
          reader.cancel().catch(function () { /* ignore */ });
          if (ctrl) ctrl.abort();
          throw tooLarge(url, max);
        }
        parts.push(dec.decode(r.value, { stream: true }));
        return pump();
      });
    }
    return pump();
  }

  // Simple GET (no custom headers: BTTV rejects preflights) or POST with JSON.
  // opts: { timeout (total ms), headersTimeout (ms), maxBytes, cache (fetch cache mode), method, headers, body }
  // headersTimeout defaults to 8 s, or 3/4 of a longer total budget (servers that build the whole
  // response before sending headers, like 7TV's GQL, get most of the time the caller gave them).
  function fetchJson(url, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var total = opts.timeout || 10000;
    var headersTimeout = Math.min(opts.headersTimeout || Math.max(8000, Math.round(total * 0.75)), total);
    var maxBytes = opts.maxBytes || MAX_BODY_BYTES;
    var timedOut = false;
    var totalTimer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, total);
    var headTimer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, headersTimeout);
    var init = { method: opts.method || 'GET', signal: ctrl ? ctrl.signal : undefined, credentials: 'omit' };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body !== undefined) init.body = opts.body;
    if (opts.cache) init.cache = opts.cache;
    return fetch(url, init).then(function (res) {
      clearTimeout(headTimer);
      if (res.status === 404) return { __notFound: true };
      if (!res.ok) throw new HttpError(res.status, url);
      return readText(res, url, maxBytes, ctrl).then(function (txt) { return txt ? JSON.parse(txt) : null; });
    }).catch(function (err) {
      if (timedOut) { var e = new Error('timeout for ' + url); e.timeout = true; throw e; }
      throw err;
    }).finally(function () {
      clearTimeout(totalTimer);
      clearTimeout(headTimer);
    });
  }

  function postJson(url, body, headers, opts) {
    var h = { 'Content-Type': 'application/json' };
    if (headers) for (var k in headers) h[k] = headers[k];
    var o = { method: 'POST', headers: h, body: JSON.stringify(body) };
    if (opts) for (var j in opts) o[j] = opts[j];
    return fetchJson(url, o);
  }

  function isNotFound(r) { return !!(r && r.__notFound); }

  // Retry a loader on any failure (after 3 s, 10 s, 30 s, 60 s, then every 5 min) until it succeeds or
  // is cancelled. 404s are definitive (the loader decides, usually by resolving empty).
  // Returns a controller { promise, retryNow(), cancel() }.
  var RETRY_DELAYS = [3000, 10000, 30000, 60000];
  function loadWithRetry(name, fn, onDone) {
    var attempt = 0, timer = null, cancelled = false, done = false, running = false;
    var ctl = { name: name, status: 'pending', error: null };
    function schedule() {
      var delay = attempt < RETRY_DELAYS.length ? RETRY_DELAYS[attempt] : 300000;
      attempt++;
      timer = setTimeout(run, delay);
    }
    function run() {
      timer = null;
      if (cancelled || done || running) return;
      running = true;
      Promise.resolve().then(fn).then(function (result) {
        running = false;
        if (cancelled) return;
        done = true;
        ctl.status = 'ok';
        ctl.error = null;
        log('loaded', name);
        if (onDone) onDone(result);
      }, function (err) {
        running = false;
        if (cancelled) return;
        ctl.status = 'failed';
        ctl.error = err && err.message ? err.message : String(err);
        warn('load failed:', name, '-', ctl.error);
        schedule();
      });
    }
    ctl.retryNow = function () {
      if (done || cancelled || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      run();
    };
    ctl.cancel = function () { cancelled = true; if (timer) clearTimeout(timer); };
    ctl.isDone = function () { return done; };
    run();
    return ctl;
  }

  // ---------- backoff ----------
  function Backoff(baseMs, maxMs) {
    this.base = baseMs;
    this.max = maxMs;
    this.attempts = 0;
  }
  Backoff.prototype.next = function () {
    var cap = Math.min(this.max, this.base * Math.pow(2, this.attempts));
    this.attempts++;
    return Math.round(cap * (0.5 + Math.random() * 0.5));
  };
  Backoff.prototype.reset = function () { this.attempts = 0; };

  // ---------- reconnecting socket client ----------
  // opts: { name, url: string|fn, WebSocket, baseDelay, maxDelay, stableMs, connectTimeout (ms, 0 = off),
  //         onOpen(ctl), onMessage(data, ctl), onClose(ev, ctl) }
  // ctl (per connection): { send(str), setTimeout(fn,ms), setInterval(fn,ms), clearTimer(id),
  //                         reconnect(reason, {delay}), stop(reason), gen }
  function SocketClient(opts) {
    this.opts = opts;
    this.name = opts.name || 'socket';
    this.WS = opts.WebSocket || root.WebSocket;
    this.backoff = new Backoff(opts.baseDelay || 1000, opts.maxDelay || 30000);
    this.stableMs = opts.stableMs === undefined ? 60000 : opts.stableMs;
    this.state = 'idle';
    this.gen = 0;
    this.ws = null;
    this.timers = [];
    this.reconnectTimer = null;
  }
  SocketClient.prototype.start = function () {
    if (this.state !== 'idle' && this.state !== 'stopped') return;
    this.state = 'idle';
    this._connect();
  };
  SocketClient.prototype._connect = function () {
    var self = this;
    this._teardown();
    this.gen++;
    var gen = this.gen;
    this.state = 'connecting';
    var url = typeof this.opts.url === 'function' ? this.opts.url() : this.opts.url;
    var ws;
    try {
      ws = new this.WS(url);
    } catch (e) {
      warn(this.name, 'socket constructor failed', e);
      this.state = 'closed';
      this.scheduleReconnect('constructor failed');
      return;
    }
    this.ws = ws;
    var ctl = this._makeCtl(gen);
    // A server that accepts the connection but never answers the upgrade would otherwise leave us
    // 'connecting' until the browser gives up (minutes). One timer per attempt, cleared on open.
    var connectTimeout = this.opts.connectTimeout === undefined ? 20000 : this.opts.connectTimeout;
    var connTimer = connectTimeout > 0 ? ctl.setTimeout(function () {
      if (self.state === 'connecting') self.scheduleReconnect('connect timeout');
    }, connectTimeout) : null;
    ws.onopen = function () {
      if (gen !== self.gen) return;
      if (connTimer !== null) ctl.clearTimer(connTimer);
      self.state = 'open';
      log(self.name, 'open');
      ctl.setTimeout(function () { self.backoff.reset(); }, self.stableMs);
      if (self.opts.onOpen) {
        try { self.opts.onOpen(ctl); } catch (e) { warn(self.name, 'onOpen threw', e); }
      }
    };
    ws.onmessage = function (ev) {
      if (gen !== self.gen) return;
      if (self.opts.onMessage) {
        try { self.opts.onMessage(ev.data, ctl); } catch (e) { warn(self.name, 'onMessage threw', e); }
      }
    };
    ws.onerror = function () {
      if (gen !== self.gen) return;
      log(self.name, 'socket error');
    };
    ws.onclose = function (ev) {
      if (gen !== self.gen) return;
      log(self.name, 'closed', ev && ev.code);
      self.state = 'closed';
      if (self.opts.onClose) {
        try { self.opts.onClose(ev, ctl); } catch (e) { warn(self.name, 'onClose threw', e); }
      }
      self.scheduleReconnect('close ' + (ev && ev.code));
    };
  };
  SocketClient.prototype._makeCtl = function (gen) {
    var self = this;
    return {
      gen: gen,
      send: function (str) {
        if (gen !== self.gen || !self.ws || self.state !== 'open') return false;
        try { self.ws.send(str); return true; } catch (e) { return false; }
      },
      setTimeout: function (fn, ms) {
        var id = setTimeout(function () {
          var i = self.timers.indexOf(id);
          if (i >= 0) self.timers.splice(i, 1);
          if (gen === self.gen) fn();
        }, ms);
        self.timers.push(id);
        return id;
      },
      setInterval: function (fn, ms) {
        var id = setInterval(function () { if (gen === self.gen) fn(); }, ms);
        self.timers.push(id);
        return id;
      },
      clearTimer: function (id) {
        clearTimeout(id);
        clearInterval(id);
        var i = self.timers.indexOf(id);
        if (i >= 0) self.timers.splice(i, 1);
      },
      reconnect: function (reason, o) {
        if (gen !== self.gen) return;
        self.scheduleReconnect(reason, o);
      },
      stop: function (reason) {
        if (gen !== self.gen) return;
        self.stop(reason);
      },
      isOpen: function () { return gen === self.gen && self.state === 'open'; }
    };
  };
  SocketClient.prototype._teardown = function () {
    for (var i = 0; i < this.timers.length; i++) {
      clearTimeout(this.timers[i]);
      clearInterval(this.timers[i]);
    }
    this.timers = [];
    if (this.ws) {
      var ws = this.ws;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
  };
  // Single entry point for every reconnect. Ignored while one is already pending.
  // An explicit {delay} (server-requested reconnect) is used as-is for the first reconnect after a
  // stable period; repeated ones inside the unstable window still escalate through the backoff, so a
  // server that keeps asking to reconnect cannot cause a reconnect every second forever.
  SocketClient.prototype.scheduleReconnect = function (reason, o) {
    if (this.state === 'stopped' || this.reconnectTimer) return;
    var self = this;
    this._teardown();
    this.gen++; // invalidate everything from the old connection
    var b = this.backoff.next();
    var delay = o && typeof o.delay === 'number' ? (this.backoff.attempts > 1 ? Math.max(o.delay, b) : o.delay) : b;
    this.state = 'waiting';
    log(this.name, 'reconnect in', delay, 'ms:', reason);
    this.reconnectTimer = setTimeout(function () {
      self.reconnectTimer = null;
      if (self.state === 'stopped') return;
      self._connect();
    }, delay);
  };
  // Reconnect right away if we are waiting (e.g. the browser came back online).
  SocketClient.prototype.kick = function () {
    if (this.state !== 'waiting') return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoff.reset();
    this._connect();
  };
  SocketClient.prototype.send = function (str) {
    if (!this.ws || this.state !== 'open') return false;
    try { this.ws.send(str); return true; } catch (e) { return false; }
  };
  SocketClient.prototype.isOpen = function () { return this.state === 'open'; };
  SocketClient.prototype.stop = function (reason) {
    log(this.name, 'stopped', reason || '');
    this.state = 'stopped';
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._teardown();
    this.gen++;
  };

  // ---------- colors ----------
  var TWITCH_PALETTE = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500',
    '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];

  function defaultColor(userId, login) {
    var n = Number(userId);
    // Only a non-negative integer id indexes the palette; anything else ('-1', '1.5', 'demo-1') hashes.
    if (!(n >= 0) || n % 1 !== 0 || !isFinite(n) || userId === '' || userId === undefined || userId === null) {
      n = 0;
      var s = String(login || userId || '');
      for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    }
    return TWITCH_PALETTE[n % 15];
  }

  function parseHex(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (c) {
      var s = Math.max(0, Math.min(255, Math.round(c))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }
  function luminance(rgb) {
    var a = rgb.map(function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  // Lighten dark name colors until they read well over dark/busy video (WCAG contrast vs black >= 4.5).
  function readableColor(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return hex;
    for (var i = 0; i < 8; i++) {
      var contrast = (luminance(rgb) + 0.05) / 0.05;
      if (contrast >= 4.5) break;
      rgb = rgb.map(function (c) { return c + (255 - c) * 0.12; });
    }
    return toHex(rgb);
  }

  // 7TV v3 packed RGBA signed int32 -> css rgba()
  function intToRgba(c) {
    if (typeof c !== 'number' || !isFinite(c)) return null;
    var r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255, a = c & 255;
    var alpha = Math.round((a / 255) * 1000) / 1000;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Pick the url for the smallest available scale >= want, else the largest available.
  function pickScale(urls, want) {
    if (!urls) return null;
    var keys = Object.keys(urls).map(Number).filter(function (k) { return k > 0 && urls[k]; }).sort(function (a, b) { return a - b; });
    if (!keys.length) return null;
    for (var i = 0; i < keys.length; i++) if (keys[i] >= want) return urls[keys[i]];
    return urls[keys[keys.length - 1]];
  }

  function safeStorage() {
    try {
      var s = root.localStorage;
      var k = '__tco_probe';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) { return null; }
  }

  return {
    VERSION: VERSION,
    setDebug: setDebug,
    isDebug: function () { return debugEnabled; },
    log: log,
    warn: warn,
    now: now,
    randInt: randInt,
    jitter: jitter,
    absUrl: absUrl,
    isSafeUrl: isSafeUrl,
    capMarks: capMarks,
    idStr: idStr,
    LRU: LRU,
    Emitter: Emitter,
    HttpError: HttpError,
    fetchJson: fetchJson,
    postJson: postJson,
    isNotFound: isNotFound,
    loadWithRetry: loadWithRetry,
    Backoff: Backoff,
    SocketClient: SocketClient,
    TWITCH_PALETTE: TWITCH_PALETTE,
    defaultColor: defaultColor,
    parseHex: parseHex,
    readableColor: readableColor,
    intToRgba: intToRgba,
    pickScale: pickScale,
    safeStorage: safeStorage
  };
});
