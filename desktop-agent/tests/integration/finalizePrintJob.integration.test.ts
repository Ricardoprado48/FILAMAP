// Teste de integração REAL contra um projeto Supabase de teste (não mockado).
//
// Requer as seguintes variáveis de ambiente (mesmas credenciais do .env do
// Agent, mas apontando para um projeto/usuário DE TESTE -- nunca produção):
//   SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL, AGENT_PASSWORD
//
// Sem essas variáveis o teste é pulado (não falha, não finge passar) --
// rode com `npm run test:integration` depois de exportá-las no shell.
//
// NÃO FOI EXECUTADO nesta sessão: sem credenciais de um projeto Supabase de
// teste disponíveis no ambiente sandbox. Ver docs/10_NIVEL_3_RELATORIO.md.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const AGENT_EMAIL = process.env.AGENT_EMAIL;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD;

const hasCredentials = !!(SUPABASE_URL && SUPABASE_ANON_KEY && AGENT_EMAIL && AGENT_PASSWORD);

describe.skipIf(!hasCredentials)("finalize_print_job (RPC real no Supabase)", () => {
  // createClient só é chamado se hasCredentials -- describe.skipIf pula os
  // testes, mas ainda executa o corpo síncrono do describe na coleta, e
  // createClient("", "") lança antes mesmo do skip ter efeito.
  const supabase = hasCredentials ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : (null as any);
  let spoolId: string;
  const initialWeight = 500;

  beforeAll(async () => {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: AGENT_EMAIL!,
      password: AGENT_PASSWORD!,
    });
    if (authError) throw new Error(`Login falhou: ${authError.message}`);

    const { data: spool, error } = await supabase
      .from("spools")
      .insert({
        nfc_uid: `TEST-${randomUUID()}`,
        brand: "TesteIntegracao",
        material: "PETG",
        color_name: "Teste",
        color_hex: "#000000",
        initial_weight: initialWeight,
        current_weight: initialWeight,
        spool_tare_weight: 218,
      })
      .select()
      .single();
    if (error || !spool) throw new Error(`Falha ao criar spool de teste: ${error?.message}`);
    spoolId = spool.id;
  });

  afterAll(async () => {
    if (spoolId) {
      await supabase.from("print_logs").delete().eq("spool_id", spoolId);
      await supabase.from("spools").delete().eq("id", spoolId);
    }
  });

  it("desconta o peso do spool e grava print_logs numa chamada", async () => {
    const jobId = randomUUID();
    const { data, error } = await supabase.rpc("finalize_print_job", {
      p_job_id: jobId,
      p_printer_id: null,
      p_subtask_name: "Teste de integração",
      p_print_duration_minutes: 10,
      p_status: "COMPLETED",
      p_items: [{ spool_id: spoolId, slot_index: 0, grams: 15, consumption_quality: "exact", orphan_slot: false }],
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].filament_used_g).toBe(15);

    const { data: spool } = await supabase.from("spools").select("current_weight").eq("id", spoolId).single();
    expect(spool?.current_weight).toBe(initialWeight - 15);
  });

  it("é idempotente: reprocessar o mesmo job_id não desconta de novo", async () => {
    const jobId = randomUUID();
    const items = [{ spool_id: spoolId, slot_index: 0, grams: 10, consumption_quality: "exact", orphan_slot: false }];

    await supabase.rpc("finalize_print_job", {
      p_job_id: jobId, p_printer_id: null, p_subtask_name: "Idempotência", p_print_duration_minutes: 5, p_status: "COMPLETED", p_items: items,
    });
    const { data: afterFirst } = await supabase.from("spools").select("current_weight").eq("id", spoolId).single();

    const { data: secondCall } = await supabase.rpc("finalize_print_job", {
      p_job_id: jobId, p_printer_id: null, p_subtask_name: "Idempotência", p_print_duration_minutes: 5, p_status: "COMPLETED", p_items: items,
    });
    const { data: afterSecond } = await supabase.from("spools").select("current_weight").eq("id", spoolId).single();

    expect(secondCall).toHaveLength(1);
    expect(afterSecond?.current_weight).toBe(afterFirst?.current_weight);
  });
});
