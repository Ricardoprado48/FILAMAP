import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JSON_SECTION_MARKER,
  buildBridgeExecutablePath,
  extractJsonSection,
  processBridgeOutput,
  parseBambuCloudSpoolRecord,
  syncBambuCloudSpoolsFromParsed,
  normalizeColorHex,
  resolveSpoolColorName,
  buildSpoolInsertRow,
  findStrongReconciliationCandidate,
  isStrongCandidateMatch,
  resolveSpoolBrand,
  type ReconciliationCandidate,
  type BridgeRunResult,
  type ParsedBambuCloudSpool,
  buildSourceMetadata,
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
  // "hits" é o envelope real confirmado por homologação contra a bridge de
  // verdade (bambu_network_get_filament_spools), não uma suposição.
  return `BAMBU_LOGIN=OK\nGET_FILAMENT_SPOOLS_RET=0\n\n${JSON_SECTION_MARKER}\n${JSON.stringify({
    hits: records,
  })}\n`;
}

// ---------------------------------------------------------------------------
// Caminho da bridge em dev vs executável empacotado
// ---------------------------------------------------------------------------

test("bridge path: ambiente explícito tem prioridade", () => {
  assert.equal(
    buildBridgeExecutablePath(
      "C:\\custom\\bridge.exe",
      true,
      "C:\\Program Files\\Filamap Agent\\filamap-agent.exe",
      "C:\\snapshot\\desktop-agent\\dist"
    ),
    "C:\\custom\\bridge.exe"
  );
});

test("bridge path: dev usa a pasta bambu-bridge do projeto", () => {
  const moduleDir = path.join(path.sep, "workspace", "desktop-agent", "dist");

  assert.equal(
    buildBridgeExecutablePath(undefined, false, "", moduleDir),
    path.join(path.sep, "workspace", "desktop-agent", "bambu-bridge", "filamap-bambu-bridge.exe")
  );
});

test("bridge path: pkg usa a pasta real ao lado do executável", () => {
  const execPath = path.join(path.sep, "deploy", "Filamap Agent", "filamap-agent.exe");

  assert.equal(
    buildBridgeExecutablePath(
      undefined,
      true,
      execPath,
      path.join(path.sep, "snapshot", "desktop-agent", "dist")
    ),
    path.join(path.dirname(execPath), "bambu-bridge", "filamap-bambu-bridge.exe")
  );
});

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

test("normalizeColorHex normaliza hexadecimais de 6 e 8 caracteres e rejeita inválidos", () => {
  assert.equal(normalizeColorHex("161616"), "#161616");
  assert.equal(normalizeColorHex("#161616"), "#161616");
  assert.equal(normalizeColorHex("FF0000FF"), "#FF0000");
  assert.equal(normalizeColorHex("#00CC00FF"), "#00CC00");
  assert.equal(normalizeColorHex(""), null);
  assert.equal(normalizeColorHex(null), null);
  assert.equal(normalizeColorHex(undefined), null);
  assert.equal(normalizeColorHex("ZZZZZZ"), null);
});

test("resolveSpoolColorName prioriza display_name do perfil ou filamentName legível", () => {
  const spool = silkSpool({ filamentName: "PLA VERMELHO_ULTRA_SILK" });
  assert.equal(resolveSpoolColorName(spool, "Bambu PLA Vermelho"), "Bambu PLA Vermelho");
  assert.equal(resolveSpoolColorName(spool, null), "PLA VERMELHO_ULTRA_SILK");

  // Se filamentName for um código hex, recorre à marca + material
  const hexSpool = silkSpool({ filamentName: "#161616", filamentVendor: "Bambu Lab", filamentType: "PLA Basic" });
  assert.equal(resolveSpoolColorName(hexSpool, null), "Bambu Lab PLA Basic");
});

test("buildSpoolInsertRow preenche color_name amigável e color_hex normalizado", () => {
  const spool = silkSpool();
  const row = buildSpoolInsertRow(spool, USER_ID, "profile-123", "Bambu PLA Seda Vermelho", "2026-09-26T00:00:00Z");

  assert.equal(row.color_name, "Bambu PLA Seda Vermelho");
  assert.equal(row.color_hex, "#FF0000");
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.material, "PLA");
});

