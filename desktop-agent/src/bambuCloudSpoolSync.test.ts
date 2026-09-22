import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JSON_SECTION_MARKER,
  extractJsonSection,
  processBridgeOutput,
  parseBambuCloudSpoolRecord,
  syncBambuCloudSpoolsFromParsed,
  type BridgeRunResult,
  type ParsedBambuCloudSpool,
} from "./bambuCloudSpoolSync";

const USER_ID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// Fixtures baseadas nos casos reais citados no escopo da tarefa
// ---------------------------------------------------------------------------

const SILK_RECORD = {
  id: 15582983,
  createType: "manual",
  filamentVendor: "Bambu Lab",
  filamentType: "PLA",
  filamentName: "PLA VERMELHO_ULTRA_SILK",
  filamentId: "P790d873",
  RFID: "",
  color: "FF0000FF",
  colors: ["FF0000FF"],
  netWeight: 1000,
  totalNetWeight: 1000,
  note: "",
  category: "PLA",
  inPrinter: true,
  devId: "01P00A000000000",
  amsSn: "AMS01",
  amsId: "0",
  slotId: "1",
  amsType: "AMS",
  deviceName: "Bambu Lab A1",
  depleted: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const EMPTY_RECORD = {
  id: 15589351,
  createType: "",
  filamentVendor: "",
  filamentType: "",
  filamentName: "",
  filamentId: "",
  RFID: "",
  color: "",
  colors: [],
  netWeight: null,
  totalNetWeight: null,
  note: "",
  category: "",
  inPrinter: false,
  devId: "",
  amsSn: "",
  amsId: "",
  slotId: "",
  amsType: "",
  deviceName: "",
  depleted: false,
  createdAt: "",
  updatedAt: "",
};

function sharedFilamentRecord(overrides: Record<string, unknown>) {
  return {
    createType: "manual",
    filamentVendor: "Bambu Lab",
    filamentType: "PETG",
    filamentName: "PETG PRETO",
    filamentId: "Pc11e481",
    RFID: "",
    color: "000000FF",
    colors: ["000000FF"],
    netWeight: 1000,
    totalNetWeight: 1000,
    note: "",
    category: "PETG",
    inPrinter: false,
    devId: "01P00A000000000",
    amsSn: "AMS01",
    amsId: "0",
    slotId: "0",
    amsType: "AMS",
    deviceName: "Bambu Lab A1",
    depleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function bridgeStdout(records: unknown[]): string {
  return `BAMBU_LOGIN=OK\nGET_FILAMENT_SPOOLS_RET=0\n\n${JSON_SECTION_MARKER}\n${JSON.stringify({
    list: records,
  })}\n`;
}

// ---------------------------------------------------------------------------
// Parser do stdout da bridge
// ---------------------------------------------------------------------------

test("extractJsonSection extrai apenas o texto após o marcador", () => {
  const stdout = `BAMBU_LOGIN=OK\nGET_FILAMENT_SPOOLS_RET=0\n\n${JSON_SECTION_MARKER}\n{"list":[]}\n`;
  assert.equal(extractJsonSection(stdout), '{"list":[]}');
});

test("extractJsonSection retorna null quando o marcador não existe", () => {
  assert.equal(extractJsonSection("saida sem marcador"), null);
});

test("processBridgeOutput interpreta stdout válido e separa registros válidos de vazios", () => {
  const result: BridgeRunResult = {
    stdout: bridgeStdout([SILK_RECORD, EMPTY_RECORD]),
    stderr: "",
    exitCode: 0,
  };

  const parsed = processBridgeOutput(result);

  assert.equal(parsed.totalRecords, 2);
  assert.equal(parsed.spools.length, 1);
  assert.equal(parsed.skippedCount, 1);
  assert.equal(parsed.spools[0].bambuSpoolId, "15582983");
});

test("processBridgeOutput lança erro para JSON inválido após o marcador", () => {
  const result: BridgeRunResult = {
    stdout: `\n${JSON_SECTION_MARKER}\n{isso nao e json`,
    stderr: "",
    exitCode: 0,
  };

  assert.throws(() => processBridgeOutput(result), /JSON inválido/);
});

test("processBridgeOutput lança erro quando a bridge sai com código diferente de 0", () => {
  const result: BridgeRunResult = {
    stdout: "",
    stderr: "Sessao Bambu nao autenticada.",
    exitCode: 4,
  };

  assert.throws(() => processBridgeOutput(result), /código 4/);
});

test("processBridgeOutput lança erro quando falta a seção === JSON ===", () => {
  const result: BridgeRunResult = {
    stdout: "BAMBU_LOGIN=OK\nGET_FILAMENT_SPOOLS_RET=0\n",
    stderr: "",
    exitCode: 0,
  };

  assert.throws(() => processBridgeOutput(result), /=== JSON ===/);
});

// ---------------------------------------------------------------------------
// Parsing de registro individual
// ---------------------------------------------------------------------------

test("parseBambuCloudSpoolRecord extrai um spool físico válido", () => {
  const parsed = parseBambuCloudSpoolRecord(SILK_RECORD);

  assert.ok(parsed);
  assert.equal(parsed!.bambuSpoolId, "15582983");
  assert.equal(parsed!.filamentId, "P790d873");
  assert.equal(parsed!.filamentType, "PLA");
  assert.equal(parsed!.filamentName, "PLA VERMELHO_ULTRA_SILK");
  assert.equal(parsed!.inPrinter, true);
  assert.equal(parsed!.devId, "01P00A000000000");
  assert.equal(parsed!.amsSn, "AMS01");
  assert.equal(parsed!.amsId, "0");
  assert.equal(parsed!.slotId, "1");
  assert.equal(parsed!.deviceName, "Bambu Lab A1");
});

test("parseBambuCloudSpoolRecord ignora registro vazio (id=15589351)", () => {
  assert.equal(parseBambuCloudSpoolRecord(EMPTY_RECORD), null);
});

test("parseBambuCloudSpoolRecord ignora registro sem filamentId mesmo com id de spool presente", () => {
  const record = { ...SILK_RECORD, filamentId: "" };
  assert.equal(parseBambuCloudSpoolRecord(record), null);
});

// ---------------------------------------------------------------------------
// Fake do SupabaseClient -- só o subconjunto de query builder usado pelo sync
// ---------------------------------------------------------------------------

class FakeSupabaseClient {
  tables: { user_filament_profiles: any[]; spools: any[] };

  constructor(seed: { profiles?: any[]; spools?: any[] } = {}) {
    this.tables = {
      user_filament_profiles: seed.profiles ? [...seed.profiles] : [],
      spools: seed.spools ? [...seed.spools] : [],
    };
  }

  from(table: "user_filament_profiles" | "spools") {
    return new FakeQueryBuilder(this.tables[table]);
  }
}

type FakeOp =
  | { type: "select" }
  | { type: "insert"; rows: any[] }
  | { type: "update"; payload: any }
  | { type: "upsert"; rows: any[]; onConflict: string };

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private filters: { col: string; val: any }[] = [];
  private inFilter: { col: string; vals: any[] } | null = null;
  private selectedCols: string[] | null = null;
  private op: FakeOp = { type: "select" };

  constructor(private rows: any[]) {}

  select(cols?: string) {
    this.selectedCols = cols ? cols.split(",").map((c) => c.trim()) : null;
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push({ col, val });
    return this;
  }

  in(col: string, vals: any[]) {
    this.inFilter = { col, vals };
    return this;
  }

  insert(rows: any[]) {
    this.op = { type: "insert", rows };
    return this;
  }

  update(payload: any) {
    this.op = { type: "update", payload };
    return this;
  }

  upsert(rows: any[], opts: { onConflict: string }) {
    this.op = { type: "upsert", rows, onConflict: opts.onConflict };
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }

  private matches(row: any): boolean {
    for (const f of this.filters) {
      if (row[f.col] !== f.val) return false;
    }
    if (this.inFilter && !this.inFilter.vals.includes(row[this.inFilter.col])) return false;
    return true;
  }

  private project(rows: any[]): any[] {
    if (!this.selectedCols) return rows;
    return rows.map((r) => {
      const out: Record<string, any> = {};
      for (const c of this.selectedCols!) out[c] = r[c];
      return out;
    });
  }

  private async execute(): Promise<{ data: any; error: any }> {
    if (this.op.type === "insert") {
      const now = new Date().toISOString();
      const inserted = this.op.rows.map((row) => ({
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        ...row,
      }));
      this.rows.push(...inserted);
      return { data: this.project(inserted), error: null };
    }

    if (this.op.type === "update") {
      const updated: any[] = [];
      for (const row of this.rows) {
        if (this.matches(row)) {
          Object.assign(row, this.op.payload);
          updated.push(row);
        }
      }
      return { data: this.project(updated), error: null };
    }

    if (this.op.type === "upsert") {
      const conflictCols = this.op.onConflict.split(",").map((c) => c.trim());
      const result: any[] = [];

      for (const row of this.op.rows) {
        const existing = this.rows.find((r) =>
          conflictCols.every((c) => r[c] === row[c])
        );

        if (existing) {
          Object.assign(existing, row);
          result.push(existing);
        } else {
          const created = { id: randomUUID(), ...row };
          this.rows.push(created);
          result.push(created);
        }
      }

      return { data: this.project(result), error: null };
    }

    return { data: this.project(this.rows.filter((r) => this.matches(r))), error: null };
  }
}

function asSupabase(client: FakeSupabaseClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function silkSpool(overrides: Partial<ParsedBambuCloudSpool> = {}): ParsedBambuCloudSpool {
  const parsed = parseBambuCloudSpoolRecord(SILK_RECORD)!;
  return { ...parsed, ...overrides };
}

// ---------------------------------------------------------------------------
// Sync: perfil + spool físico
// ---------------------------------------------------------------------------

test("novo perfil + novo spool são criados e ligados por filament_profile_id", async () => {
  const client = new FakeSupabaseClient();

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [silkSpool()]);

  assert.deepEqual(result, { profilesUpserted: 1, spoolsInserted: 1, spoolsUpdated: 0 });
  assert.equal(client.tables.user_filament_profiles.length, 1);
  assert.equal(client.tables.spools.length, 1);

  const profile = client.tables.user_filament_profiles[0];
  const spool = client.tables.spools[0];

  assert.equal(profile.source, "bambu_cloud");
  assert.equal(profile.source_key, "P790d873");
  assert.equal(spool.bambu_spool_id, "15582983");
  assert.equal(spool.filament_profile_id, profile.id);
  assert.equal(spool.brand, "Bambu Lab");
  assert.equal(spool.material, "PLA");
});

test("spool físico já existente é atualizado, não duplicado", async () => {
  const now = new Date().toISOString();
  const existingProfileId = randomUUID();
  const existingSpoolId = randomUUID();

  const client = new FakeSupabaseClient({
    profiles: [
      {
        id: existingProfileId,
        user_id: USER_ID,
        source: "bambu_cloud",
        source_key: "P790d873",
        source_profile_name: "PLA VERMELHO_ULTRA_SILK",
        display_name: "PLA VERMELHO_ULTRA_SILK",
        material: "PLA",
        updated_at: now,
      },
    ],
    spools: [
      {
        id: existingSpoolId,
        user_id: USER_ID,
        bambu_spool_id: "15582983",
        filament_profile_id: existingProfileId,
        brand: "Bambu Lab",
        material: "PLA",
        bambu_ams_id: "0",
        bambu_slot_id: "1",
        updated_at: now,
      },
    ],
  });

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [silkSpool()]);

  assert.equal(result.spoolsInserted, 0);
  assert.equal(result.spoolsUpdated, 1);
  assert.equal(client.tables.spools.length, 1, "não deve duplicar o spool físico");
  assert.equal(client.tables.spools[0].id, existingSpoolId);
});

test("dois spools físicos com o mesmo filamentId compartilham um único perfil, sem duplicá-lo", async () => {
  const client = new FakeSupabaseClient();

  const spoolA = parseBambuCloudSpoolRecord(
    sharedFilamentRecord({ id: 20000001, devId: "dev-1", slotId: "0" })
  )!;
  const spoolB = parseBambuCloudSpoolRecord(
    sharedFilamentRecord({ id: 20000002, devId: "dev-1", slotId: "2" })
  )!;

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [spoolA, spoolB]);

  assert.equal(result.profilesUpserted, 1, "mesmo filamentId não deve gerar dois perfis");
  assert.equal(result.spoolsInserted, 2, "spools físicos distintos devem ser preservados");
  assert.equal(client.tables.user_filament_profiles.length, 1);
  assert.equal(client.tables.spools.length, 2);

  const [rowA, rowB] = client.tables.spools;
  assert.equal(rowA.filament_profile_id, rowB.filament_profile_id);
  assert.notEqual(rowA.bambu_spool_id, rowB.bambu_spool_id);
});

