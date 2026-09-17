import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { useNfc } from "./hooks/useNfc";

interface Printer {
  id: string;
  serial: string;
  model: string;
  ip_address: string;
  is_online: boolean;
  current_task?: string;
  print_progress?: number;
  remaining_time_min?: number;
  current_layer?: number;
  total_layers?: number;
  nozzle_temp?: number;
  nozzle_target_temp?: number;
  bed_temp?: number;
  bed_target_temp?: number;
  gcode_state?: string;
  active_slot_index?: number;
}

interface Spool {
  id: string;
  nfc_uid: string;
  brand: string;
  material: string;
  color_name: string;
  color_hex: string;
  current_weight: number;
  initial_weight?: number;
  spool_tare_weight?: number;
  price_paid?: number;
}

interface CatalogItem {
  id: string;
  name: string;
  material: string;
  weight_g: number;
  print_hours: number;
  accessories_cost: number;
  production_cost: number;
  sale_price: number;
  created_at: string;
}

interface PrintLog {
  id: string;
  subtask_name: string;
  filament_used_g?: number;
  print_duration_minutes: number;
  slot_index: number;
  completed_at: string;
  status: string;
  needs_weighing?: boolean;
  spool?: Spool;
}

const POPULAR_BRANDS = [
  "Voolt3D", "3D Fila", "Bambu Lab", "Creality", "Anycubic", "Elegoo",
  "Easy Print", "Esun", "Fusion", "GTMax3D", "MasterPrint", "Multifila",
  "PolyMaker", "PrintaLot", "Sulun", "Suntop", "TopRecicla", "Outra..."
];

