export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  if (
    !env.MONGODB_URI ||
    !env.OPENAI_API_KEY ||
    env.OPENAI_API_KEY.startsWith("your_")
  ) {
    throw new Error(
      "Set MONGODB_URI and OPENAI_API_KEY in .env, then run npm start.",
    );
  }
  if (env.APP_ORIGIN && new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN) {
    throw new Error(
      "APP_ORIGIN must be an origin without a path or trailing slash.",
    );
  }
  return {
    port,
    production: env.NODE_ENV === "production",
    trustProxy: env.TRUST_PROXY === "true",
    appOrigin: env.APP_ORIGIN,
    mongoUri: env.MONGODB_URI,
    database: env.MONGODB_DB || "cadence_chat",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    requestTimeoutMs: 90_000,
  };
}
