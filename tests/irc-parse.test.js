'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const irc = require('../js/irc-parse.js');

const SOH = String.fromCharCode(1);
const BS = '\\'; // one backslash

const PRIVMSG = '@badge-info=subscriber/52;badges=subscriber/48,premium/1;client-nonce=abc;color=#1E90FF;' +
  'display-name=SomeUser;emotes=25:0-4;first-msg=0;flags=;id=f0ea0c84-1111-2222-3333-444455556666;mod=0;' +
  'returning-chatter=0;room-id=71092938;subscriber=1;tmi-sent-ts=1790299061671;turbo=0;user-id=123456;user-type= ' +
  ':someuser!someuser@someuser.tmi.twitch.tv PRIVMSG #xqc :Kappa hello :) world';

describe('unescapeTag (IRCv3)', () => {
  test('known escapes', () => {
    assert.equal(irc.unescapeTag('a' + BS + 'sb'), 'a b');
    assert.equal(irc.unescapeTag(BS + ':'), ';');
    assert.equal(irc.unescapeTag(BS + BS), BS);
    assert.equal(irc.unescapeTag(BS + 'r'), '\r');
    assert.equal(irc.unescapeTag(BS + 'n'), '\n');
    assert.equal(irc.unescapeTag('x' + BS + BS + 's'), 'x' + BS + 's', 'escaped backslash followed by s');
    assert.equal(irc.unescapeTag('Gifter' + BS + 'ssubscribed' + BS + 'sat' + BS + 'sTier' + BS + 's1' + BS + ':' + BS + 's5' + BS + 'smonths!'),
      'Gifter subscribed at Tier 1; 5 months!');
  });

  test('unknown escape drops the backslash; trailing lone backslash is dropped', () => {
    assert.equal(irc.unescapeTag(BS + 'b'), 'b');
    assert.equal(irc.unescapeTag('a' + BS + 'xb'), 'axb');
    assert.equal(irc.unescapeTag('test' + BS), 'test');
    assert.equal(irc.unescapeTag(BS), '');
  });

  test('plain and empty values', () => {
    assert.equal(irc.unescapeTag('plain'), 'plain');
    assert.equal(irc.unescapeTag(''), '');
    assert.equal(irc.unescapeTag(undefined), '');
  });
});

describe('parseTags', () => {
  test('splits on the first "=" and unescapes values', () => {
    assert.deepEqual(irc.parseTags('a=1;b=;d=x' + BS + 'sy;k=v=w'), { a: '1', b: '', d: 'x y', k: 'v=w' });
  });

  test('tags without "=" (recent-messages style) get an empty value', () => {
    assert.deepEqual(irc.parseTags('flags;historical=1;user-type;emotes'), { flags: '', historical: '1', 'user-type': '', emotes: '' });
  });

  test('empty input and empty segments', () => {
    assert.deepEqual(irc.parseTags(''), {});
    assert.deepEqual(irc.parseTags(';;a=1;'), { a: '1' });
  });
});

