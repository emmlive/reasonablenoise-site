# RN-3B1C Phase 17 — Local desktop/mobile Chrome smoke

**Draft, unmerged, undeployed. Actual browser run NOT yet verified.**

Phase 17 adds an isolated Playwright browser runner at scripts/browser/rn-3b1c-phase17-dtf-journey.mjs. It connects **only** to an Astro dev server at 127.0.0.1:4327. It exercises desktop 1440×900 and mobile 390×844, invalid quantity, starting and BYO custom pricing, navigation, all DTF form preference transfer, horizontal overflow and explicit customer form submission.

The runner intercepts the DTF contact POST with a synthetic successful JSON response. All other API routes and all external requests are blocked. It does not send customer emails, upload to R2, call Turnstile, Stripe, or submit real contact records. Local test name/email are fake. The user must separately verify real providers in an authorized test environment.

## Windows verification

1. Fetch and check out branch feature/rn-3b1c-phase17-browser-journey-20261116.
2. Run node --test .\tests\dtf-quote-browser-harness-rn3b1c.test.mjs.
3. Install Playwright in a dedicated TEMP prefix via npm install --prefix "$env:TEMP\rn-phase17-playwright-isolated" --no-save --no-audit --no-fund playwright. Do not edit repository dependencies.
4. Set RN_PLAYWRIGHT_ROOT to that TEMP folder. Chrome must already be installed.
5. Start Astro locally with npm run dev -- --host 127.0.0.1 --port 4327 --strictPort. Set RN_BROWSER_BASE_URL=http://127.0.0.1:4327.
6. In a separate PowerShell process run node .\scripts\browser\rn-3b1c-phase17-dtf-journey.mjs. Require PHASE17_DESKTOP=PASS, PHASE17_MOBILE=PASS, PHASE17_BROWSER_RESULT=PASS. Stop the local Astro process.
7. Set RN_MINIFLARE_ROOT to existing TEMP rn-miniflare-phase5-isolated; run node --test .\tests\*.test.mjs and npm run build.
8. Run git diff --check origin/feature/rn-3b1c-phase16-dtf-quote-configurator-20261115...HEAD and git status --short.

## Pending targets

- Phase 17 offline safety contracts: 9/9 PASS.
- Real Chrome: desktop PASS, mobile PASS, local form post intercepted, no real provider requests.
- Full repository suite: 260/260 PASS, 11-page Astro build, clean Git.

The browser script intentionally does not test live Turnstile, real customer identity, Stripe checkout, R2, or actual contact delivery. None are authorized. The Phase 14 integration readiness hold remains in effect. DTF direct checkout and automatic deletion remain disabled. PR must stay draft and undeployed.
