// Build Version: 1789677016868
﻿import React, { useEffect, useState } from "react";
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
  price_paid?: number;
}

interface FilamentPreset {
  id: string;
  name: string;
  material: string;
  brand: string;
  density: number;
  color_hex?: string;
  nozzle_temperature_range?: string;
  bed_temperature?: string;
}

interface PrintLog {
  id: string;
  subtask_name: string;
  filament_used_g: number;
  print_duration_minutes: number;
  slot_index: number;
  completed_at: string;
  spool?: Spool;
}

const POPULAR_BRANDS = [
  "Voolt3D",
  "3D Fila",
  "Bambu Lab",
  "Creality",
  "Anycubic",
  "Elegoo",
  "Easy Print",
  "Esun",
  "Fusion",
  "GTMax3D",
  "MasterPrint",
  "Multifila",
  "PolyMaker",
  "PrintaLot",
  "Sulun",
  "Suntop",
  "TopRecicla",
  "Outra..."
];

const TARE_PRESETS = [
  { label: "Voolt Vazado (218g)", val: "218" },
  { label: "Voolt Fechado/Antigo (250g)", val: "250" },
  { label: "Voolt Transparente (195g)", val: "195" },
  { label: "MasterPrint (230g)", val: "230" },
  { label: "Padrão (220g)", val: "220" }
];

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return { r: 17, g: 24, b: 39 };
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (val: number) => Math.max(0, Math.min(255, isNaN(val) ? 0 : val));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"ams" | "inventory" | "writer">("ams");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activeSlots, setActiveSlots] = useState<Record<number, Spool | null>>({
    0: null, 1: null, 2: null, 3: null
  });

  const [printLogs, setPrintLogs] = useState<PrintLog[]>([]);
  const [inventory, setInventory] = useState<Spool[]>([]);
  const [presets, setPresets] = useState<FilamentPreset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("TODOS");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
    );
  });

  // Modais
  const [weighingSpool, setWeighingSpool] = useState<Spool | null>(null);
  const [modalGross, setModalGross] = useState("");
  const [modalTare, setModalTare] = useState("218");

  const [editingSpool, setEditingSpool] = useState<Spool | null>(null);
  const [editBrand, setEditBrand] = useState("");
  const [editMaterial, setEditMaterial] = useState("PETG");
  const [editColorName, setEditColorName] = useState("");
  const [editColorHex, setEditColorHex] = useState("#111827");
  const [editWeight, setEditWeight] = useState("");
  const [editPrice, setEditPrice] = useState("");

  // Form Criador de Tags
  const [selectedBrand, setSelectedBrand] = useState("Voolt3D");
  const [customBrandName, setCustomBrandName] = useState("");
  const [material, setMaterial] = useState("PETG");
  const [colorName, setColorName] = useState("Preto");
  const [colorHex, setColorHex] = useState("#111827");
  const [rgb, setRgb] = useState({ r: 17, g: 24, b: 39 });
  const [grossWeight, setGrossWeight] = useState("1218");
  const [tareWeight, setTareWeight] = useState("218");
  const [spoolPrice, setSpoolPrice] = useState("85.00");
  const [customTagId, setCustomTagId] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const {
    isReading,
    isWriting,
    nfcUid,
    error: nfcError,
    startScanning,
    writeTagUrl,
    setNfcUid,
  } = useNfc();

  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstallApp() {
    if (!deferredPrompt) {
      alert("Toque nos 3 pontinhos do navegador e selecione 'Adicionar à tela inicial'.");
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  function generateAutoTagId(mat: string, col: string) {
    const cleanCol = col.trim().toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-");
    const rnd = Math.floor(1000 + Math.random() * 9000);
    return `FILA-${mat.toUpperCase()}-${cleanCol || "COR"}-${rnd}`;
  }

  useEffect(() => {
    setCustomTagId(generateAutoTagId("PETG", "PRETO"));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tagFromUrl = params.get("tag");
    if (tagFromUrl) {
      setNfcUid(tagFromUrl);
      setActiveTab("ams");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [setNfcUid]);

  async function loadData() {
    const { data: pData } = await supabase.from("printers").select("*");
    if (pData && pData.length > 0) {
      setPrinters(pData);
      const printerId = pData[0].id;

      const { data: slotData } = await supabase
        .from("ams_slots")
        .select("slot_index, spool:spools(*)")
        .eq("printer_id", printerId);

      if (slotData) {
        const slotsMap: Record<number, Spool | null> = { 0: null, 1: null, 2: null, 3: null };
        slotData.forEach((s: any) => {
          slotsMap[s.slot_index] = s.spool;
        });
        setActiveSlots(slotsMap);
      }
    }

    const { data: invData } = await supabase.from("spools").select("*").order("color_name", { ascending: true });
    if (invData) setInventory(invData);

    const { data: presetsData } = await supabase.from("filament_presets").select("*").order("name");
    if (presetsData) setPresets(presetsData);

    const { data: logsData } = await supabase
      .from("print_logs")
      .select("*, spool:spools(*)")
      .order("completed_at", { ascending: false })
      .limit(6);
    if (logsData) setPrintLogs(logsData);
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500);
    return () => clearInterval(interval);
  }, []);

  function handleSelectExistingSpool(e: React.ChangeEvent<HTMLSelectElement>) {
    const spoolId = e.target.value;
    if (!spoolId) return;

    const chosen = inventory.find((s) => s.id === spoolId);
    if (chosen) {
      setCustomTagId(chosen.nfc_uid);
      setMaterial(chosen.material);
      setSelectedBrand(chosen.brand);
      setColorName(chosen.color_name);
      updateFromHex(chosen.color_hex);
      setSpoolPrice((chosen.price_paid || 85).toString());
      setTareWeight("218");
      setGrossWeight((chosen.current_weight + 218).toString());
      setFeedbackMsg(`📦 Dados carregados do estoque para: ${chosen.color_name} (${chosen.brand})`);
    }
  }

  function handleSelectPreset(e: React.ChangeEvent<HTMLSelectElement>) {
    const presetId = e.target.value;
    if (!presetId) return;

    const chosen = presets.find((p) => p.id === presetId);
    if (chosen) {
      setMaterial(chosen.material);
      if (chosen.brand) setSelectedBrand(chosen.brand);
      if (chosen.color_hex) updateFromHex(chosen.color_hex);
      setColorName(chosen.name);
      setCustomTagId(generateAutoTagId(chosen.material, chosen.name));
    }
  }

  function updateFromHex(newHex: string, defaultName?: string) {
    setColorHex(newHex);
    setRgb(hexToRgb(newHex));
    if (defaultName) setColorName(defaultName);
  }

  function updateFromRgb(part: "r" | "g" | "b", valStr: string) {
    const val = parseInt(valStr, 10) || 0;
    const newRgb = { ...rgb, [part]: Math.max(0, Math.min(255, val)) };
    setRgb(newRgb);
    setColorHex(rgbToHex(newRgb.r, newRgb.g, newRgb.b));
  }

  async function handleAssignSlot(slotIdx: number) {
    if (!nfcUid || printers.length === 0) return;

    let { data: spool } = await supabase
      .from("spools")
      .select("*")
      .eq("nfc_uid", nfcUid)
      .single();

    if (!spool) {
      const { data: created } = await supabase
        .from("spools")
        .insert({
          nfc_uid: nfcUid,
          brand: "Voolt3D",
          material: "PETG",
          color_name: "Preto",
          color_hex: "#111827",
          initial_weight: 1000,
          current_weight: 1000,
          price_paid: 85.00,
        })
        .select()
        .single();
      spool = created;
    }

    if (spool) {
      await supabase.from("ams_slots").upsert(
        {
          printer_id: printers[0].id,
          slot_index: slotIdx,
          spool_id: spool.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "printer_id,slot_index" }
      );
      setNfcUid(null);
      await loadData();
    }
  }

  async function handleEjectSlot(e: React.MouseEvent, slotIdx: number) {
    e.stopPropagation();
    if (printers.length === 0) return;

    await supabase
      .from("ams_slots")
      .update({ spool_id: null, updated_at: new Date().toISOString() })
      .eq("printer_id", printers[0].id)
      .eq("slot_index", slotIdx);

    await loadData();
  }

  function openWeighModal(spool: Spool) {
    setWeighingSpool(spool);
    const defaultTare = spool.brand === "Voolt3D" ? "218" : "220";
    setModalTare(defaultTare);
    setModalGross((spool.current_weight + parseFloat(defaultTare)).toString());
  }

  async function handleSaveWeigh(e: React.FormEvent) {
    e.preventDefault();
    if (!weighingSpool) return;

    const net = Math.max(0, (parseFloat(modalGross) || 0) - (parseFloat(modalTare) || 0));

    await supabase
      .from("spools")
      .update({ current_weight: net })
      .eq("id", weighingSpool.id);

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

    await supabase
      .from("spools")
      .update({
        brand: editBrand,
        material: editMaterial,
        color_name: editColorName,
        color_hex: editColorHex,
        current_weight: parseFloat(editWeight) || 0,
        price_paid: parseFloat(editPrice) || 85.00,
      })
      .eq("id", editingSpool.id);

    setEditingSpool(null);
    await loadData();
  }

  async function handleDeleteSpool(spool: Spool) {
    const confirm = window.confirm(`Tem certeza que deseja apagar o carretel "${spool.color_name}" (${spool.brand})?`);
    if (!confirm) return;

    await supabase.from("ams_slots").update({ spool_id: null }).eq("spool_id", spool.id);
    const { error } = await supabase.from("spools").delete().eq("id", spool.id);
    if (error) {
      alert("Erro ao excluir: " + error.message);
    } else {
      await loadData();
    }
  }

  function copyTagUrl(tagId: string) {
    const url = `https://filamap.pages.dev/?tag=${encodeURIComponent(tagId)}`;
    navigator.clipboard.writeText(url);
    alert(`📋 Link copiado para a área de transferência!\n\n${url}\n\nCole no campo URI do app NFC Tools para gravar.`);
  }

  async function handleCreateAndWriteTag(e: React.FormEvent) {
    e.preventDefault();
    setFeedbackMsg(null);

    const finalBrand = selectedBrand === "Outra..." ? (customBrandName.trim() || "Outra") : selectedBrand;
    const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));
    const finalTagId = customTagId.trim() || generateAutoTagId(material, colorName);
    const fullTargetUrl = `https://filamap.pages.dev/?tag=${encodeURIComponent(finalTagId)}`;

    const wrote = await writeTagUrl(fullTargetUrl);

    const { error: dbError } = await supabase.from("spools").upsert(
      {
        nfc_uid: finalTagId,
        brand: finalBrand,
        material,
        color_name: colorName,
        color_hex: colorHex,
        initial_weight: netWeight,
        current_weight: netWeight,
        price_paid: parseFloat(spoolPrice) || 85.00,
      },
      { onConflict: "nfc_uid" }
    );

    if (dbError) {
      setFeedbackMsg("Erro no banco: " + dbError.message);
    } else if (wrote) {
      setFeedbackMsg(`✅ Tag gravada com sucesso! Link: ${fullTargetUrl}`);
      setCustomTagId(generateAutoTagId(material, colorName));
    } else {
      setFeedbackMsg(`ℹ️ Carretel salvo no banco! Você pode copiar o link da tag abaixo para usar no NFC Tools.`);
    }
    await loadData();
  }

  const filteredInventory = inventory.filter((item) => {
    const matchesSearch =
      item.color_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.nfc_uid.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMat = filterMaterial === "TODOS" || item.material === filterMaterial;
    return matchesSearch && matchesMat;
  });

  const groupedByMaterial = filteredInventory.reduce((acc, spool) => {
    const mat = (spool.material || "OUTROS").toUpperCase();
    if (!acc[mat]) acc[mat] = [];
    acc[mat].push(spool);
    return acc;
  }, {} as Record<string, Spool[]>);

  const materialOrder = ["PLA", "PETG", "TPU", "ABS", "OUTROS"];
  const sortedMaterialKeys = Object.keys(groupedByMaterial).sort((a, b) => {
    const idxA = materialOrder.indexOf(a);
    const idxB = materialOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const colorPresets = [
    { name: "Preto", hex: "#111827" },
    { name: "Branco", hex: "#FFFFFF" },
    { name: "Cinza", hex: "#64748B" },
    { name: "Laranja", hex: "#F97316" },
    { name: "Azul", hex: "#2563EB" },
    { name: "Vermelho", hex: "#DC2626" },
    { name: "Amarelo", hex: "#EAB308" },
    { name: "Verde", hex: "#16A34A" },
  ];

  const activePrinter = printers[0];
  const isPrinting = activePrinter?.gcode_state === "RUNNING" || activePrinter?.gcode_state === "PAUSE";
  const activeSpool = activePrinter ? activeSlots[activePrinter.active_slot_index || 0] : null;

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
            {!isInstalled && deferredPrompt && (
              <button
                onClick={handleInstallApp}
                style={{
                  background: "#059669",
                  color: "#ffffff",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: 16,
                  fontWeight: 700,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                📥 Instalar App
              </button>
            )}
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 700,
                background: activePrinter?.is_online ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                color: activePrinter?.is_online ? "#34d399" : "#f87171",
                border: `1px solid ${activePrinter?.is_online ? "#059669" : "#dc2626"}`,
              }}
            >
              {activePrinter?.is_online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Abas */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setActiveTab("ams")}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: 8,
              border: "none",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              background: activeTab === "ams" ? "#0284c7" : "#1e293b",
              color: activeTab === "ams" ? "#ffffff" : "#94a3b8",
            }}
          >
            🖨️ Monitor AMS
          </button>
          <button
            onClick={() => setActiveTab("inventory")}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: 8,
              border: "none",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              background: activeTab === "inventory" ? "#0284c7" : "#1e293b",
              color: activeTab === "inventory" ? "#ffffff" : "#94a3b8",
            }}
          >
            📦 Almoxarifado ({inventory.length})
          </button>
          <button
            onClick={() => setActiveTab("writer")}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: 8,
              border: "none",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              background: activeTab === "writer" ? "#0284c7" : "#1e293b",
              color: activeTab === "writer" ? "#ffffff" : "#94a3b8",
            }}
          >
            🏷️ Gravar / Gerar Tag
          </button>
        </div>
      </header>

      {/* ABA 1: MONITOR AMS */}
      {activeTab === "ams" && (
        <div>
          {/* Painel ao Vivo */}
          <div style={{
            background: isPrinting ? "linear-gradient(145deg, #0f172a, #172554)" : "#1e293b",
            border: `1px solid ${isPrinting ? "#38bdf8" : "#334155"}`,
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            boxShadow: isPrinting ? "0 4px 20px rgba(56, 189, 248, 0.15)" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isPrinting ? "#22c55e" : "#94a3b8",
                  boxShadow: isPrinting ? "0 0 10px #22c55e" : "none",
                }} />
                <strong style={{ fontSize: 15, color: "#f8fafc" }}>
                  {isPrinting ? "IMPRESSÃO AO VIVO" : "STATUS DA IMPRESSORA"}
                </strong>
              </div>
              <span style={{
                background: isPrinting ? "rgba(34, 197, 94, 0.2)" : "#334155",
                color: isPrinting ? "#4ade80" : "#94a3b8",
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700,
              }}>
                {activePrinter?.gcode_state || "OCIOSA"}
              </span>
            </div>

            <div style={{ fontSize: 16, fontWeight: 800, color: "#ffffff", marginBottom: 12, wordBreak: "break-all" }}>
              {activePrinter?.current_task ? activePrinter.current_task : "Nenhum arquivo em impressão"}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, color: "#cbd5e1" }}>
                <span>Progresso: <strong style={{ color: "#38bdf8" }}>{activePrinter?.print_progress || 0}%</strong></span>
                <span>Tempo Restante: <strong style={{ color: "#f8fafc" }}>{activePrinter?.remaining_time_min || 0} min</strong></span>
              </div>
              <div style={{ width: "100%", height: 10, background: "#0f172a", borderRadius: 5, overflow: "hidden", border: "1px solid #334155" }}>
                <div style={{
                  width: `${activePrinter?.print_progress || 0}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #0284c7, #38bdf8)",
                  transition: "width 0.4s ease-in-out",
                }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, background: "#0f172a", padding: 10, borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Camada</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                  {activePrinter?.current_layer || 0} / {activePrinter?.total_layers || 0}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Bico (Nozzle)</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>
                  {activePrinter?.nozzle_temp || 0}°C <span style={{ fontSize: 11, color: "#64748b" }}>({activePrinter?.nozzle_target_temp || 0}°C)</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Mesa (Bed)</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>
                  {activePrinter?.bed_temp || 0}°C <span style={{ fontSize: 11, color: "#64748b" }}>({activePrinter?.bed_target_temp || 0}°C)</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>Slot em Uso</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", display: "flex", alignItems: "center", gap: 4 }}>
                  {activeSpool ? (
                    <>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: activeSpool.color_hex, display: "inline-block" }} />
                      Slot {(activePrinter?.active_slot_index || 0) + 1}
                    </>
                  ) : (
                    `Slot ${(activePrinter?.active_slot_index || 0) + 1}`
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bandejas do AMS Lite */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, marginBottom: 16, border: "1px solid #334155" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: 10, fontWeight: 700 }}>
              Bandejas do AMS Lite (Bambu Lab A1)
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {[0, 1, 2, 3].map((slotIdx) => {
                const spool = activeSlots[slotIdx];
                const isTarget = nfcUid !== null;
                const isCurrentlyExtruding = activePrinter?.active_slot_index === slotIdx && isPrinting;

                return (
                  <div
                    key={slotIdx}
                    onClick={() => isTarget && handleAssignSlot(slotIdx)}
                    style={{
                      background: isTarget ? "#172554" : isCurrentlyExtruding ? "rgba(56, 189, 248, 0.08)" : "#0f172a",
                      borderRadius: 8,
                      padding: 12,
                      border: isCurrentlyExtruding ? "2px solid #38bdf8" : isTarget ? "2px dashed #38bdf8" : "1px solid #334155",
                      cursor: isTarget ? "pointer" : "default",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      minHeight: 130,
                      boxSizing: "border-box",
                      position: "relative",
                    }}
                  >
                    {isCurrentlyExtruding && (
                      <span style={{
                        position: "absolute",
                        top: -8,
                        right: 8,
                        background: "#38bdf8",
                        color: "#0f172a",
                        fontSize: 9,
                        fontWeight: 900,
                        padding: "1px 6px",
                        borderRadius: 8,
                      }}>
                        EXTRUSANDO
                      </span>
                    )}

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>SLOT {slotIdx + 1}</span>
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            backgroundColor: spool ? spool.color_hex : "#334155",
                            border: "1px solid #64748b",
                            display: "inline-block",
                          }}
                        />
                      </div>

                      {spool ? (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#f1f5f9" }}>{spool.material}</div>
                          <div style={{ fontSize: 11, color: "#cbd5e1" }}>{spool.color_name}</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>{spool.brand}</div>
                        </div>
                      ) : (
                        <div style={{ color: isTarget ? "#38bdf8" : "#475569", fontSize: 12, fontStyle: "italic", marginTop: 4 }}>
                          {isTarget ? "👉 Toque para fixar" : "Vazio"}
                        </div>
                      )}
                    </div>

                    {spool && (
                      <div style={{ marginTop: 8, borderTop: "1px solid #1e293b", paddingTop: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 6 }}>
                          <span style={{ color: "#94a3b8" }}>Saldo:</span>
                          <strong style={{ color: spool.current_weight < 150 ? "#f87171" : "#38bdf8" }}>
                            {spool.current_weight}g
                          </strong>
                        </div>
                        <button
                          onClick={(e) => handleEjectSlot(e, slotIdx)}
                          style={{
                            width: "100%",
                            padding: "4px",
                            background: "#334155",
                            color: "#cbd5e1",
                            border: "none",
                            borderRadius: 4,
                            fontSize: 10,
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          ⏏️ Ejetar / Liberar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Histórico Recente */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, marginBottom: 16, border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, margin: 0, color: "#f8fafc" }}>📋 Histórico Recente de Impressões</h3>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Bambu Lab A1 Telemetria</span>
            </div>

            {printLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px", color: "#64748b", fontSize: 12 }}>
                Nenhuma impressão registrada ainda.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {printLogs.map((log) => {
                  const costPerGram = ((log.spool?.price_paid || 85) / 1000);
                  const pieceCost = (log.filament_used_g * costPerGram).toFixed(2);

                  return (
                    <div
                      key={log.id}
                      style={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        padding: "10px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            backgroundColor: log.spool?.color_hex || "#38bdf8",
                            border: "1px solid #64748b",
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
                            {log.subtask_name || "Trabalho 3D"}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            Slot {(log.slot_index ?? 0) + 1} ({log.spool?.material || "PETG"} {log.spool?.color_name || ""}) •{" "}
                            {log.completed_at ? new Date(log.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#f87171" }}>
                            -{log.filament_used_g}g
                          </span>
                          <span style={{ fontSize: 11, background: "rgba(16, 185, 129, 0.2)", color: "#34d399", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                            R$ {pieceCost}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                          {log.print_duration_minutes ? `${log.print_duration_minutes} min` : "Finalizado"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Leitura NFC */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 6px", color: "#f8fafc" }}>Leitura de Tag no Carretel</h3>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 12px" }}>
              Aproxime o celular do adesivo NFC para carregar o filamento em um dos slots.
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={startScanning}
                disabled={isReading}
                style={{
                  flex: "1 1 180px",
                  minHeight: 48,
                  background: isReading ? "#0369a1" : "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: isReading ? "not-allowed" : "pointer",
                }}
              >
                {isReading ? "📡 Aproxime da tag..." : "📱 Ler NFC (Celular)"}
              </button>

              <button
                onClick={() => setNfcUid(`FILA-SIM-${Math.floor(1000 + Math.random() * 9000)}`)}
                style={{
                  flex: "1 1 180px",
                  minHeight: 48,
                  background: "#334155",
                  color: "#e2e8f0",
                  border: "1px solid #475569",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                💻 Simular Tag (Desktop)
              </button>
            </div>

            {nfcUid && (
              <div style={{ marginTop: 14, padding: 12, background: "#1e3a8a", border: "1px solid #3b82f6", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 11, color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>Tag Carregada:</span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#ffffff" }}>{nfcUid}</div>
                  <div style={{ fontSize: 11, color: "#bfdbfe", marginTop: 2 }}>Toque no slot do AMS acima para fixar o carretel.</div>
                </div>
                <button
                  onClick={() => setNfcUid(null)}
                  style={{ background: "transparent", border: "1px solid #93c5fd", color: "#ffffff", padding: "6px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                >
                  Cancelar
                </button>
              </div>
            )}

            {nfcError && (
              <div style={{ marginTop: 10, color: "#f87171", fontSize: 12 }}>
                {nfcError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: ALMOXARIFADO COM BOTAO DE COPIAR LINK NFC */}
      {activeTab === "inventory" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 17, color: "#f8fafc", margin: 0 }}>Estoque de Carretéis</h2>
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "2px 0 0" }}>Separado por material e ordenado de A a Z</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar cor, marca ou tag..."
                style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 }}
              />
              <select
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 }}
              >
                <option value="TODOS">Todos os Materiais</option>
                <option value="PLA">PLA</option>
                <option value="PETG">PETG</option>
                <option value="TPU">TPU</option>
                <option value="ABS">ABS</option>
              </select>
            </div>
          </div>

          {filteredInventory.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "#64748b", fontSize: 13 }}>
              Nenhum carretel encontrado no estoque.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {sortedMaterialKeys.map((mat) => {
                const spools = (groupedByMaterial[mat] || []).slice().sort((a, b) =>
                  a.color_name.localeCompare(b.color_name, "pt-BR", { sensitivity: "base" })
                );

                const totalWeight = spools.reduce((acc, s) => acc + (s.current_weight || 0), 0);
                const totalValue = spools.reduce((acc, s) => {
                  const cpg = (s.price_paid || 85) / 1000;
                  return acc + ((s.current_weight || 0) * cpg);
                }, 0);

                const badgeColor = mat === "PLA" ? "#38bdf8" : mat === "PETG" ? "#f59e0b" : mat === "TPU" ? "#a855f7" : "#10b981";

                return (
                  <div key={mat} style={{ background: "#0f172a", borderRadius: 10, border: "1px solid #334155", overflow: "hidden" }}>
                    <div style={{
                      padding: "10px 14px",
                      background: "rgba(30, 41, 59, 0.7)",
                      borderBottom: "1px solid #334155",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          background: badgeColor,
                          color: "#0f172a",
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontWeight: 900,
                          fontSize: 12,
                          letterSpacing: "0.04em"
                        }}>
                          {mat}
                        </span>
                        <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 600 }}>
                          {spools.length} {spools.length === 1 ? "carretel" : "carretéis"}
                        </span>
                      </div>

                      <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 12 }}>
                        <span>Total: <strong style={{ color: "#f8fafc" }}>{(totalWeight / 1000).toFixed(2)} kg</strong></span>
                        <span>Valor: <strong style={{ color: "#34d399" }}>R$ {totalValue.toFixed(2)}</strong></span>
                      </div>
                    </div>

                    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {spools.map((spool) => {
                        const isLow = spool.current_weight < 150;
                        const price = spool.price_paid || 85.00;
                        const costPerGram = price / 1000;
                        const currentAssetValue = (spool.current_weight * costPerGram).toFixed(2);

                        return (
                          <div
                            key={spool.id}
                            style={{
                              background: "#1e293b",
                              border: "1px solid #334155",
                              borderRadius: 8,
                              padding: 10,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  backgroundColor: spool.color_hex,
                                  border: "2px solid #64748b",
                                  flexShrink: 0,
                                }}
                              />
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <strong style={{ fontSize: 13, color: "#f8fafc" }}>{spool.color_name}</strong>
                                  {isLow && (
                                    <span style={{ fontSize: 9, background: "#ef4444", color: "#fff", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>
                                      FIM DE ROLO
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                                  Marca: <span style={{ color: "#cbd5e1" }}>{spool.brand}</span> • Tag: <span style={{ color: "#38bdf8" }}>{spool.nfc_uid}</span>
                                </div>
                                <div style={{ fontSize: 10, color: "#10b981", marginTop: 1 }}>
                                  R$ {price.toFixed(2)}/kg • Restante: <strong>R$ {currentAssetValue}</strong>
                                </div>
                              </div>
                            </div>

                            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                              <div style={{ fontSize: 14, fontWeight: 900, color: isLow ? "#ef4444" : "#38bdf8" }}>
                                {spool.current_weight}g
                              </div>

                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                <button
                                  onClick={() => copyTagUrl(spool.nfc_uid)}
                                  title="Copiar Link NFC completo para usar no NFC Tools"
                                  style={{
                                    background: "#0369a1",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 7px",
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  📋 Copiar Link NFC
                                </button>
                                <button
                                  onClick={() => openEditModal(spool)}
                                  title="Editar Carretel"
                                  style={{
                                    background: "#0f172a",
                                    color: "#38bdf8",
                                    border: "1px solid #334155",
                                    padding: "3px 6px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    cursor: "pointer",
                                  }}
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => openWeighModal(spool)}
                                  title="Re-pesar rápido"
                                  style={{
                                    background: "#334155",
                                    color: "#e2e8f0",
                                    border: "1px solid #475569",
                                    padding: "3px 6px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    cursor: "pointer",
                                  }}
                                >
                                  ⚖️
                                </button>
                                <button
                                  onClick={() => {
                                    setNfcUid(spool.nfc_uid);
                                    setActiveTab("ams");
                                  }}
                                  title="Carregar no AMS"
                                  style={{
                                    background: "#0284c7",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 8px",
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  👉 AMS
                                </button>
                                <button
                                  onClick={() => handleDeleteSpool(spool)}
                                  title="Excluir carretel"
                                  style={{
                                    background: "rgba(239, 68, 68, 0.15)",
                                    color: "#f87171",
                                    border: "1px solid #dc2626",
                                    padding: "3px 6px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    cursor: "pointer",
                                  }}
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA 3: CRIADOR / VINCULADOR DE TAGS */}
      {activeTab === "writer" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <h2 style={{ fontSize: 17, color: "#f8fafc", margin: "0 0 4px" }}>Gravar / Gerar Tag NFC</h2>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 14px" }}>
            Vincule um carretel já existente do Almoxarifado ou crie uma tag nova padronizada.
          </p>

          <form onSubmit={handleCreateAndWriteTag} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Opção 1: Vincular carretel já existente no estoque */}
            {inventory.length > 0 && (
              <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #38bdf8" }}>
                <label style={{ display: "block", fontSize: 11, color: "#38bdf8", fontWeight: 700, marginBottom: 4 }}>
                  📦 VINCULAR CARRETEL JÁ EXISTENTE DO ALMOXARIFADO ({inventory.length} carretéis)
                </label>
                <select
                  onChange={handleSelectExistingSpool}
                  defaultValue=""
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: 6,
                    color: "#f8fafc",
                    fontSize: 13,
                    boxSizing: "border-box"
                  }}
                >
                  <option value="">Selecione um carretel do seu estoque...</option>
                  {inventory.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.color_name} ({s.brand} - {s.material}) • Saldo: {s.current_weight}g
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Opção 2: Importar do Bambu Studio */}
            {presets.length > 0 && (
              <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
                <label style={{ display: "block", fontSize: 11, color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>
                  ⚡ OU IMPORTAR PERFIL DO BAMBU STUDIO ({presets.length} perfis)
                </label>
                <select
                  onChange={handleSelectPreset}
                  defaultValue=""
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: 6,
                    color: "#f8fafc",
                    fontSize: 13,
                    boxSizing: "border-box"
                  }}
                >
                  <option value="">Selecione um preset para autocompletar...</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.brand} - {p.material})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Código e Link da Tag */}
            <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>CÓDIGO PADRÃO DA TAG</label>
                <button
                  type="button"
                  onClick={() => setCustomTagId(generateAutoTagId(material, colorName))}
                  style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: 11 }}
                >
                  🔄 Gerar Novo ID
                </button>
              </div>
              <input
                type="text"
                value={customTagId}
                onChange={(e) => setCustomTagId(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", background: "#1e293b", border: "1px solid #475569", borderRadius: 6, color: "#38bdf8", fontWeight: 700, fontSize: 14, boxSizing: "border-box" }}
                required
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>
                  Link: https://filamap.pages.dev/?tag={customTagId}
                </div>
                <button
                  type="button"
                  onClick={() => copyTagUrl(customTagId)}
                  style={{
                    background: "#0369a1",
                    color: "#fff",
                    border: "none",
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📋 Copiar Link p/ NFC Tools
                </button>
              </div>
            </div>

            {/* Marca */}
            <div style={{ display: "grid", gridTemplateColumns: selectedBrand === "Outra..." ? "1fr 1fr" : "1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Marca do Filamento</label>
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #38bdf8", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }}
                >
                  {POPULAR_BRANDS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {selectedBrand === "Outra..." && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Digite o Nome da Marca</label>
                  <input
                    type="text"
                    value={customBrandName}
                    onChange={(e) => setCustomBrandName(e.target.value)}
                    placeholder="Nome da marca..."
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #38bdf8", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }}
                    required
                  />
                </div>
              )}
            </div>

            {/* Material e Preço */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Material</label>
                <select
                  value={material}
                  onChange={(e) => {
                    setMaterial(e.target.value);
                    setCustomTagId(generateAutoTagId(e.target.value, colorName));
                  }}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }}
                >
                  <option value="PETG">PETG</option>
                  <option value="PLA">PLA</option>
                  <option value="ABS">ABS</option>
                  <option value="TPU">TPU</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Preço Pago (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={spoolPrice}
                  onChange={(e) => setSpoolPrice(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }}
                  required
                />
              </div>
            </div>

            {/* Cores */}
            <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 700 }}>Cor do Filamento</label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Visual:</span>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      backgroundColor: colorHex,
                      border: "2px solid #ffffff",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                {colorPresets.map((c) => (
                  <button
                    type="button"
                    key={c.hex}
                    onClick={() => updateFromHex(c.hex, c.name)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      backgroundColor: c.hex,
                      border: colorHex.toUpperCase() === c.hex ? "2px solid #38bdf8" : "1px solid #475569",
                      cursor: "pointer",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => updateFromHex(e.target.value)}
                  style={{ width: 30, height: 30, border: "none", background: "transparent", cursor: "pointer" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 2 }}>R</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgb.r}
                    onChange={(e) => updateFromRgb("r", e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", background: "#1e293b", border: "1px solid #ef4444", borderRadius: 6, color: "#fff", boxSizing: "border-box", textAlign: "center", fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#22c55e", fontWeight: 700, marginBottom: 2 }}>G</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgb.g}
                    onChange={(e) => updateFromRgb("g", e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", background: "#1e293b", border: "1px solid #22c55e", borderRadius: 6, color: "#fff", boxSizing: "border-box", textAlign: "center", fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#3b82f6", fontWeight: 700, marginBottom: 2 }}>B</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgb.b}
                    onChange={(e) => updateFromRgb("b", e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", background: "#1e293b", border: "1px solid #3b82f6", borderRadius: 6, color: "#fff", boxSizing: "border-box", textAlign: "center", fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", fontWeight: 700, marginBottom: 2 }}>HEX</label>
                  <input
                    type="text"
                    value={colorHex}
                    onChange={(e) => updateFromHex(e.target.value)}
                    style={{ width: "100%", padding: "6px 6px", background: "#1e293b", border: "1px solid #475569", borderRadius: 6, color: "#38bdf8", boxSizing: "border-box", textAlign: "center", fontWeight: 700, fontSize: 12 }}
                  />
                </div>
              </div>

              <input
                type="text"
                value={colorName}
                onChange={(e) => {
                  setColorName(e.target.value);
                  setCustomTagId(generateAutoTagId(material, e.target.value));
                }}
                placeholder="Nome da cor..."
                style={{ width: "100%", padding: "8px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                required
              />
            </div>

            {/* Pesagem com Seletores Rápidos de Tara */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Peso na Balança (g)</label>
                  <input
                    type="number"
                    value={grossWeight}
                    onChange={(e) => setGrossWeight(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Tara do Carretel (g)</label>
                  <input
                    type="number"
                    value={tareWeight}
                    onChange={(e) => setTareWeight(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                    required
                  />
                </div>
              </div>

              <div>
                <span style={{ fontSize: 10, color: "#cbd5e1", display: "block", marginBottom: 4 }}>Taras Rápidas:</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {TARE_PRESETS.map((t) => (
                    <button
                      type="button"
                      key={t.val}
                      onClick={() => setTareWeight(t.val)}
                      style={{
                        background: tareWeight === t.val ? "#0284c7" : "#1e293b",
                        color: tareWeight === t.val ? "#fff" : "#94a3b8",
                        border: "1px solid #334155",
                        borderRadius: 4,
                        padding: "3px 6px",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ textAlign: "right", fontSize: 12, color: "#38bdf8", fontWeight: 700, borderTop: "1px solid #1e293b", paddingTop: 6 }}>
                Saldo Líquido: {Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0))}g
              </div>
            </div>

            <button
              type="submit"
              disabled={isWriting}
              style={{
                background: isWriting ? "#0369a1" : "#0284c7",
                color: "#fff",
                border: "none",
                padding: "14px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: isWriting ? "not-allowed" : "pointer",
                marginTop: 4,
              }}
            >
              {isWriting ? "📡 Aproxime a tag do celular..." : "📲 Gravar Tag NFC & Salvar"}
            </button>
          </form>

          {feedbackMsg && (
            <div style={{ marginTop: 12, padding: 10, background: "#0f172a", border: "1px solid #38bdf8", borderRadius: 8, fontSize: 12, color: "#f8fafc" }}>
              {feedbackMsg}
            </div>
          )}

          {nfcError && (
            <div style={{ marginTop: 8, color: "#f87171", fontSize: 12 }}>
              {nfcError}
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Re-pesagem rápida */}
      {weighingSpool && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 16,
        }}>
          <div style={{
            background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12,
            padding: 20, maxWidth: 430, width: "100%", boxSizing: "border-box",
          }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#f8fafc" }}>⚖️ Re-pesar Carretel</h3>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94a3b8" }}>
              {weighingSpool.material} - {weighingSpool.color_name} ({weighingSpool.brand})
            </p>

            <form onSubmit={handleSaveWeigh} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Peso na Balança (g)</label>
                <input
                  type="number"
                  value={modalGross}
                  onChange={(e) => setModalGross(e.target.value)}
                  style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>
                  Tara do Carretel (g) - Escolha rápida:
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {TARE_PRESETS.map((t) => (
                    <button
                      type="button"
                      key={t.val}
                      onClick={() => setModalTare(t.val)}
                      style={{
                        background: modalTare === t.val ? "#0284c7" : "#0f172a",
                        color: modalTare === t.val ? "#fff" : "#94a3b8",
                        border: "1px solid #334155",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={modalTare}
                  onChange={(e) => setModalTare(e.target.value)}
                  style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>

              <div style={{ background: "#0f172a", padding: 10, borderRadius: 6, textAlign: "center" }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Novo Saldo Líquido:</span>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#38bdf8" }}>
                  {Math.max(0, (parseFloat(modalGross) || 0) - (parseFloat(modalTare) || 0))}g
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setWeighingSpool(null)}
                  style={{ flex: 1, padding: "10px", background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: "10px", background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Salvar Peso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edição Completa */}
      {editingSpool && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 16,
        }}>
          <div style={{
            background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12,
            padding: 20, maxWidth: 440, width: "100%", boxSizing: "border-box",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: "#f8fafc" }}>✏️ Editar Carretel</h3>
              <span style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>{editingSpool.nfc_uid}</span>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Marca</label>
                  <input
                    type="text"
                    value={editBrand}
                    onChange={(e) => setEditBrand(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Material</label>
                  <select
                    value={editMaterial}
                    onChange={(e) => setEditMaterial(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  >
                    <option value="PETG">PETG</option>
                    <option value="PLA">PLA</option>
                    <option value="ABS">ABS</option>
                    <option value="TPU">TPU</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Nome da Cor</label>
                <input
                  type="text"
                  value={editColorName}
                  onChange={(e) => setEditColorName(e.target.value)}
                  style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Cor HEX</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="color"
                      value={editColorHex}
                      onChange={(e) => setEditColorHex(e.target.value)}
                      style={{ width: 34, height: 34, border: "none", background: "transparent", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      value={editColorHex}
                      onChange={(e) => setEditColorHex(e.target.value)}
                      style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#38bdf8", fontWeight: 700, boxSizing: "border-box" }}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Saldo Líquido (g)</label>
                  <input
                    type="number"
                    value={editWeight}
                    onChange={(e) => setEditWeight(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>Preço Pago por 1kg (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditingSpool(null)}
                  style={{ flex: 1, padding: "10px", background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: "10px", background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}