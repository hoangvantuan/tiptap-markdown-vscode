/**
 * Printing a page to PDF, and the graceful degradation of the two
 * EXPERIMENTAL Chromium options the export would like to have.
 *
 * `outline` (the bookmark tree) and `tagged` (an accessible, tagged PDF) are
 * `PDFOptions` in puppeteer-core 24.x — both are marked `@experimental`
 * there (`node_modules/puppeteer-core/lib/types.d.ts`).
 *
 * They are Chromium's, not puppeteer's. A Chrome or Edge that does not know
 * an option ignores it, and the export then simply has no bookmarks; that is
 * the degradation the issue asks for. The one outcome that must never happen
 * is a FAILED export, so a browser that REJECTS the options is retried once
 * without them.
 *
 * `outline: true` is the point of the retry: the bookmark tree is built by
 * Chromium from the document's own headings, so the exported PDF needs no
 * injected table of contents and the body is left untouched.
 *
 * `tagged: true` is passed for accessibility. Measured on the floor's browser
 * (Chrome for Testing 155) it changes nothing: Chromium tags by default
 * there, and the exported bytes are identical with and without the option.
 * On an older browser it is the difference between a tagged and an untagged
 * PDF.
 *
 * This module is separate from `export-pdf.ts` so that the fallback can be
 * unit tested without pulling puppeteer-core into the test bundle.
 */
import type { PDFOptions } from "puppeteer-core";

/** The two experimental options, kept in one place so the retry can drop them. */
export const EXPERIMENTAL_PDF_OPTIONS: PDFOptions = {
  outline: true,
  tagged: true,
};

/** The part of puppeteer's `Page` this module needs. */
export interface PdfPrintTarget {
  pdf(options: PDFOptions): Promise<Uint8Array>;
}

/**
 * Print the page, with the experimental options when the browser accepts them.
 *
 * The retry is deliberately narrow: it drops ONLY `outline` and `tagged`, and
 * it happens only when the first call threw. A browser that merely ignores an
 * unknown option never gets here, so the common "old Chrome" case costs
 * nothing.
 */
export async function printPdf(
  page: PdfPrintTarget,
  options: PDFOptions,
): Promise<Uint8Array> {
  try {
    return await page.pdf({ ...options, ...EXPERIMENTAL_PDF_OPTIONS });
  } catch (err) {
    console.warn(
      "[Export PDF] Chromium rejected the outline/tagged PDF options; exporting without them:",
      err,
    );
    return await page.pdf({ ...options });
  }
}
