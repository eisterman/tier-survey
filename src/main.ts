import { createApp, RESULTS_TOKEN_PATTERN } from "./server.ts";

const DEFAULT_PORT = 3000;

const resultsToken = process.env.RESULTS_TOKEN ?? "";
if (!RESULTS_TOKEN_PATTERN.test(resultsToken)) {
  console.error("RESULTS_TOKEN must be set to at least 16 characters of A-Z, a-z, 0-9, '_' or '-'.");
  console.error("Generate one with: openssl rand -hex 16");
  process.exit(1);
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`PORT must be an integer between 1 and 65535, got "${process.env.PORT}".`);
  process.exit(1);
}

const server = await createApp({ resultsToken });

server.listen(port, () => {
  console.log(`Voting page:  http://localhost:${port}/`);
  console.log(`Results page: http://localhost:${port}/r/${resultsToken}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