test("syncBambuCloudSpoolsFromParsed auto-corrige registros legados com color_name em HEX e color_hex nulo", () => {
  const existingProfileId = randomUUID();
  const existingSpoolId = randomUUID();
  const now = new Date().toISOString();

  const client = new FakeSupabaseClient({
    profiles: [
      {
        id: existingProfileId,
        user_id: USER_ID,
        source: "bambu_cloud",
        source_key: "P790d873",
        source_profile_name: "PLA VERMELHO_ULTRA_SILK",
        display_name: "Bambu Lab PLA Silk Vermelho",
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
        color_name: "#161616", // valor legado em hex
        color_hex: null, // legado sem color_hex
        current_weight: 900,
        updated_at: now,
      },
    ],
  });

  return syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [silkSpool()]).then((result) => {
    assert.equal(result.spoolsUpdated, 1);
    const updated = client.tables.spools[0];
    assert.equal(updated.color_name, "PLA VERMELHO_ULTRA_SILK");
    assert.equal(updated.color_hex, "#FF0000");
    assert.equal(updated.current_weight, 900, "peso deve ser estritamente preservado");
  });
});

test("findStrongReconciliationCandidate reconcilia carretel único desvinculado por compatibilidade de material e nome", () => {
  const spool = silkSpool({
    bambuSpoolId: "14479573",
    filamentName: "PLA PRETO VELVET",
    filamentType: "PLA",
  });

  const unlinked: ReconciliationCandidate[] = [
    {
      id: "spool-1",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Preto Velvet",
      bambu_spool_id: null,
    },
    {
      id: "spool-2",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Dourado",
      bambu_spool_id: null,
    },
  ];

  const match = findStrongReconciliationCandidate(spool, null, unlinked);
  assert.ok(match);
  assert.equal(match?.id, "spool-1");
});

test("findStrongReconciliationCandidate rejeita quando há ambiguidade física (mais de 1 candidato compatível)", () => {
  const spool = silkSpool({
    bambuSpoolId: "14479573",
    filamentName: "PLA PRETO VELVET",
    filamentType: "PLA",
  });

  const unlinked: ReconciliationCandidate[] = [
    {
      id: "spool-1",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Preto Velvet",
      bambu_spool_id: null,
    },
    {
      id: "spool-2",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Preto Velvet",
      bambu_spool_id: null,
    },
  ];

  const match = findStrongReconciliationCandidate(spool, null, unlinked);
  assert.equal(match, null, "deve retornar null diante de múltiplos candidatos para não debitar às cegas");
});

test("findStrongReconciliationCandidate rejeita quando material é incompatível", () => {
  const spool = silkSpool({
    bambuSpoolId: "14479573",
    filamentName: "PLA PRETO VELVET",
    filamentType: "PLA",
  });

  const unlinked: ReconciliationCandidate[] = [
    {
      id: "spool-petg",
      brand: "Voolt3D",
      material: "PETG",
      color_name: "Preto Velvet",
      bambu_spool_id: null,
    },
  ];

  const match = findStrongReconciliationCandidate(spool, null, unlinked);
  assert.equal(match, null);
});

test("findStrongReconciliationCandidate não funde Velvet e Ultra Silk (preservando carretéis físicos distintos)", () => {
  const spool = silkSpool({
    bambuSpoolId: "15582983",
    filamentName: "PLA VERMELHO_ULTRA_SILK",
    filamentType: "PLA",
  });

  const unlinked: ReconciliationCandidate[] = [
    {
      id: "spool-velvet",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Vermelho Velvet",
      bambu_spool_id: null,
    },
  ];

  const match = findStrongReconciliationCandidate(spool, null, unlinked);
  assert.equal(match, null, "Ultra Silk e Velvet são carretéis físicos diferentes e nunca devem se fundir");
});

test("resolveSpoolBrand identifica fabricante correto", () => {
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: "BAMBU-RFID-123" })),
    "Bambu Lab"
  );
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: null, filamentName: "VOOLT3D PLA PRETO VELVET" })),
    "Voolt3D"
  );
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: null, filamentName: "MasterPrint PETG Branco" })),
    "MasterPrint"
  );
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: null, filamentName: "Easy Print PETG Prata" })),
    "Easy Print"
  );
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: null, filamentName: "Fusion PETG Amarelo" })),
    "Fusion"
  );
  assert.equal(
    resolveSpoolBrand(silkSpool({ rfid: null, filamentName: "PLA Básico", filamentVendor: "+" })),
    "Genérico"
  );
});

