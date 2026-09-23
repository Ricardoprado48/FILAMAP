import test from "node:test";
import assert from "node:assert/strict";

import {
  computeConsumptionPerSlot,
  computeFinalGrams,
  buildJobConsumptionItems,
  detectPhysicalIdentityMismatches,
  resolvePhysicalSpoolForSlot,
  resolvePhysicalSpoolsForJob,
  groupBambuCandidatesBySlot,
  computeAmsSlotSelfHeals,
} from "./consumption";
import type { FilamentSliceInfo } from "./ftpsParser";
import type { JobConsumptionItem, SpoolPhysicalInfo, BambuSyncedSpoolRow, SlotResolution } from "./consumption";

function slice(
  trayId: number,
  totalGrams: number,
  weightDiscount = 0
): FilamentSliceInfo {
  return {
    trayId,
    modelGrams: totalGrams,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams,
    color: "#FFFFFF",
    weightDiscount,
  };
}

test("exact: usa consumo real de um único slot", () => {
  const result = computeConsumptionPerSlot(
    [0],
    [slice(0, 42.5, 2.5)],
    100,
    300
  );

  assert.deepEqual(result.get(0), {
    grams: 42.5,
    quality: "exact",
    weightDiscount: 2.5,
  });
});

test("exact multicolor: mantém peso individual por slot", () => {
  const result = computeConsumptionPerSlot(
    [0, 2],
    [
      slice(0, 30.2, 1.2),
      slice(2, 15.8, 0.8),
    ],
    100,
    300
  );

  assert.deepEqual(result.get(0), {
    grams: 30.2,
    quality: "exact",
    weightDiscount: 1.2,
  });

  assert.deepEqual(result.get(2), {
    grams: 15.8,
    quality: "exact",
    weightDiscount: 0.8,
  });
});

test("exact: slot usado pela AMS mas ausente no slicer fica unknown", () => {
  const result = computeConsumptionPerSlot(
    [0, 1],
    [slice(0, 25)],
    0,
    0
  );

  assert.deepEqual(result.get(1), {
    grams: 0,
    quality: "unknown",
    weightDiscount: 0,
  });
});

test("estimated_filename: divide peso igualmente entre slots", () => {
  const result = computeConsumptionPerSlot(
    [0, 1],
    undefined,
    50,
    200
  );

  assert.deepEqual(result.get(0), {
    grams: 25,
    quality: "estimated_filename",
    weightDiscount: 0,
  });

  assert.deepEqual(result.get(1), {
    grams: 25,
    quality: "estimated_filename",
    weightDiscount: 0,
  });
});

test("estimated_duration: calcula 0.22g/min e divide entre slots", () => {
  const result = computeConsumptionPerSlot(
    [0, 1],
    undefined,
    0,
    100
  );

  assert.deepEqual(result.get(0), {
    grams: 11,
    quality: "estimated_duration",
    weightDiscount: 0,
  });

  assert.deepEqual(result.get(1), {
    grams: 11,
    quality: "estimated_duration",
    weightDiscount: 0,
  });
});

test("unknown: sem nenhuma fonte de consumo não desconta peso", () => {
  const result = computeConsumptionPerSlot(
    [3],
    undefined,
    0,
    0
  );

  assert.deepEqual(result.get(3), {
    grams: 0,
    quality: "unknown",
    weightDiscount: 0,
  });
});

test("sem slots conhecidos: usa slot 0 como fallback", () => {
  const result = computeConsumptionPerSlot(
    [],
    undefined,
    20,
    0
  );

  assert.deepEqual(result.get(0), {
    grams: 20,
    quality: "estimated_filename",
    weightDiscount: 0,
  });
});

test("final grams: impressão completa aplica desconto integral", () => {
  assert.equal(
    computeFinalGrams(50, 5, 100, "exact"),
    45
  );
});

test("final grams: impressão interrompida aplica consumo e desconto proporcionalmente", () => {
  assert.equal(
    computeFinalGrams(50, 10, 50, "exact"),
    20
  );
});

