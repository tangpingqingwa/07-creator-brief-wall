# Contributing

This repo is developed on GitHub. **`main` must always be buildable and testable.** Nothing lands on `main` except through a green pull request.

The product contract is [SPEC.md](./SPEC.md). If SPEC and code disagree, fix one of them in the same PR.

## Default branch

| Rule | Detail |
|---|---|
| Default branch | `main` |
| Direct commits | Forbidden |
| Force-push / delete `main` | Forbidden |
| Merge gate | CI job `ci` is green on the PR head |
| History | Squash merge preferred |

## Branch names

`feat/<slug>` · `fix/<slug>` · `docs/<slug>` · `chore/<slug>` · `test/<slug>`

## Local loop

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/my-change
bash scripts/test.sh
git add -A
git commit -m "feat: short present-tense summary"
git push -u origin HEAD
gh pr create --fill --base main
```

Until application code exists, `scripts/test.sh` still runs: it validates the contract files. When you add an app, **extend** that script. Do not replace it with a no-op.
