/* Home page: passes old builder links on to builder.html, and runs the live demo frames. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.start();
  (root.TCO = root.TCO || {}).home = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var BUILDER = 'builder.html';
  // The overlay itself, in demo mode: sample messages through the real parser and renderer.
  var DEMOS = [
    { box: 'demo-column', name: 'column demo', src: 'overlay.html?demo=1', title: 'Live demo: the overlay showing sample chat', lazy: false },
    { box: 'demo-row', name: 'ticker demo', src: 'overlay.html?demo=1&layout=horizontal', title: 'Live demo: the overlay as a one-row ticker', lazy: true }
  ];

  // This page used to be the builder. A link that carries an overlay setting (?channel=name, ?size=large, ...)
  // was made for the builder. Any other query (a campaign tag, say) belongs to this page.
  function isBuilderLink(search, spec) {
    if (!search || !spec) return false;
    var hit = false;
    try {
      new URLSearchParams(search).forEach(function (value, key) {
        if (Object.prototype.hasOwnProperty.call(spec, String(key).toLowerCase())) hit = true;
      });
    } catch (e) { return false; }
    return hit;
  }

  // Same rule as the builder's preview: sandboxed (scripts only, an origin of its own), except from disk,
  // where a sandboxed frame can't load overlay.html's files.
  function frameSandbox(protocol) { return protocol === 'file:' ? null : 'allow-scripts'; }

  // Like the builder's preview URL: every setting is named (its default, unless the demo sets it) and the
  // channel is empty, so a settings.js next to overlay.html can't change a demo.
  function demoSrc(src, config) {
    if (!config || !config.parse || !config.KEYS) return src;
    var q = src.indexOf('?');
    var cfg = config.parse(q < 0 ? '' : src.slice(q));
    var p = new URLSearchParams();
    config.KEYS.forEach(function (k) {
      var v = cfg[k];
      p.set(k, k === 'channel' ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : Array.isArray(v) ? v.join(',') : String(v));
    });
    return (q < 0 ? src : src.slice(0, q)) + '?' + p.toString();
  }

  // calm: the visitor asked for reduced motion, so new messages appear without sliding in.
  function addDemo(doc, protocol, d, config, calm) {
    var box = doc.getElementById(d.box);
    if (!box) return null;
    var src = demoSrc(d.src + (calm ? '&animate=0' : ''), config);
    var f = doc.createElement('iframe');
    f.className = 'demo';
    f.title = d.title;
    // Nothing in the overlay takes focus. Left in the Tab order, the frame is a stop with no focus ring.
    f.setAttribute('tabindex', '-1');
    var sb = frameSandbox(protocol);
    if (sb) f.setAttribute('sandbox', sb);
    if (d.lazy) f.setAttribute('loading', 'lazy');
    f.src = src;
    box.insertBefore(f, box.firstChild);
    return f;
  }

  // A demo updates for as long as the page is open, so each has a button that stops it (the frame is taken
  // out, which unloads the overlay) and starts it again. With reduced motion it waits to be started.
  function addToggle(doc, protocol, d, config, calm) {
    var btn = doc.getElementById(d.box + '-toggle');
    var f = btn && calm ? null : addDemo(doc, protocol, d, config, calm);
    if (!btn) return f;
    function label() { btn.textContent = (f ? 'Pause ' : 'Play ') + d.name; }
    btn.addEventListener('click', function () {
      if (f) {
        if (f.parentNode) f.parentNode.removeChild(f);
        f = null;
      } else {
        f = addDemo(doc, protocol, d, config, calm);
      }
      label();
    });
    label();
    btn.hidden = false;
    return f;
  }

  function start() {
    var loc = root.location, doc = root.document;
    if (!loc || !doc) return;
    var config = root.TCO && root.TCO.config;
    if (isBuilderLink(loc.search, config && config.SPEC)) {
      loc.replace(BUILDER + loc.search + loc.hash);
      return;
    }
    function run() {
      var calm = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      DEMOS.forEach(function (d) { addToggle(doc, loc.protocol, d, config, calm); });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return {
    BUILDER: BUILDER, DEMOS: DEMOS, isBuilderLink: isBuilderLink, frameSandbox: frameSandbox, demoSrc: demoSrc,
    addDemo: addDemo, addToggle: addToggle, start: start
  };
});
