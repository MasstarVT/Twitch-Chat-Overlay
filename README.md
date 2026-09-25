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
- **Config builder** (`index.html`) with a live preview, a demo mode, and copy or download buttons.

## Quick start

### Option A: GitHub Pages (recommended)

1. In your GitHub repo, go to **Settings → Pages**, choose **Deploy from a branch**, and pick `main` / `(root)`.
2. Open `https://<your-user>.github.io/Twitch-Chat-Overlay/`. That page is the builder. To pre-fill it, add options to its URL, for example `?channel=yourname`.
3. Enter your channel, adjust the look, and press **Copy** next to the overlay URL.
4. In OBS: **Sources → + → Browser**. Paste the URL, then set **Width** and **Height** to the same size as the builder preview (450 × 700 for the vertical layout, 1920 × 100 for the horizontal one).
5. In the same dialog, **uncheck** "Shutdown source when not visible" and "Refresh browser when scene becomes active". Leaving them on makes the chat reconnect and clear on every scene switch.

### Option B: a folder on your PC

1. Download the repo (Code → Download ZIP) and unzip it.
2. Open `index.html` in your browser, configure the overlay, and press **Download settings.js**. Save the file next to `overlay.html`. You can also copy `settings.example.js` to `settings.js` and edit it by hand.
3. In OBS, add a **Browser** source, tick **Local file**, and pick `overlay.html`.
4. After you change `settings.js`, open the source's properties and press **Refresh cache of current page**.

Alternatively, leave **Local file** unticked and paste a `file:///…/overlay.html?channel=…` URL. Query parameters work in that mode.

## Options

Put options in the overlay URL (for example `overlay.html?channel=xqc&size=large&fade=30`) or in `settings.js`. URL options override `settings.js`.

- **Booleans** accept `1/true/yes/on` and `0/false/no/off`.
- **Out-of-range numbers** are clamped to the nearest limit: `max=0` becomes 1, `bg=150` becomes 100.
- **Other invalid values** fall back to the default.
- **Builder output** includes only the options you changed.

