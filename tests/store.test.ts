import { test } from "node:test";
import { strict as a } from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
function setup() {
  let now = 1800000000000;
  const s = new Store(":memory:", () => now),
    owner = s.createSession("Board owner"),
    r = s.createBoard(owner.token);
  return {
    s,
    t: owner.token,
    bid: r.board.id,
    owner: owner.user,
    advance: (ms: number) => (now += ms),
  };
}
function addMember(
  s: Store,
  t: string,
  bid: string,
  role: "editor" | "viewer" = "editor",
  name = "Collaborator",
) {
  const person = s.createSession(name);
  const r = s.invite(t, bid, role, s.get(t, bid).board.revision, uuid());
  s.join(person.token, r.result.token);
  return person;
}
function create(s: Store, t: string, bid: string, title = "A useful idea") {
  return s.createCard(t, bid, uuid(), { title });
}
function move(
  s: Store,
  t: string,
  bid: string,
  cid: string,
  to: any,
  before: string | null = null,
) {
  const c = s.get(t, bid).board.cards.find((c) => c.id === cid)!;
  return s.move(t, bid, cid, c.version, to, before, uuid());
}
test("a fresh board has real columns, one owner and no fictional activity", () => {
  const { s, t, bid } = setup(),
    b = s.get(t, bid).board;
  a.equal(b.cards.length, 10);
  a.equal(b.members.length, 1);
  a.equal(b.events.length, 0);
  a.equal(b.cards.filter((c) => c.column === "doing").length, 2);
  a.ok(!("receipts" in b));
  s.close();
});
test("unrelated sessions cannot read or mutate a private board", () => {
  const { s, t, bid } = setup(),
    other = s.createSession("Other person");
  a.throws(() => s.get(other.token, bid), /access/);
  a.throws(() => create(s, other.token, bid), /access/);
  a.equal(s.get(t, bid).board.cards.length, 10);
  s.close();
});
test("owners and editors can create cards while viewers remain read-only", () => {
  const { s, t, bid } = setup(),
    editor = addMember(s, t, bid),
    viewer = addMember(s, t, bid, "viewer", "Reader");
  create(s, editor.token, bid);
  a.throws(() => create(s, viewer.token, bid), /Viewers/);
  a.equal(s.get(viewer.token, bid).board.cards.length, 11);
  s.close();
});
test("viewers and editors cannot create invites or change board settings", () => {
  const { s, t, bid } = setup(),
    editor = addMember(s, t, bid);
  a.throws(
    () =>
      s.invite(
        editor.token,
        bid,
        "viewer",
        s.get(t, bid).board.revision,
        uuid(),
      ),
    /owner/,
  );
  a.throws(
    () =>
      s.updateBoard(editor.token, bid, s.get(t, bid).board.revision, uuid(), {
        title: "Changed",
      }),
    /owner/,
  );
  s.close();
});
test("single-use invite is consumed once, supports existing-member replay and rejects another person", () => {
  const { s, t, bid } = setup(),
    r = s.invite(t, bid, "editor", 0, uuid()),
    one = s.createSession("First guest"),
    two = s.createSession("Second guest");
  s.join(one.token, r.result.token);
  const rev = s.get(t, bid).board.revision;
  a.equal(s.join(one.token, r.result.token).replayed, true);
  a.equal(s.get(t, bid).board.revision, rev);
  a.throws(() => s.join(two.token, r.result.token), /already used/);
  s.close();
});
test("revocation and expiry invalidate invitation capabilities", () => {
  const { s, t, bid, advance } = setup(),
    r = s.invite(t, bid, "viewer", 0, uuid()),
    guest = s.createSession("Guest");
  s.revokeInvite(t, bid, r.result.id, uuid());
  a.throws(() => s.join(guest.token, r.result.token), /invalid/);
  const next = s.invite(t, bid, "viewer", s.get(t, bid).board.revision, uuid());
  advance(3600001);
  a.throws(() => s.join(guest.token, next.result.token), /expired/);
  s.close();
});
test("removing a member prevents rejoining with an already consumed invite", () => {
  const { s, t, bid } = setup(),
    person = s.createSession("Guest"),
    r = s.invite(t, bid, "editor", 0, uuid());
  s.join(person.token, r.result.token);
  s.member(
    t,
    bid,
    person.user.id,
    "remove",
    s.get(t, bid).board.revision,
    uuid(),
  );
  a.throws(() => s.get(person.token, bid), /access/);
  a.throws(() => s.join(person.token, r.result.token), /consumed/);
  s.close();
});
test("only invite hashes are stored; snapshots never expose invitation secrets or mutation receipts", () => {
  const { s, t, bid } = setup(),
    r = s.invite(t, bid, "editor", 0, uuid());
  const rows = s.db.prepare("SELECT * FROM invites").all();
  a.ok(!JSON.stringify(rows).includes(r.result.token));
  a.ok(!JSON.stringify(s.get(t, bid)).includes(r.result.token));
  a.ok(!("receipts" in s.get(t, bid).board));
  s.close();
});
test("replayed card creation is idempotent and a changed payload conflicts", () => {
  const { s, t, bid } = setup(),
    key = uuid(),
    r = s.createCard(t, bid, key, { title: "One task" });
  const again = s.createCard(t, bid, key, { title: "One task" });
  a.equal(again.replayed, true);
  a.equal(again.cardId, r.cardId);
  a.equal(again.board.cards.length, 11);
  a.equal(again.board.revision, 1);
  a.throws(
    () => s.createCard(t, bid, key, { title: "Different" }),
    /request ID/,
  );
  s.close();
});
test("a stale card edit conflicts without losing the newer value", () => {
  const { s, t, bid } = setup(),
    r = create(s, t, bid),
    c = r.board.cards.find((c) => c.id === r.cardId)!;
  s.editCard(t, bid, c.id, c.version, uuid(), { title: "The new value" });
  a.throws(
    () => s.editCard(t, bid, c.id, c.version, uuid(), { title: "Lost update" }),
    /another window/,
  );
  a.equal(
    s.get(t, bid).board.cards.find((x) => x.id === c.id)?.title,
    "The new value",
  );
  s.close();
});
test("changes to different cards do not require the same global board revision", () => {
  const { s, t, bid } = setup(),
    b = s.get(t, bid).board;
  for (const c of b.cards.slice(0, 2))
    s.editCard(t, bid, c.id, c.version, uuid(), {
      title: c.title + " updated",
    });
  a.equal(s.get(t, bid).board.revision, 2);
  s.close();
});
test("work-in-progress limits admit one remaining slot and reject the next move atomically", () => {
  const { s, t, bid } = setup(),
    cards = s.get(t, bid).board.cards.filter((c) => c.column === "backlog");
  move(s, t, bid, cards[0].id, "doing");
  const before = s.get(t, bid);
  a.throws(() => move(s, t, bid, cards[1].id, "doing"), /limit/);
  a.deepEqual(s.get(t, bid), before);
  s.close();
});
test("reordering within a full column remains allowed and keeps dense positions", () => {
  const { s, t, bid } = setup(),
    backlog = s.get(t, bid).board.cards.filter((c) => c.column === "backlog");
  move(s, t, bid, backlog[0].id, "doing");
  const doing = s
    .get(t, bid)
    .board.cards.filter((c) => c.column === "doing")
    .sort((a, b) => a.position - b.position);
  const r = move(s, t, bid, doing[2].id, "doing", doing[0].id);
  a.deepEqual(
    r.board.cards
      .filter((c) => c.column === "doing")
      .sort((a, b) => a.position - b.position)
      .map((c) => c.position),
    [0, 1, 2],
  );
  a.equal(r.board.cards.find((c) => c.id === doing[2].id)?.position, 0);
  s.close();
});
test("moves cannot use a target in another column or resurrect an old card version", () => {
  const { s, t, bid } = setup(),
    b = s.get(t, bid).board,
    c = b.cards[0],
    other = b.cards.find((x) => x.column === "done")!;
  a.throws(
    () => s.move(t, bid, c.id, c.version, "backlog", other.id, uuid()),
    /drop target/,
  );
  move(s, t, bid, c.id, "done");
  a.throws(
    () => s.move(t, bid, c.id, c.version, "review", null, uuid()),
    /another window/,
  );
  s.close();
});
test("comments preserve actor identity and do not invalidate a content edit version", () => {
  const { s, t, bid } = setup(),
    person = addMember(s, t, bid),
    c = s.get(t, bid).board.cards[0];
  s.comment(person.token, bid, c.id, uuid(), "A helpful question");
  const b = s.get(t, bid).board;
  a.equal(b.cards.find((x) => x.id === c.id)?.version, c.version);
  a.equal(b.comments[0].authorId, person.user.id);
  a.equal(b.comments[0].authorName, "Collaborator");
  s.editCard(t, bid, c.id, c.version, uuid(), { title: "An independent edit" });
  s.close();
});
test("only comment author or owner can moderate comments", () => {
  const { s, t, bid } = setup(),
    one = addMember(s, t, bid),
    two = addMember(s, t, bid, "editor", "Other editor"),
    c = s.get(t, bid).board.cards[0];
  s.comment(one.token, bid, c.id, uuid(), "Context");
  const comment = s.get(t, bid).board.comments[0];
  a.throws(
    () => s.deleteComment(two.token, bid, comment.id, uuid()),
    /own comments/,
  );
  s.deleteComment(t, bid, comment.id, uuid());
  a.equal(s.get(t, bid).board.comments.length, 0);
  s.close();
});
test("removing an assignee clears assignments and advances affected card versions", () => {
  const { s, t, bid } = setup(),
    guest = addMember(s, t, bid),
    c = s.get(t, bid).board.cards[0];
  const r = s.editCard(t, bid, c.id, c.version, uuid(), {
      title: c.title,
      assigneeId: guest.user.id,
    }),
    version = r.board.cards.find((x) => x.id === c.id)!.version;
  s.member(t, bid, guest.user.id, "remove", r.board.revision, uuid());
  const updated = s.get(t, bid).board.cards.find((x) => x.id === c.id)!;
  a.equal(updated.assigneeId, null);
  a.equal(updated.version, version + 1);
  s.close();
});
test("owner cannot be demoted or removed, and stale administrative updates conflict", () => {
  const { s, t, bid, owner } = setup();
  a.throws(() => s.member(t, bid, owner.id, "remove", 0, uuid()), /owner/);
  create(s, t, bid);
  a.throws(
    () => s.updateBoard(t, bid, 0, uuid(), { title: "Stale" }),
    /changed/,
  );
  a.throws(
    () =>
      s.updateBoard(t, bid, 1, uuid(), {
        title: "Too small",
        limits: { doing: 1, review: 2 },
      }),
    /Move cards/,
  );
  s.close();
});
test("deleting a card removes its conversation but keeps activity evidence and request identities", () => {
  const { s, t, bid } = setup(),
    r = create(s, t, bid),
    c = r.board.cards.find((x) => x.id === r.cardId)!;
  s.comment(t, bid, c.id, uuid(), "Context");
  s.deleteCard(t, bid, c.id, c.version, uuid());
  const b = s.get(t, bid).board;
  a.ok(!b.cards.some((x) => x.id === c.id));
  a.ok(!b.comments.some((x) => x.cardId === c.id));
  a.equal(b.events.at(-1)?.kind, "card.deleted");
  s.close();
});
test("database failure rolls back card, activity, receipt and revision", () => {
  const { s, t, bid } = setup(),
    before = s.get(t, bid);
  s.db.exec(
    "CREATE TRIGGER fail_write BEFORE UPDATE OF payload ON boards BEGIN SELECT RAISE(ABORT,'forced'); END",
  );
  a.throws(() => create(s, t, bid), /forced/);
  a.deepEqual(s.get(t, bid), before);
  s.close();
});
test("failed invite write cannot leave a usable orphan capability", () => {
  const { s, t, bid } = setup();
  s.db.exec(
    "CREATE TRIGGER fail_write BEFORE UPDATE OF payload ON boards BEGIN SELECT RAISE(ABORT,'forced'); END",
  );
  a.throws(() => s.invite(t, bid, "editor", 0, uuid()), /forced/);
  a.equal(
    (s.db.prepare("SELECT count(*) AS n FROM invites").get() as any).n,
    0,
  );
  s.close();
});
test("display content is validated and non-member assignees are rejected", () => {
  const { s, t, bid } = setup();
  a.throws(() => create(s, t, bid, "  "));
  a.throws(() =>
    s.createCard(t, bid, uuid(), { title: "x", dueDate: "2026-02-31" }),
  );
  a.throws(
    () => s.createCard(t, bid, uuid(), { title: "x", assigneeId: uuid() }),
    /member/,
  );
  s.close();
});
test("boards have a fixed 24h lifetime independent of subsequent activity", () => {
  const { s, t, bid, advance } = setup();
  advance(23 * 3600000);
  s.get(t, bid);
  advance(3600001);
  a.throws(() => s.get(t, bid), /expired/);
  s.close();
});
test("optional file storage retains memberships and tasks after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "collabboard-"));
  try {
    let s = new Store(join(dir, "board.sqlite"));
    const { token } = s.createSession("Owner");
    const bid = s.createBoard(token).board.id;
    create(s, token, bid, "Persisted card");
    s.close();
    s = new Store(join(dir, "board.sqlite"));
    a.ok(
      s.get(token, bid).board.cards.some((c) => c.title === "Persisted card"),
    );
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("activity truncation does not discard request identities or allow duplicate old actions", () => {
  const { s, t, bid } = setup(),
    key = uuid(),
    first = s.createCard(t, bid, key, { title: "Keep this identity" });
  let c = first.board.cards.find((c) => c.id === first.cardId)!;
  for (let i = 0; i < 205; i++) {
    const r = s.editCard(t, bid, c.id, c.version, uuid(), {
      title: "Revision " + i,
    });
    c = r.board.cards.find((x) => x.id === c.id)!;
  }
  const b = s.get(t, bid).board;
  a.equal(b.events.length, 200);
  a.ok(b.events[0].id > 1);
  a.equal(
    s.createCard(t, bid, key, { title: "Keep this identity" }).replayed,
    true,
  );
  a.equal(s.get(t, bid).board.cards.length, 11);
  s.close();
});
test("a full roster rejects another join without consuming its invitation", () => {
  const { s, t, bid } = setup();
  for (let i = 0; i < 11; i++) addMember(s, t, bid, "viewer", "Guest " + i);
  const r = s.invite(t, bid, "viewer", s.get(t, bid).board.revision, uuid()),
    guest = s.createSession("Extra guest");
  a.throws(() => s.join(guest.token, r.result.token), /12 members/);
  a.equal(
    (
      s.db
        .prepare("SELECT used_by FROM invites WHERE id=?")
        .get(r.result.id) as any
    ).used_by,
    null,
  );
  s.close();
});
