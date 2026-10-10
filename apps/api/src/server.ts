import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { analyzeAddress } from "./solana.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "32kb" }));

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
    res.json(result);
  } catch (error) {
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

app.listen(config.port, () => {
  console.log(`AuthorityGraph API listening on http://localhost:${config.port}`);
  console.log(`Solana cluster label: ${config.cluster}`);
});
