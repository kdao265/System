import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedTimezone, timezoneOptions } from "../src/features/profile/timezones.ts";

test("timezone options come from runtime, include UTC and Ho Chi Minh, and are unique", () => {
  const options = timezoneOptions();
  assert(options.includes("UTC"));
  assert(options.includes("Asia/Ho_Chi_Minh"));
  assert(options.includes("America/New_York"));
  assert.equal(options.length, new Set(options).size);
  assert(options.length >= Intl.supportedValuesOf("timeZone").length);
});

test("runtime checks reject unset, offset, whitespace and implementation-only zones", () => {
  for (const value of [null, undefined, "", " ", "+07:00", "-04", " UTC", "UTC ", "posix/UTC", "right/UTC", "localtime", "Not/A_Zone"]) {
    assert.equal(isSupportedTimezone(value), false);
  }
  for (const value of ["UTC", "Asia/Ho_Chi_Minh", "US/Eastern"]) {
    assert.equal(isSupportedTimezone(value), true);
  }
});