test("final grams: estimated_filename também respeita percentual executado", () => {
  assert.equal(
    computeFinalGrams(40, 0, 25, "estimated_filename"),
    10
  );
});

test("final grams: quality unknown nunca desconta peso", () => {
  assert.equal(
    computeFinalGrams(100, 0, 100, "unknown"),
    0
  );
});

test("final grams: percentual acima de 100 é limitado a 100", () => {
  assert.equal(
    computeFinalGrams(50, 5, 150, "exact"),
    45
  );
});

test("final grams: percentual negativo é limitado a zero", () => {
  assert.equal(
    computeFinalGrams(50, 5, -20, "exact"),
    0
  );
});

test("final grams: desconto nunca produz consumo negativo", () => {
  assert.equal(
    computeFinalGrams(5, 10, 100, "exact"),
    0
  );
});

test("build items: associa corretamente spool ao slot", () => {
  const perSlot = new Map([
    [0, { grams: 30, quality: "exact" as const, weightDiscount: 0 }],
    [1, { grams: 20, quality: "exact" as const, weightDiscount: 0 }],
  ]);

  const spoolBySlot = new Map<number, string | null>([
    [0, "spool-a"],
    [1, "spool-b"],
  ]);

  const items = buildJobConsumptionItems(
    perSlot,
    spoolBySlot,
    100
  );

  assert.deepEqual(items, [
    {
      spool_id: "spool-a",
      slot_index: 0,
      grams: 30,
      consumption_quality: "exact",
      orphan_slot: false,
    },
    {
      spool_id: "spool-b",
      slot_index: 1,
      grams: 20,
      consumption_quality: "exact",
      orphan_slot: false,
    },
  ]);
});

test("build items: slot sem spool vira orphan_slot", () => {
  const perSlot = new Map([
    [2, { grams: 15, quality: "exact" as const, weightDiscount: 0 }],
  ]);

  const spoolBySlot = new Map<number, string | null>();

  const items = buildJobConsumptionItems(
    perSlot,
    spoolBySlot,
    100
  );

  assert.deepEqual(items[0], {
    spool_id: null,
    slot_index: 2,
    grams: 15,
    consumption_quality: "exact",
    orphan_slot: true,
  });
});

test("build items: unknown nunca produz gramas para débito", () => {
  const perSlot = new Map([
    [0, { grams: 50, quality: "unknown" as const, weightDiscount: 0 }],
  ]);

  const spoolBySlot = new Map<number, string | null>([
    [0, "spool-a"],
  ]);

  const items = buildJobConsumptionItems(
    perSlot,
    spoolBySlot,
    100
  );

  assert.equal(items[0].grams, 0);
  assert.equal(items[0].consumption_quality, "unknown");
  assert.equal(items[0].orphan_slot, false);
});

test("build items: impressão parcial aplica percentual antes da RPC", () => {
  const perSlot = new Map([
    [0, { grams: 40, quality: "exact" as const, weightDiscount: 4 }],
  ]);

  const spoolBySlot = new Map<number, string | null>([
    [0, "spool-a"],
  ]);

  const items = buildJobConsumptionItems(
    perSlot,
    spoolBySlot,
    50
  );

  assert.equal(items[0].grams, 18);
});

test("build items: multicolor preserva um item por slot", () => {
  const perSlot = new Map([
    [0, { grams: 25, quality: "exact" as const, weightDiscount: 0 }],
    [2, { grams: 10, quality: "exact" as const, weightDiscount: 0 }],
  ]);

  const spoolBySlot = new Map<number, string | null>([
    [0, "spool-a"],
    [2, "spool-c"],
  ]);

  const items = buildJobConsumptionItems(
    perSlot,
    spoolBySlot,
    100
  );

  assert.equal(items.length, 2);
  assert.equal(items[0].slot_index, 0);
  assert.equal(items[1].slot_index, 2);
});

function item(
  slotIndex: number,
  spoolId: string | null,
  grams = 10
): JobConsumptionItem {
  return {
    spool_id: spoolId,
    slot_index: slotIndex,
    grams,
    consumption_quality: "exact",
    orphan_slot: !spoolId,
  };
}

