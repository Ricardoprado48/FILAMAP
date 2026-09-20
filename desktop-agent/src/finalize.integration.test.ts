import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/['"]/g, "")
  .replace(/\/$/, "");

const SUPABASE_ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  ""
)
  .trim()
  .replace(/['"]/g, "");

const AGENT_EMAIL = (process.env.AGENT_EMAIL || "").trim();
const AGENT_PASSWORD = (process.env.AGENT_PASSWORD || "").trim();

if (
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !AGENT_EMAIL ||
  !AGENT_PASSWORD
) {
  throw new Error(
    "Configure SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL e AGENT_PASSWORD no .env"
  );
}

test(
  "finalize_print_job é idempotente e não desconta o mesmo job duas vezes",
  async () => {
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: authData,
      error: authError,
    } = await supabase.auth.signInWithPassword({
      email: AGENT_EMAIL,
      password: AGENT_PASSWORD,
    });

    assert.equal(authError, null);
    assert.ok(authData.user);

    const userId = authData.user.id;

    const token = randomUUID().replace(/-/g, "");
    const printerSerial = `TEST-${token.slice(0, 20)}`;
    const nfcUid = `TEST-${token.slice(0, 30)}`;
    const jobId = randomUUID();

    let printerId: string | null = null;
    let spoolId: string | null = null;

    try {
      // ------------------------------------------------------
      // Impressora temporária
      // ------------------------------------------------------

      const {
        data: printer,
        error: printerError,
      } = await supabase
        .from("printers")
        .insert({
          user_id: userId,
          serial: printerSerial,
          name: "Filamap Integration Test",
          model: "A1",
          is_online: false,
        })
        .select("id")
        .single();

      assert.equal(printerError, null);
      assert.ok(printer);

      printerId = printer.id;

      // ------------------------------------------------------
      // Spool temporário com 100g
      // ------------------------------------------------------

      const {
        data: spool,
        error: spoolError,
      } = await supabase
        .from("spools")
        .insert({
          user_id: userId,
          nfc_uid: nfcUid,
          brand: "FILAMAP_TEST",
          material: "PLA",
          color_name: "TEST",
          color_hex: "#FFFFFF",
          spool_tare_weight: 0,
          initial_weight: 100,
          current_weight: 100,
        })
        .select("id,current_weight")
        .single();

      assert.equal(spoolError, null);
      assert.ok(spool);

      spoolId = spool.id;

      assert.equal(Number(spool.current_weight), 100);

      const rpcPayload = {
        p_job_id: jobId,
        p_printer_id: printerId,
        p_subtask_name: "filamap-idempotency-test",
        p_print_duration_minutes: 10,
        p_status: "COMPLETED",
        p_items: [
          {
            spool_id: spoolId,
            slot_index: 0,
            grams: 10,
            consumption_quality: "exact",
            orphan_slot: false,
          },
        ],
      };

      // ------------------------------------------------------
      // Primeira finalização
      // ------------------------------------------------------

      const {
        data: firstResult,
        error: firstError,
      } = await supabase.rpc(
        "finalize_print_job",
        rpcPayload
      );

      assert.equal(firstError, null);
      assert.equal(firstResult?.length, 1);

      const {
        data: afterFirst,
        error: afterFirstError,
      } = await supabase
        .from("spools")
        .select("current_weight")
        .eq("id", spoolId)
        .single();

      assert.equal(afterFirstError, null);
      assert.equal(Number(afterFirst.current_weight), 90);

      // ------------------------------------------------------
      // Segunda chamada com MESMO job_id
      // ------------------------------------------------------

      const {
        data: secondResult,
        error: secondError,
      } = await supabase.rpc(
        "finalize_print_job",
        rpcPayload
      );

      assert.equal(secondError, null);
      assert.equal(secondResult?.length, 1);

      // ------------------------------------------------------
      // Saldo precisa continuar 90g
      // ------------------------------------------------------

      const {
        data: afterSecond,
        error: afterSecondError,
      } = await supabase
        .from("spools")
        .select("current_weight")
        .eq("id", spoolId)
        .single();

      assert.equal(afterSecondError, null);
      assert.equal(
        Number(afterSecond.current_weight),
        90,
        "o mesmo job foi descontado duas vezes"
      );

      // ------------------------------------------------------
      // Deve existir apenas uma linha de log
      // ------------------------------------------------------

      const {
        data: logs,
        error: logsError,
      } = await supabase
        .from("print_logs")
        .select("id,job_id,spool_id,filament_used_g")
        .eq("job_id", jobId);

      assert.equal(logsError, null);
      assert.equal(
        logs?.length,
        1,
        "a segunda chamada duplicou print_logs"
      );

      assert.equal(logs?.[0]?.job_id, jobId);
      assert.equal(logs?.[0]?.spool_id, spoolId);
      assert.equal(
        Number(logs?.[0]?.filament_used_g),
        10
      );

    } finally {
      // ------------------------------------------------------
      // Limpeza obrigatória dos dados temporários
      // ------------------------------------------------------

      await supabase
        .from("print_logs")
        .delete()
        .eq("job_id", jobId);

      if (spoolId) {
        await supabase
          .from("spools")
          .delete()
          .eq("id", spoolId);
      }

      if (printerId) {
        await supabase
          .from("printers")
          .delete()
          .eq("id", printerId);
      }

      await supabase.auth.signOut();
    }
  }
);
