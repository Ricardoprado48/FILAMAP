import type { PrintLog } from "../types";
import { getSpoolDisplayName, getSpoolSwatchColor } from "./inventory";

export interface GroupedJobSpoolItem {
  id: string;
  spool_id?: string;
  spool_name: string;
  // Nome do produto no momento da impressão (snapshot); null em registros antigos.
  product_name: string | null;
  material: string;
  color_hex: string;
  color_name: string;
  used_g: number;
  orphan_slot: boolean;
  needs_weighing?: boolean;
}

export interface GroupedJob {
  key: string;
  job_id: string | null;
  subtask_name: string;
  status: string;
  completed_at: string;
  total_used_g: number;
  items: GroupedJobSpoolItem[];
  isGrouped: boolean;
}

export function formatGramsDisplay(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  return `${rounded.toFixed(1)}g`;
}

export function groupPrintLogsByJob(logs: PrintLog[]): GroupedJob[] {
  if (!logs || logs.length === 0) return [];

  const jobMap = new Map<string, GroupedJob>();
  const result: GroupedJob[] = [];

  for (const log of logs) {
    const usedG = typeof log.filament_used_g === "number" ? log.filament_used_g : 0;
    const isOrphan = Boolean(log.orphan_slot || (!log.spool && !log.product_name_snapshot));
    // A "foto" gravada na impressão vale mais que o carretel de hoje: editar ou
    // arquivar o carretel/produto depois não reescreve o histórico.
    const productName = log.product_name_snapshot?.trim() || null;
    const spoolName = productName || (log.spool ? getSpoolDisplayName(log.spool) : "Carretel não identificado");
    const material = log.material_snapshot || log.spool?.material || (isOrphan ? "N/A" : "");
    const colorHex = log.spool ? getSpoolSwatchColor(log.spool) : "#64748b";
    const colorName = log.color_snapshot || log.spool?.color_name || (isOrphan ? "Sem carretel" : "");

    const spoolItem: GroupedJobSpoolItem = {
      id: log.id,
      spool_id: log.spool_id,
      spool_name: spoolName,
      product_name: productName,
      material,
      color_hex: colorHex,
      color_name: colorName,
      used_g: usedG,
      orphan_slot: isOrphan,
      needs_weighing: log.needs_weighing,
    };

    if (log.job_id && log.job_id.trim() !== "") {
      const existing = jobMap.get(log.job_id);
      if (existing) {
        existing.items.push(spoolItem);
        existing.total_used_g = Math.round((existing.total_used_g + usedG) * 10) / 10;
        if (new Date(log.completed_at).getTime() > new Date(existing.completed_at).getTime()) {
          existing.completed_at = log.completed_at;
        }
      } else {
        const newGrouped: GroupedJob = {
          key: log.job_id,
          job_id: log.job_id,
          subtask_name: log.subtask_name || "Trabalho de Impressão",
          status: log.status || "COMPLETED",
          completed_at: log.completed_at,
          total_used_g: Math.round(usedG * 10) / 10,
          items: [spoolItem],
          isGrouped: true,
        };
        jobMap.set(log.job_id, newGrouped);
        result.push(newGrouped);
      }
    } else {
      // Log individual (legado sem job_id)
      const singleItem: GroupedJob = {
        key: `log-${log.id}`,
        job_id: null,
        subtask_name: log.subtask_name || "Trabalho de Impressão",
        status: log.status || "COMPLETED",
        completed_at: log.completed_at,
        total_used_g: Math.round(usedG * 10) / 10,
        items: [spoolItem],
        isGrouped: false,
      };
      result.push(singleItem);
    }
  }

  // Ordena por completed_at descendente
  return result.sort((a, b) => {
    const tA = new Date(a.completed_at).getTime();
    const tB = new Date(b.completed_at).getTime();
    return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
  });
}
