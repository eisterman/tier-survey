import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import { Poll, type PollEvent } from "./poll.ts";
import { parseVoteRequest } from "./vote-request.ts";

const MAX_BODY_BYTES = 1024;
const HEARTBEAT_INTERVAL_MS = 25_000;
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

export const RESULTS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

export type AppOptions = {
  resultsToken: string;
  poll?: Poll;
};

type StaticAsset = { body: Buffer; contentType: string };
type Route = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function createApp({ resultsToken, poll = new Poll() }: AppOptions): Promise<Server> {
  if (!RESULTS_TOKEN_PATTERN.test(resultsToken)) {
    throw new Error("Results token must be at least 16 characters of A-Z, a-z, 0-9, '_' or '-'.");
  }

  const [votePage, resultsPage, stylesheet] = await Promise.all([
    loadAsset("vote.html", "text/html; charset=utf-8"),
    loadAsset("results.html", "text/html; charset=utf-8"),
    loadAsset("style.css", "text/css; charset=utf-8"),
  ]);

  const resultsPath = `/r/${resultsToken}`;
  const routes = new Map<string, Route>([
    ["GET /", (_req, res) => sendAsset(res, votePage)],
    ["GET /style.css", (_req, res) => sendAsset(res, stylesheet)],
    ["GET /api/events", (_req, res) => openEventStream(res, poll, "voter")],
    ["POST /api/vote", (req, res) => handleVote(req, res, poll)],
    [`GET ${resultsPath}`, (_req, res) => sendAsset(res, resultsPage)],
    [`GET ${resultsPath}/events`, (_req, res) => openEventStream(res, poll, "results")],
    [
      `POST ${resultsPath}/reset`,
      (_req, res) => {
        poll.reset();
        res.writeHead(204).end();
      },
    ],
  ]);

  return createServer(async (req, res) => {
    const route = routes.get(`${req.method} ${normalizePath(req.url)}`);
    try {
      if (!route) throw new HttpError(404, "Not found.");
      await route(req, res);
    } catch (error) {
      handleError(res, error);
    }
  });
}

async function loadAsset(fileName: string, contentType: string): Promise<StaticAsset> {
  return { body: await readFile(join(PUBLIC_DIR, fileName)), contentType };
}

function normalizePath(url: string | undefined): string {
  const { pathname } = new URL(url ?? "/", "http://localhost");
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function sendAsset(res: ServerResponse, asset: StaticAsset): void {
  res
    .writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    })
    .end(asset.body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

async function handleVote(req: IncomingMessage, res: ServerResponse, poll: Poll): Promise<void> {
  const parsed = parseVoteRequest(await readJsonBody(req));
  if (!parsed.ok) throw new HttpError(400, parsed.error);

  const { roundId, voterId, name, rank } = parsed.value;
  const result = poll.castBallot(roundId, voterId, { name, rank });
  if (!result.ok) {
    sendJson(res, 409, { error: "Voting was reset. Pick again.", roundId: result.currentRoundId });
    return;
  }
  res.writeHead(204).end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

/**
 * Voters only hear about round changes; ballots are pushed exclusively to the
 * results stream so names never reach the voting page.
 */
function openEventStream(res: ServerResponse, poll: Poll, audience: "voter" | "results"): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });

  const send = () => {
    const state = audience === "results" ? poll.resultsState() : poll.voterState();
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  const onPollEvent = (event: PollEvent) => {
    if (audience === "results" || event === "reset") send();
  };

  send();
  const unsubscribe = poll.subscribe(onPollEvent);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);
  res.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function handleError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    if (!res.headersSent) sendJson(res, error.status, { error: error.message });
    return;
  }
  console.error(error);
  if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong on the server." });
  else res.destroy();
}
