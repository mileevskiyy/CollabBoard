import express from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Store } from "./store.ts";
import { Live } from "./live.ts";
import { columns, Fault } from "./model.ts";
export function appFor(
  store: Store,
  options: { origin?: string; secure?: boolean } = {},
) {
  const app = express(),
    live = new Live(store);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  const rates = new Map<string, { count: number; until: number }>();
  const cookie = (req: express.Request) =>
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("collab_session="))
      ?.slice("collab_session=".length) || "";
  const csrf = (token: string) =>
    createHash("sha256")
      .update("collab-csrf:" + token)
      .digest("hex");
  function setCookie(res: express.Response, token: string) {
    res.setHeader(
      "Set-Cookie",
      `collab_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${options.secure ? "; Secure" : ""}`,
    );
  }
  function origin(req: express.Request) {
    if (
      req.get("origin") &&
      !["http://127.0.0.1:3700", "http://127.0.0.1:3701", options.origin]
        .filter(Boolean)
        .includes(req.get("origin")!)
    )
      throw new Fault(403, "This origin is not allowed.");
  }
  app.use((req, res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      if (!req.is("application/json"))
        throw new Fault(415, "Send changes as application/json.");
      req.body ??= {};
    }
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, app: "CollabBoard" }),
  );
  app.get("/api/session", (req, res) => {
    const token = cookie(req);
    try {
      const me = store.session(token);
      setCookie(res, token);
      res.json({
        authenticated: true,
        me,
        csrf: csrf(token),
        boards: store.list(token),
      });
    } catch {
      res.json({ authenticated: false });
    }
  });
  app.post("/api/session", (req, res) => {
    origin(req);
    const now = Date.now();
    for (const [k, r] of rates) if (r.until < now) rates.delete(k);
    const ip = req.ip || "unknown",
      rate = rates.get(ip) || { count: 0, until: now + 900000 };
    if (rate.count >= 30 || rates.size >= 1000)
      throw new Fault(429, "Too many demo sessions. Please try later.");
    rate.count++;
    rates.set(ip, rate);
    const { token, user } = store.createSession(req.body.name);
    setCookie(res, token);
    res.status(201).json({ me: user, csrf: csrf(token) });
  });
  app.use("/api", (req, res, next) => {
    const token = cookie(req);
    store.session(token);
    setCookie(res, token);
    res.locals.token = token;
    if (!["GET", "HEAD"].includes(req.method)) {
      origin(req);
      if (req.get("x-csrf-token") !== csrf(token))
        throw new Fault(403, "Refresh the page before making changes.");
    }
    next();
  });
  const token = (res: express.Response) => res.locals.token as string;
  const key = (req: express.Request) =>
    z.string().uuid().parse(req.body.requestId);
  const version = (req: express.Request) =>
    z.number().int().positive().parse(req.body.version);
  const revision = (req: express.Request) =>
    z.number().int().min(0).parse(req.body.revision);
  function publish(res: express.Response, result: any) {
    if (!result.replayed) live.publish(result.board.id);
    res.json(result);
  }
  app.get("/api/boards", (_req, res) => res.json(store.list(token(res))));
  app.post("/api/boards", (req, res) =>
    res
      .status(201)
      .json(
        store.createBoard(
          token(res),
          z.string().trim().min(2).max(70).parse(req.body.title),
        ),
      ),
  );
  app.post("/api/join", (req, res) => {
    const invite = z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .parse(req.body.invite);
    publish(res, store.join(token(res), invite));
  });
  app.get("/api/boards/:id", (req, res) =>
    res.json(store.get(token(res), req.params.id)),
  );
  app.get("/api/boards/:id/live", (req, res) =>
    live.subscribe(req, res, token(res), req.params.id),
  );
  app.put("/api/boards/:id", (req, res) =>
    publish(
      res,
      store.updateBoard(
        token(res),
        req.params.id,
        revision(req),
        key(req),
        req.body,
      ),
    ),
  );
  app.post("/api/boards/:id/cards", (req, res) =>
    publish(
      res,
      store.createCard(token(res), req.params.id, key(req), req.body),
    ),
  );
  app.put("/api/boards/:id/cards/:cid", (req, res) =>
    publish(
      res,
      store.editCard(
        token(res),
        req.params.id,
        req.params.cid,
        version(req),
        key(req),
        req.body,
      ),
    ),
  );
  app.post("/api/boards/:id/cards/:cid/move", (req, res) =>
    publish(
      res,
      store.move(
        token(res),
        req.params.id,
        req.params.cid,
        version(req),
        z.enum(columns).parse(req.body.to),
        z.string().uuid().nullable().parse(req.body.beforeId),
        key(req),
      ),
    ),
  );
  app.delete("/api/boards/:id/cards/:cid", (req, res) =>
    publish(
      res,
      store.deleteCard(
        token(res),
        req.params.id,
        req.params.cid,
        version(req),
        key(req),
      ),
    ),
  );
  app.post("/api/boards/:id/cards/:cid/comments", (req, res) =>
    publish(
      res,
      store.comment(
        token(res),
        req.params.id,
        req.params.cid,
        key(req),
        req.body.body,
      ),
    ),
  );
  app.delete("/api/boards/:id/comments/:cid", (req, res) =>
    publish(
      res,
      store.deleteComment(token(res), req.params.id, req.params.cid, key(req)),
    ),
  );
  app.get("/api/boards/:id/invites", (req, res) =>
    res.json(store.invites(token(res), req.params.id)),
  );
  app.post("/api/boards/:id/invites", (req, res) =>
    publish(
      res,
      store.invite(
        token(res),
        req.params.id,
        z.enum(["editor", "viewer"]).parse(req.body.role),
        revision(req),
        key(req),
      ),
    ),
  );
  app.delete("/api/boards/:id/invites/:iid", (req, res) =>
    publish(
      res,
      store.revokeInvite(token(res), req.params.id, req.params.iid, key(req)),
    ),
  );
  app.patch("/api/boards/:id/members/:mid", (req, res) =>
    publish(
      res,
      store.member(
        token(res),
        req.params.id,
        req.params.mid,
        z.enum(["editor", "viewer", "remove"]).parse(req.body.role),
        revision(req),
        key(req),
      ),
    ),
  );
  app.use("/api", (_req, _res, next) =>
    next(new Fault(404, "API route not found.")),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error instanceof Fault
          ? error.status
          : error instanceof z.ZodError
            ? 422
            : error.type === "entity.too.large"
              ? 413
              : error instanceof SyntaxError
                ? 400
                : 500;
      res
        .status(status)
        .json({
          error:
            status === 500
              ? "Something went wrong. Refresh and try again."
              : error instanceof z.ZodError
                ? error.issues
                    .map((e) => `${e.path.join(".")}: ${e.message}`)
                    .join("; ")
                : error.message,
        });
    },
  );
  return { app, live };
}
