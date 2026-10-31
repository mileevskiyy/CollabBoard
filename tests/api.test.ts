import { test } from "node:test";
import { strict as a } from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { Store } from "../server/store.ts";
import { appFor } from "../server/app.ts";
async function setup() {
  const store = new Store(),
    { app, live } = appFor(store, { origin: "https://board.example" }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return {
      async call(
        path: string,
        method = "GET",
        body?: any,
        extra: Record<string, string> = {},
      ) {
        const response = await fetch(base + "/api" + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            cookie,
            "x-csrf-token": csrf,
            ...extra,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json();
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie")!.split(";")[0];
        if (data.csrf) csrf = data.csrf;
        return { response, data };
      },
      get headers() {
        return { cookie };
      },
      get csrf() {
        return csrf;
      },
    };
  };
  return {
    store,
    live,
    base,
    client,
    async close() {
      live.close();
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}
async function stream(base: string, path: string, headers: any) {
  const controller = new AbortController(),
    response = await fetch(base + path, { headers, signal: controller.signal });
  a.equal(response.status, 200);
  const reader = response.body!.getReader();
  let stash = "";
  return {
    async event(type: string) {
      const until = Date.now() + 2500;
      while (Date.now() < until) {
        let end;
        while ((end = stash.indexOf("\n\n")) >= 0) {
          const part = stash.slice(0, end);
          stash = stash.slice(end + 2);
          if (part.includes("event: " + type + "\n")) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            return JSON.parse(line!.slice(6));
          }
        }
        const value = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            const t = setTimeout(
              () => reject(new Error("SSE event timeout")),
              2500,
            );
            t.unref();
          }),
        ]);
        if (value.done) throw new Error("SSE stream ended");
        stash += new TextDecoder().decode(value.value);
      }
      throw new Error("SSE event timeout");
    },
    close() {
      controller.abort();
    },
  };
}

test("HTTP authentication, CSRF, origins, validation and board ownership are enforced", async () => {
  const h = await setup(),
    owner = h.client(),
    outsider = h.client();
  try {
    a.equal((await owner.call("/boards")).response.status, 401);
    a.equal(
      (
        await owner.call(
          "/session",
          "POST",
          { name: "Owner" },
          { origin: "https://evil.example" },
        )
      ).response.status,
      403,
    );
    const session = await owner.call("/session", "POST", { name: "Owner" });
    a.equal(session.response.status, 201);
    a.match(
      session.response.headers.get("set-cookie")!,
      /HttpOnly; SameSite=Strict/,
    );
    const created = await owner.call("/boards", "POST", { title: "My team" });
    a.equal(created.response.status, 201);
    const id = created.data.board.id;
    const refused = await owner.call(
      `/boards/${id}/cards`,
      "POST",
      { title: "Bad CSRF", requestId: uuid() },
      { "x-csrf-token": "bad" },
    );
    a.equal(refused.response.status, 403);
    a.equal(
      (
        await owner.call(
          `/boards/${id}/cards`,
          "POST",
          { title: "Bad origin", requestId: uuid() },
          { origin: "https://evil.example" },
        )
      ).response.status,
      403,
    );
    a.equal(
      (
        await owner.call(`/boards/${id}/cards`, "POST", {
          title: " ",
          requestId: uuid(),
        })
      ).response.status,
      422,
    );
    await outsider.call("/session", "POST", { name: "Outsider" });
    a.equal((await outsider.call(`/boards/${id}`)).response.status, 403);
    const key = uuid(),
      one = await owner.call(`/boards/${id}/cards`, "POST", {
        title: "Created once",
        requestId: key,
      });
    const two = await owner.call(`/boards/${id}/cards`, "POST", {
      title: "Created once",
      requestId: key,
    });
    a.equal(one.data.cardId, two.data.cardId);
    a.equal(two.data.replayed, true);
    a.ok(!("receipts" in two.data.board));
    a.equal(
      (
        await owner.call(`/boards/${id}/cards`, "POST", {
          title: "A".repeat(70000),
          requestId: uuid(),
        })
      ).response.status,
      413,
    );
  } finally {
    await h.close();
  }
});

