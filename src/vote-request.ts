import { RANKS, type Rank } from "./poll.ts";

export const MAX_NAME_LENGTH = 40;

const VOTER_ID_PATTERN = /^[0-9a-f]{32}$/;
const CONTROL_CHARACTERS = /\p{Cc}/u;

export type VoteRequest = {
  roundId: string;
  voterId: string;
  name: string;
  rank: Rank;
};

export type ParseResult = { ok: true; value: VoteRequest } | { ok: false; error: string };

export function parseVoteRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const { roundId, voterId, name, rank } = body as Record<string, unknown>;

  if (typeof roundId !== "string" || roundId === "") {
    return { ok: false, error: "Missing round id." };
  }
  if (typeof voterId !== "string" || !VOTER_ID_PATTERN.test(voterId)) {
    return { ok: false, error: "Invalid voter id." };
  }
  if (!isRank(rank)) {
    return { ok: false, error: `Rank must be one of ${RANKS.join(", ")}.` };
  }
  if (typeof name !== "string") {
    return { ok: false, error: "Enter your name." };
  }

  const normalizedName = normalizeName(name);
  if (normalizedName === "") {
    return { ok: false, error: "Enter your name." };
  }
  if (CONTROL_CHARACTERS.test(normalizedName)) {
    return { ok: false, error: "Name contains characters that aren't allowed." };
  }
  if ([...normalizedName].length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }

  return { ok: true, value: { roundId, voterId, name: normalizedName, rank } };
}

function normalizeName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

function isRank(value: unknown): value is Rank {
  return typeof value === "string" && (RANKS as readonly string[]).includes(value);
}
