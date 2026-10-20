import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalEntryText } from "../app/components/journal/JournalEntryText";

const render = (text: string, searchQuery = "") =>
  renderToStaticMarkup(createElement(JournalEntryText, { text, searchQuery }));

describe("entry hashtags with search highlighting", () => {
  it("preserves mixed Korean and English tags, punctuation, and line breaks", () => {
    const markup = render("안녕 #일상,\n#test_2! #");
    expect(markup).toContain('<span class="entry-hashtag">#일상</span>');
    expect(markup).toContain('<span class="entry-hashtag">#test_2</span>');
    expect(markup).toBe(
      '<span>안녕 </span><span class="entry-hashtag">#일상</span><span>,\n</span>' +
      '<span class="entry-hashtag">#test_2</span><span>! #</span>',
    );
  });

  it("keeps the whole hashtag blue when only part of it matches a query", () => {
    expect(render("#Testing", "test")).toBe(
      '<span class="entry-hashtag">#<mark class="search-highlight">Test</mark>ing</span>',
    );
  });

  it("highlights a complete phrase that crosses a hashtag boundary", () => {
    const markup = render("Hello #test world", "#test world");
    expect(markup).toContain('<span class="entry-hashtag"><mark class="search-highlight">#test</mark></span>');
    expect(markup).toContain('<mark class="search-highlight"> world</mark>');
    expect(markup).toBe(
      '<span>Hello </span><span class="entry-hashtag"><mark class="search-highlight">#test</mark></span>' +
      '<span><mark class="search-highlight"> world</mark></span>',
    );
  });

  it("escapes literal search patterns and keeps choseong searches unmarked", () => {
    expect(render("#test (a+b)", "(a+b)")).toContain('<mark class="search-highlight">(a+b)</mark>');
    expect(render("#일상", "ㅇㅅ")).not.toContain("<mark");
    expect(render("<script>#tag</script>")).toContain("&lt;script&gt;");
  });
});
