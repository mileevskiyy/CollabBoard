# CollabBoard — portfolio wording

## CV

**CollabBoard — real-time collaborative Kanban workspace** | React, TypeScript, Node.js, Express, SQLite, SSE

- Built a multi-session task board with comments, assignments, due dates, drag-and-drop ordering and server-enforced work-in-progress limits.
- Implemented owner/editor/viewer permissions, expiring single-use invitations and immediate revocation of active live subscriptions.
- Protected edits and moves with card versions, canonical request fingerprints and transactional mutation receipts; designed revision-based SSE invalidation and reconnect resynchronization.
- Developed domain, HTTP/SSE integration and multi-browser tests covering stale edits, authorization, invitation reuse, rollback and shared board updates.

## LinkedIn project description

CollabBoard is a full-stack shared Kanban workspace for coordinating a small project. Users can organize cards, add context through comments, assign tasks and compare the same board from independent browser sessions. The interface uses a graphite canvas, coloured cards and a compact workspace layout.

The engineering focus is consistent collaboration. Card versions prevent an obsolete form from overwriting newer work, while idempotent request receipts prevent retrying a committed operation from creating another effect. Work-in-progress limits are checked in the same SQLite transaction as placement, activity and revision updates.

Live updates use SSE revision hints and authorized snapshot refreshes. Reconnecting clients can resume retained revisions or request a full resync, and removed members lose both future API access and existing event streams. Roles and expiring invitation capabilities are enforced on the server; the demo uses anonymous identities rather than production account management.

## Interview discussion points

- Why use SSE invalidations with HTTP commands instead of sending full snapshots or choosing WebSockets?
- How do request idempotency and optimistic card versions solve different problems?
- Why can two separate cards be edited without requiring the same global board revision?
- How can a stale network response undo a newer UI snapshot, and how does the client prevent it?
- Why does revoking an invitation differ from removing a member?
- Why must invitation consumption, membership and activity be committed together?
- How would the event broker and SQLite aggregate change for multiple server instances?

Describe the implemented behavior and its tested boundaries. Do not claim real team adoption, production scale, verified user identities, CRDT merging or measured productivity improvements.
