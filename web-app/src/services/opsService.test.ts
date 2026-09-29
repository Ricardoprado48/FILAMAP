import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase } from "../testUtils/fakeSupabase";
import { isOpsAdmin, sortTimeline, clockSkewMinutes, groupErrors, type OpsEventRow } from "./opsService";

const ev = (over: Partial<OpsEventRow>): OpsEventRow => ({
  id: 1, installation_id: "i", boot_id: "b", seq: 1, occurred_at: "2026-10-01T10:00:00Z", received_at: "2026-10-01T10:00:05Z",
  app_version: "4.2.0", event_type: "JOB_DETECTED", severity: "INFO", component: "job", printer_id: null, job_id: null, spool_id: null,
  error_code: null, fingerprint: null, message: null, repeat_count: 1, metadata: {}, ...over,
});

describe("isOpsAdmin", () => {
  it("true só com linha em ops_admins; sem usuário nem consulta", async () => {
    const fake = createFakeSupabase(() => ({ data: [{ user_id: "u1" }], error: null }));
    vi.mocked(supabase.from).mockImplementation(fake.from as any);
    expect(await isOpsAdmin("u1")).toBe(true);
    const empty = createFakeSupabase(() => ({ data: [], error: null }));
    vi.mocked(supabase.from).mockImplementation(empty.from as any);
    expect(await isOpsAdmin("u2")).toBe(false);
    vi.mocked(supabase.from).mockClear();
    expect(await isOpsAdmin(undefined)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("timeline", () => {
  it("ordena por horário e desempata por sequência do mesmo boot", () => {
    const r = sortTimeline([ev({ id: 1, seq: 1 }), ev({ id: 2, seq: 2 }), ev({ id: 3, occurred_at: "2026-10-01T11:00:00Z" })]);
    expect(r.map((x) => x.id)).toEqual([3, 2, 1]);
  });
  it("mede relógio divergente em minutos", () => {
    expect(clockSkewMinutes(ev({ occurred_at: "2026-10-01T10:00:00Z", received_at: "2026-10-01T10:10:00Z" }))).toBe(10);
  });
  it("agrupa erros pela impressão digital somando repetições", () => {
    const g = groupErrors([
      ev({ id: 1, severity: "ERROR", fingerprint: "f1", repeat_count: 3 }),
      ev({ id: 2, severity: "ERROR", fingerprint: "f1", repeat_count: 2, occurred_at: "2026-10-01T12:00:00Z" }),
      ev({ id: 3, severity: "WARNING", fingerprint: "f2" }),
      ev({ id: 4, severity: "INFO", fingerprint: "f3" }),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ fingerprint: "f1", count: 5 });
    expect(g[0].last.id).toBe(2);
  });
});
