import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_NAME_LENGTH, parseVoteRequest } from "../src/vote-request.ts";

const VALID = { roundId: "round-1", voterId: "0123456789abcdef0123456789abcdef", name: "Ada", rank: "S" };

function errorFor(body: unknown): string | undefined {
  const result = parseVoteRequest(body);
  return result.ok ? undefined : result.error;
}

describe("parseVoteRequest", () => {
  describe("valid input", () => {
    it("should accept a well-formed request", () => {
      // #given / #when
      const result = parseVoteRequest(VALID);

      // #then
      assert.deepEqual(result, { ok: true, value: VALID });
    });

    it("should collapse and trim whitespace in names", () => {
      // #given
      const body = { ...VALID, name: "  Ada \n  Lovelace\t" };

      // #when
      const result = parseVoteRequest(body);

      // #then
      assert.deepEqual(result, { ok: true, value: { ...VALID, name: "Ada Lovelace" } });
    });

    it("should drop unknown fields", () => {
      // #given
      const body = { ...VALID, admin: true };

      // #when
      const result = parseVoteRequest(body);

      // #then
      assert.deepEqual(result, { ok: true, value: VALID });
    });

    it(`should accept a name of exactly ${MAX_NAME_LENGTH} characters made of astral-plane symbols`, () => {
      // #given
      const body = { ...VALID, name: "🦊".repeat(MAX_NAME_LENGTH) };

      // #when
      const result = parseVoteRequest(body);

      // #then
      assert.equal(result.ok, true);
    });
  });

  describe("invalid input", () => {
    for (const body of [null, undefined, "S", 42]) {
      it(`should reject a non-object body: ${String(body)}`, () => {
        // #given / #when
        const error = errorFor(body);

        // #then
        assert.equal(error, "Request body must be a JSON object.");
      });
    }

    for (const roundId of [undefined, "", 7]) {
      it(`should reject round id ${JSON.stringify(roundId)}`, () => {
        // #given / #when
        const error = errorFor({ ...VALID, roundId });

        // #then
        assert.equal(error, "Missing round id.");
      });
    }

    for (const voterId of [undefined, "", "abc", "0123456789ABCDEF0123456789ABCDEF", "z123456789abcdef0123456789abcdef"]) {
      it(`should reject voter id ${JSON.stringify(voterId)}`, () => {
        // #given / #when
        const error = errorFor({ ...VALID, voterId });

        // #then
        assert.equal(error, "Invalid voter id.");
      });
    }

    for (const rank of [undefined, "E", "F", "s", 1]) {
      it(`should reject rank ${JSON.stringify(rank)}`, () => {
        // #given / #when
        const error = errorFor({ ...VALID, rank });

        // #then
        assert.equal(error, "Rank must be one of S, A, B, C, D.");
      });
    }

    for (const name of [undefined, "", "   \n\t", 7]) {
      it(`should reject missing or blank name ${JSON.stringify(name)}`, () => {
        // #given / #when
        const error = errorFor({ ...VALID, name });

        // #then
        assert.equal(error, "Enter your name.");
      });
    }

    it("should reject control characters in names", () => {
      // #given / #when
      const error = errorFor({ ...VALID, name: "Ada\u0000" });

      // #then
      assert.equal(error, "Name contains characters that aren't allowed.");
    });

    it(`should reject a name longer than ${MAX_NAME_LENGTH} characters`, () => {
      // #given / #when
      const error = errorFor({ ...VALID, name: "🦊".repeat(MAX_NAME_LENGTH + 1) });

      // #then
      assert.equal(error, `Name must be at most ${MAX_NAME_LENGTH} characters.`);
    });
  });
});
