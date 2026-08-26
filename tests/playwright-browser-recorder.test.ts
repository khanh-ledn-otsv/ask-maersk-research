import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { createPlaywrightBrowserRecorder } from "../src/browser/playwright-browser-recorder.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("Playwright browser recorder", () => {
  test("captures a manual session against a local page", async () => {
    const apiRequested = Promise.withResolvers<void>();
    const failedRequestObserved = Promise.withResolvers<void>();
    const invalidJsonObserved = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/api") === true) {
        apiRequested.resolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ answer: "Please provide a shipment identifier." }));
        return;
      }
      if (request.url === "/failed") {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "temporarily unavailable" }));
        failedRequestObserved.resolve();
        return;
      }
      if (request.url === "/invalid-json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("not-json");
        invalidJsonObserved.resolve();
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>Ask Maersk fixture</title></head>
          <body>
            <form id="chat-form">
              <textarea name="message">Track my shipment</textarea>
              <button type="submit">Send</button>
            </form>
            <main>Please provide a shipment identifier.</main>
            <script>
              const form = document.querySelector('#chat-form');
              form.addEventListener('submit', (event) => {
                event.preventDefault();
                fetch('/api?access_token=browser-secret', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ question: 'Track my shipment' })
                });
                fetch('/failed').catch(() => undefined);
                fetch('/invalid-json').catch(() => undefined);
              });
              queueMicrotask(() => form.requestSubmit());
            </script>
          </body>
        </html>`);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected the local fixture to listen on a TCP port");
    }
    const userDataDirectory = await temporaryDirectories.create("maersk-browser-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });

      const capture = await recorder.capture({
        expectedUserMessage: "Track my shipment",
        targetUrl: `http://127.0.0.1:${address.port}/`,
        waitForCompletion: async () =>
          Promise.all([
            apiRequested.promise,
            failedRequestObserved.promise,
            invalidJsonObserved.promise,
          ]).then(() => undefined),
      });

      expect(capture.page).toEqual({
        title: "Ask Maersk fixture",
        url: `http://127.0.0.1:${address.port}/`,
      });
      expect(capture.conversation).toEqual([
        expect.objectContaining({
          index: 0,
          role: "user",
          text: "Track my shipment",
        }),
        expect.objectContaining({
          index: 1,
          role: "assistant",
          text: "Please provide a shipment identifier.",
          screenshot: "screenshots/02-result.png",
        }),
      ]);
      expect(Date.parse(capture.conversation[0]?.timestamp ?? "")).not.toBeNaN();
      expect(capture.timings.submittedAt).toBe(capture.conversation[0]?.timestamp);
      expect(capture.screenshots.map(({ filename }) => filename)).toEqual([
        "01-start.png",
        "02-result.png",
      ]);
      expect(capture.screenshots.every(({ data }) => data.subarray(1, 4).toString() === "PNG")).toBe(
        true,
      );
      expect(capture.network).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            resourceType: "fetch",
            status: 200,
            url: `http://127.0.0.1:${address.port}/api?access_token=browser-secret`,
          }),
          expect.objectContaining({ status: 503, url: `http://127.0.0.1:${address.port}/failed` }),
          expect.objectContaining({
            responseBody: "not-json",
            status: 200,
            url: `http://127.0.0.1:${address.port}/invalid-json`,
          }),
        ]),
      );
      expect(capture.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("503"),
            source: "request",
          }),
          expect.objectContaining({
            message: expect.stringContaining("Could not parse JSON network body"),
            source: "request",
          }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    }
  });
});
