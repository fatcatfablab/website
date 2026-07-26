import { describe, expect, it } from "vitest";
import { GET } from "../src/pages/healthz";

describe("GET /healthz", () => {
  it("returns status 200 with a healthy JSON response", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
