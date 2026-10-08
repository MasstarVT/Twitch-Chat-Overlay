'use strict';
// Default parity. Every option added after 1.5.2 must leave the overlay, the builder's URLs and settings.js
// exactly as 1.5.2 had them while the option is at its default. tests/fixtures/parity-*.json hold what the
// untouched 1.5.2 tree (607c343) computed, captured by tests/parity-capture.js; the same capture runs here on
// the current code. The generic tests after them keep every setting honest: it round-trips, it is left out of
// the URL at its default, it changes what is drawn when set, and setting it back undoes the change.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cap = require('./parity-capture.js');
const { createDocument } = require('./fake-dom.js');
const { flip } = require('./flip.js');
const config = require('../js/config.js');
const renderer = require('../js/renderer.js');

const R = renderer._internal;
const ROOT = path.join(__dirname, '..');
// A fixture file as written (toJson + a newline); a checkout may have given it CRLF line ends.
const fixtureText = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'parity-' + name + '.json'), 'utf8').replace(/\r\n/g, '\n');
const fixture = (name) => JSON.parse(fixtureText(name));
const plain = (v) => JSON.parse(JSON.stringify(v));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- the 1.5.2 fixtures ----------

// The fixtures stay what 1.5.2 computed (write-fixtures.js --base 607c343). These are the only changes the current code
// makes to them on purpose, each a bug fix, applied to the expectation here:
// - The Beta Tester badge (img/logos/Beta.svg) is drawn, right after the developer badge and as big: renderer.pickUrl
//   allows both of the app's own badge files, where 1.5.2 let the developer one through only (models, dom).
// - A reply to a blocked user keeps its reply (overlay.js quotesHidden leaves its header out as the line is drawn), so the
//   'filtered' boot takes it in as the defaults boot does: with its reply, and without its "@name" in the tokens (intake).
// - With kick_room the Kick channel lookup (sub badge images, the channel's 7TV set) is retried like every other load once
//   it fails, where 1.5.2 asked once: both boots set kick_room, the capture's lookup always fails, and its 6 s take in
//   the retry 3 s later, so each lists kick-lookup(kickname) twice (intake loaders).
function withFixes(name, old) {
  const out = plain(old);
  if (name === 'models' || name === 'dom') {
    const isDev = name === 'models' ? (x) => !!x && x.url === 'img/logos/Badge.svg' && x.title === 'MasstarVT developer'
      : (x) => !!x && x.tag === 'IMG' && !!x.props && x.props.src === 'img/logos/Badge.svg';
    const betaOf = (dev) => {
      const b = plain(dev);
      if (name === 'models') Object.assign(b, { url: 'img/logos/Beta.svg', title: 'Beta Tester' });
      else Object.assign(b.props, { alt: 'Beta Tester', src: 'img/logos/Beta.svg' });
      return b;
    };
    let added = 0;
    (function walk(v) {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          if (isDev(v[i])) { v.splice(i + 1, 0, betaOf(v[i])); i++; added++; } else walk(v[i]);
        }
      } else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k]));
    })(out);
    assert.ok(added > 0, name + ': the developer sample is there to take the Beta Tester badge');
  }
  if (name === 'intake') {
    const blocked = new URLSearchParams(cap.INTAKE_BOOTS.filtered).get('block').split(',');
    const atDefaults = new Map(out.defaults.records.filter((r) => r.msg.id).map((r) => [r.msg.id, r]));
    let kept = 0;
    out.filtered.records.forEach((r) => {
      const d = atDefaults.get(r.msg.id);
      if (r.msg.reply !== null || !d || !d.msg.reply || blocked.indexOf(d.msg.reply.login) < 0) return;
      r.msg.reply = plain(d.msg.reply);
      r.tokens = plain(d.tokens);
      kept++;
    });
    assert.ok(kept > 0, 'intake: the transcript has replies to a blocked user');
    ['defaults', 'filtered'].forEach((b) => {
      assert.ok(/[?&]kick_room=\d/.test(cap.INTAKE_BOOTS[b]), b + ' sets kick_room');
      const at = out[b].loaders.indexOf('kick-lookup(kickname)');
      assert.ok(at >= 0 && out[b].loaders.lastIndexOf('kick-lookup(kickname)') === at, b + ': 1.5.2 looked it up once');
      out[b].loaders.splice(at, 0, 'kick-lookup(kickname)');
    });
  }
  return out;
}

// The same JSON, and the same text (so key order too, which the renderer's line signatures depend on): 1.5.2's with the
// bug fixes above.
function sameAsFixture(name, now) {
  assert.strictEqual(cap.toJson(fixture(name)) + '\n', fixtureText(name), 'parity-' + name + '.json reads back as written');
  const want = withFixes(name, fixture(name));
  assert.deepStrictEqual(plain(now), want);
  assert.strictEqual(cap.toJson(now), cap.toJson(want), 'parity-' + name + '.json: same key order');
}

test('parity: the renderer builds the 1.5.2 line models (full and partial configs, DPR 1 and 2)', async () => {
  sameAsFixture('models', await cap.captureModels());
});

test('parity: the real renderer draws the 1.5.2 DOM (every element, attribute, style key and paint rule)', async () => {
  sameAsFixture('dom', await cap.captureDom());
});

test('parity: overlay.js takes in the 1.5.2 transcript the same way (pushes, names, badges, tokens, filters)', async () => {
  // Includes shouldShow at push and at the end for every message, at the defaults and with today's filters on.
  sameAsFixture('intake', await cap.captureIntake());
});

// The preview and file:// URLs and the home page's demo frames list every key, so they grow with each new
// key: there the 1.5.2 keys keep their values and order, and a key 1.5.2 didn't have is at its default.
function sameGrowing(now, old, where) {
  const oldKeys = new Set(old.params.map((p) => p[0]));
  assert.deepStrictEqual(now.params.filter((p) => oldKeys.has(p[0])), old.params, where + ': the 1.5.2 keys');
  now.params.filter((p) => !oldKeys.has(p[0])).forEach((p) => {
    assert.ok(own(config.SPEC, p[0]), where + ': ' + p[0] + ' is a setting');
    assert.strictEqual(p[1], config.serialize(p[0], config.SPEC[p[0]].def), where + ': ' + p[0] + ' at its default');
  });
  assert.strictEqual(now.url.split('?')[0], old.url.split('?')[0], where);
}

