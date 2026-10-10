import dotenv from "dotenv";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.API_ENV_FILE ?? path.resolve(__dirname, "../../.env") });
// Fallback if we are in apps/api 
dotenv.config({ path: process.env.API_ENV_FILE ?? path.resolve(__dirname, "../.env") });

if (!process.env.SOLANA_RPC_URL) {
  console.warn("[AuthorityGraph] SOLANA_RPC_URL not set — using public mainnet endpoint (may be rate-limited).");
}

const port = Number(process.env.PORT ?? 4000);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? 12000);

export const config = {
  port: Number.isFinite(port) ? port : 4000,
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  cluster: process.env.SOLANA_CLUSTER ?? "mainnet-beta",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : 12000
};
