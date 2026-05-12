import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Index, type MessageStatus, maxStatus, merge } from "../../src/core/merge";

const FIX = resolve(process.cwd(), "test/fixtures/merge");

interface Fixture {
  name: string;
  local: Index;
  remote: Index;
  pending_ids: string[];
  pending_deletes: string[];
  expected_ids: string[];
  expected_status_by_id: Record<string, MessageStatus>;
}

function loadFixture(filename: string): Fixture {
  return JSON.parse(readFileSync(resolve(FIX, filename), "utf-8")) as Fixture;
}

describe("merge: shared fixture corpus (must match src/merge.rs)", () => {
  const files = readdirSync(FIX)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const f of files) {
    it(`matches Rust merge for ${f}`, () => {
      const fx = loadFixture(f);
      const out = merge(
        fx.local,
        fx.remote,
        new Set(fx.pending_ids),
        new Set(fx.pending_deletes),
      );
      const actualIds = out.messages.map((m) => m.id);

      expect(new Set(actualIds), `fixture: ${fx.name}`).toEqual(
        new Set(fx.expected_ids),
      );
      expect(actualIds.length, `fixture: ${fx.name}`).toBe(
        fx.expected_ids.length,
      );

      for (const [id, status] of Object.entries(fx.expected_status_by_id)) {
        const e = out.messages.find((m) => m.id === id);
        expect(e, `fixture: ${fx.name} expected id ${id}`).toBeDefined();
        expect(e?.status, `fixture: ${fx.name} status for ${id}`).toBe(status);
      }
    });
  }
});

describe("merge: maxStatus is commutative", () => {
  it("max(unread, read) == max(read, unread) == read", () => {
    expect(maxStatus("unread", "read")).toBe("read");
    expect(maxStatus("read", "unread")).toBe("read");
  });

  it("ordering: unread < read < consumed < expired", () => {
    expect(maxStatus("unread", "expired")).toBe("expired");
    expect(maxStatus("read", "consumed")).toBe("consumed");
    expect(maxStatus("consumed", "expired")).toBe("expired");
  });

  it("max(s, s) == s for every status", () => {
    for (const s of ["unread", "read", "consumed", "expired"] as MessageStatus[]) {
      expect(maxStatus(s, s)).toBe(s);
    }
  });
});

describe("merge: regression — non-commutative for unilateral entries", () => {
  // Mirror src/merge.rs::test_merge_is_not_commutative_for_unilateral_entries.
  // The same single-id input should produce DIFFERENT outputs when the roles
  // of local and remote are swapped. This locks in the asymmetry.
  it("remote-only kept (a, b) but local-only dropped when swapped", () => {
    const empty: Index = { version: 1, messages: [] };
    const withA: Index = {
      version: 1,
      messages: [
        {
          id: "a",
          created_at: "2026-01-01T00:00:00Z",
          tags: [],
          ttl_seconds: null,
          expires_at: null,
          status: "unread",
          content_preview: "msg a",
        },
      ],
    };
    const noPending = new Set<string>();

    const ab = merge(empty, withA, noPending, noPending);
    const ba = merge(withA, empty, noPending, noPending);

    expect(ab.messages.map((m) => m.id)).toEqual(["a"]);
    expect(ba.messages).toEqual([]);
  });
});
