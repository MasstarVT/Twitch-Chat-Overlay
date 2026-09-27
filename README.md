# Twitch Chat Overlay

A chat overlay for Twitch streams, built as an OBS Browser Source. It shows your channel's chat with **7TV, BTTV and FFZ emotes**, **7TV name paints**, and **every badge**: Twitch, 7TV, FFZ, FFZ:AP, BTTV, Chatterino and Chatterino Homies.

It is plain HTML and JavaScript. There is no build step, no login and no server of your own. Host it on GitHub Pages or run it straight from a folder on your PC.

## Features

- **Twitch chat** without logging in, using Twitch's anonymous read-only chat connection. It reconnects automatically.
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
  - Sub, resub, gift, raid and announcement notices. Gift bombs collapse into one line.
  - Replies, `/me` messages, first-time chatter and channel-point highlights.
  - Timeouts, bans and deleted messages disappear from the overlay.
  - Shared Chat messages show the source channel's avatar and badges.
- **Vertical or horizontal:** a classic chat column, or a single row that runs sideways like a ticker, for a bar along the top or bottom of the stream.
- **Clean look by default:** white text with a soft drop shadow on a transparent background. You can change the layout, size, font, shadow, background, alignment, fade-out and line limit.
- **Config builder** (`builder.html`) with a live preview, a demo mode, and copy or download buttons.

## Quick start

The overlay is hosted at **https://chat.masstar.org/**. Open the builder at **https://chat.masstar.org/builder.html**, enter your channel, and copy the overlay URL into OBS (steps 3–5 below). To host your own copy instead, use Option A or B.

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
- **Out-of-range numbers** are clamped to the nearest limit: `max=0` becomes 1, `bg=150` becomes 100.
- **Other invalid values** fall back to the default.
- **Option names** are not case-sensitive, in the URL or in settings.js (`Size=large` works).
- **Builder output** includes only the options you changed. The exception is a `file:///…/overlay.html?…` URL: it lists every setting, so a settings.js in that folder can't override any of them. Such a URL also keeps today's defaults if a later release changes one.

