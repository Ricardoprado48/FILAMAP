import type { Spool } from "../types";

export interface BudgetInputs {
  calcPrintHours: string;
  printerPowerW: string;
  energyTariff: string;
  printerCost: string;
  printerLifespanH: string;
  markupMultiplier: string;
  calcExtraCosts: string;
  calcFilaments: Array<{ spoolId: string; weightG: string; manualPricePerKg: string }>;
  inventory: Spool[];
}

export interface BudgetSummary {
  hours: number;
  machineCostTotal: number;
  totalFilamentWeight: number;
  totalFilamentCost: number;
  totalProductionCost: number;
  suggestedSalePrice: number;
  netEarnings: number;
  extrasCost: number;
}

export function computeBudgetSummary(inputs: BudgetInputs): BudgetSummary {
  const hours = parseFloat(inputs.calcPrintHours) || 0;
  const powerKw = (parseFloat(inputs.printerPowerW) || 150) / 1000;
  const tariffKwh = parseFloat(inputs.energyTariff) || 1.13;
  const machineCostVal = parseFloat(inputs.printerCost) || 4500;
  const lifespanHours = parseFloat(inputs.printerLifespanH) || 10000;
  const markup = parseFloat(inputs.markupMultiplier) || 3.0;
  const extrasCost = parseFloat(inputs.calcExtraCosts) || 0;

  const energyPerHour = powerKw * tariffKwh;
  const depreciationPerHour = lifespanHours > 0 ? (machineCostVal / lifespanHours) : 0;
  const machineCostTotal = (energyPerHour + depreciationPerHour) * hours;

  let totalFilamentWeight = 0;
  let totalFilamentCost = 0;

  inputs.calcFilaments.forEach((f) => {
    const w = parseFloat(f.weightG) || 0;
    if (w > 0) {
      totalFilamentWeight += w;
      let priceKg = parseFloat(f.manualPricePerKg) || 85.00;
      if (f.spoolId) {
        const found = inputs.inventory.find((s) => s.id === f.spoolId);
        if (found && found.price_paid) priceKg = found.price_paid;
      }
      totalFilamentCost += (w / 1000) * priceKg;
    }
  });

  const totalProductionCost = totalFilamentCost + machineCostTotal + extrasCost;
  const suggestedSalePrice = totalProductionCost * markup;
  const netEarnings = suggestedSalePrice - totalProductionCost;

  return {
    hours,
    machineCostTotal,
    totalFilamentWeight,
    totalFilamentCost,
    totalProductionCost,
    suggestedSalePrice,
    netEarnings,
    extrasCost,
  };
}
