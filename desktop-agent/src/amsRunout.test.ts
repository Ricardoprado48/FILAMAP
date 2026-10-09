import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRunoutSplit,
  emptyAmsEvents,
  findBackupSlot,
  observeRunout,
  parseRunoutHms,
  trayOccupancy,
} from "./amsRunout";
import { buildJobConsumptionItems, type SlotConsumption } from "./consumption";

const T0 = Date.parse("2026-10-08T18:15:00Z");
const min = (m: number) => T0 + m * 60_000;

test("parseRunoutHms: 0700_2000_0002_0001 = slot 0; 0700_2300_0002_0002 = slot 3", () => {
  assert.equal(parseRunoutHms(0x07002000, 0x00020001), 0);
  assert.equal(parseRunoutHms(0x07002100, 0x00020001), 1);
  assert.equal(parseRunoutHms(0x07002300, 0x00020002), 3);
});

test("parseRunoutHms: outros alertas não são carretel acabado", () => {
  assert.equal(parseRunoutHms(0x07002000, 0x00020004), null); // filamento partido no cabeçote
  assert.equal(parseRunoutHms(0x03002000, 0x00020001), null); // não é AMS
  assert.equal(parseRunoutHms(0x07002000, 0x00010001), null); // outra família
  assert.equal(parseRunoutHms(0x07012000, 0x00020001), null); // segunda unidade AMS (sem suporte)
  assert.equal(parseRunoutHms(0x07008000, 0x00020001), null);
});

test("trayOccupancy: lê tray_exist_bits em hex; sem o campo devolve undefined", () => {
  assert.deepEqual(trayOccupancy({ ams: { tray_exist_bits: "f" } }), [true, true, true, true]);
  assert.deepEqual(trayOccupancy({ ams: { tray_exist_bits: "e" } }), [false, true, true, true]);
  assert.deepEqual(trayOccupancy({ ams: { tray_exist_bits: 6 } }), [false, true, true, false]);
  assert.equal(trayOccupancy({ ams: { tray_now: "0" } }), undefined);
  assert.equal(trayOccupancy({}), undefined);
});

test("observeRunout: registra trocas de slot (só mudanças) com o percentual", () => {
  const events = emptyAmsEvents();
  const base = { events, usedSlots: [0, 3], hmsAppeared: [] };
  observeRunout({ ...base, previousActiveSlot: null, activeSlot: 0, percent: 0, now: min(0) });
  observeRunout({ ...base, previousActiveSlot: 0, activeSlot: 0, percent: 10, now: min(5) });
  const news = observeRunout({ ...base, previousActiveSlot: 0, activeSlot: 3, percent: 92, now: min(120) });
  assert.deepEqual(events.switches.map((s) => [s.from, s.to, s.percent]), [[null, 0, 0], [0, 3, 92]]);
  assert.deepEqual(news, [{ kind: "switch", from: 0, to: 3, percent: 92 }]);
});

test("observeRunout: alerta HMS de filamento acabado vira runout (uma vez por slot)", () => {
  const events = emptyAmsEvents();
  const hms = [{ attr: 0x07002000, code: 0x00020001, formatted: "0700_2000_0002_0001" }];
  const a = observeRunout({ events, previousActiveSlot: 0, activeSlot: 0, usedSlots: [0], percent: 91, hmsAppeared: hms, now: min(119) });
  const b = observeRunout({ events, previousActiveSlot: 0, activeSlot: 0, usedSlots: [0], percent: 91, hmsAppeared: hms, now: min(119) });
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
  assert.deepEqual(events.runouts, [{ slot: 0, percent: 91, at: new Date(min(119)).toISOString(), sources: ["hms"], hms: "0700_2000_0002_0001" }]);
});

