# Architecture and invariants

## Ownership and storage

A session has a random bearer cookie, a UUID and a display name. SQLite stores the cookie digest rather than its raw value. Board membership lives in the board aggregate, and every read/write/live subscription resolves the current session and membership. Knowing a board UUID grants no access by itself.

The schema has three tables:

- `sessions`: token digest, identity ID, display name and last activity.
- `boards`: ID, expiry and a bounded JSON aggregate.
- `invites`: invitation ID and hash, target board, role, expiry and consuming identity.

An aggregate contains metadata, members, cards, comments, activity and mutation receipts. Foreign keys cascade invitation deletion when expired boards are pruned. Sessions and boards have explicit lifetimes; anonymous identity recovery is not implemented.

## Transaction boundary

A keyed mutation begins `IMMEDIATE`, resolves current access and checks a canonical actor/action/payload fingerprint against prior receipts. A matching replay returns current state without repeating the operation. A changed payload with the same request ID conflicts.

The operation then validates references, permissions, expected version and resource constraints. Card changes, activity, revision and receipt are saved in the same transaction. SQL exceptions roll back everything. Invitation creation and consumption also update their relational rows within the same transaction as board activity/membership.

The event broker is notified only after commit. Failed or replayed commands do not announce another change. Creating a session or new board is outside the keyed board mutation contract. A raw invitation secret is returned on its first successful creation response only; because it is not persisted, a replay cannot recover that secret.

## Versions and order

Card versions advance when that card's content, assignment or own placement changes. Comments are separate records and do not invalidate content versions. Normalizing neighboring positions during a move does not advance their versions; insert-before semantics use the current destination order under the transaction lock.

Global board revisions identify committed board changes and protect administrative settings. Content edits to separate cards may proceed without sharing the same global revision. The browser captures a card version when opening its editor and an administrative revision when opening settings; receiving a live snapshot does not silently update an unsaved draft's expected version.

## Real-time protocol

`GET /api/boards/:id/live` authorizes membership before opening an SSE response. It disables buffering and caching, then announces the current revision. If `Last-Event-ID` is supplied, retained event revisions after that cursor are replayed. A cursor outside retention produces `resync` instead.

Normal `change` messages carry only a revision hint. Clients refresh the current snapshot with their own credentials; an owner's `me` field or CSRF token is never broadcast to other clients. The client coalesces short bursts, ignores older snapshots for its current board and discards refreshes from an abandoned subscription.

Events and snapshots can overlap or be delivered more than once. This protocol converges on current state rather than reconstructing historical document state. It does not merge simultaneous text edits or claim exactly-once delivery.

Connections are checked again before each publication and every 15 seconds. Removing a member produces a `revoked` message and closes their active streams. Role changes trigger a normal refresh so controls reflect read-only access; the API enforces the role regardless of visible controls.

## Invitations

Invite secrets have 192 random bits and are stored only as SHA-256 digests. A new invite chooses editor/viewer, expires in at most one hour and can be consumed by one identity. An already joined member can revisit their valid link without adding a duplicate membership. A removed member cannot use a previously consumed token to rejoin.

Consumption verifies expiry, usage, membership and roster capacity before atomically recording the user and member. A rejected full-roster join does not consume the link. Revoke blocks future joins; it does not remove a person who already joined. The owner uses member removal for that.

## API

| Method       | Path                                  | Purpose                                       |
| ------------ | ------------------------------------- | --------------------------------------------- |
| GET          | `/api/health`                         | Health                                        |
| GET / POST   | `/api/session`                        | Read/create anonymous session                 |
| GET / POST   | `/api/boards`                         | List accessible boards / create sample board  |
| GET / PUT    | `/api/boards/:id`                     | Read snapshot / owner metadata and WIP update |
| GET          | `/api/boards/:id/live`                | Authorized SSE stream                         |
| POST         | `/api/join`                           | Consume invitation                            |
| POST         | `/api/boards/:id/cards`               | Create card                                   |
| PUT / DELETE | `/api/boards/:id/cards/:cid`          | Versioned edit/delete                         |
| POST         | `/api/boards/:id/cards/:cid/move`     | Versioned move or reorder                     |
| POST         | `/api/boards/:id/cards/:cid/comments` | Add attributed comment                        |
| DELETE       | `/api/boards/:id/comments/:cid`       | Author/owner comment removal                  |
| GET / POST   | `/api/boards/:id/invites`             | Owner invite list/create                      |
| DELETE       | `/api/boards/:id/invites/:iid`        | Owner revoke                                  |
| PATCH        | `/api/boards/:id/members/:mid`        | Owner role change/removal                     |

Mutation bodies use JSON and include a request ID for board mutations. Read responses exclude receipts and raw invitation secrets. The public service is intended for sample project content in disposable sessions, rather than persistent team records.

## Scaling boundary

SQLite writes, the SSE registry and session-creation limiter are designed for one Node process. Horizontal scaling would require durable shared identities, a shared event channel, coordinated capacity enforcement and a different aggregate/storage strategy. The current limits and tests establish functional behavior, not throughput, availability or security certification.
