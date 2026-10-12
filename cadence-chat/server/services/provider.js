import { AppError } from "../domain.js";
import { readSse } from "../../public/js/sse.js";

export class OpenAIProvider {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }
  async *stream(messages, { signal }) {
    const response = await this.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
          max_completion_tokens: 1600,
          store: false,
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new AppError(
          429,
          "The AI provider rate or quota limit was reached. Check API billing or try again later.",
        );
      if (response.status === 401 || response.status === 403)
        throw new AppError(
          502,
          "The AI provider rejected the API key. Check the server configuration.",
        );
      throw new AppError(
        502,
        "The AI provider could not complete this request. Check the model setting or try again.",
      );
    }
    let complete = false;
    for await (const { data } of readSse(response.body)) {
      if (data === "[DONE]") {
        complete = true;
        break;
      }
      const chunk = JSON.parse(data);
      if (chunk.error)
        throw new AppError(
          502,
          "The AI provider reported an error. Please try again.",
        );
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason === "content_filter")
        throw new AppError(
          422,
          "The AI provider could not answer this request. Try rephrasing it.",
        );
      const text = choice?.delta?.content || choice?.delta?.refusal;
      if (text) yield text;
      if (choice?.finish_reason === "length")
        yield "\n\n[Response reached its length limit. Ask me to continue.]";
    }
    if (!complete)
      throw new AppError(
        502,
        "The AI connection ended early. Please try again.",
      );
  }
}
