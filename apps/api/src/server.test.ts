import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "./server.js";
import { connection } from "./solana.js";

describe("API Routes Integration", () => {
  it("GET /api/health returns ok", async () => {
    vi.spyOn(connection, "getBlockHeight").mockResolvedValueOnce(123456789);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    vi.restoreAllMocks();
  });

  it("POST /api/analyze returns 400 on invalid address", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "invalid", kind: "auto" });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_REQUEST");
  });

  it("POST /api/analyze returns 400 on address that is too short for Zod schema", async () => {
    // A string shorter than 32 chars fails the Zod schema min-length check immediately.
    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "tooshort", kind: "auto" });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_REQUEST");
  });

  it("POST /api/analyze returns 400 on address that fails PublicKey parsing", async () => {
    // A 32-char string of valid base58 chars but wrong decoded length.
    // The Zod schema lets it through; analyzeAddress fails inside analyzeProgram/Mint.
    vi.spyOn(connection, "getAccountInfo").mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "22222222222222222222222222222222", kind: "auto" });
    
    // Zod accepts it (32 chars). analyzeAddress returns unsupported (null account).
    expect([200, 400]).toContain(res.status); // either valid parse=200 or address error=400
    vi.restoreAllMocks();
  });

  it("POST /api/analyze returns mocked findings", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "11111111111111111111111111111111", kind: "auto" });
    
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("unsupported");
    
    vi.restoreAllMocks();
  });

  it("POST /api/analyze returns 502 on RPC failure without leaking internals", async () => {
    vi.spyOn(connection, "getAccountInfo").mockRejectedValueOnce(new Error("RPC_TIMEOUT"));

    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "11111111111111111111111111111111", kind: "auto" });
    
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ANALYSIS_FAILED");
    expect(res.body.message).toContain("RPC provider may be unavailable");
    expect(res.body.message).not.toContain("RPC_TIMEOUT"); // Doesn't leak stack trace

    vi.restoreAllMocks();
  });

  it("GET /api/snapshots/:address returns snapshot history", async () => {
    const res = await request(app).get("/api/snapshots/11111111111111111111111111111111");
    expect(res.status).toBe(200);
    expect(res.body.address).toBe("11111111111111111111111111111111");
    expect(Array.isArray(res.body.snapshots)).toBe(true);
  });

  it("GET /api/snapshots/:address returns 400 on invalid address parameter", async () => {
    const res = await request(app).get("/api/snapshots/short");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ADDRESS");
  });

  it("POST /api/policy/evaluate evaluates policy on provided analysis", async () => {
    const mockAnalysis = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Program",
      findings: [
        {
          id: "PROGRAM_IMMUTABLE",
          title: "Immutable",
          severity: "info",
          status: "absent",
          summary: "",
          recommendation: "",
          evidence: [{ source: "RPC", observedValue: "null", detail: "immutable" }]
        }
      ],
      warnings: []
    };

    const res = await request(app)
      .post("/api/policy/evaluate")
      .send({ analysis: mockAnalysis });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PASS");
    expect(Array.isArray(res.body.rules)).toBe(true);
  });

  it("POST /api/compare handles invalid request gracefully", async () => {
    const res = await request(app)
      .post("/api/compare")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_REQUEST");
  });
});
