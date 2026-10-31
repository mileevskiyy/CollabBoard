# Verification evidence

Verified locally on 31 October 2026 using Node.js 24 and Chromium through Playwright.

| Check                          | Observed result                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `npm test`                     | 30 passing domain and HTTP/SSE integration tests                                 |
| `npm run build`                | TypeScript checking and Vite production build pass                               |
| Collaboration browser scenario | Pass with owner, editor and viewer in independent browser contexts               |
| Drag-and-drop browser scenario | Pass, including WIP rejection and reordering within a full column                |
| Desktop inspection             | Entry, board and conversation at 1440 px width                                   |
| Mobile inspection              | Board at 390 px width; internal column scrolling with no document-level overflow |

The domain suite covers private-board access, roles, invitation consumption/revocation/expiry, consumed-invite reuse after removal, hash-only invite storage, idempotency, stale edits, independent-card writes, WIP slots, ordering, comment attribution/moderation, assignee removal, owner protection, card deletion, forced rollback, idle/fixed expiry and optional file-backed restart persistence.

HTTP/SSE tests open real server connections. They check cookies, authentication, CSRF, Origin rejection, input/body validation, cross-session change delivery, role changes, immediate stream revocation, retained `Last-Event-ID` replay and resynchronization after a cursor falls outside activity retention.

The collaboration browser scenario joins separate editor/viewer identities, propagates a created card, rejects an obsolete editor draft, reloads its latest version, shares a comment, moves the card, changes a role and removes access. The drag-and-drop scenario targets visible destination cards, confirms a full-column rejection and reorders a card within the full column.

Screenshots are `entry.png`, `board.png`, `conversation.png` and `mobile.png`. Morgan, Riley and Sam are automated-test display names, not evidence of real user adoption. The sample board starts with one actual demo owner and an empty activity history.

These checks are not load measurements, a full accessibility/security audit, or verification of production account management. The application is a bounded single-process demo with anonymous identities and disposable data.

## Published demo

Both browser scenarios passed against `https://collabboard-demo.onrender.com/` on 31 October 2026. The collaboration scenario used three independent browser contexts; the drag-and-drop scenario checked a capacity rejection, waited for the board to become draggable again and verified reordering. The initial GitHub Actions run also completed successfully for application commit `072310b`.
