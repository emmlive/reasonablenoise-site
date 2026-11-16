# RN-3B1C Phase 17 — D1 browser navigation correction

**D1 correction only, based on first independent Windows failure. Browser PASS NOT yet established.**

## Failure evidence

- PR #38 browser safety tests: 9/9 PASS; full regressions 260/260 PASS; Astro 11 pages PASS; Git clean.
- Real Chrome desktop test: **BLOCKED** by Playwright `page.waitForURL` timeout at line 67; mobile was not reached.
- Phase 16 actual handoff is `/contact?topic=dtf` with **no trailing slash**; Phase 17 originally waited for **exactly** `/contact/`. This is a strongly indicated test harness mismatch, but no actual browser URL was logged in the failure, so still requires independent D1 rerun.

## Bounded fix

- Accept either `/contact` or `/contact/`, but require same localhost origin and `topic=dtf`.
- A navigation timeout logs only path, same-origin boolean, DTF topic boolean and error name, not full URL or contact data.
- Add four regression tests for the mismatch and retained strict origin/topic checks.
- No customer UI edits, no live route, payments, provider traffic or deployments.

## Windows D1 verification

Keep existing checkout branch clean. Use:

```powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/fix/rn-3b1c-phase17-contact-path-browser-d1-20261116
node --test .\tests\dtf-quote-browser-handoff-d1-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw "D1_CONTRACT_FAILED" }
node --test .\tests\dtf-quote-browser-harness-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw "PHASE17_HARNESS_CONTRACT_FAILED" }

$env:RN_PLAYWRIGHT_ROOT=Join-Path $env:TEMP "rn-phase17-playwright-isolated"
$env:RN_BROWSER_BASE_URL="http://127.0.0.1:4327"
if (!(Test-Path (Join-Path $env:RN_PLAYWRIGHT_ROOT "node_modules\playwright\index.mjs"))) { throw "PLAYWRIGHT_MISSING" }

# Start Astro in a separate PowerShell window:
# npm run dev -- --host 127.0.0.1 --port 4327 --strictPort
# Then, while the local server runs, execute:
node .\scripts\browser\rn-3b1c-phase17-dtf-journey.mjs
if ($LASTEXITCODE -ne 0) { throw "CHROME_NOT_VERIFIED" }

$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "REGRESSION_FAILED" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "BUILD_FAILED" }
git diff --check origin/feature/rn-3b1c-phase17-browser-journey-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw "GIT_DIFF_FAILED" }
git status --short
```

Targets: 4/4 new D1 tests, 9/9 existing browser harness tests, full 264/264 regressions, local Chrome DESKTOP and MOBILE PASS, 11-page build, Git clean. No browser or provider proof claimed until a new independent transcript arrives. Do not deploy or merge; preserve quote-first design and prohibit direct DTF checkout and automatic artwork deletion.