test('parity: hosted overlay URLs and settings.js are byte for byte 1.5.2\'s; the long URLs only grow', async () => {
  const now = await cap.captureUrls();
  const old = fixture('urls');
  assert.deepStrictEqual(Object.keys(now.samples), Object.keys(old.samples));
  Object.keys(old.samples).forEach((k) => {
    const a = now.samples[k], b = old.samples[k];
    assert.deepStrictEqual(a.hosted, b.hosted, k + ': overlay URL');
    assert.strictEqual(a.toParams, b.toParams, k + ': toParams');
    assert.deepStrictEqual(plain(a.toObject), b.toObject, k + ': toObject');
    assert.strictEqual(a.settings, b.settings, k + ': settings.js');
    sameGrowing(a.preview, b.preview, k + ' preview');
    sameGrowing(a.file, b.file, k + ' file://');
  });
  assert.strictEqual(now.demoSrc.length, old.demoSrc.length);
  now.demoSrc.forEach((d, i) => {
    assert.strictEqual(d.src, old.demoSrc[i].src);
    sameGrowing(d, old.demoSrc[i], 'demo ' + d.src);
  });
});

test('parity: the Google Fonts requests at boot and for live font changes are 1.5.2\'s', async () => {
  const now = await cap.captureFonts();
  assert.deepStrictEqual(plain(now), fixture('urls').fonts);
  // (j) pinned outright as well: a weight added to the list would re-download every font for every streamer.
  assert.strictEqual(now.inter, 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  assert.deepStrictEqual(now.boot, [{ rel: 'stylesheet', href: now.inter }]);
});

// ---------- generic tests over every setting ----------

test('(a) every setting but channel round-trips through the URL, at its default and changed', () => {
  const d = config.defaults();
  config.KEYS.filter((k) => k !== 'channel').forEach((k) => {
    const def = config.SPEC[k].def;
    assert.deepStrictEqual(config.coerce(k, config.serialize(k, def)), def, k);
    assert.ok(config.isDefault(k, def), k);
    // flip() (tests/flip.js) has a case for the key's type: it throws on one it doesn't know.
    const c = flip(d, k);
    assert.notDeepStrictEqual(c[k], def, k + ': flip changes it');
    assert.deepStrictEqual(config.coerce(k, config.serialize(k, c[k])), c[k], k + ': changed');
    assert.ok(!config.isDefault(k, c[k]), k);
    assert.deepStrictEqual(config.parse(config.toParams(c)), c, k + ': through toParams');
    assert.deepStrictEqual(config.parse('', config.toObject(c)), c, k + ': through toObject');
  });
  // channel: '' is "no channel", which coerce refuses as a value; an explicit empty channel= reads as ''.
  assert.strictEqual(config.parse('channel=').channel, '');
  assert.strictEqual(config.parse('channel=', { channel: 'x' }).channel, '');
});

test('(b) at the defaults a config puts nothing in the URL or in settings.js', () => {
  assert.strictEqual(config.toParams(config.defaults()).toString(), '');
  assert.deepStrictEqual(config.toObject(config.defaults()), {});
  const d = config.defaults();
  config.KEYS.forEach((k) => assert.ok(config.isDefault(k, d[k]), k));
});

test('(c) #chat at the defaults: three classes and three variables, as in 1.5.2', async () => {
  await cap.isolated(() => {
    const M = cap.modules();
    const x = cap.renderSamples(M, M.config.defaults(), 1);
    assert.deepStrictEqual(x.root.className.split(' ').sort(), ['align-bottom', 'layout-vertical', 'size-medium']);
    assert.deepStrictEqual(Object.assign({}, x.root.style),
      { '--font': '"Inter"', '--shadow': M.renderer._internal.SHADOWS[2], '--bg-alpha': '0' });
    x.r.destroy();
  });
});

// ---------- the overlay's own deps on the real renderer ----------

// overlay.js booted at the defaults with a Twitch and a Kick channel, and the capture's whole transcript fed
// through its handlers (parity-capture intakeWorld). drive() pushes every message that reached the renderer
// into a real renderer on a fake document, with the overlay's own deps: nameFor, badgesFor, tokensFor,
// shouldShow and paintRule read the overlay's S.cfg, which drive() sets along with the renderer's.
function inWorld(fn) {
  return cap.isolated(async () => {
    const h = await cap.intakeWorld(cap.INTAKE_BOOTS.defaults);
    const T = globalThis.TCO;
    const S = T.overlay.state();
    // bootOverlay stubbed createRenderer on the renderer module the overlay booted with: a fresh copy.
    const file = require.resolve('../js/renderer.js');
    delete require.cache[file];
    const Rm = require(file);
    const msgs = h.pushed.map((p) => p.m);
    // The capture's Homies lists are empty: one Homies badge, so badges_homies has something to hide.
    const fan = msgs.filter((m) => m.login === 'subfan')[0];
    S.homies = new Map([[fan.userId, [{ provider: 'homies', title: 'Homie', urls: { 1: 'https://cdn.chatterinohomies.com/badges/1x.png' } }]]]);
    // A chat line that arrives after a change (an entrance animation shows only on a new line).
    const chat = cap.sampleSet().filter((s) => s.key === 'chat')[0].irc;
    const extra = T.ircParse.toChatMessage(T.ircParse.parseLine(chat.replace(';id=m-chat;', ';id=m-extra;')));
    return fn({ S: S, deps: h.deps, Rm: Rm, msgs: msgs, extra: extra, cfg0: Object.assign({}, S.cfg) });
  });
}

// #chat (class set and inline style), .lines' own inline style (a value set back to '' is no declaration on a page),
// each line (whole subtree, its animation aside), the lines' animations, and the paint rules.
function snapshot(root, doc) {
  const box = root.firstElementChild;
  const kids = box.children;
  return {
    root: { cls: root.className.split(/\s+/).filter(Boolean).sort(), style: Object.assign({}, root.style) },
    box: Object.keys(box.style).filter((p) => box.style[p] !== '').reduce((o, p) => { o[p] = box.style[p]; return o; }, {}),
    lines: kids.map((l) => {
      const s = cap.serialize(l);
      if (s.style) {
        delete s.style.animation; // restartFades rewrites it
        if (!Object.keys(s.style).length) delete s.style;
      }
      return s;
    }),
    anim: kids.map((l) => l.style.animation || ''),
    rules: doc.head.children.map((e) => (e.sheet ? e.sheet.cssRules.slice() : []))
  };
}

// A renderer at cfgs[0] with every message pushed, then each later config in turn (as the builder's live
// updates arrive), then (extra) one more message. The snapshot's msgs (not enumerable, so not compared with
// it) are the lines' own messages in DOM order, which rerender's predicate is handed.
function drive(w, cfgs, extra) {
  const doc = createDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  w.S.cfg = cfgs[0];
  const r = w.Rm.createRenderer({ root: root, cfg: cfgs[0], deps: w.deps });
  w.msgs.forEach((m) => r.push(m));
  r.flush();
  cfgs.slice(1).forEach((c) => { w.S.cfg = c; r.setConfig(c); });
  if (extra) { r.push(w.extra); r.flush(); }
  const out = snapshot(root, doc);
  const msgs = [];
  r.rerender((m) => { msgs.push(m); return false; });
  Object.defineProperty(out, 'msgs', { value: msgs, enumerable: false });
  r.destroy();
  return out;
}

// What a key needs set first before it can show anything (the builder's META.when): a badge source needs
// badges on, the platform icons need both a Twitch and a Kick channel. A key that isn't listed needs nothing.
const PREREQ = {
  badges_twitch: { badges: true },
  badges_kick: { badges: true },
  badges_7tv: { badges: true },
  badges_bttv: { badges: true },
  badges_ffz: { badges: true },
  badges_ffzap: { badges: true },
  badges_chatterino: { badges: true },
  badges_homies: { badges: true },
  platform_icons: { channel: 'home', kick: 'kickname' },
  name_line: { names: true, layout: 'vertical' },
  bg_color: { bg: 40 },
  bg_shape: { bg: 40 },
  bg_width: { bg: 40, layout: 'vertical' },
  notice_color: { events: true },
  notice_size: { events: true },
  first_msg_color: { first_msg: true },
  shadow_color: { shadow: 2 },
  shadow_style: { shadow: 2 },
  outline_color: { outline: 2 },
  paint_images: { paints: true },
  text_align: { layout: 'vertical' },
  row_sep: { layout: 'horizontal' },
  size: { text_px: 0 },
  emote_only: { layout: 'vertical' },
  // 40 px text: the transcript's GIF is drawn 210 px tall at 3x, past Giphy's 200 px file, so gif_size picks its file.
  gif_size: { gifs: true, layout: 'vertical', text_px: 40 },
  giant_emotes: { layout: 'vertical' },
  name_fallback: { name_color: '' },
  name_sep: { names: true },
  readable_level: { readable: true },
  reply_style: { replies: true },
  mention_color: { mentions: 'at' },
  keyword_color: { keywords: ['nice'] },
  points_color: { points_highlight: true },
  broadcaster_color: { role_style: 'tint' },
  mod_color: { role_style: 'tint' },
  vip_color: { role_style: 'bar' },
  event_subs: { events: true },
  event_gifts: { events: true },
  event_raids: { events: true },
  event_bits_badge: { events: true },
  event_announcements: { events: true },
  command_prefixes: { hide_commands: true },
  enter_style: { animate: true },
  enter_ms: { animate: true },
  // These two also without an entrance, which nothing ends here (no animationend): a line still coming in takes a
  // new fade-out length or exit only as its entrance ends.
  fade_out_ms: { fade: 30, animate: false },
  exit_style: { fade: 30, animate: false },
  smooth_scroll: { animate: true, layout: 'vertical' }
};
function withPrereq(cfg, k) { return Object.assign({}, cfg, PREREQ[k] || {}); }

// flip()'s value, except where that changes nothing on the transcript: max 51 caps nothing, nobody in it is
// called "someone" or says "some words", badges and emotes 1% bigger still come from the same files, and a
// contrast of 4.6 lightens most names no further than 4.5 does (7:1 lightens every dark one).
const SHOWS = { max: 5, block: ['waver'], badge_size: 200, emote_scale: 150, readable_level: 70, keywords: ['nice'],
  highlight_users: ['waver'] };
function changed(cfg, k) {
  if (!own(SHOWS, k)) return flip(cfg, k);
  const c = Object.assign({}, cfg);
  c[k] = SHOWS[k];
  return c;
}

// Keys that reorder, re-time or cap the lines rather than draw them (each has its own tests in
// renderer-dom.test.js); listed ahead for the options that will join them.
const LIFECYCLE = ['layout', 'align', 'fade', 'max', 'animate', 'enter_style', 'enter_ms', 'exit_style', 'fade_out_ms', 'smooth_scroll'];
// Filter keys that redraw as well: flip()'s value for links is shorten, which rewrites lines and hides none, so the
// revert and effect tests take it like any drawn key (the filter test has its hide). replies draws the header, and is a
// filter only with block_words set (FILTER_WITH): a reply's "@Parent" is matched only while replies=0 draws it.
const REDRAWS = ['links', 'replies'];
const filterOnly = (k) => R.FILTER_KEYS.indexOf(k) >= 0 && REDRAWS.indexOf(k) < 0;
// Lifecycle keys whose effect needs a page that is laid out: smooth_scroll moves the lines by what it measures, and the
// fake document here measures nothing. renderer-dom.test.js gives them a layout ("smooth_scroll: ...").
const MEASURED = ['smooth_scroll'];

test('PREREQ and SHOWS name settings and valid values', () => {
  Object.keys(PREREQ).forEach((k) => {
    assert.ok(own(config.SPEC, k), k);
    Object.keys(PREREQ[k]).forEach((p) => assert.deepStrictEqual(config.coerce(p, PREREQ[k][p]), PREREQ[k][p], k + ' needs ' + p));
  });
  Object.keys(SHOWS).forEach((k) => assert.deepStrictEqual(config.coerce(k, SHOWS[k]), SHOWS[k], k));
});

test('(d) a live setting set and set back leaves #chat and .lines as they were, and every line too unless it filters or re-times them', async () => {
  await inWorld((w) => {
    config.LIVE_KEYS.forEach((k) => {
      const base = withPrereq(w.cfg0, k);
      const before = drive(w, [base]);
      const after = drive(w, [base, changed(base, k), base]);
      // Class SET: classList.toggle appends, so a class switched off and on again moves to the end.
      assert.deepStrictEqual(after.root, before.root, k + ': #chat');
      assert.deepStrictEqual(after.box, before.box, k + ': .lines');
      const drawn = R.ROOT_KEYS.indexOf(k) >= 0 || R.RERENDER_KEYS.indexOf(k) >= 0;
      if (drawn && !filterOnly(k) && LIFECYCLE.indexOf(k) < 0) {
        assert.deepStrictEqual(after.lines, before.lines, k + ': the lines');
      }
    });
  });
});

// The builder's preview changes a live setting on the lines already shown; OBS loads the overlay with it. Both must
// draw the same lines (a key missing from RERENDER_KEYS leaves the lines shown as the old setting drew them).
test('(d) a live setting changed on lines already shown draws them as a renderer started with it does', async () => {
  await inWorld((w) => {
    config.LIVE_KEYS.filter((k) => LIFECYCLE.indexOf(k) < 0 && !filterOnly(k) && MEASURED.indexOf(k) < 0).forEach((k) => {
      const base = withPrereq(w.cfg0, k);
      const c = changed(base, k);
      const live = drive(w, [base, c]);
      const fresh = drive(w, [c]);
      assert.deepStrictEqual(live.root, fresh.root, k + ': #chat');
      assert.deepStrictEqual(live.box, fresh.box, k + ': .lines');
      assert.deepStrictEqual(live.lines, fresh.lines, k + ': the lines');
    });
  });
});

test('(e) every key the renderer handles changes what is drawn (a key listed but never used fails here)', async () => {
  await inWorld((w) => {
    const keys = R.ROOT_KEYS.concat(R.RERENDER_KEYS.filter((k) => R.ROOT_KEYS.indexOf(k) < 0))
      .filter((k) => !filterOnly(k));
    REDRAWS.forEach((k) => assert.ok(keys.indexOf(k) >= 0, k));
    MEASURED.forEach((k) => assert.ok(R.ROOT_KEYS.indexOf(k) >= 0 && LIFECYCLE.indexOf(k) >= 0, k));
    assert.ok(keys.length >= 20, 'the keys are found');
    keys.filter((k) => MEASURED.indexOf(k) < 0).forEach((k) => {
      const base = withPrereq(w.cfg0, k);
      const a = drive(w, [base, base], true);
      const b = drive(w, [base, changed(base, k)], true);
      if (R.ROOT_KEYS.indexOf(k) >= 0 && LIFECYCLE.indexOf(k) < 0) assert.notDeepStrictEqual(b.root, a.root, k + ' changes #chat');
      if (R.RERENDER_KEYS.indexOf(k) >= 0) assert.notDeepStrictEqual(b.lines, a.lines, k + ' changes a line');
      assert.notDeepStrictEqual(b, a, k + ' changes what is drawn');
    });
  });
});

// The name colors on the whole transcript (overlay.js nameFor, Twitch and Kick): 1.5.2's at the defaults (the intake
// fixture pins them too), name_fallback only where a chatter has no color, name_color everywhere.
test('(e) the name colors: name_fallback reaches only the colorless chatters, name_color every name, both as picked', async () => {
  await inWorld((w) => {
    const util = globalThis.TCO.util;
    const chats = w.msgs.filter((m) => m.kind === 'chat');
    const colorOf = (over, m) => { w.S.cfg = Object.assign({}, w.cfg0, over); return w.deps.nameFor(m).color; };
    const plain = chats.filter((m) => !m.color);
    assert.ok(plain.some((m) => m.platform === 'kick') && plain.some((m) => m.platform !== 'kick'), 'colorless Twitch and Kick chatters');
    chats.forEach((m) => {
      const today = util.readableColor(m.color || util.defaultColor(m.userId, m.login));
      assert.strictEqual(colorOf({}, m), today, m.id);
      assert.strictEqual(colorOf({ readable_level: 45 }, m), today);
      assert.strictEqual(colorOf({ name_fallback: '000033' }, m), m.color ? today : '#000033', m.id);
      assert.strictEqual(colorOf({ name_color: '000033', readable_level: 70 }, m), '#000033', m.id);
    });
    w.S.cfg = w.cfg0;
  });
});

// The highlights on the whole transcript, through the overlay's own intake (the Twitch tags as irc-parse reads them,
// the Kick badges as kick.js does): only the channel-points highlight at the defaults, as in 1.5.2, and with an
// option on, exactly the lines it should mark. Notices and announcements never get one.
test('(e) the highlights mark exactly their lines of the transcript, Twitch and Kick; at the defaults only channel points', async () => {
  await inWorld((w) => {
    const HL = /^(?:highlight|mention|keyword|user-hl|role-[a-z]+)$/;
    const marks = (over) => {
      const d = drive(w, [Object.assign({}, w.cfg0, { max: 200 }, over)]);
      const out = {};
      d.lines.forEach((l, i) => {
        const c = (l.cls || '').split(' ').filter((x) => HL.test(x));
        const m = d.msgs[i];
        if (c.length) out[m.id || m.kind + ': ' + m.systemMsg] = c.join(' ');
      });
      return out;
    };
    assert.deepStrictEqual(marks({}), { 'm-points': 'highlight' });
    assert.deepStrictEqual(marks({ points_highlight: false }), {});
    // The channel is home (and kickname on Kick): '@home you rock' is the one mention, also as a bare name (no other
    // line says home). Off, or with no channel at all, nothing.
    assert.deepStrictEqual(marks({ mentions: 'at' }), { 'm-points': 'highlight', 'm-mention': 'mention' });
    assert.deepStrictEqual(marks({ mentions: 'name' }), { 'm-points': 'highlight', 'm-mention': 'mention' });
    assert.deepStrictEqual(marks({ mentions: 'name', channel: '', kick: '' }), { 'm-points': 'highlight' });
    // Words in any case, as whole words and phrases; users by login on Twitch and Kick (kickplain's sub notice is a
    // notice: not marked).
    assert.deepStrictEqual(marks({ keywords: ['nice', 'kappa HOW'], highlight_users: ['waver', 'kickplain'] }), {
      'h-1': 'user-hl', 'm-chat': 'keyword', 'm-action': 'user-hl', 'm-points': 'highlight', 'kick:a1b2c3d4-0002': 'user-hl',
      'm-gif': 'keyword', 'm-link': 'user-hl', 'm-mod': 'keyword'
    });
    // The roles from the badge tags (and Kick's badge types): the mod's announcement is left alone, the partner
    // channel's subscriber isn't marked, and the developer's and ffzbot's moderator tags count as they are.
    const bar = 'role-bar';
    assert.deepStrictEqual(marks({ role_style: 'bar' }), {
      'm-reply': 'role-vip ' + bar, 'm-reply-gone': 'role-vip ' + bar, 'm-points': 'highlight',
      'kick:a1b2c3d4-0001': 'role-mod ' + bar, 'kick:a1b2c3d4-0003': 'role-vip ' + bar, 'm-homeshared': 'role-mod ' + bar,
      'm-cheer': 'role-vip ' + bar, 'm-caster': 'role-broadcaster ' + bar, 'm-mod': 'role-mod ' + bar, 'm-dev': 'role-mod ' + bar,
      'x-reply-troll': 'role-vip ' + bar, 'x-reply-cmd': 'role-vip ' + bar, 'x-ffzbot': 'role-mod ' + bar,
      'x-extras': 'role-vip ' + bar, 'x-bitsbadge:m': 'role-vip ' + bar
    });
    // One tint per line: the mod's "please be nice" takes the keyword's, not its role's; a plain mod line the role's.
    const tint = marks({ role_style: 'tint', keywords: ['nice'], mentions: 'at' });
    assert.deepStrictEqual([tint['m-mod'], tint['m-dev'], tint['m-mention'], tint['m-points']],
      ['keyword role-mod', 'role-mod role-tint', 'mention', 'highlight']);
    assert.strictEqual(Object.keys(tint).filter((k) => /^(?:n-|notice)/.test(k)).length, 0, 'no notice or announcement');
    w.S.cfg = w.cfg0;
  });
});

// Each filter: a value that hides less, then one that hides some of the transcript (with its PREREQ set:
// command_prefixes needs hide_commands).
const FILTERS = {
  bots: [true, false],
  hide_commands: [false, true],
  block: [[], ['waver']],
  events: [true, false],
  shared: [true, false],
  event_subs: [true, false],
  event_gifts: [true, false],
  event_raids: [true, false],
  event_bits_badge: [true, false],
  event_announcements: [true, false],
  role_filter: ['all', 'subs'],
  allow_users: [[], ['subfan', 'kickfan']],
  block_words: [[], ['nice']],
  min_length: [0, 12],
  links: ['show', 'hide'],
  command_prefixes: ['$', '!'],
  replies: [true, false]
};
// What a filter key needs besides its PREREQ to hide anything, in this test only: replies=0 hides the reply to SubFan
// ("@SubFan thanks for that") once its "@SubFan" is drawn and block_words names it.
const FILTER_WITH = { replies: { block_words: ['subfan'] } };

// Each line goes by its own message: a resub's text line is a chat message, so events=0 keeps it.
test('(f) a filter sweeps exactly the lines it now hides, and nothing else', async () => {
  assert.deepStrictEqual(Object.keys(FILTERS).sort(), R.FILTER_KEYS.slice().sort(), 'a case for every filter key');
  // A line by its message: the id, or (Kick notices have none) the notice text.
  const ids = (list) => list.map((m) => m.id || m.kind + ': ' + m.systemMsg);
  await inWorld((w) => {
    Object.keys(FILTERS).forEach((k) => {
      // Nothing capped, so a line that goes is the filter's doing.
      const from = Object.assign(withPrereq(w.cfg0, k), FILTER_WITH[k] || {}, { max: 200 });
      from[k] = FILTERS[k][0];
      const to = Object.assign({}, from);
      to[k] = FILTERS[k][1];
      const shown = drive(w, [from]);
      const swept = drive(w, [from, to]);
      w.S.cfg = to;
      const want = shown.msgs.filter((m) => w.deps.shouldShow(m));
      assert.ok(want.length < shown.msgs.length, k + ': the transcript has lines it hides');
      // They tell the lines apart: each line has its own (a resub's text line is <notice id>:m).
      assert.strictEqual(new Set(ids(shown.msgs)).size, shown.msgs.length, k + ': one per line');
      assert.deepStrictEqual(ids(swept.msgs), ids(want), k);
    });
  });
});

// The event switches and the chat filters on the whole transcript (Twitch and Kick, through the overlay's own intake),
// switched live: exactly the lines each one should hide go. A switched-off type takes its notices (a Kick host is a
// raid) but never the viewer's own message under one; the chat filters never take a notice.
test('(f) the event switches and the chat filters hide exactly their lines of the transcript', async () => {
  const ids = (list) => list.map((m) => m.id || m.kind + ': ' + m.systemMsg);
  await inWorld((w) => {
    const from = Object.assign({}, w.cfg0, { max: 200 });
    const all = ids(drive(w, [from]).msgs);
    const hidden = (over) => {
      const left = ids(drive(w, [from, Object.assign({}, from, over)]).msgs);
      return all.filter((x) => left.indexOf(x) < 0);
    };
    assert.deepStrictEqual(hidden({ event_subs: false }), ['n-resub', 'n-sub', 'notice: KickFan subscribed for 5 months!', 'x-upgrade',
      'notice: KickPlain subscribed!']);
    assert.ok(all.indexOf('n-resub:m') >= 0, 'the resub\'s own message is there, and stays');
    assert.deepStrictEqual(hidden({ event_gifts: false }), ['x-mystery', 'x-gift3', 'notice: KickFan gifted 3 subs!',
      'notice: KickFan gifted a sub to KickPlain!']);
    assert.deepStrictEqual(hidden({ event_raids: false }), ['n-raid', 'notice: KickHost is hosting with 12 viewers!']);
    assert.deepStrictEqual(hidden({ event_bits_badge: false }), ['x-bitsbadge'], 'its "wow" stays');
    assert.deepStrictEqual(hidden({ event_announcements: false }), ['n-ann', 'x-shared-ann']);
    // Roles from the badge tags (a Shared Chat line by its source badges, a Kick line by its badge types); the broadcaster
    // always passes; notices are never role-filtered.
    assert.deepStrictEqual(hidden({ role_filter: 'subs' }), ['h-1', 'm-action', 'm-first', 'kick:a1b2c3d4-0002', 'm-gif', 'm-intl',
      'm-plain', 'm-dark', 'm-link', 'm-cmd', 'm-painted2', 'm-noname', 'x-troll', 'x-beta', 'x-ritual', 'x-shared-resub', 'x-shared-ann']);
    const mods = hidden({ role_filter: 'mods' });
    ['m-caster', 'm-mod', 'm-dev', 'x-ffzbot', 'm-homeshared', 'kick:a1b2c3d4-0001', 'n-ann'].forEach((x) => assert.ok(mods.indexOf(x) < 0, x));
    ['m-reply', 'kick:a1b2c3d4-0003', 'm-chat', 'n-resub:m'].forEach((x) => assert.ok(mods.indexOf(x) >= 0, x));
    ['n-resub', 'n-sub', 'n-raid', 'x-mystery', 'x-gift3', 'x-upgrade', 'x-bitsbadge'].forEach((x) => assert.ok(mods.indexOf(x) < 0, x));
    assert.ok(!mods.some((x) => /^notice: /.test(x)), 'Kick notices stay');
    // Only these users' chat lines (Twitch and Kick); every notice stays.
    const allow = hidden({ allow_users: ['subfan', 'kickfan'] });
    assert.deepStrictEqual(all.filter((x) => allow.indexOf(x) < 0), ['h-2', 'm-chat', 'n-resub', 'n-resub:m', 'n-sub', 'n-raid',
      'kick:a1b2c3d4-0001', 'notice: KickFan subscribed for 5 months!', 'm-zw', 'm-giant', 'm-mention', 'm-emoteonly', 'x-mystery',
      'x-gift3', 'x-upgrade', 'x-bitsbadge', 'notice: KickFan gifted 3 subs!', 'notice: KickFan gifted a sub to KickPlain!',
      'notice: KickHost is hosting with 12 viewers!', 'notice: KickPlain subscribed!']);
    assert.deepStrictEqual(hidden({ block_words: ['nice'] }), ['m-gif', 'm-mod']);
    assert.deepStrictEqual(hidden({ block_words: ['KAPPA how'] }), ['m-chat'], 'a phrase, in any letter case');
    // Counted after a reply's @name: "@Troll no u" is 4.
    assert.deepStrictEqual(hidden({ min_length: 12 }), ['kick:a1b2c3d4-0003', 'm-cmd', 'x-troll', 'x-reply-troll', 'x-reply-cmd', 'x-bitsbadge:m']);
    assert.deepStrictEqual(hidden({ links: 'hide' }), ['m-link']);
    assert.deepStrictEqual(hidden({ links: 'shorten' }), []);
    // command_prefixes needs hide_commands; a reply's @name is never a prefix ('@' hides "@home you rock", not "@SubFan thanks").
    assert.deepStrictEqual(hidden({ command_prefixes: '!@' }), []);
    assert.deepStrictEqual(hidden({ hide_commands: true, command_prefixes: '!@' }), ['m-mention', 'm-cmd', 'x-reply-cmd']);
    assert.deepStrictEqual(hidden({ hide_commands: true, command_prefixes: '?' }), []);
    w.S.cfg = w.cfg0;
  });
});

// links=shorten on the transcript: only the link line's text changes, on the Twitch path here (the Kick path in
// overlay.test.js), and back again.
test('(e) links=shorten rewrites only the links, as text', async () => {
  await inWorld((w) => {
    const from = Object.assign({}, w.cfg0, { max: 200 });
    const a = drive(w, [from]), b = drive(w, [from, Object.assign({}, from, { links: 'shorten' })]);
    const text = (l) => JSON.stringify(l);
    const changedLines = b.lines.filter((l, i) => text(l) !== text(a.lines[i]));
    assert.strictEqual(changedLines.length, 1);
    assert.match(changedLines[0].textContent, /check example\.com and www\.test\.org$/);
    assert.ok(!/<a\b|"tag":"A"/.test(text(b.lines)), 'no anchors');
    w.S.cfg = w.cfg0;
  });
});

test('(g) the line animations at the defaults', () => {
  assert.deepStrictEqual([R.IN_MS, R.FADE_OUT_MS, R.SLIDE_MS], [180, 1000, 250]);
  assert.strictEqual(R.animString(true, true, null, 'vertical'), 'tco-in 180ms ease-out');
  assert.strictEqual(R.animString(true, true, null, 'horizontal'), 'tco-in-x 180ms ease-out');
  assert.strictEqual(R.animString(true, false, null, 'vertical'), '');
  const t = R.fadeTiming(30, 0);
  assert.deepStrictEqual(t, { expired: false, delay: 29000, duration: 1000 });
  assert.strictEqual(R.animString(false, false, t), 'tco-fade 1000ms linear 29000ms forwards');
  assert.strictEqual(R.animString(true, true, t, 'vertical'), 'tco-in 180ms ease-out, tco-fade 1000ms linear 29000ms forwards');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'overlay.css'), 'utf8');
  ['tco-in', 'tco-in-x', 'tco-fade'].forEach((n) => assert.ok(css.indexOf('@keyframes ' + n + ' {') >= 0, n));
  // The animation options at their defaults (as a full config passes them) write the same strings.
  const d = R.normalizeCfg(config.defaults());
  assert.deepStrictEqual([d.enter_style, d.enter_ms, d.fade_out_ms, d.exit_style, R.exitFor(d)], ['slide', R.IN_MS, R.FADE_OUT_MS, 'fade', 'tco-fade']);
  assert.deepStrictEqual(R.fadeTiming(30, 0, d.fade_out_ms), t);
  assert.strictEqual(R.animString(true, true, t, 'vertical', d.enter_style, d.enter_ms, R.exitFor(d)),
    'tco-in 180ms ease-out, tco-fade 1000ms linear 29000ms forwards');
  assert.strictEqual(R.animString(true, true, null, 'horizontal', d.enter_style, d.enter_ms, R.exitFor(d)), 'tco-in-x 180ms ease-out');
  assert.strictEqual(R.animString(false, false, t, 'horizontal', null, null, R.exitFor(Object.assign({}, d, { layout: 'horizontal', align: 'top' }))),
    'tco-fade 1000ms linear 29000ms forwards');
});