test("SSE delivers cross-session changes, role enforcement and immediate revocation", async () => {
  const h = await setup(),
    owner = h.client(),
    guest = h.client();
  let events: any;
  try {
    await owner.call("/session", "POST", { name: "Owner" });
    const created = await owner.call("/boards", "POST", {
        title: "Live board",
      }),
      id = created.data.board.id;
    const invite = await owner.call(`/boards/${id}/invites`, "POST", {
      role: "editor",
      revision: 0,
      requestId: uuid(),
    });
    await guest.call("/session", "POST", { name: "Guest" });
    await guest.call("/join", "POST", { invite: invite.data.result.token });
    events = await stream(h.base, `/api/boards/${id}/live`, guest.headers);
    a.equal((await events.event("connected")).revision, 2);
    await owner.call(`/boards/${id}/cards`, "POST", {
      title: "A live change",
      requestId: uuid(),
    });
    a.equal((await events.event("change")).revision, 3);
    a.ok(
      (await guest.call(`/boards/${id}`)).data.board.cards.some(
        (c: any) => c.title === "A live change",
      ),
    );
    let board = (await owner.call(`/boards/${id}`)).data;
    const member = board.board.members.find((m: any) => m.name === "Guest");
    await owner.call(`/boards/${id}/members/${member.id}`, "PATCH", {
      role: "viewer",
      revision: board.board.revision,
      requestId: uuid(),
    });
    await events.event("change");
    a.equal(
      (
        await guest.call(`/boards/${id}/cards`, "POST", {
          title: "Forbidden",
          requestId: uuid(),
        })
      ).response.status,
      403,
    );
    board = (await owner.call(`/boards/${id}`)).data;
    await owner.call(`/boards/${id}/members/${member.id}`, "PATCH", {
      role: "remove",
      revision: board.board.revision,
      requestId: uuid(),
    });
    a.match((await events.event("revoked")).error, /removed/);
    a.equal(h.live.clients.size, 0);
    a.equal((await guest.call(`/boards/${id}`)).response.status, 403);
  } finally {
    events?.close();
    await h.close();
  }
});

test("SSE reconnect replays retained revision changes after Last-Event-ID", async () => {
  const h = await setup(),
    owner = h.client();
  let events: any;
  try {
    await owner.call("/session", "POST", { name: "Owner" });
    const id = (await owner.call("/boards", "POST", { title: "Replay board" }))
      .data.board.id;
    for (let i = 0; i < 3; i++)
      await owner.call(`/boards/${id}/cards`, "POST", {
        title: "Change " + i,
        requestId: uuid(),
      });
    events = await stream(h.base, `/api/boards/${id}/live`, {
      ...owner.headers,
      "Last-Event-ID": "1",
    });
    a.equal((await events.event("change")).revision, 2);
    a.equal((await events.event("change")).revision, 3);
    a.equal((await events.event("connected")).revision, 3);
  } finally {
    events?.close();
    await h.close();
  }
});
test("SSE emits resync when a reconnect cursor predates retained activity", async () => {
  const h = await setup(),
    owner = h.client();
  let events: any;
  try {
    await owner.call("/session", "POST", { name: "Owner" });
    const b = (
      await owner.call("/boards", "POST", { title: "Old cursor board" })
    ).data.board;
    const cookie = owner.headers.cookie.split("=")[1];
    let card = b.cards[0];
    for (let i = 0; i < 205; i++) {
      const r = h.store.editCard(cookie, b.id, card.id, card.version, uuid(), {
        title: "Change " + i,
      });
      card = r.board.cards.find((c: any) => c.id === card.id)!;
    }
    events = await stream(h.base, `/api/boards/${b.id}/live`, {
      ...owner.headers,
      "Last-Event-ID": "0",
    });
    a.equal((await events.event("resync")).revision, 205);
    a.equal((await events.event("connected")).revision, 205);
  } finally {
    events?.close();
    await h.close();
  }
});