| Option | Default | Values | What it does |
|---|---|---|---|
| `channel` | none (required) | Twitch login | The channel to show. `@name`, `#name` and full twitch.tv URLs are accepted. |
| `size` | `medium` | `small`, `medium`, `large` | Text size: 18, 24 or 32 px. |
| `font` | `Inter` | font name | Any Google Font or system font (Arial, Segoe UI, Verdana, …). |
| `shadow` | `2` | `0`–`3` | Drop-shadow strength behind text and emotes. |
| `bg` | `0` | `0`–`100` | Opacity of a dark background box behind each message. |
| `layout` | `vertical` | `vertical`, `horizontal` | `vertical`: messages stack in a column. `horizontal`: messages sit side by side in one row, new ones come in on the right and older ones slide off to the left. In a row, a message longer than the source is cut off with an ellipsis, and GIFs and gigantified emotes are drawn at emote height. |
| `align` | `bottom` | `bottom`, `top` | `bottom`: newest message at the bottom. `top`: newest message at the top. With `layout=horizontal` the newest message is always on the right, and `align` picks the edge the row lines up on. |
| `animate` | `1` | bool | Slide and fade in new messages. |
| `fade` | `0` | `0`–`3600` | Seconds before a message fades out. `0` means never. |
| `max` | `50` | `1`–`200` | Maximum number of messages on screen. |
| `bots` | `0` | bool | Show messages from known bots (Nightbot, StreamElements, …, plus the channel's BTTV bot list). |
| `hide_commands` | `0` | bool | Hide messages that start with `!`. |
| `block` | none | comma-separated logins | Users whose messages are hidden. |
| `events` | `1` | bool | Show sub, resub, gift, raid and bits-badge notices, and announcements. A resub's own chat message is shown either way. |
| `replies` | `1` | bool | Show a "↪ @user: message" header on replies. |
| `first_msg` | `0` | bool | Highlight first-time chatters. |
| `history` | `0` | `0`–`100` | Load this many recent messages on start (from recent-messages.robotty.de). |
| `shared` | `1` | bool | Show messages from other channels during a Shared Chat session. |
| `gifs` | `1` | bool | Show Twitch chat GIFs. |
| `emotes_7tv`, `emotes_bttv`, `emotes_ffz` | `1` | bool | Turn each emote provider on or off. |
| `badges` | `1` | bool | Master switch for all badges. |
| `badges_twitch`, `badges_7tv`, `badges_bttv`, `badges_ffz`, `badges_ffzap`, `badges_chatterino`, `badges_homies` | `1` | bool | Turn each badge provider on or off. |
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
| `.name` | username |
| `.message` | message text |
| `.emote` | emote images |
| `.reply` | reply header |

For example, `.line { text-transform: uppercase; }`, `.badge { display: none; }`, or `.layout-horizontal .line { max-width: 30em; }` to cut long messages shorter in the horizontal layout.

## Services this overlay contacts

Everything is fetched directly by your browser or OBS. There is no server of our own, no telemetry and no login.

| Service | Used for |
|---|---|
| Twitch chat (`irc-ws.chat.twitch.tv`) | chat messages (anonymous, read-only) |
| IVR API (`api.ivr.fi`) | Twitch badge images and channel id lookup |
| Twitch GQL (`gql.twitch.tv`) | fallback for Twitch badges when IVR is down |
| 7TV (`7tv.io`, `events.7tv.io`, `cdn.7tv.app`) | 7TV emotes, paints and badges, and live updates |
| BTTV (`api.betterttv.net`, `sockets.betterttv.net`, `cdn.betterttv.net`) | BTTV emotes and badges, and live updates |
| FrankerFaceZ (`api.frankerfacez.com`, `cdn.frankerfacez.com`) | FFZ emotes and badges |
| FFZ:AP (`api.ffzap.com`) | FFZ:AP supporter badges |
| Chatterino (`api.chatterino.com`) | Chatterino badges |
| Chatterino Homies (`itzalex.github.io`, `chatterinohomies.com`) | Homies badges |
| recent-messages (`recent-messages.robotty.de`) | recent chat history, only when `history` > 0 |
| Twitch CDN, cheer CDN, Giphy | emote, badge, cheer and GIF images |
| Google Fonts | the chosen font, unless it is a system font |

## Notes and limitations

- **DankChat badges are not supported.** DankChat's badge server doesn't allow browser requests (no CORS header), so a static page can't load them.
- **`stv_lookup`:** 7TV's own clients only learn another user's paint and badge when that user runs a 7TV client. This overlay also asks 7TV's API for each chatter's active paint and badge, so viewers on mobile get their paint too. That API doesn't check whether the cosmetic is still owned, so a lapsed 7TV subscriber may keep showing a paint. Set `stv_lookup=0` to use 7TV-client events only.
- **Third-party services:** Twitch's official badge API needs a login. This overlay uses the community IVR API instead, falling back to Twitch's public GQL endpoint. If both are down, Twitch badges are hidden rather than shown as broken images.
- **Custom cheermotes:** channel-specific cheermotes can't be loaded without a login, so they show as plain text. Twitch's global cheermotes (Cheer, DoodleCheer, Kappa and others) show as images with a colored amount.
- **Badges off:** during Shared Chat, messages from the partner channel still show that channel's avatar so you can tell them apart.
- **Older OBS versions:** OBS 28–30 use an older Chromium (103). The overlay is written to work there too.

## Development

```bash
npm test
```

This runs the unit tests with Node's built-in test runner (Node 18+; no dependencies). To preview locally, serve the folder with any static server, for example `python -m http.server 8080`, and open `http://localhost:8080/`.

Layout:

- `index.html`, `js/builder.js`, `css/builder.css`: the builder.
- `overlay.html`, `css/overlay.css`: the overlay page.
- `js/overlay.js`: startup and wiring.
- `js/irc*.js`: Twitch chat.
- `js/seventv.js`, `js/bttv.js`, `js/ffz.js`, `js/twitch-badges.js`, `js/extra-badges.js`: emote and badge providers.
- `js/tokenizer.js`: turns messages into emote and text tokens.
- `js/renderer.js`: builds the DOM.
- `js/paint-css.js`: 7TV paints.
- `js/config.js`: every option and its default.