function physical(overrides: Partial<SpoolPhysicalInfo> = {}): SpoolPhysicalInfo {
  return {
    bambuSpoolId: "15582983",
    bambuDevId: "01P00A000000000",
    bambuInPrinter: true,
    bambuSlotId: "0",
    ...overrides,
  };
}

test("cross-check: sem bambu_spool_id (spool nunca sincronizado da nuvem) não gera divergência", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map([[0, physical({ bambuSpoolId: null })]]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.deepEqual(mismatches, []);
});

test("cross-check: slot sem nenhum dado físico (nunca sincronizado) não gera divergência", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map<number, SpoolPhysicalInfo | null>([[0, null]]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.deepEqual(mismatches, []);
});

test("cross-check: dev_id/slot_id ausentes na Bambu Cloud não geram divergência (inconclusivo != divergente)", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map([
    [0, physical({ bambuDevId: null, bambuSlotId: null })],
  ]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.deepEqual(mismatches, []);
});

test("cross-check: localização Bambu concorda com o vínculo NFC não gera divergência", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map([
    [0, physical({ bambuDevId: "01P00A000000000", bambuSlotId: "0", bambuInPrinter: true })],
  ]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.deepEqual(mismatches, []);
});

test("cross-check: spool trocado/movido -- Bambu Cloud reporta bambu_in_printer=false", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map([[0, physical({ bambuInPrinter: false })]]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].slotIndex, 0);
  assert.equal(mismatches[0].spoolId, "spool-a");
  assert.match(mismatches[0].reason, /em impressora/);
});

test("cross-check: spool trocado/movido -- Bambu Cloud reporta outro dev_id (outra impressora)", () => {
  const items = [item(0, "spool-a")];
  const physicalInfoBySlot = new Map([[0, physical({ bambuDevId: "01P00A999999999" })]]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0].reason, /outra impressora/);
});

test("cross-check: spool trocado/movido -- Bambu Cloud reporta outro slot", () => {
  const items = [item(1, "spool-a")];
  const physicalInfoBySlot = new Map([[1, physical({ bambuSlotId: "3" })]]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0].reason, /slot 3/);
});

test("cross-check: slot órfão (sem spool_id) nunca gera divergência", () => {
  const items = [item(2, null, 0)];
  const physicalInfoBySlot = new Map<number, SpoolPhysicalInfo | null>();

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.deepEqual(mismatches, []);
});

test("cross-check: multicolor só reporta divergência no slot afetado", () => {
  const items = [item(0, "spool-a"), item(2, "spool-c")];
  const physicalInfoBySlot = new Map([
    [0, physical({ bambuSlotId: "0" })],
    [2, physical({ bambuSpoolId: "999", bambuSlotId: "9" })],
  ]);

  const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, "01P00A000000000");

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].slotIndex, 2);
});

// ---------------------------------------------------------------------------
// resolvePhysicalSpoolForSlot / resolvePhysicalSpoolsForJob
// ---------------------------------------------------------------------------

test("resolução: job resolve spool apenas pela Bambu Cloud, sem NFC (ams_slots vazio)", () => {
  const result = resolvePhysicalSpoolForSlot(0, ["spool-bambu"], null);

  assert.deepEqual(result, {
    slotIndex: 0,
    spoolId: "spool-bambu",
    source: "bambu_cloud",
    amsSlotSpoolId: null,
    conflict: false,
  });
});

test("resolução: Bambu Cloud e ams_slots apontam para o mesmo spool -- sem conflito", () => {
  const result = resolvePhysicalSpoolForSlot(0, ["spool-x"], "spool-x");

  assert.equal(result.spoolId, "spool-x");
  assert.equal(result.source, "bambu_cloud");
  assert.equal(result.conflict, false);
});

test("resolução: Bambu Cloud aponta spool A e ams_slots aponta spool B -- prevalece a Bambu Cloud e reporta conflito", () => {
  const result = resolvePhysicalSpoolForSlot(0, ["spool-a"], "spool-b");

  assert.equal(result.spoolId, "spool-a");
  assert.equal(result.source, "bambu_cloud");
  assert.equal(result.amsSlotSpoolId, "spool-b");
  assert.equal(result.conflict, true);
});

