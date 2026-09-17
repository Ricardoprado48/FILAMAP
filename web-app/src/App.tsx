import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { useNfc } from "./hooks/useNfc";

interface Printer {
  id: string;
  serial: string;
  model: string;
  ip_address: string;
  is_online: boolean;
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

  // Histórico de Impressões
  const [printLogs, setPrintLogs] = useState<PrintLog[]>([]);

  // Estoque
  const [inventory, setInventory] = useState<Spool[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("TODOS");

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Form Criador
  const [selectedBrand, setSelectedBrand] = useState("Voolt3D");
  const [customBrandName, setCustomBrandName] = useState("");
  const [material, setMaterial] = useState("PETG");
  const [colorName, setColorName] = useState("Preto");
  const [colorHex, setColorHex] = useState("#111827");
  const [rgb, setRgb] = useState({ r: 17, g: 24, b: 39 });
  const [grossWeight, setGrossWeight] = useState("1220");
  const [tareWeight, setTareWeight] = useState("220");
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
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  async function handleInstallApp() {
    if (!deferredPrompt) {
      alert("Para instalar: toque nos 3 pontinhos do Chrome e selecione 'Adicionar à tela inicial'.");
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  useEffect(() => {
    generateNewTagCode("PETG");
  }, []);

  function generateNewTagCode(mat: string) {
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    setCustomTagId(`FILA-${mat}-${randomCode}`);
  }

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
    // 1. Impressora e Slots
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

    // 2. Almoxarifado
    const { data: invData } = await supabase.from("spools").select("*").order("created_at", { ascending: false });
    if (invData) setInventory(invData);

    // 3. Histórico de Impressões
    const { data: logsData } = await supabase
      .from("print_logs")
      .select("*, spool:spools(*)")
      .order("completed_at", { ascending: false })
      .limit(6);
    if (logsData) setPrintLogs(logsData);
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, []);

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

  async function handleCreateAndWriteTag(e: React.FormEvent) {
    e.preventDefault();
    setFeedbackMsg(null);

    const finalBrand = selectedBrand === "Outra..." ? (customBrandName.trim() || "Outra") : selectedBrand;
    const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));
    const finalTagId = customTagId.trim() || `FILA-${Date.now()}`;
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
      },
      { onConflict: "nfc_uid" }
    );

    if (dbError) {
      setFeedbackMsg("Erro no banco: " + dbError.message);
    } else if (wrote) {
      setFeedbackMsg(`✅ Tag gravada com sucesso! Link: ${fullTargetUrl}`);
      generateNewTagCode(material);
      if (selectedBrand === "Outra...") setCustomBrandName("");
    } else {
      setFeedbackMsg(`ℹ️ Carretel salvo no banco de dados. Link: ${fullTargetUrl}`);
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

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px", minHeight: "100vh", boxSizing: "border-box" }}>
      {/* Barra de Topo */}
      <header style={{ borderBottom: "1px solid #334155", paddingBottom: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🧵</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: "#38bdf8", fontWeight: 900, letterSpacing: "-0.02em" }}>FILAMAP</h1>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 11 }}>Gestão de Carretéis e AMS</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 700,
                background: printers[0]?.is_online ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                color: printers[0]?.is_online ? "#34d399" : "#f87171",
                border: `1px solid ${printers[0]?.is_online ? "#059669" : "#dc2626"}`,
              }}
            >
              {printers[0]?.is_online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* 3 Abas Principais */}
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
            🏷️ Criar Tag
          </button>
        </div>
      </header>

      {/* ABA 1: MONITOR AMS + HISTÓRICO DE IMPRESSÕES */}
      {activeTab === "ams" && (
        <div>
          {/* Slots AMS Lite */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, marginBottom: 16, border: "1px solid #334155" }}>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 16, color: "#f8fafc" }}>
                {printers[0]?.model ? `Bambu Lab ${printers[0].model}` : "Bambu Lab A1"}
              </strong>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                SN: {printers[0]?.serial || "--"} • IP: {printers[0]?.ip_address || "--"}
              </div>
            </div>

            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: 10, fontWeight: 700 }}>
              Bandejas do AMS Lite
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {[0, 1, 2, 3].map((slotIdx) => {
                const spool = activeSlots[slotIdx];
                const isTarget = nfcUid !== null;

                return (
                  <div
                    key={slotIdx}
                    onClick={() => isTarget && handleAssignSlot(slotIdx)}
                    style={{
                      background: isTarget ? "#172554" : "#0f172a",
                      borderRadius: 8,
                      padding: 12,
                      border: isTarget ? "2px dashed #38bdf8" : "1px solid #334155",
                      cursor: isTarget ? "pointer" : "default",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      minHeight: 130,
                      boxSizing: "border-box",
                    }}
                  >
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

          {/* Histórico Recente de Impressões */}
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
                {printLogs.map((log) => (
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
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#f87171" }}>
                        -{log.filament_used_g}g
                      </span>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        {log.print_duration_minutes ? `${log.print_duration_minutes} min` : "Finalizado"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Leitor Rápido NFC */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 6px", color: "#f8fafc" }}>Leitura de Tag no Carretel</h3>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 12px" }}>
              Aproxime o celular do clipe NFC para carregar o filamento em um dos slots.
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

      {/* ABA 2: ALMOXARIFADO */}
      {activeTab === "inventory" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 17, color: "#f8fafc", margin: 0 }}>Estoque de Carretéis</h2>
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "2px 0 0" }}>Todos os rolos cadastrados com clipe NFC</p>
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
                <option value="TODOS">Todos</option>
                <option value="PETG">PETG</option>
                <option value="PLA">PLA</option>
                <option value="ABS">ABS</option>
                <option value="TPU">TPU</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredInventory.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "#64748b", fontSize: 13 }}>
                Nenhum carretel encontrado no estoque.
              </div>
            ) : (
              filteredInventory.map((spool) => {
                const isLow = spool.current_weight < 150;
                return (
                  <div
                    key={spool.id}
                    style={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          backgroundColor: spool.color_hex,
                          border: "2px solid #475569",
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <strong style={{ fontSize: 14, color: "#f8fafc" }}>{spool.material}</strong>
                          <span style={{ fontSize: 12, color: "#cbd5e1" }}>- {spool.color_name}</span>
                          {isLow && (
                            <span style={{ fontSize: 10, background: "#ef4444", color: "#fff", padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>
                              FIM DE ROLO
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                          Marca: {spool.brand} • Tag: <span style={{ color: "#38bdf8" }}>{spool.nfc_uid}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: isLow ? "#ef4444" : "#38bdf8" }}>
                        {spool.current_weight}g
                      </div>
                      <button
                        onClick={() => {
                          setNfcUid(spool.nfc_uid);
                          setActiveTab("ams");
                        }}
                        style={{
                          marginTop: 4,
                          background: "#0284c7",
                          color: "#fff",
                          border: "none",
                          padding: "4px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        👉 Alocar no AMS
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ABA 3: CRIADOR DE TAGS */}
      {activeTab === "writer" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <h2 style={{ fontSize: 17, color: "#f8fafc", margin: "0 0 4px" }}>Gravar Nova Tag NFC</h2>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 14px" }}>
            Cadastre o carretel com cor exata e grave no chip adesivo do clipe 3D.
          </p>

          <form onSubmit={handleCreateAndWriteTag} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>CÓDIGO ÚNICO DA TAG</label>
                <button
                  type="button"
                  onClick={() => generateNewTagCode(material)}
                  style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: 11 }}
                >
                  🔄 Gerar outro
                </button>
              </div>
              <input
                type="text"
                value={customTagId}
                onChange={(e) => setCustomTagId(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", background: "#1e293b", border: "1px solid #475569", borderRadius: 6, color: "#38bdf8", fontWeight: 700, fontSize: 14, boxSizing: "border-box" }}
                required
              />
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, wordBreak: "break-all" }}>
                Link: https://filamap.pages.dev/?tag={customTagId}
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

            {/* Material */}
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Material</label>
              <select
                value={material}
                onChange={(e) => {
                  setMaterial(e.target.value);
                  generateNewTagCode(e.target.value);
                }}
                style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }}
              >
                <option value="PETG">PETG</option>
                <option value="PLA">PLA</option>
                <option value="ABS">ABS</option>
                <option value="TPU">TPU</option>
              </select>
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
                onChange={(e) => setColorName(e.target.value)}
                placeholder="Nome da cor..."
                style={{ width: "100%", padding: "8px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                required
              />
            </div>

            {/* Pesagem */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "#0f172a", padding: 10, borderRadius: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Peso Balança (g)</label>
                <input
                  type="number"
                  value={grossWeight}
                  onChange={(e) => setGrossWeight(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Tara Vazio (g)</label>
                <input
                  type="number"
                  value={tareWeight}
                  onChange={(e) => setTareWeight(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>
              <div style={{ gridColumn: "span 2", textAlign: "right", fontSize: 12, color: "#38bdf8", fontWeight: 700 }}>
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
    </div>
  );
}