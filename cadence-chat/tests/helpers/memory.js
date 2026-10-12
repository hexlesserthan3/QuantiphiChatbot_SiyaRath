import { AppError, makeConversation, summary } from "../../server/domain.js";

// Test-only repository double. Application runtime always uses MongoDB.
export class MemoryRepository {
  data = new Map();
  async init() {}
  async close() {}
  async health() {
    return true;
  }
  async create(ownerId, tone) {
    const c = makeConversation(ownerId, tone);
    this.data.set(c.id, c);
    return structuredClone(c);
  }
  async get(ownerId, id) {
    const c = this.data.get(id);
    if (!c || c.ownerId !== ownerId)
      throw new AppError(404, "Conversation not found.");
    return structuredClone(c);
  }
  async list(ownerId, query = "") {
    const q = query.toLowerCase();
    return [...this.data.values()]
      .filter(
        (c) =>
          c.ownerId === ownerId &&
          (!q ||
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q))),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100)
      .map(summary);
  }
  async acquire(ownerId, id, lease) {
    await this.get(ownerId, id);
    const c = this.data.get(id);
    if (c.lockedUntil > new Date())
      throw new AppError(
        409,
        "This conversation is already generating a reply.",
      );
    c.lease = lease;
    c.lockedUntil = new Date(Date.now() + 120000);
    return structuredClone(c);
  }
  async mutate(ownerId, id, lease, change) {
    await this.get(ownerId, id);
    const c = this.data.get(id);
    if (c.lease !== lease)
      throw new AppError(409, "The conversation changed. Please reload it.");
    change(c);
    return structuredClone(c);
  }
  async beginTurn(ownerId, id, lease, user, assistant, tone) {
    return this.mutate(ownerId, id, lease, (c) => {
      if (!c.messages.length)
        c.title = user.content.replace(/\s+/g, " ").slice(0, 60);
      c.messages.push(user, assistant);
      c.tone = tone;
      c.updatedAt = new Date();
    });
  }
  async finishTurn(ownerId, id, lease, messageId, content, status) {
    return this.mutate(ownerId, id, lease, (c) => {
      const m = c.messages.find((m) => m.id === messageId);
      m.content = content;
      m.status = status;
      c.updatedAt = new Date();
    });
  }
  async release(ownerId, id, lease) {
    const c = this.data.get(id);
    if (c?.ownerId === ownerId && c.lease === lease) {
      c.lease = null;
      c.lockedUntil = null;
    }
  }
  async setTone(ownerId, id, tone) {
    const c = await this.get(ownerId, id);
    if (c.lockedUntil > new Date())
      throw new AppError(409, "Wait until the reply finishes to change tone.");
    this.data.get(id).tone = tone;
    return this.get(ownerId, id);
  }
  async delete(ownerId, id) {
    const c = await this.get(ownerId, id);
    if (c.lockedUntil > new Date())
      throw new AppError(
        409,
        "Stop the reply before deleting this conversation.",
      );
    this.data.delete(id);
  }
}