const TARE_PRESETS = [
  { label: "Voolt Vazado (218g)", val: "218" },
  { label: "Voolt Fechado/Antigo (250g)", val: "250" },
  { label: "Voolt Transparente (195g)", val: "195" },
  { label: "MasterPrint (230g)", val: "230" },
  { label: "Padrão (220g)", val: "220" }
];

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"ams" | "inventory" | "calc" | "writer">("ams");
  const [calcSubTab, setCalcSubTab] = useState<"catalog" | "calculator">("catalog");
  const [catalogViewMode, setCatalogViewMode] = useState<"list" | "grid">("list");

  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activeSlots, setActiveSlots] = useState<Record<number, Spool | null>>({
    0: null, 1: null, 2: null, 3: null
  });

  const [printLogs, setPrintLogs] = useState<PrintLog[]>([]);
  const [inventory, setInventory] = useState<Spool[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("TODOS");

  // Modais de Spool e Pesagem Pendente
  const [weighingSpool, setWeighingSpool] = useState<Spool | null>(null);
  const [modalGross, setModalGross] = useState("");
  const [modalTare, setModalTare] = useState("218");

  const [resolvingJob, setResolvingJob] = useState<PrintLog | null>(null);
  const [resolvedGrams, setResolvedGrams] = useState("25");

  const [editingSpool, setEditingSpool] = useState<Spool | null>(null);
  const [editBrand, setEditBrand] = useState("");
  const [editMaterial, setEditMaterial] = useState("PETG");
  const [editColorName, setEditColorName] = useState("");
  const [editColorHex, setEditColorHex] = useState("#111827");
  const [editWeight, setEditWeight] = useState("");
  const [editPrice, setEditPrice] = useState("");

  // Criador de Tags
  const [selectedBrand, setSelectedBrand] = useState("Voolt3D");
  const [material, setMaterial] = useState("PETG");
  const [colorName, setColorName] = useState("Preto");
  const [colorHex, setColorHex] = useState("#111827");
  const [grossWeight, setGrossWeight] = useState("1218");
  const [tareWeight, setTareWeight] = useState("218");
  const [spoolPrice, setSpoolPrice] = useState("85.00");
  const [customTagId, setCustomTagId] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Custos Fixos & Calculadora
  const [energyTariff, setEnergyTariff] = useState(() => localStorage.getItem("filamap_energy_tariff") || "1.13");
  const [printerPowerW, setPrinterPowerW] = useState(() => localStorage.getItem("filamap_power_w") || "150");
  const [printerCost, setPrinterCost] = useState(() => localStorage.getItem("filamap_printer_cost") || "4500");
  const [printerLifespanH, setPrinterLifespanH] = useState(() => localStorage.getItem("filamap_lifespan_h") || "10000");
  const [markupMultiplier, setMarkupMultiplier] = useState(() => localStorage.getItem("filamap_markup") || "3.0");

  const [calcPartName, setCalcPartName] = useState("Nova Peça 3D");
  const [calcPrintHours, setCalcPrintHours] = useState("1.5");
  const [calcExtraCosts, setCalcExtraCosts] = useState("0.50");
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  const [calcFilaments, setCalcFilaments] = useState<Array<{ spoolId: string; weightG: string; manualPricePerKg: string }>>([
    { spoolId: "", weightG: "25", manualPricePerKg: "85.00" },
    { spoolId: "", weightG: "", manualPricePerKg: "85.00" },
    { spoolId: "", weightG: "", manualPricePerKg: "85.00" },
    { spoolId: "", weightG: "", manualPricePerKg: "85.00" },
  ]);

  function generateAutoTagId(mat: string, col: string) {
    const cleanCol = col.trim().toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-");
    const rnd = Math.floor(1000 + Math.random() * 9000);
    return `FILA-${mat.toUpperCase()}-${cleanCol || "COR"}-${rnd}`;
  }

  useEffect(() => {
    setCustomTagId(generateAutoTagId("PETG", "PRETO"));
  }, []);

  useEffect(() => {
    localStorage.setItem("filamap_energy_tariff", energyTariff);
    localStorage.setItem("filamap_power_w", printerPowerW);
    localStorage.setItem("filamap_printer_cost", printerCost);
    localStorage.setItem("filamap_lifespan_h", printerLifespanH);
    localStorage.setItem("filamap_markup", markupMultiplier);
  }, [energyTariff, printerPowerW, printerCost, printerLifespanH, markupMultiplier]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  const { isWriting, nfcUid, error: nfcError, writeTagUrl, setNfcUid } = useNfc();

  async function loadData() {
    if (!session) return;

    const { data: pData } = await supabase.from("printers").select("*");
    if (pData && pData.length > 0) {
      setPrinters(pData);
      const printerId = pData[0].id;
      const { data: slotData } = await supabase.from("ams_slots").select("slot_index, spool:spools(*)").eq("printer_id", printerId);
      if (slotData) {
        const slotsMap: Record<number, Spool | null> = { 0: null, 1: null, 2: null, 3: null };
        slotData.forEach((s: any) => { slotsMap[s.slot_index] = s.spool; });
        setActiveSlots(slotsMap);
      }
    }

    const { data: invData } = await supabase.from("spools").select("*").order("color_name", { ascending: true });
    if (invData) setInventory(invData);

    const { data: catData } = await supabase.from("catalog_items").select("*");
    if (catData) setCatalog(catData);

    const { data: logsData } = await supabase.from("print_logs").select("*, spool:spools(*)").order("completed_at", { ascending: false }).limit(10);
    if (logsData) setPrintLogs(logsData);
  }

  useEffect(() => {
    if (session) {
      loadData();
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
    }
  }, [session]);

  // Resolver pesagem pendente de um job
  async function handleResolveWeighing(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvingJob) return;

    const usedGrams = parseFloat(resolvedGrams) || 0;

    // Se houver spool vinculado, abate o valor real do carretel
    if (resolvingJob.spool_id && resolvingJob.spool) {
      const prevWeight = resolvingJob.spool.current_weight || 0;
      const newWeight = Math.max(0, Math.round((prevWeight - usedGrams) * 10) / 10);
      await supabase.from("spools").update({ current_weight: newWeight }).eq("id", resolvingJob.spool_id);
    }

    // Atualiza o job removendo o status de pendente e gravando o consumo real
    await supabase.from("print_logs").update({
      filament_used_g: usedGrams,
      needs_weighing: false
    }).eq("id", resolvingJob.id);

    setResolvingJob(null);
    await loadData();
  }

  // Cálculos de Orçamento
  const hours = parseFloat(calcPrintHours) || 0;
  const powerKw = (parseFloat(printerPowerW) || 150) / 1000;
  const tariffKwh = parseFloat(energyTariff) || 1.13;
  const machineCostVal = parseFloat(printerCost) || 4500;
  const lifespanHours = parseFloat(printerLifespanH) || 10000;
  const markup = parseFloat(markupMultiplier) || 3.0;
  const extrasCost = parseFloat(calcExtraCosts) || 0;

  const energyPerHour = powerKw * tariffKwh;
  const depreciationPerHour = lifespanHours > 0 ? (machineCostVal / lifespanHours) : 0;
  const machineCostTotal = (energyPerHour + depreciationPerHour) * hours;

  let totalFilamentWeight = 0;
  let totalFilamentCost = 0;

  calcFilaments.forEach((f) => {
    const w = parseFloat(f.weightG) || 0;
    if (w > 0) {
      totalFilamentWeight += w;
      let priceKg = parseFloat(f.manualPricePerKg) || 85.00;
      if (f.spoolId) {
        const found = inventory.find((s) => s.id === f.spoolId);
        if (found && found.price_paid) priceKg = found.price_paid;
      }
      totalFilamentCost += (w / 1000) * priceKg;
    }
  });

  const totalProductionCost = totalFilamentCost + machineCostTotal + extrasCost;
  const suggestedSalePrice = totalProductionCost * markup;
  const netEarnings = suggestedSalePrice - totalProductionCost;

  async function handleSaveToCatalog() {
    if (!calcPartName.trim()) {
      alert("Por favor, digite o nome da peça!");
      return;
    }

    const { error } = await supabase.from("catalog_items").insert({
      name: calcPartName.trim().toUpperCase(),
      material: "PETG/PLA",
      weight_g: totalFilamentWeight,
      print_hours: hours,
      accessories_cost: extrasCost,
      production_cost: parseFloat(totalProductionCost.toFixed(2)),
      sale_price: parseFloat(suggestedSalePrice.toFixed(2)),
    });

    if (error) {
      alert("Erro ao salvar: " + error.message);
    } else {
      alert(`✅ Peça "${calcPartName.toUpperCase()}" adicionada ao Catálogo!`);
      await loadData();
      setCalcSubTab("catalog");
    }
  }

  function handleLoadCatalogItem(item: CatalogItem) {
    setCalcPartName(item.name);
    setCalcPrintHours(item.print_hours.toString());
    setCalcExtraCosts(item.accessories_cost.toString());
    const updated = [...calcFilaments];
    updated[0].weightG = item.weight_g.toString();
    setCalcFilaments(updated);
    setCalcSubTab("calculator");
  }

  async function handleDeleteCatalogItem(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    if (!window.confirm(`Excluir "${name}" do catálogo?`)) return;
    await supabase.from("catalog_items").delete().eq("id", id);
    await loadData();
  }

  async function handleAssignSlot(slotIdx: number) {
    if (!nfcUid || printers.length === 0) return;
    let { data: spool } = await supabase.from("spools").select("*").eq("nfc_uid", nfcUid).single();
    if (!spool) {
      const { data: created } = await supabase.from("spools").insert({
        nfc_uid: nfcUid, brand: "Voolt3D", material: "PETG", color_name: "Preto",
        color_hex: "#111827", initial_weight: 1000, current_weight: 1000,
        spool_tare_weight: 218, price_paid: 85.00,
      }).select().single();
      spool = created;
    }
    if (spool) {
      await supabase.from("ams_slots").upsert({
        printer_id: printers[0].id, slot_index: slotIdx, spool_id: spool.id, updated_at: new Date().toISOString(),
      }, { onConflict: "printer_id,slot_index" });
      setNfcUid(null);
      await loadData();
    }
  }

  async function handleEjectSlot(e: React.MouseEvent, slotIdx: number) {
    e.stopPropagation();
    if (printers.length === 0) return;
    await supabase.from("ams_slots").update({ spool_id: null, updated_at: new Date().toISOString() }).eq("printer_id", printers[0].id).eq("slot_index", slotIdx);
    await loadData();
  }

  function openWeighModal(spool: Spool) {
    setWeighingSpool(spool);
    const savedTare = (spool.spool_tare_weight || 218).toString();
    setModalTare(savedTare);
    setModalGross((spool.current_weight + parseFloat(savedTare)).toString());
  }

  async function handleSaveWeigh(e: React.FormEvent) {
    e.preventDefault();
    if (!weighingSpool) return;
    const net = Math.max(0, (parseFloat(modalGross) || 0) - (parseFloat(modalTare) || 0));
    await supabase.from("spools").update({ current_weight: net, spool_tare_weight: parseFloat(modalTare) || 218 }).eq("id", weighingSpool.id);
    setWeighingSpool(null);
    await loadData();
  }

  function openEditModal(spool: Spool) {
    setEditingSpool(spool);
    setEditBrand(spool.brand);
    setEditMaterial(spool.material);
    setEditColorName(spool.color_name);
    setEditColorHex(spool.color_hex);
    setEditWeight(spool.current_weight.toString());
    setEditPrice((spool.price_paid || 85).toString());
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSpool) return;
    await supabase.from("spools").update({
      brand: editBrand, material: editMaterial, color_name: editColorName,
      color_hex: editColorHex, current_weight: parseFloat(editWeight) || 0,
      price_paid: parseFloat(editPrice) || 85.00,
    }).eq("id", editingSpool.id);
    setEditingSpool(null);
    await loadData();
  }

  async function handleDeleteSpool(spool: Spool) {
    if (!window.confirm(`Excluir carretel "${spool.color_name}"?`)) return;
    await supabase.from("ams_slots").update({ spool_id: null }).eq("spool_id", spool.id);
    await supabase.from("spools").delete().eq("id", spool.id);
    await loadData();
  }

  async function handleCreateAndWriteTag(e: React.FormEvent) {
    e.preventDefault();
    const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));
    const finalTagId = customTagId.trim() || `FILA-${material}-${Date.now().toString().slice(-4)}`;
    const fullTargetUrl = `https://filamap.pages.dev/?tag=${encodeURIComponent(finalTagId)}`;
    await writeTagUrl(fullTargetUrl);

    await supabase.from("spools").upsert({
      nfc_uid: finalTagId, brand: selectedBrand, material, color_name: colorName,
      color_hex: colorHex, initial_weight: netWeight, current_weight: netWeight,
      spool_tare_weight: parseFloat(tareWeight) || 218, price_paid: parseFloat(spoolPrice) || 85.00,
    }, { onConflict: "nfc_uid" });

    setFeedbackMsg(`✅ Carretel salvo! Link: ${fullTargetUrl}`);
    await loadData();
  }

  const filteredInventory = inventory.filter((item) => {
    const matchesSearch = item.color_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.brand.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMat = filterMaterial === "TODOS" || item.material === filterMaterial;
    return matchesSearch && matchesMat;
  });

  const filteredCatalog = catalog
    .filter((item) =>
      item.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      item.material.toLowerCase().includes(catalogSearch.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  const groupedByMaterial = filteredInventory.reduce((acc, spool) => {
    const mat = (spool.material || "OUTROS").toUpperCase();
    if (!acc[mat]) acc[mat] = [];
    acc[mat].push(spool);
    return acc;
  }, {} as Record<string, Spool[]>);

  const pendingWeighingLogs = printLogs.filter((l) => l.needs_weighing);

  const activePrinter = printers[0];
  const isPrinting = activePrinter?.gcode_state === "RUNNING" || activePrinter?.gcode_state === "PAUSE";

  if (!session) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0f172a" }}>
        <div style={{ maxWidth: 380, width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, boxSizing: "border-box" }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <span style={{ fontSize: 36 }}>🧵</span>
            <h1 style={{ margin: "8px 0 0", fontSize: 24, color: "#38bdf8", fontWeight: 900 }}>FILAMAP</h1>
            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>Acesso à Oficina & Estoque NFC</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>E-mail</label>
              <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="seu@email.com" required style={{ width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Senha</label>
              <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" required style={{ width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
            </div>
            {authError && <div style={{ color: "#f87171", fontSize: 12, background: "rgba(239, 68, 68, 0.1)", padding: 8, borderRadius: 6, border: "1px solid #dc2626" }}>{authError}</div>}
            <button type="submit" disabled={authLoading} style={{ padding: 12, background: authLoading ? "#0369a1" : "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
              {authLoading ? "Entrando..." : "Entrar no Filamap"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px", minHeight: "100vh", boxSizing: "border-box" }}>
      {/* Topo */}
      <header style={{ borderBottom: "1px solid #334155", paddingBottom: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🧵</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: "#38bdf8", fontWeight: 900, letterSpacing: "-0.02em" }}>FILAMAP</h1>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 11 }}>Bambu Lab A1 & Estoque NFC</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700, background: activePrinter?.is_online ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)", color: activePrinter?.is_online ? "#34d399" : "#f87171", border: `1px solid ${activePrinter?.is_online ? "#059669" : "#dc2626"}` }}>
              {activePrinter?.is_online ? "ONLINE" : "OFFLINE"}
            </span>
            <button onClick={handleLogout} style={{ background: "#334155", color: "#cbd5e1", border: "none", padding: "5px 9px", borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Sair
            </button>
          </div>
        </div>

        {/* 4 BOTÕES DO CABEÇALHO */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          <button onClick={() => setActiveTab("ams")} style={{ padding: "10px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: activeTab === "ams" ? "#0284c7" : "#1e293b", color: activeTab === "ams" ? "#fff" : "#94a3b8" }}>
            🖨️ AMS {pendingWeighingLogs.length > 0 && `(${pendingWeighingLogs.length})`}
          </button>
          <button onClick={() => setActiveTab("inventory")} style={{ padding: "10px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: activeTab === "inventory" ? "#0284c7" : "#1e293b", color: activeTab === "inventory" ? "#fff" : "#94a3b8" }}>
            📦 Estoque ({inventory.length})
          </button>
          <button onClick={() => setActiveTab("calc")} style={{ padding: "10px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: activeTab === "calc" ? "#0284c7" : "#1e293b", color: activeTab === "calc" ? "#fff" : "#94a3b8" }}>
            🧮 Orçamento ({catalog.length})
          </button>
          <button onClick={() => setActiveTab("writer")} style={{ padding: "10px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: activeTab === "writer" ? "#0284c7" : "#1e293b", color: activeTab === "writer" ? "#fff" : "#94a3b8" }}>
            🏷️ Tags
          </button>
        </div>
      </header>

      {/* ABA 1: MONITOR AMS & PENDENTES DE PESAGEM */}
      {activeTab === "ams" && (
        <div>
          {/* ALERTA DE PENDENTES DE PESAGEM */}
          {pendingWeighingLogs.length > 0 && (
            <div style={{ background: "rgba(245, 158, 11, 0.15)", border: "1px solid #f59e0b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontSize: 14, color: "#fbbf24" }}>⚖️ Impressões Aguardando Confirmação de Peso ({pendingWeighingLogs.length})</strong>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Pese o carretel e confirme o consumo real</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingWeighingLogs.map((job) => (
                  <div key={job.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{job.subtask_name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        Status: <span style={{ color: "#f59e0b" }}>{job.status}</span> • Carretel: {job.spool ? `${job.spool.color_name} (${job.spool.material})` : "Não vinculado"}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setResolvingJob(job);
                        setResolvedGrams(job.filament_used_g ? job.filament_used_g.toString() : "25");
                      }}
                      style={{ background: "#f59e0b", color: "#0f172a", border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                    >
                      ⚖️ Pesar e Confirmar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: isPrinting ? "linear-gradient(145deg, #0f172a, #172554)" : "#1e293b", border: `1px solid ${isPrinting ? "#38bdf8" : "#334155"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 15, color: "#f8fafc" }}>{isPrinting ? "IMPRESSÃO AO VIVO" : "STATUS DA IMPRESSORA"}</strong>
              <span style={{ background: isPrinting ? "rgba(34, 197, 94, 0.2)" : "#334155", color: isPrinting ? "#4ade80" : "#94a3b8", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                {activePrinter?.gcode_state || "OCIOSA"}
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 12 }}>
              {activePrinter?.current_task || "Nenhum arquivo em impressão"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, color: "#cbd5e1" }}>
              <span>Progresso: <strong style={{ color: "#38bdf8" }}>{activePrinter?.print_progress || 0}%</strong></span>
              <span>Restante: <strong style={{ color: "#f8fafc" }}>{activePrinter?.remaining_time_min || 0} min</strong></span>
            </div>
            <div style={{ width: "100%", height: 10, background: "#0f172a", borderRadius: 5, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${activePrinter?.print_progress || 0}%`, height: "100%", background: "linear-gradient(90deg, #0284c7, #38bdf8)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, background: "#0f172a", padding: 10, borderRadius: 8 }}>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>CAMADA</span><div style={{ fontSize: 13, fontWeight: 700 }}>{activePrinter?.current_layer || 0} / {activePrinter?.total_layers || 0}</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>BICO</span><div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{activePrinter?.nozzle_temp || 0}°C</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>MESA</span><div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{activePrinter?.bed_temp || 0}°C</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>SLOT EM USO</span><div style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8" }}>Slot {(activePrinter?.active_slot_index || 0) + 1}</div></div>
            </div>
          </div>

          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155", marginBottom: 16 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Bandejas do AMS Lite</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {[0, 1, 2, 3].map((slotIdx) => {
                const spool = activeSlots[slotIdx];
                return (
                  <div key={slotIdx} onClick={() => nfcUid && handleAssignSlot(slotIdx)} style={{ background: "#0f172a", borderRadius: 8, padding: 12, border: "1px solid #334155", minHeight: 120 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>SLOT {slotIdx + 1}</span>
                      <span style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: spool ? spool.color_hex : "#334155", display: "inline-block" }} />
                    </div>
                    {spool ? (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc" }}>{spool.material}</div>
                        <div style={{ fontSize: 11, color: "#cbd5e1" }}>{spool.color_name}</div>
                        <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 800, marginTop: 4 }}>{spool.current_weight}g</div>
                        <button onClick={(e) => handleEjectSlot(e, slotIdx)} style={{ marginTop: 8, width: "100%", padding: 3, background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>⏏️ Ejetar</button>
                      </div>
                    ) : (
                      <div style={{ color: "#475569", fontSize: 12, marginTop: 16 }}>Vazio</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Histórico Recente */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "#f8fafc" }}>📋 Histórico de Impressões</h3>
            {printLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px", color: "#64748b", fontSize: 12 }}>Nenhuma impressão registrada.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {printLogs.map((log) => (
                  <div key={log.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{log.subtask_name}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {log.spool ? `${log.spool.material} • ${log.spool.color_name}` : "Sem carretel"} • Status: <span style={{ color: log.needs_weighing ? "#f59e0b" : "#34d399" }}>{log.status}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: log.needs_weighing ? "#f59e0b" : "#f87171" }}>
                        {log.needs_weighing ? "Pendente ⚖️" : `-${log.filament_used_g}g`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: ALMOXARIFADO (ESTOQUE) */}
      {activeTab === "inventory" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 17, color: "#f8fafc", margin: 0 }}>Estoque de Carretéis</h2>
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "2px 0 0" }}>Separado por material e em ordem alfabética</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar cor, marca..." style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 }} />
              <select value={filterMaterial} onChange={(e) => setFilterMaterial(e.target.value)} style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 }}>
                <option value="TODOS">Todos os Materiais</option>
                <option value="PLA">PLA</option>
                <option value="PETG">PETG</option>
                <option value="TPU">TPU</option>
                <option value="ABS">ABS</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.keys(groupedByMaterial).map((mat) => {
              const spools = groupedByMaterial[mat];
              const totalWeight = spools.reduce((acc, s) => acc + (s.current_weight || 0), 0);
              const totalValue = spools.reduce((acc, s) => acc + ((s.current_weight || 0) * ((s.price_paid || 85) / 1000)), 0);

              return (
                <div key={mat} style={{ background: "#0f172a", borderRadius: 10, border: "1px solid #334155", overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", background: "rgba(30, 41, 59, 0.7)", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between" }}>
                    <strong>{mat} ({spools.length})</strong>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      Total: <strong style={{ color: "#f8fafc" }}>{(totalWeight / 1000).toFixed(2)} kg</strong> • Valor: <strong style={{ color: "#34d399" }}>R$ {totalValue.toFixed(2)}</strong>
                    </div>
                  </div>
                  <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    {spools.map((spool) => (
                      <div key={spool.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: spool.color_hex, border: "2px solid #64748b" }} />
                          <div>
                            <strong style={{ fontSize: 13, color: "#f8fafc" }}>{spool.color_name}</strong>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{spool.brand} • Tag: {spool.nfc_uid}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <strong style={{ fontSize: 14, color: "#38bdf8" }}>{spool.current_weight}g</strong>
                          <button onClick={() => openWeighModal(spool)} style={{ background: "#334155", color: "#fff", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>⚖️</button>
                          <button onClick={() => openEditModal(spool)} style={{ background: "#0f172a", color: "#38bdf8", border: "1px solid #334155", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✏️</button>
                          <button onClick={() => handleDeleteSpool(spool)} style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ABA 3: ORÇAMENTO & CATÁLOGO */}
      {activeTab === "calc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, background: "#0f172a", padding: 6, borderRadius: 8, border: "1px solid #334155" }}>
            <button
              onClick={() => setCalcSubTab("catalog")}
              style={{
                flex: 1, padding: "8px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer",
                background: calcSubTab === "catalog" ? "#0284c7" : "transparent",
                color: calcSubTab === "catalog" ? "#fff" : "#94a3b8",
              }}
            >
              📚 Biblioteca de Peças ({catalog.length})
            </button>
            <button
              onClick={() => setCalcSubTab("calculator")}
              style={{
                flex: 1, padding: "8px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer",
                background: calcSubTab === "calculator" ? "#0284c7" : "transparent",
                color: calcSubTab === "calculator" ? "#fff" : "#94a3b8",
              }}
            >
              🧮 Novo Orçamento (Calculadora)
            </button>
          </div>

          {calcSubTab === "catalog" && (
            <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: 16, color: "#f8fafc", margin: 0 }}>Catálogo de Peças (A a Z)</h2>
                  <p style={{ color: "#94a3b8", fontSize: 11, margin: "2px 0 0" }}>Consulte preços instantaneamente</p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Pesquisar peça..."
                    style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 }}
                  />
                  <div style={{ display: "flex", background: "#0f172a", borderRadius: 6, border: "1px solid #334155", padding: 2 }}>
                    <button
                      type="button"
                      onClick={() => setCatalogViewMode("list")}
                      style={{ padding: "6px 10px", background: catalogViewMode === "list" ? "#0284c7" : "transparent", color: catalogViewMode === "list" ? "#fff" : "#94a3b8", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                    >
                      📋 Lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogViewMode("grid")}
                      style={{ padding: "6px 10px", background: catalogViewMode === "grid" ? "#0284c7" : "transparent", color: catalogViewMode === "grid" ? "#fff" : "#94a3b8", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                    >
                      🔲 Grade
                    </button>
                  </div>
                </div>
              </div>

              {filteredCatalog.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#64748b", fontSize: 13 }}>
                  Nenhuma peça encontrada no catálogo.
                </div>
              ) : catalogViewMode === "list" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredCatalog.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleLoadCatalogItem(item)}
                      style={{
                        background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px",
                        display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
                        gap: 12, flexWrap: "wrap"
                      }}
                    >
                      <div style={{ flex: "1 1 200px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          {item.material} • {item.weight_g}g • {item.print_hours}h
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 10, color: "#64748b", display: "block" }}>Custo</span>
                          <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>R$ {item.production_cost.toFixed(2)}</span>
                        </div>
                        <div style={{ textAlign: "right", minWidth: 95 }}>
                          <span style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700, display: "block" }}>Preço Venda</span>
                          <span style={{ fontSize: 16, color: "#38bdf8", fontWeight: 900 }}>R$ {item.sale_price.toFixed(2)}</span>
                        </div>
                        <button
                          onClick={(e) => handleDeleteCatalogItem(e, item.id, item.name)}
                          style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid #dc2626", color: "#f87171", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {filteredCatalog.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleLoadCatalogItem(item)}
                      style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 12, cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <strong style={{ fontSize: 13, color: "#f8fafc" }}>{item.name}</strong>
                          <button onClick={(e) => handleDeleteCatalogItem(e, item.id, item.name)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}>✕</button>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{item.material} • {item.weight_g}g • {item.print_hours}h</div>
                      </div>
                      <div style={{ marginTop: 12, borderTop: "1px solid #1e293b", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <div>
                          <span style={{ fontSize: 10, color: "#64748b", display: "block" }}>CUSTO</span>
                          <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>R$ {item.production_cost.toFixed(2)}</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 10, color: "#38bdf8", display: "block", fontWeight: 700 }}>PREÇO VENDA</span>
                          <span style={{ fontSize: 17, color: "#38bdf8", fontWeight: 900 }}>R$ {item.sale_price.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {calcSubTab === "calculator" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#1e293b", padding: 14, borderRadius: 12, border: "1px solid #334155" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 style={{ fontSize: 16, color: "#f8fafc", margin: 0 }}>Simulador de Orçamento</h2>
                    <p style={{ color: "#94a3b8", fontSize: 11, margin: "2px 0 0" }}>Bambu Lab A1 (Energia + Depreciação + Filamento)</p>
                  </div>
                  <button onClick={() => setShowConfigPanel(!showConfigPanel)} style={{ background: showConfigPanel ? "#0284c7" : "#0f172a", color: "#38bdf8", border: "1px solid #38bdf8", padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    ⚙️ {showConfigPanel ? "Fechar Custos" : "Custos da Oficina"}
                  </button>
                </div>

                {showConfigPanel && (
                  <div style={{ marginTop: 12, padding: 10, background: "#0f172a", borderRadius: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, color: "#94a3b8" }}>Luz (R$/kWh)</label>
                      <input type="number" step="0.01" value={energyTariff} onChange={(e) => setEnergyTariff(e.target.value)} style={{ width: "100%", padding: 4, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, color: "#fff" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#94a3b8" }}>Potência A1 (W)</label>
                      <input type="number" value={printerPowerW} onChange={(e) => setPrinterPowerW(e.target.value)} style={{ width: "100%", padding: 4, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, color: "#fff" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#94a3b8" }}>Valor A1 (R$)</label>
                      <input type="number" value={printerCost} onChange={(e) => setPrinterCost(e.target.value)} style={{ width: "100%", padding: 4, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, color: "#fff" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#94a3b8" }}>Vida Útil (h)</label>
                      <input type="number" value={printerLifespanH} onChange={(e) => setPrinterLifespanH(e.target.value)} style={{ width: "100%", padding: 4, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, color: "#fff" }} />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <div style={{ background: "#1e293b", padding: 14, borderRadius: 12, border: "1px solid #334155", display: "flex", flexDirection: "column", gap: 10 }}>
                  <strong style={{ fontSize: 13, color: "#f8fafc" }}>📥 PARÂMETROS DA PEÇA</strong>
                  <div>
                    <label style={{ fontSize: 11, color: "#94a3b8" }}>Nome da Peça / Arquivo</label>
                    <input type="text" value={calcPartName} onChange={(e) => setCalcPartName(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#94a3b8" }}>Tempo (Horas)</label>
                      <input type="number" step="0.1" value={calcPrintHours} onChange={(e) => setCalcPrintHours(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#94a3b8" }}>Acessórios (R$)</label>
                      <input type="number" step="0.1" value={calcExtraCosts} onChange={(e) => setCalcExtraCosts(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>Filamentos (AMS Lite):</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                      {calcFilaments.map((f, idx) => (
                        <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6 }}>
                          <select
                            value={f.spoolId}
                            onChange={(e) => {
                              const updated = [...calcFilaments];
                              updated[idx].spoolId = e.target.value;
                              setCalcFilaments(updated);
                            }}
                            style={{ padding: 6, background: "#0f172a", border: "1px solid #475569", borderRadius: 4, color: "#fff", fontSize: 11 }}
                          >
                            <option value="">F{idx + 1}: Carretel do Estoque...</option>
                            {inventory.map((s) => (
                              <option key={s.id} value={s.id}>{s.color_name} ({s.material}) - R${s.price_paid || 85}/kg</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            placeholder="Gramas"
                            value={f.weightG}
                            onChange={(e) => {
                              const updated = [...calcFilaments];
                              updated[idx].weightG = e.target.value;
                              setCalcFilaments(updated);
                            }}
                            style={{ padding: 6, background: "#0f172a", border: "1px solid #475569", borderRadius: 4, color: "#38bdf8", fontWeight: 700, textAlign: "center" }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ background: "linear-gradient(145deg, #0f172a, #172554)", padding: 16, borderRadius: 12, border: "1px solid #38bdf8", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ color: "#38bdf8" }}>💰 PREÇO & MARGEM</strong>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>Markup:</span>
                        <input type="number" step="0.1" value={markupMultiplier} onChange={(e) => setMarkupMultiplier(e.target.value)} style={{ width: 55, padding: 4, background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 4, color: "#fff", textAlign: "center" }} />
                        <span style={{ color: "#38bdf8" }}>×</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#94a3b8" }}>Filamento:</span>
                        <span>R$ {totalFilamentCost.toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#94a3b8" }}>Máquina ({hours}h):</span>
                        <span>R$ {machineCostTotal.toFixed(2)}</span>
                      </div>
                      {extrasCost > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#94a3b8" }}>Acessórios:</span>
                          <span>R$ {extrasCost.toFixed(2)}</span>
                        </div>
                      )}
                      <div style={{ borderTop: "1px solid #334155", paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                        <span style={{ color: "#cbd5e1" }}>Custo de Produção:</span>
                        <span style={{ color: "#ef4444" }}>R$ {totalProductionCost.toFixed(2)}</span>
                      </div>
                    </div>

                    <div style={{ background: "rgba(2, 132, 199, 0.2)", padding: 12, borderRadius: 8, textAlign: "center", border: "1px solid rgba(56, 189, 248, 0.4)", marginBottom: 12 }}>
                      <span style={{ fontSize: 10, color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>Preço de Venda Sugerido</span>
                      <div style={{ fontSize: 28, fontWeight: 900, color: "#38bdf8" }}>R$ {suggestedSalePrice.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginTop: 2 }}>Ganho: + R$ {netEarnings.toFixed(2)}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveToCatalog}
                    style={{ width: "100%", padding: 12, background: "#059669", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    💾 Salvar Peça no Catálogo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 4: GRAVAR TAG */}
      {activeTab === "writer" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <h2 style={{ fontSize: 17, color: "#f8fafc", margin: "0 0 14px" }}>Gravar / Gerar Tag NFC</h2>
          <form onSubmit={handleCreateAndWriteTag} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Tag ID</label>
              <input type="text" value={customTagId} onChange={(e) => setCustomTagId(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #475569", borderRadius: 6, color: "#38bdf8", fontWeight: 700 }} required />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "#cbd5e1" }}>Marca</label>
                <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}>
                  {POPULAR_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#cbd5e1" }}>Material</label>
                <select value={material} onChange={(e) => setMaterial(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}>
                  <option value="PETG">PETG</option>
                  <option value="PLA">PLA</option>
                  <option value="ABS">ABS</option>
                  <option value="TPU">TPU</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#cbd5e1" }}>Cor</label>
              <input type="text" value={colorName} onChange={(e) => setColorName(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8" }}>Peso Balança (g)</label>
                <input type="number" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8" }}>Tara (g)</label>
                <input type="number" value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              </div>
            </div>
            <button type="submit" disabled={isWriting} style={{ padding: 12, background: isWriting ? "#0369a1" : "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: isWriting ? "not-allowed" : "pointer" }}>
              {isWriting ? "📡 Aproxime o celular da tag..." : "📲 Gravar / Salvar Tag"}
            </button>
          </form>
          {feedbackMsg && <div style={{ marginTop: 10, padding: 8, background: "#0f172a", borderRadius: 6, color: "#38bdf8", fontSize: 12 }}>{feedbackMsg}</div>}
          {nfcError && <div style={{ marginTop: 8, color: "#f87171", fontSize: 12 }}>{nfcError}</div>}
        </div>
      )}

      {/* Modal Resolver Pesagem Pendente */}
      {resolvingJob && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #f59e0b", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
            <h3 style={{ margin: "0 0 6px", color: "#fbbf24" }}>⚖️ Confirmar Consumo Real</h3>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 14px" }}>
              Peça: <strong>{resolvingJob.subtask_name}</strong><br />
              {resolvingJob.spool ? `Carretel: ${resolvingJob.spool.color_name} (${resolvingJob.spool.material})` : "Sem carretel vinculado"}
            </p>
            <form onSubmit={handleResolveWeighing} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "#cbd5e1", display: "block", marginBottom: 4 }}>Peso real gasto na peça (g)</label>
                <input
                  type="number"
                  step="0.1"
                  value={resolvedGrams}
                  onChange={(e) => setResolvedGrams(e.target.value)}
                  style={{ width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 16, fontWeight: 700, boxSizing: "border-box" }}
                  required
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setResolvingJob(null)} style={{ flex: 1, padding: 10, background: "#334155", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancelar</button>
                <button type="submit" style={{ flex: 1, padding: 10, background: "#059669", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Confirmar e Abater</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Re-pesagem */}
      {weighingSpool && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
            <h3 style={{ margin: "0 0 10px", color: "#fff" }}>⚖️ Re-pesar {weighingSpool.color_name}</h3>
            <form onSubmit={handleSaveWeigh} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input type="number" value={modalGross} onChange={(e) => setModalGross(e.target.value)} placeholder="Peso na balança (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              <input type="number" value={modalTare} onChange={(e) => setModalTare(e.target.value)} placeholder="Tara (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setWeighingSpool(null)} style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6 }}>Cancelar</button>
                <button type="submit" style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edição */}
      {editingSpool && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
            <h3 style={{ margin: "0 0 10px", color: "#fff" }}>✏️ Editar Carretel</h3>
            <form onSubmit={handleSaveEdit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="text" value={editColorName} onChange={(e) => setEditColorName(e.target.value)} placeholder="Cor" style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              <input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} placeholder="Saldo em gramas" style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setEditingSpool(null)} style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6 }}>Cancelar</button>
                <button type="submit" style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}