test("observeRunout: slot que alimentava a impressão ficou vazio = carretel acabou", () => {
  const events = emptyAmsEvents();
  const news = observeRunout({
    events,
    previousActiveSlot: 0,
    activeSlot: 3,
    usedSlots: [0, 3],
    percent: 92,
    previousOccupancy: [true, true, true, true],
    occupancy: [false, true, true, true],
    hmsAppeared: [],
    now: min(120),
  });
  assert.deepEqual(events.runouts.map((r) => [r.slot, r.sources]), [[0, ["tray_empty"]]]);
  assert.ok(news.some((n) => n.kind === "runout" && n.slot === 0));
});

test("observeRunout: tirar um carretel que NÃO estava alimentando não é carretel acabado", () => {
  const events = emptyAmsEvents();
  observeRunout({
    events,
    previousActiveSlot: 2,
    activeSlot: 2,
    usedSlots: [0, 2],
    percent: 60,
    previousOccupancy: [true, true, true, true],
    occupancy: [false, false, true, true],
    hmsAppeared: [],
    now: min(60),
  });
  assert.equal(events.runouts.length, 0);
});

test("observeRunout: HMS + slot vazio do mesmo slot somam as fontes num único runout", () => {
  const events = emptyAmsEvents();
  observeRunout({ events, previousActiveSlot: 0, activeSlot: 0, usedSlots: [0], percent: 91, hmsAppeared: [{ attr: 0x07002000, code: 0x00020002, formatted: "0700_2000_0002_0002" }], now: min(119) });
  observeRunout({ events, previousActiveSlot: 0, activeSlot: 3, usedSlots: [0, 3], percent: 92, previousOccupancy: [true, true, true, true], occupancy: [false, true, true, true], hmsAppeared: [], now: min(120) });
  assert.equal(events.runouts.length, 1);
  assert.deepEqual(events.runouts[0].sources, ["hms", "tray_empty"]);
  assert.equal(events.runouts[0].percent, 91);
});

test("findBackupSlot: troca de cor planejada pelo fatiador não é reserva", () => {
  const runout = { slot: 0, percent: 50, at: new Date(min(60)).toISOString(), sources: ["hms" as const] };
  const switches = [
    { from: 0, to: 2, percent: 50, at: new Date(min(60)).toISOString() }, // cor branca planejada
    { from: 2, to: 0, percent: 51, at: new Date(min(61)).toISOString() },
  ];
  assert.equal(findBackupSlot(runout, switches, (s) => s === 0 || s === 2), null);
  assert.equal(findBackupSlot(runout, [{ from: 0, to: 3, percent: 50, at: new Date(min(61)).toISOString() }], (s) => s === 0 || s === 2), 3);
});

test("findBackupSlot: troca muito longe do momento em que acabou não conta", () => {
  const runout = { slot: 0, percent: 50, at: new Date(min(60)).toISOString(), sources: ["hms" as const] };
  assert.equal(findBackupSlot(runout, [{ from: 0, to: 3, percent: 80, at: new Date(min(100)).toISOString() }], () => false), null);
});

// Caso real de 08/10 (CANECA_CORINTHIANSL_V1_plate_2): 49,92 g de preto no slot 0,
// carretel acaba aos 90% e a AMS segue no slot 3 (reserva do mesmo filamento).
test("caso 08/10: carretel acaba aos 90% -> 90% para o que acabou (esgotado), 10% para o reserva", () => {
  const perSlot = new Map<number, SlotConsumption>([[0, { grams: 49.92, quality: "exact", weightDiscount: 0 }]]);
  const events = emptyAmsEvents();
  observeRunout({ events, previousActiveSlot: null, activeSlot: 0, usedSlots: [0], percent: 1, hmsAppeared: [], now: min(0) });
  observeRunout({ events, previousActiveSlot: 0, activeSlot: 0, usedSlots: [0], percent: 90, hmsAppeared: [{ attr: 0x07002000, code: 0x00020001, formatted: "0700_2000_0002_0001" }], now: min(118) });
  observeRunout({ events, previousActiveSlot: 0, activeSlot: 3, usedSlots: [0, 3], percent: 90, hmsAppeared: [], now: min(119) });

  const splits = applyRunoutSplit(perSlot, events, 100);
  assert.deepEqual(splits, [{ slot: 0, backupSlot: 3, fraction: 0.9 }]);

  const items = buildJobConsumptionItems(perSlot, new Map([[0, "antigo"], [3, "novo"]]), 100);
  const bySlot = new Map(items.map((i) => [i.slot_index, i]));
  assert.equal(bySlot.get(0)!.grams, 44.9);
  assert.equal(bySlot.get(0)!.depleted, true);
  assert.equal(bySlot.get(3)!.grams, 5);
  assert.equal(bySlot.get(3)!.spool_id, "novo");
  assert.equal(bySlot.get(3)!.depleted, undefined);
});

