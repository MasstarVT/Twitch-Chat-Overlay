/* Loads first, before settings.js and not deferred: records script errors (e.g. a typo in settings.js) so the
   overlay can explain them. On file:// pages Chromium hides the filename ("Script error."). While the page is
   still being parsed, settings.js is the only script that can run (every other one is deferred), so an error
   without a filename raised then is attributed to it. A separate file rather than inline code, so the page's
   Content-Security-Policy can refuse every inline script. */
(function () {
  'use strict';
  window.__tcoErrors = [];
  window.addEventListener('error', function (e) {
    window.__tcoErrors.push({
      file: e.filename || (document.readyState === 'loading' ? 'settings.js' : ''),
      msg: e.message || ''
    });
  });
})();
