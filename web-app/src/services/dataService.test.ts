import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase } from "../testUtils/fakeSupabase";
import { fetchInventory } from "./dataService";

describe("fetchInventory", () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset();
  });

  it("carrega os spools retornados pelo Supabase para o usuário autenticado (RLS filtra por sessão, não por parâmetro explícito)", async () => {
    const rows = [
      { id: "a", color_name: "Azul", bambu_spool_id: null },
      { id: "b", color_name: "Vermelho", bambu_spool_id: "15582983" },
    ];

    const fake = createFakeSupabase(() => ({ data: rows, error: null }));
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const result = await fetchInventory();

    expect(result).toEqual(rows);
  });

  it("retorna null quando o Supabase responde com erro, sem lançar exceção", async () => {
    const fake = createFakeSupabase(() => ({
      data: null,
      error: { message: "RLS violation", code: "42501" },
    }));
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const result = await fetchInventory();

    expect(result).toBeNull();
  });
});
