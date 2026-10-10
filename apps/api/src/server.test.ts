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

  it("POST /api/analyze returns 400 on non-base58 address", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .send({ address: "22222222222222222222222222222222", kind: "auto" });
    
    expect(res.status).toBe(400);
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
});
