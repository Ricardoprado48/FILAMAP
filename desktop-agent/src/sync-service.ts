import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Credenciais do Supabase não encontradas no arquivo .env");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Garante que a impressora está cadastrada no Supabase
 */
export async function registerOrUpdatePrinter(serial: string, ip: string, model: string = "A1") {
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
}

/**
 * Registra a finalização da impressão e aciona a função de abate de saldo
 */
export async function processJobFinish(printerSerial: string, subtaskName: string, gramsConsumed: number, slotIndex: number) {
  try {
    // 1. Busca a impressora
    const { data: printer } = await supabase
      .from("printers")
      .select("id")
      .eq("serial", printerSerial)
      .single();

    if (!printer) return;

    // 2. Busca o carretel associado ao slot usado
    const { data: slotRecord } = await supabase
      .from("ams_slots")
      .select("spool_id")
      .eq("printer_id", printer.id)
      .eq("slot_index", slotIndex)
      .single();

    const spoolId = slotRecord?.spool_id || null;

    // 3. Registra o job no histórico
    await supabase.from("print_jobs").insert({
      printer_id: printer.id,
      spool_id: spoolId,
      subtask_name: subtaskName,
      grams_consumed: gramsConsumed,
      status: "FINISH",
    });

    // 4. Se tiver um carretel associado ao slot, desconta o peso
    if (spoolId) {
      const { data: newWeight, error: rpcError } = await supabase.rpc("deduct_spool_filament", {
        p_spool_id: spoolId,
        p_grams_consumed: gramsConsumed,
      });

      if (!rpcError) {
        console.log(`✅ [Supabase] Carretel atualizado com sucesso! Novo saldo: ${newWeight}g`);
      }
    }
  } catch (err: any) {
    console.error("❌ Erro no processamento do trabalho no Supabase:", err.message);
  }
}