test('(h) the renderer\'s defaults for a partial config are config.js\'s', () => {
  const names = Object.keys(R.NORM);
  assert.deepStrictEqual(Object.keys(R.NORM_DEFAULTS), names);
  names.forEach((k) => {
    const s = config.SPEC[k], n = R.NORM[k];
    assert.ok(own(config.SPEC, k), k + ' is a setting');
    assert.deepStrictEqual(R.NORM_DEFAULTS[k], s.def, k);
    assert.strictEqual([n.values, n.min, n.bool, n.str, n.hex].filter((x) => x !== undefined).length, 1, k + ': one kind');
    if (n.values) assert.deepStrictEqual(n.values, s.values, k);
    if (n.min !== undefined) assert.deepStrictEqual([n.min, n.max], [s.min, s.max], k);
    if (n.bool) assert.strictEqual(s.type, 'bool', k);
    if (n.hex) assert.strictEqual(s.type, 'color', k);
  });
  // Every key setConfig handles itself is made safe, so a partial or hand-made cfg reads as the default.
  R.ROOT_KEYS.forEach((k) => assert.ok(own(R.NORM, k), k));
  const empty = R.normalizeCfg({});
  names.forEach((k) => assert.deepStrictEqual(empty[k], R.NORM_DEFAULTS[k], k));
  const d = config.defaults();
  const full = R.normalizeCfg(d);
  config.KEYS.forEach((k) => assert.deepStrictEqual(full[k], d[k], k + ': the defaults pass through'));
  const bad = R.normalizeCfg({ size: 'huge', layout: 'diagonal', align: 'middle', shadow: 9, bg: -5, fade: 'soon', max: 0,
    animate: null, font: 5, extra: 'kept' });
  assert.deepStrictEqual([bad.size, bad.layout, bad.align, bad.shadow, bad.bg, bad.fade, bad.max, bad.animate, bad.font, bad.extra],
    ['medium', 'vertical', 'bottom', 3, 0, 0, 1, false, 'Inter', 'kept']);
  assert.strictEqual(R.normalizeCfg({ size: 'toString' }).size, 'medium', 'only the listed choices');
});

