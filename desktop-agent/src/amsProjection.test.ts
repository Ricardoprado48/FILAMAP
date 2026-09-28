import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMqttAmsStatus,
  reconcileAmsState,
  isMaterialCompatible,
  isColorCompatible,
  syncAmsProjection,
  type ReconcileAmsInputSpool,
  type ReconcileAmsInputAmsSlot,
} from "./amsProjection";

test("parseMqttAmsStatus: parse payload real da Bambu com tray_exist_bits 'd'", () => {
  const payload = {
    print: {
      ams: {
        ams: [
          {
            id: "0",
            tray: [
              {
                id: "0",
                tray_type: "PLA",
                tray_color: "161616FF",
                tag_uid: "0000000000000000",
                tray_info_idx: "Paaadef6",
              },
              { id: "1" },
              {
                id: "2",
                tray_type: "PLA",
                tray_color: "F72323FF",
                tag_uid: "0000000000000000",
                tray_info_idx: "P790d873",
              },
              {
                id: "3",
                tray_type: "PETG",
                tray_color: "FFFFFFFF",
                tag_uid: "0000000000000000",
                tray_info_idx: "P5881e45",
              },
            ],
          },
        ],
        tray_exist_bits: "d",
      },
    },
  };

  const trays = parseMqttAmsStatus(payload);
  assert.equal(trays.length, 4);

  // Slot 0 (ocupado PLA Preto)
  assert.equal(trays[0].slotIndex, 0);
  assert.equal(trays[0].occupied, true);
  assert.equal(trays[0].trayType, "PLA");
  assert.equal(trays[0].trayColorHex, "#161616");

  // Slot 1 (vazio)
  assert.equal(trays[1].slotIndex, 1);
  assert.equal(trays[1].occupied, false);
  assert.equal(trays[1].trayType, null);
  assert.equal(trays[1].trayColorHex, null);

  // Slot 2 (ocupado PLA Vermelho)
  assert.equal(trays[2].slotIndex, 2);
  assert.equal(trays[2].occupied, true);
  assert.equal(trays[2].trayType, "PLA");
  assert.equal(trays[2].trayColorHex, "#F72323");

  // Slot 3 (ocupado PETG Branco)
  assert.equal(trays[3].slotIndex, 3);
  assert.equal(trays[3].occupied, true);
  assert.equal(trays[3].trayType, "PETG");
  assert.equal(trays[3].trayColorHex, "#FFFFFF");
});

test("parseMqttAmsStatus: tolera payload sem ams ou nulo", () => {
  assert.deepEqual(parseMqttAmsStatus(null), []);
  assert.deepEqual(parseMqttAmsStatus({}), []);
  assert.deepEqual(parseMqttAmsStatus({ print: {} }), []);
  assert.deepEqual(parseMqttAmsStatus({ print: { ams: null } }), []);
});

test("isMaterialCompatible: valida estritamente materiais", () => {
  assert.equal(isMaterialCompatible("PLA", "PLA"), true);
  assert.equal(isMaterialCompatible("PLA Lite", "PLA"), true);
  assert.equal(isMaterialCompatible("PETG", "PETG"), true);
  assert.equal(isMaterialCompatible("PLA", "PETG"), false);
  assert.equal(isMaterialCompatible("ABS", "PLA"), false);
  assert.equal(isMaterialCompatible(null, "PLA"), false);
  assert.equal(isMaterialCompatible("PLA", null), true);
});

test("isColorCompatible: normaliza e compara cores hexadecimais", () => {
  assert.equal(isColorCompatible("#ffffff", "#FFFFFF"), true);
  assert.equal(isColorCompatible("#FFFFFF88", "#FFFFFF"), true);
  assert.equal(isColorCompatible("#161616", "#161616FF"), true);
  assert.equal(isColorCompatible("#161616", "#FFFFFF"), false);
  assert.equal(isColorCompatible(null, "#FFFFFF"), true);
});