test("resolução: Bambu Cloud sem candidato -- fallback para ams_slots", () => {
  const result = resolvePhysicalSpoolForSlot(0, [], "spool-b");

  assert.equal(result.spoolId, "spool-b");
  assert.equal(result.source, "ams_slots");
  assert.equal(result.conflict, false);
});

test("resolução: Bambu Cloud ambígua (mais de 1 candidato) -- fallback para ams_slots, nunca escolhe um dos dois às cegas", () => {
  const result = resolvePhysicalSpoolForSlot(0, ["spool-a", "spool-b"], "spool-c");

  assert.equal(result.spoolId, "spool-c");
  assert.equal(result.source, "ams_slots");
});

test("resolução: nenhuma fonte disponível -- unknown, sem spool_id (orphan, sem débito incorreto)", () => {
  const result = resolvePhysicalSpoolForSlot(3, [], null);

  assert.deepEqual(result, {
    slotIndex: 3,
    spoolId: null,
    source: "none",
    amsSlotSpoolId: null,
    conflict: false,
  });
});

test("resolução: multicolor com 3 slots resolve cada um de forma independente", () => {
  const amsSlotBySlot = new Map<number, string | null>([
    [0, "old-a"],
    [1, null],
    [2, "spool-c"],
  ]);
  const bambuCandidatesBySlot = new Map<number, string[]>([
    [0, ["new-a"]], // conflito, prevalece Bambu Cloud
    [1, ["spool-b"]], // sem NFC, só Bambu Cloud
    [2, []], // sem candidato Bambu, fallback ams_slots
  ]);

  const resolutions = resolvePhysicalSpoolsForJob([0, 1, 2], amsSlotBySlot, bambuCandidatesBySlot);

  assert.equal(resolutions.get(0)?.spoolId, "new-a");
  assert.equal(resolutions.get(0)?.conflict, true);

  assert.equal(resolutions.get(1)?.spoolId, "spool-b");
  assert.equal(resolutions.get(1)?.source, "bambu_cloud");

  assert.equal(resolutions.get(2)?.spoolId, "spool-c");
  assert.equal(resolutions.get(2)?.source, "ams_slots");
});

// ---------------------------------------------------------------------------
// groupBambuCandidatesBySlot
// ---------------------------------------------------------------------------

function bambuRow(overrides: Partial<BambuSyncedSpoolRow> = {}): BambuSyncedSpoolRow {
  return {
    id: "spool-1",
    bambuDevId: "01P00A000000000",
    bambuSlotId: "0",
    bambuInPrinter: true,
    ...overrides,
  };
}

test("agrupamento: agrupa candidatos por slot_index numérico", () => {
  const rows = [
    bambuRow({ id: "spool-1", bambuSlotId: "0" }),
    bambuRow({ id: "spool-2", bambuSlotId: "2" }),
  ];

  const result = groupBambuCandidatesBySlot(rows, "01P00A000000000");

  assert.deepEqual(result.get(0), ["spool-1"]);
  assert.deepEqual(result.get(2), ["spool-2"]);
});

test("agrupamento: isolamento por impressora -- ignora linhas de outro dev_id mesmo se vierem na lista", () => {
  const rows = [
    bambuRow({ id: "spool-mine", bambuDevId: "01P00A000000000", bambuSlotId: "0" }),
    bambuRow({ id: "spool-other-printer", bambuDevId: "OUTRA-IMPRESSORA", bambuSlotId: "0" }),
  ];

  const result = groupBambuCandidatesBySlot(rows, "01P00A000000000");

  assert.deepEqual(result.get(0), ["spool-mine"]);
});

test("agrupamento: ignora linhas com bambu_in_printer=false", () => {
  const rows = [bambuRow({ bambuInPrinter: false })];

  const result = groupBambuCandidatesBySlot(rows, "01P00A000000000");

  assert.equal(result.size, 0);
});

