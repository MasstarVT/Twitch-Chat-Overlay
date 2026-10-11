/* Update check: an overlay left open for days (an OBS browser source) asks the site it came from which version it serves
   now, and reloads itself when that isn't the one it runs. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).updateCheck = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  // GitHub Pages lets a cache hold a file for 10 minutes, so a reload just after a release can still be handed the old
  // overlay.html. The first check waits that long after the page loaded, and so does each one after it: a reload that
  // lands on the old version then waits the cache out (one more reload at most) instead of looping.
  var CHECK_MS = 600000;

  // The version a version.json names ({"version": "1.10.0"}), or '' for anything else: a missing file, an error page.
  function versionOf(res) {
    return res && typeof res.version === 'string' && /^[0-9]+(?:\.[0-9]+){0,3}$/.test(res.version) ? res.version : '';
  }

  // opts: { version (the one this page runs), url (the site's version.json), reload(), fetchJson(url, opts) -> Promise,
  //         every (ms between checks) }
  function createUpdateCheck(opts) {
    opts = opts || {};
    var every = typeof opts.every === 'number' && opts.every > 0 ? opts.every : CHECK_MS;
    var fetchJson = typeof opts.fetchJson === 'function' ? opts.fetchJson : util.fetchJson;
    var timer = null;
    var running = false;

    // Resolves true when it asked for a reload. A check that can't tell (offline, no such file, a bad answer) does
    // nothing: the next one is just as good.
    function check() {
      // 'no-store': the browser's own cache must not answer for the site, or a release would wait out its max-age too.
      return new Promise(function (resolve) { resolve(fetchJson(opts.url, { cache: 'no-store', timeout: 15000 })); })
        .then(function (res) {
          var site = versionOf(res);
          if (!site || site === opts.version) return false;
          util.log('update: this page runs', opts.version, 'and the site serves', site, ': reloading');
          opts.reload();
          return true;
        })
        .catch(function (err) {
          util.log('update check failed:', err && err.message);
          return false;
        });
    }

    // One check at a time: the next is timed from the end of the last, so a slow answer never piles checks up.
    function schedule() {
      timer = setTimeout(function () {
        timer = null;
        check().then(function () { if (running) schedule(); });
      }, every);
    }

    function start() {
      if (running || !opts.version || !opts.url || typeof opts.reload !== 'function') return;
      running = true;
      schedule();
    }

    function stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
    }

    return { start: start, stop: stop, check: check };
  }

  return {
    CHECK_MS: CHECK_MS,
    versionOf: versionOf,
    createUpdateCheck: createUpdateCheck
  };
});
