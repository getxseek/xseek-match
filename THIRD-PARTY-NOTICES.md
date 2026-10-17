# Third-party notices

xseek match is licensed under [AGPL-3.0-or-later](LICENSE). It includes, links to or credits the work listed here.

xseek match is an independent project. It isn't affiliated with or endorsed by any project or service named below.

## Service logos

`src/web/public/icons/` holds the Prowlarr, Sonarr, Radarr and qui logos, taken from the [selfh.st icons](https://github.com/selfhst/icons) collection. That collection is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 

The logos are trademarks of their projects. They appear only to label connections to those services. 

| Logo | Project | Project license |
| --- | --- | --- |
| Prowlarr | [Prowlarr](https://github.com/Prowlarr/Prowlarr) | GPL-3.0 |
| Sonarr | [Sonarr](https://github.com/Sonarr/Sonarr) | GPL-3.0 |
| Radarr | [Radarr](https://github.com/Radarr/Radarr) | GPL-3.0 |
| qui | [qui](https://github.com/autobrr/qui) by autobrr | GPL-2.0-or-later |

xseek match calls these services over their HTTP APIs and contains none of their code.

## Data fetched at runtime

xseek match doesn't bundle this data. It downloads it while running.

- **Tracker abbreviations** come from [fHori/Private-Trackers-Spreadsheet](https://github.com/fHori/Private-Trackers-Spreadsheet), a fork of [HDVinnie/Private-Trackers-Spreadsheet](https://github.com/HDVinnie/Private-Trackers-Spreadsheet). 
- **Scene numbering** comes from [TheXEM](https://thexem.info), which is community-maintained.
- **Posters and titles** come from your own Sonarr and Radarr. Those images are usually served by TMDB or TheTVDB.

## Origins of the code

- **Release-name parser** (`src/parser/`): derived from detect-core v4 (`detect-core:9bd5477`).
- **Release keys and grouping** (`src/domain/matching/`): derived from xseek (`xseek:78f9e8b`).

detect-core and xseek are unpublished projects by the same author. The derived code is offered here under this repository's license.

## Prior art

These projects shaped how xseek match thinks about matching releases across trackers and how its settings look. We read them and compared approaches. No code was copied from them.

### cross-seed

[cross-seed](https://github.com/cross-seed/cross-seed) (Apache-2.0): Our implementation shares some DNA following cross-seed's `REPACK_PROPER_REGEX` convention. Our pattern is an adapted version that catches tags glued to `S01`, `E05` or an absolute ` - 05`.

### qui

[qui](https://github.com/autobrr/qui) by autobrr (GPL-2.0-or-later) inspired our settings screen in some places.


## Theme palettes

The color presets under Settings → Appearance reproduce color values from these themes. `src/web/match/theme/presets.ts` maps them onto xseek match's roles.

| Preset | Source | License |
| --- | --- | --- |
| Dracula | [Dracula Theme](https://draculatheme.com), Zeno Rocha and contributors | MIT |
| Nord | [Nord](https://www.nordtheme.com), Arctic Ice Studio and Sven Greb | MIT |
| Gruvbox | [Gruvbox](https://github.com/morhetz/gruvbox), Pavel Pertsev | MIT |
| Solarized Dark | [Solarized](https://ethanschoonover.com/solarized/), Ethan Schoonover | MIT |
| One Dark | One Dark from the Atom editor, GitHub | MIT |
| Monokai | [Monokai](https://monokai.nl), Wimer Hazenberg | Colors only; no code used |
| Tokyo Night | [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme), enkia | MIT |
| Catppuccin Mocha | [Catppuccin](https://catppuccin.com) | MIT |
| GitHub Dark | [Primer primitives](https://github.com/primer/primitives), GitHub | MIT |
| Rosé Pine | [Rosé Pine](https://rosepinetheme.com) | MIT |

The xseek and Midnight presets are original.

## Packages

These packages ship in the Docker image or the built web app. 

| Package | License | Copyright |
| --- | --- | --- |
| [argon2](https://github.com/ranisalt/node-argon2) | MIT | © 2015 Ranieri Althoff |
| [@phc/format](https://github.com/simonepri/phc-format) | MIT | © 2018–2020 Simone Primarosa |
| [@epic-web/invariant](https://github.com/epicweb-dev/invariant) | MIT | © Kent C. Dodds |
| [cross-env](https://github.com/kentcdodds/cross-env) | MIT | © 2017–2025 Kent C. Dodds |
| [cross-spawn](https://github.com/moxystudio/node-cross-spawn) | MIT | © 2018 Made With MOXY Lda |
| [node-addon-api](https://github.com/nodejs/node-addon-api) | MIT | © 2017 Node.js API collaborators |
| [node-gyp-build](https://github.com/prebuild/node-gyp-build) | MIT | © 2017 Mathias Buus |
| [path-key](https://github.com/sindresorhus/path-key), [shebang-regex](https://github.com/sindresorhus/shebang-regex) | MIT | © Sindre Sorhus |
| [shebang-command](https://github.com/kevva/shebang-command) | MIT | © Kevin Mårtensson |
| [isexe](https://github.com/isaacs/isexe), [which](https://github.com/npm/node-which) | ISC | © Isaac Z. Schlueter and Contributors |
| [React](https://github.com/facebook/react) (react, react-dom, scheduler) | MIT | © Meta Platforms, Inc. and affiliates |
| [lucide-react](https://github.com/lucide-icons/lucide) | ISC | © 2026 Lucide Icons and Contributors; parts © 2013–present Cole Bemis (Feather, MIT) |
| [clsx](https://github.com/lukeed/clsx) | MIT | © Luke Edwards |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | MIT | © 2021 Dany Castillo |
| [class-variance-authority](https://github.com/joe-bell/cva) | Apache-2.0 | Joe Bell |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (generated CSS) | MIT | © Tailwind Labs, Inc. |
| [Vite](https://github.com/vitejs/vite) (runtime helpers in the bundle) | MIT | © 2019–present VoidZero Inc. and Vite contributors |

argon2 compiles the [reference Argon2 implementation](https://github.com/P-H-C/phc-winner-argon2), which is dual-licensed CC0 1.0 and Apache-2.0.

The Docker image keeps each package's own license file under `node_modules/`. The license texts below apply to the packages above, each with its own copyright line.

<details>
<summary>MIT License</summary>

```
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
```

</details>

<details>
<summary>ISC License</summary>

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

</details>

<details>
<summary>Apache License 2.0</summary>

The full text is at <https://www.apache.org/licenses/LICENSE-2.0>. class-variance-authority ships no NOTICE file.

</details>

## Brand

The xseek match wordmark and the xm mark are original to this project.

---

Something missing or credited wrong? Open an issue and we'll fix it.
