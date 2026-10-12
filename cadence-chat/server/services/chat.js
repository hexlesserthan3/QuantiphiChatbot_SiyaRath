import { randomUUID } from "node:crypto";
import {
  AppError,
  MAX_MESSAGES,
  buildMessages,
  publicConversation,
  validatePrompt,
  validateTone,
} from "../domain.js";

export class ChatService {
  constructor(repository, provider) {
    this.repository = repository;
    this.provider = provider;
  }
  async *reply(ownerId, id, input, signal) {
    const prompt = validatePrompt(input.prompt),
      tone = validateTone(input.tone);
    const lease = randomUUID();
    const conversation = await this.repository.acquire(ownerId, id, lease);
    let assistant,
      content = "",
      status = "error",
      started = false,
      failure;
    try {
      if (conversation.messages.length >= MAX_MESSAGES)
        throw new AppError(
          400,
          "This conversation is full. Start a new chat to continue.",
        );
      signal.throwIfAborted();
      const user = {
        id: randomUUID(),
        role: "user",
        content: prompt,
        tone,
        createdAt: new Date(),
        status: "complete",
      };
      assistant = {
        id: randomUUID(),
        role: "assistant",
        content: "",
        tone,
        createdAt: new Date(),
        status: "streaming",
      };
      await this.repository.beginTurn(
        ownerId,
        id,
        lease,
        user,
        assistant,
        tone,
      );
      started = true;
      yield {
        event: "meta",
        data: {
          user,
          assistant,
          title: conversation.messages.length
            ? conversation.title
            : prompt.replace(/\s+/g, " ").slice(0, 60),
        },
      };
      const context = [
        ...buildMessages(conversation.messages, tone),
        { role: "user", content: prompt },
      ];
      for await (const delta of this.provider.stream(context, {
        tone,
        signal,
      })) {
        signal.throwIfAborted();
        if (content.length + delta.length > 40000)
          throw new AppError(502, "The response exceeded the size limit.");
        content += delta;
        yield { event: "delta", data: { text: delta } };
      }
      if (!content.trim())
        throw new AppError(
          502,
          "The AI returned an empty response. Please try again.",
        );
      status = "complete";
    } catch (error) {
      status = signal.aborted ? "interrupted" : "error";
      failure = error;
    } finally {
      // Save partial text on cancellation or provider failure, then always release the database lease.
      try {
        if (started)
          await this.repository.finishTurn(
            ownerId,
            id,
            lease,
            assistant.id,
            content,
            status,
          );
      } finally {
        await this.repository.release(ownerId, id, lease);
      }
    }
    if (failure) throw failure;
    const saved = await this.repository.get(ownerId, id);
    yield { event: "done", data: { conversation: publicConversation(saved) } };
  }
}
