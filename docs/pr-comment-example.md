Example FlakeScope comment rendered from the demo suite's regression run:

<!-- flakescope:pr-comment -->

### FlakeScope

**3 flaky · 1 failed · 8 tests · 4 workers**

🔴 1 likely regression · 🟠 1 shared-state race · 🟡 1 env / resource · ⚪ 1 known intermittent

| Verdict               | Test                                                                           | Confidence |
| --------------------- | ------------------------------------------------------------------------------ | ---------- |
| 🔴 Likely regression  | cart total includes every item<br>`tests/checkout.spec.ts:5` · chromium        | high       |
| 🟠 Shared-state race  | renames the profile to Alice B<br>`tests/profile-b.spec.ts:6` · chromium-alice | high       |
| 🟡 Env / resource     | dashboard loads<br>`tests/dashboard.spec.ts:5` · chromium                      | high       |
| ⚪ Known intermittent | search results are sorted<br>`tests/search.spec.ts:5` · chromium               | low        |

<details>
<summary>🔴 <b>Likely regression</b> (high): cart total includes every item</summary>

`tests/checkout.spec.ts:5` · project `chromium` · failed on every attempt

**Evidence**

- All 3 attempts failed with "Error: expect(received).toEqual(expected) // deep equality" at tests/checkout.spec.ts:7.
- The full error message was identical on every attempt.

**Checked**

- Whether every attempt failed with the same error.
- Concurrent tests on other workers during failed attempts (6 overlaps) for shared resources (none declared).
- Failed attempts for timeouts, connection errors, browser/worker crashes, and resource exhaustion; first-attempt duration vs. passing attempts (slow = 3x and +1000 ms).

**Attachments**

- `test-results/checkout-cart-total-includes-every-item-chromium/trace.zip`
- `test-results/checkout-cart-total-includes-every-item-chromium-retry1/trace.zip`
- `test-results/checkout-cart-total-includes-every-item-chromium-retry2/trace.zip`

</details>

<details>
<summary>🟠 <b>Shared-state race</b> (high): renames the profile to Alice B</summary>

`tests/profile-b.spec.ts:6` · project `chromium-alice` · flaky (passed on retry)

**Evidence**

- Attempt 0 (worker 10) overlapped "renames the profile to Alice A" (tests/profile-a.spec.ts, worker 9, passed) for 1908 ms; both use account:alice, storageState:.auth/alice.json.
- Attempt 1 passed with no concurrent test sharing a resource.

**Checked**

- Whether every attempt failed with the same error.
- Concurrent tests on other workers during failed attempts (1 overlap) for shared resources (account:alice, storageState:.auth/alice.json).
- Failed attempts for timeouts, connection errors, browser/worker crashes, and resource exhaustion; first-attempt duration vs. passing attempts (slow = 3x and +1000 ms).

**Attachments**

- `test-results/profile-b-renames-the-profile-to-Alice-B-chromium-alice/test-failed-1.png`
- `test-results/profile-b-renames-the-profile-to-Alice-B-chromium-alice/trace.zip`

</details>

<details>
<summary>🟡 <b>Env / resource</b> (high): dashboard loads</summary>

`tests/dashboard.spec.ts:5` · project `chromium` · flaky (passed on retry)

**Evidence**

- Attempt 0 failed with a timeout: "Test timeout of 5000ms exceeded.".
- Attempt 0 took 8251 ms; attempt 1 passed in 231 ms (35.7x faster). A slow first attempt that times out suggests a cold start or a busy runner.

**Also observed**

- shared-state-race (low): Failed attempt ran alongside other tests on other workers and attempt 1 passed with nothing running concurrently, but no shared resource was declared.

**Checked**

- Whether every attempt failed with the same error.
- Concurrent tests on other workers during failed attempts (8 overlaps) for shared resources (none declared).
- Failed attempts for timeouts, connection errors, browser/worker crashes, and resource exhaustion; first-attempt duration vs. passing attempts (slow = 3x and +1000 ms).

**Attachments**

- `test-results/dashboard-dashboard-loads-chromium/test-failed-1.png`
- `test-results/dashboard-dashboard-loads-chromium/trace.zip`

</details>

<details>
<summary>⚪ <b>Known intermittent</b> (low): search results are sorted</summary>

`tests/search.spec.ts:5` · project `chromium` · flaky (passed on retry)

**Evidence**

- Attempt 0 failed with "Error: expect(locator).toHaveText(expected) failed" at tests/search.spec.ts:7.
- Attempt 1 passed.
- No shared resource, environment error, or consistent failure pattern explains the difference.

**Also observed**

- env-resource (low): Attempt 0 took 2196 ms; attempt 1 passed in 162 ms (13.6x faster). Weak on its own: a failed assertion waits for its timeout, so failures run longer.

**Checked**

- Whether every attempt failed with the same error.
- Concurrent tests on other workers during failed attempts (2 overlaps) for shared resources (none declared).
- Failed attempts for timeouts, connection errors, browser/worker crashes, and resource exhaustion; first-attempt duration vs. passing attempts (slow = 3x and +1000 ms).

**Attachments**

- `test-results/search-search-results-are-sorted-chromium/test-failed-1.png`
- `test-results/search-search-results-are-sorted-chromium/trace.zip`

</details>

<sub>Commit `156a938` · Playwright 1.63.0. Verdicts are hypotheses from deterministic rules, not root causes.</sub>
