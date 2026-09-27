import { describe, it, expect } from "vitest";
import type { PrintLog, Spool } from "../types";
import { groupPrintLogsByJob, formatGramsDisplay } from "./history";

function createMockSpool(overrides: Partial<Spool> = {}): Spool {
  return {
    id: "spool-1",
    nfc_uid: "04A1B2C3",
    brand: "Voolt3D",
    material: "PLA",
    color_name: "Preto Velvet",
    color_hex: "#000000",
    current_weight: 739.3,
    ...overrides,
  };
}

function createMockLog(overrides: Partial<PrintLog> = {}): PrintLog {
  return {
    id: "log-1",
    subtask_name: "0.2mm layer, 2 walls, 8% infill",
    filament_used_g: 2.9,
    print_duration_minutes: 42,
    slot_index: 0,
    completed_at: "2026-09-27T20:28:54.372Z",
    status: "COMPLETED",
    job_id: "561f9425-9934-4421-af65-e184de4de442",
    spool: createMockSpool(),
    ...overrides,
  };
}

describe("Histórico Multicolor - Agrupamento e Apresentação (Fixtures U - Z)", () => {
  it("Fixture U: três logs com o mesmo job_id -> exatamente 1 job com 3 linhas (breakdown)", () => {
    const logs: PrintLog[] = [
      createMockLog({
        id: "log-1",
        job_id: "job-multi-1",
        filament_used_g: 2.9,
        slot_index: 0,
        spool: createMockSpool({ id: "s1", color_name: "Preto Velvet", color_hex: "#000000" }),
      }),
      createMockLog({
        id: "log-2",
        job_id: "job-multi-1",
        filament_used_g: 1.8,
        slot_index: 2,
        spool: createMockSpool({ id: "s2", color_name: "Vermelho Ultra Silk", color_hex: "#ef4444" }),
      }),
      createMockLog({
        id: "log-3",
        job_id: "job-multi-1",
        filament_used_g: 0.7,
        slot_index: 3,
        spool: createMockSpool({ id: "s3", color_name: "Branco PETG", color_hex: "#ffffff" }),
      }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped.length).toBe(1);
    expect(grouped[0].job_id).toBe("job-multi-1");
    expect(grouped[0].items.length).toBe(3);
    expect(grouped[0].items[0].color_name).toBe("Preto Velvet");
    expect(grouped[0].items[1].color_name).toBe("Vermelho Ultra Silk");
    expect(grouped[0].items[2].color_name).toBe("Branco PETG");
  });

  it("Fixture V: dois jobs com o mesmo subtask_name mas job_id diferentes -> permanecem separados", () => {
    const logs: PrintLog[] = [
      createMockLog({
        id: "log-1",
        subtask_name: "Cubo de Calibração",
        job_id: "job-primeiro-111",
        completed_at: "2026-09-27T10:00:00.000Z",
      }),
      createMockLog({
        id: "log-2",
        subtask_name: "Cubo de Calibração",
        job_id: "job-segundo-222",
        completed_at: "2026-09-27T11:00:00.000Z",
      }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped.length).toBe(2);
    expect(grouped[0].job_id).toBe("job-segundo-222");
    expect(grouped[1].job_id).toBe("job-primeiro-111");
  });

  it("Fixture W: logs antigos sem job_id -> não são falsamente agrupados, permanecem individuais", () => {
    const logs: PrintLog[] = [
      createMockLog({
        id: "log-antigo-1",
        subtask_name: "Peça Legada",
        job_id: null,
        filament_used_g: 15.0,
      }),
      createMockLog({
        id: "log-antigo-2",
        subtask_name: "Peça Legada",
        job_id: undefined,
        filament_used_g: 20.0,
      }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped.length).toBe(2);
    expect(grouped[0].job_id).toBeNull();
    expect(grouped[1].job_id).toBeNull();
    expect(grouped[0].key).toBe("log-log-antigo-1");
    expect(grouped[1].key).toBe("log-log-antigo-2");
    expect(grouped[0].isGrouped).toBe(false);
  });

  it("Fixture X: orphan real -> permanece visível e explicitamente sinalizado", () => {
    const logs: PrintLog[] = [
      createMockLog({
        id: "log-orphan",
        job_id: "job-orphan-1",
        spool: undefined,
        orphan_slot: true,
        filament_used_g: 5.5,
      }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped.length).toBe(1);
    expect(grouped[0].items[0].orphan_slot).toBe(true);
    expect(grouped[0].items[0].spool_name).toBe("Carretel não identificado");
  });

  it("Fixture Y: total do job soma os consumos corretamente com precisão 1 decimal", () => {
    const logs: PrintLog[] = [
      createMockLog({ id: "l1", job_id: "j1", filament_used_g: 2.9 }),
      createMockLog({ id: "l2", job_id: "j1", filament_used_g: 1.8 }),
      createMockLog({ id: "l3", job_id: "j1", filament_used_g: 0.7 }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped[0].total_used_g).toBe(5.4);
    expect(formatGramsDisplay(grouped[0].total_used_g)).toBe("5.4g");
  });

  it("Fixture Z: ordenação estritamente cronológica decrescente", () => {
    const logs: PrintLog[] = [
      createMockLog({
        id: "l1",
        job_id: "job-antigo",
        completed_at: "2026-09-27T10:00:00.000Z",
      }),
      createMockLog({
        id: "l2",
        job_id: "job-novo",
        completed_at: "2026-09-27T20:00:00.000Z",
      }),
      createMockLog({
        id: "l3",
        job_id: "job-intermediario",
        completed_at: "2026-09-27T15:00:00.000Z",
      }),
    ];

    const grouped = groupPrintLogsByJob(logs);
    expect(grouped.length).toBe(3);
    expect(grouped[0].job_id).toBe("job-novo");
    expect(grouped[1].job_id).toBe("job-intermediario");
    expect(grouped[2].job_id).toBe("job-antigo");
  });
});
