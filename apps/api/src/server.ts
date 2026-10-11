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
import { defaultSnapshotStore } from "./snapshot-store.js";
import { evaluatePolicy, DEFAULT_BASELINE_POLICY } from "./policy-engine.js";
import type { SecurityPolicy, AnalysisResponse } from "./types.js";

// Rate limiting applies to analyze and evaluation endpoints
app.use("/api/analyze", limiter);
app.use("/api/compare", limiter);

const analyzeSchema = z.object({
  address: z.string().trim().min(32).max(44),
  kind: z.enum(["auto", "program", "mint"]).default("auto")
});

const addressParamSchema = z.string().trim().min(32).max(44);

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

    // Persist snapshot on analysis
    try {
      defaultSnapshotStore.saveSnapshot(result);
    } catch (saveErr) {
      console.warn("[SnapshotStore] Error saving snapshot:", saveErr);
    }

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

// ── Historical Snapshots Endpoints (Feature Four)
app.get("/api/snapshots/:address", (req, res) => {
  const addressParam = addressParamSchema.safeParse(req.params.address);
  if (!addressParam.success) {
    res.status(400).json({
      error: "INVALID_ADDRESS",
      message: "Address parameter must be a 32-44 character base58 string."
    });
    return;
  }

  const snapshots = defaultSnapshotStore.getSnapshots(addressParam.data);
  res.json({
    address: addressParam.data,
    count: snapshots.length,
    snapshots
  });
});

app.get("/api/snapshots/:address/history", (req, res) => {
  const addressParam = addressParamSchema.safeParse(req.params.address);
  if (!addressParam.success) {
    res.status(400).json({
      error: "INVALID_ADDRESS",
      message: "Address parameter must be a 32-44 character base58 string."
    });
    return;
  }

  const snapshots = defaultSnapshotStore.getSnapshots(addressParam.data);
  if (snapshots.length < 2) {
    res.json({
      address: addressParam.data,
      count: snapshots.length,
      hasHistory: false,
      comparisons: [],
      allChanges: []
    });
    return;
  }

  const comparisons = [];
  const allChanges = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const comparison = defaultSnapshotStore.compare(prev, curr);
    comparisons.push(comparison);
    allChanges.push(...comparison.changes);
  }

  res.json({
    address: addressParam.data,
    count: snapshots.length,
    hasHistory: true,
    comparisons,
    allChanges
  });
});

// ── Snapshot Comparison Endpoint (Feature Four)
app.post("/api/compare", (req, res) => {
  const { previousSnapshot, currentSnapshot, address } = req.body || {};

  if (previousSnapshot && currentSnapshot) {
    try {
      const comparison = defaultSnapshotStore.compare(previousSnapshot, currentSnapshot);
      res.json(comparison);
      return;
    } catch {
      res.status(400).json({
        error: "INVALID_SNAPSHOTS",
        message: "Invalid snapshot objects provided for comparison."
      });
      return;
    }
  }

  if (address) {
    const valid = addressParamSchema.safeParse(address);
    if (!valid.success) {
      res.status(400).json({
        error: "INVALID_ADDRESS",
        message: "Address must be a valid Solana public key string."
      });
      return;
    }

    const snaps = defaultSnapshotStore.getSnapshots(valid.data);
    if (snaps.length < 2) {
      res.status(404).json({
        error: "INSUFFICIENT_SNAPSHOTS",
        message: `Fewer than 2 snapshots found for address ${valid.data}. Run an analysis first to generate historical records.`
      });
      return;
    }

    const prev = snaps[snaps.length - 2];
    const curr = snaps[snaps.length - 1];
    const comparison = defaultSnapshotStore.compare(prev, curr);
    res.json(comparison);
    return;
  }

  res.status(400).json({
    error: "INVALID_REQUEST",
    message: "Provide either { previousSnapshot, currentSnapshot } or an { address } with stored history."
  });
});

// ── Policy Evaluation Endpoint (Feature Five)
app.post("/api/policy/evaluate", (req, res) => {
  const { analysis, policy } = req.body || {};

  if (!analysis || typeof analysis !== "object" || !analysis.address) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Provide a valid AnalysisResponse object to evaluate."
    });
    return;
  }

  try {
    const evaluation = evaluatePolicy(
      analysis as AnalysisResponse,
      (policy as SecurityPolicy) || DEFAULT_BASELINE_POLICY
    );
    res.json(evaluation);
  } catch (err) {
    res.status(500).json({
      error: "EVALUATION_FAILED",
      message: err instanceof Error ? err.message : "Policy evaluation failed"
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
