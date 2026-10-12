import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoRepository } from "../server/repositories/mongo.js";

// A unique disposable database avoids modifying application data.
test(
  "real MongoDB persistence, ownership, literal search, atomic lease, and deletion",
  { skip: !process.env.MONGODB_TEST_URI },
  async () => {
    const uri = process.env.MONGODB_TEST_URI;
    const database = `cadence_test_${randomUUID().replaceAll("-", "")}`;
    const repo = new MongoRepository(uri, database);
    let reopened;
    try {
      await repo.init();
      const c = await repo.create("owner", "casual");
      await assert.rejects(
        repo.get("stranger", c.id),
        (error) => error.status === 404,
      );
      await repo.acquire("owner", c.id, "lease-one");
      await assert.rejects(
        repo.acquire("owner", c.id, "lease-two"),
        (error) => error.status === 409,
      );
      const user = {
        id: randomUUID(),
        role: "user",
        content: "Explain [literal].*",
        tone: "casual",
        status: "complete",
        createdAt: new Date(),
      };
      const assistant = {
        id: randomUUID(),
        role: "assistant",
        content: "",
        tone: "casual",
        status: "streaming",
        createdAt: new Date(),
      };
      await repo.beginTurn(
        "owner",
        c.id,
        "lease-one",
        user,
        assistant,
        "casual",
      );
      await repo.finishTurn(
        "owner",
        c.id,
        "lease-one",
        assistant.id,
        "Saved in MongoDB",
        "complete",
      );
      await repo.release("owner", c.id, "lease-one");
      await repo.close();
      reopened = new MongoRepository(uri, database);
      await reopened.init();
      assert.equal(
        (await reopened.get("owner", c.id)).messages[1].content,
        "Saved in MongoDB",
      );
      assert.equal((await reopened.list("owner", "[literal].*")).length, 1);
      assert.equal((await reopened.list("owner", ".*unknown")).length, 0);
      assert.equal(
        (await reopened.setTone("owner", c.id, "concise")).tone,
        "concise",
      );
      await reopened.delete("owner", c.id);
      await assert.rejects(reopened.get("owner", c.id));
    } finally {
      const active = reopened || repo;
      await active.db.dropDatabase().catch(() => {});
      await active.close();
      await repo.close();
    }
  },
);
