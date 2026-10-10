import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

describe("address validation primitives", () => {
  it("accepts a valid public key", () => {
    const key = new PublicKey("11111111111111111111111111111111");
    expect(key.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("rejects an invalid public key", () => {
    expect(() => new PublicKey("not a valid address")).toThrow();
  });
});
