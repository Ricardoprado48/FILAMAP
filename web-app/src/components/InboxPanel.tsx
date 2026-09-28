import { useState } from "react";
import type { FilamentProduct, Spool, SpoolInboxItem, UserFilamentProfile } from "../types";
import { describeInboxItem, profilesWithoutProduct } from "../utils/products";
import { canLinkInboxItem } from "../services/inboxService";

// Caixa de entrada: evidências (nuvem Bambu, RFID, tag NFC desconhecida,
// preset renomeado) que só viram vínculo ou carretel por decisão do usuário.

const btn = { padding: "6px 10px", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" } as const;
const selectStyle = { flex: 1, minWidth: 0, padding: 6, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 } as const;

function InboxItemCard({
  item,
  inventory,
  profiles,
  products,
  spoolTitle,
  busy,
  onLink,
  onCreate,
  onIgnore,
  onRename,
}: {
  item: SpoolInboxItem;
  inventory: Spool[];
  profiles: UserFilamentProfile[];
  products: FilamentProduct[];
  spoolTitle: (s: Spool) => string;
  busy: boolean;
  onLink: (item: SpoolInboxItem, spool: Spool) => void;
  onCreate: (item: SpoolInboxItem) => void;
  onIgnore: (item: SpoolInboxItem) => void;
  onRename: (item: SpoolInboxItem, profile: UserFilamentProfile) => void;
}) {
  const text = describeInboxItem(item);
  const suggested = item.suggested_spool_id ? inventory.find((s) => s.id === item.suggested_spool_id) : undefined;
  const [spoolId, setSpoolId] = useState("");
  const [profileId, setProfileId] = useState("");
  const chosenSpool = inventory.find((s) => s.id === spoolId);
  const renameOptions = item.source === "preset_renamed" ? profilesWithoutProduct(profiles, products) : [];
  const chosenProfile = renameOptions.find((p) => p.id === profileId);
  const product = item.suggested_product_id ? products.find((p) => p.id === item.suggested_product_id) : undefined;
  const sortedInventory = [...inventory].sort((a, b) => spoolTitle(a).replace(/^[+-]\s*/, "").localeCompare(spoolTitle(b).replace(/^[+-]\s*/, ""), "pt-BR"));

  return (
    <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {item.source === "bambu_cloud" && typeof item.payload?.color === "string" && (
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: item.payload.color, border: "1px solid rgba(255,255,255,0.25)", flexShrink: 0 }} />
          )}
          <strong style={{ fontSize: 13, color: "#f8fafc" }}>{text.title}</strong>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{text.subtitle}</div>
        {product && <div style={{ fontSize: 11, color: "#38bdf8", marginTop: 2 }}>Produto: {product.name}</div>}
      </div>

      {canLinkInboxItem(item) && (
        <>
          {suggested && (
            <button type="button" disabled={busy} onClick={() => onLink(item, suggested)} style={{ ...btn, background: "#0284c7", color: "#fff", textAlign: "left" }}>
              🔗 Ligar ao sugerido: {spoolTitle(suggested)}
            </button>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <select value={spoolId} onChange={(e) => setSpoolId(e.target.value)} style={selectStyle}>
              <option value="">{suggested ? "Ou escolha outro carretel..." : "Escolha o carretel do estoque..."}</option>
              {sortedInventory.map((s) => (
                <option key={s.id} value={s.id}>
                  {spoolTitle(s)} • {Math.round(Number(s.current_weight) || 0)}g{s.location ? ` • ${s.location}` : ""}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !chosenSpool} onClick={() => chosenSpool && onLink(item, chosenSpool)} style={{ ...btn, background: chosenSpool ? "#0284c7" : "#334155", color: "#fff" }}>
              Ligar
            </button>
          </div>
        </>
      )}

      {item.source === "preset_renamed" && (
        <div style={{ display: "flex", gap: 6 }}>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={selectStyle}>
            <option value="">Qual perfil novo é este produto?</option>
            {renameOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !chosenProfile} onClick={() => chosenProfile && onRename(item, chosenProfile)} style={{ ...btn, background: chosenProfile ? "#0284c7" : "#334155", color: "#fff" }}>
            Confirmar
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {canLinkInboxItem(item) && (
          <button type="button" disabled={busy} onClick={() => onCreate(item)} style={{ ...btn, background: "#059669", color: "#fff" }}>
            ➕ É um carretel novo
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onIgnore(item)} style={{ ...btn, background: "#334155", color: "#cbd5e1" }}>
          Ignorar
        </button>
      </div>
    </div>
  );
}

export function InboxPanel(props: {
  items: SpoolInboxItem[];
  inventory: Spool[];
  profiles: UserFilamentProfile[];
  products: FilamentProduct[];
  spoolTitle: (s: Spool) => string;
  busy: boolean;
  onLink: (item: SpoolInboxItem, spool: Spool) => void;
  onCreate: (item: SpoolInboxItem) => void;
  onIgnore: (item: SpoolInboxItem) => void;
  onRename: (item: SpoolInboxItem, profile: UserFilamentProfile) => void;
  onClose: () => void;
}) {
  const { items, onClose, ...cardProps } = props;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Caixa de entrada"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: "#fff", fontSize: 16 }}>📥 Caixa de entrada ({items.length})</h3>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: 12 }}>
          Coisas que o Filamap viu mas não sabe de qual carretel são. Nada aqui muda o estoque sozinho: você decide.
        </p>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "#64748b", fontSize: 12 }}>Nada pendente. ✅</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item) => (
              <InboxItemCard key={item.id} item={item} {...cardProps} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