// ---------- css/overlay.css: today's values stay today's ----------

// Every rule (selector, nested under its @media/@keyframes as 'outer > inner') with its declarations.
function cssRules(css) {
  const out = [], stack = [];
  let buf = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}') {
      const sel = stack.pop();
      if (buf.trim()) {
        const decls = {};
        buf.split(';').forEach((d) => {
          const i = d.indexOf(':');
          if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
        });
        out.push({ sel: stack.concat(sel).join(' > '), decls: decls });
      }
      buf = '';
    } else buf += ch;
  }
  return out;
}

// [selector, property, its value in 1.5.2]. An option may turn a value into var(--x, <that value>), so OBS
// Custom CSS keeps working and the default draws the same; the value itself never changes.
const LITERALS = [
  ['#chat', 'padding', '0 8px'],
  ['#chat', 'font-size', '24px'],
  ['#chat', 'line-height', '1.35'],
  ['#chat', 'color', '#fff'],
  ['#chat', 'font-weight', '600'],
  ['#chat.size-small', 'font-size', '18px'],
  ['#chat.size-medium', 'font-size', '24px'],
  ['#chat.size-large', 'font-size', '32px'],
  ['.line', 'padding', '.15em 0'],
  ['.line', 'filter', 'var(--shadow, drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(1px 2px 2px rgba(0,0,0,.75)))'],
  ['.has-bg .line', 'margin', '.15em 0'],
  ['.has-bg .line', 'padding', '.2em .4em'],
  ['.has-bg .line', 'border-radius', '.4em'],
  ['.has-bg .line', 'width', 'fit-content'],
  ['.has-bg .line', 'background-color', 'rgba(0, 0, 0, var(--bg-alpha, 0))'],
  [':where(.has-bg) .line.highlight', 'background-color', 'rgba(0, 0, 0, var(--bg-alpha, 0))'],
  // Not in 1.5.2's rule, where `.line.highlight`'s .3em won: bg_shape sets both, and round keeps that .3em.
  [':where(.has-bg) .line.highlight', 'border-radius', '.3em'],
  ['.name', 'font-weight', '800'],
  ['.line.action .message', 'font-style', 'italic'],
  ['.line.first-msg', 'box-shadow', 'inset .2em 0 0 #9146FF'],
  ['.line.first-msg', 'padding-left', '.4em'],
  ['.line.highlight', 'background-color', 'rgba(145, 70, 255, .35)'],
  ['.line.highlight', 'border-radius', '.3em'],
  [':where(.has-bg) .line.highlight', 'background-image', 'linear-gradient(rgba(145, 70, 255, .35), rgba(145, 70, 255, .35))'],
  ['.line.announcement', 'padding-left', '.5em'],
  ['.line.announcement', 'background-size', '.25em 100%'],
  // Not in 1.5.2: the bar's corners in a box, which at round are `.has-bg .line`'s .4em.
  [':where(.has-bg) .line.announcement', 'border-top-left-radius', 'min(.4em, .4em)'],
  [':where(.has-bg) .line.announcement', 'border-bottom-left-radius', 'min(.4em, .4em)'],
  ['.line.notice', 'font-size', '.85em'],
  ['.line.notice .message', 'color', '#E2D6FF'],
  ['.reply', 'font-size', '.75em'],
  ['.reply', 'opacity', '.7'],
  ['.reply-name', 'font-weight', '800'],
  ['.badge', 'height', '1em'],
  ['.badge', 'margin-right', '.25em'],
  ['.badge.icon', 'width', '1em'],
  ['.emote-stack', '--eh', 'var(--emote-h, 1.75em)'],
  ['.emote-stack', 'margin', '-.3em .05em'],
  ['.emote-stack.big', '--eh', 'calc(var(--emote-h, 1.75em) * 3)'],
  ['.cheer-img', 'height', 'var(--emote-h, 1.75em)'],
  ['.cheer-amount', 'font-weight', '800'],
  ['.gif', 'height', 'calc(var(--emote-h, 1.75em) * 3)'],
  ['.gif', 'max-height', 'calc(var(--emote-h, 1.75em) * 3)'],
  ['.gif', 'margin', '.1em 0'],
  ['.layout-horizontal .emote-stack.big', '--eh', 'var(--emote-h, 1.75em)'],
  ['.layout-horizontal .gif', 'height', 'var(--emote-h, 1.75em)'],
  ['#chat.layout-horizontal .lines', 'gap', '0 1em'],
  ['#chat.layout-horizontal.has-bg .lines', 'gap', '0 .4em'],
  ['@keyframes tco-in > from', 'transform', 'translateY(.4em)'],
  ['@keyframes tco-in-x > from', 'transform', 'translateX(.6em)']
];

