@AGENTS.md

# Checks: red is fixed before it ships (every session)

The owner wants to hear about any red check, from any session, before it reaches the live site.

- **Before committing**, run `npm run check` (type check, lint, tests; about 15 seconds). The commit hook in
  `.githooks/pre-commit` runs the same and stops a failing commit. Never commit with `--no-verify`. If the hook stops a
  commit, say so in your reply, with what failed, and fix it before committing again. If a failure is in another
  session's work rather than yours, tell the owner instead of changing their files.
- **After a push** (yours, or one the owner says they made), run `npm run ci-status` and tell the owner the result. It
  waits for GitHub's checks (type check, lint, tests, production build) and prints GREEN or RED with a link. On RED,
  say so first thing in your reply, name what failed, and offer to fix it.
- Work in a separate worktree when another session is active in this folder, so sessions never overwrite each other.
