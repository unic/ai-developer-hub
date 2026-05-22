// Pure markdown → Teams-compatible HTML.
//
// Same renderer used both client-side (live preview in template editors and
// approval/completion modals) and server-side (the body Graph posts into Teams),
// so what-you-see-is-what-gets-sent.
//
// Teams renders a tiny subset of HTML, so we cover the absolute minimum:
// bold (**...**), italic (*...*), inline code (`...`), links [text](url)
// (http/https only), unordered lists (- ...), and paragraph breaks (blank line).
// Anything we don't recognize passes through HTML-escaped.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  // escape first, then apply markdown — safer + much simpler than a real parser.
  // Trade-off: templates can use markdown for everything they need, but raw
  // HTML in template content gets shown literally (which is what we want).
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  return out;
}

export function markdownToTeamsHtml(md: string): string {
  const blocks = md.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    const isList =
      lines.filter((l) => l.length).every((l) => /^[-*]\s+/.test(l)) &&
      lines.some((l) => l.length);
    if (isList) {
      const items = lines
        .filter((l) => l.length)
        .map((l) => `<li>${renderInline(l.replace(/^[-*]\s+/, ""))}</li>`);
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const inline = lines
      .filter((l) => l.length)
      .map(renderInline)
      .join("<br/>");
    if (inline) html.push(`<p>${inline}</p>`);
  }

  return html.join("");
}