test("reconcileAmsState: resolve caso real com conflito no Slot 4 (PLA Lite Amarelo vs PETG Branco)", () => {
  const printerSerial = "01P00A123456789";

  const mqttTrays = [
    {
      slotIndex: 0,
      occupied: true,
      trayType: "PLA",
      trayColorHex: "#161616",
      tagUid: "0000000000000000",
      trayInfoIdx: "Paaadef6",
      traySubBrands: null,
    },
    {
      slotIndex: 1,
      occupied: false,
      trayType: null,
      trayColorHex: null,
      tagUid: null,
      trayInfoIdx: null,
      traySubBrands: null,
    },
    {
      slotIndex: 2,
      occupied: true,
      trayType: "PLA",
      trayColorHex: "#F72323",
      tagUid: "0000000000000000",
      trayInfoIdx: "P790d873",
      traySubBrands: null,
    },
    {
      slotIndex: 3,
      occupied: true,
      trayType: "PETG",
      trayColorHex: "#FFFFFF",
      tagUid: "0000000000000000",
      trayInfoIdx: "P5881e45",
      traySubBrands: null,
    },
  ];

  const spools: ReconcileAmsInputSpool[] = [
    {
      id: "spool-preto-velvet",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Preto Velvet",
      color_hex: "#111827",
      nfc_uid: "FILA-PLA-PRETO",
      bambu_spool_id: "14479573",
      bambu_dev_id: printerSerial,
      bambu_slot_id: "0",
      bambu_in_printer: true,
    },
    {
      id: "spool-vermelho-ultra-silk",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Vermelho Ultra Silk",
      color_hex: "#F72323",
      nfc_uid: null,
      bambu_spool_id: "15582983",
      bambu_dev_id: printerSerial,
      bambu_slot_id: "2",
      bambu_in_printer: true,
    },
    {
      id: "spool-pla-lite-amarelo",
      brand: "Bambu Lab",
      material: "PLA",
      color_name: "PLA Lite AMARELO",
      color_hex: "#FFB549",
      nfc_uid: null,
      bambu_spool_id: "8594733",
      bambu_dev_id: printerSerial,
      bambu_slot_id: "3", // STALE Bambu Cloud entry!
      bambu_in_printer: true,
    },
    {
      id: "spool-petg-branco",
      brand: "MasterPrint",
      material: "PETG",
      color_name: "Branco",
      color_hex: "#FFFFFF",
      nfc_uid: "FILA-PETG-BRANCO",
      bambu_spool_id: "15628399",
      bambu_dev_id: printerSerial,
      bambu_slot_id: "3",
      bambu_in_printer: true,
    },
    {
      id: "spool-estoque-avulso",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Azul Céu",
      color_hex: "#0000FF",
      nfc_uid: "FILA-PLA-AZUL",
      bambu_spool_id: null,
      bambu_dev_id: null,
      bambu_slot_id: null,
      bambu_in_printer: false,
    },
  ];

  const currentAmsSlots: ReconcileAmsInputAmsSlot[] = [
    { slot_index: 0, spool_id: "spool-preto-velvet" },
    { slot_index: 1, spool_id: null },
    { slot_index: 2, spool_id: null },
    { slot_index: 3, spool_id: null },
  ];

  const result = reconcileAmsState({
    printerSerial,
    mqttTrays,
    spools,
    currentAmsSlots,
  });

  // 1. Verificação de slots atribuídos
  assert.equal(result.slotAssignments.get(0), "spool-preto-velvet");
  assert.equal(result.slotAssignments.get(1), null);
  assert.equal(result.slotAssignments.get(2), "spool-vermelho-ultra-silk");
  assert.equal(result.slotAssignments.get(3), "spool-petg-branco");

  // 2. Conflito registrado para o slot 3
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].slotIndex, 3);
  assert.match(result.conflicts[0].description, /Bambu Cloud apontava carretel "PLA Lite AMARELO"/);

  // 3. PLA Lite Amarelo é desvinculado da impressora
  const plaLiteUpdate = result.spoolLocationUpdates.find((u) => u.id === "spool-pla-lite-amarelo");
  assert.ok(plaLiteUpdate, "PLA Lite Amarelo deve ter atualização de localização");
  assert.equal(plaLiteUpdate.bambu_in_printer, false);
  assert.equal(plaLiteUpdate.bambu_slot_id, null);
  assert.equal(plaLiteUpdate.bambu_dev_id, null);

  // 4. Carretel avulso do estoque permanece intocado
  const avulsoUpdate = result.spoolLocationUpdates.find((u) => u.id === "spool-estoque-avulso");
  assert.equal(avulsoUpdate, undefined);
});

