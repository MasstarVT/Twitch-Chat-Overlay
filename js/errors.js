/* Runs first (the first deferred script, before settings.js): records script errors (e.g. a typo in settings.js)
   so the overlay can explain them. On file:// pages Chromium hides the filename ("Script error."). Until util.js
   has run (window.TCO), settings.js is the only other script that has run, so an error without a filename raised
   then is attributed to it. A separate file rather than inline code, so the page's Content-Security-Policy can
   refuse every inline script. The overlay reads the list once, at boot (before DOMContentLoaded), so recording
   stops there and the list is capped: a long stream never grows it. */
(function () {
  'use strict';
  var MAX = 20;
  window.__tcoErrors = [];
  function record(e) {
    if (window.__tcoErrors.length >= MAX) return;
    window.__tcoErrors.push({
      file: e.filename || (!window.TCO || document.readyState === 'loading' ? 'settings.js' : ''),
      msg: e.message || ''
    });
  }
  window.addEventListener('error', record);
  document.addEventListener('DOMContentLoaded', function () { window.removeEventListener('error', record); });
})();
