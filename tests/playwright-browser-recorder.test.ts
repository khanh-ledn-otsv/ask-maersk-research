import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { chromium } from "playwright";
import { afterEach, describe, expect, test } from "vitest";
import { createPlaywrightBrowserRecorder } from "../src/browser/playwright-browser-recorder.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("Playwright browser recorder", () => {
  test("captures a visible Ask Maersk sidebar instead of the unchanged opening page", async () => {
    const sidebarApiObserved = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      if (request.url === "/sidebar-api") {
        sidebarApiObserved.resolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ answer: "Sidebar API answer" }));
        return;
      }
      if (request.url === "/sidebar") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html>
          <html>
            <head><title>Ask Maersk sidebar</title></head>
            <body>
              <aside class="mc-c-ask-maersk">A result shown in the sidebar</aside>
              <script>fetch('/sidebar-api');</script>
            </body>
          </html>`);
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>Maersk opening page</title></head>
          <body>
            <main>Opening page</main>
            <script>setTimeout(() => window.open('/sidebar'), 500);</script>
          </body>
        </html>`);
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-sidebar-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: ".mc-c-ask-maersk",
        headless: true,
        userDataDirectory,
      });

      const capture = await recorder.capture({
        expectedUserMessage: "What can you help me with",
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: async () => {
          await sidebarApiObserved.promise;
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      });

      expect(capture.page.title).toBe("Ask Maersk sidebar");
      expect(capture.conversation.at(-1)?.text).toBe("A result shown in the sidebar");
      expect(capture.network).toEqual([
        expect.objectContaining({ url: `http://127.0.0.1:${port}/sidebar-api` }),
      ]);
      expect(capture.screenshots[1]?.data.equals(capture.screenshots[0]?.data ?? Buffer.alloc(0))).toBe(
        false,
      );
    } finally {
      await close(server);
    }
  });

  test("captures bounded screenshots when the page has extreme horizontal overflow", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Wide Ask Maersk fixture</title>
            <style>
              body::after {
                content: "";
                position: absolute;
                left: 100000px;
                top: 6500px;
                width: 1px;
                height: 1px;
              }
            </style>
          </head>
          <body><main>How can I help?</main></body>
        </html>`);
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-wide-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });

      const capture = await recorder.capture({
        expectedUserMessage: "What can you help me with",
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: async () => undefined,
      });

      expect(capture.screenshots.map(({ filename }) => filename)).toEqual([
        "01-start.png",
        "02-result.png",
        "03-error.png",
      ]);
      expect(capture.screenshots.every(({ data }) => data.subarray(1, 4).toString() === "PNG")).toBe(
        true,
      );
      expect(
        capture.screenshots.map(({ data }) => ({
          height: data.readUInt32BE(20),
          width: data.readUInt32BE(16),
        })),
      ).toEqual([
        { height: 1_000, width: 1_440 },
        { height: 1_000, width: 1_440 },
        { height: 1_000, width: 1_440 },
      ]);
    } finally {
      await close(server);
    }
  });

  test("masks configured customer identifiers embedded in visible text", async () => {
    const customerIdentifier = "CUSTOMER-123456";
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Sensitive screenshot fixture</title>
            <style>
              body { margin: 0; background: white; }
              .customer { position: fixed; left: 100px; top: 100px; width: 300px; height: 40px; }
            </style>
          </head>
          <body>
            <main>Answer ready</main>
            <div class="customer">Shipment ${customerIdentifier} is delayed</div>
          </body>
        </html>`);
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-mask-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });
      const capture = await recorder.capture({
        expectedUserMessage: "Inspect masking",
        sensitiveValues: [customerIdentifier],
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: async () => undefined,
      });

      expect(await readPngPixel(capture.screenshots[1]?.data, 200, 120)).toEqual([
        0, 0, 0, 255,
      ]);
    } finally {
      await close(server);
    }
  });

  test("retains coherent functional traffic while excluding static assets and telemetry", async () => {
    const graphQlObserved = Promise.withResolvers<void>();
    const delayedRequestObserved = Promise.withResolvers<void>();
    const businessCollectionObserved = Promise.withResolvers<void>();
    const eventStreamObserved = Promise.withResolvers<void>();
    const telemetryObserved = Promise.withResolvers<void>();
    const openEventStreams = new Set<ServerResponse>();
    let eventStreamCount = 0;
    const server = createServer((request, response) => {
      if (request.url === "/graphql") {
        graphQlObserved.resolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { answer: "Functional answer" } }));
        return;
      }
      if (request.url === "/delayed") {
        delayedRequestObserved.resolve();
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ delayed: true }));
        }, 300);
        return;
      }
      if (request.url === "/collect") {
        businessCollectionObserved.resolve();
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ collected: true }));
        return;
      }
      if (request.url === "/events") {
        eventStreamCount += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          eventStreamCount === 1
            ? "data: connected-1\n\n"
            : "event: shipment-update\ndata: connected-2\n\n",
        );
        openEventStreams.add(response);
        response.once("close", () => openEventStreams.delete(response));
        if (eventStreamCount === 2) eventStreamObserved.resolve();
        return;
      }
      if (request.url === "/telemetry") {
        telemetryObserved.resolve();
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/static/app.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end("globalThis.staticAssetLoaded = true;");
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>Functional traffic fixture</title></head>
          <body>
            <main>Functional answer</main>
            <script src="/static/app.js"></script>
            <script>
              fetch('/graphql', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ operationName: 'AskMaersk', query: '{ answer }' })
              });
              fetch('/delayed');
              fetch('/collect', { method: 'POST' });
              fetch('/telemetry', { method: 'POST', body: JSON.stringify({ event: 'page-view' }) });
              new EventSource('/events');
              const shipmentEvents = new EventSource('/events');
              shipmentEvents.addEventListener('shipment-update', () => undefined);
            </script>
          </body>
        </html>`);
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-network-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });

      const capture = await Promise.race([
        recorder.capture({
          expectedUserMessage: "Inspect functional traffic",
          targetUrl: `http://127.0.0.1:${port}/`,
          waitForCompletion: async () => {
            await Promise.all([
              graphQlObserved.promise,
              delayedRequestObserved.promise,
              businessCollectionObserved.promise,
              eventStreamObserved.promise,
              telemetryObserved.promise,
            ]);
          },
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Recorder did not finish with an open SSE stream")), 750);
        }),
      ]);

      expect(capture.network.map(({ url }) => new URL(url).pathname).toSorted()).toEqual([
        "/collect",
        "/delayed",
        "/events",
        "/events",
        "/graphql",
      ]);
      expect(capture.network).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            durationMs: expect.any(Number),
            method: "POST",
            requestBody: { operationName: "AskMaersk", query: "{ answer }" },
            resourceType: "fetch",
            responseBody: { data: { answer: "Functional answer" } },
            status: 200,
          }),
          expect.objectContaining({
            method: "GET",
            resourceType: "fetch",
            responseBody: { delayed: true },
            status: 200,
          }),
          expect.objectContaining({
            method: "GET",
            resourceType: "eventsource",
            status: 200,
          }),
          expect.objectContaining({
            method: "POST",
            responseBody: { collected: true },
            status: 201,
            url: `http://127.0.0.1:${port}/collect`,
          }),
        ]),
      );
      expect(
        capture.network
          .filter(({ resourceType }) => resourceType === "eventsource")
          .map(({ frames }) => frames?.map(({ payload }) => payload)),
      ).toEqual([["connected-1"], ["connected-2"]]);
      expect(
        capture.network
          .filter(({ resourceType }) => resourceType === "eventsource")
          .flatMap(({ frames }) => frames ?? [])
          .at(-1),
      ).toEqual(expect.objectContaining({ eventName: "shipment-update" }));
    } finally {
      for (const response of openEventStreams) response.end();
      await close(server);
    }
  });

  test("records WebSocket frames as one correlated functional connection", async () => {
    const clientFrameObserved = Promise.withResolvers<void>();
    const upgradedSockets = new Set<Duplex>();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>WebSocket fixture</title></head>
          <body>
            <main>Connected</main>
            <script>
              const socket = new WebSocket('ws://' + location.host + '/functional-socket');
              socket.addEventListener('open', () => {
                socket.send(JSON.stringify({ type: 'question', text: 'Track shipment' }));
              });
              socket.addEventListener('message', () => socket.close());
            </script>
          </body>
        </html>`);
    });
    server.on("upgrade", (request, socket) => {
      upgradedSockets.add(socket);
      socket.once("close", () => upgradedSockets.delete(socket));
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string") {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.once("data", () => clientFrameObserved.resolve());
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const payload = Buffer.from(JSON.stringify({ type: "answer", text: "Connected" }));
      socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-websocket-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });
      const capture = await recorder.capture({
        expectedUserMessage: "Track shipment",
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: async () => {
          await clientFrameObserved.promise;
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      });

      expect(capture.network).toEqual([
        expect.objectContaining({
          durationMs: expect.any(Number),
          frames: expect.arrayContaining([
            expect.objectContaining({
              direction: "sent",
              payload: JSON.stringify({ type: "question", text: "Track shipment" }),
            }),
            expect.objectContaining({
              direction: "received",
              payload: JSON.stringify({ type: "answer", text: "Connected" }),
            }),
          ]),
          method: "GET",
          resourceType: "websocket",
          status: 101,
          url: `ws://127.0.0.1:${port}/functional-socket`,
        }),
      ]);
    } finally {
      for (const socket of upgradedSockets) socket.destroy();
      server.closeAllConnections();
      await close(server);
    }
  });

  test("captures diagnostic evidence for errors, login walls, modals, and unexpected pages", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Unexpected state fixture</title>
            <style>
              body { margin: 0; background: white; }
              #error-banner { position: fixed; left: 500px; top: 100px; width: 100px; height: 40px; background: red; }
              [role="dialog"] { position: fixed; left: 700px; top: 100px; width: 300px; height: 40px; background: white; }
              #split-secret { position: fixed; left: 1050px; top: 100px; width: 200px; height: 40px; background: white; }
            </style>
          </head>
          <body>
            <div id="error-banner"></div>
            <form id="chat-form">
              <textarea>Track shipment</textarea>
              <button type="submit">Send</button>
            </form>
            <form action="/login"><input type="password" value="password-value"></form>
            <section role="dialog" aria-modal="true">Session expired. Authorization: Bearer visible-secret</section>
            <div id="split-secret"><span>Password:</span><strong>hunter2</strong></div>
            <script>
              const form = document.querySelector('#chat-form');
              form.addEventListener('submit', (event) => event.preventDefault());
              queueMicrotask(() => form.requestSubmit());
              setTimeout(() => { throw new Error('Unexpected fixture failure'); }, 0);
              setTimeout(() => document.querySelector('#error-banner').remove(), 150);
            </script>
          </body>
        </html>`);
    });

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-diagnostics-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: ".assistant-result",
        headless: true,
        userDataDirectory,
      });
      const capturePromise = recorder.capture({
        expectedUserMessage: "Track shipment",
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: () => new Promise((resolve) => setTimeout(resolve, 250)),
      });
      const capture = await capturePromise;

      expect(capture.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Unexpected fixture failure", source: "page" }),
          expect.objectContaining({ message: "Login wall detected", source: "browser" }),
          expect.objectContaining({ message: "Visible modal detected", source: "browser" }),
          expect.objectContaining({
            message: "Expected assistant response was not visible",
            source: "browser",
          }),
        ]),
      );
      expect(capture.screenshots.slice(2)).toHaveLength(4);
      expect(capture.screenshots.slice(2).every(({ kind }) => kind === "error")).toBe(true);
      expect(await readPngPixel(capture.screenshots[2]?.data, 550, 120)).toEqual([
        255, 0, 0, 255,
      ]);
      expect(await readPngPixel(capture.screenshots[3]?.data, 750, 120)).toEqual([
        0, 0, 0, 255,
      ]);
      expect(await readPngPixel(capture.screenshots[3]?.data, 1100, 120)).toEqual([
        0, 0, 0, 255,
      ]);
    } finally {
      await close(server);
    }
  });

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

    const port = await listen(server);
    const userDataDirectory = await temporaryDirectories.create("maersk-browser-profile-");

    try {
      const recorder = createPlaywrightBrowserRecorder({
        assistantSelector: "main",
        headless: true,
        userDataDirectory,
      });

      const capture = await recorder.capture({
        expectedUserMessage: "Track my shipment",
        targetUrl: `http://127.0.0.1:${port}/`,
        waitForCompletion: async () =>
          Promise.all([
            apiRequested.promise,
            failedRequestObserved.promise,
            invalidJsonObserved.promise,
          ]).then(() => undefined),
      });

      expect(capture.page).toEqual({
        title: "Ask Maersk fixture",
        url: `http://127.0.0.1:${port}/`,
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
        "03-error.png",
        "04-error.png",
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
            url: `http://127.0.0.1:${port}/api?access_token=browser-secret`,
          }),
          expect.objectContaining({ status: 503, url: `http://127.0.0.1:${port}/failed` }),
          expect.objectContaining({
            responseBody: "not-json",
            status: 200,
            url: `http://127.0.0.1:${port}/invalid-json`,
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
      await close(server);
    }
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the local fixture to listen on a TCP port");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function readPngPixel(
  png: Buffer | undefined,
  x: number,
  y: number,
): Promise<readonly number[]> {
  if (typeof png === "undefined") throw new Error("Expected a PNG screenshot");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<img alt="screenshot" src="data:image/png;base64,${png.toString("base64")}">`);
    const image = page.getByAltText("screenshot");
    await image.waitFor();
    return await page.evaluate(
      ({ x: pixelX, y: pixelY }) => {
        const image = document.querySelector("img");
        if (!(image instanceof HTMLImageElement)) throw new Error("Expected screenshot image");
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Expected a canvas context");
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(pixelX, pixelY, 1, 1).data);
      },
      { x, y },
    );
  } finally {
    await browser.close();
  }
}
