// Integration tests do pipeline de resolução física (Prioridade 1: Bambu
// Cloud / Prioridade 2: ams_slots) contra o banco real. Diferente de
// consumption.test.ts (funções puras, sem banco), aqui replicamos as MESMAS
// queries que finalizeJob() roda em index.ts, contra dados reais em
// spools/ams_slots/printers, para provar que a query SQL + a função pura
// combinadas produzem o resultado certo -- não só a função pura isolada.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  resolvePhysicalSpoolsForJob,
  groupBambuCandidatesBySlot,
  computeAmsSlotSelfHeals,
  buildJobConsumptionItems,
} from "./consumption";
import type { BambuSyncedSpoolRow } from "./consumption";

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/['"]/g, "")
  .replace(/\/$/, "");

const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim().replace(/['"]/g, "");
const AGENT_EMAIL = (process.env.AGENT_EMAIL || "").trim();
const AGENT_PASSWORD = (process.env.AGENT_PASSWORD || "").trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AGENT_EMAIL || !AGENT_PASSWORD) {
  throw new Error("Configure SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL e AGENT_PASSWORD no .env");
}

function createSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(supabase: ReturnType<typeof createSupabase>) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: AGENT_EMAIL,
    password: AGENT_PASSWORD,
  });
  assert.equal(error, null);
  assert.ok(data.user);
  return data.user;
}

async function createPrinter(supabase: ReturnType<typeof createSupabase>, userId: string) {
  const token = randomUUID().replace(/-/g, "");
  const { data, error } = await supabase
    .from("printers")
    .insert({
      user_id: userId,
      serial: `TEST-RES-${token.slice(0, 16)}`,
      name: "Filamap Resolution Test",
      model: "A1",
      is_online: false,
    })
    .select("id, serial")
    .single();
  assert.equal(error, null);
  assert.ok(data);
  return { id: data.id as string, serial: data.serial as string };
}

async function createSpool(
  supabase: ReturnType<typeof createSupabase>,
  userId: string,
  currentWeight: number,
  bambu: { devId: string; slotId: string; inPrinter: boolean } | null,
  weightConfirmed: boolean = true
) {
  const token = randomUUID().replace(/-/g, "");
  const { data, error } = await supabase
    .from("spools")
    .insert({
      user_id: userId,
      nfc_uid: `TEST-RES-${token.slice(0, 28)}`,
      brand: "FILAMAP_TEST",
      material: "PLA",
      color_name: "TEST",
      color_hex: "#FFFFFF",
      spool_tare_weight: 0,
      initial_weight: currentWeight,
      current_weight: currentWeight,
      weight_confirmed_at: weightConfirmed ? new Date().toISOString() : null,
      bambu_spool_id: bambu ? `BAMBU-${token.slice(0, 10)}` : null,
      bambu_dev_id: bambu?.devId ?? null,
      bambu_slot_id: bambu?.slotId ?? null,
      bambu_in_printer: bambu?.inPrinter ?? null,
    })
    .select("id, current_weight")
    .single();
  assert.equal(error, null);
  assert.ok(data);
  return { id: data.id as string, currentWeight: Number(data.current_weight) };
}

async function getSpoolWeight(supabase: ReturnType<typeof createSupabase>, spoolId: string) {
  const { data, error } = await supabase.from("spools").select("current_weight").eq("id", spoolId).single();
  assert.equal(error, null);
  return Number(data.current_weight);
}

async function getAmsSlotSpoolId(
  supabase: ReturnType<typeof createSupabase>,
  printerId: string,
  slotIndex: number
) {
  const { data } = await supabase
    .from("ams_slots")
    .select("spool_id")
    .eq("printer_id", printerId)
    .eq("slot_index", slotIndex)
    .maybeSingle();
  return (data?.spool_id as string | undefined) ?? null;
}

async function cleanup(
  supabase: ReturnType<typeof createSupabase>,
  jobIds: string[],
  spoolIds: string[],
  printerIds: string[]
) {
  for (const jobId of jobIds) {
    await supabase.from("print_logs").delete().eq("job_id", jobId);
  }
  for (const spoolId of spoolIds) {
    await supabase.from("spools").delete().eq("id", spoolId);
  }
  for (const printerId of printerIds) {
    // ams_slots.printer_id tem ON DELETE CASCADE (001_initial_schema.sql) --
    // apagar a impressora já limpa os slots de teste.
    await supabase.from("printers").delete().eq("id", printerId);
  }
  await supabase.auth.signOut();
}

