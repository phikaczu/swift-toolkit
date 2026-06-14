const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Set globals BEFORE require'ing types — types.js may read window/document at module load.
const html = fs.readFileSync(path.join(__dirname, "..", "spike-fixture.html"), "utf-8");
const dom = new JSDOM(html);
global.document = dom.window.document;
global.window = dom.window;
global.NodeFilter = dom.window.NodeFilter;
global.Node = dom.window.Node;
global.Range = dom.window.Range;

const { TextQuoteAnchor } = require("./vendor/hypothesis/anchoring/types");

describe("TextQuoteAnchor mechanism spike — indexterm cluster cross-element", () => {
  it("logs candidate matches + scoring for pattern 1's prefix/suffix/highlight", () => {
    const document = global.document;

    // Pattern 1 from FINDINGS §4.2.
    const before = `"Uniform initialization" is an idea. "Braced initialization" `;
    const highlight = `is a syntactic construct.\nBraced initialization lets you express`;
    const after = ` the formerly inexpressible.`;

    // What does TextQuoteAnchor actually see?
    const fullText = document.body.textContent;
    console.log("---body.textContent length:", fullText.length);
    console.log("---body.textContent:", JSON.stringify(fullText));

    // Where does the prefix appear?
    const prefixTail = before.slice(-30);
    const prefixIndexes = [];
    let searchFrom = 0;
    while (true) {
      const idx = fullText.indexOf(prefixTail, searchFrom);
      if (idx === -1) break;
      prefixIndexes.push(idx);
      searchFrom = idx + 1;
    }
    console.log("---prefix tail:", JSON.stringify(prefixTail));
    console.log("---prefix tail matches at indexes:", prefixIndexes);

    // What does the highlight look like after the first prefix match?
    if (prefixIndexes.length > 0) {
      const afterFirstPrefix = fullText.slice(prefixIndexes[0] + prefixTail.length, prefixIndexes[0] + prefixTail.length + 60);
      console.log("---text after first prefix match:", JSON.stringify(afterFirstPrefix));
    }
    if (prefixIndexes.length > 1) {
      const afterSecondPrefix = fullText.slice(prefixIndexes[1] + prefixTail.length, prefixIndexes[1] + prefixTail.length + 60);
      console.log("---text after second prefix match:", JSON.stringify(afterSecondPrefix));
    }

    // Does the highlight (with embedded \n) appear in textContent?
    console.log("---highlight literal in textContent?", fullText.includes(highlight));
    const highlightNoNewline = highlight.replace(/\n/g, "");
    console.log("---highlight without \\n in textContent?", fullText.includes(highlightNoNewline));

    // Run TextQuoteAnchor.
    const anchor = new TextQuoteAnchor(document.body, highlight, { prefix: before, suffix: after });

    let range;
    try { range = anchor.toRange(); } catch (e) { console.log("---toRange threw:", e.message); }

    if (range) {
      console.log("---range.collapsed:", range.collapsed);
      console.log("---range.startContainer.nodeName:", range.startContainer.nodeName);
      console.log("---range.startContainer parent id:", range.startContainer.parentElement?.id);
      console.log("---range.startContainer textContent slice:", JSON.stringify((range.startContainer.textContent || "").slice(0, 50)));
      console.log("---range.startOffset:", range.startOffset);
      console.log("---range.endContainer.nodeName:", range.endContainer.nodeName);
      console.log("---range.endContainer parent id:", range.endContainer.parentElement?.id);
      console.log("---range.endOffset:", range.endOffset);
      console.log("---range.toString():", JSON.stringify(range.toString()));
    } else {
      console.log("---no range returned");
    }

    // Weak assertion — we want the log output.
    assert.ok(true);
  });
});
