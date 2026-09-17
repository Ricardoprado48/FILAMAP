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

export default function App() {
  const [activeTab, setActiveTab] = useState<"ams" | "writer">("ams");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activeSlots, setActiveSlots] = useState<Record<number, Spool | null>>({
    0: null, 1: null, 2: null, 3: null
  });

  // PWA Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // Formulário do Criador de Tags
  const [selectedBrand, setSelectedBrand] = useState("Voolt3D");
  const [customBrandName, setCustomBrandName] = useState("");
  const [material, setMaterial] = useState("PETG");
  const [colorName, setColorName] = useState("Preto");
  const [colorHex, setColorHex] = useState("#111827");
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

  // Escuta o evento nativo de instalação
  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  async function handleInstallApp() {
    if (!deferredPrompt) {
      alert("Para instalar: toque nos 3 pontinhos do Chrome (canto superior direito) e selecione 'Adicionar à tela inicial' ou 'Instalar aplicativo'.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstallBanner(false);
    }
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
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, []);

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
  }

  const colorPresets = [
    { name: "Preto", hex: "#111827" },
    { name: "Branco", hex: "#FFFFFF" },
    { name: "Cinza", hex: "#64748B" },
    { name: "Laranja", hex: "#F97316" },
    { name: "Azul", hex: "#2563EB" },
    { name: "Vermelho", hex: "#DC2626" },
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px", minHeight: "100vh", boxSizing: "border-box" }}>
      {/* Topo */}
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
                display: "flex",
                alignItems: "center",
                gap: 4,
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
            🏷️ Criador de Tags
          </button>
        </div>
      </header>

      {/* ABA 1: MONITOR AMS */}
      {activeTab === "ams" && (
        <div>
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
                      minHeight: 120,
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
                      <div style={{ marginTop: 8, borderTop: "1px solid #1e293b", paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ color: "#94a3b8" }}>Saldo:</span>
                        <strong style={{ color: "#38bdf8" }}>{spool.current_weight}g</strong>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 6px", color: "#f8fafc" }}>Leitura de Tag no Carretel</h3>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 12px" }}>
              Aproxime o celular do clipe NFC para apontar qual filamento você está colocando no AMS.
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

      {/* ABA 2: CRIADOR E GRAVADOR DE TAGS */}
      {activeTab === "writer" && (
        <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
          <h2 style={{ fontSize: 17, color: "#f8fafc", margin: "0 0 4px" }}>Gravar Nova Tag NFC</h2>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 14px" }}>
            Cadastre o carretel e encoste o adesivo NFC para gravar o link permanente.
          </p>

          <form onSubmit={handleCreateAndWriteTag} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

            {/* Menu de Marcas Ampliado */}
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

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 6 }}>Cor do Filamento</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                {colorPresets.map((c) => (
                  <button
                    type="button"
                    key={c.hex}
                    onClick={() => { setColorHex(c.hex); setColorName(c.name); }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      backgroundColor: c.hex,
                      border: colorHex === c.hex ? "2px solid #38bdf8" : "1px solid #475569",
                      cursor: "pointer",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  style={{ width: 32, height: 32, border: "none", background: "transparent", cursor: "pointer" }}
                />
              </div>
              <input
                type="text"
                value={colorName}
                onChange={(e) => setColorName(e.target.value)}
                placeholder="Ex: Preto Fosco"
                style={{ width: "100%", padding: "8px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                required
              />
            </div>

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