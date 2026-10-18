import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PDFOptions } from "puppeteer-core";
import {
  EXPERIMENTAL_PDF_OPTIONS,
  printPdf,
  type PdfPrintTarget,
} from "../src/utils/pdf-print";

/**
 * The PDF print fallback (#168).
 *
 * `outline` / `tagged` are Chromium's experimental PDF options. A browser
 * that does not know them must degrade to "no bookmarks", never to a failed
 * export, so the print is retried without them when the browser rejects the
 * options.
 */

const BASE: PDFOptions = {
  format: "A4",
  printBackground: true,
  margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
};

function fakePage(
  behaviour: (options: PDFOptions, call: number) => Promise<Uint8Array>,
): PdfPrintTarget & { calls: PDFOptions[] } {
  const calls: PDFOptions[] = [];
  return {
    calls,
    async pdf(options: PDFOptions): Promise<Uint8Array> {
      calls.push(options);
      return behaviour(options, calls.length);
    },
  };
}

describe("printPdf (#168)", () => {
  it("passes the experimental outline/tagged options on the first attempt", async () => {
    const page = fakePage(async () => new Uint8Array([1, 2, 3]));

    const buffer = await printPdf(page, BASE);

    assert.deepEqual([...buffer], [1, 2, 3]);
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].outline, true);
    assert.equal(page.calls[0].tagged, true);
    assert.equal(page.calls[0].format, "A4");
  });

  it("retries without the experimental options when the browser rejects them", async () => {
    const page = fakePage(async (options, call) => {
      if (call === 1) {
        assert.equal(options.outline, true);
        throw new Error("Protocol error: unknown parameter 'generateDocumentOutline'");
      }
      assert.equal(options.outline, undefined);
      assert.equal(options.tagged, undefined);
      return new Uint8Array([9]);
    });

    const buffer = await printPdf(page, BASE);

    assert.deepEqual([...buffer], [9]);
    assert.equal(page.calls.length, 2, "the export must be retried, not failed");
  });

  it("keeps the rest of the options on the retry", async () => {
    const page = fakePage(async (_options, call) => {
      if (call === 1) throw new Error("rejected");
      return new Uint8Array([1]);
    });

    await printPdf(page, BASE);

    const retry = page.calls[1];
    assert.equal(retry.format, "A4");
    assert.equal(retry.printBackground, true);
    assert.deepEqual(retry.margin, BASE.margin);
  });

  it("still fails the export when the browser rejects the plain options too", async () => {
    const page = fakePage(async () => {
      throw new Error("Page is closed");
    });

    await assert.rejects(() => printPdf(page, BASE), /Page is closed/);
    assert.equal(page.calls.length, 2);
  });

  it("exposes the experimental options as one droppable pair", () => {
    assert.deepEqual(Object.keys(EXPERIMENTAL_PDF_OPTIONS).sort(), ["outline", "tagged"]);
  });
});