test("atualização de AMS/slot reflete a nova localização sem criar linha nova", async () => {
  const now = new Date().toISOString();
  const existingSpoolId = randomUUID();

  const client = new FakeSupabaseClient({
    spools: [
      {
        id: existingSpoolId,
        user_id: USER_ID,
        bambu_spool_id: "15582983",
        brand: "Bambu Lab",
        material: "PLA",
        bambu_dev_id: "old-device",
        bambu_device_name: "Impressora Antiga",
        bambu_ams_sn: "AMS00",
        bambu_ams_id: "1",
        bambu_slot_id: "3",
        bambu_in_printer: false,
        updated_at: now,
      },
    ],
  });

  await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [silkSpool()]);

  const spool = client.tables.spools[0];
  assert.equal(client.tables.spools.length, 1);
  assert.equal(spool.bambu_dev_id, "01P00A000000000");
  assert.equal(spool.bambu_device_name, "Bambu Lab A1");
  assert.equal(spool.bambu_ams_sn, "AMS01");
  assert.equal(spool.bambu_ams_id, "0");
  assert.equal(spool.bambu_slot_id, "1");
  assert.equal(spool.bambu_in_printer, true);
});

test("preserva dados locais (NFC, peso real, cor, preço) de um spool já cadastrado", async () => {
  const now = new Date().toISOString();
  const existingSpoolId = randomUUID();

  const client = new FakeSupabaseClient({
    spools: [
      {
        id: existingSpoolId,
        user_id: USER_ID,
        bambu_spool_id: "15582983",
        nfc_uid: "04AABBCCDDEEFF",
        nfc_written_at: now,
        brand: "Bambu Lab",
        material: "PLA",
        color_name: "Vermelho Customizado pelo usuário",
        color_hex: "#AA0011",
        current_weight: 733.5,
        initial_weight: 1000,
        spool_tare_weight: 210,
        price_paid: 89.9,
        updated_at: now,
      },
    ],
  });

  await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [silkSpool()]);

  const spool = client.tables.spools[0];

  assert.equal(spool.nfc_uid, "04AABBCCDDEEFF");
  assert.equal(spool.color_name, "Vermelho Customizado pelo usuário");
  assert.equal(spool.color_hex, "#AA0011");
  assert.equal(spool.current_weight, 733.5);
  assert.equal(spool.initial_weight, 1000);
  assert.equal(spool.spool_tare_weight, 210);
  assert.equal(spool.price_paid, 89.9);

  // A localização deve ter sido atualizada mesmo preservando o resto.
  assert.equal(spool.bambu_ams_id, "0");
  assert.equal(spool.bambu_slot_id, "1");
});

test("execução repetida é idempotente: não duplica perfis nem spools", async () => {
  const client = new FakeSupabaseClient();

  const spoolA = parseBambuCloudSpoolRecord(
    sharedFilamentRecord({ id: 20000001, slotId: "0" })
  )!;
  const spoolB = parseBambuCloudSpoolRecord(
    sharedFilamentRecord({ id: 20000002, slotId: "2" })
  )!;

  const first = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [
    silkSpool(),
    spoolA,
    spoolB,
  ]);

  assert.equal(first.spoolsInserted, 3);
  assert.equal(client.tables.spools.length, 3);
  assert.equal(client.tables.user_filament_profiles.length, 2);

  const second = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [
    silkSpool({ slotId: "1" }),
    spoolA,
    spoolB,
  ]);

  assert.equal(second.spoolsInserted, 0, "segunda rodada não deve inserir spool novo");
  assert.equal(second.spoolsUpdated, 3);
  assert.equal(client.tables.spools.length, 3, "número de spools não pode crescer");
  assert.equal(client.tables.user_filament_profiles.length, 2, "número de perfis não pode crescer");
});