test("reconcileAmsState: reconhece carretel por RFID Bambu Lab", () => {
  const printerSerial = "01P00A123456789";

  const mqttTrays = [
    {
      slotIndex: 0,
      occupied: true,
      trayType: "PLA",
      trayColorHex: "#FFB549",
      tagUid: "7AB5A3DC12345678",
      trayInfoIdx: "P001",
      traySubBrands: null,
    },
    { slotIndex: 1, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
    { slotIndex: 2, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
    { slotIndex: 3, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
  ];

  const spools: ReconcileAmsInputSpool[] = [
    {
      id: "spool-bambu-rfid",
      brand: "Bambu Lab",
      material: "PLA",
      color_name: "PLA Lite Amarelo",
      color_hex: "#FFB549",
      nfc_uid: null,
      bambu_spool_id: "8594733",
      bambu_dev_id: null,
      bambu_slot_id: null,
      bambu_in_printer: false,
      bambu_source_metadata: { rfid: "7AB5A3DC12345678" },
    },
  ];

  const result = reconcileAmsState({
    printerSerial,
    mqttTrays,
    spools,
    currentAmsSlots: [],
  });

  assert.equal(result.slotAssignments.get(0), "spool-bambu-rfid");
  const update = result.spoolLocationUpdates.find((u) => u.id === "spool-bambu-rfid");
  assert.ok(update);
  assert.equal(update.bambu_in_printer, true);
  assert.equal(update.bambu_slot_id, "0");
});

test("reconcileAmsState: desvincula carretel quando slot é esvaziado fisicamente", () => {
  const printerSerial = "01P00A123456789";

  const mqttTrays = [
    { slotIndex: 0, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
    { slotIndex: 1, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
    { slotIndex: 2, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
    { slotIndex: 3, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null },
  ];

  const spools: ReconcileAmsInputSpool[] = [
    {
      id: "spool-removido",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Preto Velvet",
      color_hex: "#111827",
      nfc_uid: "FILA-001",
      bambu_spool_id: "14479573",
      bambu_dev_id: printerSerial,
      bambu_slot_id: "0",
      bambu_in_printer: true,
    },
  ];

  const result = reconcileAmsState({
    printerSerial,
    mqttTrays,
    spools,
    currentAmsSlots: [{ slot_index: 0, spool_id: "spool-removido" }],
  });

  assert.equal(result.slotAssignments.get(0), null);
  const update = result.spoolLocationUpdates.find((u) => u.id === "spool-removido");
  assert.ok(update);
  assert.equal(update.bambu_in_printer, false);
  assert.equal(update.bambu_slot_id, null);
});

test("syncAmsProjection: idempotência e persistência no banco simulado", async () => {
  const upsertedAmsSlots: any[] = [];
  const updatedSpools: any[] = [];

  const mockSupabase: any = {
    from(table: string) {
      if (table === "ams_slots") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    { slot_index: 0, spool_id: "spool-0" },
                    { slot_index: 1, spool_id: null },
                    { slot_index: 2, spool_id: null },
                    { slot_index: 3, spool_id: null },
                  ],
                  error: null,
                });
              },
            };
          },
          upsert(record: any) {
            upsertedAmsSlots.push(record);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "spools") {
        return {
          select() {
            return Promise.resolve({
              data: [
                {
                  id: "spool-0",
                  brand: "Voolt3D",
                  material: "PLA",
                  color_name: "Preto",
                  color_hex: "#161616",
                  bambu_dev_id: "PRINTER1",
                  bambu_slot_id: "0",
                  bambu_in_printer: true,
                },
                {
                  id: "spool-2",
                  brand: "Voolt3D",
                  material: "PLA",
                  color_name: "Vermelho",
                  color_hex: "#F72323",
                  bambu_dev_id: null,
                  bambu_slot_id: null,
                  bambu_in_printer: false,
                },
              ],
              error: null,
            });
          },
          update(payload: any) {
            return {
              eq(col: string, val: string) {
                updatedSpools.push({ id: val, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Tabela não mockada: ${table}`);
    },
  };

  const payload = {
    print: {
      ams: {
        ams: [
          {
            id: "0",
            tray: [
              { id: "0", tray_type: "PLA", tray_color: "161616FF" },
              { id: "1" },
              { id: "2", tray_type: "PLA", tray_color: "F72323FF" },
              { id: "3" },
            ],
          },
        ],
        tray_exist_bits: "5", // 1 e 4 ocupados (slots 0 e 2)
      },
    },
  };

  const counts = await syncAmsProjection(mockSupabase, "printer-uuid", "PRINTER1", payload);

  // Slot 0 já tinha spool-0, portanto só o slot 2 precisava ser gravado
  assert.equal(counts.slotsUpdated, 1);
  assert.equal(upsertedAmsSlots.length, 1);
  assert.equal(upsertedAmsSlots[0].slot_index, 2);
  assert.equal(upsertedAmsSlots[0].spool_id, "spool-2");

  // spool-2 foi vinculado à impressora
  assert.equal(counts.spoolsUpdated, 1);
  assert.equal(updatedSpools[0].id, "spool-2");
  assert.equal(updatedSpools[0].payload.bambu_in_printer, true);
  assert.equal(updatedSpools[0].payload.bambu_slot_id, "2");
});

// ---------------------------------------------------------------------------
// Escolha manual na Web (assigned_by = 'user')
// ---------------------------------------------------------------------------

const EMPTY_TRAY = (slotIndex: number) => ({ slotIndex, occupied: false, trayType: null, trayColorHex: null, tagUid: null, trayInfoIdx: null, traySubBrands: null });
const PETG_TRAY = { slotIndex: 0, occupied: true, trayType: "PETG", trayColorHex: "#FFFFFF", tagUid: "0000000000000000", trayInfoIdx: null, traySubBrands: null };

function spool(id: string, material: string, extra: Partial<ReconcileAmsInputSpool> = {}): ReconcileAmsInputSpool {
  return {
    id, brand: "X", material, color_name: id, color_hex: null, nfc_uid: null,
    bambu_spool_id: null, bambu_dev_id: null, bambu_slot_id: null, bambu_in_printer: false, ...extra,
  };
}

test("reconcileAmsState: escolha do usuário na Web vence a nuvem Bambu", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PETG_TRAY, EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("escolhido", "PETG"),
      spool("nuvem-diz", "PETG", { bambu_dev_id: "P1", bambu_slot_id: "0", bambu_in_printer: true }),
    ],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido", assigned_by: "user" }],
  });
  assert.equal(result.slotAssignments.get(0), "escolhido");
});

test("reconcileAmsState: sem marca 'user' (vínculo antigo/automático) a nuvem continua valendo", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PETG_TRAY, EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("anterior", "PETG"),
      spool("nuvem-diz", "PETG", { bambu_dev_id: "P1", bambu_slot_id: "0", bambu_in_printer: true }),
    ],
    currentAmsSlots: [{ slot_index: 0, spool_id: "anterior", assigned_by: "agent" }],
  });
  assert.equal(result.slotAssignments.get(0), "nuvem-diz");
});

test("reconcileAmsState: RFID Bambu (prova física) vence a escolha do usuário", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [{ ...PETG_TRAY, tagUid: "AABBCCDDEEFF0011" }, EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [spool("escolhido", "PETG"), spool("com-rfid", "PETG", { bambu_source_metadata: { rfid: "AABBCCDDEEFF0011" } })],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido", assigned_by: "user" }],
  });
  assert.equal(result.slotAssignments.get(0), "com-rfid");
});

test("reconcileAmsState: material no AMS mudou -> escolha do usuário cai e é registrada como conflito", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PETG_TRAY, EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [spool("escolhido-pla", "PLA")],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido-pla", assigned_by: "user" }],
  });
  assert.equal(result.slotAssignments.get(0), null);
  assert.ok(result.conflicts.some((c) => c.description.includes("Escolha descartada")));
});

test("reconcileAmsState: slot esvaziado fisicamente limpa a escolha do usuário", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [EMPTY_TRAY(0), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [spool("escolhido", "PETG")],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido", assigned_by: "user" }],
  });
  assert.equal(result.slotAssignments.get(0), null);
});

test("syncAmsProjection: banco sem a coluna assigned_by (antes da migration) continua funcionando", async () => {
  const upserts: any[] = [];
  const selects: string[] = [];
  const missing = { code: "42703", message: "column ams_slots.assigned_by does not exist" };
  const mockSupabase: any = {
    from(table: string) {
      if (table === "ams_slots") {
        return {
          select(cols: string) {
            selects.push(cols);
            return {
              eq() {
                if (cols.includes("assigned_by")) return Promise.resolve({ data: null, error: missing });
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(record: any) {
            upserts.push(record);
            return Promise.resolve({ error: "assigned_by" in record ? { code: "PGRST204", message: "Could not find the 'assigned_at' column" } : null });
          },
        };
      }
      return {
        select() { return Promise.resolve({ data: [spool("s1", "PETG")], error: null }); },
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
  const payload = { print: { ams: { ams: [{ id: "0", tray: [{ id: "0", tray_type: "PETG", tray_color: "FFFFFFFF", tag_uid: "0000000000000000" }, { id: "1" }, { id: "2" }, { id: "3" }] }], tray_exist_bits: "1" } } };

  const counts = await syncAmsProjection(mockSupabase, "printer-1", "P1", payload);
  assert.equal(counts.slotsUpdated, 4);
  assert.deepEqual(selects, ["slot_index, spool_id, assigned_by, assigned_at", "slot_index, spool_id"]);
  const slot0 = upserts.filter((u) => u.slot_index === 0);
  assert.equal(slot0.length, 2, "tenta com assigned_by e repete sem");
  assert.equal(slot0[1].spool_id, "s1");
  assert.ok(!("assigned_by" in slot0[1]));
});

test("syncAmsProjection: carretel arquivado (D4) não entra no AMS", async () => {
  const upserts: any[] = [];
  const mockSupabase: any = {
    from(table: string) {
      if (table === "ams_slots") {
        return {
          select() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; },
          upsert(record: any) { upserts.push(record); return Promise.resolve({ error: null }); },
        };
      }
      return {
        select(cols: string) {
          assert.ok(cols.includes("archived_at"));
          return Promise.resolve({ data: [
            { ...spool("arquivado", "PETG", { bambu_dev_id: "P1", bambu_slot_id: "0", bambu_in_printer: true }), archived_at: "2026-09-28T00:00:00Z" },
            { ...spool("ativo", "PETG", { bambu_dev_id: "P1", bambu_slot_id: "0", bambu_in_printer: true }), archived_at: null },
          ], error: null });
        },
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
  const payload = { print: { ams: { ams: [{ id: "0", tray: [{ id: "0", tray_type: "PETG", tray_color: "FFFFFFFF" }, { id: "1" }, { id: "2" }, { id: "3" }] }], tray_exist_bits: "1" } } };
  await syncAmsProjection(mockSupabase, "printer-1", "P1", payload);
  const slot0 = upserts.find((u) => u.slot_index === 0);
  assert.equal(slot0.spool_id, "ativo");
});

test("syncAmsProjection: banco sem a coluna archived_at continua funcionando (consulta anterior)", async () => {
  const selects: string[] = [];
  const mockSupabase: any = {
    from(table: string) {
      if (table === "ams_slots") {
        return {
          select() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; },
          upsert() { return Promise.resolve({ error: null }); },
        };
      }
      if (table === "user_filament_profiles") {
        return { select() { return { not() { return Promise.resolve({ data: null, error: { code: "42703", message: "column filament_product_id does not exist" } }); } }; } };
      }
      return {
        select(cols: string) {
          selects.push(cols);
          if (cols.includes("archived_at")) return Promise.resolve({ data: null, error: { code: "42703", message: "column spools.archived_at does not exist" } });
          return Promise.resolve({ data: [spool("s1", "PETG")], error: null });
        },
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
  const payload = { print: { ams: { ams: [{ id: "0", tray: [{ id: "0", tray_type: "PETG", tray_color: "FFFFFFFF" }, { id: "1" }, { id: "2" }, { id: "3" }] }], tray_exist_bits: "1" } } };
  const counts = await syncAmsProjection(mockSupabase, "printer-1", "P1", payload);
  assert.equal(selects.length, 2);
  assert.ok(!selects[1].includes("archived_at"));
  assert.equal(counts.slotsUpdated, 4);
});

// ---------------------------------------------------------------------------
// v4.1: escolha mais recente vale (Filamap x Dispositivos da Bambu) e perfil do slot
// ---------------------------------------------------------------------------

const PLA_TRAY = (slotIndex: number, trayInfoIdx: string | null = null) => ({
  slotIndex, occupied: true, trayType: "PLA", trayColorHex: "#161616", tagUid: "0000000000000000", trayInfoIdx, traySubBrands: null,
});
const cloudAt = (serial: string, slot: number, changedAt: string | null) => ({
  bambu_source_metadata: { cloud_position: `${serial}|${slot}`, cloud_position_changed_at: changedAt },
});

test("v4.1: troca feita na Bambu DEPOIS da escolha no Filamap vence (a mais recente vale)", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("escolhido-filamap", "PLA"),
      spool("escolhido-bambu", "PLA", cloudAt("P1", 0, "2026-09-29T12:00:00Z")),
    ],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido-filamap", assigned_by: "user", assigned_at: "2026-09-29T10:00:00Z" }],
  });
  assert.equal(result.slotAssignments.get(0), "escolhido-bambu");
});

test("v4.1: escolha no Filamap DEPOIS da troca na Bambu continua valendo", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("escolhido-filamap", "PLA"),
      spool("escolhido-bambu", "PLA", cloudAt("P1", 0, "2026-09-29T09:00:00Z")),
    ],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido-filamap", assigned_by: "user", assigned_at: "2026-09-29T10:00:00Z" }],
  });
  assert.equal(result.slotAssignments.get(0), "escolhido-filamap");
});

test("v4.1: posição da nuvem de idade desconhecida (1a leitura após instalar) não passa por cima da escolha do usuário", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [spool("escolhido-filamap", "PLA"), spool("nuvem", "PLA", cloudAt("P1", 0, null))],
    currentAmsSlots: [{ slot_index: 0, spool_id: "escolhido-filamap", assigned_by: "user", assigned_at: "2026-09-29T10:00:00Z" }],
  });
  assert.equal(result.slotAssignments.get(0), "escolhido-filamap");
});

test("v4.1: a visão da nuvem vem do metadata, não do bambu_slot_id que a projeção reescreve", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      // projeção antiga deixou este no slot 0, mas a nuvem já diz que ele saiu
      spool("antigo", "PLA", { bambu_dev_id: "P1", bambu_slot_id: "0", bambu_in_printer: true, bambu_source_metadata: { cloud_position: null, cloud_position_changed_at: "2026-09-29T12:00:00Z" } }),
      spool("novo", "PLA", cloudAt("P1", 0, "2026-09-29T12:00:00Z")),
    ],
    currentAmsSlots: [],
  });
  assert.equal(result.slotAssignments.get(0), "novo");
});

test("v4.1: perfil do slot identifica o único carretel daquele produto (mesmo com outros PLA pretos)", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0, "Pef7a165"), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("preto-velvet", "PLA", { color_hex: "#161616", filament_product_id: "prod-velvet" }),
      spool("preto-silk", "PLA", { color_hex: "#161616", filament_product_id: "prod-silk" }),
    ],
    currentAmsSlots: [],
    presetProducts: { Pef7a165: "prod-velvet" },
  });
  assert.equal(result.slotAssignments.get(0), "preto-velvet");
});

test("v4.1: dois carretéis do mesmo produto -> não chuta (fica o que já estava no slot, ou nenhum)", () => {
  const base = {
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0, "Pef7a165"), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("rolo-a", "PLA", { color_hex: "#161616", filament_product_id: "prod-velvet" }),
      spool("rolo-b", "PLA", { color_hex: "#161616", filament_product_id: "prod-velvet" }),
    ],
    presetProducts: { Pef7a165: "prod-velvet" },
  };
  assert.equal(reconcileAmsState({ ...base, currentAmsSlots: [] }).slotAssignments.get(0), null);
  assert.equal(reconcileAmsState({ ...base, currentAmsSlots: [{ slot_index: 0, spool_id: "rolo-b" }] }).slotAssignments.get(0), "rolo-b");
});

test("v4.1: carretel anterior de OUTRO produto que o perfil do slot não é mantido (rolo foi trocado)", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0, "P0a22169"), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("preto-velvet", "PLA", { filament_product_id: "prod-preto" }),
      spool("branco-velvet", "PLA", { filament_product_id: "prod-branco" }),
    ],
    currentAmsSlots: [{ slot_index: 0, spool_id: "preto-velvet" }],
    presetProducts: { P0a22169: "prod-branco" },
  });
  assert.equal(result.slotAssignments.get(0), "branco-velvet");
});

test("v4.1: nuvem desatualizada que contradiz o perfil do slot é rejeitada", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0, "P0a22169"), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [
      spool("nuvem-velha", "PLA", { filament_product_id: "prod-preto", ...cloudAt("P1", 0, "2026-09-29T12:00:00Z") }),
      spool("branco-velvet", "PLA", { filament_product_id: "prod-branco" }),
    ],
    currentAmsSlots: [],
    presetProducts: { P0a22169: "prod-branco" },
  });
  assert.equal(result.slotAssignments.get(0), "branco-velvet");
  assert.ok(result.conflicts.some((c) => c.description.includes("perfil do slot")));
});

test("v4.1: perfil genérico/desconhecido no slot não muda nada (sem mapa, segue material + cor)", () => {
  const result = reconcileAmsState({
    printerSerial: "P1",
    mqttTrays: [PLA_TRAY(0, "GFL99"), EMPTY_TRAY(1), EMPTY_TRAY(2), EMPTY_TRAY(3)],
    spools: [spool("unico-pla", "PLA", { filament_product_id: "prod-x" })],
    currentAmsSlots: [],
    presetProducts: { Pef7a165: "prod-velvet" },
  });
  assert.equal(result.slotAssignments.get(0), "unico-pla");
});
