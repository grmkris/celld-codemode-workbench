# Session checkpoint (2026-09-11)

## Proven this session

- Real celld 0.4.1
- Fuel-only interrupt: `sync-infinite-loop` + `microtask-loop` still pass
- `test:celld` fixture: 35 passed, live UNRUN
- `test:live` local: PASS `adapter=alibaba stored=true status=completed inspect=completed`
- Isolation: tests use `$TMPDIR/celld-codemode-test-<port>-<pid>`; workbench on :9876 stayed up
- Effect host probe: `{asyncOk,layerOk,interrupted,cleaned}`
- `npm run check` green (oxlint warnings only)
- Playwright fixture smoke passed; screenshots in `docs/screenshots/`
- gitleaks 8.28.0: no leaks in publishable tree
- Public repo target: `grmkris/celld-codemode-workbench`

## Isolation rule

`celld dev` stores state in `PROJECT/.celld/dev` and ignores `CELLD_WATCH`.
Copy `wrangler.jsonc` (do not symlink it) into an isolate **outside** this
checkout. A cwd under this repo's `.celld/` walks up to the workbench lease.

## Commands

```sh
export PATH="$PWD/node_modules/.bin:$HOME/.local/bin:$PATH"
npm run doctor
npm run dev                    # http://127.0.0.1:9876
npm test
npm run test:celld
npm run check
npm run test:live              # local only
```

Login: `operator` / `dev-change-me`.
