import type { Request, Response } from "express";
import type { Store } from "./store.ts";
import { assert } from "./model.ts";
type Client = {
  token: string;
  boardId: string;
  res: Response;
  last: number;
  stop: () => void;
};
export class Live {
  clients = new Set<Client>();
  constructor(private store: Store) {}
  subscribe(req: Request, res: Response, token: string, boardId: string) {
    const { board } = this.store.access(token, boardId);
    assert(
      this.clients.size < 80,
      429,
      "The live connection limit was reached. Reload in a moment.",
    );
    assert(
      [...this.clients].filter((c) => c.token === token).length < 4,
      429,
      "Use at most four live tabs per demo session.",
    );
    res
      .status(200)
      .set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
    res.flushHeaders();
    const send = (type: string, data: any, revision: number) => {
      res.write(
        `id: ${revision}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    };
    const header = req.get("last-event-id"),
      last = header && /^\d{1,10}$/.test(header) ? Number(header) : -1;
    if (last >= 0 && last < board.revision) {
      if (last < (board.events[0]?.id || board.revision) - 1)
        send("resync", { revision: board.revision }, board.revision);
      else
        for (const e of board.events.filter((e) => e.id > last))
          send("change", { revision: e.id, kind: e.kind }, e.id);
    }
    send("connected", { revision: board.revision }, board.revision);
    const client: Client = {
      token,
      boardId,
      res,
      last: board.revision,
      stop: () => {},
    };
    let timer: ReturnType<typeof setInterval>;
    client.stop = () => {
      clearInterval(timer);
      this.clients.delete(client);
      if (!res.writableEnded) res.end();
    };
    timer = setInterval(() => {
      try {
        this.store.access(token, boardId, "read", false);
        res.write(": keep-alive\n\n");
      } catch {
        res.write(
          'event: revoked\ndata: {"error":"Your session, membership or board expired."}\n\n',
        );
        client.stop();
      }
    }, 15000);
    timer.unref();
    this.clients.add(client);
    req.on("close", client.stop);
    res.on("error", client.stop);
  }
  publish(boardId: string) {
    const board = this.store.raw(boardId);
    for (const c of this.clients) {
      if (c.boardId !== boardId) continue;
      try {
        this.store.access(c.token, boardId, "read", false);
        if (c.last < board.revision) {
          c.res.write(
            `id: ${board.revision}\nevent: change\ndata: ${JSON.stringify({ revision: board.revision })}\n\n`,
          );
          c.last = board.revision;
        }
      } catch {
        c.res.write(
          'event: revoked\ndata: {"error":"Your board access was removed."}\n\n',
        );
        c.stop();
      }
    }
  }
  close() {
    for (const c of this.clients) c.stop();
  }
}
