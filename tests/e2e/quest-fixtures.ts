import { test as base, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";
import { provisionE2ELevelPolicyPrerequisite } from "./quest-prerequisites";

// A distinct worker fixture gives Quest tests their own instance of the existing
// environment, preserving the Auth suite's unconfigured-progression assertions.
export const test = base.extend<{ questOwnerPage: void }, { questReady: void }>({
  questReady: [async ({ environment }, provide) => {
    await provisionE2ELevelPolicyPrerequisite(environment);
    await provide();
  }, { scope: "worker", auto: true }],
  questOwnerPage: [async ({ page, environment }, provide) => {
    await loginOwner(page, environment.owner);
    await provide();
  }, { auto: true }],
});

export { expect };
