import { DatabaseSync } from "node:sqlite";
import { randomUUID as uuid, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  assert,
  canonical,
  cardInput,
  boardInput,
  type Board,
  type Card,
  type Column,
  type Role,
  type User,
  type Event,
} from "./model.ts";
import { seed } from "./seed.ts";
export class Store {
  db: DatabaseSync;
  constructor(
    path = ":memory:",
    private clock = () => Date.now(),
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,touched INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY,expires INTEGER NOT NULL,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,role TEXT NOT NULL,expires INTEGER NOT NULL,used_by TEXT);`,
    );
  }
  hash(v: string) {
    return createHash("sha256").update(v).digest("hex");
  }
  prune() {
    this.db.prepare("DELETE FROM boards WHERE expires<?").run(this.clock());
    this.db
      .prepare("DELETE FROM sessions WHERE touched<?")
      .run(this.clock() - 86400000);
    this.db.prepare("DELETE FROM invites WHERE expires<?").run(this.clock());
  }
  session(token: string, touch = true): User {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token=?")
      .get(this.hash(token)) as any;
    assert(
      row && row.touched >= this.clock() - 86400000,
      401,
      "Your demo session expired. Open a fresh demo to continue.",
    );
    if (touch)
      this.db
        .prepare("UPDATE sessions SET touched=? WHERE token=?")
        .run(this.clock(), this.hash(token));
    return { id: row.id, name: row.name };
  }
  createSession(raw: unknown) {
    const name = z.string().trim().min(2).max(30).parse(raw);
    this.prune();
    assert(
      Number(
        (this.db.prepare("SELECT count(*) AS n FROM sessions").get() as any).n,
      ) < 500,
      503,
      "The demo is busy. Please try later.",
    );
    const token = randomBytes(32).toString("base64url"),
      user = { id: uuid(), name };
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .run(this.hash(token), user.id, name, this.clock());
    return { token, user };
  }
  raw(id: string): Board {
    const row = this.db
      .prepare("SELECT * FROM boards WHERE id=?")
      .get(id) as any;
    assert(
      row && row.expires >= this.clock(),
      404,
      "This board no longer exists or has expired.",
    );
    return JSON.parse(row.payload);
  }
  access(
    token: string,
    id: string,
    role: "read" | "edit" | "owner" = "read",
    touch = true,
  ) {
    const user = this.session(token, touch),
      board = this.raw(id),
      member = board.members.find((m) => m.id === user.id);
    assert(member, 403, "You no longer have access to this board.");
    assert(
      role !== "owner" || member.role === "owner",
      403,
      "Only the board owner can do that.",
    );
    assert(
      role !== "edit" || member.role !== "viewer",
      403,
      "Viewers can read this board. Ask the owner for edit access.",
    );
    return { user, board, member };
  }
  snapshot(board: Board, user: User) {
    const { receipts, ...publicBoard } = board;
    return {
      me: user,
      role: board.members.find((m) => m.id === user.id)!.role,
      board: publicBoard,
    };
  }
  get(token: string, id: string) {
    const { board, user } = this.access(token, id);
    return this.snapshot(board, user);
  }
  list(token: string) {
    const user = this.session(token);
    return (
      this.db
        .prepare("SELECT payload FROM boards WHERE expires>=?")
        .all(this.clock()) as any[]
    )
      .map((row) => JSON.parse(row.payload) as Board)
      .filter((b) => b.members.some((m) => m.id === user.id))
      .map((b) => ({
        id: b.id,
        title: b.title,
        role: b.members.find((m) => m.id === user.id)!.role,
      }));
  }
  budget(board: Board) {
    const payload = JSON.stringify(board);
    assert(
      Buffer.byteLength(payload) < 1536 * 1024,
      422,
      "This board is full. Start a new demo board.",
    );
    const other = (
      this.db
        .prepare(
          "SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) AS n FROM boards WHERE id<>?",
        )
        .get(board.id) as any
    ).n;
    assert(
      Number(other) + Buffer.byteLength(payload) < 48 * 1024 * 1024,
      503,
      "The demo is busy. Please try later.",
    );
    return payload;
  }
  createBoard(token: string, title = "Website refresh") {
    const user = this.session(token);
    this.prune();
    assert(
      this.list(token).length < 8,
      422,
      "A demo session can belong to at most eight boards.",
    );
    assert(
      Number(
        (this.db.prepare("SELECT count(*) AS n FROM boards").get() as any).n,
      ) < 100,
      503,
      "The demo is busy. Please try later.",
    );
    const board = seed(
      user,
      this.clock(),
      z.string().trim().min(2).max(70).parse(title),
    );
    this.db
      .prepare("INSERT INTO boards VALUES (?,?,?)")
      .run(board.id, board.expiresAt, this.budget(board));
    return this.snapshot(board, user);
  }
  mutate(
    token: string,
    id: string,
    role: "edit" | "owner",
    action: string,
    key: string,
    payload: unknown,
    fn: (
      b: Board,
      u: User,
      now: number,
    ) => { kind: string; text: string; cardId?: string; result?: any },
  ) {
    z.string().uuid().parse(key);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const { board, user } = this.access(token, id, role);
      const fingerprint = this.hash(
        canonical({ actor: user.id, action, payload }),
      );
      const receipt = board.receipts.find((r) => r.key === key);
      if (receipt) {
        assert(
          receipt.fingerprint === fingerprint,
          409,
          "That request ID was already used for a different change.",
        );
        this.db.exec("COMMIT");
        return {
          ...this.snapshot(board, user),
          replayed: true,
          cardId: receipt.cardId,
        };
      }
      assert(
        board.receipts.length < 2000,
        422,
        "This demo board reached its change limit. Start a fresh board.",
      );
      const event = fn(board, user, this.clock());
      board.revision++;
      board.events.push({
        id: board.revision,
        at: this.clock(),
        actorId: user.id,
        actorName: user.name,
        kind: event.kind,
        text: event.text,
        ...(event.cardId ? { cardId: event.cardId } : {}),
      });
      board.events = board.events.slice(-200);
      board.receipts.push({
        key,
        fingerprint,
        ...(event.cardId ? { cardId: event.cardId } : {}),
      });
      this.db
        .prepare("UPDATE boards SET payload=? WHERE id=?")
        .run(this.budget(board), board.id);
      this.db.exec("COMMIT");
      return {
        ...this.snapshot(board, user),
        replayed: false,
        cardId: event.cardId,
        ...(event.result ? { result: event.result } : {}),
      };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  card(b: Board, id: string, version?: number) {
    const c = b.cards.find((c) => c.id === id);
    assert(c, 404, "This card was removed.");
    if (version !== undefined)
      assert(
        c.version === version,
        409,
        "This card changed in another window. Close it and reopen the latest version.",
      );
    return c;
  }
  validAssignee(b: Board, id: string | null) {
    assert(
      id === null || b.members.some((m) => m.id === id),
      422,
      "Choose a current board member as assignee.",
    );
  }
  createCard(token: string, bid: string, key: string, raw: unknown) {
    const input = cardInput.parse(raw);
    return this.mutate(
      token,
      bid,
      "edit",
      "card.create",
      key,
      input,
      (b, u, now) => {
        assert(
          b.cards.length < 120,
          422,
          "This demo board can contain up to 120 cards.",
        );
        this.validAssignee(b, input.assigneeId);
        const c: Card = {
          ...input,
          id: uuid(),
          number: b.nextNumber++,
          column: "backlog",
          position: b.cards.filter((c) => c.column === "backlog").length,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        b.cards.push(c);
        return {
          kind: "card.created",
          text: `created CB-${c.number}: ${c.title}`,
          cardId: c.id,
        };
      },
    );
  }
  editCard(
    token: string,
    bid: string,
    cid: string,
    version: number,
    key: string,
    raw: unknown,
  ) {
    const input = cardInput.parse(raw);
    return this.mutate(
      token,
      bid,
      "edit",
      "card.edit",
      key,
      { cid, version, ...input },
      (b, u, now) => {
        const c = this.card(b, cid, version);
        this.validAssignee(b, input.assigneeId);
        Object.assign(c, input, { version: c.version + 1, updatedAt: now });
        return {
          kind: "card.edited",
          text: `updated CB-${c.number}: ${c.title}`,
          cardId: cid,
        };
      },
    );
  }
  move(
    token: string,
    bid: string,
    cid: string,
    version: number,
    to: Column,
    before: string | null,
    key: string,
  ) {
    return this.mutate(
      token,
      bid,
      "edit",
      "card.move",
      key,
      { cid, version, to, before },
      (b, u, now) => {
        const c = this.card(b, cid, version);
        assert(before !== cid, 422, "Choose another card as the drop target.");
        const target = b.cards
          .filter((x) => x.column === to && x.id !== cid)
          .sort((a, b) => a.position - b.position);
        const limit = to === "doing" || to === "review" ? b.limits[to] : 0;
        assert(
          !limit || target.length < limit,
          409,
          `The ${to} column is at its work-in-progress limit (${limit}).`,
        );
        const at =
          before === null
            ? target.length
            : target.findIndex((x) => x.id === before);
        assert(at >= 0, 409, "The drop target moved. Try again.");
        const from = c.column;
        target.splice(at, 0, c);
        c.column = to;
        c.version++;
        c.updatedAt = now;
        target.forEach((x, i) => (x.position = i));
        if (from !== to)
          b.cards
            .filter((x) => x.column === from)
            .sort((a, b) => a.position - b.position)
            .forEach((x, i) => (x.position = i));
        return {
          kind: "card.moved",
          text: `moved CB-${c.number} to ${to}`,
          cardId: cid,
        };
      },
    );
  }
  deleteCard(
    token: string,
    bid: string,
    cid: string,
    version: number,
    key: string,
  ) {
    return this.mutate(
      token,
      bid,
      "edit",
      "card.delete",
      key,
      { cid, version },
      (b) => {
        const c = this.card(b, cid, version);
        b.cards = b.cards.filter((x) => x.id !== cid);
        b.comments = b.comments.filter((x) => x.cardId !== cid);
        b.cards
          .filter((x) => x.column === c.column)
          .sort((a, b) => a.position - b.position)
          .forEach((x, i) => (x.position = i));
        return {
          kind: "card.deleted",
          text: `removed CB-${c.number}: ${c.title}`,
          cardId: cid,
        };
      },
    );
  }
  comment(token: string, bid: string, cid: string, key: string, raw: unknown) {
    const body = z.string().trim().min(1).max(1000).parse(raw);
    return this.mutate(
      token,
      bid,
      "edit",
      "comment.add",
      key,
      { cid, body },
      (b, u, now) => {
        const c = this.card(b, cid);
        assert(
          b.comments.length < 500 &&
            b.comments.filter((x) => x.cardId === cid).length < 50,
          422,
          "The comment limit for this demo was reached.",
        );
        const comment = {
          id: uuid(),
          cardId: cid,
          authorId: u.id,
          authorName: u.name,
          body,
          createdAt: now,
          version: 1,
        };
        b.comments.push(comment);
        return {
          kind: "comment.added",
          text: `commented on CB-${c.number}`,
          cardId: cid,
        };
      },
    );
  }
  deleteComment(token: string, bid: string, id: string, key: string) {
    return this.mutate(
      token,
      bid,
      "edit",
      "comment.delete",
      key,
      { id },
      (b, u) => {
        const comment = b.comments.find((x) => x.id === id);
        assert(comment, 404, "This comment was removed.");
        assert(
          comment.authorId === u.id || b.ownerId === u.id,
          403,
          "You can remove your own comments.",
        );
        b.comments = b.comments.filter((x) => x.id !== id);
        return {
          kind: "comment.deleted",
          text: "removed a comment",
          cardId: comment.cardId,
        };
      },
    );
  }
  updateBoard(
    token: string,
    bid: string,
    revision: number,
    key: string,
    raw: unknown,
  ) {
    const input = boardInput.parse(raw);
    return this.mutate(
      token,
      bid,
      "owner",
      "board.update",
      key,
      { revision, ...input },
      (b) => {
        assert(
          b.revision === revision,
          409,
          "The board changed. Reopen settings before saving.",
        );
        for (const col of ["doing", "review"] as const)
          assert(
            !input.limits[col] ||
              b.cards.filter((c) => c.column === col).length <=
                input.limits[col],
            409,
            `Move cards out of ${col} before reducing its limit.`,
          );
        Object.assign(b, input);
        return {
          kind: "board.updated",
          text: "updated board details and work-in-progress limits",
        };
      },
    );
  }
  invite(
    token: string,
    bid: string,
    role: "editor" | "viewer",
    revision: number,
    key: string,
  ) {
    return this.mutate(
      token,
      bid,
      "owner",
      "invite.create",
      key,
      { role, revision },
      (b) => {
        assert(
          b.revision === revision,
          409,
          "The board changed. Refresh before creating an invite.",
        );
        assert(
          Number(
            (
              this.db
                .prepare(
                  "SELECT count(*) AS n FROM invites WHERE board_id=? AND expires>=? AND used_by IS NULL",
                )
                .get(bid, this.clock()) as any
            ).n,
          ) < 20,
          422,
          "Revoke an unused invitation before creating another.",
        );
        const token = randomBytes(24).toString("base64url"),
          invite = {
            id: uuid(),
            token,
            role,
            expires: Math.min(this.clock() + 3600000, b.expiresAt),
          };
        this.db
          .prepare("INSERT INTO invites VALUES (?,?,?,?,?,NULL)")
          .run(invite.id, this.hash(token), bid, role, invite.expires);
        return {
          kind: "invite.created",
          text: `created a single-use ${role} invitation`,
          result: invite,
        };
      },
    );
  }
  invites(token: string, bid: string) {
    this.access(token, bid, "owner");
    return this.db
      .prepare(
        "SELECT id,role,expires,used_by AS usedBy FROM invites WHERE board_id=? AND expires>=? ORDER BY expires DESC",
      )
      .all(bid, this.clock());
  }
  revokeInvite(token: string, bid: string, id: string, key: string) {
    return this.mutate(
      token,
      bid,
      "owner",
      "invite.revoke",
      key,
      { id },
      (b) => {
        const row = this.db
          .prepare("SELECT id FROM invites WHERE id=? AND board_id=?")
          .get(id, bid);
        assert(row, 404, "Invitation not found.");
        this.db.prepare("DELETE FROM invites WHERE id=?").run(id);
        return { kind: "invite.revoked", text: "revoked an invitation" };
      },
    );
  }
  join(token: string, inviteToken: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const user = this.session(token),
        invite = this.db
          .prepare("SELECT * FROM invites WHERE hash=?")
          .get(this.hash(inviteToken)) as any;
      assert(
        invite && invite.expires >= this.clock(),
        403,
        "This invitation expired, was revoked or is invalid. Ask the owner for a new link.",
      );
      const b = this.raw(invite.board_id);
      assert(
        !invite.used_by || invite.used_by === user.id,
        403,
        "This invitation was already used. Ask the owner for your own link.",
      );
      if (b.members.some((m) => m.id === user.id)) {
        this.db.exec("COMMIT");
        return { ...this.snapshot(b, user), replayed: true };
      }
      assert(
        !invite.used_by,
        403,
        "This invitation was already consumed. Ask the owner for a new link.",
      );
      assert(
        b.members.length < 12,
        422,
        "This demo board already has 12 members.",
      );
      assert(
        this.list(token).length < 8,
        422,
        "A demo session can join up to eight boards.",
      );
      b.members.push({ ...user, role: invite.role, joinedAt: this.clock() });
      b.revision++;
      b.events.push({
        id: b.revision,
        at: this.clock(),
        actorId: user.id,
        actorName: user.name,
        kind: "member.joined",
        text: `joined as ${invite.role}`,
      });
      b.events = b.events.slice(-200);
      this.db
        .prepare("UPDATE invites SET used_by=? WHERE id=?")
        .run(user.id, invite.id);
      this.db
        .prepare("UPDATE boards SET payload=? WHERE id=?")
        .run(this.budget(b), b.id);
      this.db.exec("COMMIT");
      return { ...this.snapshot(b, user), replayed: false };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  member(
    token: string,
    bid: string,
    memberId: string,
    role: "editor" | "viewer" | "remove",
    revision: number,
    key: string,
  ) {
    return this.mutate(
      token,
      bid,
      "owner",
      "member.update",
      key,
      { memberId, role, revision },
      (b, u, now) => {
        assert(
          b.revision === revision,
          409,
          "The team changed. Reopen the team panel.",
        );
        const target = b.members.find((m) => m.id === memberId);
        assert(target, 404, "This member has already left.");
        assert(
          target.id !== b.ownerId,
          422,
          "The board owner cannot be removed or demoted.",
        );
        if (role === "remove") {
          b.members = b.members.filter((m) => m.id !== memberId);
          for (const c of b.cards)
            if (c.assigneeId === memberId) {
              c.assigneeId = null;
              c.version++;
              c.updatedAt = now;
            }
        } else target.role = role;
        return {
          kind: role === "remove" ? "member.removed" : "member.updated",
          text:
            role === "remove"
              ? `removed ${target.name} from the board`
              : `changed ${target.name} to ${role}`,
        };
      },
    );
  }
  close() {
    this.db.close();
  }
}
