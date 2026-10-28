import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Poll, type PollEvent } from "../src/poll.ts";

describe("Poll", () => {
  describe("voterState", () => {
    it("should expose exactly the S–D ranks in order", () => {
      // #given
      const poll = new Poll();

      // #when
      const { ranks } = poll.voterState();

      // #then
      assert.deepEqual(ranks, ["S", "A", "B", "C", "D"]);
    });
  });

  describe("castBallot", () => {
    it("should record a ballot for the current round", () => {
      // #given
      const poll = new Poll();

      // #when
      const result = poll.castBallot(poll.roundId, "voter-1", { name: "Ada", rank: "S" });

      // #then
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(poll.resultsState().ballots, [{ name: "Ada", rank: "S" }]);
    });

    it("should replace a voter's previous ballot instead of adding a second one", () => {
      // #given
      const poll = new Poll();
      poll.castBallot(poll.roundId, "voter-1", { name: "Ada", rank: "S" });

      // #when
      poll.castBallot(poll.roundId, "voter-1", { name: "Ada L.", rank: "C" });

      // #then
      assert.deepEqual(poll.resultsState().ballots, [{ name: "Ada L.", rank: "C" }]);
    });

    it("should keep separate ballots for different voters sharing a name", () => {
      // #given
      const poll = new Poll();

      // #when
      poll.castBallot(poll.roundId, "voter-1", { name: "Marco", rank: "S" });
      poll.castBallot(poll.roundId, "voter-2", { name: "Marco", rank: "D" });

      // #then
      assert.deepEqual(poll.resultsState().ballots, [
        { name: "Marco", rank: "S" },
        { name: "Marco", rank: "D" },
      ]);
    });

    it("should reject a ballot for a stale round and report the current round", () => {
      // #given
      const poll = new Poll();
      const staleRoundId = poll.roundId;
      poll.reset();

      // #when
      const result = poll.castBallot(staleRoundId, "voter-1", { name: "Ada", rank: "S" });

      // #then
      assert.deepEqual(result, { ok: false, currentRoundId: poll.roundId });
      assert.deepEqual(poll.resultsState().ballots, []);
    });
  });

  describe("resultsState", () => {
    it("should sort ballots by name", () => {
      // #given
      const poll = new Poll();
      poll.castBallot(poll.roundId, "voter-1", { name: "Zoe", rank: "A" });
      poll.castBallot(poll.roundId, "voter-2", { name: "Ada", rank: "B" });

      // #when
      const names = poll.resultsState().ballots.map((ballot) => ballot.name);

      // #then
      assert.deepEqual(names, ["Ada", "Zoe"]);
    });

    it("should not let callers mutate stored ballots through the returned state", () => {
      // #given
      const poll = new Poll();
      poll.castBallot(poll.roundId, "voter-1", { name: "Ada", rank: "S" });

      // #when
      const [returned] = poll.resultsState().ballots;
      assert.ok(returned);
      returned.name = "Mallory";

      // #then
      assert.deepEqual(poll.resultsState().ballots, [{ name: "Ada", rank: "S" }]);
    });
  });

  describe("reset", () => {
    it("should clear ballots and start a new round", () => {
      // #given
      const poll = new Poll();
      const firstRoundId = poll.roundId;
      poll.castBallot(firstRoundId, "voter-1", { name: "Ada", rank: "S" });

      // #when
      poll.reset();

      // #then
      assert.notEqual(poll.roundId, firstRoundId);
      assert.deepEqual(poll.resultsState().ballots, []);
    });
  });

  describe("subscribe", () => {
    it("should notify accepted ballots and resets, but not rejected ballots or after unsubscribing", () => {
      // #given
      const poll = new Poll();
      const events: PollEvent[] = [];
      const unsubscribe = poll.subscribe((event) => events.push(event));

      // #when
      poll.castBallot(poll.roundId, "voter-1", { name: "Ada", rank: "S" });
      poll.castBallot("stale-round", "voter-1", { name: "Ada", rank: "A" });
      poll.reset();
      unsubscribe();
      poll.reset();

      // #then
      assert.deepEqual(events, ["ballot", "reset"]);
    });
  });

});
