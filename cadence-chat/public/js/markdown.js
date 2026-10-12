// A deliberately small, safe renderer: no raw HTML, images, or clickable model-supplied URLs.
// All content enters the DOM as text nodes. Supports headings, lists, emphasis, and code.
function inline(parent, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(last, match.index)));
    const code = match[0].startsWith("`");
    const el = document.createElement(code ? "code" : "strong");
    el.textContent = match[0].slice(code ? 1 : 2, code ? -1 : -2);
    parent.append(el);
    last = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(last)));
}
export function renderMarkdown(container, text) {
  container.replaceChildren();
  let paragraph = [],
    list = null,
    code = null,
    language = "";
  const flush = () => {
    if (paragraph.length) {
      const p = document.createElement("p");
      inline(p, paragraph.join("\n"));
      container.append(p);
      paragraph = [];
    }
    list = null;
  };
  const flushCode = () => {
    const pre = document.createElement("pre");
    if (language) {
      const label = document.createElement("span");
      label.className = "code-label";
      label.textContent = language;
      pre.append(label);
    }
    const el = document.createElement("code");
    el.textContent = code.join("\n");
    pre.append(el);
    container.append(pre);
    code = null;
  };
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code) flushCode();
      else {
        flush();
        code = [];
        language = line.trim().slice(3).trim();
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const h = document.createElement(
        `h${Math.min(heading[1].length + 1, 4)}`,
      );
      inline(h, heading[2]);
      container.append(h);
      continue;
    }
    const item = /^\s*(?:[-*]|(\d+)\.)\s+(.+)$/.exec(line);
    if (item) {
      const tag = item[1] ? "OL" : "UL";
      if (!list || list.tagName !== tag) {
        flush();
        list = document.createElement(tag.toLowerCase());
        container.append(list);
      }
      const li = document.createElement("li");
      inline(li, item[2]);
      list.append(li);
      continue;
    }
    if (list) flush();
    paragraph.push(line);
  }
  if (code) flushCode();
  flush();
}
