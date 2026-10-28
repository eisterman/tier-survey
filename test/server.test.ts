import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import { Poll, type PollEvent, type ResultsState, type VoterState } from "../src/poll.ts";
import { createApp } from "../src/server.ts";

const RESULTS_TOKEN = "test-token-0123456789";
const VOTER_ID = "0123456789abcdef0123456789abcdef";

class CountingPoll extends Poll {
  activeSubscribers = 0;

  override subscribe(listener: (event: PollEvent) => void): () => void {
    this.activeSubscribers++;
    const unsubscribe = super.subscribe(listener);
    return () => {
      this.activeSubscribers--;
      unsubscribe();
    };
  }
}

type EventStream<T> = {
  next: () => Promise<T>;
  close: () => void;
};

/** Minimal SSE client: yields each `data:` payload in order and skips heartbeat comments. */
async function openEventStream<T>(url: string): Promise<EventStream<T>> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.ok(response.body);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const queued: T[] = [];
  let buffer = "";

  return {
    async next() {
      while (queued.length === 0) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Event stream ended before the next event");
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const data = buffer
            .slice(0, boundary)
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice("data: ".length))
            .join("\n");
          buffer = buffer.slice(boundary + 2);
          if (data) queued.push(JSON.parse(data) as T);
        }
      }
      return queued.shift() as T;
    },
    close: () => controller.abort(),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("HTTP server", () => {
  let server: Server;
  let poll: CountingPoll;
  let baseUrl: string;

  const resultsUrl = () => `${baseUrl}/r/${RESULTS_TOKEN}`;

  const vote = (overrides: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roundId: poll.roundId, voterId: VOTER_ID, name: "Ada", rank: "S", ...overrides }),
    });

  before(async () => {
    poll = new CountingPoll();
    server = await createApp({ resultsToken: RESULTS_TOKEN, poll });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => poll.reset());

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  describe("createApp", () => {
    for (const resultsToken of ["", "short", "../../etc/passwd/abcdef", "has spaces in it 0123"]) {
      it(`should refuse to start with results token ${JSON.stringify(resultsToken)}`, async () => {
        // #given / #when
        const starting = createApp({ resultsToken });

        // #then
        await assert.rejects(starting, /Results token/);
      });
    }
  });

  describe("pages", () => {
    for (const [path, contentType] of [
      ["/", "text/html"],
      ["/style.css", "text/css"],
      [`/r/${RESULTS_TOKEN}`, "text/html"],
      [`/r/${RESULTS_TOKEN}/`, "text/html"],
    ] as const) {
      it(`should serve ${path} as ${contentType}`, async () => {
        // #given / #when
        const response = await fetch(`${baseUrl}${path}`);
        await response.arrayBuffer();

        // #then
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") ?? "", new RegExp(`^${contentType}`));
      });
    }

    for (const path of ["/r/wrong-token-0123456789", "/r/", "/api/vote", "/nope", "/vote.html", "/../src/main.ts"]) {
      it(`should return 404 for GET ${path}`, async () => {
        // #given / #when
        const response = await fetch(`${baseUrl}${path}`);
        await response.arrayBuffer();

        // #then
        assert.equal(response.status, 404);
      });
    }
  });

  describe("POST /api/vote", () => {
    it("should record a vote", async () => {
      // #given / #when
      const response = await vote();

      // #then
      assert.equal(response.status, 204);
      assert.deepEqual(poll.resultsState().ballots, [{ name: "Ada", rank: "S" }]);
    });

    it("should move a voter's existing vote and update their name when they vote again", async () => {
      // #given
      await vote({ rank: "S" });

      // #when
      await vote({ rank: "D", name: "Ada L." });

      // #then
      assert.deepEqual(poll.resultsState().ballots, [{ name: "Ada L.", rank: "D" }]);
    });

    it("should return 409 with the current round id when the round was reset", async () => {
      // #given
      const staleRoundId = poll.roundId;
      poll.reset();

      // #when
      const response = await vote({ roundId: staleRoundId });

      // #then
      assert.equal(response.status, 409);
      assert.equal(((await response.json()) as { roundId: string }).roundId, poll.roundId);
      assert.deepEqual(poll.resultsState().ballots, []);
    });

    it("should return 400 with a readable message for an invalid rank", async () => {
      // #given / #when
      const response = await vote({ rank: "F" });

      // #then
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Rank must be one of S, A, B, C, D." });
    });

    it("should return 400 for malformed JSON", async () => {
      // #given / #when
      const response = await fetch(`${baseUrl}/api/vote`, { method: "POST", body: "{not json" });

      // #then
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Request body must be valid JSON." });
    });

    it("should return 413 for an oversized body", async () => {
      // #given / #when
      const response = await vote({ name: "x".repeat(2048) });
      await response.arrayBuffer();

      // #then
      assert.equal(response.status, 413);
    });
  });

  describe("POST /r/<token>/reset", () => {
    it("should clear all votes and start a new round", async () => {
      // #given
      await vote();
      const previousRoundId = poll.roundId;

      // #when
      const response = await fetch(`${resultsUrl()}/reset`, { method: "POST" });

      // #then
      assert.equal(response.status, 204);
      assert.notEqual(poll.roundId, previousRoundId);
      assert.deepEqual(poll.resultsState().ballots, []);
    });

    it("should not reset with the wrong token", async () => {
      // #given
      await vote();

      // #when
      const response = await fetch(`${baseUrl}/r/wrong-token-0123456789/reset`, { method: "POST" });
      await response.arrayBuffer();

      // #then
      assert.equal(response.status, 404);
      assert.equal(poll.resultsState().ballots.length, 1);
    });

    it("should not reset on GET", async () => {
      // #given
      await vote();

      // #when
      const response = await fetch(`${resultsUrl()}/reset`);
      await response.arrayBuffer();

      // #then
      assert.equal(response.status, 404);
      assert.equal(poll.resultsState().ballots.length, 1);
    });
  });

  describe("GET /api/events", () => {
    it("should send voters the round and ranks on connect", async (t) => {
      // #given
      const stream = await openEventStream<VoterState>(`${baseUrl}/api/events`);
      t.after(stream.close);

      // #when
      const initial = await stream.next();

      // #then
      assert.deepEqual(initial, { roundId: poll.roundId, ranks: ["S", "A", "B", "C", "D"] });
    });

    it("should push the new round to voters on reset without ever exposing ballots", async (t) => {
      // #given
      const stream = await openEventStream<VoterState>(`${baseUrl}/api/events`);
      t.after(stream.close);
      await stream.next();

      // #when
      await vote();
      poll.reset();
      const next = await stream.next();

      // #then
      assert.deepEqual(next, { roundId: poll.roundId, ranks: ["S", "A", "B", "C", "D"] });
    });
  });

  describe("GET /r/<token>/events", () => {
    it("should push every ballot change and reset to the results page", async (t) => {
      // #given
      const stream = await openEventStream<ResultsState>(`${resultsUrl()}/events`);
      t.after(stream.close);
      const snapshots: ResultsState["ballots"][] = [(await stream.next()).ballots];

      // #when
      await vote({ rank: "B" });
      snapshots.push((await stream.next()).ballots);
      await vote({ rank: "A" });
      snapshots.push((await stream.next()).ballots);
      await fetch(`${resultsUrl()}/reset`, { method: "POST" });
      snapshots.push((await stream.next()).ballots);

      // #then
      assert.deepEqual(snapshots, [
        [],
        [{ name: "Ada", rank: "B" }],
        [{ name: "Ada", rank: "A" }],
        [],
      ]);
    });

    it("should never include voter ids in results events", async (t) => {
      // #given
      const stream = await openEventStream<ResultsState>(`${resultsUrl()}/events`);
      t.after(stream.close);
      await stream.next();

      // #when
      await vote();
      const event = await stream.next();

      // #then
      assert.ok(!JSON.stringify(event).includes(VOTER_ID));
    });

    it("should unsubscribe from the poll when the client disconnects", async () => {
      // #given
      const stream = await openEventStream<ResultsState>(`${resultsUrl()}/events`);
      await stream.next();
      const subscribersWhileOpen = poll.activeSubscribers;

      // #when
      stream.close();

      // #then
      await waitFor(() => poll.activeSubscribers === subscribersWhileOpen - 1);
    });
  });
});
