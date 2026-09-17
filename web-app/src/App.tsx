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
    0: null,
    1: null,
    2: null,
    3: null,
  });
  const [loading, setLoading] = useState(true);

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
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Feedback háptico no celular ao detectar tag
  useEffect(() => {
    if (nfcUid && "vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  }, [nfcUid]);

  async function handleAssignToSlot(slotIndex: number) {
    if (!nfcUid || printers.length === 0) return;
    const printerId = printers[0].id;

    let { data: spool } = await supabase
      .from("spools")
      .select("*")
      .eq("nfc_uid", nfcUid)
      .single();

    if (!spool) {
      const demoPalettes = [
        { name: "Branco Neve", hex: "#FFFFFF", mat: "PETG" },
        { name: "Preto Matte", hex: "#161616", mat: "PLA" },
        { name: "Laranja", hex: "#FF6B00", mat: "PETG" },
        { name: "Azul Cobalto", hex: "#0088FF", mat: "PLA" },
      ];
      const selected = demoPalettes[slotIndex % demoPalettes.length];

      const { data: newSpool } = await supabase
        .from("spools")
        .insert({
          nfc_uid: nfcUid,
          brand: "Filamap",
          material: selected.mat,
          color_name: selected.name,
          color_hex: selected.hex,
          initial_weight: 1000,
          current_weight: 920,
        })
        .select()
        .single();

      spool = newSpool;
    }

    if (spool) {
      await supabase.from("ams_slots").upsert(
        {
          printer_id: printerId,
          slot_index: slotIndex,
          spool_id: spool.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "printer_id,slot_index" }
      );

      setNfcUid(null);
      await loadData();
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px", minHeight: "100vh", boxSizing: "border-box" }}>
      {/* Cabeçalho */}
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

      {/* Card da Máquina */}
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

        {/* Grade responsiva: 2 colunas no celular, 4 no desktop */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {[0, 1, 2, 3].map((slotIdx) => {
            const spool = activeSlots[slotIdx];
            const isTarget = nfcUid !== null;

            return (
              <div
                key={slotIdx}
                onClick={() => isTarget && handleAssignToSlot(slotIdx)}
                style={{
                  background: isTarget ? "#172554" : "#0f172a",
                  borderRadius: 8,
                  padding: 14,
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
        <h3 style={{ fontSize: 16, margin: "0 0 6px", color: "#f8fafc" }}>Vincular Carretel (NFC)</h3>
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 14px" }}>
          Aproxime o celular do clipe do carretel ou use o botão de simulação no desktop.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Botão para Celular */}
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
            {isReading ? "📡 Aproxime do clipe..." : "📱 Ler NFC (Celular)"}
          </button>

          {/* Botão para Desktop */}
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
            💻 Simular (Desktop)
          </button>
        </div>

        {nfcUid && (
          <div style={{ marginTop: 14, padding: 12, background: "#1e3a8a", border: "1px solid #3b82f6", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 11, color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>Tag Detectada</span>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#ffffff" }}>{nfcUid}</div>
              <div style={{ fontSize: 11, color: "#bfdbfe", marginTop: 2 }}>Toque em um dos slots do AMS acima para fixar.</div>
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
  );
}