/**
 * `fetchRemoteBytes` (src/utils/remote-fetch.ts): the limits both the DOCX
 * export and the #174 download rely on. `fetchImpl` is injected, so no network
 * is touched; what is asserted is what the function does with a response.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchRemoteBytes } from "../src/utils/remote-fetch";

function respond(
  body: BodyInit | null,
  init: ResponseInit & { url?: string } = {},
): typeof fetch {
  return async () => {
    const res = new Response(body, init);
    if (init.url) Object.defineProperty(res, "url", { value: init.url });
    return res;
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("fetchRemoteBytes", () => {
  it("returns the bytes and the content type", async () => {
    const r = await fetchRemoteBytes("https://a.test/x.png", {
      fetchImpl: respond(PNG, { headers: { "content-type": "image/png" } }),
    });
    assert.deepEqual(Array.from(r.bytes), Array.from(PNG));
    assert.equal(r.contentType, "image/png");
  });

  it("rejects a non-2xx answer with the message the DOCX export logs", async () => {
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", {
        fetchImpl: respond("nope", { status: 404 }),
      }),
      /Fetch 404 for https:\/\/a\.test\/x\.png/,
    );
  });

  it("rejects a declared content-length over the cap before reading the body", async () => {
    let bodyRead = false;
    const impl: typeof fetch = async () => {
      const res = new Response(PNG, { headers: { "content-length": "999999" } });
      const orig = res.arrayBuffer.bind(res);
      res.arrayBuffer = async () => {
        bodyRead = true;
        return orig();
      };
      return res;
    };
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", { maxBytes: 100, fetchImpl: impl }),
      /Remote image > 100 bytes/,
    );
    assert.equal(bodyRead, false);
  });

  it("rejects a body over the cap even when no length was declared", async () => {
    const big = new Uint8Array(500);
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", {
        maxBytes: 100,
        fetchImpl: respond(big),
      }),
      /Remote image > 100 bytes/,
    );
  });

  it("httpsOnly refuses an http: URL without calling fetch", async () => {
    let called = false;
    const impl: typeof fetch = async () => {
      called = true;
      return new Response(PNG);
    };
    await assert.rejects(
      fetchRemoteBytes("http://a.test/x.png", { httpsOnly: true, fetchImpl: impl }),
      /Only https/,
    );
    assert.equal(called, false);
  });

  it("httpsOnly refuses a redirect that ended on http:", async () => {
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", {
        httpsOnly: true,
        fetchImpl: respond(PNG, { url: "http://evil.test/x.png" }),
      }),
      /Redirected away from https/,
    );
  });

  it("without httpsOnly an http: URL is fetched (the DOCX export's behaviour)", async () => {
    const r = await fetchRemoteBytes("http://a.test/x.png", {
      fetchImpl: respond(PNG),
    });
    assert.equal(r.bytes.byteLength, 4);
  });

  it("requireImageContentType refuses an HTML login page", async () => {
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", {
        requireImageContentType: true,
        fetchImpl: respond("<html>login</html>", {
          headers: { "content-type": "text/html" },
        }),
      }),
      /Not an image/,
    );
  });

  it("aborts when the server is slower than the timeout", async () => {
    const impl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const g = setTimeout(
          () => reject(new Error("did not abort within 200ms")),
          200,
        );
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(g);
          reject(new Error("aborted"));
        });
      });
    await assert.rejects(
      fetchRemoteBytes("https://a.test/x.png", { timeoutMs: 20, fetchImpl: impl }),
      /aborted/,
    );
  });
});
