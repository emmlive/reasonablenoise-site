import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("retired admin Turnstile probes are absent and DTF verification remains enabled", () => {
  const adminPage = readFileSync(new URL("../src/pages/admin-orders.astro", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../functions/api/admin-orders.js", import.meta.url), "utf8");
  const contactApi = readFileSync(new URL("../functions/api/contact.js", import.meta.url), "utf8");
  const contactPage = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");

  assert.doesNotMatch(adminPage, /turnstile-probe-button|real-turnstile-button|rn-admin-real-turnstile|turnstile_real_verify|turnstile_probe/);
  assert.doesNotMatch(adminApi, /turnstile_probe|turnstile_real_verify|handleAdminTurnstileProbe|probeTurnstileSiteverify|RN_TURNSTILE_TEST_SECRET/);
  assert.match(adminApi, /export async function onRequestGet\(context\)/);
  assert.match(adminApi, /export async function onRequestDelete\(context\)/);

  assert.match(contactApi, /DTF_TURNSTILE_SECRET/);
  assert.match(contactApi, /turnstile\/v0\/siteverify/);
  assert.match(contactApi, /validateDtfArtworkChallenge/);
  assert.match(contactPage, /PUBLIC_DTF_TURNSTILE_SITE_KEY/);
  assert.match(contactPage, /dtf_artwork/);
});
