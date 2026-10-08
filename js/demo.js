/* Demo mode: loops synthetic IRC lines (and, with a Kick channel set, Kick chat events) through the real
   parsers and renderer, using the channel's real emotes. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).demo = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var USERS = [
    { id: 'demo-1', login: 'streamer', name: 'Streamer', color: '#9146FF', badges: 'broadcaster/1,subscriber/0' },
    { id: 'demo-2', login: 'paintedpal', name: 'PaintedPal', color: '#1E90FF', badges: 'subscriber/12,premium/1' },
    { id: 'demo-3', login: 'helpfulmod', name: 'HelpfulMod', color: '#00FF7F', badges: 'moderator/1,subscriber/24' },
    { id: 'demo-4', login: 'shinyname', name: 'ShinyName', color: '', badges: 'vip/1,subscriber/3,bits/1000' },
    { id: 'demo-5', login: 'lurker_supreme', name: 'Lurker_Supreme', color: '#FF7F50', badges: 'subscriber/6,glhf-pledge/1' },
    { id: 'demo-6', login: 'newviewer', name: 'NewViewer', color: '', badges: '' }
  ];
  var TWITCH_EMOTES = { Kappa: '25', PogChamp: '305954156', LUL: '425618' };
  var KICK_USERS = [
    { id: 9000001, username: 'KickFan', color: '#E9113C', badges: [{ type: 'og', text: 'OG' }, { type: 'subscriber', text: 'Subscriber', count: 3 }] },
    { id: 9000002, username: 'KickMod', color: '#53FC19', badges: [{ type: 'moderator', text: 'Moderator' }, { type: 'verified', text: 'Verified' }] }
  ];

  function escTag(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\:').replace(/ /g, '\\s').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  }

  function tagString(tags) {
    var parts = [];
    for (var k in tags) parts.push(k + '=' + escTag(tags[k] === undefined ? '' : tags[k]));
    return '@' + parts.join(';');
  }

  // Emotes tag for known Twitch emote words, with code-point positions.
  function twitchEmotesTag(text) {
    var cps = Array.from(text);
    var byId = {};
    var pos = 0, word = '';
    function flush(end) {
      if (word && TWITCH_EMOTES[word]) {
        var id = TWITCH_EMOTES[word];
        (byId[id] = byId[id] || []).push((end - word.length) + '-' + (end - 1));
      }
      word = '';
    }
    for (pos = 0; pos < cps.length; pos++) {
      if (cps[pos] === ' ') flush(pos);
      else word += cps[pos];
    }
    flush(cps.length);
    return Object.keys(byId).map(function (id) { return id + ':' + byId[id].join(','); }).join('/');
  }

  function firstValue(map, pred) {
    if (!map) return null;
    // Homies has a cheap first(); its forEach would build a Badge for every packed entry (~9,400).
    if (!pred && typeof map.first === 'function') return map.first();
    var found = null;
    map.forEach(function (v) { if (!found && (!pred || pred(v))) found = v; });
    return found;
  }

  function createDemo(opts) {
    var getState = opts.getState;
    var feed = opts.feed;
    var counter = 0;
    var index = 0;     // ticks
    var line = 0;      // next Twitch SCRIPT line
    var kickLine = 0;  // next KICK_SCRIPT line
    var timer = null;
    var cos = { linear: null, image: null, badge: null };

    function S() { return getState(); }
    function channel() { return S().cfg.channel || 'demo'; }
    function roomId() { return S().homeId || '0'; }

    function pick(kind, n) {
      var st = S();
      var home = st.rooms.home();
      var normal = function (e) { return e && !e.zw && !e.hidden; };
      var out = [];
      function take(map) {
        if (!map) return;
        map.forEach(function (e) { if (out.length < n && normal(e) && out.indexOf(e.name) < 0) out.push(e.name); });
      }
      if (kind === '7tv') { take(home && home.stv.emotes); take(st.stvGlobal); }
      if (kind === 'bttv') { take(home && home.bttv.emotes); take(st.bttvGlobal); }
      if (kind === 'ffz') { take(home && home.ffz.emotes); take(st.ffzGlobal); }
      return out;
    }
    function zwEmote() {
      var st = S();
      var e = st.stvGlobal.get('RainTime') || firstValue(st.stvGlobal, function (x) { return x.zw; });
      return e ? e.name : null;
    }

    function privmsg(u, text, extra) {
      var tags = {
        'badge-info': '',
        badges: u.badges,
        color: u.color,
        'display-name': u.name,
        emotes: twitchEmotesTag(text.replace(/^\u0001ACTION /, '').replace(/\u0001$/, '')),
        'first-msg': '0',
        id: 'demo-msg-' + (++counter),
        mod: u.badges.indexOf('moderator') >= 0 ? '1' : '0',
        'room-id': roomId(),
        'tmi-sent-ts': String(Date.now()),
        'user-id': u.id
      };
      if (extra) for (var k in extra) tags[k] = extra[k];
      return tagString(tags) + ' :' + u.login + '!' + u.login + '@' + u.login + '.tmi.twitch.tv PRIVMSG #' + channel() + ' :' + text;
    }

    function usernotice(u, msgId, systemMsg, text, params) {
      var tags = {
        'badge-info': '',
        badges: u.badges,
        color: u.color,
        'display-name': u.name,
        emotes: text ? twitchEmotesTag(text) : '',
        id: 'demo-msg-' + (++counter),
        login: u.login,
        'msg-id': msgId,
        'room-id': roomId(),
        'system-msg': systemMsg,
        'tmi-sent-ts': String(Date.now()),
        'user-id': u.id
      };
      if (params) for (var k in params) tags['msg-param-' + k] = params[k];
      return tagString(tags) + ' :tmi.twitch.tv USERNOTICE #' + channel() + (text ? ' :' + text : '');
    }

    // mentions on, with a Twitch or Kick channel set: the name the first line mentions, so the preview shows the
    // mention tint. '' otherwise, and the loop is as it always was.
    function mentioned() {
      var c = S().cfg;
      return c.mentions && c.mentions !== 'off' ? c.channel || c.kick || '' : '';
    }

    var SCRIPT = [
      function () {
        var who = mentioned();
        return privmsg(USERS[0], who ? 'Welcome in, @' + who + '! Kappa' : 'Welcome in, chat! Kappa');
      },
      function () {
        var e = pick('7tv', 2);
        return privmsg(USERS[1], (e[0] || 'PogChamp') + ' this overlay looks clean ' + (e[1] || 'LUL'));
      },
      function () {
        var zw = zwEmote();
        return privmsg(USERS[2], 'Kappa' + (zw ? ' ' + zw : '') + ' zero-width emotes stack too');
      },
      function () {
        return usernotice(USERS[4], 'resub', USERS[4].name + ' subscribed at Tier 1. They\'ve subscribed for 6 months!',
          'still here PogChamp', { 'cumulative-months': '6', 'sub-plan': '1000' });
      },
      function () {
        var b = pick('bttv', 1);
        return privmsg(USERS[3], '\u0001ACTION does a little dance ' + (b[0] || 'Kappa') + '\u0001');
      },
      function () {
        var f = pick('ffz', 1);
        return privmsg(USERS[5], '@PaintedPal same, love it ' + (f[0] || 'LUL'), {
          'reply-parent-display-name': USERS[1].name,
          'reply-parent-msg-body': 'this overlay looks clean',
          'reply-parent-msg-id': 'demo-parent',
          'reply-parent-user-id': USERS[1].id,
          'reply-parent-user-login': USERS[1].login
        });
      },
      function () { return privmsg(USERS[1], 'Cheer100 take my bits', { bits: '100' }); },
      function () {
        var b = pick('bttv', 2), f = pick('ffz', 1);
        return privmsg(USERS[0], [b[0], f[0], 'LUL'].filter(Boolean).join(' '));
      },
      function () {
        return usernotice({ id: 'demo-7', login: 'raider_friend', name: 'Raider_Friend', color: '#DAA520', badges: '' },
          'raid', '25 raiders from Raider_Friend have joined!', '', { displayName: 'Raider_Friend', viewerCount: '25' });
      },
      function () { return privmsg(USERS[5], 'hi everyone, first time here!', { 'first-msg': '1' }); },
      function () { return privmsg(USERS[4], 'this message was highlighted with channel points', { 'msg-id': 'highlighted-message' }); },
      function () {
        var st = S();
        var hasPrefix = st.bttvPrefixes && st.bttvPrefixes.has('h!');
        var b = pick('bttv', 1);
        // links on Shorten or Hide: this line has a link, to show what they do. (Never the first-time chatter's line,
        // which Hide would take out of the first_msg preview.)
        var link = st.cfg.links && st.cfg.links !== 'show' ? ' https://clips.twitch.tv/demo' : '';
        return privmsg(USERS[2], (hasPrefix && b[0] ? 'mirror mirror h! ' + b[0] : 'mirror mirror ' + (b[0] || 'Kappa')) + link);
      }
    ];

    // Kick lines, as the Pusher events Kick sends (event name + JSON data).
    function kickChat(u, content) {
      return {
        event: 'App\\Events\\ChatMessageEvent',
        data: JSON.stringify({
          id: 'demo-kick-' + (++counter), chatroom_id: 0, content: content, type: 'message', created_at: new Date().toISOString(),
          sender: { id: u.id, username: u.username, slug: u.username.toLowerCase(), identity: { color: u.color, badges: u.badges } }
        })
      };
    }
    var KICK_SCRIPT = [
      function () { return kickChat(KICK_USERS[0], 'hello from Kick! [emote:37226:KEKW]'); },
      function () {
        var e = pick('7tv', 1);
        return kickChat(KICK_USERS[1], 'Twitch and Kick chat in one overlay ' + (e[0] || ''));
      },
      function () {
        return { event: 'App\\Events\\SubscriptionEvent', data: JSON.stringify({ chatroom_id: 0, username: 'KickSubber', months: 3 }) };
      }
    ];
    function kickOn() { return typeof opts.feedKick === 'function' && !!S().cfg.kick; }

    // With a Kick channel set, every third line comes from Kick.
    function tick() {
      try {
        if (kickOn() && index % 3 === 2) {
          var f = KICK_SCRIPT[kickLine++ % KICK_SCRIPT.length]();
          opts.feedKick(f.event, f.data);
        } else {
          feed(SCRIPT[line++ % SCRIPT.length]());
        }
      } catch (e) { if (root.console) console.warn('[TCO] demo line failed', e); }
      index++;
    }

    function onCatalog() {
      var paints = S().stv.paints;
      cos.linear = firstValue(paints, function (p) { return p.bgImage && p.bgImage.indexOf('linear-gradient') >= 0; });
      cos.image = firstValue(paints, function (p) { return p.bgImage && p.bgImage.indexOf('url(') >= 0; });
      cos.badge = null;
      S().stv.badges.forEach(function (b, id) { if (!cos.badge) cos.badge = id; });
      S().bus.emit('changed', { all: true });
    }

    function effective(uid) {
      if (uid === 'demo-2') return { paint: cos.linear ? cos.linear.id : null, badge: cos.badge, sets: [] };
      if (uid === 'demo-4') return { paint: cos.image ? cos.image.id : null, badge: null, sets: [] };
      if (uid && uid.indexOf('demo-') === 0) return { paint: null, badge: null, sets: [] };
      return null;
    }

    function firstBadge(map) {
      var list = firstValue(map);
      return list && list[0] ? list[0] : null;
    }

    function extraBadges(uid) {
      var st = S();
      var out = [];
      function add(b) { if (b) out.push(b); }
      if (uid === 'demo-1') add(firstBadge(st.chatterino));
      if (uid === 'demo-2') {
        var sup = st.ffzBadges.defs.get('3');
        if (sup) add({ provider: 'ffz', title: sup.title, urls: sup.urls, bg: sup.color || undefined });
      }
      if (uid === 'demo-3') add(firstBadge(st.ffzap));
      if (uid === 'demo-4') add(firstBadge(st.bttvStaff));
      if (uid === 'demo-5') add(firstBadge(st.homies));
      return out;
    }

    return {
      start: function () {
        if (timer) return;
        tick();
        timer = setInterval(tick, 1500);
      },
      stop: function () { if (timer) clearInterval(timer); timer = null; },
      onCatalog: onCatalog,
      effective: effective,
      extraBadges: extraBadges,
      _twitchEmotesTag: twitchEmotesTag
    };
  }

  return { createDemo: createDemo, USERS: USERS, KICK_USERS: KICK_USERS, _tagString: tagString };
});
