/*
  Optional settings for OBS "Local file" browser sources (which can't take ?query parameters).

  1. Copy this file to settings.js (in the same folder as overlay.html).
  2. Set your channel and any options below. Settings in the overlay URL still win over this file.
  3. In OBS, open the browser source's properties and press "Refresh cache of current page".

  The builder (index.html) can generate this file for you. All options are listed in README.md.
*/
window.TCO_SETTINGS = {
  channel: 'YOUR CHANNEL NAME', // your Twitch name, e.g. 'xqc'
  // size: 'medium',      // small | medium | large
  // font: 'Inter',       // any Google Font or system font name
  // shadow: 2,           // 0-3
  // layout: 'vertical',  // vertical | horizontal (one row, like a ticker)
  // fade: 0,             // seconds a message stays; the last second fades out (0 = never)
  // max: 50,             // maximum lines on screen
  // bots: false,         // show messages from known bots
  // hide_commands: false, // hide messages starting with "!"
};
