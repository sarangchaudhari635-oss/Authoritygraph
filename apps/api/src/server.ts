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
  message: {
    error: "RATE_LIMITED",
    message: "Too many requests. Please wait before retrying."
  }
});
app.use("/api/analyze", limiter);

const analyzeSchema = z.object({
  address: z.string().trim().min(32).max(44),
  kind: z.enum(["auto", "program", "mint"]).default("auto")
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "authoritygraph-api",
    cluster: config.cluster,
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
    const isAddressError = /public key|base58|Non-base58/i.test(message);
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

const server = app.listen(config.port, () => {
  console.log(`AuthorityGraph API listening on http://localhost:${config.port}`);
  console.log(`Solana cluster label: ${config.cluster}`);
});

// ── Graceful shutdown — handle SIGTERM and SIGINT (audit finding I / deployment readiness)
function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Closing HTTP server…`);
  server.close(() => {
    console.log("HTTP server closed. Exiting.");
    process.exit(0);
  });
  // Force-exit after 10 s if connections don't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
