# Why this checkout exists

pi loads `pi-claude-bridge` from this directory rather than from npm. The entry
in `~/.pi/agent/settings.json` is the absolute path to this checkout, not
`npm:pi-claude-bridge`, so `pi list` shows a path and `pi update --extensions`
leaves it alone.

The reason is that changes made to the installed copy under
`~/.pi/agent/npm/node_modules/` are erased by the next install, without a word.
That already happened once in the other direction: the `claude-fable-5-1` entry
was hand-edited into the installed package, and nothing but memory recorded it.
Here every local change is a commit on the `local` branch, `git log` says what
each one is for, and `git status` says whether the working tree still matches.

## What the `local` branch carries

`local` is upstream's `main` plus the commits listed by:

```bash
git log --oneline origin/main..local
```

Upstream `main` is ahead of the released 0.7.0 and is what fixes the rate-limit
warning that used to print `1% used` at 97% of the weekly window, and used to
print it on every single request. That fix is upstream's, not a local change,
which is why nothing here touches it.

The usage on pi's footer line (`src/usage.ts` for the state, `src/footer.ts`
for the footer, a copy of pi 0.85.1's with one more segment, wired in
`src/index.ts`) is a local commit; when pi changes its footer, `footer.ts` is
where the copy is brought up to date. Upstream has an open pull request for the same idea (#37) that
reads `utilization` as a percentage where the SDK sends a fraction, and the
maintainer's stated preference (#33) is the separate `pi-quotas` package, which
reads pi's own Anthropic login and not Claude Code's; neither fits this setup,
so the line lives here.

## The same checkout on another machine

The `local` branch is pushed to `github.com/danieljbk/pi-claude-bridge`, a fork
of upstream, as remote `fork`. `~/.pi/agent/settings.json` names this path in
its `packages`, and kwon's `config/claude/bootstrap.sh` clones the fork's
`local` branch to this path when it is absent and runs `npm install --omit=dev`
in it, so a new machine loads the same bridge. After a local commit here, push
it: `git push fork local`.

## Re-syncing with upstream

```bash
git fetch origin
git log --oneline local..origin/main     # what is new
git rebase origin/main                   # replay the local commits onto it
npm install --omit=dev                   # dependencies, if package.json moved
```

Then restart pi. A conflict during the rebase means upstream has changed the
same lines a local commit does; resolve it there, or drop the commit if
upstream has since done the same thing properly (which is how a local change is
meant to end).

## Going back to the npm package

Replace the path entry in `~/.pi/agent/settings.json` with
`"npm:pi-claude-bridge"` and restart pi. Everything on the `local` branch is
gone from the running bridge at that moment, including the Fable 5.1 entry.

## Dependencies

pi runs `npm install` for packages it installs from npm or git, but a local path
package is loaded where it sits, so this checkout's `node_modules/` is
maintained by hand. `@earendil-works/*` and `typebox` are peer dependencies pi
supplies from its own bundle and must not be installed here; `--omit=dev` keeps
them out along with the test tooling.
