# valepuzza

Live S–D tier vote. Voters enter a name and pick a rank (they can change it at any time).
A results page on a secret link shows who voted what in real time and can clear the round.

Everything is kept in memory: restarting the container clears all votes.

## Pages

| URL | Who |
|---|---|
| `/` | Voters |
| `/r/<RESULTS_TOKEN>` | Whoever runs the event. Anyone with this link can see names and clear votes. |

## Development

Requires Node 26 and pnpm 12.

```sh
pnpm install
echo "RESULTS_TOKEN=$(openssl rand -hex 16)" > .env
pnpm dev
pnpm typecheck
pnpm test
```

`pnpm start` and `pnpm dev` load `.env` if it exists; variables already set in the shell take precedence.

## Deploy

```sh
echo "RESULTS_TOKEN=$(openssl rand -hex 16)" > .env
docker compose up -d --build
docker compose logs vote   # prints the voting and results URLs
```

The container listens on `127.0.0.1:3000`. Put nginx in front of it using `deploy/nginx.conf`.
