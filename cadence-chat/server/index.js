import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { MongoRepository } from "./repositories/mongo.js";
import { OpenAIProvider } from "./services/provider.js";

let repository;
try {
  const config = loadConfig();
  repository = new MongoRepository(config.mongoUri, config.database);
  await repository.init();
  const provider = new OpenAIProvider(config);
  const server = createApp({ repository, provider, config }).listen(
    config.port,
    () => {
      console.log(`Cadence is ready at http://localhost:${config.port}`);
      console.log(`OpenAI (${config.model}) + MongoDB connected.`);
    },
  );
  server.on("error", async (error) => {
    console.error(`Server could not start (${error.code || "unknown error"}).`);
    await repository.close();
    process.exit(1);
  });
  const shutdown = () => {
    server.close(async () => {
      await repository.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  console.error(
    error.name.startsWith("Mongo")
      ? "MongoDB connection failed. Check MONGODB_URI, database access, and the network allowlist."
      : error.message,
  );
  await repository?.close().catch(() => {});
  process.exit(1);
}
