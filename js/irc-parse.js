/* Twitch IRC line parsing (IRCv3 tags) and shaping into chat messages. Pure. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).ircParse = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  function unescapeTag(v) {
    if (!v || v.indexOf('\\') < 0) return v || '';
    var out = '';
    for (var i = 0; i < v.length; i++) {
      var c = v[i];
      if (c !== '\\') { out += c; continue; }
      var n = v[i + 1];
      if (n === undefined) break; // trailing lone backslash is dropped
      i++;
      if (n === ':') out += ';';
      else if (n === 's') out += ' ';
      else if (n === '\\') out += '\\';
      else if (n === 'r') out += '\r';
      else if (n === 'n') out += '\n';
      else out += n; // unknown escape: drop the backslash
    }
    return out;
  }

  function parseTags(str) {
    var tags = {};
    if (!str) return tags;
    var parts = str.split(';');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i];
      if (!kv) continue;
      var eq = kv.indexOf('=');
      if (eq < 0) tags[kv] = '';
      else tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    return tags;
  }

  // Returns { tags, prefix, nick, command, params[] } or null.
  function parseLine(line) {
    if (!line) return null;
    var i = 0;
    var tags = {};
    var prefix = null;
    if (line[0] === '@') {
      var sp = line.indexOf(' ');
      if (sp < 0) return null;
      tags = parseTags(line.slice(1, sp));
      i = sp + 1;
    }
    while (line[i] === ' ') i++;
    if (line[i] === ':') {
      var sp2 = line.indexOf(' ', i);
      if (sp2 < 0) return null;
      prefix = line.slice(i + 1, sp2);
      i = sp2 + 1;
    }
    while (line[i] === ' ') i++;
    var rest = line.slice(i);
    var trailing;
    var head = rest;
    var t = rest.indexOf(' :');
    if (t >= 0) {
      head = rest.slice(0, t);
      trailing = rest.slice(t + 2);
    }
    var parts = head.split(' ').filter(Boolean);
    var command = parts.shift();
    if (!command) return null;
    if (trailing !== undefined) parts.push(trailing);
    var nick = null;
    if (prefix) {
      var bang = prefix.indexOf('!');
      nick = bang >= 0 ? prefix.slice(0, bang) : prefix;
    }
    return { tags: tags, prefix: prefix, nick: nick, command: command.toUpperCase(), params: parts };
  }

  // Drop trailing CR/LF characters. Linear (a /[\r\n]+$/ regex is quadratic on long runs of newlines).
  function trimEol(s) {
    s = String(s);
    var e = s.length;
    while (e > 0) {
      var c = s.charCodeAt(e - 1);
      if (c !== 10 && c !== 13) break;
      e--;
    }
    return e === s.length ? s : s.slice(0, e);
  }

  function parseFrame(data) {
    var out = [];
    var lines = String(data).split('\r\n');
    for (var i = 0; i < lines.length; i++) {
      var l = trimEol(lines[i]);
      if (!l) continue;
      var p = parseLine(l);
      if (p) out.push(p);
    }
    return out;
  }

  // "subscriber/12,premium/1" -> [{set:'subscriber', version:'12'}, ...]
  function parseBadges(str) {
    var out = [];
    if (!str) return out;
    var parts = str.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var slash = p.indexOf('/');
      if (slash <= 0) continue;
      out.push({ set: p.slice(0, slash), version: p.slice(slash + 1) });
    }
    return out;
  }

  // "25:0-4,6-10/emotesv2_abc:12-16" -> [{id, start, end}]
  function parseEmotesTag(str) {
    var out = [];
    if (!str) return out;
    var groups = str.split('/');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var colon = g.indexOf(':');
      if (colon <= 0) continue;
      var id = g.slice(0, colon);
      var ranges = g.slice(colon + 1).split(',');
      for (var j = 0; j < ranges.length; j++) {
        var m = /^(\d+)-(\d+)$/.exec(ranges[j]);
        if (!m) continue;
        var s = +m[1], e = +m[2];
        if (e >= s) out.push({ id: id, start: s, end: e });
      }
    }
    return out;
  }

  // "0-27|3oFzm0o2jMKftsaBoc|https://media2.giphy.com/...gif?cid=..." (comma separated)
  // Split first, then one anchored match per entry: linear even on hostile (e.g. history) input.
  var GIF_RE = /^(\d+)-(\d+)\|([^|]*)\|([\s\S]*)$/;
  function parseGifsTag(str) {
    var out = [];
    if (!str) return out;
    var parts = String(str).split(',');
    for (var i = 0; i < parts.length; i++) {
      var m = GIF_RE.exec(parts[i]);
      if (!m) continue;
      var s = +m[1], e = +m[2];
      if (e >= s) out.push({ start: s, end: e, id: m[3], url: m[4] });
    }
    return out;
  }

  function stripAction(text) {
    if (text && text.length >= 9 && text.indexOf('\u0001ACTION ') === 0 && text[text.length - 1] === '\u0001') {
      return { text: text.slice(8, -1), action: true };
    }
    return { text: text || '', action: false };
  }

  function commonFields(p) {
    var t = p.tags;
    var login = t.login || (p.nick && p.nick !== 'tmi.twitch.tv' ? p.nick : '') || '';
    var roomId = t['room-id'] || '';
    var sourceRoomId = t['source-room-id'] || '';
    var ts = parseInt(t['tmi-sent-ts'], 10);
    return {
      id: t.id || '',
      sourceId: t['source-id'] || '',
      roomId: roomId,
      sourceRoomId: sourceRoomId,
      mirrored: !!(sourceRoomId && roomId && sourceRoomId !== roomId),
      userId: t['user-id'] || '',
      login: login.toLowerCase(),
      displayName: t['display-name'] || login,
      color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '',
      badges: parseBadges(t.badges),
      sourceBadges: parseBadges(t['source-badges']),
      ts: isFinite(ts) ? ts : Date.now(),
      historical: t.historical === '1' || !!t['rm-received-ts']
    };
  }

  function toChatMessage(p) {
    var m = commonFields(p);
    var t = p.tags;
    var raw = p.params.length > 1 ? p.params[p.params.length - 1] : '';
    var a = stripAction(raw);
    m.kind = 'chat';
    m.text = a.text;
    m.action = a.action;
    m.emotes = t.emotes || '';
    m.gifs = t.gifs || '';
    m.bits = parseInt(t.bits, 10) || 0;
    m.msgId = t['msg-id'] || '';
    m.firstMsg = t['first-msg'] === '1';
    m.reply = t['reply-parent-msg-id'] ? {
      id: t['reply-parent-msg-id'],
      userId: t['reply-parent-user-id'] || '',
      login: (t['reply-parent-user-login'] || '').toLowerCase(),
      name: t['reply-parent-display-name'] || t['reply-parent-user-login'] || '',
      body: t['reply-parent-msg-body'] || ''
    } : null;
    // The thread's first message: the parent was itself a reply when this is another one (its text then starts with
    // the "@Name" Twitch puts there). Kept only when sent, so a reply without it keeps its shape.
    if (m.reply && t['reply-thread-parent-msg-id']) m.reply.threadId = t['reply-thread-parent-msg-id'];
    return m;
  }

  function toNoticeMessage(p) {
    var m = commonFields(p);
    var t = p.tags;
    var msgId = t['msg-id'] || '';
    m.kind = 'notice';
    m.type = msgId === 'sharedchatnotice' ? (t['source-msg-id'] || '') : msgId;
    m.mirrored = m.mirrored || msgId === 'sharedchatnotice';
    m.systemMsg = t['system-msg'] || '';
    var raw = p.params.length > 1 ? p.params[p.params.length - 1] : '';
    var a = stripAction(raw);
    m.text = a.text;
    m.action = a.action;
    m.emotes = t.emotes || '';
    m.gifs = '';
    m.bits = 0;
    m.msgId = msgId;
    m.firstMsg = false;
    m.reply = null;
    var params = {};
    for (var k in t) if (k.indexOf('msg-param-') === 0) params[k.slice(10)] = t[k];
    m.params = params; // msg-param-* without the prefix (overlay.js reads threshold for bitsbadgetier)
    m.communityGiftId = params['community-gift-id'] || '';
    m.announceColor = (params.color || '').toUpperCase();
    return m;
  }

  return {
    unescapeTag: unescapeTag,
    parseTags: parseTags,
    parseLine: parseLine,
    parseFrame: parseFrame,
    trimEol: trimEol,
    parseBadges: parseBadges,
    parseEmotesTag: parseEmotesTag,
    parseGifsTag: parseGifsTag,
    stripAction: stripAction,
    toChatMessage: toChatMessage,
    toNoticeMessage: toNoticeMessage
  };
});