test("job interrompido aos 60% com carretel acabado aos 30%: metade para cada", () => {
  const perSlot = new Map<number, SlotConsumption>([[0, { grams: 100, quality: "exact", weightDiscount: 0 }]]);
  const events = emptyAmsEvents();
  events.switches.push({ from: null, to: 0, percent: 0, at: new Date(min(0)).toISOString() });
  events.switches.push({ from: 0, to: 1, percent: 30, at: new Date(min(31)).toISOString() });
  events.runouts.push({ slot: 0, percent: 30, at: new Date(min(30)).toISOString(), sources: ["tray_empty"] });
  applyRunoutSplit(perSlot, events, 60);
  const items = buildJobConsumptionItems(perSlot, new Map([[0, "a"], [1, "b"]]), 60);
  assert.deepEqual(items.map((i) => [i.slot_index, i.grams, Boolean(i.depleted)]), [[0, 30, true], [1, 30, false]]);
});

test("sem slot reserva: o slot que acabou fica com tudo e é marcado esgotado", () => {
  const perSlot = new Map<number, SlotConsumption>([[0, { grams: 49.92, quality: "exact", weightDiscount: 0 }]]);
  const events = emptyAmsEvents();
  events.runouts.push({ slot: 0, percent: 90, at: new Date(min(118)).toISOString(), sources: ["hms"] });
  assert.deepEqual(applyRunoutSplit(perSlot, events, 100), [{ slot: 0, backupSlot: null, fraction: 1 }]);
  const [item] = buildJobConsumptionItems(perSlot, new Map([[0, "antigo"]]), 100);
  assert.equal(item.grams, 49.9);
  assert.equal(item.depleted, true);
});

test("slot reserva já listado como usado sem consumo do fatiador recebe a parte do reserva", () => {
  const perSlot = new Map<number, SlotConsumption>([
    [0, { grams: 40, quality: "exact", weightDiscount: 0 }],
    [3, { grams: 0, quality: "unknown", weightDiscount: 0 }],
  ]);
  const events = emptyAmsEvents();
  events.switches.push({ from: 0, to: 3, percent: 75, at: new Date(min(90)).toISOString() });
  events.runouts.push({ slot: 0, percent: 75, at: new Date(min(90)).toISOString(), sources: ["hms"] });
  applyRunoutSplit(perSlot, events, 100);
  assert.deepEqual(perSlot.get(3), { grams: 10, quality: "exact", weightDiscount: 0 });
  assert.equal(perSlot.get(0)!.grams, 30);
});

test("sem carretel identificado no slot que acabou: nada é marcado esgotado (sem spool não há o que arquivar)", () => {
  const perSlot = new Map<number, SlotConsumption>([[0, { grams: 10, quality: "exact", weightDiscount: 0, depleted: true }]]);
  const [item] = buildJobConsumptionItems(perSlot, new Map(), 100);
  assert.equal(item.orphan_slot, true);
  assert.equal(item.depleted, undefined);
});

test("job sem eventos de AMS: nada muda (regressão)", () => {
  const perSlot = new Map<number, SlotConsumption>([[0, { grams: 12, quality: "exact", weightDiscount: 0 }]]);
  assert.deepEqual(applyRunoutSplit(perSlot, undefined, 100), []);
  assert.deepEqual(applyRunoutSplit(perSlot, emptyAmsEvents(), 100), []);
  assert.deepEqual(perSlot.get(0), { grams: 12, quality: "exact", weightDiscount: 0 });
});
