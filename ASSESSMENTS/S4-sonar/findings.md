# SonarQube findings — baseline scan

**Scanned:** 2026-04-20T20:50:04.383Z
**Server:** http://localhost:9000 (Community Edition)
**Project key:** terminal-talk
**Totals:** 9 bugs · 269 code smells · 23 security hotspots

---

## Bugs (9)

### F001 — Provide a compare function to avoid sorting elements alphabetically.
- **File:** `scripts/verify-voices.cjs:36`
- **Tool:** SonarQube (bug)
- **Severity:** critical
- **Rule:** `javascript:S2871`
- **Effort:** 10min
- **Evidence:** Provide a compare function to avoid sorting elements alphabetically.
- **Sonar key:** `86d897fa-61e2-410e-b9bb-eaa85c8fec89`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F002 — Provide a compare function that depends on "String.localeCompare", to reliably sort ele…
- **File:** `app/lib/session-stale.js:44`
- **Tool:** SonarQube (bug)
- **Severity:** critical
- **Rule:** `javascript:S2871`
- **Effort:** 10min
- **Evidence:** Provide a compare function that depends on "String.localeCompare", to reliably sort elements alphabetically.
- **Sonar key:** `c0510e2a-c261-4464-a51b-67320b92d6a6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F003 — Remove this control character.
- **File:** `app/lib/text.js:97`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `javascript:S6324`
- **Effort:** 5min
- **Evidence:** Remove this control character.
- **Sonar key:** `577c0e53-4602-47ce-88e4-6d56651eafc5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F004 — Remove this control character.
- **File:** `app/lib/text.js:97`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `javascript:S6324`
- **Effort:** 5min
- **Evidence:** Remove this control character.
- **Sonar key:** `d31737aa-7931-4183-8a42-08f0250a6283`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F005 — Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **File:** `scripts/wallpaper.html:2`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `Web:S5254`
- **Effort:** 2min
- **Evidence:** Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **Sonar key:** `efaab4de-d704-4276-9784-f249c5c04072`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F006 — Add a <title> tag to this page.
- **File:** `scripts/wallpaper.html:3`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `Web:PageWithoutTitleCheck`
- **Effort:** 5min
- **Evidence:** Add a <title> tag to this page.
- **Sonar key:** `5374f413-a416-407e-b232-17ac3cfecb2d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F007 — Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **File:** `docs/ui-kit/index.html:2`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `Web:S5254`
- **Effort:** 2min
- **Evidence:** Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **Sonar key:** `34aafcac-e980-4b93-8d81-da33df0942fc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F008 — Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **File:** `app/index.html:2`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `Web:S5254`
- **Effort:** 2min
- **Evidence:** Add "lang" and/or "xml:lang" attributes to this "<html>" element
- **Sonar key:** `172ce333-b13e-4f34-8d9f-defe261b3bad`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F009 — Add "<th>" headers to this "<table>".
- **File:** `app/index.html:133`
- **Tool:** SonarQube (bug)
- **Severity:** major
- **Rule:** `Web:S5256`
- **Effort:** 2min
- **Evidence:** Add "<th>" headers to this "<table>".
- **Sonar key:** `ce1f53ba-1b4c-4d03-9b9a-d3be3f2b832f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

---

## Code smells (269)

### F010 — Refactor this method to not always return the same value.
- **File:** `app/key_helper.py:230`
- **Tool:** SonarQube (code-smell)
- **Severity:** blocker
- **Rule:** `python:S3516`
- **Effort:** 2min
- **Evidence:** Refactor this method to not always return the same value.
- **Sonar key:** `8c62926c-008b-460c-b6dc-77f307ef4115`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F011 — Refactor this method to not always return the same value.
- **File:** `app/wake-word-listener.py:82`
- **Tool:** SonarQube (code-smell)
- **Severity:** blocker
- **Rule:** `python:S3516`
- **Effort:** 2min
- **Evidence:** Refactor this method to not always return the same value.
- **Sonar key:** `bce79836-49cc-4a70-937d-1a8342d8fa74`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F012 — Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **File:** `app/lib/registry-lock.js:41`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 10min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **Sonar key:** `7e90a7bb-4193-45f7-9ccc-528a4a8226dc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F013 — Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed.
- **File:** `app/synth_turn.py:392`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S3776`
- **Effort:** 15min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed.
- **Sonar key:** `8d8051ad-0839-4e7b-bc50-4e6a0aa93c54`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F014 — Refactor this function to reduce its Cognitive Complexity from 48 to the 15 allowed.
- **File:** `app/wake-word-listener.py:82`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S3776`
- **Effort:** 38min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 48 to the 15 allowed.
- **Sonar key:** `c8d6cf49-9de6-42fc-b8d1-2fd8e60e9452`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F015 — Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **File:** `app/synth_turn.py:515`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S3776`
- **Effort:** 10min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **Sonar key:** `8045a25c-2e0a-43d1-8af9-c9d693db2afe`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F016 — Define a constant instead of duplicating this literal '.partial' 4 times.
- **File:** `app/edge_tts_speak.py:40`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S1192`
- **Effort:** 8min
- **Evidence:** Define a constant instead of duplicating this literal '.partial' 4 times.
- **Sonar key:** `25de373f-6364-4ddd-bb5d-8bf7f27e5779`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F017 — Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.
- **File:** `scripts/render-mocks.cjs:34`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 7min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.
- **Sonar key:** `07ccfbf7-b4b1-4407-80df-ee4a93f512a8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F018 — Refactor this function to reduce its Cognitive Complexity from 32 to the 15 allowed.
- **File:** `app/renderer.js:1290`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 22min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 32 to the 15 allowed.
- **Sonar key:** `25d1c257-c373-4c4c-b8fb-c8dec639ca9a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F019 — Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed.
- **File:** `app/lib/session-stale.js:30`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 6min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed.
- **Sonar key:** `e53bcb28-c941-4e16-a85b-5483f985677f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F020 — Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **File:** `app/main.js:1223`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 10min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **Sonar key:** `d0261046-486f-456f-9de4-e13cf5743ec5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F021 — Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **File:** `app/synth_turn.py:450`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S3776`
- **Effort:** 10min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.
- **Sonar key:** `3e5a3cc5-d040-4d87-a574-c752e7645563`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F022 — Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.
- **File:** `app/renderer.js:702`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 7min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.
- **Sonar key:** `9b867fc7-aa5c-4ae0-8216-37294315435d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F023 — Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **File:** `app/synth_turn.py:644`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `python:S3776`
- **Effort:** 8min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **Sonar key:** `e83fdc03-3475-40cd-88f0-c26c8bebf1a0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F024 — Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **File:** `app/main.js:1041`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 8min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **Sonar key:** `2a34ee24-7392-4157-bcc6-db6c3edf7427`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F025 — Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **File:** `app/main.js:232`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 8min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.
- **Sonar key:** `b138871b-6b59-450f-b4e4-bb259cf6630b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F026 — Refactor this function to reduce its Cognitive Complexity from 34 to the 15 allowed.
- **File:** `app/main.js:835`
- **Tool:** SonarQube (code-smell)
- **Severity:** critical
- **Rule:** `javascript:S3776`
- **Effort:** 24min
- **Evidence:** Refactor this function to reduce its Cognitive Complexity from 34 to the 15 allowed.
- **Sonar key:** `b1881af6-8d2f-4d65-8ac7-96a951d73a3e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F027 — A form label must be associated with a control and have accessible text.
- **File:** `app/index.html:104`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `Web:S6853`
- **Effort:** 5min
- **Evidence:** A form label must be associated with a control and have accessible text.
- **Sonar key:** `947539d3-5217-4688-a084-ec9db7f61e50`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F028 — Text does not meet the minimal contrast requirement with its background.
- **File:** `docs/ui-kit/kit-chrome.css:64`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `eb63618a-735b-4198-bbd2-d8a31eeabf34`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F029 — Text does not meet the minimal contrast requirement with its background.
- **File:** `docs/ui-kit/kit-chrome.css:74`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `60aa2101-eb2a-4882-9a64-0d50611b14e9`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F030 — Remove this useless assignment to variable "hexShort".
- **File:** `docs/ui-kit/mock-ipc.js:130`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "hexShort".
- **Sonar key:** `d98b20a2-a883-46a9-b686-b68195ed00c7`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F031 — This statement will not be executed conditionally; only the first statement will be. Th…
- **File:** `docs/ui-kit/mock-ipc.js:294`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S2681`
- **Effort:** 5min
- **Evidence:** This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.
- **Sonar key:** `70c5779c-73e4-4c84-a28c-820cfae95ab8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F032 — This statement will not be executed conditionally; only the first statement will be. Th…
- **File:** `docs/ui-kit/mock-ipc.js:310`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S2681`
- **Effort:** 5min
- **Evidence:** This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.
- **Sonar key:** `0584a3e3-3a33-4c91-be23-5be171f737eb`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F033 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `docs/ui-kit/mock-ipc.js:364`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `416c6cb6-c9d5-4165-be06-8a586ebf7dbb`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F034 — Extract this nested ternary operation into an independent statement.
- **File:** `scripts/palette-pixel-diff.cjs:46`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S3358`
- **Effort:** 5min
- **Evidence:** Extract this nested ternary operation into an independent statement.
- **Sonar key:** `6407ae52-32ed-4127-8489-7ae90eb00662`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F035 — Extract this nested ternary operation into an independent statement.
- **File:** `scripts/palette-pixel-diff.cjs:81`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S3358`
- **Effort:** 5min
- **Evidence:** Extract this nested ternary operation into an independent statement.
- **Sonar key:** `0c49be6a-a978-4420-af93-46a6e9b1367d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F036 — Remove this useless assignment to variable "VSPLIT_PARTNER".
- **File:** `scripts/generate-tokens-css.cjs:103`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "VSPLIT_PARTNER".
- **Sonar key:** `8e100ff0-1e97-4bf1-9743-82f5082589c6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F037 — Remove this useless assignment to variable "HSPLIT_PARTNER".
- **File:** `scripts/generate-tokens-css.cjs:103`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "HSPLIT_PARTNER".
- **Sonar key:** `9e47079d-3b28-42ab-a212-b38870d4e3fb`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F038 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/lib/api-key-store.js:33`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `a4126380-9896-47a5-8346-b4c36a62ea33`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F039 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/lib/api-key-store.js:74`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `f215deaf-4e35-432b-96a4-d7e26bc173dc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F040 — Extract this nested ternary operation into an independent statement.
- **File:** `app/lib/config-validate.js:35`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S3358`
- **Effort:** 5min
- **Evidence:** Extract this nested ternary operation into an independent statement.
- **Sonar key:** `bf04a071-798f-4788-bb90-2244f93cff40`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F041 — Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **File:** `app/main.js:1269`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S5843`
- **Effort:** 10min
- **Evidence:** Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **Sonar key:** `c1006036-8d22-4b1a-b794-35c78cd306b2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F042 — Refactor this code to not use nested template literals.
- **File:** `app/main.js:1208`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S4624`
- **Effort:** 10min
- **Evidence:** Refactor this code to not use nested template literals.
- **Sonar key:** `778df121-115f-4c75-a86a-a4e3f94b827a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F043 — Refactor this code to not use nested template literals.
- **File:** `app/main.js:1208`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S4624`
- **Effort:** 10min
- **Evidence:** Refactor this code to not use nested template literals.
- **Sonar key:** `ecaf1823-cf4b-4d02-807b-b2367d1a1505`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F044 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:9`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `5eaa6ef8-5109-41a3-940b-fd3f81bebc12`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F045 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:13`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `ac5a707b-a341-4721-94aa-6654b0f0688e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F046 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:21`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `daaeb906-ea32-44c2-8054-024bf7f93d1c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F047 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:25`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `5d792066-4037-41bf-afdc-57d390ed1cc6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F048 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:26`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `c285ebf3-b21c-4318-a157-fccc1b9f22a9`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F049 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:932`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `9d96513e-555b-4ccd-aa23-c7cfea0038de`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F050 — Extract this nested ternary operation into an independent statement.
- **File:** `scripts/render-mocks.cjs:43`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S3358`
- **Effort:** 5min
- **Evidence:** Extract this nested ternary operation into an independent statement.
- **Sonar key:** `8f6609a5-b882-4132-9146-9fd5c2be841e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F051 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `scripts/check-doc-drift.cjs:107`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `9d2b6e51-c8f9-4c35-8866-e9520d432b0f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F052 — Use <menu> or <ol> or <ul> instead of the list role to ensure accessibility across all …
- **File:** `app/index.html:83`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `Web:S6819`
- **Effort:** 5min
- **Evidence:** Use <menu> or <ol> or <ul> instead of the list role to ensure accessibility across all devices.
- **Sonar key:** `d4e9d2ba-055a-40ff-a92c-15f25e9ad29c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F053 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:744`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `eed59f6b-38a4-470b-8380-916d58dbcdc1`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F054 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:753`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `9789dcf7-42cc-414e-bd6d-ad83c8a03ec2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F055 — Use `Math.trunc` instead of `| 0`.
- **File:** `app/lib/backoff.js:22`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S7767`
- **Effort:** 5min
- **Evidence:** Use `Math.trunc` instead of `| 0`.
- **Sonar key:** `914e4bf2-3558-4ee9-b793-01f331cc39d0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F056 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:1081`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `356bd4ae-49d7-4b37-9865-9dff6fcf59e5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F057 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:1091`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `756ff34b-dd30-4f26-bb9a-e30c1e5cf565`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F058 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:1099`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `2bd8275e-072e-48d3-aab6-54d1a6c2066b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F059 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:1102`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `f52edd59-c497-452d-a5f2-396e9d3f4e36`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F060 — Extract this nested ternary operation into an independent statement.
- **File:** `app/lib/palette-alloc.js:51`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S3358`
- **Effort:** 5min
- **Evidence:** Extract this nested ternary operation into an independent statement.
- **Sonar key:** `6eb2b5c1-d409-45c4-89c3-f38a7ada1268`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F061 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:176`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `8c2cddb3-42bd-40a3-a1c4-6283f307b67b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F062 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:182`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `ce8b7e53-cd66-4b68-b658-e696b0d1a0bc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F063 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:620`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `c84b528f-d452-4862-a79c-f03c5663d950`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F064 — Unexpected duplicate selector ".bar-top", first used at line 52
- **File:** `app/styles.css:453`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S4666`
- **Effort:** 1min
- **Evidence:** Unexpected duplicate selector ".bar-top", first used at line 52
- **Sonar key:** `5451d8d7-ee6b-456c-8df1-364debfe7e48`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F065 — Unexpected duplicate selector ".scrubber-wrap", first used at line 233
- **File:** `app/styles.css:452`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S4666`
- **Effort:** 1min
- **Evidence:** Unexpected duplicate selector ".scrubber-wrap", first used at line 233
- **Sonar key:** `c16de6f6-7d86-4870-b28b-e4c705c97097`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F066 — Remove this commented out code.
- **File:** `app/index.html:41`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `Web:AvoidCommentedOutCodeCheck`
- **Effort:** 5min
- **Evidence:** Remove this commented out code.
- **Sonar key:** `09fd18a7-9b31-4c2a-a710-0557c2e9e443`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F067 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1034`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `4f14c9f8-8a3f-4155-9d02-496ffbe965b3`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F068 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1038`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `66d280c2-ffe2-4ba6-9955-e0651a8723f9`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F069 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1042`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `43270463-ce1f-4965-812f-c54ec9232089`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F070 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1046`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `32027a1f-5fae-45ba-9c34-4377037760f8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F071 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1070`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `8e790428-35bf-404c-be2c-d2ca82e6fb54`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F072 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:1495`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `440d1460-ebd3-447d-9cf0-74126dffa57a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F073 — Move this array "sort" operation to a separate statement or replace it with "toSorted".
- **File:** `app/main.js:323`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S4043`
- **Effort:** 5min
- **Evidence:** Move this array "sort" operation to a separate statement or replace it with "toSorted".
- **Sonar key:** `82140a1c-181a-4291-aee9-95cc27d1ddcc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F074 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:300`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `9d84453d-ce13-4dd4-89bc-dd4b74a8e57c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F075 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:707`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `4f9637c3-72bc-4e6e-8798-0b8053d442db`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F076 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:711`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `63c36beb-9d3d-4228-ae88-992a6c60e2d0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F077 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:748`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `c5d5a67d-c7e5-4dcd-9af0-ee6967f8c728`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F078 — Remove this useless assignment to variable "dispW".
- **File:** `app/main.js:310`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "dispW".
- **Sonar key:** `016d9178-8fc1-4218-9838-bcbe44f379c6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F079 — Remove this useless assignment to variable "dispX".
- **File:** `app/main.js:310`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "dispX".
- **Sonar key:** `e2331d6c-7cc2-4ff7-9f38-6c12b4833d63`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F080 — Remove this useless assignment to variable "x".
- **File:** `app/main.js:311`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "x".
- **Sonar key:** `468d0f79-0435-4e51-87e1-8eecaca0515a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F081 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1527`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `11e414b6-a2be-4807-baf0-aa220ef0b116`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F082 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:576`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `30b74f71-3645-41ce-a2b4-8bc6b7f5f56a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F083 — A form label must be associated with a control and have accessible text.
- **File:** `app/index.html:96`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `Web:S6853`
- **Effort:** 5min
- **Evidence:** A form label must be associated with a control and have accessible text.
- **Sonar key:** `213255a5-c0f6-4ff8-893c-aa46f4fe2575`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F084 — Remove this useless assignment to variable "p".
- **File:** `app/renderer.js:428`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S1854`
- **Effort:** 1min
- **Evidence:** Remove this useless assignment to variable "p".
- **Sonar key:** `47818521-3dfd-4d3e-98d4-469ef0c32c1d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F085 — Unexpected duplicate selector ".dots-row", first used at line 60
- **File:** `app/styles.css:68`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S4666`
- **Effort:** 1min
- **Evidence:** Unexpected duplicate selector ".dots-row", first used at line 60
- **Sonar key:** `98612c6f-875c-4a1e-aa15-cbd8be80429e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F086 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:280`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `59250100-e910-4b28-9434-b11d275d16b6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F087 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:683`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `0c61e75c-8fcf-4264-98f2-2d5ea2b78988`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F088 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:687`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `f660ccd5-8f4a-4cfa-892c-45cb2ee4cdcd`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F089 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:843`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `e8b40dc2-69bc-4a95-becf-16be1a30e1fc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F090 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:887`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `71c8a3f9-b86e-4701-8aef-0f5ffb2a95d4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F091 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/main.js:982`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `877042a9-bb61-4b74-9f6e-1fea4cad575a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F092 — Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **File:** `app/main.js:1037`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S5843`
- **Effort:** 10min
- **Evidence:** Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **Sonar key:** `9c8a3dea-448d-4493-ba46-56b3648269b5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F093 — Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **File:** `app/main.js:1339`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S5843`
- **Effort:** 10min
- **Evidence:** Simplify this regular expression to reduce its complexity from 21 to the 20 allowed.
- **Sonar key:** `05a5e844-2b8f-42f1-a045-0f90dd60e63e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F094 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:335`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `80695723-1b90-497d-8273-b876bbf705de`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F095 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:539`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `13932ffe-37b5-42c2-ae97-aa8695e3a3af`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F096 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:674`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `944e27f6-cd56-4917-acec-6f647b3e730b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F097 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:675`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `a55e6bf2-adc5-4f8f-8e72-50520d007966`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F098 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:703`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `b3a15345-478f-40a2-bb8b-6ea27c204a3a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F099 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:704`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `d2301900-ed2d-4eee-b2e9-e4f698bf0ad5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F100 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1142`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `93969a71-79c7-49a2-b299-fd797fb82e94`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F101 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1149`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `1262d66b-9a6f-49e9-a940-d75c7ddcc575`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F102 — Prefer using an optional chain expression instead, as it's more concise and easier to r…
- **File:** `app/renderer.js:1520`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `javascript:S6582`
- **Effort:** 5min
- **Evidence:** Prefer using an optional chain expression instead, as it's more concise and easier to read.
- **Sonar key:** `f1db6217-bfc1-4fcf-8fc2-d811cea9d09b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F103 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:187`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `dcd9074d-ca84-4962-af10-f5c6be9a8329`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F104 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:198`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `25315300-3a8e-484a-9bc4-3f97dc453510`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F105 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:207`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `6decae03-673f-4810-86fa-f00ac7141b7e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F106 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:214`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `7326d789-a61f-4e3a-bc4c-3091a06043bf`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F107 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:227`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `4fdb7b67-448e-420f-abb5-6f5fc06a6661`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F108 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:594`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `3cffb7eb-0566-4cd2-b73b-54fb56d8d320`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F109 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:670`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `2b275b8a-9f11-4269-aa78-9fa73f7731ba`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F110 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:775`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `5408f4a7-e8b9-400c-96c2-776d5fff768c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F111 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:807`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `7f795edd-6133-4da9-997e-47b60b377c32`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F112 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:814`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `e700ac73-8d82-4c64-b842-c5439c962b51`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F113 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:831`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `1cdbe4e5-cb0d-4bb8-93ed-3fb40385171c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F114 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:837`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `e72ff97d-90de-46f0-a21e-01e717fd6dca`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F115 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:859`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `1d94cd9d-2696-4f7e-8bc6-d382ebf94e99`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F116 — Text does not meet the minimal contrast requirement with its background.
- **File:** `app/styles.css:891`
- **Tool:** SonarQube (code-smell)
- **Severity:** major
- **Rule:** `css:S7924`
- **Effort:** 5min
- **Evidence:** Text does not meet the minimal contrast requirement with its background.
- **Sonar key:** `0a02cc99-24f5-44f0-a104-8ea4052b9aed`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F117 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1558`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `fbed9ea6-9ecf-457f-beee-9ccbdf1c3c86`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F118 — Expected a `for-of` loop instead of a `for` loop with this simple iteration.
- **File:** `docs/ui-kit/mock-ipc.js:70`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S4138`
- **Effort:** 5min
- **Evidence:** Expected a `for-of` loop instead of a `for` loop with this simple iteration.
- **Sonar key:** `441fa152-2da7-4845-a3c1-46936c8290b2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F119 — Prefer `String.fromCodePoint()` over `String.fromCharCode()`.
- **File:** `docs/ui-kit/mock-ipc.js:70`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String.fromCodePoint()` over `String.fromCharCode()`.
- **Sonar key:** `7dfe0dfc-6321-4708-b36f-e25eb5d32a5f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F120 — Remove the declaration of the unused 'hexShort' variable.
- **File:** `docs/ui-kit/mock-ipc.js:130`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'hexShort' variable.
- **Sonar key:** `0943c2a8-49d5-420e-8a1d-2fa15d3fb654`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F121 — Prefer `globalThis` over `window`.
- **File:** `docs/ui-kit/mock-ipc.js:278`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `50e5c539-dbfc-40df-911d-58c1fc9e41c7`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F122 — The empty object is useless.
- **File:** `docs/ui-kit/mock-ipc.js:287`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `4f45bdd5-1c99-43db-95cb-b00e791617dc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F123 — The empty object is useless.
- **File:** `docs/ui-kit/mock-ipc.js:288`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `864653cc-9636-4af3-b71a-1df258f42776`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F124 — The empty object is useless.
- **File:** `docs/ui-kit/mock-ipc.js:289`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `61934ad7-2195-46d1-bf73-92a5f2774b79`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F125 — The empty object is useless.
- **File:** `docs/ui-kit/mock-ipc.js:290`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `a7a1c83b-a852-4a47-aa9f-8c7301c5e170`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F126 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/palette-pixel-diff.cjs:106`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `8f86b1d0-c4c0-44d6-9dd1-72e1dcbdc9cd`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F127 — Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **File:** `app/renderer.js:353`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **Sonar key:** `b19f7d46-9750-496a-b4d2-0436aabec002`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F128 — Remove the declaration of the unused 'VSPLIT_PARTNER' variable.
- **File:** `scripts/generate-tokens-css.cjs:103`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'VSPLIT_PARTNER' variable.
- **Sonar key:** `7fcb7b28-2eaf-403a-a4f0-bc1d172d4322`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F129 — Remove the declaration of the unused 'HSPLIT_PARTNER' variable.
- **File:** `scripts/generate-tokens-css.cjs:103`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'HSPLIT_PARTNER' variable.
- **Sonar key:** `d7da1cda-cc11-4fb2-ab6e-8270558a6cd3`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F130 — Do not call `Array#push()` multiple times.
- **File:** `scripts/generate-tokens-css.cjs:114`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7778`
- **Effort:** 5min
- **Evidence:** Do not call `Array#push()` multiple times.
- **Sonar key:** `f220cdfe-56b1-47cd-9790-43d3dbfa0f0d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F131 — Do not call `Array#push()` multiple times.
- **File:** `scripts/generate-tokens-css.cjs:121`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7778`
- **Effort:** 5min
- **Evidence:** Do not call `Array#push()` multiple times.
- **Sonar key:** `1da7c3d3-d173-4576-b159-bccc0ab48388`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F132 — Prefer `node:fs` over `fs`.
- **File:** `app/lib/api-key-store.js:25`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `831fdb5f-2b2b-4e8b-8f8d-a2b0f9158891`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F133 — Prefer `node:path` over `path`.
- **File:** `app/lib/api-key-store.js:26`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `7f5e8a07-db61-4916-b320-e4b211e040fa`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F134 — Remove the declaration of the unused '_drop' variable.
- **File:** `app/lib/api-key-store.js:91`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused '_drop' variable.
- **Sonar key:** `ab753e3a-72a9-4c06-a472-59b5e5e82fc6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F135 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/render-mocks.cjs:93`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `235a8d99-6bfc-4531-b9dd-0bf1711bf2c8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F136 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/render-mocks.cjs:96`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `fed9959d-646d-4b63-af31-87842d73ff32`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F137 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/render-mocks.cjs:97`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `69e2ac04-5a83-45eb-83b4-6a2aab258342`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F138 — Replace with dict fromkeys method call
- **File:** `app/wake-word-listener.py:116`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `python:S7519`
- **Effort:** 1min
- **Evidence:** Replace with dict fromkeys method call
- **Sonar key:** `a1703250-ed0d-4f1f-8556-0bfa88c510c2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F139 — Rename class "_INPUT_UNION" to match the regular expression ^_?([A-Z_][a-zA-Z0-9]*|[a-z…
- **File:** `app/key_helper.py:59`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `python:S101`
- **Effort:** 5min
- **Evidence:** Rename class "_INPUT_UNION" to match the regular expression ^_?([A-Z_][a-zA-Z0-9]*|[a-z_][a-z0-9_]*)$.
- **Sonar key:** `e43beb56-5f4a-4504-88ef-0d15a54bf833`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F140 — Replace the unused local variable "done" with "_".
- **File:** `app/synth_turn.py:597`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `python:S1481`
- **Effort:** 5min
- **Evidence:** Replace the unused local variable "done" with "_".
- **Sonar key:** `5a16b8a6-b52e-4942-a079-b1d4bd45eb2a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F141 — Prefer `node:crypto` over `crypto`.
- **File:** `app/main.js:6`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:crypto` over `crypto`.
- **Sonar key:** `cabb1f8e-e9a2-4b69-85e1-89e8d3944f55`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F142 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1176`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `320fb881-dca3-4e2e-8ace-36b4125a0048`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F143 — Prefer `node:fs` over `fs`.
- **File:** `scripts/generate-voices-window.cjs:8`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `4e19d5c1-971c-4509-a3a6-39b5ccfdc40c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F144 — Prefer `node:path` over `path`.
- **File:** `scripts/generate-voices-window.cjs:9`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `7a3cbf98-97d4-47e6-bd47-825a0acec8cc`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F145 — Prefer `node:fs` over `fs`.
- **File:** `scripts/verify-voices.cjs:14`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `741b1b16-7ff3-4b86-8823-6b3d72f25fda`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F146 — Prefer `node:path` over `path`.
- **File:** `scripts/verify-voices.cjs:15`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `b6b24f1f-de15-43b3-9cfc-c14351d430c3`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F147 — Prefer `node:child_process` over `child_process`.
- **File:** `scripts/verify-voices.cjs:16`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:child_process` over `child_process`.
- **Sonar key:** `2caa08ae-4f42-4778-b180-c3cad12a9514`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F148 — Don't use a zero fraction in the number.
- **File:** `app/lib/config-validate.js:15`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7748`
- **Effort:** 1min
- **Evidence:** Don't use a zero fraction in the number.
- **Sonar key:** `6804297b-2dbd-46e8-8013-b270dc8ec526`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F149 — Unexpected negated condition.
- **File:** `app/lib/rate-limit.js:20`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7735`
- **Effort:** 2min
- **Evidence:** Unexpected negated condition.
- **Sonar key:** `5f6a4cb1-b180-48c8-8394-dce128588649`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F150 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:7`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `7eb17bbe-5814-4ed4-b238-0ecbac51b184`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F151 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:9`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `1999fb59-76c2-4ac9-8ccf-852bf88b00a0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F152 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:9`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `e7540754-2202-498a-8aa5-50d44fb92690`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F153 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:10`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `25b170ee-b3a9-4414-87c6-e4400c8384d0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F154 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:19`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `550c5990-c3c8-4c4b-b5fe-e411a6be08ea`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F155 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:21`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `d63b48ea-1077-4f24-a8fc-c592df7d7eee`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F156 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:21`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `d8f818a1-3699-4b6e-be88-edb5de5f9ff3`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F157 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:23`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `f4ce0392-5dc1-40c7-b960-5d47b872fe9a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F158 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:256`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `4dd9abfd-f1e6-4062-91ce-d8b521289686`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F159 — Prefer `node:fs` over `fs`.
- **File:** `scripts/generate-tokens-css.cjs:11`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `38f13fe8-6266-45f8-a012-e106b30cc2e0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F160 — Prefer `node:path` over `path`.
- **File:** `scripts/generate-tokens-css.cjs:12`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `5e118a43-235f-4cfe-856d-d32fb96e671c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F161 — Prefer `node:fs` over `fs`.
- **File:** `scripts/check-doc-drift.cjs:17`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `29f7786e-79cd-49de-aa9e-1d64f0ccc3d8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F162 — Prefer `node:path` over `path`.
- **File:** `scripts/check-doc-drift.cjs:18`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `4529b1c0-508d-4d8c-8d09-8b36239d9db2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F163 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/check-doc-drift.cjs:106`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `897b77e3-4871-46f6-b21a-a5045ee02b8c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F164 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:743`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `2eee97c6-338d-4b1e-9618-09394dfe8a63`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F165 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1381`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `f1f2c7e6-026e-4824-81b5-00cbe0e60361`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F166 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:1076`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `5df70f81-878d-4dca-b4af-0c343bea7eea`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F167 — Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **File:** `app/lib/palette-alloc.js:66`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **Sonar key:** `aacc44d3-a139-4642-a8e3-28ba6f418b8f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F168 — Prefer `Number.parseInt` over `parseInt`.
- **File:** `app/main.js:1231`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.parseInt` over `parseInt`.
- **Sonar key:** `e0c9f60a-6f6c-4285-a77b-e76d3b6c118c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F169 — Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **File:** `app/main.js:1236`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **Sonar key:** `f9ebe107-b77f-4a51-86dd-7f3dd1758253`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F170 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:203`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `6fbf2484-6348-4606-9b3a-91adc5570c9d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F171 — The empty object is useless.
- **File:** `app/lib/text.js:34`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `d0b6af23-178d-45ca-98c7-976444b3f33f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F172 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:43`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `86e8a96d-88c4-4b92-ac77-3873dfe4d794`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F173 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:48`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `c77a5f92-99ff-4afa-b365-5630290efa32`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F174 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:52`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `5b4e17b5-d8cf-4002-babe-418cb7952e1f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F175 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:54`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `256f4283-4333-47c8-a948-01c545f7e21c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F176 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:58`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `9d547c71-aa32-4aa4-8947-ad7ab144bcbf`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F177 — Unexpected negated condition.
- **File:** `app/lib/text.js:58`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7735`
- **Effort:** 2min
- **Evidence:** Unexpected negated condition.
- **Sonar key:** `e3c1576f-9b3e-4371-bf75-f068ee37c444`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F178 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:59`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `bc0e232c-9aa9-4874-80a1-d510b60654ae`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F179 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:62`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `8ef99792-57fd-41b8-9429-f1f7e03c3589`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F180 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:65`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `d0cd7882-594f-44a2-b813-021d956fc3a5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F181 — Unexpected negated condition.
- **File:** `app/lib/text.js:69`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7735`
- **Effort:** 2min
- **Evidence:** Unexpected negated condition.
- **Sonar key:** `0a591204-470a-45b0-887d-c8de4b3c9cd2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F182 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:69`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `6ae13d10-e12b-4476-a57c-7355f1737a09`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F183 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:70`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `8495fa6a-c949-459a-83b6-47ce14255a9f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F184 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:73`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `e62e480f-9743-4c69-8ae7-57ceacf581b2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F185 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:74`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `d300464d-893b-4676-aa0d-fb1ed5b27656`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F186 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:75`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `a10426d6-9434-4f61-ab26-af05f6f5a07d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F187 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:79`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `f39aaa13-8895-41e6-a02d-9d0abcf2fa07`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F188 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:80`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `25f07734-21a1-4391-9b0f-0e58c8adb3ae`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F189 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:81`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `c1b92821-2490-468d-bf94-e7bf0ffbae1f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F190 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:86`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `194c349d-548c-4b62-a38d-7fdeb38ed13f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F191 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:87`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `52aaf930-0ea1-478c-977d-de7f44c2ea77`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F192 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:88`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `b4d6da2b-0a9c-490c-bdfc-cd5f33345e8e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F193 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:92`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `5de066ca-7256-4e0b-87ca-ab473e1373b4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F194 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:93`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `58241448-2489-4248-91b5-606834b7630e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F195 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:97`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `fd43bd47-b51e-4cc3-9dce-dece44fbd5de`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F196 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/lib/text.js:100`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `376f953f-3491-47eb-beea-fc2d17dfcade`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F197 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1671`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `20f16646-5b3f-434f-8990-32239671566b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F198 — Prefer `Number.isFinite` over `isFinite`.
- **File:** `app/renderer.js:972`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.isFinite` over `isFinite`.
- **Sonar key:** `b803b81a-100b-40c6-b923-1058046adc59`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F199 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:482`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `9c3a80b6-7f4f-41db-b062-a6376ce5b502`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F200 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:484`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `8469ad8c-d281-4d28-a407-f9d6e577af38`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F201 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/render-mocks.cjs:125`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `94876767-4baa-4593-a4e0-cba426da23c4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F202 — Prefer `node:fs` over `fs`.
- **File:** `scripts/wrap-ascii-face.cjs:11`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `bc789d7d-fb48-4fae-9770-7045fda66ac7`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F203 — `String.raw` should be used to avoid escaping `\`.
- **File:** `scripts/wrap-ascii-face.cjs:14`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7780`
- **Effort:** 5min
- **Evidence:** `String.raw` should be used to avoid escaping `\`.
- **Sonar key:** `a3ef30a2-cf50-44f6-b8bc-bac3478fd36d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F204 — `String.raw` should be used to avoid escaping `\`.
- **File:** `scripts/wrap-ascii-face.cjs:20`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7780`
- **Effort:** 5min
- **Evidence:** `String.raw` should be used to avoid escaping `\`.
- **Sonar key:** `a9bba021-5dfc-4e3f-9877-d2c8a250baf9`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F205 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `scripts/wrap-ascii-face.cjs:30`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `a494abc4-2737-43a0-9e98-a5431f8b03f2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F206 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:147`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `bc6a2608-f36b-4ad4-b8a7-4ef6cb2ed20f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F207 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1658`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `67884a4f-c965-4a5e-9bae-c55c5d2b0e8d`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F208 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1659`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `64a17e27-8667-4d8f-af31-2d78bd8b92b5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F209 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1645`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `ff42109a-105d-4271-b266-ff364b09d758`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F210 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1646`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `cd2c1834-0344-4983-b157-e5fc3a4695c4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F211 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1642`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `be3f3384-b3b6-439a-a6db-8f262a5643bf`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F212 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1420`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `8f1f4cc5-bbdf-4f8d-978e-8d441c656d5e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F213 — The empty object is useless.
- **File:** `app/main.js:356`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `fbbcef9d-550d-4ad8-b15d-c3bc1f6cccab`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F214 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1670`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `82b12229-48fa-4e5c-a20d-79fb79e4693c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F215 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1641`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `858c6715-67ef-4f35-97a2-65ce5c33503f`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F216 — The empty object is useless.
- **File:** `app/main.js:279`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `2e845917-5239-4244-962e-6693967b5f33`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F217 — Remove the declaration of the unused 'dispX' variable.
- **File:** `app/main.js:310`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'dispX' variable.
- **Sonar key:** `34dac15e-4221-4040-bd33-360d120c0455`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F218 — Remove the declaration of the unused 'dispW' variable.
- **File:** `app/main.js:310`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'dispW' variable.
- **Sonar key:** `f2560f9d-4dd2-47e7-b0fe-5cd744686894`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F219 — Remove the declaration of the unused 'x' variable.
- **File:** `app/main.js:311`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'x' variable.
- **Sonar key:** `20a2f7d2-7b87-4d99-b153-e12951871480`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F220 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1546`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `a798ee07-f55c-4707-ba89-517bce3974e0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F221 — Unexpected negated condition.
- **File:** `app/renderer.js:426`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7735`
- **Effort:** 2min
- **Evidence:** Unexpected negated condition.
- **Sonar key:** `49176446-e82b-4e4f-9d73-d9a2568c38b2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F222 — Remove the declaration of the unused 'p' variable.
- **File:** `app/renderer.js:428`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S1481`
- **Effort:** 5min
- **Evidence:** Remove the declaration of the unused 'p' variable.
- **Sonar key:** `5ff71c2e-b3b8-4018-a0e3-47a75c3e69b0`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F223 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1536`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `a8382725-223d-47f5-899e-5bb63ab537d2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F224 — It's not necessary to initialize 'prevShort' to undefined.
- **File:** `app/renderer.js:504`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S6645`
- **Effort:** 5min
- **Evidence:** It's not necessary to initialize 'prevShort' to undefined.
- **Sonar key:** `b914ddf0-20e6-42a5-917f-f717acbdad20`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F225 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1398`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `f65d9f5f-fe7b-4a50-aab2-b9708e4332e7`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F226 — Prefer `node:child_process` over `child_process`.
- **File:** `app/main.js:1560`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:child_process` over `child_process`.
- **Sonar key:** `699fe3ef-f825-4fbc-99c5-eeef94028775`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F227 — Remove this redundant Exception class; it derives from another which is already caught.
- **File:** `app/wake-word-listener.py:35`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `python:S5713`
- **Effort:** 1min
- **Evidence:** Remove this redundant Exception class; it derives from another which is already caught.
- **Sonar key:** `2a175aa4-1f3a-4c64-8596-56269112441a`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F228 — Prefer `node:path` over `path`.
- **File:** `app/main.js:2`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:path` over `path`.
- **Sonar key:** `26d747b3-3df7-4812-909c-086e65ea425e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F229 — Prefer `node:fs` over `fs`.
- **File:** `app/main.js:3`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:fs` over `fs`.
- **Sonar key:** `01a309f4-24af-4dac-89fa-14306e6d48c8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F230 — Prefer `node:os` over `os`.
- **File:** `app/main.js:4`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:os` over `os`.
- **Sonar key:** `3dfb7198-aa76-4e46-8e4f-f984320322af`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F231 — Prefer `node:https` over `https`.
- **File:** `app/main.js:5`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:https` over `https`.
- **Sonar key:** `5d2da737-e44f-4bee-94d5-6ca853ac8ddf`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F232 — Prefer `node:child_process` over `child_process`.
- **File:** `app/main.js:7`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7772`
- **Effort:** 5min
- **Evidence:** Prefer `node:child_process` over `child_process`.
- **Sonar key:** `76af555d-741a-4c1b-adfc-81012de5a61c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F233 — The empty object is useless.
- **File:** `app/main.js:87`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `e2267446-096f-45ce-af1b-16808a53f021`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F234 — The empty object is useless.
- **File:** `app/main.js:88`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `49cf3d32-b9c3-4c0f-9ba4-080ecb6ccd30`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F235 — The empty object is useless.
- **File:** `app/main.js:89`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `7ac45010-c63f-4539-a33c-3de433f09d3e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F236 — The empty object is useless.
- **File:** `app/main.js:90`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `179ea2f7-34be-4134-b15e-1aade09c5193`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F237 — Prefer `Number.parseInt` over `parseInt`.
- **File:** `app/main.js:261`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.parseInt` over `parseInt`.
- **Sonar key:** `d95e6eb9-47dd-46c4-90dc-cb874d2aa023`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F238 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:645`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `dd705fbf-8fc7-450f-ab3c-a28dffd82176`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F239 — Prefer `Number.parseInt` over `parseInt`.
- **File:** `app/main.js:850`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.parseInt` over `parseInt`.
- **Sonar key:** `d81fd008-cb00-4c9b-90d3-5ca9ed6a7a58`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F240 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:990`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `4a0d55e8-7d1e-404b-bb39-bb8d4aa71396`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F241 — The catch parameter `e1` should be named `error_`.
- **File:** `app/main.js:1009`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7718`
- **Effort:** 5min
- **Evidence:** The catch parameter `e1` should be named `error_`.
- **Sonar key:** `94021974-8258-41d0-9e6b-ca3792b8d00c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F242 — The catch parameter `e2` should be named `error_`.
- **File:** `app/main.js:1016`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7718`
- **Effort:** 5min
- **Evidence:** The catch parameter `e2` should be named `error_`.
- **Sonar key:** `fb1bce41-e2bc-4d7f-991b-6a44e547e300`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F243 — Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **File:** `app/main.js:1094`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **Sonar key:** `fde7abc3-64ab-420b-9062-c0ac93f99f76`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F244 — The empty object is useless.
- **File:** `app/main.js:1313`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `bf55ceb5-a161-483d-8b07-48b9415c3250`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F245 — The empty object is useless.
- **File:** `app/main.js:1314`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `cae2a795-9f01-4596-a6d9-90f823b8ace2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F246 — The empty object is useless.
- **File:** `app/main.js:1315`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `af8f9162-2bd2-4745-9357-20c1ccebb380`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F247 — The empty object is useless.
- **File:** `app/main.js:1316`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7744`
- **Effort:** 5min
- **Evidence:** The empty object is useless.
- **Sonar key:** `36a0c45e-c797-43fa-8924-8eb4224b60ef`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F248 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/main.js:1347`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `2c6cdf79-d955-49ab-b022-1df3b7a8a8c2`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F249 — Unexpected negated condition.
- **File:** `app/main.js:1455`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7735`
- **Effort:** 2min
- **Evidence:** Unexpected negated condition.
- **Sonar key:** `92eff964-10c5-49ca-92e1-bcc339e5763c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F250 — Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **File:** `app/renderer.js:364`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7758`
- **Effort:** 5min
- **Evidence:** Prefer `String#codePointAt()` over `String#charCodeAt()`.
- **Sonar key:** `a1086604-dfe8-4439-84d8-e1b887d3d554`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F251 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:419`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `886d85cf-356b-4d95-8f97-1bc1a4a6b396`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F252 — Prefer `Number.isFinite` over `isFinite`.
- **File:** `app/renderer.js:448`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.isFinite` over `isFinite`.
- **Sonar key:** `74e534f5-fbb4-40ce-ad7e-86ae28332066`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F253 — Prefer `String#replaceAll()` over `String#replace()`.
- **File:** `app/renderer.js:455`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7781`
- **Effort:** 5min
- **Evidence:** Prefer `String#replaceAll()` over `String#replace()`.
- **Sonar key:** `fdf653a5-c27b-4cc6-8cc5-637b457a4f95`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F254 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:599`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `c05a8fff-cb9f-4764-a499-1ff7c1a6f186`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F255 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:608`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `f8964399-78b5-43a1-ba25-10e01770d3e7`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F256 — Prefer `.some(…)` over `.find(…)`.
- **File:** `app/renderer.js:624`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7754`
- **Effort:** 5min
- **Evidence:** Prefer `.some(…)` over `.find(…)`.
- **Sonar key:** `044fb338-ff86-4e0b-9ec0-ed332522f7eb`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F257 — Prefer `.some(…)` over `.find(…)`.
- **File:** `app/renderer.js:657`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7754`
- **Effort:** 5min
- **Evidence:** Prefer `.some(…)` over `.find(…)`.
- **Sonar key:** `979aad11-b25f-4f31-bfd1-cca828974814`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F258 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:673`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `b57234bb-c11e-4878-9b42-e75c9be137f8`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F259 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:702`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `038c4a47-b97f-46c6-87c6-1c6d138dc2a5`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F260 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:750`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `7bc972a3-2aa1-4a9a-ac17-22397c9f6140`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F261 — Prefer `Number.isFinite` over `isFinite`.
- **File:** `app/renderer.js:788`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.isFinite` over `isFinite`.
- **Sonar key:** `7af95705-9def-42da-bf8d-4215eb2fdc04`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F262 — Prefer `Number.isFinite` over `isFinite`.
- **File:** `app/renderer.js:1092`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.isFinite` over `isFinite`.
- **Sonar key:** `65d6c1a4-6cf2-431c-84dd-785f89703243`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F263 — Prefer `Number.isFinite` over `isFinite`.
- **File:** `app/renderer.js:1104`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7773`
- **Effort:** 2min
- **Evidence:** Prefer `Number.isFinite` over `isFinite`.
- **Sonar key:** `a61bad3e-9c49-4bb7-9768-0b900bdf7c5b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F264 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1118`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `33771dea-9455-4d22-aa92-0c8ff0e11f79`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F265 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1118`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `b66c5f6c-30c2-46e7-8111-e9c93af2b8c4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F266 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1136`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `edf3cb98-9f9f-4408-aa21-15a69a20d7be`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F267 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1138`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `d16fe1c2-8cf7-4f0c-8850-784ff031d347`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F268 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1161`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `05391e58-8b43-484b-8966-dfb5b0402e1c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F269 — Prefer `.some(…)` over `.find(…)`.
- **File:** `app/renderer.js:1199`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7754`
- **Effort:** 5min
- **Evidence:** Prefer `.some(…)` over `.find(…)`.
- **Sonar key:** `0a31f8eb-3999-41b9-8f83-939a29cb786b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F270 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1338`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `91c1b7ac-8c19-4d26-88e3-70c7a3bc2afb`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F271 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1347`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `581e350b-fefb-4307-8812-28a309e4851c`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F272 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1456`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `b683a515-740b-4fb5-9379-c49ac8ade1c4`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F273 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1493`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `ec62532d-4669-47a4-a628-a38ba1875f7e`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F274 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1518`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `fc770362-4081-4669-bc7c-8d6132bf4612`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F275 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1583`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `6f860cd3-1946-48ec-b097-e9d1247fb71b`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F276 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1589`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `5bfbd01d-8155-412a-ab0f-e6693a02a3c1`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F277 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1600`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `386427e1-af8e-40c9-b13d-e72e77042890`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

### F278 — Prefer `globalThis` over `window`.
- **File:** `app/renderer.js:1609`
- **Tool:** SonarQube (code-smell)
- **Severity:** minor
- **Rule:** `javascript:S7764`
- **Effort:** 2min
- **Evidence:** Prefer `globalThis` over `window`.
- **Sonar key:** `edd99cc1-f33b-48c4-8f8b-06109b2334d6`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

---

## Security hotspots (23)

### H001 — Make sure the regex used here, which is vulnerable to polynomial runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/synth_turn.py:301`
- **Rule:** `python:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `9dea93bb-e402-41c5-afc7-e0929c9398e7`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H002 — Make sure the regex used here, which is vulnerable to polynomial runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/synth_turn.py:304`
- **Rule:** `python:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `66e48daf-820a-414e-8784-8450117d1a09`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H003 — Make sure the regex used here, which is vulnerable to polynomial runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/synth_turn.py:631`
- **Rule:** `python:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `6004a92b-71ce-4d88-884c-00fc3ecf7ce8`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H004 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:43`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `ba5ff28e-24a0-4b3e-9df6-a770d74bfcf7`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H005 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:62`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `7ba57c06-3490-4b09-a1bb-09fad72565a7`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H006 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:69`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `a04269f4-816c-4a84-81c7-5d132d586f38`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H007 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:79`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `585851e1-e855-41ba-b089-b90916e29774`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H008 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:80`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `66a687af-4faa-46a1-a0eb-08978a075e99`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H009 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:81`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `4eaf7c35-7e0c-42ed-bb46-967dfffe7428`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H010 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:86`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `6b892e63-443b-4a00-9c69-f45dd6aa7e90`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H011 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `app/lib/text.js:87`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `0a2e4c94-db1b-4864-ab09-b3f5940ee9d1`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H012 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `scripts/generate-tokens-css.cjs:91`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `fa585541-4b26-4309-aa97-38ba2a119133`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H013 — Make sure the regex used here, which is vulnerable to super-linear runtime due to backtracking, cannot lead to denial of service.
- **File:** `scripts/render-mocks.cjs:97`
- **Rule:** `javascript:S5852`
- **Vulnerability probability:** MEDIUM
- **Security category:** dos
- **Sonar key:** `aee37b9b-164e-4657-9dbe-c406e974b06b`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H014 — Make sure that using this pseudorandom number generator is safe here.
- **File:** `app/renderer.js:86`
- **Rule:** `javascript:S2245`
- **Vulnerability probability:** MEDIUM
- **Security category:** weak-cryptography
- **Sonar key:** `94c3df08-e02e-436b-b7c4-4351801b0a05`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H015 — Make sure that using this pseudorandom number generator is safe here.
- **File:** `app/renderer.js:1018`
- **Rule:** `javascript:S2245`
- **Vulnerability probability:** MEDIUM
- **Security category:** weak-cryptography
- **Sonar key:** `5db8db85-9d8a-4df6-a01e-4014be374763`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H016 — Make sure that using this pseudorandom number generator is safe here.
- **File:** `docs/ui-kit/mock-ipc.js:138`
- **Rule:** `javascript:S2245`
- **Vulnerability probability:** MEDIUM
- **Security category:** weak-cryptography
- **Sonar key:** `51957968-effc-4b54-b3c8-7e6d3d3e8256`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H017 — Make sure that using this pseudorandom number generator is safe here.
- **File:** `docs/ui-kit/mock-ipc.js:367`
- **Rule:** `javascript:S2245`
- **Vulnerability probability:** MEDIUM
- **Security category:** weak-cryptography
- **Sonar key:** `4ad53028-782a-4476-851f-c0d54b7c9e1a`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H018 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `app/main.js:686`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `628dea8d-ffce-490d-8224-804358ce0976`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H019 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `app/main.js:766`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `0d31dd9c-d2e4-4344-99b0-58a047cf9c93`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H020 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `app/main.js:1562`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `9aa946de-eace-4178-b9e9-b8c00facd6fd`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H021 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `app/main.js:1578`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `8aea4298-500c-4bb6-b5ce-05aa4452c3e3`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H022 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `app/main.js:1611`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `c10b25cb-c510-4eda-abd2-521ae7318b91`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept

### H023 — Make sure the "PATH" variable only contains fixed, unwriteable directories.
- **File:** `scripts/verify-voices.cjs:22`
- **Rule:** `javascript:S4036`
- **Vulnerability probability:** LOW
- **Security category:** others
- **Sonar key:** `bf74e7e9-aabe-42bb-be44-23674c7f12df`
- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept


---

# Triage — 2026-04-20 (post-baseline-scan review by Ben + me)

Every bug and hotspot below has been read-in-context. Dispositions have been decided with explicit rationale. Fixes will land in a batch commit before the S2 (ESLint) scan so the follow-up sees a clean slate.

## Bugs — triage

| # | Disposition | Rationale |
|---|---|---|
| **F001** | **fix** | `scripts/verify-voices.cjs:36` — `voices.edge.sort()` against voice-ID strings; locale-aware `localeCompare` is correct. |
| **F002** | **fix** | `app/lib/session-stale.js:44` — `stale.sort()` against short-IDs; should be explicit comparator. Pure function, trivial fix + covered by existing tests. |
| **F003** | **accept** | `app/lib/text.js:97` control-char in regex is **intentional**. Line 45 writes `\u0000CB<n>\u0000` as a sentinel token around preserved code blocks; line 97 matches the same sentinel to restore them. Null-byte sentinels guarantee no real markdown text ever collides with the placeholder. Adding a `// NOSONAR: intentional null-byte sentinel — see line 45` comment. |
| **F004** | **accept** | Same as F003 — Sonar is flagging the same location twice. Single NOSONAR suffices. |
| **F005** | **fix** | `scripts/wallpaper.html:2` — add `<html lang="en">`. One-line fix. |
| **F006** | **fix** | `scripts/wallpaper.html:3` — add `<title>Terminal Talk wallpaper</title>`. One-line fix. |
| **F007** | **fix** | `docs/ui-kit/index.html:2` — add `<html lang="en">`. |
| **F008** | **fix** | `app/index.html:2` — add `<html lang="en">`. |
| **F009** | **fix** | `app/index.html:133` — the `<table>` is `#sessionsTable` built at runtime by `renderer.js`. Add `<th scope="col">` elements for accessibility (empty by default, filled per-session-row semantics via renderer). |

**Bug triage summary:** 7 fix (trivial one-liners totalling ~15 min), 2 accept (intentional design — null-byte sentinel in text.js; single mechanical decision covers both F003 and F004).

## Hotspots — triage

All 23 reviewed in context. Grouped by category. Each has a final disposition + rationale.

### ReDoS (13 hotspots, all `S5852` regex-backtracking) — **accept with rationale**

Files: `app/lib/text.js` (lines 43, 62, 69, 79-81, 86-87), `app/synth_turn.py` (lines 301, 304, 631), `scripts/generate-tokens-css.cjs:91`, `scripts/render-mocks.cjs:97`.

**Analysis:** every flagged regex falls into one of three buckets:
1. **Markdown parsers with non-greedy or negated-class quantifiers** (e.g. `[\s\S]*?` between code fences, `[^\]]+` in link text, `[^`]+` in inline code). These are standard markdown extraction patterns; the non-greedy + negated-class shape makes catastrophic backtracking mathematically impossible.
2. **Line-anchored regexes** with `^…$/gm` plus specific literal or class start (headings, bullet markers, shell prompts). Line anchors bound backtracking to per-line scope.
3. **Build-time scripts** (`generate-tokens-css.cjs`, `render-mocks.cjs`) operate on repo-authored source files that we control. Zero attacker surface.

**Additional guards already in place:**
- `app/synth_turn.py` wraps synthesis in a `SYNTH_TIMEOUT_SEC = 15` per-sentence timeout, a 30s per-turn timeout, and a 45s hard cap for clipboard spawns. Even if a pathological regex existed, the timeout kills the process.
- Input source is the user's own Claude Code transcript. Threat model (`docs/architecture/ipc-integrity.md` D2-4): same-user trust boundary. An "attacker" capable of feeding malicious Claude responses already has terminal access.

**Disposition:** all 13 marked **resolve-as-reviewed** in the Sonar UI. No code changes. Rationale recorded here.

### Weak cryptography (4 hotspots, all `S2245` Math.random) — **accept with rationale**

- **H014** `app/renderer.js:86` — picks a random spinner verb for the mascot thinking animation ("Musing", "Pondering"). UI cosmetic.
- **H015** `app/renderer.js:1018` — timing jitter for when the next spinner verb floats up (650ms random range). UI cosmetic.
- **H016** `docs/ui-kit/mock-ipc.js:138` — fake mtime jitter in demo clip filenames. Kit demo only, never ships in product.
- **H017** `docs/ui-kit/mock-ipc.js:367` — picks a random session ID when the demo's "+ Add fake clip" button fires. Kit demo only.

**Disposition:** all 4 marked **resolve-as-reviewed**. No security context — Math.random is exactly the right primitive for cosmetic jitter and demo fake-data.

### PATH spawn (6 hotspots, all `S4036`) — **document + partial fix**

Files: `app/main.js` lines 686, 766, 1562, 1578, 1611; `scripts/verify-voices.cjs:22`.

**Analysis:** these all `spawn()`/`execFileSync()` using short command names that resolve via PATH — `python`, `powershell`, `taskkill`. On Windows, PATH is user-writable, so a malicious earlier PATH entry could shadow the real binary.

**Threat model:** this matches the same-user trust boundary documented in D2-4. An attacker who can rewrite the user's PATH has local code exec as that user and can already exfiltrate:
- The safeStorage-encrypted API key (reading DPAPI as the same user)
- The config sidecar (`config.secrets.json`)
- Browser session cookies, password manager state, etc.

Preventing PATH hijack against a code-exec-already attacker is defence theatre — the same argument we reached for IPC integrity in D2-4.

**Partial hardening still worth shipping** (separate v0.4 session):
- **`taskkill` + `powershell`** live in `C:\Windows\System32\` on every Windows install. These can use absolute paths (`C:\Windows\System32\taskkill.exe`) without any user-environment discovery cost. Zero compat risk.
- **`python`** is installed in user-space and varies (system Python, venv, conda, Store install). Resolving absolute path reliably requires `where python` at startup + caching, OR `install.ps1` recording the path in config.json. Either is ~2 h of careful work.

**Disposition:**
- All 6 marked **resolve-as-reviewed** in the Sonar UI with rationale below.
- New task filed for v0.4: **Resolve absolute paths for `taskkill` / `powershell`** (low-risk, high-symbol-clarity hardening — Windows-System32 binaries can't move). Python path resolution parked for the same follow-up session as it's more invasive.
- `SECURITY.md` updated (in a subsequent commit) to state the same-user trust model explicitly, with D2-4 cross-reference.

## Triage summary

| Category | Count | Fix | Accept | Reviewed-only |
|---|---|---|---|---|
| Bugs | 9 | 7 | 2 | — |
| ReDoS hotspots | 13 | — | — | 13 |
| Weak-crypto hotspots | 4 | — | — | 4 |
| PATH-spawn hotspots | 6 | — | — (follow-up v0.4 task) | 6 |
| **Total** | **32** | **7** | **2** | **23** |

**Immediate fix work:** 7 bug one-liners + 2 NOSONAR annotations. ~20 min.
**Follow-up (not v0.3.10):** absolute-path hardening for `taskkill`/`powershell`/`python`. Separate design session.
**No action:** 23 hotspots closed via Sonar UI "reviewed" with rationale above.

Next: all 7 fixable bugs land in a single commit, followed by `npm run sonar` re-run and API call to bulk-resolve hotspots. Then S2 ESLint baseline.
