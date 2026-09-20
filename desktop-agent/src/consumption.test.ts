import test from "node:test";
import assert from "node:assert/strict";

import { computeConsumptionPerSlot, computeFinalGrams, buildJobConsumptionItems } from "./consumption";
import type { FilamentSliceInfo } from "./ftpsParser";

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

