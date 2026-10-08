# Twitch Chat Overlay

A chat overlay for Twitch and Kick streams, built as an OBS Browser Source. It shows your channel's chat with **7TV, BTTV and FFZ emotes**, **7TV name paints**, and **every badge**: Twitch, 7TV, FFZ, FFZ:AP, BTTV, Chatterino and Chatterino Homies. Multistreaming? Add your **Kick** channel and both chats show in one overlay, each line marked with a small Twitch or Kick icon.

It is plain HTML and JavaScript. There is no build step, no login and no server of your own. Host it on GitHub Pages or run it straight from a folder on your PC.

## Features

- **Twitch chat** without logging in, using Twitch's anonymous read-only chat connection. It reconnects automatically.
- **Kick chat** without logging in, next to Twitch or on its own:
  - Kick's own emotes and badges (broadcaster, mod, VIP, OG, founder, verified, staff, sub and sub gifter), with the channel's own sub badge images when Kick shares them.
  - The Kick channel's 7TV emotes, or the Twitch channel's 7TV emotes when Kick's can't be looked up.
  - Kick subs, gifted subs and hosts; deleted messages, bans and chat clears disappear from the overlay.
  - With both channels set, each line starts with a small Twitch or Kick icon (`platform_icons`).
- **Emotes:**
  - Twitch, 7TV, BTTV and FFZ, both global and channel emotes.
  - Zero-width emotes stack on the emote before them (7TV, BTTV, FFZ).
  - FFZ and BTTV emote modifiers: flip, wide, rotate and cursed.
  - 7TV channel emote changes show up live without a refresh.
  - 7TV personal emotes appear only in their owner's messages.
  - BTTV emote changes and BTTV Pro personal emotes also update live.
  - Cheermotes and Twitch chat GIFs.
- **Badges:**
  - Twitch global and channel badges: sub tiers and months, bits, mod, VIP, founder, predictions and event badges.
  - FFZ custom mod and VIP badges.
  - Third-party badges from 7TV, FFZ, FFZ:AP, BTTV (staff and Pro), Chatterino and Chatterino Homies.
- **7TV name paints:** gradient and animated image usernames.
- **Chat events:**
  - Sub, resub, gift, raid and announcement notices, each kind with a switch of its own. Gift bombs collapse into one line.
  - Replies, `/me` messages, first-time chatter and channel-point highlights.
  - Timeouts, bans and deleted messages disappear from the overlay.
  - During Shared Chat, every message shows its channel's avatar (your own channel's too, as on Twitch), and partner messages show their badges from that channel.
- **Vertical or horizontal:** a classic chat column, or a single row that runs sideways like a ticker, for a bar along the top or bottom of the stream.
- **Clean look by default:** white text with a soft drop shadow on a transparent background. You can change the layout, size, font, shadow, background, alignment, fade-out and line limit.
- **Config builder** (`builder.html`) with a live preview, a demo mode, quick looks to start from, and copy or download buttons.

## Quick start

The overlay is hosted at **https://chat.masstar.org/**. Open the builder at **https://chat.masstar.org/builder.html**, enter your channel, and copy the overlay URL into OBS (steps 3–5 below). To host your own copy instead, use Option A or B.

For Kick, open the builder's **Kick** section, enter your Kick channel and press **Check**. Check fills in the Kick chatroom id, which the overlay needs to join Kick's chat. If Kick refuses the lookup, the builder shows a link to your channel's page on Kick's API: open it, then paste the whole page (or just the number after `"chatroom":{"id":`) into **Kick chatroom id**. You only do this once; the id travels in the overlay URL.

### Option A: GitHub Pages (recommended)

1. Fork the repo and delete the `CNAME` file from your fork (it points at chat.masstar.org). Then go to **Settings → Pages**, choose **Deploy from a branch**, and pick `main` / `(root)`.
2. Open `https://<your-user>.github.io/Twitch-Chat-Overlay/builder.html`. That page is the builder. To pre-fill it, add options to its URL, for example `?channel=yourname`.
3. Enter your channel at the top, adjust the settings, and press **Copy URL** in the bar along the bottom. The builder's **Add to OBS** section walks through the next two steps.
4. In OBS: **Sources → + → Browser**. Paste the URL, then set **Width** and **Height** to the same size as the builder preview (450 × 700 for the vertical layout, 1920 × 100 for the horizontal one).
5. In the same dialog, **uncheck** "Shutdown source when not visible" and "Refresh browser when scene becomes active". Leaving them on makes the chat reconnect and clear on every scene switch.

### Option B: a folder on your PC

1. Download the repo (Code → Download ZIP) and unzip it.
2. Open `builder.html` in your browser and configure the overlay. Under **Add to OBS**, the **Local file with settings.js** route has the **Download settings.js** button. Save the file next to `overlay.html`. You can also copy `settings.example.js` to `settings.js` and edit it by hand.
3. In OBS, add a **Browser** source, tick **Local file**, and pick `overlay.html`.
4. After you change `settings.js`, open the source's properties and press **Refresh cache of current page**.

Alternatively, leave **Local file** unticked and paste a `file:///…/overlay.html?channel=…` URL. Query parameters work in that mode.

## Options

Put options in the overlay URL (for example `overlay.html?channel=xqc&size=large&fade=30`) or in `settings.js`. URL options override `settings.js`.

- **Booleans** accept `1/true/yes/on` and `0/false/no/off`.
- **Out-of-range numbers** are clamped to the nearest limit: `max=0` becomes 1, `bg=150` becomes 100. `line_width` is `0` (no limit) or at least 5, so 1 to 4 become 5, and `text_px` is `0` (use `size`) or at least 8, so 1 to 7 become 8.
- **Other invalid values** fall back to the default.
- **Option names** are not case-sensitive, in the URL or in settings.js (`Size=large` works).
- **Colors** are hex codes, 6 digits or 3 (`ff8800` or `f80`), and the `#` is optional. Leave it out in a URL (`text_color=ff8800`): there a `#` starts the page's anchor, and everything after it is lost. An empty value (`text_color=`) means the built-in color.
- **Builder output** includes only the options you changed. The exception is a `file:///…/overlay.html?…` URL: it lists every setting, so a settings.js in that folder can't override any of them. Such a URL also keeps today's defaults if a later release changes one.

