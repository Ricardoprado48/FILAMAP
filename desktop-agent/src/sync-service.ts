import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

let rawUrl = (process.env.SUPABASE_URL || "").trim();
// Remove qualquer barra final para evitar o erro de Invalid path
if (rawUrl.endsWith("/")) {
  rawUrl = rawUrl.slice(0, -1);
}

const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();

if (!rawUrl || !supabaseAnonKey) {
  console.error("❌ Credenciais do Supabase ausentes no .env");
}

export const supabase = createClient(rawUrl, supabaseAnonKey);

export async function registerOrUpdatePrinter(serial: string, ip: string, model: string = "A1") {
  try {
    const { data, error } = await supabase
      .from("printers")
      .upsert(
        { serial, ip_address: ip, model, is_online: true, updated_at: new Date().toISOString() },
        { onConflict: "serial" }
      )
      .select()
      .single();

    if (error) {
      console.error("❌ Erro ao sincronizar impressora no Supabase:", error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.error("❌ Falha de rede com Supabase:", err.message);
    return null;
  }
}

export async function processJobFinish(printerSerial: string, subtaskName: string, gramsConsumed: number, slotIndex: number) {
  try {
    const { data: printer } = await supabase
      .from("printers")
      .select("id")
      .eq("serial", printerSerial)
      .single();

    if (!printer) return;

    const { data: slotRecord } = await supabase
      .from("ams_slots")
      .select("spool_id")
      .eq("printer_id", printer.id)
      .eq("slot_index", slotIndex)
      .single();

    const spoolId = slotRecord?.spool_id || null;

    await supabase.from("print_jobs").insert({
      printer_id: printer.id,
      spool_id: spoolId,
      subtask_name: subtaskName,
      grams_consumed: gramsConsumed,
      status: "FINISH",
    });

    if (spoolId) {
      const { data: newWeight, error: rpcError } = await supabase.rpc("deduct_spool_filament", {
        p_spool_id: spoolId,
        p_grams_consumed: gramsConsumed,
      });

      if (!rpcError) {
        console.log(`✅ [Supabase] Carretel atualizado! Novo saldo: ${newWeight}g`);
      }
    }
  } catch (err: any) {
    console.error("❌ Erro no processamento do trabalho:", err.message);
  }
}