/** Replica exatamente as duas queries + o pipeline de resolução que finalizeJob() roda em index.ts. */
async function resolveAndBuildItems(
  supabase: ReturnType<typeof createSupabase>,
  printerId: string,
  printerSerial: string,
  usedSlotIndexes: number[],
  perSlot: Map<number, { grams: number; quality: "exact"; weightDiscount: number }>
) {
  const { data: slotRows } = await supabase
    .from("ams_slots")
    .select("slot_index, spool_id")
    .eq("printer_id", printerId)
    .in("slot_index", usedSlotIndexes);

  const amsSlotBySlot = new Map<number, string | null>();
  for (const r of (slotRows || []) as any[]) {
    amsSlotBySlot.set(r.slot_index, r.spool_id);
  }

  const { data: bambuCandidateRows } = await supabase
    .from("spools")
    .select("id, bambu_dev_id, bambu_slot_id, bambu_in_printer")
    .eq("bambu_dev_id", printerSerial)
    .eq("bambu_in_printer", true)
    .in("bambu_slot_id", usedSlotIndexes.map(String));

  const bambuRows: BambuSyncedSpoolRow[] = ((bambuCandidateRows || []) as any[]).map((r) => ({
    id: r.id,
    bambuDevId: r.bambu_dev_id ?? null,
    bambuSlotId: r.bambu_slot_id ?? null,
    bambuInPrinter: r.bambu_in_printer ?? null,
  }));

  const bambuCandidatesBySlot = groupBambuCandidatesBySlot(bambuRows, printerSerial);
  const resolutions = resolvePhysicalSpoolsForJob(usedSlotIndexes, amsSlotBySlot, bambuCandidatesBySlot);

  const spoolBySlot = new Map<number, string | null>();
  for (const [slotIndex, resolution] of resolutions) {
    spoolBySlot.set(slotIndex, resolution.spoolId);
  }

  const items = buildJobConsumptionItems(perSlot, spoolBySlot, 100);

  return { resolutions, items };
}

test(
  "resolução real: job resolve o spool certo só pela Bambu Cloud, sobrescreve NFC antigo e corrige ams_slots",
  async () => {
    const supabase = createSupabase();
    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);
      const printer = await createPrinter(supabase, user.id);
      printerIds.push(printer.id);

      // Spool B: vínculo antigo por NFC, sem nenhum dado Bambu.
      const spoolB = await createSpool(supabase, user.id, 200, null);
      // Spool A: a Bambu Cloud reporta como fisicamente no slot 0 desta impressora agora.
      const spoolA = await createSpool(supabase, user.id, 200, {
        devId: printer.serial,
        slotId: "0",
        inPrinter: true,
      });
      spoolIds.push(spoolA.id, spoolB.id);

      // Vínculo NFC antigo aponta para B -- o usuário trocou o carretel
      // fisicamente sem tocar a tag de novo.
      const { error: amsError } = await supabase
        .from("ams_slots")
        .upsert(
          { printer_id: printer.id, slot_index: 0, spool_id: spoolB.id, updated_at: new Date().toISOString() },
          { onConflict: "printer_id,slot_index" }
        );
      assert.equal(amsError, null);

      const perSlot = new Map([[0, { grams: 12, quality: "exact" as const, weightDiscount: 0 }]]);
      const { resolutions, items } = await resolveAndBuildItems(supabase, printer.id, printer.serial, [0], perSlot);

      assert.equal(resolutions.get(0)?.spoolId, spoolA.id);
      assert.equal(resolutions.get(0)?.source, "bambu_cloud");
      assert.equal(resolutions.get(0)?.conflict, true);
      assert.equal(items[0].spool_id, spoolA.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const { error } = await supabase.rpc("finalize_print_job", {
        p_job_id: jobId,
        p_printer_id: printer.id,
        p_subtask_name: "resolution-conflict-test",
        p_print_duration_minutes: 5,
        p_status: "COMPLETED",
        p_items: items,
      });
      assert.equal(error, null);

      // A (identificado pela Bambu Cloud) foi debitado; B (vínculo NFC antigo) ficou intacto.
      assert.equal(await getSpoolWeight(supabase, spoolA.id), 188);
      assert.equal(await getSpoolWeight(supabase, spoolB.id), 200);

      // Self-heal: ams_slots é corrigido para refletir a identidade real.
      const heals = computeAmsSlotSelfHeals(resolutions);
      assert.deepEqual(heals, [{ slotIndex: 0, spoolId: spoolA.id }]);

      for (const heal of heals) {
        const { error: healError } = await supabase
          .from("ams_slots")
          .upsert(
            { printer_id: printer.id, slot_index: heal.slotIndex, spool_id: heal.spoolId, updated_at: new Date().toISOString() },
            { onConflict: "printer_id,slot_index" }
          );
        assert.equal(healError, null);
      }

      assert.equal(await getAmsSlotSpoolId(supabase, printer.id, 0), spoolA.id);

      // Reprocessar o mesmo job: idempotência de ponta a ponta (RPC +
      // resolução + self-heal), agora com ams_slots já corrigido.
      const second = await resolveAndBuildItems(supabase, printer.id, printer.serial, [0], perSlot);
      assert.equal(second.resolutions.get(0)?.conflict, false, "não deveria mais haver conflito após o self-heal");

      const { error: secondError } = await supabase.rpc("finalize_print_job", {
        p_job_id: jobId,
        p_printer_id: printer.id,
        p_subtask_name: "resolution-conflict-test",
        p_print_duration_minutes: 5,
        p_status: "COMPLETED",
        p_items: second.items,
      });
      assert.equal(secondError, null);

      assert.equal(await getSpoolWeight(supabase, spoolA.id), 188, "job reprocessado não pode debitar de novo");
      assert.deepEqual(computeAmsSlotSelfHeals(second.resolutions), [], "self-heal não deve escrever de novo depois de já corrigido");
    } finally {
      await cleanup(supabase, jobIds, spoolIds, printerIds);
    }
  }
);

