/*
  Optional settings for OBS "Local file" browser sources (which can't take ?query parameters).

  1. Copy this file to settings.js (in the same folder as overlay.html).
  2. Set your channel and any options below. Settings in the overlay URL still win over this file.
  3. In OBS, open the browser source's properties and press "Refresh cache of current page".

  The builder (builder.html) can generate this file for you. All options are listed in README.md.
*/
window.TCO_SETTINGS = {
  channel: 'YOUR CHANNEL NAME', // your Twitch name, e.g. 'xqc' ('' for a Kick-only overlay)
  // kick: '',            // your Kick channel name: Twitch and Kick chat in one overlay
  // kick_room: '',       // its Kick chatroom id (the builder's Kick > Check finds it)
  // size: 'medium',      // small | medium | large
  // font: 'Inter',       // any Google Font or system font name
  // text_color: '',      // hex color such as 'ffe08a', '#' optional ('' = the built-in white)
  // shadow: 2,           // 0-3
  // layout: 'vertical',  // vertical | horizontal (one row, like a ticker)
  // fade: 0,             // seconds a message stays (0 = never); it fades out over the last fade_out_ms (1000 ms)
  // max: 50,             // maximum lines on screen
  // bots: false,         // show messages from known bots
  // hide_commands: false, // hide messages starting with a command prefix ("!" unless command_prefixes says otherwise)
  // box_image: '',       // a picture stretched around each message, 'img/box.png' or an https:// link (README: Picture frames)
  // name_image: '',      // a picture behind each name and its badges, stretched the same way
  // avatar: 'off',       // off | blob | bot | cat | custom: a talking avatar says each message (README: Avatar mode)
  // avatar_idle: '',     // with avatar: 'custom', your picture: 'img/me.png' beside overlay.html, or an https:// link
  // avatar_talk: '',     // the same picture with its mouth open, shown as it talks
};
