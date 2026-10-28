import { randomUUID } from "node:crypto";

export const RANKS = ["S", "A", "B", "C", "D"] as const;
export type Rank = (typeof RANKS)[number];

export type Ballot = {
  name: string;
  rank: Rank;
};

export type VoterState = {
  roundId: string;
  ranks: readonly Rank[];
};

export type ResultsState = VoterState & {
  ballots: Ballot[];
};

export type PollEvent = "ballot" | "reset";
type Listener = (event: PollEvent) => void;

export type CastResult = { ok: true } | { ok: false; currentRoundId: string };

/**
 * Round ids are random rather than sequential so that a server restart can never
 * reissue an id that browsers still hold from before the restart.
 */
export class Poll {
  #roundId = randomUUID();
  #ballots = new Map<string, Ballot>();
  #listeners = new Set<Listener>();

  get roundId(): string {
    return this.#roundId;
  }

  castBallot(roundId: string, voterId: string, ballot: Ballot): CastResult {
    if (roundId !== this.#roundId) {
      return { ok: false, currentRoundId: this.#roundId };
    }
    this.#ballots.set(voterId, { ...ballot });
    this.#emit("ballot");
    return { ok: true };
  }

  reset(): void {
    this.#roundId = randomUUID();
    this.#ballots.clear();
    this.#emit("reset");
  }

  voterState(): VoterState {
    return { roundId: this.#roundId, ranks: RANKS };
  }

  resultsState(): ResultsState {
    const ballots = [...this.#ballots.values()]
      .map((ballot) => ({ ...ballot }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...this.voterState(), ballots };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: PollEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
