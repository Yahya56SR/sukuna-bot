# Project workflow

- After **every** change, commit and push it to `origin master` (the user asked for this explicitly).
  Do not leave work sitting uncommitted.
- Run `npx tsc` before committing so `dist/` (which is committed and is what `npm start` runs) stays in sync.
- Run `npx vitest run` when touching behaviour covered by tests.
- Never commit `.env` (it holds the Discord token and is not tracked).
