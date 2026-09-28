import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase, type FakeQueryCall } from "../testUtils/fakeSupabase";
import { assignSpoolToSlot } from "./spoolService";

function useResolver(resolver: (call: FakeQueryCall) => { data: any; error: any }): FakeQueryCall[] {
  const calls: FakeQueryCall[] = [];
  const fake = createFakeSupabase((call) => {
    calls.push(call);
    return resolver(call);
  });
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation(fake.from as any);
  return calls;
}

describe("assignSpoolToSlot (escolher carretel do slot sem tag)", () => {
  it("tira o carretel de outro slot e grava no slot escolhido marcado como escolha do usuário", async () => {
    const calls = useResolver(() => ({ data: null, error: null }));
    const { error } = await assignSpoolToSlot("printer-1", 2, "spool-9", "2026-09-28T12:00:00.000Z");

    expect(error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: "ams_slots", method: "update", payload: { spool_id: null } });
    expect(calls[0].filters).toEqual([
      { col: "printer_id", val: "printer-1" },
      { col: "spool_id", val: "spool-9" },
    ]);
    expect(calls[1]).toMatchObject({
      table: "ams_slots",
      method: "upsert",
      payload: {
        printer_id: "printer-1",
        slot_index: 2,
        spool_id: "spool-9",
        assigned_by: "user",
        assigned_at: "2026-09-28T12:00:00.000Z",
      },
    });
  });

  it("banco sem a coluna assigned_by: repete sem ela (compatível antes da migration)", async () => {
    const calls = useResolver((call) =>
      call.method === "upsert" && "assigned_by" in call.payload
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'assigned_at' column of 'ams_slots'" } }
        : { data: null, error: null }
    );
    const { error } = await assignSpoolToSlot("printer-1", 0, "spool-1");

    expect(error).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[2].payload).not.toHaveProperty("assigned_by");
    expect(calls[2].payload).toMatchObject({ slot_index: 0, spool_id: "spool-1" });
  });

  it("outro erro no upsert não é mascarado", async () => {
    const calls = useResolver((call) =>
      call.method === "upsert" ? { data: null, error: { code: "42501", message: "RLS" } } : { data: null, error: null }
    );
    const { error } = await assignSpoolToSlot("printer-1", 0, "spool-1");
    expect(error).toMatchObject({ code: "42501" });
    expect(calls).toHaveLength(2);
  });

  it("erro ao liberar o slot anterior interrompe sem gravar", async () => {
    const calls = useResolver((call) =>
      call.method === "update" ? { data: null, error: { message: "RLS" } } : { data: null, error: null }
    );
    const { error } = await assignSpoolToSlot("printer-1", 0, "spool-1");
    expect(error).toEqual({ message: "RLS" });
    expect(calls).toHaveLength(1);
  });
});
