// Shared protocol parser. Handles chunks split inside UTF-8 characters or SSE frames.
export async function* readSse(body) {
  if (!body) throw new Error("The server did not return a stream.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000)
        throw new Error("The stream frame is too large.");
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let event = "message";
        const lines = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:"))
            lines.push(line.slice(5).replace(/^ /, ""));
        }
        if (lines.length) yield { event, data: lines.join("\n") };
      }
      if (done) break;
    }
    if (buffer.trim() && !buffer.trim().startsWith(":"))
      throw new Error("The stream ended unexpectedly.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