| Option | Default | Values | What it does |
|---|---|---|---|
| `channel` | none | Twitch login | The Twitch channel to show. `@name` and full twitch.tv URLs (including popout, embed and `/subs/` links) are accepted. `#name` works in settings.js and the builder; in a URL write it as `%23name` or leave the `#` out. A `channel`, a `kick` channel, or both, is required. |
| `kick` | none | Kick channel name | A Kick channel whose chat is shown too (or alone). `@name` and kick.com links (including popout chat) are accepted. |
| `kick_room` | none | number | The Kick channel's chatroom id. The builder's **Check** fills it in. Without it the overlay asks kick.com itself, which Kick may refuse (see notes). |
| `platform_icons` | `1` | bool | With both a Twitch and a Kick channel, start each line with a small Twitch or Kick icon. It shows even with `badges=0`. |
| `size` | `medium` | `small`, `medium`, `large` | Text size: 18, 24 or 32 px. `text_px` replaces it while set. |
| `text_px` | `0` | `0`, `8`–`96` | Text size in px, in place of `size`. Badges and emotes follow it, and their images are loaded for that size (a GIF drawn taller than 200 px loads Giphy's original file; see `gifs`). `0` uses `size`, and 1 to 7 become 8. Above about 40 px a horizontal row no longer fits a 100 px tall source. It sets `#chat`'s `font-size` (only while set). |
| `font` | `Inter` | font name | Any Google Font, a stock Windows font (Arial, Segoe UI, Verdana, Calibri, …) or a CSS generic name (`sans-serif`, `monospace`, `system-ui`, …). Windows fonts and generic names are used as installed and never fetched. Any other name is loaded from Google Fonts, with each word capitalized to match Google's spelling (`roboto slab` becomes `Roboto Slab`). |
| `text_weight` | `semibold` | `light`, `regular`, `semibold`, `bold`, `heavy`, `black` | Weight of the message text: 300, 400, 600, 700, 800 or 900. Names inside sub and raid notices follow it too. A Google Font is requested in weights 400 to 800; `light` and `black` add 300 or 900 to that request. A font without the weight draws the nearest one it has. |
| `text_color` | none | hex color | Color of the message text (white when unset). Names, `/me` messages and notices keep their own colors. |
| `line_height` | `135` | `100`–`200` | Line height in percent of the text size. Below about 115 emotes reach into the lines next to them. In the horizontal layout it also sets the row's height. |
| `text_case` | `none` | `none`, `upper`, `lower`, `smallcaps` | Show names, messages and reply headers in upper case, lower case or small caps. Only the look changes: emotes, filters and the built-in badges see the text as typed. |
| `shadow` | `2` | `0`–`3` | Drop-shadow strength behind text and emotes. |
| `shadow_color` | none | hex color | Color of the shadow (black when unset). It is drawn around the whole message, so emotes, badges and the `bg` box get it too, except with `shadow_style=text`. Needs `shadow` above 0. |
| `shadow_style` | `filter` | `filter`, `text` | `text` draws the shadow on the letters only (as `text-shadow`), which takes about half the drawing work while animated emotes are on screen. Emotes, badges, GIFs, the box and painted names then have no shadow. Needs `shadow` above 0. |
| `outline` | `0` | `0`–`3` | A sharp outline around the letters: thin, medium or thick (`0` = none). It is eight copies of the text, without a filter. Emotes and painted names get none. |
| `outline_color` | none | hex color | Color of the outline (black when unset). Needs `outline` above 0. |
| `names` | `1` | bool | Show the name and its separator (`name_sep`) before each message. Reply headers and sub or raid notices keep their names. |
| `name_weight` | `heavy` | as `text_weight` | Weight of the names before messages and in reply headers. A name inside a sub or raid notice follows `text_weight`. `light` and `black` add a weight to the font request, as with `text_weight`. |
| `name_line` | `0` | bool | Start each message on a line of its own under the name. Vertical layout, with `names=1`. |
| `name_font` | none | font name | A font for the names before messages and in reply headers, given like `font` (a Google Font is one more request, made only while this is set). Empty uses `font`. A name inside a sub or raid notice is part of the notice's text and keeps `font`. |
| `name_color` | none | hex color | One color for every name, in place of each chatter's own (Twitch and Kick). 7TV paints still show while `paints=1` (through the clear parts of an image paint this color shows), and `/me` messages take it too. `readable` leaves it as picked. |
| `name_fallback` | none | hex color | The color for chatters who never picked one (Twitch or Kick), in place of Twitch's 15 default colors. `readable` leaves it as picked. Not used while `name_color` is set. |
| `name_sep` | `colon` | `colon`, `space`, `dash`, `arrow` | What goes between the name and the message: `Name: hi`, `Name hi`, `Name – hi` or `Name › hi`. A `/me` message keeps its space, and a reply header its colon. Needs `names=1`; not drawn with `name_line=1` in the vertical layout. |
| `bg` | `0` | `0`–`100` | Opacity of a box behind each message (black, or `bg_color`). |
| `bg_color` | none | hex color | Color of the box behind each message (black when unset). Needs `bg` above 0. |
| `accent_bar` | `0` | bool | A bar in the chatter's name color on the left of each chat message. A first-time chatter's bar (`first_msg`) takes its place; announcements keep their own bar, and notices get none. |
| `bg_shape` | `round` | `square`, `soft`, `round`, `pill` | Corners of the box. `pill` gives a one-line box round ends (an announcement keeps its bar side less round). Needs `bg` above 0. |
| `bg_width` | `fit` | `fit`, `full` | `full` makes every box as wide as the column. Vertical layout, with `bg` above 0. |
| `spacing` | `normal` | `tight`, `normal`, `loose`, `extra` | Space between messages: above and below each one in the vertical layout, the gap between them in the horizontal layout. |
| `layout` | `vertical` | `vertical`, `horizontal` | `vertical`: messages stack in a column. `horizontal`: messages sit side by side in one row, new ones come in on the right and older ones slide off to the left. In a row, a message longer than the source (or than `line_width`) is cut off with an ellipsis, and GIFs and gigantified emotes are drawn at emote height (so `gif_size`, `emote_only` and `giant_emotes` change nothing there). |
| `align` | `bottom` | `bottom`, `top` | `bottom`: newest message at the bottom. `top`: newest message at the top. With `layout=horizontal` the newest message is always on the right, and `align` picks the edge the row lines up on. |
| `text_align` | `left` | `left`, `center`, `right` | Where messages sit in the column: the text, and the `bg` box with it. The `accent_bar`, `first_msg` and announcement bars stay on the left edge. Vertical layout only. |
| `line_width` | `0` | `0`, `5`–`100` | The widest a message can be, in em (the text size; 30 is about 55 letters). A longer one wraps onto more lines, or in the horizontal layout ends in an ellipsis. `0` means no limit, and 1 to 4 become 5. |
| `pad_x` | `8` | `0`–`200` | Space in px between the messages and the left and right edges of the source. At `0`, shadows and emotes at the edges are cut off. |
| `edge_fade` | `0` | `0`–`10` | Fade old messages out over this many em as they reach the edge they leave by: the top (the bottom with `align=top`), or the left end of a row. It covers at most half the source, so the newest message stays clear (unless that one message fills more than half a vertical source); in a row the newest message starts after the fade, so a long one is cut that much shorter. `0` is off. It masks the whole overlay, which takes some extra drawing work while animated emotes are on screen. |
| `row_sep` | `none` | `none`, `dot`, `bar`, `diamond` | A mark in the text color between messages in a row (drawn at the start of each message, inside its box with `bg`). Horizontal layout only. |
| `animate` | `1` | bool | Animate new messages as they come in (`enter_style`); in the horizontal layout the row also glides left to make room. `0` shows them at once. The fade-out (`fade`) works either way. |
| `enter_style` | `slide` | `slide`, `fade`, `pop`, `drop` | How a new message comes in: `slide` rises from below (in the horizontal layout, in from the right), `fade` fades in, `pop` grows from smaller (from where its text starts, or a row message's middle) and `drop` comes down from above. In the horizontal layout the row glides left to make room with every style. Needs `animate=1`. |
| `enter_ms` | `180` | `50`–`1000` | How long the entrance takes, in milliseconds. While `fade` is set, a fade-out that would begin before the entrance ends waits for it, then takes the time left, so the message is still gone `fade` seconds after it came in. (With all four animation options at their defaults, `fade=1` still fades a message from the moment it comes in, as before.) Needs `animate=1`. |
| `fade` | `0` | `0`–`3600` | Seconds a message stays on screen; it fades out over the last `fade_out_ms` (one second unless changed). `0` means never. |
| `fade_out_ms` | `1000` | `0`–`10000` | How long the fade-out at the end of `fade` takes, in milliseconds, and never longer than the message stays: the message is gone `fade` seconds after it came in either way. `0` removes it without a fade. Needs `fade` above 0. |
| `exit_style` | `fade` | `fade`, `slide` | `slide` moves a message out as it fades, toward the edge old messages leave by: up, down with `align=top`, or left in the horizontal layout. It works with `animate=0` too. Needs `fade` and `fade_out_ms` above 0. |
| `smooth_scroll` | `0` | bool | The older messages glide up (down with `align=top`) over a quarter second to make room for a new one instead of jumping, as the horizontal row glides left. In a busy chat they keep moving. A message removed from the middle (deleted by a moderator, say) still closes its gap at once. Vertical layout only; needs `animate=1`. |
| `max` | `50` | `1`–`200` | Maximum number of messages on screen. A sub or resub notice and the viewer's own message under it count as one and leave together. |
| `bots` | `0` | bool | Show messages from known bots (Nightbot, StreamElements, …, plus the channel's BTTV bot list). During Shared Chat, the partner channel's BTTV bot list applies to its lines too. |
| `hide_commands` | `0` | bool | Hide messages that start with one of `command_prefixes` (`!` by default), including replies whose text after the `@name` starts with one. |
| `command_prefixes` | `!` | up to 8 of `! $ % & * + - . / : ; = ? @ # ~ ^`, written together | The signs a command starts with, for `hide_commands`: `!?` hides both `!points` and `?points`. Spaces are left out, and a sign given twice counts once. With `@`, a message that starts by naming someone is hidden too (a reply still shows). In a URL write `#` as `%23`, `&` as `%26`, `+` as `%2B` and `%` as `%25` (the builder does): there a bare `+` is a space and is lost, and a `#` or `&` ends the value. Needs `hide_commands=1`. |
| `block` | none | comma-separated logins | Users whose messages are hidden. A reply to a blocked user still shows, without its header (with `reply_style=name` too), and like any reply without the `@name` at the start of its text. |
| `block_words` | none | comma-separated words or phrases | Hide chat messages that contain any of these, matched like `keywords` (any letter case, whole words: `gg` doesn't hide `eggs`). A reply to a hidden message still shows, without the header that quotes it (with `reply_style=name` it keeps its header, which quotes nothing). Notices aren't checked, but a resub's own message under its notice is. Up to 50, each up to 40 characters; a long list is better kept in settings.js than in the URL. |
| `allow_users` | none | comma-separated logins | While set, only these users' chat messages show (Twitch and Kick alike, by name). Sub, raid and other notices still show. Every other filter still applies: a listed user who is blocked, a bot, or below `role_filter` stays hidden. |
| `role_filter` | `all` | `all`, `subs`, `vips`, `mods` | Show chat messages only from subscribers and up (`subs`: subscribers and founders, VIPs, moderators and the broadcaster), from VIPs and up (`vips`), or from moderators (`mods`). It reads the badges Twitch or Kick sends (a Shared Chat line from another channel goes by its badges there), so it works with `badges=0`. The broadcaster always shows, and notices follow the event switches. |
| `min_length` | `0` | `0`–`100` | Hide chat messages shorter than this many characters (`0` is off). They are counted as shown: a reply's `@name` isn't counted, an emoji is one character (with a skin tone, or as a flag, too) and an emote counts as its name (`LUL` is 3), so `4` hides `gg`, `o7` and `LUL`. Invisible characters at the start or end, such as the mark Chatterino and 7TV add to a repeated message, aren't counted. A resub's own message under its notice is hidden too; the notice stays. |
| `links` | `show` | `show`, `shorten`, `hide` | `shorten` shows each link in a chat message (and in a reply's header) as its site's host name, such as `clips.twitch.tv`; `hide` hides chat messages with a link, and a reply quoting one shows without the header that quotes it. A link starts with `https://`, `http://` or `www.`; a bare `example.com`, or another scheme such as `steam://`, is left as it is. Links are never clickable. While it isn't `show`, a demo message has a link. |
| `events` | `1` | bool | Show sub, resub, gift, raid and bits-badge notices, and announcements. A resub's own chat message is shown either way. While it is on, the `event_*` switches pick which kinds show. |
| `event_subs` | `1` | bool | Sub and resub notices, gift sub upgrades included (Twitch and Kick). Off hides the notice only: the viewer's own message still shows. Needs `events=1`. |
| `event_gifts` | `1` | bool | Gift sub notices, single gifts and gift bombs (Twitch and Kick). Needs `events=1`. |
| `event_raids` | `1` | bool | Raid notices, and Kick hosts. Needs `events=1`. |
| `event_bits_badge` | `1` | bool | Bits badge notices ("… just earned a new 1K Bits badge!"); the viewer's own message still shows. Cheers always show. Needs `events=1`. |
| `event_announcements` | `1` | bool | `/announce` messages, hidden whole when off, as with `events=0`. Needs `events=1`. |
| `notice_color` | none | hex color | Color of the text of sub, gift, raid and bits-badge notices (light purple, `E2D6FF`, when unset). Announcements are chat messages and use `text_color`. |
| `notice_size` | `85` | `50`–`150` | Size of notice text, in percent of the chat text. Above 100 a notice can be cut off in a short horizontal source. |
| `replies` | `1` | bool | Show a "↪ @user: message" header on replies. The header is left out when the quoted message was deleted by a mod, or its author was timed out or banned. |
| `reply_style` | `full` | `full`, `name` | `name` shows only "↪ @user" in a reply's header, without the message it answers. Needs `replies=1`. |
| `first_msg` | `0` | bool | Highlight first-time chatters. |
| `first_msg_color` | none | hex color | Color of the bar beside a first-time chatter's message (purple, `9146FF`, when unset). Kick has no first-message flag. |
| `history` | `5` | `0`–`100` | Load up to this many recent lines on start (from recent-messages.robotty.de). `0` turns it off. Timeouts, deletions, sub and raid notices, deleted messages and hidden bots count toward the limit, so fewer chat messages may appear. |
| `shared` | `1` | bool | Show messages from other channels during a Shared Chat session. |
| `timestamps` | `off` | `off`, `12h`, `24h` | Show when each message was sent, by the streaming PC's clock, before its badges (on a notice, before its text): `12h` as 3:07 (no AM or PM), `24h` as 15:07. Lines from `history` show when they were sent. In the horizontal layout each message gets that much wider. |
| `mentions` | `off` | `off`, `at`, `name` | Tint chat messages that mention the channel: `at` looks for `@name`, `name` for the name on its own too (but not after `/` or `.`, so not in a twitch.tv link). Only a Latin letter, a digit or `_` makes it part of a longer name, so `@nameさん` and `@name님` count. The names are the `channel` login and the `kick` channel (where `_` and `-` count as the same); a reply to the channel counts too, and the channel's own messages never do. Without a channel nothing is tinted. While it is on, the demo's first message mentions the channel. Which tint wins on a line: see `role_style`. |
| `mention_color` | none | hex color | Color of the mention tint (red, `E91916`, at 35% when unset). Needs `mentions`. |
| `keywords` | none | comma-separated words or phrases | Tint chat messages that contain any of these, in any letter case and as whole words (`gg` doesn't match `eggs`; in Chinese, Japanese, Korean, Thai and other text without spaces between words, a keyword matches inside it, and `gg` matches `ggです`); a phrase may have spaces. Invisible characters, such as a zero-width space inside a word or the mark added to a repeated message, are ignored, so a word still matches as it is shown. Up to 50, each up to 40 characters (a longer one is left out). |
| `highlight_users` | none | comma-separated logins | Tint these users' chat messages with the `keywords` tint. A name counts on Twitch and Kick alike. |
| `keyword_color` | none | hex color | Color of the `keywords` and `highlight_users` tint (amber, `FFB31A`, at 35% when unset). |
| `points_highlight` | `1` | bool | Tint messages highlighted with channel points. `0` shows them like any other message. |
| `points_color` | none | hex color | Color of the channel-points tint (purple, `9146FF`, at 35% when unset). Needs `points_highlight=1`. |
| `role_style` | `off` | `off`, `bar`, `tint` | Mark the broadcaster's, moderators' and VIPs' chat messages with a bar on the left (`bar`) or a tint (`tint`), in a color per role. It reads their badges as Twitch or Kick sends them, so it works with `badges=0` (a Shared Chat line from another channel goes by the badges there); subscribers aren't marked. A line gets one tint at most: channel points, then a mention, then a keyword or highlight user, then the role's. A first-time chatter's bar wins over the role bar, which wins over `accent_bar`'s. Announcements get no tint and no role bar. |
| `broadcaster_color` | none | hex color | The broadcaster's color for `role_style` (red, `E91916`, when unset). |
| `mod_color` | none | hex color | The moderators' color for `role_style` (green, `00AD03`, when unset). |
| `vip_color` | none | hex color | The VIPs' color for `role_style` (pink, `E005B9`, when unset). |
| `gifs` | `1` | bool | Show Twitch chat GIFs. They load as Giphy's 200 px animated WebP instead of the full-size original. A GIF drawn more than 200 px tall (a `3x` GIF past about `text_px=38`, or with a large `emote_scale`) loads the original as animated WebP instead, since Giphy has no taller fixed-size file: sharper, but a bigger download, and an original that is small itself can still look soft. |
| `gif_size` | `3x` | `1x`, `2x`, `3x` | Height of a GIF in emote heights. At `1x` it also takes an emote's margins, so its line is no taller than a line with emotes. Vertical layout only: a row draws GIFs at emote height. |
| `emotes_7tv`, `emotes_bttv`, `emotes_ffz` | `1` | bool | Turn each emote provider on or off. Kick chat uses 7TV only (BTTV and FFZ don't exist on Kick). |
| `emote_scale` | `100` | `50`–`200` | Size of emotes, cheermotes and GIFs in percent of the usual (`1.75em`). Images are loaded for the size drawn, up to the largest file each service has (about 112–128 px), so past that very large emotes look soft. A GIF drawn taller than 200 px loads Giphy's original file (see `gifs`). Above about 110 emotes reach out of the `bg` box into the lines next to them. |
| `emote_only` | `normal` | `normal`, `big`, `huge` | A message of emotes alone (spaces and invisible characters between them are fine) draws them twice (`big`) or three times (`huge`) as tall. Gigantified emotes keep their own size, and a very wide emote is fitted to the column. Vertical layout only. |
| `giant_emotes` | `1` | bool | Draw emotes from Twitch's Gigantify an Emote power-up three times as tall. `0` draws them like any other emote, from a smaller image. Vertical layout only: a row draws them at emote height either way. |
| `badges` | `1` | bool | Master switch for all badges. |
| `badges_twitch`, `badges_kick`, `badges_7tv`, `badges_bttv`, `badges_ffz`, `badges_ffzap`, `badges_chatterino`, `badges_homies` | `1` | bool | Turn each badge provider on or off. `badges_ffz` also covers the channel's FFZ custom mod and VIP badges, which show even with `badges_twitch=0`. |
| `badge_size` | `100` | `50`–`200` | Size of badges in percent of the text, loaded at a matching resolution. The Twitch and Kick icons and the Shared Chat avatars follow it too, even with `badges=0`. Above about 135 lines with badges get taller. |
| `homies_lists` | `all` | `all`, `light` | `light` loads only the two small Homies lists and skips the chatterinohomies.com list (about 0.5 MB to download, 4 MB to read and 1–2 MB of memory for the whole stream). About 9,400 users who are only in that list lose their Homies badge. Needs `badges` and `badges_homies`. |
| `paints` | `1` | bool | Show 7TV name paints. |
| `paint_images` | `animated` | `animated`, `static` | `static` draws animated image paints with their still first frame, so painted names stop redrawing many times a second while chat is quiet. Gradient paints are unchanged. Needs `paints`. |
| `stv_lookup` | `1` | bool | Look up 7TV paints and badges for chatters who don't run a 7TV client (see notes). |
| `readable` | `1` | bool | Lighten dark name colors so they stay readable on stream. |
| `readable_level` | `45` | `30`–`70` | How light `readable` makes a dark name: the contrast with black it aims for, times 10 (`45` is 4.5:1, `70` is 7:1; a number under `30`, such as `4.5`, is read as the ratio itself). It lightens in steps, so nearby values often give the same color. `name_color` and `name_fallback` are left as picked. Needs `readable=1`; not used while `name_color` is set. |
| `demo` | `0` | bool | Show looping sample messages instead of live chat. The builder preview uses this. |
| `debug` | `0` | bool | Show a status line with each provider's load state, and log to the console. |

## Custom CSS

OBS's **Custom CSS** box can restyle the overlay. These class names are stable:

| Selector | Element |
|---|---|
| `#chat` | the whole overlay |
| `#chat.layout-vertical` | the overlay in the vertical layout |
| `#chat.layout-horizontal` | the overlay in the horizontal layout |
| `#chat.align-bottom`, `#chat.align-top` | newest message at the bottom or at the top (`align`); in the horizontal layout, the edge the row runs along |
| `#chat.has-bg` | the overlay with a box behind each message (`bg` above 0) |
| `#chat.bg-full` | boxes as wide as the column (`bg_width=full`) |
| `#chat.no-names` | names hidden (`names=0`) |
| `#chat.name-line` | each message on a line of its own under the name (`name_line=1`; the vertical layout, with names shown) |
| `#chat.case-upper`, `#chat.case-lower`, `#chat.case-smallcaps` | the letter case of names, messages and reply headers (`text_case`) |
| `#chat.has-outline` | text with an outline (`outline` above 0) |
| `#chat.shadow-text` | the shadow drawn on the letters only (`shadow_style=text`) |
| `#chat.paint-static` | 7TV image paints drawn still (`paint_images=static`) |
| `#chat.text-center`, `#chat.text-right` | messages centered or on the right (`text_align`; the stylesheet applies them to the vertical layout only) |
| `#chat.has-maxw` | a cap on the width of a message (`line_width` above 0) |
| `#chat.edge-fade` | old messages fading out toward the edge they leave by (`edge_fade` above 0) |
| `#chat.sep-dot`, `#chat.sep-bar`, `#chat.sep-diamond` | a mark between messages (`row_sep`; the horizontal layout only) |
| `#chat.has-name-font` | names in a font of their own (`name_font` set); the font is the `--name-font` variable |
| `.lines` | the box that holds the messages |
| `.line` | one message |
| `.line.notice` | a sub, raid or other notice |
| `.line.platform-kick` | a message from Kick (Twitch lines have no platform class) |
| `.line.action` | a `/me` message |
| `.line.first-msg` | a first-time chatter's message (with `first_msg=1`) |
| `.line.accent` | a message with a bar in the chatter's name color (`accent_bar=1`); the color is the line's `--line-accent` variable |
| `.line.highlight` | a message highlighted with channel points (with `points_highlight=1`) |
| `.line.mention` | a message that mentions the channel (`mentions`) |
| `.line.keyword`, `.line.user-hl` | a message with one of the `keywords`, or from one of the `highlight_users` |
| `.line.role-broadcaster`, `.line.role-mod`, `.line.role-vip` | a message from the broadcaster, a moderator or a VIP, while `role_style` is `bar` or `tint`; the role's color is the line's `--role-rgb` variable (`r, g, b`) |
| `.line.role-bar`, `.line.role-tint` | the role's bar (`role_style=bar`), or its tint (`role_style=tint`, on a line no other tint took) |
| `.line.announcement` | an `/announce` message (its bar color is one of `.ann-primary`, `.ann-blue`, `.ann-green`, `.ann-orange` or `.ann-purple`) |
| `.line.mirrored` | a message from another channel during Shared Chat |
| `.line.emote-only` | a message of emotes alone, drawn bigger (`emote_only=big` or `huge`; the vertical layout only) |
| `.reply` | reply header |
| `.time` | when the message was sent (`timestamps=12h` or `24h`), before its badges |
| `.badges`, `.badge` | badge container and badge images |
| `.badge.platform` | the Twitch or Kick icon at the start of a line |
| `.badge.icon` | a built-in badge drawn as SVG (the platform icons and Kick's role badges) |
| `.badge.colored` | an FFZ or FFZ:AP badge drawn on its own background color |
| `.badge.avatar` | the channel's avatar on a Shared Chat message |
| `.name` | username |
| `.colon` | the `: ` between the name and the message, or what `name_sep` puts there (a space after a `/me` name) |
| `.message` | message text |
| `.emote-stack` | one emote, with any zero-width emotes stacked on it |
| `.emote` | emote images |
| `.emote.zw` | a zero-width emote drawn over the emote before it |
| `.cheer` | a cheermote and its amount |
| `.gif` | a Twitch chat GIF |

For example, `.line { text-transform: uppercase; }`, `.badge { display: none; }` (hides every badge, the platform icons too; `badges=0` keeps the platform icons), or `.layout-horizontal .line { max-width: 30em; }` to cut long messages shorter in the horizontal layout only (`line_width=30` does it in both layouts).

A `/me` message is italic and in the name's color. `.line.action .message { font-style: normal; color: inherit !important; }` shows it like any other message (the color is set on the message itself, so it needs `!important`).

Emote height is the `--emote-h` variable (default `1.75em`), so `#chat { --emote-h: 2em; }` makes emotes bigger, and badge height is `--badge-h` (default `1em`). `emote_scale` and `badge_size` set the same variables, and they also load the images for the size drawn: emotes or badges enlarged with Custom CSS alone are fetched at their usual size and may look slightly softer. While `emote_scale` or `badge_size` is changed, it wins over Custom CSS that sets the variable on `#chat`.

These options set a variable on `#chat`, and only while they are changed, so Custom CSS can set the same variable instead (`#chat { --text-color: #ffe08a; }`). An option you changed wins over Custom CSS.

| Variable | Option | Default |
|---|---|---|
| `--text-weight` | `text_weight` | `600` |
| `--name-weight` | `name_weight` | `800` |
| `--text-color` | `text_color` | `#fff` |
| `--line-height` | `line_height` | `1.35` |
| `--bg-rgb` | `bg_color`, written `r, g, b` | `0, 0, 0` |
| `--bg-radius` | `bg_shape` | `.4em` (`.3em` on a highlighted message; an announcement's bar side is never rounder than `.4em`) |
| `--line-gap` | `spacing`, vertical layout | `.15em` |
| `--row-gap` | `spacing`, horizontal layout | `1em` (`.4em` with `bg`) |
| `--notice-color` | `notice_color` | `#E2D6FF` |
| `--notice-size` | `notice_size` | `.85em` |
| `--first-color` | `first_msg_color` | `#9146FF` |
| `--pad-x` | `pad_x` | `8px` |
| `--emote-h` | `emote_scale` | `1.75em` |
| `--badge-h` | `badge_size` | `1em` |
| `--gif-mul` | `gif_size` | `3` (GIF height in emote heights; the horizontal layout keeps GIFs at emote height) |
| `--mention-rgb` | `mention_color`, written `r, g, b` | `233, 25, 22` |
| `--kw-rgb` | `keyword_color`, written `r, g, b` | `255, 179, 26` |
| `--hl-rgb` | `points_color`, written `r, g, b` | `145, 70, 255` |
| `--role-broadcaster-rgb`, `--role-mod-rgb`, `--role-vip-rgb` | `broadcaster_color`, `mod_color`, `vip_color`, written `r, g, b` | `233, 25, 22`, `0, 173, 3`, `224, 5, 185` |

The tints (`.highlight`, `.mention`, `.keyword`, `.user-hl`, `.role-tint`) are their color at 35%. With `bg` above 0 they are drawn as a `background-image` over the box, so Custom CSS that recolors one sets `background-image` too (or sets the variable above instead).

`line_width` sets the cap as `--line-max` (in em) and, for notices, whose em is their own smaller text, as `--line-max-n`; `edge_fade` sets the length of the fade as `--edge-fade`; `name_font` sets the names' font as `--name-font`. Each works only with its class (`#chat.has-maxw`, `#chat.edge-fade`, `#chat.has-name-font`), which the option sets.

`emote_only` sets how many times as tall an emote-only line draws its emotes as `--eo` (`2` or `3`), which works only on `.line.emote-only`. `gif_size=1x` also sets a GIF's margins as `--gif-margin` (an emote's `-.3em .05em`; `.1em 0` otherwise). `text_px` sets `font-size` on `#chat` itself, so while it is set it wins over Custom CSS such as `#chat { font-size: 28px; }`.

`outline` and `shadow_style=text` draw their layers from the `--tshadow` variable (on `.line` and `.reply`), and set how far those layers reach past the letters as `--tshadow-room`: a horizontal line without a box gets that much padding at its sides, and a reply header lets them draw that far past its edges. Both are set only while those options are on.

The animations are the keyframes `tco-in` and `tco-in-x` (`enter_style=slide` in a column and in a row), `tco-in-fade`, `tco-in-pop` and `tco-in-pop-x`, and `tco-in-drop` for the entrances, and `tco-fade` (`exit_style=fade`), `tco-out-slide`, `tco-out-slide-down` and `tco-out-slide-x` (`exit_style=slide` up, down and left) for the fade-out. Custom CSS can redefine one, such as `@keyframes tco-in-drop { from { opacity: 0; transform: translateY(-1em); } }`; the options keep picking which one runs and for how long. The row's glide, and a column's with `smooth_scroll`, is a `transform` transition set on `.lines` itself.

## Services this overlay contacts

Everything is fetched directly by your browser or OBS. There is no server of our own, no telemetry and no login.

| Service | Used for |
|---|---|
| Twitch chat (`irc-ws.chat.twitch.tv`) | chat messages (anonymous, read-only) |
| Kick chat (`ws-us2.pusher.com`) | Kick chat messages and events (anonymous, read-only), only with `kick` set |
| Kick (`kick.com`) | the Kick channel's chatroom id, sub badge images and user id (for its 7TV set); the builder's Check uses it too |
| Kick CDN (`files.kick.com`) | Kick emote and sub badge images |
| IVR API (`api.ivr.fi`) | Twitch badge lists, channel id lookup and the Shared Chat avatar |
| Twitch GQL (`gql.twitch.tv`) | fallback for Twitch badges when IVR is down |
| 7TV (`7tv.io`, `events.7tv.io`, `cdn.7tv.app`) | 7TV emotes, paints and badges, and live updates; the Kick channel's 7TV emotes |
| BTTV (`api.betterttv.net`, `sockets.betterttv.net`, `cdn.betterttv.net`) | BTTV emotes and badges, and live updates |
| FrankerFaceZ (`api.frankerfacez.com`, `cdn.frankerfacez.com`) | FFZ emotes and badges |
| FFZ:AP (`api.ffzap.com`) | FFZ:AP supporter badges and their images |
| Chatterino (`api.chatterino.com`; images on `fourtf.com`) | Chatterino badges |
| Chatterino Homies (`itzalex.github.io`, `chatterinohomies.com`, `cdn.chatterinohomies.com`) | Homies badges (`chatterinohomies.com` only with `homies_lists=all`) |
| recent-messages (`recent-messages.robotty.de`) | recent chat history, unless `history=0` |
| Twitch CDN (`static-cdn.jtvnw.net`), cheer CDN (`d3aqoihi2n8ty8.cloudfront.net`), Giphy (`media*.giphy.com`) | Twitch emote, badge, avatar, cheermote and GIF images |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | the chosen font, unless it is a system font |

Badge and emote lists name their own image URLs, so a provider can move its images to another host. The builder and the home page load their own fonts (Figtree, Bricolage Grotesque and JetBrains Mono) from Google Fonts. The builder also uses the IVR API to check the channel name. The home page's two live demos are the overlay itself in demo mode, so they contact the same emote and badge services (no chat connection).

## Security: chat can't run code

Anyone can type in a Twitch chat, and emote names, badges and 7TV paints come from other people too. None of it can run code on your stream PC or change the overlay beyond the message it's in.

- **Text stays text.** Messages, names, reply headers, emote names and badge titles are only ever inserted as plain text. Nothing is parsed as HTML, so `<script>`, `<img onerror=…>` and similar just show up as typed. The same goes for Kick chat.
- **Only https images.** Emote, badge, GIF and paint images must be `https://` URLs (the overlay's own two badge files in `img/logos/` are the only exception). GIFs are limited to Giphy, 7TV paint images to 7TV's CDN, and Twitch badges and the Shared Chat avatar to Twitch's CDN. A Kick emote URL is built from the emote's numeric id only, and Kick sub badge images must be on `files.kick.com`. The platform icons and Kick's role badges are built-in SVG shapes: chat can only pick one by name from a fixed list.
- **Validated styling.** Name and badge colors must be hex colors, and so must the color options, which are checked again before they reach the page's style. 7TV paints are rebuilt from checked numbers and colors, with limited layers and shadows (up to 8 layers and 10 shadows, and the whole shadow chain shares a 32 px reach on each axis and for blur), so a paint can't escape its own rule or draw far outside the name.
- **Zalgo text** (piles of combining marks) is cut to 4 marks per letter, even with invisible characters between them, so it can reach at most about one text row into the message above instead of covering the chat. Normal accents and emoji are unaffected.
- **Size limits.** Message text is cut at 1000 characters (a Kick message at 2000 before its emote codes are read, and a Kick frame over 64 KB is dropped), a message draws at most 300 emote images, and one emote stacks at most 4 zero-width layers. Real Twitch messages (500 characters) never reach these; only crafted history lines can. BTTV's rotate modifiers draw the emote in a square box, so a rotated wide emote stays within its own line.
- **Content-Security-Policy.** As a second layer, `overlay.html`, the builder and the home page only run their own script files: no inline scripts, no `eval`, nothing from other sites. Only `overlay.html` allows inline styles, because OBS applies a source's Custom CSS that way.
- **Sandboxed preview.** When the builder is served over http(s), its live-chat preview runs in a sandboxed frame (`allow-scripts` only) with no access to the builder page. Opened from disk (`file://`), the preview runs unsandboxed, because a sandboxed frame can't load local files; Chrome still gives each local page its own origin.

`tests/security.test.js` feeds hostile messages, emotes, badges and paints through the real code to keep it this way.

## Notes and limitations

- **Kick chatroom id:** Kick's chat socket needs the channel's numeric chatroom id, and the only place to get it is `kick.com/api/v2/channels/<name>`. That API sits behind Cloudflare and may refuse requests from other websites, so the builder puts the id in the overlay URL (`kick_room`) once, and the overlay never depends on the lookup. If Kick refuses the builder's Check, open the link it shows (a normal page visit, which Kick usually lets through) and paste the page into **Kick chatroom id**.
- **Kick's chat key:** the overlay joins Kick's chat with the same public Pusher key kick.com's own website uses. Kick has changed that key before; if it does again, the overlay shows "Kick refused the chat connection" until the key in `js/kick.js` is updated.
- **Kick limits:** Kick chat has no recent-message history, and Kick chatters get no 7TV paints or 7TV/BTTV/FFZ badges (those are looked up by Twitch account). The block list, `allow_users` and the bot filter apply to both platforms by name.
- **DankChat badges are not supported.** DankChat's badge server doesn't allow browser requests (no CORS header), so a static page can't load them.
- **`stv_lookup`:** 7TV's own clients only learn another user's paint and badge when that user runs a 7TV client. This overlay also asks 7TV's API for each chatter's active paint and badge, so viewers on mobile get their paint too. That API doesn't check whether the cosmetic is still owned, so a lapsed 7TV subscriber may keep showing a paint. Lookups are batched, at most one request every 5 s, so in a busy chat a new chatter's paint or badge may appear a few seconds after their first line (a lone chatter is looked up about 0.3 s after their first message). Set `stv_lookup=0` to use 7TV-client events only.
- **Third-party services:** Twitch's official badge API needs a login. This overlay uses the community IVR API instead, falling back to Twitch's public GQL endpoint. If both are down, Twitch badges are hidden rather than shown as broken images.
- **Custom cheermotes:** channel-specific cheermotes can't be loaded without a login, so they show as plain text. Twitch's global cheermotes (Cheer, DoodleCheer, Kappa and others) show as images with a colored amount.
- **Badges off:** during Shared Chat, every message still shows its channel's avatar so you can tell the channels apart.
- **Homies badges:** when a user is in more than one Homies list, their badges show in list order (itzalex badges, badges2, chatterinohomies), whichever list loads first. With `homies_lists=light` the chatterinohomies list isn't loaded.
- **Still paints:** `paint_images=static` takes an animated paint's still frame from 7TV's own list of its images. A paint that arrives in 7TV's older format (one image URL: when 7TV's paint list can't be loaded, or for a paint newer than the list) doesn't say whether it is animated, so it stays as it is.
- **Right-to-left chat:** the name is kept apart from the message, and a message takes its direction from its first letter, so Arabic and Hebrew chat reads correctly.
- **Busy chat:** new lines are drawn in batches, at most every 100 ms. Nothing changes below about 10 messages a second.
- **Builder:** each setting shows its option name, and the name reads `option=value` once the setting is off its default; those are the options the overlay URL carries. A link can open a section: `builder.html#obs`, `#look`, `#platforms` (Kick), `#messages`, `#events`, `#filters`, `#emotes`, `#badges` or `#advanced`. The headings in Advanced have links of their own: `#adv-trouble` (Troubleshooting), `#adv-text`, `#adv-names`, `#adv-box`, `#adv-layout`, `#adv-animation`, `#adv-events` (Chat events), `#adv-highlights`, `#adv-filters`, `#adv-emotes` and `#adv-lighter` (Lighter on PC).
- **Builder quick looks:** Look starts with five one-click looks: Default, Boxed (a dark box, no shadow), Outlined (an outline in place of the shadow), Cards (full-width boxes with a name-color bar and the name on its own line) and Big & bold. Each sets the text size, weight, color and line spacing, the name weight, shadow, outline, box, name-color bar and space between messages, whether the name has a line of its own, and emote and badge size; what a look doesn't name goes back to its default. It changes the overlay URL like any other setting, so tweak it from there. Your channels, font, name colors, layout and position stay. **Undo** puts back the look you had before the first click, until you change something else. Big & bold makes emotes a quarter bigger, so they can reach into the line above (see `emote_scale`), and it can be cut off in a 1920 × 100 horizontal source.
- **Builder preview:** a live-chat preview disconnects after about a minute in a hidden tab and reconnects when you come back. Opening `builder.html?channel=name` keeps your remembered settings; a link with more settings loads exactly that setup. The builder used to be the home page, so an older link to the home page that carries settings (`/?channel=name`) is passed on to the builder.
- **Older OBS versions:** OBS 28–30 use an older Chromium (103). The overlay is written to work there too.

## Development

```bash
npm test
```

This runs the unit tests with Node's built-in test runner (Node 22+; no dependencies). To preview locally, serve the folder with any static server, for example `python -m http.server 8080`, and open `http://localhost:8080/` (the home page) or `http://localhost:8080/builder.html` (the builder).

Layout:

- `index.html`, `css/home.css`, `js/home.js`: the home page. `js/home.js` starts its live demos and passes old builder links on.
- `builder.html`, `js/builder.js`, `css/builder.css`: the builder.
- `img/logos/`: the provider logos shown on the home page and in the builder, with their sources and licenses.
- `overlay.html`, `css/overlay.css`: the overlay page.
- `js/overlay.js`: startup and wiring. `js/errors.js` records script errors (e.g. a broken settings.js) for the startup hint.
- `js/irc*.js`: Twitch chat.
- `js/kick.js`: Kick chat (channel lookup, the Pusher socket, Kick events to overlay messages).
- `js/icons.js`: built-in SVG badges (the Twitch and Kick icons, Kick's role badges).
- `js/seventv.js`, `js/bttv.js`, `js/ffz.js`, `js/twitch-badges.js`, `js/extra-badges.js`: emote and badge providers.
- `js/tokenizer.js`: turns messages into emote and text tokens.
- `js/renderer.js`: builds the DOM.
- `js/paint-css.js`: 7TV paints.
- `js/config.js`: every option and its default.
- `js/util.js`: shared helpers (fetch with timeout and retry, the reconnecting socket, LRU cache, colors).
- `js/badge-resolve.js`: Twitch badge version lookup and sub-tier fallback.
- `js/rooms.js`: Shared Chat source channels.
- `js/demo.js`: demo mode (sample messages for the builder preview).