test("syncBambuCloudSpoolsFromParsed reconcilia carretel desvinculado e preserva dados físicos locais", async () => {
  const unlinkedId = randomUUID();
  const now = new Date().toISOString();

  const client = new FakeSupabaseClient({
    spools: [
      {
        id: unlinkedId,
        user_id: USER_ID,
        bambu_spool_id: null,
        brand: "Voolt3D",
        material: "PLA",
        color_name: "Preto Velvet",
        nfc_uid: "NFC-PRETO-VELVET",
        current_weight: 900,
        initial_weight: 1000,
        price_paid: 110,
        bambu_source_metadata: {},
        updated_at: now,
      },
    ],
  });

  const cloudSpool = silkSpool({
    bambuSpoolId: "14479573",
    filamentName: "PLA PRETO VELVET",
    filamentType: "PLA",
    inPrinter: true,
    slotId: "0",
  });

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [cloudSpool]);

  assert.equal(result.spoolsInserted, 0, "deve reconciliar sem inserir nova linha");
  assert.equal(result.spoolsUpdated, 1);
  assert.equal(client.tables.spools.length, 1);

  const spool = client.tables.spools[0];
  assert.equal(spool.id, unlinkedId);
  assert.equal(spool.bambu_spool_id, "14479573");
  assert.equal(spool.nfc_uid, "NFC-PRETO-VELVET", "NFC deve ser estritamente preservado");
  assert.equal(spool.current_weight, 900, "peso real deve ser preservado");
  assert.equal(spool.price_paid, 110);
  assert.equal(spool.bambu_in_printer, true);
  assert.equal(spool.bambu_slot_id, "0");
});

test("syncBambuCloudSpoolsFromParsed: segundo rolo igual (antigo ID 'secundário') vira carretel físico próprio", async () => {
  const survivingId = randomUUID();
  const now = new Date().toISOString();

  const client = new FakeSupabaseClient({
    spools: [
      {
        id: survivingId,
        user_id: USER_ID,
        bambu_spool_id: "15147446",
        brand: "Voolt3D",
        material: "PLA",
        color_name: "Branco Off White Velvet",
        bambu_source_metadata: {
          secondary_bambu_spool_ids: ["15788790"],
        },
        current_weight: 338,
        updated_at: now,
      },
    ],
  });

  const secondaryCloudSpool = silkSpool({
    bambuSpoolId: "15788790",
    filamentName: "PLA OFFWHITE VELVET",
    filamentType: "PLA",
    inPrinter: false,
  });

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [secondaryCloudSpool]);

  assert.equal(result.spoolsInserted, 1, "dois rolos físicos = dois carretéis");
  assert.equal(client.tables.spools.length, 2);
  const original = client.tables.spools.find((s: any) => s.id === survivingId);
  assert.equal(original.bambu_spool_id, "15147446", "o rolo original não muda de identidade");
  assert.equal(original.current_weight, 338, "peso do rolo original preservado");
  const segundo = client.tables.spools.find((s: any) => s.id !== survivingId);
  assert.equal(segundo.bambu_spool_id, "15788790");
});

test("buildSourceMetadata descarta a lista legada secondary_bambu_spool_ids", () => {
  const meta = buildSourceMetadata(
    silkSpool({ bambuSpoolId: "15147446" }),
    { secondary_bambu_spool_ids: ["15788790"], outra_chave: 1 }
  );
  assert.equal("secondary_bambu_spool_ids" in meta, false);
  assert.equal((meta as any).outra_chave, 1);
});

test("syncBambuCloudSpoolsFromParsed: dois rolos idênticos novos na Bambu viram dois carretéis", async () => {
  const client = new FakeSupabaseClient({ spools: [] });
  const a = silkSpool({ bambuSpoolId: "900001", filamentName: "PLA BRANCO ULTRA SILK", filamentType: "PLA" });
  const b = silkSpool({ bambuSpoolId: "900002", filamentName: "PLA BRANCO ULTRA SILK", filamentType: "PLA" });

  const result = await syncBambuCloudSpoolsFromParsed(asSupabase(client), USER_ID, [a, b]);

  assert.equal(result.spoolsInserted, 2);
  assert.deepEqual(client.tables.spools.map((s: any) => s.bambu_spool_id).sort(), ["900001", "900002"]);
  assert.equal(result.profilesUpserted, 1, "mesmo filamentId = um perfil só");
});

