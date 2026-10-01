import "./helpers/ui-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { en, vi, resolveLocale, getDictionary, localeCookie } from "../src/lib/localization/dictionaries.ts";
const { AppHeader } = await import("../src/components/app-header.tsx");
const { LocaleProvider } = await import("../src/lib/localization/provider.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { Button, Panel, SectionHeader, Badge, ProgressBar, EmptyState } = await import("../src/components/ui/primitives.tsx");

function leaves(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => typeof value === "string"
    ? [[prefix + key, value]] : leaves(value, `${prefix}${key}.`));
}

test("vi/en have exactly the same nonempty dictionary keys; Vietnamese is the strict fallback", () => {
  assert.deepEqual(leaves(vi).map(([key]) => key), leaves(en).map(([key]) => key));
  for (const [, value] of [...leaves(en), ...leaves(vi)]) assert(value.trim().length > 0);
  for (const input of [undefined, null, "", "fr", "EN", "__proto__", {}, "en; other=1"]) {
    assert.equal(resolveLocale(input), "vi"); assert.equal(getDictionary(input), vi);
  }
  assert.equal(getDictionary("en"), en); assert.equal(resolveLocale("vi"), "vi");
  assert.equal(localeCookie("en", true), "system-locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  assert(!localeCookie("vi", false).includes("Secure"));
});

test("navigation defaults to Vietnamese, retains English URLs and marks only the active route", () => {
  for (const current of ["dashboard", "calendar", "goals"]) {
    const html = render(h(AppHeader, { current, selectedDate: "2026-10-01" }));
    assert.match(html, /lang="vi"/); assert.match(html, /Điều hướng SYSTEM/);
    assert.match(html, /Tổng quan/); assert.match(html, /Mục tiêu \/ Main Quest/);
    assert.match(html, /href="\/calendar\?date=2026-10-01"/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, /for="shell-locale"/); assert.match(html, /value="vi"[^>]* selected/);
    assert.match(html, /type="submit"/);
  }
});

test("primitives preserve native button, region, heading and non-color status semantics", () => {
  assert.match(render(h(Button, { disabled: true }, "Save")), /<button type="button"[^>]*disabled/);
  assert.match(render(h(Button, { type: "submit", variant: "danger" }, "Remove")), /type="submit"/);
  assert.match(render(h(Panel, { "aria-label": "Player", "aria-busy": true }, h(SectionHeader, { title: "Progress" }))), /<section[^>]*aria-label="Player"[^>]*aria-busy="true"/);
  assert.match(render(h(SectionHeader, { title: "Progress" })), /<h2[^>]*>Progress<\/h2>/);
  assert.match(render(h(Badge, { tone: "success" }, "Complete")), />Complete<\/span>/);
  assert.match(render(h(EmptyState, { title: "No Quests", description: "Choose another day." })), /No Quests/);
});

test("the server-provided locale controls navigation and the selected option on first render", () => {
  for (const [locale, dictionary] of [["en", en], ["vi", vi]]) {
    const html = render(h(AppRouterContext.Provider, { value: { refresh() {} } },
      h(LocaleProvider, { locale }, h(AppHeader, { current: "goals" }))));
    assert(html.includes(`lang="${locale}"`));
    for (const label of Object.values(dictionary.navigation)) assert(html.includes(label));
    assert.match(html, new RegExp(`value="${locale}"[^>]* selected`));
  }
});

test("semantic foregrounds meet normal-text contrast and control borders remain visible", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const colors = Object.fromEntries([...css.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(([, key, value]) => [key, value]));
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const background of ["app", "surface", "elevated"]) {
    for (const foreground of ["text", "muted", "accent", "accent-secondary", "success", "warning", "danger", "exp", "level", "quest", "main-quest", "calendar"]) {
      assert(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background}`);
    }
    assert(contrast(colors["border-strong"], colors[background]) >= 3, `control border on ${background}`);
  }
});

test("progress is named, accessible and bounded without calculating any domain progress", () => {
  for (const [value, expected] of [[-5, 0], [150, 100], [NaN, 0], [Infinity, 0], [33.3, 33.3]]) {
    const html = render(h(ProgressBar, { value, label: "Goal progress", valueText: "1 of 3", tone: "main-quest" }));
    assert.match(html, /role="progressbar" aria-label="Goal progress"/);
    assert(html.includes(`aria-valuenow="${expected}"`));
    assert(html.includes(`width:${expected}%`));
    assert.match(html, /aria-valuetext="1 of 3"/);
  }
});
