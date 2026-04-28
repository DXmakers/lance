# #143 — UI: Add Rich Text Editor for Descriptions

Summary
-------

This change implements a lightweight, accessible Rich Text Editor for job descriptions and integrates it into the job creation flow.

What was done
--------------
- Added `RichTextEditor` component used in the `jobs/new` page
- Added Zod validation for job creation payloads
- Added a unit test for the editor (`components/ui/__tests__/rich-text-editor.test.tsx`)
- Fixed a Next.js prerendering issue by forcing dynamic rendering in the root layout
- Installed required test dependencies and verified the new unit test passes
- Verified E2E tests locally after installing Playwright browsers

Status
------

- Build: successful for `apps/web` (local)
- Unit tests: editor unit test passes (Vitest)
- E2E tests: Playwright run succeeded locally

References
----------

Commit/Branch: `143-ui-add-rich-text-editor-for-descriptions`

This file and the commit include the text `Fixes #143` so the issue will be closed when the PR is merged into `main`.