test(
  "resolução real: spool nunca teve NFC tocado (ams_slots vazio) resolve só pela Bambu Cloud e popula ams_slots pela primeira vez",
  async () => {
    const supabase = createSupabase();
    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);
      const printer = await createPrinter(supabase, user.id);
      printerIds.push(printer.id);

      const spool = await createSpool(supabase, user.id, 500, {
        devId: printer.serial,
        slotId: "1",
        inPrinter: true,
      });
      spoolIds.push(spool.id);

      assert.equal(await getAmsSlotSpoolId(supabase, printer.id, 1), null);

      const perSlot = new Map([[1, { grams: 30, quality: "exact" as const, weightDiscount: 0 }]]);
      const { resolutions, items } = await resolveAndBuildItems(supabase, printer.id, printer.serial, [1], perSlot);

      assert.equal(resolutions.get(1)?.source, "bambu_cloud");
      assert.equal(resolutions.get(1)?.spoolId, spool.id);
      assert.equal(items[0].orphan_slot, false);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const { error } = await supabase.rpc("finalize_print_job", {
        p_job_id: jobId,
        p_printer_id: printer.id,
        p_subtask_name: "resolution-no-nfc-test",
        p_print_duration_minutes: 5,
        p_status: "COMPLETED",
        p_items: items,
      });
      assert.equal(error, null);
      assert.equal(await getSpoolWeight(supabase, spool.id), 470);

      const heals = computeAmsSlotSelfHeals(resolutions);
      assert.deepEqual(heals, [{ slotIndex: 1, spoolId: spool.id }]);

      await supabase
        .from("ams_slots")
        .upsert(
          { printer_id: printer.id, slot_index: 1, spool_id: spool.id, updated_at: new Date().toISOString() },
          { onConflict: "printer_id,slot_index" }
        );

      assert.equal(await getAmsSlotSpoolId(supabase, printer.id, 1), spool.id);
    } finally {
      await cleanup(supabase, jobIds, spoolIds, printerIds);
    }
  }
);

test(
  "resolução real: isolamento por impressora -- spool Bambu de outra impressora nunca é candidato aqui",
  async () => {
    const supabase = createSupabase();
    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);
      const printerA = await createPrinter(supabase, user.id);
      const printerB = await createPrinter(supabase, user.id);
      printerIds.push(printerA.id, printerB.id);

      // Spool reportado pela Bambu Cloud como estando na impressora B, slot 0.
      const spoolOnB = await createSpool(supabase, user.id, 300, {
        devId: printerB.serial,
        slotId: "0",
        inPrinter: true,
      });
      spoolIds.push(spoolOnB.id);

      // Vínculo NFC antigo em A aponta para um spool de controle.
      const controlSpool = await createSpool(supabase, user.id, 150, null);
      spoolIds.push(controlSpool.id);
      await supabase
        .from("ams_slots")
        .upsert(
          { printer_id: printerA.id, slot_index: 0, spool_id: controlSpool.id, updated_at: new Date().toISOString() },
          { onConflict: "printer_id,slot_index" }
        );

      const perSlot = new Map([[0, { grams: 20, quality: "exact" as const, weightDiscount: 0 }]]);
      const { resolutions, items } = await resolveAndBuildItems(supabase, printerA.id, printerA.serial, [0], perSlot);

      // Resolvendo para a impressora A, o spool que está fisicamente em B não pode aparecer como candidato.
      assert.equal(resolutions.get(0)?.source, "ams_slots");
      assert.equal(resolutions.get(0)?.spoolId, controlSpool.id);
      assert.equal(items[0].spool_id, controlSpool.id);
    } finally {
      await cleanup(supabase, jobIds, spoolIds, printerIds);
    }
  }
);