test("agrupamento: ignora linhas sem bambu_slot_id ou com valor não numérico", () => {
  const rows = [
    bambuRow({ id: "sem-slot", bambuSlotId: null }),
    bambuRow({ id: "slot-invalido", bambuSlotId: "external" }),
  ];

  const result = groupBambuCandidatesBySlot(rows, "01P00A000000000");

  assert.equal(result.size, 0);
});

test("agrupamento: dois spools no mesmo slot geram lista com 2 candidatos (ambíguo)", () => {
  const rows = [
    bambuRow({ id: "spool-1", bambuSlotId: "0" }),
    bambuRow({ id: "spool-2", bambuSlotId: "0" }),
  ];

  const result = groupBambuCandidatesBySlot(rows, "01P00A000000000");

  assert.deepEqual(result.get(0), ["spool-1", "spool-2"]);
});

// ---------------------------------------------------------------------------
// computeAmsSlotSelfHeals
// ---------------------------------------------------------------------------

function resolution(overrides: Partial<SlotResolution> = {}): SlotResolution {
  return {
    slotIndex: 0,
    spoolId: "spool-a",
    source: "bambu_cloud",
    amsSlotSpoolId: null,
    conflict: false,
    ...overrides,
  };
}

test("self-heal: corrige ams_slots quando Bambu Cloud resolveu um spool novo (sem vínculo anterior)", () => {
  const resolutions = new Map([[0, resolution({ spoolId: "spool-a", amsSlotSpoolId: null })]]);

  const heals = computeAmsSlotSelfHeals(resolutions);

  assert.deepEqual(heals, [{ slotIndex: 0, spoolId: "spool-a" }]);
});

test("self-heal: corrige ams_slots em caso de conflito (Bambu Cloud diverge do vínculo NFC)", () => {
  const resolutions = new Map([
    [0, resolution({ spoolId: "spool-a", amsSlotSpoolId: "spool-b", conflict: true })],
  ]);

  const heals = computeAmsSlotSelfHeals(resolutions);

  assert.deepEqual(heals, [{ slotIndex: 0, spoolId: "spool-a" }]);
});

test("self-heal: nada a fazer quando ams_slots já bate com a Bambu Cloud (idempotência)", () => {
  const resolutions = new Map([
    [0, resolution({ spoolId: "spool-a", amsSlotSpoolId: "spool-a", conflict: false })],
  ]);

  const heals = computeAmsSlotSelfHeals(resolutions);

  assert.deepEqual(heals, []);
});

test("self-heal: nunca mexe em ams_slots quando a resolução caiu por fallback (source ams_slots)", () => {
  const resolutions = new Map([
    [0, resolution({ source: "ams_slots", spoolId: "spool-b", amsSlotSpoolId: "spool-b" })],
  ]);

  const heals = computeAmsSlotSelfHeals(resolutions);

  assert.deepEqual(heals, []);
});

test("self-heal: nunca mexe em ams_slots quando a resolução ficou 'none'", () => {
  const resolutions = new Map([[0, resolution({ source: "none", spoolId: null, amsSlotSpoolId: null })]]);

  const heals = computeAmsSlotSelfHeals(resolutions);

  assert.deepEqual(heals, []);
});

test("self-heal: reprocessar o mesmo job após o heal não gera novo heal (idempotência de ponta a ponta)", () => {
  // Primeira rodada: ams_slots ainda não tinha nada.
  const firstRun = new Map([[0, resolution({ spoolId: "spool-a", amsSlotSpoolId: null })]]);
  const firstHeals = computeAmsSlotSelfHeals(firstRun);
  assert.equal(firstHeals.length, 1);

  // Segunda rodada: ams_slots já foi corrigido pela primeira -- mesmo
  // snapshot da Bambu Cloud, mesmo resultado de resolução, sem heal novo.
  const secondRun = new Map([[0, resolution({ spoolId: "spool-a", amsSlotSpoolId: "spool-a" })]]);
  const secondHeals = computeAmsSlotSelfHeals(secondRun);
  assert.equal(secondHeals.length, 0);
});

