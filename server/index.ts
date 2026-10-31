import express from "express";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./store.ts";
import { appFor } from "./app.ts";
const path = process.env.DATABASE_PATH || ":memory:";
if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
const store = new Store(path),
  { app, live } = appFor(store, {
    secure: process.env.COOKIE_SECURE === "true",
    origin: process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL,
  });
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(
  Number(process.env.PORT || 3700),
  process.env.HOST || "127.0.0.1",
  () => console.log(`CollabBoard ready on port ${process.env.PORT || 3700}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    live.close();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
