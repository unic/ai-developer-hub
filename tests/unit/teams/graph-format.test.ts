import { describe, it, expect } from "vitest";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

describe("markdownToTeamsHtml", () => {
  it("wraps paragraphs in <p>", () => {
    expect(markdownToTeamsHtml("hello")).toBe("<p>hello</p>");
  });

  it("converts double newlines into separate paragraphs", () => {
    expect(markdownToTeamsHtml("a\n\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("converts single newlines into <br/>", () => {
    expect(markdownToTeamsHtml("a\nb")).toBe("<p>a<br/>b</p>");
  });

  it("renders bold via ** ... **", () => {
    expect(markdownToTeamsHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
  });

  it("renders italic via * ... *", () => {
    expect(markdownToTeamsHtml("*it*")).toBe("<p><em>it</em></p>");
  });

  it("renders inline code", () => {
    expect(markdownToTeamsHtml("`x`")).toBe("<p><code>x</code></p>");
  });

  it("renders links with http(s) only", () => {
    expect(markdownToTeamsHtml("[hub](https://aihub.example.com)")).toBe(
      '<p><a href="https://aihub.example.com">hub</a></p>',
    );
  });

  it("escapes HTML before processing markdown", () => {
    // Tag in input should be visible as text, not rendered.
    expect(markdownToTeamsHtml("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("renders unordered lists when every line begins with - or *", () => {
    const md = "- one\n- two\n- three";
    expect(markdownToTeamsHtml(md)).toBe("<ul><li>one</li><li>two</li><li>three</li></ul>");
  });

  it("does not render a list when only some lines begin with -", () => {
    const md = "intro\n- one";
    // joined paragraph; the "-" stays literal
    expect(markdownToTeamsHtml(md)).toContain("intro");
    expect(markdownToTeamsHtml(md)).toContain("- one");
  });

  it("handles a multi-block message end to end", () => {
    const md =
      "Hi **Anna**,\n\nYou're approved for **Copilot**.\n\n- bullet 1\n- bullet 2\n\nMore later.";
    const html = markdownToTeamsHtml(md);
    expect(html).toContain("<p>Hi <strong>Anna</strong>,</p>");
    expect(html).toContain("<p>You&#39;re approved for <strong>Copilot</strong>.</p>");
    expect(html).toContain("<ul><li>bullet 1</li><li>bullet 2</li></ul>");
    expect(html).toContain("<p>More later.</p>");
  });
});