// v with every var(--x, fallback) whose --x isn't in keep replaced by its fallback (and the same inside that).
function withFallbacks(v, keep) {
  let out = '', i = 0;
  for (;;) {
    const at = v.indexOf('var(', i);
    if (at < 0) return out + v.slice(i);
    out += v.slice(i, at);
    let depth = 0, j = at + 3, comma = -1;
    for (; j < v.length; j++) {
      if (v[j] === '(') depth++;
      else if (v[j] === ')' && --depth === 0) break;
      else if (v[j] === ',' && depth === 1 && comma < 0) comma = j;
    }
    const name = v.slice(at + 4, comma < 0 ? j : comma).trim();
    out += keep.has(name) || comma < 0 ? v.slice(at, j + 1) : withFallbacks(v.slice(comma + 1, j).trim(), keep);
    i = j + 1;
  }
}

// v draws lit when the variables 1.5.2 didn't have are unset: lit itself, or lit with parts of it written as
// var(--x, <that part>) (rgba(var(--bg-rgb, 0, 0, 0), …) for rgba(0, 0, 0, …)).
function keepsLiteral(v, lit) {
  if (typeof v !== 'string') return false;
  const keep = new Set(Array.from(lit.matchAll(/var\((--[\w-]+)/g), (m) => m[1]));
  return withFallbacks(v, keep) === lit;
}

test('(i) overlay.css: the values the options stand in for are still 1.5.2\'s (or that value as a var() fallback)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'overlay.css'), 'utf8');
  const rules = cssRules(css);
  assert.ok(rules.length > 40, 'the scan finds the rules');
  assert.ok(keepsLiteral('var(--x, var(--y, 1em))', '1em') && !keepsLiteral('var(--x, 2em)', '1em') && !keepsLiteral(undefined, '1em'));
  assert.ok(keepsLiteral('rgba(var(--x, 0, 0, 0), var(--a, 0))', 'rgba(0, 0, 0, var(--a, 0))'));
  assert.ok(!keepsLiteral('rgba(var(--x, 0, 0, 0), var(--b, 0))', 'rgba(0, 0, 0, var(--a, 0))'), 'a 1.5.2 variable stays');
  assert.ok(keepsLiteral('var(--x, .15em) 0', '.15em 0') && !keepsLiteral('var(--x) 0', '.15em 0'));
  LITERALS.forEach(([sel, prop, lit]) => {
    const r = rules.filter((x) => x.sel === sel && own(x.decls, prop))[0];
    assert.ok(r, sel + ' { ' + prop + ' } is in overlay.css');
    assert.ok(keepsLiteral(r.decls[prop], lit), sel + ' { ' + prop + ': ' + r.decls[prop] + ' } should be ' + lit);
  });
  // A square badge slot that follows any height Custom CSS sets, and the highlight tint at (0,2,0).
  const badge = rules.filter((x) => x.sel === '.badge')[0].decls;
  assert.strictEqual(badge['aspect-ratio'], '1 / 1');
  assert.ok(!own(badge, 'max-width'));
  assert.match(css, /\n:where\(\.has-bg\) \.line\.highlight \{/);
});
