# Provider logos

The home page and the builder show nine provider logos. Each one is an unmodified copy from the project's own
repository or website, except `twitch.svg`, `kick.svg` and `youtube.svg`, which are drawn from Simple Icons path data
(below).
None of this grants trademark rights: the names and logos remain the marks of their owners, and they are used
here only to say which services the overlay works with. This project is not affiliated with any of them.

| File | Project | Source | License |
|---|---|---|---|
| `twitch.svg` | Twitch | Simple Icons 16.33.0 `icons/twitch.svg` path data, Twitch purple, with a white fill inside the outline (the same shapes as the overlay's platform icon) | CC0 1.0 for the path data |
| `kick.svg` | Kick | Simple Icons 16.33.0 `icons/kick.svg` path data, in Kick green | CC0 1.0 for the path data |
| `youtube.svg` | YouTube | Simple Icons 16.33.0 `icons/youtube.svg` path data, in YouTube red, with a white play triangle (the same shapes as the overlay's platform icon) | CC0 1.0 for the path data; the mark belongs to Google (YouTube) |
| `7tv.svg` | 7TV | https://github.com/SevenTV/Extension/blob/master/public/logo.svg | Apache 2.0 with the Commons Clause (licensor: SEVENTV SARL) |
| `bttv.png` | BetterTTV | https://github.com/night/betterttv/blob/master/src/assets/logos/bttv_logo.png | NightDev's BetterTTV license: copies are allowed, but distribution needs NightDev's permission (see below) |
| `ffz.png` | FrankerFaceZ | https://www.frankerfacez.com/static/images/favicon-192.png | none stated |
| `ffzap.png` | FFZ Add-On Pack | https://github.com/FrankerFaceZ/add-ons/blob/master/src/ffzap-core/logo.png | none stated (the repository has no license file) |
| `chatterino.svg` | Chatterino | https://chatterino.com/logo.svg (same file as `resources/icon.svg` in https://github.com/Chatterino/chatterino2) | MIT |
| `homies.png` | Chatterino Homies | https://github.com/itzAlex/chatterino7/blob/upstream-latest/resources/icon.png | MIT |

BetterTTV, FrankerFaceZ and the FFZ Add-On Pack grant no license for their logos (BetterTTV's license asks for
permission before its files are distributed). Their logos are shown only to identify those
services.

`7tv.svg` is drawn in `currentColor`, which is black when the file is loaded as an image. Both pages invert
it with CSS to show it in white; the file itself is unchanged.

## Platform icons in the overlay

With two or more of Twitch, Kick and YouTube set, the overlay starts each chat line with a small Twitch, Kick or
YouTube icon, so viewers can tell where a message came from. These are not image files: `js/icons.js` draws them as
inline SVG from the path data of the Twitch, Kick and YouTube icons in [Simple Icons](https://simpleicons.org)
16.33.0 (`icons/twitch.svg`, `icons/kick.svg` and `icons/youtube.svg`; Simple Icons is released under CC0 1.0). The
Twitch icon gets a white fill inside its outline, as in Twitch's own logo, and the YouTube icon a white play
triangle, as in YouTube's. The marks remain the property of Twitch, Kick and Google (YouTube); they are used only to
identify the platform a message came from, and `platform_icons=0` turns them off. The home page and the builder use
the same shapes, as `twitch.svg`, `kick.svg` and `youtube.svg`.

Kick's role badges (broadcaster, moderator, VIP and the others) and YouTube's (owner, moderator and member) are
simple glyphs on colored tiles, drawn for this project in `js/icons.js`; they are not copies of Kick's or YouTube's
own badge art.

## 7TV: Apache License 2.0 with the Commons Clause

Full text: [LICENSE-7TV.md](LICENSE-7TV.md), an unmodified copy of
https://github.com/SevenTV/Extension/blob/master/LICENSE.md

Copyright 2022 SEVENTV

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in
compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.

"Commons Clause" License Condition v1.0

The Software is provided to you by the Licensor under the License, as defined below, subject to the
following condition.

Without limiting other conditions in the License, the grant of rights under the License will not
include, and the License does not grant to you, right to Sell the Software.

For purposes of the foregoing, "Sell" means practicing any or all of the rights granted to you under the
License to provide to third parties, for a fee or other consideration (including without limitation fees
for hosting or consulting/ support services related to the Software), a product or service whose value
derives, entirely or substantially, from the functionality of the Software. Any license notice or
attribution required by the License must also include this Commons Cause License Condition notice.

Software: 7TV Web Extension 3
License: Apache 2.0 + Commons Clause
Licensor: SEVENTV SARL

## Chatterino and Chatterino Homies: MIT License

Both repositories carry the same notice.

MIT License

Copyright (c) 2017

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
