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

function createSupabase() {
  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function signIn(supabase: ReturnType<typeof createSupabase>) {
  const {
    data,
    error,
  } = await supabase.auth.signInWithPassword({
    email: AGENT_EMAIL,
    password: AGENT_PASSWORD,
  });

  assert.equal(error, null);
  assert.ok(data.user);

  return data.user;
}

async function createPrinter(
  supabase: ReturnType<typeof createSupabase>,
  userId: string
) {
  const token = randomUUID().replace(/-/g, "");

  const {
    data,
    error,
  } = await supabase
    .from("printers")
    .insert({
      user_id: userId,
      serial: `TEST-${token.slice(0, 20)}`,
      name: "Filamap Integration Test",
      model: "A1",
      is_online: false,
    })
    .select("id")
    .single();

  assert.equal(error, null);
  assert.ok(data);

  return data.id as string;
}

async function createSpool(
  supabase: ReturnType<typeof createSupabase>,
  userId: string,
  currentWeight: number
) {
  const token = randomUUID().replace(/-/g, "");

  const {
    data,
    error,
  } = await supabase
    .from("spools")
    .insert({
      user_id: userId,
      nfc_uid: `TEST-${token.slice(0, 30)}`,
      brand: "FILAMAP_TEST",
      material: "PLA",
      color_name: "TEST",
      color_hex: "#FFFFFF",
      spool_tare_weight: 0,
      initial_weight: currentWeight,
      current_weight: currentWeight,
    })
    .select("id,current_weight")
    .single();

  assert.equal(error, null);
  assert.ok(data);

  return {
    id: data.id as string,
    currentWeight: Number(data.current_weight),
  };
}

async function getSpoolWeight(
  supabase: ReturnType<typeof createSupabase>,
  spoolId: string
) {
  const {
    data,
    error,
  } = await supabase
    .from("spools")
    .select("current_weight")
    .eq("id", spoolId)
    .single();

  assert.equal(error, null);

  return Number(data.current_weight);
}

async function cleanup(
  supabase: ReturnType<typeof createSupabase>,
  jobIds: string[],
  spoolIds: string[],
  printerIds: string[]
) {
  for (const jobId of jobIds) {
    await supabase
      .from("print_logs")
      .delete()
      .eq("job_id", jobId);
  }

  for (const spoolId of spoolIds) {
    await supabase
      .from("spools")
      .delete()
      .eq("id", spoolId);
  }

  for (const printerId of printerIds) {
    await supabase
      .from("printers")
      .delete()
      .eq("id", printerId);
  }

  await supabase.auth.signOut();
}

test(
  "finalize_print_job é idempotente e não desconta o mesmo job duas vezes",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const spool = await createSpool(
        supabase,
        user.id,
        100
      );
      spoolIds.push(spool.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const rpcPayload = {
        p_job_id: jobId,
        p_printer_id: printerId,
        p_subtask_name: "filamap-idempotency-test",
        p_print_duration_minutes: 10,
        p_status: "COMPLETED",
        p_items: [
          {
            spool_id: spool.id,
            slot_index: 0,
            grams: 10,
            consumption_quality: "exact",
            orphan_slot: false,
          },
        ],
      };

      const {
        data: firstResult,
        error: firstError,
      } = await supabase.rpc(
        "finalize_print_job",
        rpcPayload
      );

      assert.equal(firstError, null);
      assert.equal(firstResult?.length, 1);

      assert.equal(
        await getSpoolWeight(supabase, spool.id),
        90
      );

      const {
        data: secondResult,
        error: secondError,
      } = await supabase.rpc(
        "finalize_print_job",
        rpcPayload
      );

      assert.equal(secondError, null);
      assert.equal(secondResult?.length, 1);

      assert.equal(
        await getSpoolWeight(supabase, spool.id),
        90,
        "o mesmo job foi descontado duas vezes"
      );

      const {
        data: logs,
        error: logsError,
      } = await supabase
        .from("print_logs")
        .select("id,job_id,spool_id,filament_used_g")
        .eq("job_id", jobId);

      assert.equal(logsError, null);
      assert.equal(logs?.length, 1);
      assert.equal(Number(logs?.[0]?.filament_used_g), 10);
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);

test(
  "estoque: consumo maior que o saldo nunca deixa peso negativo",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const spool = await createSpool(
        supabase,
        user.id,
        5
      );
      spoolIds.push(spool.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const {
        error,
      } = await supabase.rpc(
        "finalize_print_job",
        {
          p_job_id: jobId,
          p_printer_id: printerId,
          p_subtask_name: "over-consumption-test",
          p_print_duration_minutes: 10,
          p_status: "COMPLETED",
          p_items: [
            {
              spool_id: spool.id,
              slot_index: 0,
              grams: 10,
              consumption_quality: "exact",
              orphan_slot: false,
            },
          ],
        }
      );

      assert.equal(error, null);

      assert.equal(
        await getSpoolWeight(supabase, spool.id),
        0
      );
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);

test(
  "estoque: spool zerado continua em zero após consumo",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const spool = await createSpool(
        supabase,
        user.id,
        0
      );
      spoolIds.push(spool.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const {
        error,
      } = await supabase.rpc(
        "finalize_print_job",
        {
          p_job_id: jobId,
          p_printer_id: printerId,
          p_subtask_name: "zero-stock-test",
          p_print_duration_minutes: 10,
          p_status: "COMPLETED",
          p_items: [
            {
              spool_id: spool.id,
              slot_index: 0,
              grams: 5,
              consumption_quality: "exact",
              orphan_slot: false,
            },
          ],
        }
      );

      assert.equal(error, null);

      assert.equal(
        await getSpoolWeight(supabase, spool.id),
        0
      );
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);

test(
  "estoque: orphan_slot não altera nenhum spool",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const controlSpool = await createSpool(
        supabase,
        user.id,
        100
      );
      spoolIds.push(controlSpool.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const {
        error,
      } = await supabase.rpc(
        "finalize_print_job",
        {
          p_job_id: jobId,
          p_printer_id: printerId,
          p_subtask_name: "orphan-slot-test",
          p_print_duration_minutes: 10,
          p_status: "COMPLETED",
          p_items: [
            {
              spool_id: null,
              slot_index: 2,
              grams: 20,
              consumption_quality: "exact",
              orphan_slot: true,
            },
          ],
        }
      );

      assert.equal(error, null);

      assert.equal(
        await getSpoolWeight(
          supabase,
          controlSpool.id
        ),
        100
      );

      const {
        data: logs,
        error: logsError,
      } = await supabase
        .from("print_logs")
        .select("spool_id,orphan_slot,filament_used_g")
        .eq("job_id", jobId);

      assert.equal(logsError, null);
      assert.equal(logs?.length, 1);
      assert.equal(logs?.[0]?.spool_id, null);
      assert.equal(logs?.[0]?.orphan_slot, true);
      assert.equal(
        Number(logs?.[0]?.filament_used_g),
        20
      );
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);

test(
  "estoque: quality unknown mantém estoque intacto quando grams é zero",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const spool = await createSpool(
        supabase,
        user.id,
        100
      );
      spoolIds.push(spool.id);

      const jobId = randomUUID();
      jobIds.push(jobId);

      const {
        error,
      } = await supabase.rpc(
        "finalize_print_job",
        {
          p_job_id: jobId,
          p_printer_id: printerId,
          p_subtask_name: "unknown-quality-test",
          p_print_duration_minutes: 10,
          p_status: "COMPLETED",
          p_items: [
            {
              spool_id: spool.id,
              slot_index: 0,
              grams: 0,
              consumption_quality: "unknown",
              orphan_slot: false,
            },
          ],
        }
      );

      assert.equal(error, null);

      assert.equal(
        await getSpoolWeight(supabase, spool.id),
        100
      );

      const {
        data: logs,
        error: logsError,
      } = await supabase
        .from("print_logs")
        .select("needs_weighing,consumption_quality")
        .eq("job_id", jobId);

      assert.equal(logsError, null);
      assert.equal(logs?.length, 1);
      assert.equal(
        logs?.[0]?.consumption_quality,
        "unknown"
      );
      assert.equal(
        logs?.[0]?.needs_weighing,
        true
      );
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);

test(
  "estoque: job multicolor desconta corretamente dois spools",
  async () => {
    const supabase = createSupabase();

    const jobIds: string[] = [];
    const spoolIds: string[] = [];
    const printerIds: string[] = [];

    try {
      const user = await signIn(supabase);

      const printerId = await createPrinter(
        supabase,
        user.id
      );
      printerIds.push(printerId);

      const spoolA = await createSpool(
        supabase,
        user.id,
        100
      );

      const spoolB = await createSpool(
        supabase,
        user.id,
        80
      );

      spoolIds.push(
        spoolA.id,
        spoolB.id
      );

      const jobId = randomUUID();
      jobIds.push(jobId);

      const {
        error,
      } = await supabase.rpc(
        "finalize_print_job",
        {
          p_job_id: jobId,
          p_printer_id: printerId,
          p_subtask_name: "multicolor-stock-test",
          p_print_duration_minutes: 30,
          p_status: "COMPLETED",
          p_items: [
            {
              spool_id: spoolA.id,
              slot_index: 0,
              grams: 25,
              consumption_quality: "exact",
              orphan_slot: false,
            },
            {
              spool_id: spoolB.id,
              slot_index: 2,
              grams: 10,
              consumption_quality: "exact",
              orphan_slot: false,
            },
          ],
        }
      );

      assert.equal(error, null);

      assert.equal(
        await getSpoolWeight(
          supabase,
          spoolA.id
        ),
        75
      );

      assert.equal(
        await getSpoolWeight(
          supabase,
          spoolB.id
        ),
        70
      );

      const {
        data: logs,
        error: logsError,
      } = await supabase
        .from("print_logs")
        .select("spool_id,slot_index,filament_used_g")
        .eq("job_id", jobId)
        .order("slot_index");

      assert.equal(logsError, null);
      assert.equal(logs?.length, 2);

      assert.equal(
        logs?.[0]?.spool_id,
        spoolA.id
      );
      assert.equal(
        Number(logs?.[0]?.filament_used_g),
        25
      );

      assert.equal(
        logs?.[1]?.spool_id,
        spoolB.id
      );
      assert.equal(
        Number(logs?.[1]?.filament_used_g),
        10
      );
    } finally {
      await cleanup(
        supabase,
        jobIds,
        spoolIds,
        printerIds
      );
    }
  }
);
