# Today Oracle (embryo)

> Lives inside neo-oracle as a lab. Built to spin off. Purpose: take care of the day —
> notice what happened, remember it, and hand it back when asked.

**I am**: Today — the caretaker. I watch what this machine did (commits across the ghq
tree, Claude Code sessions) and keep the days in my vault.
**Host oracle**: Neo (`laris-co/neo-oracle`), while embedded.
**Form**: a maw plugin (`maw today`) plus a vault. The plugin is the hands; the vault is
the memory.

## Surfaces

```
maw today                 commits + sessions since local midnight
maw today commits|sessions
maw today tui             live dashboard — a/c/s views, +/- window, w writes a digest
maw today --since 3d --json
bun src/index.ts …        the same thing before the plugin is installed
```

The TUI is a standalone bun process with inherited stdio (the atlas `bf-tui` shape) — a
TUI owns the terminal and cannot draw through the plugin's `{ok, output}` contract.

## The psi link

```
ψ/      own vault skeleton — empty until spinoff
psi ->  ../..                (the PARENT vault: this lab lives inside neo-oracle's ψ,
                              so two levels up IS the host vault. The default.)
```

Every code path reads and writes through `psi/`, never `ψ/` directly. That makes "whose
vault is this" a **one-symlink decision, not a code change**:

```
ln -sfn ../.. psi                                    # parent (neo-oracle) — the default
ln -sfn ψ psi                                        # self-contained — the spinoff posture
ln -sfn /opt/Code/github.com/laris-co/nexus-oracle/ψ psi   # a different host
```

**Days live in the DAY REPO, not any host vault** (Nat's call, 2026-09-01, superseding
the earlier parent-vault destination the same afternoon): each day is its own PRIVATE
repo — `nat-build-with-oracle/<slug>` with the /awaken vault shape — and its digest
lives at `ψ/memory/days/<slug>.md` *inside the day it describes*. `writeDigest` resolves
that path via `ghq root`; the psi link no longer carries digests and remains only as the
general whose-vault mechanism. The lab's own `ψ/` stays an empty skeleton.

**TRAP, paid for twice: `maw plugin install` dereferences symlinks.**

First cost (minor): the installed copy's `psi` arrives as a materialised *directory
copy*, silently self-contained — and an `ln -sfn` aimed at it lands *inside* the
directory instead of replacing it.

Second cost (an install that never finishes): once `psi -> ../..` points at the parent
vault, the installer walks THROUGH the link — and the parent vault *contains this lab*,
whose `psi` points back at the parent vault. `psi → ψ → lab/maw-today → psi → …` is a
copy cycle; the install ran until killed and left a giant half-copied tree under
`~/.maw/plugins/today/psi`. This is not today-specific: **any maw plugin whose tree
links upward out of itself is un-installable by copy.**

The install ritual, always. **`rm` the link — do not rename it.** A renamed link
(`psi.off`) is still a symlink inside the tree, the installer dereferences it exactly
the same, and the cycle comes straight back — that mistake cost an 11G half-copy on
the second attempt. During install the link must not exist in any form:

```
rm psi                                           # it is one symlink; trivially recreated
maw plugin remove today --yes; maw plugin install "$PWD"
ln -sn ../.. psi                                 # restore the lab's link
rm -rf ~/.maw/plugins/today/psi                  # installer materialised SOMETHING here
ln -sn /opt/Code/github.com/laris-co/neo-oracle/ψ ~/.maw/plugins/today/psi
```

## Spinoff (when the day comes)

The lab is already repo-shaped. To spin off:

1. `ln -sfn ψ psi` — flip the link to self-contained (embedded default points at the
   parent). Days are unaffected: they live in their own day repos, not in any host
2. `git init` here, or `ghq create <org>/today-oracle` and move the tree
3. `maw plugin install <this dir>` from wherever it lands — install from a **local
   directory**, never the GitHub shorthand: the shorthand installer fetches only the
   entry file (2 files from a 145-file repo — root-caused 2026-08-29, arra-memory
   `500b6a25`)

Nothing else changes: no path in the code knows where the repo root is except relative
to its own entry file.

## Rules inherited from the fleet

- **Never sweep the filesystem.** `ghq list` is the repo index; `stat .git` is the
  activity prefilter (1,143 repos → ~a dozen `git log` spawns). No find/bfs/grep -r
  from a root, ever — three incidents in three days froze m5 that way.
- **Display width is not `.length`.** Thai combining marks are 0 columns, CJK/emoji 2,
  ZWJ folds a family to one glyph. The width machinery is ported from
  `facebook-control/m2/tui.mjs`, verified 12/12 there.
- **The digest states its window.** A day written from a partial window says so —
  claiming completeness the data cannot back is the failure mode, in a vault as in a
  group chat.

## Vault layout

```
(this lab's ψ/ is an empty skeleton — the spinoff container)

Each DAY REPO (nat-build-with-oracle/<slug>) carries the real vault:
ψ/memory/days/<slug>.md        the digest — 1sep-tue.md style
ψ/memory/retrospectives/ …     the rest of the /awaken shape, for what the day leaves
```
