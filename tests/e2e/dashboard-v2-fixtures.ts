import { test as base, expect } from "./fixtures";
import { provisionE2ELevelPolicyPrerequisite } from "./quest-prerequisites";

// A separate worker fixture gives the Dashboard journey an empty, disposable owner.
export const test = base.extend<object, { dashboardReady: void }>({
  dashboardReady: [async ({ environment }, provide) => {
    await provisionE2ELevelPolicyPrerequisite(environment);
    await provide();
  }, { scope: "worker", auto: true }],
});
export { expect };
