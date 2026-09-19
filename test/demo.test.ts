import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("offline CLI demo", () => {
  it("runs without network/key, labels fixtures, persists and deduplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "polygraph-"));
    const db = join(dir, "demo.sqlite");
    const env = {
      ...process.env,
      AI_GATEWAY_API_KEY: "",
      POLYGRAPH_DB_PATH: db,
    };
    const first = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "demo"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("OFFLINE FIXTURE / MOCK CLASSIFICATION");
    expect(first.stdout).toContain('"accepted": 1');
    const second = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "demo"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain(
      "existing fixture position was not duplicated",
    );
    expect(readFileSync(db).length).toBeGreaterThan(0);
  });
});
