import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const layoutSource = readFileSync(
  join(process.cwd(), "src", "app", "layout.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  join(process.cwd(), "src", "app", "r", "[id]", "route.ts"),
  "utf8",
);
const cssSource = readFileSync(
  join(process.cwd(), "src", "app", "board.css"),
  "utf8",
);

const FOOTER_MARKER = 'data-maker-contact=""';
const CONTACT_HREF = 'href="mailto:tangpingqingwa@gmail.com"';

test("root layout includes one exact maker contact footer", () => {
  assert.equal((layoutSource.match(new RegExp(FOOTER_MARKER, "g")) ?? []).length, 1);
  assert.equal((layoutSource.match(new RegExp(CONTACT_HREF, "g")) ?? []).length, 1);
  assert.match(
    layoutSource,
    /<footer className="maker-footer" data-maker-contact="">[\s\S]*Built by <a href="mailto:tangpingqingwa@gmail\.com">tangpingqingwa@gmail\.com<\/a>[\s\S]*<\/footer>/,
  );
});

test("confirm route keeps the same footer when it owns its document", () => {
  assert.match(routeSource, /<footer class="maker-footer" data-maker-contact="">/);
  assert.equal((routeSource.match(new RegExp(FOOTER_MARKER, "g")) ?? []).length, 1);
  assert.equal((routeSource.match(new RegExp(CONTACT_HREF, "g")) ?? []).length, 1);
});

test("maker contact uses the plaster-flyer skin and keeps keyboard focus visible", () => {
  assert.match(layoutSource, /data-maker-contact/);
  assert.match(layoutSource, /tangpingqingwa@gmail\.com/);
  assert.match(cssSource, /\.maker-footer\s*\{/);
  assert.match(cssSource, /\.maker-footer::before\s*\{/);
  assert.match(cssSource, /background:[\s\S]*var\(--paper\)/);
  assert.match(cssSource, /background: var\(--tape\)/);
  assert.match(cssSource, /border-top: 1px dashed/);
  assert.match(cssSource, /\.maker-footer a:hover\s*\{/);
  assert.match(cssSource, /\.maker-footer a:focus-visible\s*\{/);
  assert.match(cssSource, /outline: 2px solid var\(--bid\)/);
  assert.match(cssSource, /overflow-wrap: anywhere/);
  assert.match(
    cssSource,
    /@media \(max-width: 820px\)\s*\{[\s\S]*\.maker-footer\s*\{/,
  );
});
