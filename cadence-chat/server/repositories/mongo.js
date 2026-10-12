import { MongoClient } from "mongodb";
import { AppError, makeConversation, summary } from "../domain.js";

export class MongoRepository {
  constructor(uri, database) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    this.db = this.client.db(database);
    this.collection = this.db.collection("conversations");
  }
  async init() {
    await this.client.connect();
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ ownerId: 1, updatedAt: -1 });
  }
  async close() {
    await this.client.close();
  }
  async health() {
    await this.db.command({ ping: 1 });
    return true;
  }
  async create(ownerId, tone) {
    const c = makeConversation(ownerId, tone);
    await this.collection.insertOne({ ...c });
    return c;
  }
  async get(ownerId, id) {
    const c = await this.collection.findOne(
      { ownerId, id },
      { projection: { _id: 0 } },
    );
    if (!c) throw new AppError(404, "Conversation not found.");
    return c;
  }
  async list(ownerId, query = "") {
    const filter = { ownerId };
    if (query) {
      const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: literal, $options: "i" } },
        { "messages.content": { $regex: literal, $options: "i" } },
      ];
    }
    const docs = await this.collection
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return docs.map(summary);
  }
  unlocked() {
    return {
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }],
    };
  }
  async acquire(ownerId, id, lease) {
    const c = await this.collection.findOneAndUpdate(
      { ownerId, id, ...this.unlocked() },
      { $set: { lease, lockedUntil: new Date(Date.now() + 120000) } },
      { returnDocument: "after", projection: { _id: 0 } },
    );
    if (!c) {
      await this.get(ownerId, id);
      throw new AppError(
        409,
        "This conversation is already generating a reply.",
      );
    }
    return c;
  }
  async beginTurn(ownerId, id, lease, user, assistant, tone) {
    const previous = await this.get(ownerId, id);
    const $set = { tone, updatedAt: new Date() };
    if (!previous.messages.length)
      $set.title = user.content.replace(/\s+/g, " ").slice(0, 60);
    const result = await this.collection.updateOne(
      { ownerId, id, lease },
      { $set, $push: { messages: { $each: [user, assistant] } } },
    );
    if (!result.matchedCount)
      throw new AppError(409, "The conversation changed. Please reload it.");
    return this.get(ownerId, id);
  }
  async finishTurn(ownerId, id, lease, messageId, content, status) {
    const result = await this.collection.updateOne(
      { ownerId, id, lease, "messages.id": messageId },
      {
        $set: {
          "messages.$.content": content,
          "messages.$.status": status,
          updatedAt: new Date(),
        },
      },
    );
    if (!result.matchedCount)
      throw new AppError(409, "The conversation changed. Please reload it.");
    return this.get(ownerId, id);
  }
  async release(ownerId, id, lease) {
    await this.collection.updateOne(
      { ownerId, id, lease },
      { $set: { lease: null, lockedUntil: null } },
    );
  }
  async setTone(ownerId, id, tone) {
    const c = await this.collection.findOneAndUpdate(
      { ownerId, id, ...this.unlocked() },
      { $set: { tone } },
      { returnDocument: "after", projection: { _id: 0 } },
    );
    if (!c) {
      await this.get(ownerId, id);
      throw new AppError(409, "Wait until the reply finishes to change tone.");
    }
    return c;
  }
  async delete(ownerId, id) {
    const r = await this.collection.deleteOne({
      ownerId,
      id,
      ...this.unlocked(),
    });
    if (!r.deletedCount) {
      await this.get(ownerId, id);
      throw new AppError(
        409,
        "Stop the reply before deleting this conversation.",
      );
    }
  }
}