| Option | Default | Values | What it does |
|---|---|---|---|
| `channel` | none (required) | Twitch login | The channel to show. `@name` and full twitch.tv URLs (including popout, embed and `/subs/` links) are accepted. `#name` works in settings.js and the builder; in a URL write it as `%23name` or leave the `#` out. |
| `size` | `medium` | `small`, `medium`, `large` | Text size: 18, 24 or 32 px. |
| `font` | `Inter` | font name | Any Google Font, a stock Windows font (Arial, Segoe UI, Verdana, Calibri, …) or a CSS generic name (`sans-serif`, `monospace`, `system-ui`, …). Windows fonts and generic names are used as installed and never fetched. Any other name is loaded from Google Fonts, with each word capitalized to match Google's spelling (`roboto slab` becomes `Roboto Slab`). |
| `shadow` | `2` | `0`–`3` | Drop-shadow strength behind text and emotes. |
| `bg` | `0` | `0`–`100` | Opacity of a dark background box behind each message. |
| `layout` | `vertical` | `vertical`, `horizontal` | `vertical`: messages stack in a column. `horizontal`: messages sit side by side in one row, new ones come in on the right and older ones slide off to the left. In a row, a message longer than the source is cut off with an ellipsis, and GIFs and gigantified emotes are drawn at emote height. |
| `align` | `bottom` | `bottom`, `top` | `bottom`: newest message at the bottom. `top`: newest message at the top. With `layout=horizontal` the newest message is always on the right, and `align` picks the edge the row lines up on. |
| `animate` | `1` | bool | Slide and fade in new messages. |
| `fade` | `0` | `0`–`3600` | Seconds a message stays on screen; the last second is its fade-out. `0` means never. |
| `max` | `50` | `1`–`200` | Maximum number of messages on screen. A sub or resub notice and the viewer's own message under it count as one and leave together. |
| `bots` | `0` | bool | Show messages from known bots (Nightbot, StreamElements, …, plus the channel's BTTV bot list). During Shared Chat, the partner channel's BTTV bot list applies to its lines too. |
| `hide_commands` | `0` | bool | Hide messages that start with `!`, including replies whose text after the `@name` starts with `!`. |
| `block` | none | comma-separated logins | Users whose messages are hidden. A reply to a blocked user still shows, but without the blocked user's message in its header. |
| `events` | `1` | bool | Show sub, resub, gift, raid and bits-badge notices, and announcements. A resub's own chat message is shown either way. |
| `replies` | `1` | bool | Show a "↪ @user: message" header on replies. The header is left out when the quoted message was deleted by a mod, or its author was timed out or banned. |
| `first_msg` | `0` | bool | Highlight first-time chatters. |
| `history` | `5` | `0`–`100` | Load up to this many recent lines on start (from recent-messages.robotty.de). `0` turns it off. Timeouts, deletions, sub and raid notices, deleted messages and hidden bots count toward the limit, so fewer chat messages may appear. |
| `shared` | `1` | bool | Show messages from other channels during a Shared Chat session. |
| `gifs` | `1` | bool | Show Twitch chat GIFs. They load as Giphy's 200 px animated WebP instead of the full-size original. |
| `emotes_7tv`, `emotes_bttv`, `emotes_ffz` | `1` | bool | Turn each emote provider on or off. |
| `badges` | `1` | bool | Master switch for all badges. |
| `badges_twitch`, `badges_7tv`, `badges_bttv`, `badges_ffz`, `badges_ffzap`, `badges_chatterino`, `badges_homies` | `1` | bool | Turn each badge provider on or off. `badges_ffz` also covers the channel's FFZ custom mod and VIP badges, which show even with `badges_twitch=0`. |
| `paints` | `1` | bool | Show 7TV name paints. |
| `stv_lookup` | `1` | bool | Look up 7TV paints and badges for chatters who don't run a 7TV client (see notes). |
| `readable` | `1` | bool | Lighten dark name colors so they stay readable on stream. |
| `demo` | `0` | bool | Show looping sample messages instead of live chat. The builder preview uses this. |
| `debug` | `0` | bool | Show a status line with each provider's load state, and log to the console. |

## Custom CSS

OBS's **Custom CSS** box can restyle the overlay. These class names are stable:

| Selector | Element |
|---|---|
| `#chat` | the whole overlay |
| `#chat.layout-horizontal` | the overlay in the horizontal layout |
| `.line` | one message |
| `.line.notice` | a sub, raid or other notice |
| `.line.action` | a `/me` message |
| `.badges`, `.badge` | badge container and badge images |
| `.badge.colored` | an FFZ or FFZ:AP badge drawn on its own background color |
| `.name` | username |
| `.message` | message text |
| `.emote` | emote images |
| `.reply` | reply header |

For example, `.line { text-transform: uppercase; }`, `.badge { display: none; }` (hides every badge; `badges=0` does the same), or `.layout-horizontal .line { max-width: 30em; }` to cut long messages shorter in the horizontal layout.

Emote height is the `--emote-h` variable (default `1.75em`), so `#chat { --emote-h: 2em; }` makes emotes bigger. Images are fetched at the size they are normally drawn, so emotes or badges enlarged with Custom CSS may look slightly softer.

## Services this overlay contacts

Everything is fetched directly by your browser or OBS. There is no server of our own, no telemetry and no login.

| Service | Used for |
|---|---|
| Twitch chat (`irc-ws.chat.twitch.tv`) | chat messages (anonymous, read-only) |
| IVR API (`api.ivr.fi`) | Twitch badge lists, channel id lookup and the Shared Chat avatar |
| Twitch GQL (`gql.twitch.tv`) | fallback for Twitch badges when IVR is down |
| 7TV (`7tv.io`, `events.7tv.io`, `cdn.7tv.app`) | 7TV emotes, paints and badges, and live updates |
| BTTV (`api.betterttv.net`, `sockets.betterttv.net`, `cdn.betterttv.net`) | BTTV emotes and badges, and live updates |
| FrankerFaceZ (`api.frankerfacez.com`, `cdn.frankerfacez.com`) | FFZ emotes and badges |
| FFZ:AP (`api.ffzap.com`) | FFZ:AP supporter badges and their images |
| Chatterino (`api.chatterino.com`; images on `fourtf.com`) | Chatterino badges |
| Chatterino Homies (`itzalex.github.io`, `chatterinohomies.com`, `cdn.chatterinohomies.com`) | Homies badges |
| recent-messages (`recent-messages.robotty.de`) | recent chat history, unless `history=0` |
| Twitch CDN (`static-cdn.jtvnw.net`), cheer CDN (`d3aqoihi2n8ty8.cloudfront.net`), Giphy (`media*.giphy.com`) | Twitch emote, badge, avatar, cheermote and GIF images |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | the chosen font, unless it is a system font |

Badge and emote lists name their own image URLs, so a provider can move its images to another host. The builder and the home page load their own fonts (Figtree, Bricolage Grotesque and JetBrains Mono) from Google Fonts. The builder also uses the IVR API to check the channel name. The home page's two live demos are the overlay itself in demo mode, so they contact the same emote and badge services (no chat connection).

## Security: chat can't run code

Anyone can type in a Twitch chat, and emote names, badges and 7TV paints come from other people too. None of it can run code on your stream PC or change the overlay beyond the message it's in.

- **Text stays text.** Messages, names, reply headers, emote names and badge titles are only ever inserted as plain text. Nothing is parsed as HTML, so `<script>`, `<img onerror=…>` and similar just show up as typed.
- **Only https images.** Emote, badge, GIF and paint images must be `https://` URLs. GIFs are limited to Giphy, 7TV paint images to 7TV's CDN, and Twitch badges and the Shared Chat avatar to Twitch's CDN.
- **Validated styling.** Name and badge colors must be hex colors. 7TV paints are rebuilt from checked numbers and colors, with limited layers and shadows (up to 8 layers and 10 shadows, and the whole shadow chain shares a 32 px reach on each axis and for blur), so a paint can't escape its own rule or draw far outside the name.
- **Zalgo text** (piles of combining marks) is cut to 4 marks per letter, even with invisible characters between them, so it can reach at most about one text row into the message above instead of covering the chat. Normal accents and emoji are unaffected.
- **Size limits.** Message text is cut at 1000 characters, a message draws at most 300 emote images, and one emote stacks at most 4 zero-width layers. Real Twitch messages (500 characters) never reach these; only crafted history lines can. BTTV's rotate modifiers draw the emote in a square box, so a rotated wide emote stays within its own line.
- **Content-Security-Policy.** As a second layer, `overlay.html`, the builder and the home page only run their own script files: no inline scripts, no `eval`, nothing from other sites. Only `overlay.html` allows inline styles, because OBS applies a source's Custom CSS that way.
- **Sandboxed preview.** When the builder is served over http(s), its live-chat preview runs in a sandboxed frame (`allow-scripts` only) with no access to the builder page. Opened from disk (`file://`), the preview runs unsandboxed, because a sandboxed frame can't load local files; Chrome still gives each local page its own origin.

`tests/security.test.js` feeds hostile messages, emotes, badges and paints through the real code to keep it this way.

## Notes and limitations

- **DankChat badges are not supported.** DankChat's badge server doesn't allow browser requests (no CORS header), so a static page can't load them.
- **`stv_lookup`:** 7TV's own clients only learn another user's paint and badge when that user runs a 7TV client. This overlay also asks 7TV's API for each chatter's active paint and badge, so viewers on mobile get their paint too. That API doesn't check whether the cosmetic is still owned, so a lapsed 7TV subscriber may keep showing a paint. Lookups are batched, at most one request every 5 s, so in a busy chat a new chatter's paint or badge may appear a few seconds after their first line (a lone chatter is looked up about 0.3 s after their first message). Set `stv_lookup=0` to use 7TV-client events only.
- **Third-party services:** Twitch's official badge API needs a login. This overlay uses the community IVR API instead, falling back to Twitch's public GQL endpoint. If both are down, Twitch badges are hidden rather than shown as broken images.
- **Custom cheermotes:** channel-specific cheermotes can't be loaded without a login, so they show as plain text. Twitch's global cheermotes (Cheer, DoodleCheer, Kappa and others) show as images with a colored amount.
- **Badges off:** during Shared Chat, messages from the partner channel still show that channel's avatar so you can tell them apart.
- **Homies badges:** when a user is in more than one Homies list, their badges show in list order (itzalex badges, badges2, chatterinohomies), whichever list loads first.
- **Right-to-left chat:** the name is kept apart from the message, and a message takes its direction from its first letter, so Arabic and Hebrew chat reads correctly.
- **Busy chat:** new lines are drawn in batches, at most every 100 ms. Nothing changes below about 10 messages a second.
- **Builder:** each setting shows its option name, and the name reads `option=value` once the setting is off its default; those are the options the overlay URL carries. A link can open a section: `builder.html#obs`, `#look`, `#messages`, `#events`, `#filters`, `#emotes`, `#badges` or `#advanced`.
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
- `js/seventv.js`, `js/bttv.js`, `js/ffz.js`, `js/twitch-badges.js`, `js/extra-badges.js`: emote and badge providers.
- `js/tokenizer.js`: turns messages into emote and text tokens.
- `js/renderer.js`: builds the DOM.
- `js/paint-css.js`: 7TV paints.
- `js/config.js`: every option and its default.
- `js/util.js`: shared helpers (fetch with timeout and retry, the reconnecting socket, LRU cache, colors).
- `js/badge-resolve.js`: Twitch badge version lookup and sub-tier fallback.
- `js/rooms.js`: Shared Chat source channels.
- `js/demo.js`: demo mode (sample messages for the builder preview).
