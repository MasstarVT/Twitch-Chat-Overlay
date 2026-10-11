/* Update check: an overlay left open for days (an OBS browser source) watches the site it came from for a new deploy,
   works out which of its own files the deploy changed, and has the overlay swap in just those, with the chat left alone:
   a new stylesheet or badge image in place, new scripts by restarting the overlay in place. A deploy that changes none
   of them (the builder, the home page, the README) changes nothing here. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).updateCheck = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // How often the site is asked for version.json (a few bytes) to see whether it has a new deploy.
  var CHECK_MS = 300000;
  // GitHub Pages lets its CDN and browsers keep a file for 10 minutes, and its CDN ignores a ?query, so a file fetched
  // just after a deploy can still be the old one. A deploy is compared again once it is this old, and only then counted
  // as seen; new scripts wait for it too, so they can't come half old, half new.
  var SETTLE_MS = 660000;
  // A page never reloads itself sooner than this after it loaded: an overlay.html that comes back stale can't loop.
  var RELOAD_FLOOR_MS = 600000;
  // The first look (what this page runs, and which deploy the site serves) comes this long after start.
  var START_MS = 5000;
  var TIMEOUT_MS = 15000;
  var ABSENT = 'absent';
  var ERRORS_RE = /\/js\/errors\.js$/;

  // The version a version.json names ({"version": "1.10.0"}), or '' for anything else: a missing file, an error page.
  function versionOf(res) {
    return res && typeof res.version === 'string' && /^[0-9]+(?:\.[0-9]+){0,3}$/.test(res.version) ? res.version : '';
  }

  // A short fingerprint of a file's text (cyrb53), enough to tell two versions of it apart.
  function hashText(s) {
    s = String(s);
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length.toString(36);
  }

  function stripComments(html) { return String(html).replace(/<!--[\s\S]*?-->/g, ''); }

  // overlay.html with what a running page can take in place left out: its comments, its script tags (compared file by
  // file) and the ?v= cache busters. Anything else that differs (the CSP, the page's elements, a stylesheet added) only
  // a reload can bring in.
  function shapeOf(html) {
    return stripComments(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\?v=[^"'\s>]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sameOrigin(href, base) {
    try { return new URL(href).origin === new URL(base).origin; } catch (e) { return false; }
  }

  // The script and stylesheet files a page names, in order: absolute URLs on the page's own site.
  function filesIn(html, base) {
    var out = { scripts: [], styles: [] };
    html = stripComments(html);
    function add(list, src) {
      try {
        var href = new URL(src.replace(/&amp;/g, '&'), base).href;
        if (sameOrigin(href, base)) list.push(href);
      } catch (e) { /* not a URL */ }
    }
    var m;
    var scriptRe = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi;
    while ((m = scriptRe.exec(html))) add(out.scripts, m[1]);
    var linkRe = /<link\b[^>]*>/gi;
    while ((m = linkRe.exec(html))) {
      if (!/\brel\s*=\s*"[^"]*\bstylesheet\b/i.test(m[0])) continue;
      var href = /\bhref\s*=\s*"([^"]+)"/i.exec(m[0]);
      if (href) add(out.styles, href[1]);
    }
    return out;
  }

  // A file's path on its site, the key it is compared under whatever ?v= or ?u= it was loaded with.
  function pathOf(href) {
    try { return new URL(href).pathname; } catch (e) { return ''; }
  }

  function withParam(href, key, value) {
    var u = new URL(href);
    u.searchParams.set(key, value);
    return u.href;
  }

  // GET a file as text. cache: the fetch cache mode. Resolves { ok, status, text, header(name) }; rejects when the site
  // can't be reached.
  function fetchText(url, cache) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { method: 'GET', cache: cache, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return (res.ok ? res.text() : Promise.resolve('')).then(function (text) {
          return { ok: res.ok, status: res.status, text: text, header: function (n) { return res.headers.get(n) || ''; } };
        });
      })
      .finally(function () { clearTimeout(timer); });
  }

  // opts: {
  //   version: the version this page runs, url: the site's version.json, page: this page's address,
  //   running(): { scripts, styles }, the same-site files this page has loaded (absolute URLs),
  //   assets: the page's own images it can redraw, as paths beside the page ('img/logos/Badge.svg'),
  //   apply(change): swaps in a change, resolving true once it took. change is { reload: true } (the page itself
  //     changed), or { styles: [{ path, url }], assets: [{ path, url }] }, url being where the new copy is, with, when
  //     scripts changed, restart: true, scripts: [the addresses of the page's scripts to run, in order] and baseline:
  //     this check's state for the restarted overlay's check to go on from,
  //   baseline: such a state (this page is a restart in place), fetchText(url, cache) -> Promise,
  //   every: ms between checks, now(): the time (both for tests)
  // }
  function createUpdateCheck(opts) {
    opts = opts || {};
    var every = typeof opts.every === 'number' && opts.every > 0 ? opts.every : CHECK_MS;
    var get = typeof opts.fetchText === 'function' ? opts.fetchText : fetchText;
    var now = typeof opts.now === 'function' ? opts.now : Date.now;
    var assets = Array.isArray(opts.assets) ? opts.assets.slice() : [];
    var startedAt = now();
    var timer = null;
    var running = false;
    // What this page runs: { shape, scripts: [paths in order], files: Map(path -> fingerprint) }. Taken at the first
    // look, from the browser's cache (the copies this page loaded), and updated by every change applied.
    var base = null;
    // The deploy (version.json's Last-Modified) compared once it was SETTLE_MS old: nothing more to look at until the
    // next one. version: the version a deploy that changed no script named, so it isn't compared again.
    var settled = null;
    var siteVersion = opts.version;
    var looked = false;
    var given = opts.baseline;
    if (given && given.base && given.base.files instanceof Map && Array.isArray(given.base.scripts) &&
      typeof given.base.shape === 'string') {
      base = given.base;
      settled = typeof given.settled === 'string' ? given.settled : null;
      if (typeof given.version === 'string' && given.version) siteVersion = given.version;
      looked = true;
    }

    function log() {
      var u = root.TCO && root.TCO.util;
      if (u && u.log) u.log.apply(null, arguments);
    }

    function fingerprint(url, cache) {
      return Promise.resolve(get(url, cache)).then(function (r) {
        if (!r) throw new Error('no answer for ' + url);
        return r.ok ? hashText(r.text) : ABSENT;
      });
    }

    function takeBase() {
      var now0 = typeof opts.running === 'function' ? opts.running() : null;
      if (!now0) return Promise.reject(new Error('nothing running'));
      var scripts = (now0.scripts || []).filter(function (u) { return sameOrigin(u, opts.page); });
      var styles = (now0.styles || []).filter(function (u) { return sameOrigin(u, opts.page); });
      var files = new Map();
      var all = scripts.concat(styles).map(function (u) { return { path: pathOf(u), url: u }; })
        .concat(assets.map(function (a) { var u = new URL(a, opts.page).href; return { path: pathOf(u), url: u }; }));
      return Promise.resolve(get(opts.page, 'force-cache')).then(function (page) {
        if (!page || !page.ok) throw new Error('this page could not be read');
        return Promise.all(all.map(function (f) {
          return fingerprint(f.url, 'force-cache').then(function (h) { files.set(f.path, h); });
        })).then(function () {
          base = { shape: shapeOf(page.text), scripts: scripts.map(pathOf), files: files };
        });
      });
    }

    // Compares the site's files with the ones this page runs. Resolves { reload, scripts, styles, assets, load, base }, or
    // null when the site couldn't be read in full (nothing is decided on half an answer). load: the scripts to run for a
    // restart; base: what this page runs once all of it is in.
    function compare() {
      var token = now().toString(36);
      var pageUrl = new URL(opts.page);
      pageUrl.search = '';
      pageUrl.hash = '';
      return Promise.resolve(get(withParam(pageUrl.href, 'u', token), 'no-store')).then(function (page) {
        if (!page || !page.ok) return null;
        var named = filesIn(page.text, opts.page);
        var out = { reload: shapeOf(page.text) !== base.shape, scripts: false, styles: [], assets: [], load: [],
          base: { shape: shapeOf(page.text), scripts: named.scripts.map(pathOf), files: new Map() } };
        if (out.base.scripts.join('\n') !== base.scripts.join('\n')) out.scripts = true;
        // Each file is fetched past the browser's cache ('reload'), and kept in it for the page to load from. name: what
        // the overlay knows the file by (a stylesheet's path, an image's path beside the page).
        function look(url, list, name) {
          var fresh = withParam(url, 'u', token);
          var path = pathOf(url);
          return fingerprint(fresh, 'reload').then(function (h) {
            out.base.files.set(path, h);
            // errors.js only matters while the page loads: it is never run again.
            var script = !list && !ERRORS_RE.test(path);
            if (script && h !== ABSENT) out.load.push({ path: path, url: fresh });
            if (h === base.files.get(path)) return;
            if (script) out.scripts = true;
            else if (!list) return;
            else if (h === ABSENT) out.reload = true; // a stylesheet or image the page uses is gone
            else list.push({ path: name, url: fresh });
          });
        }
        var jobs = named.scripts.map(function (u) { return look(u, null, ''); })
          .concat(named.styles.map(function (u) { return look(u, out.styles, pathOf(u)); }))
          .concat(assets.map(function (a) { return look(new URL(a, opts.page).href, out.assets, a); }));
        return Promise.all(jobs).then(function () {
          // In page order (the lookups answer in any order).
          var order = out.base.scripts;
          out.load = out.load.sort(function (a, b) { return order.indexOf(a.path) - order.indexOf(b.path); })
            .map(function (f) { return f.url; });
          return out;
        });
      });
    }

    function deployAge(r) {
      var lm = Date.parse(r.header('last-modified'));
      var date = Date.parse(r.header('date'));
      return isFinite(lm) && isFinite(date) ? Math.max(0, date - lm) : null;
    }

    // Resolves true when it applied a change (or asked for a reload). A check that can't tell (offline, no such file, a
    // bad answer) does nothing: the next one is just as good.
    function check() {
      return new Promise(function (resolve) { resolve(base ? null : takeBase()); })
        .then(function () { return get(opts.url, 'no-store'); })
        .then(function (r) {
          if (!r || !r.ok) return false;
          var site;
          try { site = versionOf(JSON.parse(r.text)); } catch (e) { site = ''; }
          if (!site) return false;
          var stamp = r.header('last-modified');
          var age = deployAge(r);
          var old = age === null || age >= SETTLE_MS;
          var first = !looked;
          looked = true;
          if (site === siteVersion && (!stamp || stamp === settled)) return false;
          // The deploy this page most likely loaded from: long out, and naming this page's version.
          if (first && site === siteVersion && old) { settled = stamp; return false; }
          return compare().then(function (diff) { return diff ? applyDiff(diff, site, old, stamp) : false; });
        })
        .catch(function (err) {
          log('update check failed:', err && err.message);
          return false;
        });
    }

    // Swaps in what changed. A young deploy (not old) has its stylesheets and images swapped at once, and is looked at
    // again once it is old, when its scripts go in too: by a restart in place, or for a new page, a reload (never in the
    // page's first minutes).
    function applyDiff(diff, site, old, stamp) {
      var restart = diff.scripts && !diff.reload && old;
      if (diff.reload && old && now() - startedAt >= RELOAD_FLOOR_MS) {
        log('update: the site has a new page: reloading');
        opts.apply({ reload: true });
        return Promise.resolve(true);
      }
      var change = { styles: diff.styles, assets: diff.assets };
      if (restart) {
        change.restart = true;
        change.scripts = diff.load;
        change.baseline = { base: diff.base, settled: stamp, version: site };
      }
      var whole = !diff.scripts && !diff.reload; // nothing left over for later
      if (!change.styles.length && !change.assets.length && !restart) {
        if (whole) {
          siteVersion = site;
          if (old) settled = stamp;
        }
        return Promise.resolve(false);
      }
      return Promise.resolve(opts.apply(change)).then(function (ok) {
        if (!ok) return false;
        diff.styles.concat(diff.assets).forEach(function (f) {
          var path = pathOf(f.url);
          base.files.set(path, diff.base.files.get(path));
        });
        log('update: swapped in', diff.styles.concat(diff.assets).map(function (f) { return f.path; })
          .concat(restart ? ['new scripts'] : []).join(', '));
        if (restart) base = diff.base;
        if (restart || whole) {
          siteVersion = site;
          if (old) settled = stamp;
        }
        return true;
      });
    }

    // One check at a time: the next is timed from the end of the last, so a slow answer never piles checks up.
    function schedule(ms) {
      timer = setTimeout(function () {
        timer = null;
        check().then(function () { if (running) schedule(every); });
      }, ms);
    }

    function start() {
      if (running || !opts.version || !opts.url || !opts.page || typeof opts.apply !== 'function') return;
      running = true;
      schedule(START_MS);
    }

    function stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
    }

    return { start: start, stop: stop, check: check };
  }

  return {
    CHECK_MS: CHECK_MS,
    SETTLE_MS: SETTLE_MS,
    RELOAD_FLOOR_MS: RELOAD_FLOOR_MS,
    START_MS: START_MS,
    versionOf: versionOf,
    hashText: hashText,
    shapeOf: shapeOf,
    filesIn: filesIn,
    createUpdateCheck: createUpdateCheck
  };
});
