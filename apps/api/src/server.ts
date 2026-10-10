import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { analyzeAddress } from "./solana.js";

const app = express();

// ── Security: disable fingerprinting header (audit finding F-2)
app.disable("x-powered-by");

// ── Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "32kb" }));

// ── Rate limiting — protects public RPC endpoint from exhaustion (audit finding F-1)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // 30 requests per IP per minute
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Too many requests. Please wait before retrying."
    });
  }
});
app.use("/api/analyze", limiter);

const analyzeSchema = z.object({
  address: z.string().trim().min(32).max(44),
  kind: z.enum(["auto", "program", "mint"]).default("auto")
});

// ── Request Logging (audit finding F-9)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path === "/api/health" && res.statusCode === 200) return; // omit noisy health checks
    console.log(JSON.stringify({
      time: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration
    }));
  });
  next();
});

// ── Production CORS Validation (audit finding F-8)
if (process.env.NODE_ENV === "production" && config.corsOrigin.includes("localhost")) {
  console.warn("[SECURITY] WARNING: API is starting in production with a localhost CORS origin.");
}

app.get("/api/health", async (_req, res) => {
  // RPC Reachability check (audit finding F-7)
  let rpcOk = false;
  try {
    const { connection } = await import("./solana.js");
    // Lightweight RPC check
    const blockHeight = await Promise.race([
      connection.getBlockHeight("confirmed"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RPC_TIMEOUT")), 5000))
    ]);
    rpcOk = typeof blockHeight === "bigint" || typeof blockHeight === "number";
  } catch (err) {
    rpcOk = false;
  }

  res.status(rpcOk ? 200 : 503).json({
    status: rpcOk ? "ok" : "degraded",
    service: "authoritygraph-api",
    cluster: config.cluster,
    rpcConnected: rpcOk,
    timestamp: new Date().toISOString()
  });
});

app.post("/api/analyze", async (req, res) => {
  // Per-request timeout — prevents hung RPC calls from holding the connection indefinitely (audit finding F-3)
  res.setTimeout(15000, () => {
    if (!res.headersSent) {
      res.status(504).json({
        error: "TIMEOUT",
        message: "The analysis timed out. The RPC provider may be slow or unreachable."
      });
    }
  });

  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Provide a valid base58 Solana address and a supported analysis kind.",
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    const result = await analyzeAddress(parsed.data.address, parsed.data.kind);
    if (!res.headersSent) res.json(result);
  } catch (error) {
    if (res.headersSent) return;
    const message = error instanceof Error ? error.message : "Unknown error";
    const isAddressError = /public key|base58|Non-base58|address/i.test(message);
    res.status(isAddressError ? 400 : 502).json({
      error: isAddressError ? "INVALID_ADDRESS" : "ANALYSIS_FAILED",
      message: isAddressError
        ? "The address could not be parsed as a Solana public key."
        : "The analysis could not be completed. The RPC provider may be unavailable or rate-limited."
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Route not found." });
});

export const server = process.env.NODE_ENV !== "test" ? app.listen(config.port, () => {
  console.log(`AuthorityGraph API listening on http://localhost:${config.port}`);
  console.log(`Solana cluster label: ${config.cluster}`);
}) : null;

export default app;

// ── Graceful shutdown — handle SIGTERM and SIGINT (audit finding I / deployment readiness)
function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Closing HTTP server…`);
  if (server) {
    server.close(() => {
      console.log("HTTP server closed. Exiting.");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
  // Force-exit after 10 s if connections don't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
