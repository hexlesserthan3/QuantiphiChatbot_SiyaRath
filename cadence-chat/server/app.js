import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  AppError,
  MAX_PROMPT,
  TONES,
  publicConversation,
  toMarkdown,
  validateId,
  validateTone,
} from "./domain.js";
import { ChatService } from "./services/chat.js";

export function createApp({ repository, provider, config }) {
  const app = express();
  const chat = new ChatService(repository, provider);
  const rate = new Map();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (config.production)
      res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      try {
        const allowed = config.appOrigin
          ? req.headers.origin === config.appOrigin
          : new URL(req.headers.origin).host === req.get("host");
        if (!allowed) throw new Error();
      } catch {
        return next(
          new AppError(403, "Requests must come from this application."),
        );
      }
    }
    const cookies = (req.headers.cookie || "").split(";").map((x) => x.trim());
    let token = cookies
      .find((x) => x.startsWith("cadence_session="))
      ?.slice(16);
    if (!/^[a-f0-9]{64}$/.test(token || "")) {
      token = randomBytes(32).toString("hex");
      res.cookie("cadence_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: "/",
      });
    }
    req.ownerId = createHash("sha256").update(token).digest("hex");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  function throttle(req, _res, next) {
    const now = Date.now();
    if (rate.size > 10000)
      for (const [key, value] of rate) if (value.until < now) rate.delete(key);
    for (const key of [`ip:${req.ip}`, `session:${req.ownerId}`]) {
      const bucket = rate.get(key);
      if (!bucket || bucket.until < now)
        rate.set(key, { count: 1, until: now + 60000 });
      else if (++bucket.count > 30)
        return next(
          new AppError(429, "Too many requests. Please wait a minute."),
        );
    }
    next();
  }
  app.get("/api/health", async (_req, res) => {
    try {
      await repository.health();
      res.json({
        status: "ok",
        mode: "live",
        storage: "mongodb",
      });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      model: config.model,
      tones: Object.keys(TONES),
      maxPrompt: MAX_PROMPT,
    }),
  );
  app.get("/api/conversations", async (req, res) => {
    if (Object.keys(req.query).some((key) => key !== "q"))
      throw new AppError(400, "Use q for conversation search.");
    if (
      req.query.q !== undefined &&
      (typeof req.query.q !== "string" || req.query.q.length > 100)
    )
      throw new AppError(400, "Search must be at most 100 characters.");
    res.json({
      conversations: await repository.list(
        req.ownerId,
        req.query.q?.trim() || "",
      ),
    });
  });
  app.post("/api/conversations", throttle, async (req, res) => {
    const c = await repository.create(
      req.ownerId,
      validateTone(req.body?.tone || "professional"),
    );
    res.status(201).json({ conversation: publicConversation(c) });
  });
  app.param("id", (req, _res, next, id) => {
    try {
      validateId(id);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/conversations/:id", async (req, res) =>
    res.json({
      conversation: publicConversation(
        await repository.get(req.ownerId, req.params.id),
      ),
    }),
  );
  app.patch("/api/conversations/:id", throttle, async (req, res) =>
    res.json({
      conversation: publicConversation(
        await repository.setTone(
          req.ownerId,
          req.params.id,
          validateTone(req.body?.tone),
        ),
      ),
    }),
  );
  app.delete("/api/conversations/:id", throttle, async (req, res) => {
    await repository.delete(req.ownerId, req.params.id);
    res.status(204).end();
  });
  app.get("/api/conversations/:id/export", async (req, res) => {
    const c = await repository.get(req.ownerId, req.params.id);
    res
      .set(
        "Content-Disposition",
        `attachment; filename="cadence-${c.id.slice(0, 8)}.md"`,
      )
      .type("text/markdown")
      .send(toMarkdown(c));
  });
  app.post(
    "/api/conversations/:id/messages",
    throttle,
    async (req, res, next) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("The response timed out.")),
        config.requestTimeoutMs || 90000,
      );
      const disconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", disconnect);
      let heartbeat;
      try {
        for await (const event of chat.reply(
          req.ownerId,
          req.params.id,
          req.body || {},
          controller.signal,
        )) {
          if (controller.signal.aborted || res.destroyed) continue;
          if (!res.headersSent) {
            res.status(200).set({
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            });
            res.flushHeaders();
            heartbeat = setInterval(() => {
              if (!res.destroyed) res.write(": heartbeat\n\n");
            }, 15000);
          }
          res.write(
            `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
          );
        }
        res.end();
      } catch (error) {
        if (res.destroyed) return;
        if (!res.headersSent) return next(error);
        const message = controller.signal.aborted
          ? "The response was interrupted or timed out. You can send another message."
          : error instanceof AppError
            ? error.message
            : "The reply failed. Your conversation is still available; please try again.";
        res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        res.end();
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        res.off("close", disconnect);
      }
    },
  );
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "API route not found.")),
  );
  app.use(
    express.static(fileURLToPath(new URL("../public", import.meta.url)), {
      dotfiles: "deny",
    }),
  );
  app.use((_req, res) => res.status(404).type("text").send("Page not found."));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status =
      error instanceof AppError
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : error instanceof SyntaxError && error.status === 400
            ? 400
            : 500;
    const message =
      error instanceof AppError
        ? error.message
        : status === 413
          ? "The request is too large."
          : status === 400
            ? "Invalid JSON body."
            : "Something went wrong. Please try again.";
    res.status(status).json({ error: message });
  });
  return app;
}