describe('parseLine', () => {
  test('PRIVMSG with tags, prefix and a trailing param containing " :"', () => {
    const p = irc.parseLine(PRIVMSG);
    assert.equal(p.command, 'PRIVMSG');
    assert.equal(p.prefix, 'someuser!someuser@someuser.tmi.twitch.tv');
    assert.equal(p.nick, 'someuser');
    assert.deepEqual(p.params, ['#xqc', 'Kappa hello :) world']);
    assert.equal(p.tags.color, '#1E90FF');
    assert.equal(p.tags['room-id'], '71092938');
    assert.equal(p.tags['user-type'], '');
    assert.equal(p.tags.flags, '');
    const q = irc.parseLine(':u!u@u.tmi.twitch.tv PRIVMSG #c :a :b :c');
    assert.deepEqual(q.params, ['#c', 'a :b :c']);
    const e = irc.parseLine(':u!u@u.tmi.twitch.tv PRIVMSG #c :');
    assert.deepEqual(e.params, ['#c', '']);
  });

  test('server PING / PONG (both reply shapes)', () => {
    assert.deepEqual(irc.parseLine('PING :tmi.twitch.tv'), { tags: {}, prefix: null, nick: null, command: 'PING', params: ['tmi.twitch.tv'] });
    const pong = irc.parseLine(':tmi.twitch.tv PONG tmi.twitch.tv :tco');
    assert.equal(pong.command, 'PONG');
    assert.deepEqual(pong.params, ['tmi.twitch.tv', 'tco']);
    assert.equal(pong.nick, 'tmi.twitch.tv');
    const bare = irc.parseLine('PONG :tmi.twitch.tv');
    assert.equal(bare.command, 'PONG');
    assert.equal(bare.prefix, null);
  });

  test('CAP ACK, numerics, NOTICE * and RECONNECT', () => {
    const cap = irc.parseLine(':tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands');
    assert.equal(cap.command, 'CAP');
    assert.deepEqual(cap.params, ['*', 'ACK', 'twitch.tv/tags twitch.tv/commands']);
    const welcome = irc.parseLine(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!');
    assert.equal(welcome.command, '001');
    assert.deepEqual(welcome.params, ['justinfan12345', 'Welcome, GLHF!']);
    const notice = irc.parseLine(':tmi.twitch.tv NOTICE * :Improperly formatted auth');
    assert.deepEqual(notice.params, ['*', 'Improperly formatted auth']);
    const rc = irc.parseLine(':tmi.twitch.tv RECONNECT');
    assert.equal(rc.command, 'RECONNECT');
    assert.deepEqual(rc.params, []);
  });

  test('ROOMSTATE', () => {
    const p = irc.parseLine('@emote-only=0;followers-only=1440;r9k=0;room-id=71092938;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #xqc');
    assert.equal(p.command, 'ROOMSTATE');
    assert.deepEqual(p.params, ['#xqc']);
    assert.equal(p.tags['room-id'], '71092938');
    assert.equal(p.tags['followers-only'], '1440');
  });

  test('CLEARCHAT: timeout, and clear-all with no target', () => {
    const to = irc.parseLine('@ban-duration=30;room-id=672238954;target-user-id=591884705;tmi-sent-ts=1790299184119 :tmi.twitch.tv CLEARCHAT #plaqueboymax :deebakinn');
    assert.equal(to.command, 'CLEARCHAT');
    assert.deepEqual(to.params, ['#plaqueboymax', 'deebakinn']);
    assert.equal(to.tags['target-user-id'], '591884705');
    assert.equal(to.tags['ban-duration'], '30');
    const all = irc.parseLine('@room-id=672238954;tmi-sent-ts=1790299184119 :tmi.twitch.tv CLEARCHAT #plaqueboymax');
    assert.deepEqual(all.params, ['#plaqueboymax']);
    assert.equal(all.tags['target-user-id'], undefined);
  });

  test('CLEARMSG', () => {
    const p = irc.parseLine('@login=keoneart;room-id=672238954;target-msg-id=f0ea0c84-aaaa-bbbb;tmi-sent-ts=1790299497372 :tmi.twitch.tv CLEARMSG #plaqueboymax :Tae');
    assert.equal(p.command, 'CLEARMSG');
    assert.equal(p.tags['target-msg-id'], 'f0ea0c84-aaaa-bbbb');
    assert.equal(p.tags.login, 'keoneart');
    assert.deepEqual(p.params, ['#plaqueboymax', 'Tae']);
  });

  test('USERNOTICE with escaped system-msg', () => {
    const p = irc.parseLine('@login=gifter;msg-id=resub;system-msg=Gifter' + BS + 'ssubscribed' + BS + 's!;room-id=1 :tmi.twitch.tv USERNOTICE #chan :hi there');
    assert.equal(p.command, 'USERNOTICE');
    assert.equal(p.tags['system-msg'], 'Gifter subscribed !');
    assert.deepEqual(p.params, ['#chan', 'hi there']);
  });

  test('JOIN, lowercase commands and extra spaces', () => {
    const j = irc.parseLine(':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #xqc');
    assert.equal(j.command, 'JOIN');
    assert.equal(j.nick, 'justinfan1');
    assert.equal(irc.parseLine('ping :x').command, 'PING');
    assert.deepEqual(irc.parseLine(':tmi.twitch.tv  CAP  *  ACK :x').params, ['*', 'ACK', 'x']);
  });

  test('recent-messages line with bare tags', () => {
    const p = irc.parseLine('@badge-info=;badges=;client-nonce=x;color=;display-name=Foo;emotes=;flags;historical=1;id=1;mod=0;' +
      'rm-received-ts=1790300000000;room-id=1;subscriber=0;tmi-sent-ts=1790299999999;turbo=0;user-id=5;user-type; ' +
      ':foo!foo@foo.tmi.twitch.tv PRIVMSG #chan :old message');
    assert.equal(p.tags.flags, '');
    assert.equal(p.tags['user-type'], '');
    assert.equal(p.tags.historical, '1');
    const m = irc.toChatMessage(p);
    assert.equal(m.historical, true);
    assert.equal(m.ts, 1790299999999);
    assert.equal(m.text, 'old message');
  });

  test('invalid lines return null', () => {
    assert.equal(irc.parseLine(''), null);
    assert.equal(irc.parseLine(null), null);
    assert.equal(irc.parseLine('@tagsonly'), null);
    assert.equal(irc.parseLine(':prefixonly'), null);
    assert.equal(irc.parseLine('@a=b :prefix'), null);
  });
});

describe('parseFrame', () => {
  test('splits on CRLF, skips empty and invalid lines', () => {
    const frame = 'PING :tmi.twitch.tv\r\n' + PRIVMSG + '\r\n\r\n:bad\r\n:tmi.twitch.tv RECONNECT\r\n';
    const out = irc.parseFrame(frame);
    assert.deepEqual(out.map((p) => p.command), ['PING', 'PRIVMSG', 'RECONNECT']);
    assert.deepEqual(irc.parseFrame(''), []);
  });
});

describe('tag helpers', () => {
  test('parseBadges splits on the first "/"', () => {
    assert.deepEqual(irc.parseBadges('subscriber/12,premium/1'), [{ set: 'subscriber', version: '12' }, { set: 'premium', version: '1' }]);
    assert.deepEqual(irc.parseBadges('predictions/Yes/No'), [{ set: 'predictions', version: 'Yes/No' }]);
    assert.deepEqual(irc.parseBadges('bad,/x,ok/1'), [{ set: 'ok', version: '1' }]);
    assert.deepEqual(irc.parseBadges(''), []);
    assert.deepEqual(irc.parseBadges(undefined), []);
  });

  test('parseEmotesTag reads id:start-end ranges and ignores malformed ones', () => {
    assert.deepEqual(irc.parseEmotesTag('25:0-4,6-10/emotesv2_abc:12-16'), [
      { id: '25', start: 0, end: 4 }, { id: '25', start: 6, end: 10 }, { id: 'emotesv2_abc', start: 12, end: 16 }
    ]);
    assert.deepEqual(irc.parseEmotesTag('x/25:/25:a-b/25:5-2/:1-2'), []);
    assert.deepEqual(irc.parseEmotesTag(''), []);
  });

  test('parseGifsTag reads start-end|id|url entries', () => {
    const url = 'https://media2.giphy.com/media/3oFzm0o2jMKftsaBoc/giphy.gif?cid=abc&rid=giphy.gif';
    assert.deepEqual(irc.parseGifsTag('0-27|3oFzm0o2jMKftsaBoc|' + url), [{ start: 0, end: 27, id: '3oFzm0o2jMKftsaBoc', url }]);
    assert.deepEqual(irc.parseGifsTag('0-3|a|https://x.giphy.com/a.gif,5-9|b|https://x.giphy.com/b.gif').map((g) => g.id), ['a', 'b']);
    assert.deepEqual(irc.parseGifsTag('9-3|a|u'), []);
    assert.deepEqual(irc.parseGifsTag(''), []);
  });

  test('parseGifsTag matches the previous global-regex parser on well-formed tags', () => {
    function oldParse(str) {
      const out = [];
      if (!str) return out;
      const re = /(\d+)-(\d+)\|([^|,]*)\|([^,]*)/g;
      let m;
      while ((m = re.exec(str))) {
        const s = +m[1], e = +m[2];
        if (e >= s) out.push({ start: s, end: e, id: m[3], url: m[4] });
      }
      return out;
    }
    const url = 'https://media2.giphy.com/media/3oFzm0o2jMKftsaBoc/giphy.gif?cid=abc&rid=giphy.gif';
    const tags = [
      '0-27|3oFzm0o2jMKftsaBoc|' + url,
      '0-3|a|https://x.giphy.com/a.gif,5-9|b|https://x.giphy.com/b.gif',
      '0-3|a|https://x.giphy.com/a.gif,9-3|bad|u,11-20|c|https://x.giphy.com/c.gif?x=1|2',
      '0-3||,4-8|id|',
      '9-3|a|u',
      'garbage,0-1|a,2-3|b|u'
    ];
    tags.forEach((tag) => assert.deepEqual(irc.parseGifsTag(tag), oldParse(tag), tag));
  });

  test('parseGifsTag is linear on pathological input (e.g. from a hostile history server)', () => {
    const inputs = [
      '1'.repeat(200000),
      '0-' + '1'.repeat(200000),
      '0-0|' + 'a'.repeat(200000),
      '1-'.repeat(100000),
      '1,'.repeat(100000),
      '0-0|a|' + '|'.repeat(200000)
    ];
    const t0 = Date.now();
    const results = inputs.map((s) => irc.parseGifsTag(s));
    const ms = Date.now() - t0;
    assert.ok(ms < 500, 'took ' + ms + ' ms');
    assert.deepEqual(results.slice(0, 5), [[], [], [], [], []]);
    assert.equal(results[5].length, 1);
    assert.equal(results[5][0].url.length, 200000);
  });

  test('trimEol drops trailing CR/LF only, in linear time', () => {
    assert.equal(irc.trimEol('PING :x\r\n'), 'PING :x');
    assert.equal(irc.trimEol('a\n\r\n\r'), 'a');
    assert.equal(irc.trimEol('\r\na b\r\nc'), '\r\na b\r\nc');
    assert.equal(irc.trimEol('\r\n\n'), '');
    assert.equal(irc.trimEol(''), '');
    const big = '\n'.repeat(200000) + 'x';
    const t0 = Date.now();
    assert.equal(irc.trimEol(big), big);
    assert.equal(irc.trimEol('x' + '\r\n'.repeat(100000)), 'x');
    assert.ok(Date.now() - t0 < 200);
  });

  test('stripAction', () => {
    assert.deepEqual(irc.stripAction(SOH + 'ACTION waves' + SOH), { text: 'waves', action: true });
    assert.deepEqual(irc.stripAction(SOH + 'ACTION ' + SOH), { text: '', action: true });
    assert.deepEqual(irc.stripAction('normal'), { text: 'normal', action: false });
    assert.deepEqual(irc.stripAction(SOH + 'ACTION no end'), { text: SOH + 'ACTION no end', action: false });
    assert.deepEqual(irc.stripAction(undefined), { text: '', action: false });
  });
});

describe('toChatMessage', () => {
  test('shapes a PRIVMSG', () => {
    const m = irc.toChatMessage(irc.parseLine(PRIVMSG));
    assert.equal(m.kind, 'chat');
    assert.equal(m.id, 'f0ea0c84-1111-2222-3333-444455556666');
    assert.equal(m.roomId, '71092938');
    assert.equal(m.userId, '123456');
    assert.equal(m.login, 'someuser');
    assert.equal(m.displayName, 'SomeUser');
    assert.equal(m.color, '#1E90FF');
    assert.deepEqual(m.badges, [{ set: 'subscriber', version: '48' }, { set: 'premium', version: '1' }]);
    assert.equal(m.ts, 1790299061671);
    assert.equal(m.text, 'Kappa hello :) world');
    assert.equal(m.action, false);
    assert.equal(m.emotes, '25:0-4');
    assert.equal(m.gifs, '');
    assert.equal(m.bits, 0);
    assert.equal(m.msgId, '');
    assert.equal(m.firstMsg, false);
    assert.equal(m.reply, null);
    assert.equal(m.mirrored, false);
    assert.equal(m.historical, false);
    // fields nothing reads are not built (and the tag object is not kept alive with the line)
    ['channel', 'badgeInfo', 'mod', 'tags', 'rawType', 'params'].forEach((k) => assert.equal(k in m, false, k));
  });

  test('display-name falls back to the login; invalid colors are dropped', () => {
    const m = irc.toChatMessage(irc.parseLine('@color=red;display-name=;user-id=1 :lower!lower@lower.tmi.twitch.tv PRIVMSG #c :hi'));
    assert.equal(m.displayName, 'lower');
    assert.equal(m.color, '');
    assert.ok(Math.abs(m.ts - Date.now()) < 5000, 'missing tmi-sent-ts falls back to now');
  });

  test('ACTION is stripped and flagged; emote ranges stay relative to the stripped text', () => {
    const m = irc.toChatMessage(irc.parseLine('@emotes=25:0-4;user-id=1 :u!u@u.tmi.twitch.tv PRIVMSG #c :' + SOH + 'ACTION Kappa waves' + SOH));
    assert.equal(m.action, true);
    assert.equal(m.text, 'Kappa waves');
    const r = irc.parseEmotesTag(m.emotes)[0];
    assert.equal(Array.from(m.text).slice(r.start, r.end + 1).join(''), 'Kappa');
  });

  test('bits, msg-id, first-msg, gifs', () => {
    const m = irc.toChatMessage(irc.parseLine('@bits=100;msg-id=highlighted-message;first-msg=1;gifs=0-3|a|https://media.giphy.com/a.gif :u!u@u.tmi.twitch.tv PRIVMSG #c :[gg]'));
    assert.equal(m.bits, 100);
    assert.equal(m.msgId, 'highlighted-message');
    assert.equal(m.firstMsg, true);
    assert.equal(m.gifs, '0-3|a|https://media.giphy.com/a.gif');
  });

  test('reply tags', () => {
    const m = irc.toChatMessage(irc.parseLine('@reply-parent-display-name=LMNfm;reply-parent-msg-body=@kannotaim' + BS + 'sthe' + BS + 'sus;' +
      'reply-parent-msg-id=p-1;reply-parent-user-id=77;reply-parent-user-login=LMNfm :u!u@u.tmi.twitch.tv PRIVMSG #xqc :@LMNfm cuh'));
    assert.deepEqual(m.reply, { id: 'p-1', userId: '77', login: 'lmnfm', name: 'LMNfm', body: '@kannotaim the us' });
    assert.equal(m.text, '@LMNfm cuh');
  });

  test('shared chat: a message from another room is mirrored', () => {
    const m = irc.toChatMessage(irc.parseLine('@id=new;room-id=11148817;source-room-id=22484632;source-id=orig;source-badges=moderator/1,subscriber/48;badges=bits/100 :u!u@u.tmi.twitch.tv PRIVMSG #c :hi'));
    assert.equal(m.mirrored, true);
    assert.equal(m.sourceId, 'orig');
    assert.equal(m.sourceRoomId, '22484632');
    assert.deepEqual(m.sourceBadges, [{ set: 'moderator', version: '1' }, { set: 'subscriber', version: '48' }]);
    assert.deepEqual(m.badges, [{ set: 'bits', version: '100' }]);
    const same = irc.toChatMessage(irc.parseLine('@room-id=1;source-room-id=1 :u!u@u.tmi.twitch.tv PRIVMSG #c :hi'));
    assert.equal(same.mirrored, false);
  });
});

describe('toNoticeMessage', () => {
  const RESUB = '@badge-info=subscriber/5;badges=subscriber/3;color=;display-name=Gifter;emotes=25:13-17;id=abc;login=gifter;' +
    'msg-id=resub;msg-param-cumulative-months=5;msg-param-sub-plan=1000;room-id=1;' +
    'system-msg=Gifter' + BS + 'ssubscribed' + BS + 'sat' + BS + 'sTier' + BS + 's1.;tmi-sent-ts=5;user-id=42;vip=0 ' +
    ':tmi.twitch.tv USERNOTICE #chan :great stream Kappa';

  test('shapes a resub with a user message', () => {
    const m = irc.toNoticeMessage(irc.parseLine(RESUB));
    assert.equal(m.kind, 'notice');
    assert.equal(m.type, 'resub');
    assert.equal(m.systemMsg, 'Gifter subscribed at Tier 1.');
    assert.equal(m.text, 'great stream Kappa');
    assert.equal(m.emotes, '25:13-17');
    assert.equal(m.login, 'gifter');
    assert.equal(m.displayName, 'Gifter');
    assert.equal(m.userId, '42');
    ['channel', 'badgeInfo', 'mod', 'tags', 'rawType'].forEach((k) => assert.equal(k in m, false, k));
    assert.equal(m.mirrored, false);
    assert.equal(m.reply, null);
  });

  test('a notice without a user message has empty text', () => {
    const m = irc.toNoticeMessage(irc.parseLine('@msg-id=raid;login=raider;system-msg=5' + BS + 'sraiders;room-id=1 :tmi.twitch.tv USERNOTICE #chan'));
    assert.equal(m.text, '');
    assert.equal(m.type, 'raid');
    assert.equal(m.systemMsg, '5 raiders');
  });

  test('sharedchatnotice uses source-msg-id and counts as mirrored; announce color is uppercased', () => {
    const m = irc.toNoticeMessage(irc.parseLine('@msg-id=sharedchatnotice;source-msg-id=announcement;msg-param-color=primary;' +
      'room-id=1;source-room-id=1025594235;login=a :tmi.twitch.tv USERNOTICE #chan :hello all'));
    assert.equal(m.type, 'announcement');
    assert.equal(m.msgId, 'sharedchatnotice');
    assert.equal(m.mirrored, true);
    assert.equal(m.announceColor, 'PRIMARY');
  });

  test('community gift id is exposed for burst collapsing', () => {
    const m = irc.toNoticeMessage(irc.parseLine('@msg-id=submysterygift;msg-param-community-gift-id=6833281778898429912;msg-param-mass-gift-count=5;login=g :tmi.twitch.tv USERNOTICE #chan'));
    assert.equal(m.communityGiftId, '6833281778898429912');
  });

  test('msg-param-* tags are kept as params (bitsbadgetier threshold)', () => {
    const m = irc.toNoticeMessage(irc.parseLine('@msg-id=bitsbadgetier;msg-param-threshold=1000;login=c :tmi.twitch.tv USERNOTICE #chan'));
    assert.equal(m.params.threshold, '1000');
  });
});
