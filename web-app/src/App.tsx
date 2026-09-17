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

export default function App() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activeSlots, setActiveSlots] = useState<Record<number, Spool | null>>({
    0: null, 1: null, 2: null, 3: null
  });
  
  // Modal de cadastro
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [formBrand, setFormBrand] = useState("Voolt3D");
  const [formMaterial, setFormMaterial] = useState("PETG");
  const [formColorName, setFormColorName] = useState("Preto");
  const [formColorHex, setFormColorHex] = useState("#111827");
  const [formTotalWeight, setFormTotalWeight] = useState("1200");
  const [formTareWeight, setFormTareWeight] = useState("220");

  const { isReading, nfcUid, error: nfcError, startScanning, setNfcUid } = useNfc();

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

  useEffect(() => {
    if (nfcUid && "vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  }, [nfcUid]);

  // Ao clicar em um slot com a tag identificada
  async function handleSlotClick(slotIndex: number) {
    if (!nfcUid) return;

    // Checa se o carretel já existe no banco
    const { data: existingSpool } = await supabase
      .from("spools")
      .select("*")
      .eq("nfc_uid", nfcUid)
      .single();

    if (existingSpool) {
      // Já cadastrado: vincula direto ao slot
      await assignSpoolToSlot(existingSpool.id, slotIndex);
    } else {
      // Novo carretel: abre o modal para configurar dados reais
      setTargetSlot(slotIndex);
      setIsModalOpen(true);
    }
  }

  async function assignSpoolToSlot(spoolId: string, slotIndex: number) {
    if (printers.length === 0) return;
    await supabase.from("ams_slots").upsert(
      {
        printer_id: printers[0].id,
        slot_index: slotIndex,
        spool_id: spoolId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "printer_id,slot_index" }
    );
    setNfcUid(null);
    setIsModalOpen(false);
    await loadData();
  }

  async function handleSaveNewSpool(e: React.FormEvent) {
    e.preventDefault();
    if (!nfcUid || targetSlot === null) return;

    const total = parseFloat(formTotalWeight) || 1000;
    const tare = parseFloat(formTareWeight) || 0;
    const netWeight = Math.max(0, total - tare);

    const { data: newSpool, error } = await supabase
      .from("spools")
      .insert({
        nfc_uid: nfcUid,
        brand: formBrand,
        material: formMaterial,
        color_name: formColorName,
        color_hex: formColorHex,
        initial_weight: netWeight,
        current_weight: netWeight,
      })
      .select()
      .single();

    if (!error && newSpool) {
      await assignSpoolToSlot(newSpool.id, targetSlot);
    }
  }

  const colorPresets = [
    { name: "Preto", hex: "#111827" },
    { name: "Branco", hex: "#F9FAFB" },
    { name: "Cinza", hex: "#6B7280" },
    { name: "Laranja", hex: "#F97316" },
    { name: "Azul", hex: "#2563EB" },
    { name: "Vermelho", hex: "#DC2626" },
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px", minHeight: "100vh", boxSizing: "border-box" }}>
      {/* Topo */}
      <header style={{ borderBottom: "1px solid #334155", paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, color: "#38bdf8", fontWeight: 900, letterSpacing: "-0.02em" }}>FILAMAP</h1>
            <p style={{ margin: "2px 0 0", color: "#94a3b8", fontSize: 13 }}>
              Controle de Carretéis & AMS Bambu Lab
            </p>
          </div>
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
      </header>

      {/* Card da Impressora */}
      <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, marginBottom: 20, border: "1px solid #334155" }}>
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 17, color: "#f8fafc" }}>
            {printers[0]?.model ? `Bambu Lab ${printers[0].model}` : "Bambu Lab A1"}
          </strong>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            SN: {printers[0]?.serial || "--"} • IP: {printers[0]?.ip_address || "--"}
          </div>
        </div>

        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: 10, fontWeight: 700 }}>
          Slots do AMS Lite
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {[0, 1, 2, 3].map((slotIdx) => {
            const spool = activeSlots[slotIdx];
            const isTarget = nfcUid !== null;

            return (
              <div
                key={slotIdx}
                onClick={() => isTarget && handleSlotClick(slotIdx)}
                style={{
                  background: isTarget ? "#172554" : "#0f172a",
                  borderRadius: 8,
                  padding: 14,
                  border: isTarget ? "2px dashed #38bdf8" : "1px solid #334155",
                  cursor: isTarget ? "pointer" : "default",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: 125,
                  boxSizing: "border-box",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>SLOT {slotIdx + 1}</span>
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
                      {isTarget ? "👉 Encaixar aqui" : "Vazio"}
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

      {/* Ações de Leitura NFC */}
      <div style={{ background: "#1e293b", padding: 18, borderRadius: 12, border: "1px solid #334155" }}>
        <h3 style={{ fontSize: 16, margin: "0 0 6px", color: "#f8fafc" }}>Leitura de Carretel (NFC)</h3>
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 14px" }}>
          Aproxime o celular do clipe ou use a simulação no desktop.
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
            {isReading ? "📡 Aproxime da Tag..." : "📱 Ler NFC (Celular)"}
          </button>

          <button
            onClick={() => setNfcUid(`NFC_${Math.floor(Math.random() * 89999 + 10000)}`)}
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
              <span style={{ fontSize: 11, color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>Tag Detectada</span>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#ffffff" }}>{nfcUid}</div>
              <div style={{ fontSize: 11, color: "#bfdbfe", marginTop: 2 }}>Toque no slot do AMS para encaixar.</div>
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

      {/* Modal de Cadastro de Novo Carretel */}
      {isModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 999 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, color: "#f8fafc" }}>Cadastrar Novo Carretel</h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#94a3b8" }}>Tag: <strong style={{ color: "#38bdf8" }}>{nfcUid}</strong> | Vinculando ao Slot {(targetSlot ?? 0) + 1}</p>

            <form onSubmit={handleSaveNewSpool} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Marca</label>
                <input
                  type="text"
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  required
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Material</label>
                  <select
                    value={formMaterial}
                    onChange={(e) => setFormMaterial(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  >
                    <option value="PETG">PETG</option>
                    <option value="PLA">PLA</option>
                    <option value="ABS">ABS</option>
                    <option value="TPU">TPU</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Nome da Cor</label>
                  <input
                    type="text"
                    value={formColorName}
                    onChange={(e) => setFormColorName(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 6 }}>Tom da Cor</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {colorPresets.map((c) => (
                    <button
                      type="button"
                      key={c.hex}
                      onClick={() => { setFormColorHex(c.hex); setFormColorName(c.name); }}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        backgroundColor: c.hex,
                        border: formColorHex === c.hex ? "2px solid #38bdf8" : "1px solid #475569",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={formColorHex}
                    onChange={(e) => setFormColorHex(e.target.value)}
                    style={{ width: 32, height: 32, border: "none", background: "transparent", cursor: "pointer" }}
                  />
                </div>
              </div>

              {/* Cálculo Tara vs Bruto */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "#0f172a", padding: 12, borderRadius: 8 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Peso na Balança (g)</label>
                  <input
                    type="number"
                    value={formTotalWeight}
                    onChange={(e) => setFormTotalWeight(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Tara Carretel Vazio (g)</label>
                  <input
                    type="number"
                    value={formTareWeight}
                    onChange={(e) => setFormTareWeight(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ gridColumn: "span 2", textAlign: "right", fontSize: 12, color: "#38bdf8", fontWeight: 700 }}>
                  Filamento Líquido Estimado: {Math.max(0, (parseFloat(formTotalWeight) || 0) - (parseFloat(formTareWeight) || 0))}g
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: "10px", background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
                >
                  Salvar Carretel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}