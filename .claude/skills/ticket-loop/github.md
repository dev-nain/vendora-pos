# ticket-loop — GitHub reference

Code only: tickets are in Linear (`linear.md`). Repo: `dev-nain/vendora-pos`.
`R=dev-nain/vendora-pos` below. PRs target **`develop`** (the integration
branch; `main` is release-only).

If `gh pr edit` fails (Projects-classic GraphQL error), edit PRs with
`gh api -X PATCH repos/$R/pulls/<n> -F "body=@<file>"` instead.

## 1. Branches

`feat/ven-<n>-<slug>`, `fix/ven-<n>-<slug>` or `chore/ven-<n>-<slug>`, cut from
`origin/develop`. Linear's GitHub integration links a branch and its PR to
`VEN-<n>` by the identifier in the name, and `Closes VEN-<n>` in the PR body
moves the issue to Done on merge.

## 2. PR body

Write it to a scratch file and pass `--body-file`; never inline issue text into
a shell string. Name no `VEN-` identifier other than the ticket's own: Linear
links the PR to every identifier it finds and moves those issues too.

```markdown
Closes VEN-<n>

## Summary
<2–4 lines>

## Screenshots
| | Before | After |
|---|---|---|
| <name> (<size>, <theme>) | ![before](<prefix>/before-<name>.png) | ![after](<prefix>/after-<name>.png) |

<"New screen" in the Before cell when there is no before. Then any
"Not captured — <reason>" lines.>

## Tasks
- [x] <task> (<short sha>)

## Acceptance
- [x] <criterion> — <evidence>

## Checks
<the real output tails of typecheck / lint / format:check / test / build>

## How to test
<numbered manual steps from the prompt>

## Noticed, not changed
<unrelated issues seen, or "None">
```

Title: the issue title in conventional-commit style, e.g.
`feat: hold and resume bills at checkout`.

`<prefix>` is what `screenshots.sh publish` prints: a `github.com/<repo>/raw/<sha>`
URL pinned to a commit on the orphan `pr-screenshots` branch. Never use
`raw.githubusercontent.com` — for a private repo it has no session and 404s;
the `github.com` form renders for anyone signed in with repo access. That branch
holds only images, is never merged, and keeps screenshots out of
`develop`/`main` history.

## 3. Commits

Conventional commits: `type: lowercase imperative message` with type one of
`feat`, `fix`, `refactor`, `style`, `test`, `docs`, `chore`, e.g.
`feat: add held-bill table and service`. One commit per plan task. **No
`Co-Authored-By` trailer or any other signature.** Never `--no-verify`; if the
lefthook pre-commit hook fails, fix the cause.

## 4. Stacked PRs

Used when the prompt has a **Stack** section (the planner adds one for more than
4 tasks). Each group of tasks becomes one PR whose base is the PR below it; the
bottom PR targets `develop`.

**Branches.** The top group uses the normal `<prefix>/ven-<n>-<slug>` branch,
which holds all the commits. Each lower group `k` gets a branch at its last
commit, named **without** the ticket identifier:

```bash
git branch stack/<slug>-<k> <sha of group k's last commit>
git push -u origin stack/<slug>-1 … <prefix>/ven-<n>-<slug>
```

Linear links a branch by the `ven-<n>` in its name and moves the issue to Done
when that branch's PR merges, so only the top branch may carry it — otherwise
merging the bottom PR would close the ticket.

**Bodies.** The §2 template, except:
- Only the top PR starts with `Closes VEN-<n>`. Lower PRs start with
  `Part of VEN-<n> — stacked PR <k>/<total>. Base: <base branch>.` ("Part of"
  links without closing.)
- Every body lists the stack in merge order (`1. #<pr> — <group title>`).
  Create bottom-up, then patch the numbers in with `gh api -X PATCH`.
- Tasks, Acceptance and Checks cover that PR's group; the top PR also carries
  the full-stack check output.

**Titles:** the group title in commit style, suffixed `(VEN-<n> <k>/<total>)`.

**Creating:** `gh pr create --base <branch below> --head <branch> </dev/null`,
so it never waits on an interactive prompt.

**Merging (human):** bottom first, deleting each merged branch; GitHub then
retargets the next PR to `develop`.
