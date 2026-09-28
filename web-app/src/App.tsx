import React, { useEffect, useRef, useState } from "react";
import { Nfc } from "lucide-react";
import { supabase } from "./lib/supabase";
import { useNfc } from "./hooks/useNfc";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { FilamapLogo, FilamapIcon } from "./components/Brand";

import type { Printer, Spool, CatalogItem, PrintLog, UserFilamentProfile, FilamentProduct, SpoolInboxItem } from "./types";
import {
  getAgentStatus,
  getPrinterStatus,
  formatPrinterOperationalState,
  isPrinterLivePrinting,
  getAgentBadgeProps,
  getPrinterBadgeProps,
} from "./utils/status";
import { groupPrintLogsByJob, formatGramsDisplay } from "./utils/history";
import { generateAutoTagId } from "./utils/nfc";
import { filterInventory, groupInventoryByMaterial, getSpoolDisplayName, getSpoolSwatchColor, getSpoolBrandDisplay, getInPrinterCountDisplay, formatActiveSlotDisplay } from "./utils/inventory";
import { getPendingWeighingLogs, getWriterSpool, getActivePrinter } from "./utils/selectors";
import {
  needsWeighing,
  formatBambuLocation,
  sortSpoolsForSpoolScreen,
  buildWeighUpdate,
  suggestInitialWeightFromBambu,
  findConflictingSpool,
  buildNfcLinkUpdate,
  validateSpotAssignment,
  buildLocationUpdate,
  buildUnlinkNfcUpdate,
  parseProfileToSpoolForm,
} from "./utils/spoolStatus";
import {
  fetchPrinters,
  fetchActiveSlots,
  fetchInventory,
  fetchCatalog,
  fetchPrintLogs,
  fetchUserFilamentProfiles,
} from "./services/dataService";
import {
  createCatalogItem,
  deleteCatalogItem,
} from "./services/catalogService";
import {
  updateSpoolWeight,
  linkSpoolNfc,
  unlinkSpoolNfc,
  updateSpoolLocation,
  createSpool,
  assignSpoolToSlot,
  archiveSpool,
} from "./services/spoolService";
import { fetchProducts, createProduct, createProductFromProfile, updateProductBrand } from "./services/productService";
import {
  fetchPendingInbox,
  fetchIgnoredInbox,
  reopenInboxItem,
  queueUnknownNfcTag,
  resolveInboxItem,
  linkInboxItemToSpool,
  applyPresetRename,
} from "./services/inboxService";
import { SlotSpoolPicker } from "./components/SlotSpoolPicker";
import { InboxPanel } from "./components/InboxPanel";
import { resolveSpoolTitle, identityFromProduct, profilesWithoutProduct, parseGrams, parseOptionalPrice } from "./utils/products";
export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"ams" | "inventory" | "calc" | "writer">("ams");
  // Slot do AMS com a lista "escolher do estoque" aberta (sem tag NFC).
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [savingSlotPick, setSavingSlotPick] = useState(false);
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
  const [modalInitialWeight, setModalInitialWeight] = useState("");

  // Vínculo de NFC a um carretel já existente (lê a tag física e associa,
  // sem gravar nada nela -- diferente da aba "Gravar Tag", que grava uma
  // URL nova no chip).
  const [linkingSpoolId, setLinkingSpoolId] = useState<string | null>(null);
  const linkScanTimeoutRef = useRef<number | null>(null);


  const [editingSpool, setEditingSpool] = useState<Spool | null>(null);
  const [editProductId, setEditProductId] = useState("");
  const [editProductBrand, setEditProductBrand] = useState("");
  const [editColorHex, setEditColorHex] = useState("#111827");
  const [editTare, setEditTare] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editLocation, setEditLocation] = useState("");

  // Fase I: Perfis de fatiador e Cadastro Assistido de Novo Carretel
  const [filamentProfiles, setFilamentProfiles] = useState<UserFilamentProfile[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Identidade do carretel novo: "product:<id>" (produto existente),
  // "profile:<id>" (cria o produto a partir do perfil do Bambu Studio) ou
  // "manual" (produto novo digitado). Sem produto não há carretel (R5).
  const [createProductChoice, setCreateProductChoice] = useState("");
  const [createBrand, setCreateBrand] = useState("");
  const [createMaterial, setCreateMaterial] = useState("PLA");
  const [createColorName, setCreateColorName] = useState("");
  const [createColorHex, setCreateColorHex] = useState("#FFFFFF");
  const [createTare, setCreateTare] = useState("");
  const [createWeight, setCreateWeight] = useState("");
  const [createPrice, setCreatePrice] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createNfcUid, setCreateNfcUid] = useState("");
  // Item da caixa de entrada que originou este "Novo Carretel" (se houver).
  const [createFromInbox, setCreateFromInbox] = useState<SpoolInboxItem | null>(null);

  // Produtos de filamento e caixa de entrada (F7)
  const [products, setProducts] = useState<FilamentProduct[]>([]);
  const [inboxItems, setInboxItems] = useState<SpoolInboxItem[]>([]);
  const [ignoredInboxItems, setIgnoredInboxItems] = useState<SpoolInboxItem[]>([]);
  const { canInstall, install } = useInstallPrompt();
  // Histórico de impressões recolhível; lembra a escolha neste aparelho.
  const [historyOpen, setHistoryOpen] = useState(() => {
    try {
      return localStorage.getItem("filamap_history_open") === "1";
    } catch {
      return false;
    }
  });
  function toggleHistory() {
    setHistoryOpen((open) => {
      try {
        localStorage.setItem("filamap_history_open", open ? "0" : "1");
      } catch {
        // sem armazenamento local: só não lembra a escolha
      }
      return !open;
    });
  }
  const [showInbox, setShowInbox] = useState(false);
  const [inboxBusy, setInboxBusy] = useState(false);

  // Gravação de Tags (vinculada a um carretel já cadastrado no estoque)
  const [writerSpoolId, setWriterSpoolId] = useState("");
  const [grossWeight, setGrossWeight] = useState("");
  const [tareWeight, setTareWeight] = useState("");
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
    // scope "local": o padrão "global" revogaria também a sessão do Desktop
    // Agent (mesma conta) e o deixaria offline (incidente 2026-09-27).
    await supabase.auth.signOut({ scope: "local" });
  }

  const { isReading, isWriting, nfcUid, error: nfcError, writeTagUrl, startScanning, setNfcUid, setError: setNfcErrorState } = useNfc();

  // Leitura de NFC para associar carretel a um slot do AMS
  const [scanningSlot, setScanningSlot] = useState<number | null>(null);
  const scanTimeoutRef = useRef<number | null>(null);

  async function loadData() {
    if (!session) return;

    const pData = await fetchPrinters();

    if (pData && pData.length > 0) {
      setPrinters(pData);

      const slotsMap =
        await fetchActiveSlots(pData[0].id);

      if (slotsMap) {
        setActiveSlots(slotsMap);
      }
    }

    const invData = await fetchInventory();
    if (invData) {
      setInventory(invData);
    }

    const catData = await fetchCatalog();
    if (catData) {
      setCatalog(catData);
    }

    const logsData = await fetchPrintLogs();
    if (logsData) {
      setPrintLogs(logsData);
    }

    const profsData = await fetchUserFilamentProfiles();
    if (profsData) {
      setFilamentProfiles(profsData);
    }

    setProducts(await fetchProducts());
    setInboxItems(await fetchPendingInbox());
    setIgnoredInboxItems(await fetchIgnoredInbox());
  }
  useEffect(() => {
    if (session) {
      loadData();
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
    }
  }, [session]);

  useEffect(() => {
    if (!feedbackMsg) return;
    const timer = setTimeout(() => setFeedbackMsg(null), 5000);
    return () => clearTimeout(timer);
  }, [feedbackMsg]);


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

    const { error } = await createCatalogItem({
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
    await deleteCatalogItem(id);
    await loadData();
  }

  function clearScanTimeout() {
    if (scanTimeoutRef.current) {
      window.clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  }

  async function handleScanSlot(slotIdx: number) {
    clearScanTimeout();
    clearLinkScanTimeout();
    setLinkingSpoolId(null);
    setNfcUid(null);
    setNfcErrorState(null);
    setScanningSlot(slotIdx);
    scanTimeoutRef.current = window.setTimeout(() => {
      setScanningSlot((curr) => (curr === slotIdx ? null : curr));
      setNfcErrorState("Tempo esgotado aguardando a tag. Aproxime o celular do carretel e tente novamente.");
    }, 20000);
    await startScanning();
  }

  function handleCancelScan() {
    clearScanTimeout();
    setScanningSlot(null);
    setNfcUid(null);
  }

  // Assim que uma tag física é lida enquanto um slot aguarda leitura, associa (ou
  // auto-cria + associa) o carretel correspondente àquele slot.
  useEffect(() => {
    if (scanningSlot !== null && nfcUid) {
      clearScanTimeout();
      const slotIdx = scanningSlot;
      setScanningSlot(null);
      handleAssignSlot(slotIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfcUid]);

  // Erro de leitura (sem NDEFReader, permissão negada, falha na tag) encerra a espera do slot.
  useEffect(() => {
    if (nfcError && scanningSlot !== null) {
      clearScanTimeout();
      setScanningSlot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfcError]);

  function clearLinkScanTimeout() {
    if (linkScanTimeoutRef.current) {
      window.clearTimeout(linkScanTimeoutRef.current);
      linkScanTimeoutRef.current = null;
    }
  }

  // "Vincular NFC": lê a tag e associa ao spool já existente escolhido pelo
  // usuário. Nunca cria carretel novo -- diferente do fluxo de slot do AMS,
  // que auto-cria um carretel placeholder para tag desconhecida.
  async function handleStartLinkNfc(spoolId: string) {
    clearScanTimeout();
    clearLinkScanTimeout();
    setScanningSlot(null);
    setNfcUid(null);
    setNfcErrorState(null);
    setLinkingSpoolId(spoolId);
    linkScanTimeoutRef.current = window.setTimeout(() => {
      setLinkingSpoolId((curr) => (curr === spoolId ? null : curr));
      setNfcErrorState("Tempo esgotado aguardando a tag. Aproxime o celular do carretel e tente novamente.");
    }, 20000);
    await startScanning();
  }

  function handleCancelLinkNfc() {
    clearLinkScanTimeout();
    setLinkingSpoolId(null);
    setNfcUid(null);
  }

  // Assim que a tag física é lida enquanto um carretel aguarda vínculo,
  // valida duplicidade e grava apenas spools.nfc_uid (regra: uma tag não
  // pode ficar vinculada a dois carretéis; vincular não pode criar spool
  // novo; troca de tag exige confirmação explícita; bambu_* nunca é tocado).
  useEffect(() => {
    if (linkingSpoolId !== null && nfcUid) {
      clearLinkScanTimeout();
      const spoolId = linkingSpoolId;
      const uid = nfcUid;
      setLinkingSpoolId(null);
      setNfcUid(null);
      void handleLinkNfc(spoolId, uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfcUid]);

  useEffect(() => {
    if (nfcError && linkingSpoolId !== null) {
      clearLinkScanTimeout();
      setLinkingSpoolId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfcError]);

  async function handleLinkNfc(spoolId: string, uid: string) {
    const targetSpool = inventory.find((s) => s.id === spoolId);
    if (!targetSpool) return;

    const conflict = findConflictingSpool(inventory, uid, spoolId);
    if (conflict) {
      alert(
        `Esta tag já está vinculada ao carretel "${conflict.color_name}" (${conflict.brand}). ` +
          `Uma tag NFC não pode ficar vinculada a dois carretéis ao mesmo tempo.`
      );
      return;
    }

    if (targetSpool.nfc_uid && targetSpool.nfc_uid !== uid) {
      const confirmed = window.confirm(
        `O carretel "${targetSpool.color_name}" já tem a tag "${targetSpool.nfc_uid}" vinculada. ` +
          `Deseja substituir pela tag recém-lida ("${uid}")?`
      );
      if (!confirmed) return;
    }

    const { data, error } = await linkSpoolNfc(spoolId, buildNfcLinkUpdate(uid));

    if (error) {
      if ((error as any).code === "23505") {
        alert("Esta tag já está vinculada a outro carretel.");
      } else {
        alert("Erro ao vincular tag: " + error.message);
      }
      return;
    }

    if (!data || data.length === 0) {
      alert("Não foi possível vincular: o carretel não foi encontrado ou você não tem permissão para editá-lo.");
      return;
    }

    setFeedbackMsg(`✅ Tag "${uid}" vinculada ao carretel "${targetSpool.color_name}"!`);
    await loadData();
  }

  async function handleAssignSlot(slotIdx: number) {
    if (!nfcUid || printers.length === 0) return;
    const uid = nfcUid;
    const { data: spool } = await supabase
      .from("spools")
      .select("*")
      .eq("nfc_uid", uid)
      .is("archived_at", null)
      .maybeSingle();
    setNfcUid(null);
    if (spool) {
      await assignSpoolToSlot(printers[0].id, slotIdx, spool.id);
      await loadData();
      return;
    }
    // Tag desconhecida (R3/R5): não inventa carretel. Vai para a caixa de
    // entrada, que já abre para o usuário dizer de qual carretel ela é (ou
    // cadastrar um novo); ao resolver, o carretel entra neste slot.
    const { error } = await queueUnknownNfcTag(uid, printers[0].id, slotIdx);
    if (error) {
      alert("Não foi possível registrar a tag desconhecida: " + error.message);
      return;
    }
    await loadData();
    setShowInbox(true);
  }

  // Escolha pela lista do estoque: mesmo efeito da tag NFC, sem precisar dela.
  async function handlePickSpoolForSlot(spool: Spool) {
    if (pickingSlot === null || printers.length === 0) return;
    const slotIdx = pickingSlot;
    setSavingSlotPick(true);
    const { error } = await assignSpoolToSlot(printers[0].id, slotIdx, spool.id);
    setSavingSlotPick(false);
    if (error) {
      alert("Não foi possível colocar o carretel no slot: " + error.message);
      return;
    }
    setPickingSlot(null);
    await loadData();
    setFeedbackMsg(`✅ "${getSpoolDisplayName(spool)}" agora está no slot ${slotIdx + 1}.`);
  }

  async function handleEjectSlot(e: React.MouseEvent, slotIdx: number) {
    e.stopPropagation();
    if (printers.length === 0) return;
    await supabase.from("ams_slots").update({ spool_id: null, updated_at: new Date().toISOString() }).eq("printer_id", printers[0].id).eq("slot_index", slotIdx);
    await loadData();
  }

  function openWeighModal(spool: Spool) {
    setWeighingSpool(spool);
    // Sem tara cadastrada, o campo fica vazio para o usuário informar (sem valor inventado).
    const savedTare = spool.spool_tare_weight != null ? String(spool.spool_tare_weight) : "";
    setModalTare(savedTare);
    setModalGross(savedTare ? (Number(spool.current_weight) + Number(savedTare)).toString() : "");
    // Primeira pesagem real de um carretel vindo da Bambu: current_weight/
    // initial_weight ainda são só o default da coluna, nunca uma medição.
    // Sugere o netWeight nominal da Bambu como ponto de partida do peso
    // inicial -- o usuário confirma ou corrige, nunca é aplicado sozinho.
    if (needsWeighing(spool)) {
      const suggested = suggestInitialWeightFromBambu(spool);
      setModalInitialWeight((suggested ?? spool.initial_weight ?? 1000).toString());
    } else {
      setModalInitialWeight("");
    }
  }

  async function handleSaveWeigh(e: React.FormEvent) {
    e.preventDefault();
    if (!weighingSpool) return;

    const payload = buildWeighUpdate({
      grossWeight: modalGross,
      tareWeight: modalTare,
      initialWeight: needsWeighing(weighingSpool) ? modalInitialWeight : undefined,
    });

    const { data, error } = await updateSpoolWeight(weighingSpool.id, payload);

    if (error) {
      alert("Erro ao salvar pesagem: " + error.message);
      return;
    }
    // RLS pode filtrar a linha do UPDATE (spool de outro usuário) sem
    // retornar erro -- 0 linhas afetadas e o peso digitado nunca é salvo.
    if (!data || data.length === 0) {
      alert("Não foi possível salvar: o carretel não foi encontrado ou você não tem permissão para editá-lo.");
      return;
    }

    setWeighingSpool(null);
    setModalInitialWeight("");
    await loadData();
  }

  function openEditModal(spool: Spool) {
    setEditingSpool(spool);
    const product = spool.filament_product_id ? products.find((p) => p.id === spool.filament_product_id) : undefined;
    setEditProductId(product?.id || "");
    setEditProductBrand(product?.brand || "");
    setEditColorHex(spool.color_hex || product?.color_hex || "#111827");
    setEditTare(spool.spool_tare_weight != null ? String(spool.spool_tare_weight) : "");
    setEditWeight(String(spool.current_weight));
    setEditPrice(spool.price_paid != null ? String(spool.price_paid) : "");
    setEditLocation(spool.location || "");
  }

  // Perfil do Bambu Studio que representa o produto (para manter o vínculo
  // legado filament_profile_id coerente com o produto escolhido).
  function profileIdForProduct(productId: string): string | null {
    const linked = filamentProfiles.filter((p) => p.filament_product_id === productId);
    const preferred =
      linked.find((p) => p.source === "bambu_studio" && p.is_listed !== false) ||
      linked.find((p) => p.source === "bambu_studio") ||
      linked.find((p) => p.source === "bambu_official");
    return preferred?.id ?? null;
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSpool) return;

    const trimmedLoc = editLocation.trim();
    const currentLoc = (editingSpool.location || "").trim();
    if (trimmedLoc && trimmedLoc.toLowerCase() !== currentLoc.toLowerCase()) {
      const spotCheck = validateSpotAssignment(inventory, editingSpool.id, trimmedLoc);
      if (spotCheck.isOccupied && spotCheck.occupyingSpool) {
        const confirmTransfer = window.confirm(
          `O spot "${trimmedLoc}" já está ocupado pelo carretel "${getSpoolDisplayName(spotCheck.occupyingSpool)}".\n` +
          `Deseja transferir este spot para este carretel (liberando o spot do carretel anterior)?`
        );
        if (!confirmTransfer) return;
        await updateSpoolLocation(spotCheck.occupyingSpool.id, null);
      }
    }

    const product = products.find((p) => p.id === editProductId);
    if (!product) {
      alert("Escolha o produto deste carretel.");
      return;
    }
    const tare = parseGrams(editTare);
    const weight = parseGrams(editWeight);
    if (tare === null || weight === null) {
      alert("Informe a tara e o saldo em gramas.");
      return;
    }

    // Marca é do produto (vale para todos os carretéis dele).
    const newBrand = editProductBrand.trim() || null;
    if (newBrand !== (product.brand?.trim() || null)) {
      const { error: brandError } = await updateProductBrand(product.id, newBrand);
      if (brandError) {
        alert("Erro ao salvar a marca do produto: " + brandError.message);
        return;
      }
    }

    const productChanged = product.id !== editingSpool.filament_product_id;
    const updatePayload: Record<string, any> = {
      ...identityFromProduct({ ...product, brand: newBrand }, editColorHex),
      filament_product_id: product.id,
      ...(productChanged ? { filament_profile_id: profileIdForProduct(product.id) } : {}),
      spool_tare_weight: tare,
      current_weight: weight,
      price_paid: parseOptionalPrice(editPrice),
      weight_confirmed_at: new Date().toISOString(),
      location: trimmedLoc || null,
    };

    let { data, error } = await supabase
      .from("spools")
      .update(updatePayload)
      .eq("id", editingSpool.id)
      .select();

    let locationPending = false;
    if (error && (error.code === "PGRST204" || error.message?.includes("'location'"))) {
      delete updatePayload.location;
      const retry = await supabase
        .from("spools")
        .update(updatePayload)
        .eq("id", editingSpool.id)
        .select();
      data = retry.data;
      error = retry.error;
      locationPending = true;
    }

    if (error) {
      alert("Erro ao salvar carretel: " + error.message);
      return;
    }
    // RLS pode filtrar a linha do UPDATE (ex.: registro sem user_id compatível
    // com o usuário logado) sem retornar erro — nesse caso 0 linhas são
    // afetadas e o valor digitado nunca chega a ser persistido.
    if (!data || data.length === 0) {
      alert("Não foi possível salvar: o carretel não foi encontrado ou você não tem permissão para editá-lo neste registro.");
      return;
    }

    if (locationPending) {
      setFeedbackMsg(`⚠️ Dados salvos! Nota: o spot "${editLocation}" aguarda aplicação da migration no banco.`);
    } else {
      setFeedbackMsg(`✅ Carretel "${product.name}" atualizado com sucesso!`);
    }

    setEditingSpool(null);
    await loadData();
  }

  function openCreateModal(fromInbox: SpoolInboxItem | null = null) {
    setCreateFromInbox(fromInbox);
    const suggestedProduct = fromInbox?.suggested_product_id ? products.find((p) => p.id === fromInbox.suggested_product_id) : undefined;
    setCreateProductChoice(suggestedProduct ? `product:${suggestedProduct.id}` : "");
    setCreateBrand(fromInbox?.payload?.suggested_brand || "");
    setCreateMaterial(fromInbox?.payload?.filament_type || "PLA");
    setCreateColorName(fromInbox?.payload?.suggested_color_name || "");
    const payloadColor = typeof fromInbox?.payload?.color === "string" ? fromInbox.payload.color : null;
    setCreateColorHex(payloadColor || suggestedProduct?.color_hex || "#FFFFFF");
    setCreateTare("");
    setCreateWeight("");
    setCreatePrice("");
    setCreateLocation("");
    setCreateNfcUid(fromInbox?.source === "nfc" ? fromInbox.external_id : "");
    setShowCreateModal(true);
  }

  function handleSelectProductChoice(choice: string) {
    setCreateProductChoice(choice);
    if (choice.startsWith("product:")) {
      const product = products.find((p) => `product:${p.id}` === choice);
      if (product?.color_hex) setCreateColorHex(product.color_hex);
    } else if (choice.startsWith("profile:")) {
      const prof = filamentProfiles.find((p) => `profile:${p.id}` === choice);
      if (prof) {
        const parsed = parseProfileToSpoolForm(prof);
        setCreateColorHex(parsed.color_hex);
        // Tara sugerida pelo perfil só preenche se o usuário ainda não digitou.
        setCreateTare((curr) => curr || String(parsed.suggestedTare));
      }
    }
  }

  // Resolve (ou cria) o produto escolhido no Novo Carretel.
  async function resolveCreateProduct(): Promise<{ product: FilamentProduct; profileId: string | null } | null> {
    const choice = createProductChoice;
    if (choice.startsWith("product:")) {
      const product = products.find((p) => `product:${p.id}` === choice);
      return product ? { product, profileId: profileIdForProduct(product.id) } : null;
    }
    if (choice.startsWith("profile:")) {
      const prof = filamentProfiles.find((p) => `profile:${p.id}` === choice);
      if (!prof) return null;
      const { data, error } = await createProductFromProfile(prof, createColorHex);
      if (error || !data) {
        alert("Erro ao criar o produto a partir do perfil: " + (error?.message || "sem retorno"));
        return null;
      }
      return { product: data as FilamentProduct, profileId: prof.id };
    }
    if (choice === "manual") {
      const name = [createMaterial, createColorName.trim(), createBrand.trim()].filter(Boolean).join(" ").toUpperCase();
      const { data, error } = await createProduct({
        name,
        brand: createBrand,
        material: createMaterial,
        color_name: createColorName,
        color_hex: createColorHex,
        origin: "manual",
      });
      if (error || !data) {
        alert("Erro ao criar o produto: " + (error?.message || "sem retorno") + (error?.code === "23505" ? " (já existe um produto com esse nome)" : ""));
        return null;
      }
      return { product: data as FilamentProduct, profileId: null };
    }
    return null;
  }

  async function handleSaveCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createProductChoice) {
      alert("Escolha o produto (filamento) deste carretel.");
      return;
    }
    if (createProductChoice === "manual" && (!createColorName.trim() || !createBrand.trim())) {
      alert("Para um produto novo, informe a marca e a cor.");
      return;
    }
    const weight = parseGrams(createWeight);
    const tare = parseGrams(createTare);
    if (weight === null || tare === null) {
      alert("Informe o saldo líquido e a tara em gramas (confira na balança).");
      return;
    }

    if (createNfcUid.trim()) {
      const conflict = findConflictingSpool(inventory, createNfcUid.trim(), "");
      if (conflict) {
        alert(`A tag NFC "${createNfcUid.trim()}" já está vinculada ao carretel "${getSpoolDisplayName(conflict)}" (${conflict.brand}).`);
        return;
      }
    }

    if (createLocation.trim()) {
      const spotCheck = validateSpotAssignment(inventory, null, createLocation.trim());
      if (spotCheck.isOccupied && spotCheck.occupyingSpool) {
        const confirmTransfer = window.confirm(
          `O spot "${createLocation.trim()}" já está ocupado pelo carretel "${getSpoolDisplayName(spotCheck.occupyingSpool)}".\n` +
          `Deseja transferir este spot para o novo carretel (liberando o spot do carretel anterior)?`
        );
        if (!confirmTransfer) return;
        await updateSpoolLocation(spotCheck.occupyingSpool.id, null);
      }
    }

    const resolved = await resolveCreateProduct();
    if (!resolved) return;
    const { product, profileId } = resolved;
    const fromInbox = createFromInbox;

    const res = await createSpool({
      ...identityFromProduct(product, createColorHex),
      filament_product_id: product.id,
      current_weight: weight,
      spool_tare_weight: tare,
      initial_weight: weight,
      price_paid: parseOptionalPrice(createPrice),
      location: createLocation.trim() || null,
      nfc_uid: createNfcUid.trim() || null,
      filament_profile_id: profileId,
      bambu_spool_id: fromInbox?.source === "bambu_cloud" ? fromInbox.external_id : null,
    });

    if (res.error && !res.locationPendingMigration) {
      alert("Erro ao criar carretel: " + res.error.message);
      await loadData();
      return;
    }

    if (fromInbox && res.data?.id) {
      await resolveInboxItem(fromInbox.id, "created", res.data.id);
      const slotIdx = fromInbox.payload?.slot_index;
      if (typeof slotIdx === "number" && printers.length > 0) {
        await assignSpoolToSlot(printers[0].id, slotIdx, res.data.id);
      }
    }

    if (res.locationPendingMigration) {
      setFeedbackMsg(`⚠️ Carretel criado! Nota: o spot "${createLocation}" aguarda aplicação da migration no banco.`);
    } else {
      setFeedbackMsg(`✅ Carretel "${product.name}" cadastrado com sucesso no estoque!`);
    }

    setShowCreateModal(false);
    setCreateFromInbox(null);
    await loadData();
  }

  // --- Caixa de entrada ---------------------------------------------------

  async function handleInboxLink(item: SpoolInboxItem, spool: Spool) {
    if (item.source === "nfc") {
      const conflict = findConflictingSpool(inventory, item.external_id, spool.id);
      if (conflict) {
        alert(`Esta tag já está no carretel "${spoolTitle(conflict)}". Uma tag não pode ficar em dois carretéis.`);
        return;
      }
      if (spool.nfc_uid && spool.nfc_uid !== item.external_id) {
        const ok = window.confirm(`"${spoolTitle(spool)}" já tem a tag "${spool.nfc_uid}". Substituir pela tag "${item.external_id}"?`);
        if (!ok) return;
      }
    }
    let replaceCloudLink = false;
    if (item.source === "bambu_cloud" && spool.bambu_spool_id && spool.bambu_spool_id !== item.external_id) {
      replaceCloudLink = window.confirm(
        `"${spoolTitle(spool)}" está ligado ao registro ${spool.bambu_spool_id} da Bambu.

` +
          `Trocar pelo registro ${item.external_id}? (Use quando você apagou o cadastro antigo na Bambu e criou de novo.)`
      );
      if (!replaceCloudLink) return;
    }
    setInboxBusy(true);
    const { error } = await linkInboxItemToSpool(item, spool, { replaceCloudLink });
    if (!error) {
      const slotIdx = item.payload?.slot_index;
      if (typeof slotIdx === "number" && printers.length > 0) {
        await assignSpoolToSlot(printers[0].id, slotIdx, spool.id);
      }
    }
    setInboxBusy(false);
    if (error) {
      alert("Não foi possível ligar: " + ((error as any).code === "23505" ? "esta tag já está em outro carretel." : error.message));
      return;
    }
    setFeedbackMsg(`✅ Ligado ao carretel "${spoolTitle(spool)}".`);
    await loadData();
  }

  function handleInboxCreate(item: SpoolInboxItem) {
    setShowInbox(false);
    openCreateModal(item);
  }

  async function handleInboxIgnore(item: SpoolInboxItem) {
    if (!window.confirm("Ignorar este item? Nada será alterado no estoque.")) return;
    setInboxBusy(true);
    const { error } = await resolveInboxItem(item.id, "ignored", null);
    setInboxBusy(false);
    if (error) {
      alert("Erro ao ignorar: " + error.message);
      return;
    }
    await loadData();
  }

  async function handleInboxReopen(item: SpoolInboxItem) {
    setInboxBusy(true);
    const { error } = await reopenInboxItem(item.id);
    setInboxBusy(false);
    if (error) {
      alert("Erro ao reabrir: " + error.message);
      return;
    }
    await loadData();
  }

  async function handleInboxRename(item: SpoolInboxItem, profile: UserFilamentProfile) {
    const product = products.find((p) => p.id === item.suggested_product_id);
    const ok = window.confirm(
      `Confirmar que "${profile.display_name}" é o mesmo produto que "${product?.name || item.payload?.old_display_name}"?\n\n` +
        "Os carretéis desse produto passam a usar o nome novo. O histórico de impressões mantém o nome da época."
    );
    if (!ok) return;
    setInboxBusy(true);
    const { error } = await applyPresetRename(item, profile);
    setInboxBusy(false);
    if (error) {
      alert("Erro ao aplicar o novo nome: " + ((error as any).code === "23505" ? "já existe outro produto com esse nome." : error.message));
      return;
    }
    setFeedbackMsg(`✅ Produto agora se chama "${profile.display_name}".`);
    await loadData();
  }

  function selectWriterSpool(spool: Spool) {
    setWriterSpoolId(spool.id);
    setActiveTab("writer");
    const tare = spool.spool_tare_weight != null ? String(spool.spool_tare_weight) : "";
    setTareWeight(tare);
    setGrossWeight(tare ? (Number(spool.current_weight) + Number(tare)).toString() : "");
    setCustomTagId(spool.nfc_uid || generateAutoTagId(spool.material, getSpoolDisplayName(spool)));
    setFeedbackMsg(null);
  }

  // D4: carretel não é apagado (o histórico de impressões aponta para ele);
  // é arquivado e some do estoque, do AMS e das listas.
  async function handleArchiveSpool(spool: Spool) {
    if (!window.confirm(`Arquivar o carretel "${spoolTitle(spool)}"?\n\nEle sai do estoque e do AMS. O histórico de impressões continua guardado.`)) return;
    const { error } = await archiveSpool(spool.id);
    if (error) {
      alert("Erro ao arquivar: " + error.message);
      return;
    }
    setFeedbackMsg(`📦 Carretel "${spoolTitle(spool)}" arquivado.`);
    await loadData();
  }

  async function handleWriteTag(e: React.FormEvent) {
    e.preventDefault();
    if (!writerSpool) {
      alert("Selecione um carretel do estoque antes de gravar a tag.");
      return;
    }
    const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));
    const finalTagId = customTagId.trim() || generateAutoTagId(writerSpool.material, getSpoolDisplayName(writerSpool));
    const fullTargetUrl = `https://filamap.pages.dev/?tag=${encodeURIComponent(finalTagId)}`;
    const wroteToTag = await writeTagUrl(fullTargetUrl);
    // Sem essa checagem, uma falha na gravação física (tag afastada cedo
    // demais, permissão negada, etc.) ainda assim persistia nfc_uid no banco
    // e mostrava "gravado com sucesso" — divergindo o chip físico do banco
    // pra sempre. useNfc já expõe o erro em nfcError, renderizado abaixo do
    // formulário; aqui só interrompemos antes de tocar no banco.
    if (!wroteToTag) return;

    const { error } = await supabase.from("spools").update({
      nfc_uid: finalTagId,
      current_weight: netWeight,
      spool_tare_weight: parseFloat(tareWeight),
      nfc_written_at: new Date().toISOString(),
    }).eq("id", writerSpool.id);

    if (error) {
      alert("Erro ao gravar tag: " + error.message);
      return;
    }

    setFeedbackMsg(`✅ Tag "${finalTagId}" gravada com sucesso no carretel "${getSpoolDisplayName(writerSpool)}"!`);
    setWriterSpoolId("");
    setCustomTagId("");
    setGrossWeight("");
    setTareWeight("");
    setActiveTab("inventory");
    await loadData();
  }

  // "written": nfc_written_at confirma escrita física real via NDEFReader.write()
  // (handleWriteTag). "pending": tem nfc_uid mas nunca teve gravação física
  // confirmada (ex.: veio de importação em lote via seed_spools.ts). "none":
  // sem nfc_uid nenhum.

  const filteredInventory = filterInventory(
    inventory,
    searchQuery,
    filterMaterial
  );

  const filteredCatalog = catalog
    .filter((item) =>
      item.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      item.material.toLowerCase().includes(catalogSearch.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  const sortedFilteredInventory = sortSpoolsForSpoolScreen(filteredInventory);
  const spoolsInPrinter = sortedFilteredInventory.filter((s) => s.bambu_in_printer);
  const totalInPrinterCount = inventory.filter((s) => s.bambu_in_printer).length;
  const otherSpools = sortedFilteredInventory.filter((s) => !s.bambu_in_printer);

  const groupedByMaterial =
    groupInventoryByMaterial(otherSpools);

  const pendingWeighingLogs =
    getPendingWeighingLogs(printLogs);

  const writerSpool =
    getWriterSpool(inventory, writerSpoolId);

  const [currentTick, setCurrentTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTick(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const activePrinter = getActivePrinter(printers);
  const agentStatus = getAgentStatus(activePrinter, currentTick);
  const printerStatus = getPrinterStatus(activePrinter, currentTick);
  const printerOperationalText = formatPrinterOperationalState(activePrinter, agentStatus, printerStatus, currentTick);
  const isPrinting = isPrinterLivePrinting(activePrinter, currentTick);
  const agentBadge = getAgentBadgeProps(agentStatus);
  const printerBadge = getPrinterBadgeProps(printerStatus);

  // Nome do carretel no padrão do usuário (nome do perfil Bambu Studio, senão +/- MATERIAL COR MARCA).
  const profileById = new Map(filamentProfiles.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const spoolTitle = (s: Spool) =>
    resolveSpoolTitle(
      s,
      s.filament_product_id ? productById.get(s.filament_product_id) : null,
      s.filament_profile_id ? profileById.get(s.filament_profile_id) : null
    );

  function renderSpoolCard(spool: Spool) {
    const location = formatBambuLocation(spool);
    const spoolNeedsWeighing = needsWeighing(spool);
    const isLinkingThisSpool = linkingSpoolId === spool.id && isReading;

    return (
      <div key={spool.id} style={{ background: "#1e293b", border: `1px solid ${spoolNeedsWeighing ? "#d97706" : "#334155"}`, borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: getSpoolSwatchColor(spool), border: "2px solid #64748b", flexShrink: 0 }} />
          <div>
            <strong style={{ fontSize: 13, color: "#f8fafc" }}>{spoolTitle(spool)}</strong>
            <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
              <span>{getSpoolBrandDisplay(spool.brand, spool.material)} • {spool.material}</span>
              {/* Tag é opcional: só dois estados. Tag só entra por caminho físico
                  (gravar 🏷️ ou ler 📶), então ter nfc_uid = ter o chip. */}
              {spool.nfc_uid ? (
                <span title={`Tag NFC: ${spool.nfc_uid}`} style={{ background: "rgba(52, 211, 153, 0.15)", color: "#34d399", border: "1px solid #059669", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>🏷️ Com tag</span>
              ) : (
                <span title="Tag NFC é opcional: grave uma (🏷️) só se quiser identificar este carretel pelo celular" style={{ background: "rgba(148, 163, 184, 0.12)", color: "#94a3b8", border: "1px solid #475569", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>Sem tag</span>
              )}
              {spool.bambu_spool_id && (
                <span title="Origem do registro: sincronizado via ecossistema Bambu (Cloud Spool Sync)" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", border: "1px solid #0284c7", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>🌐 Sincronizado</span>
              )}
              {spoolNeedsWeighing && (
                <span title="Peso ainda não foi conferido na balança pelo Filamap" style={{ background: "rgba(217, 119, 6, 0.18)", color: "#fbbf24", border: "1px solid #d97706", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>⚠️ Precisa pesagem</span>
              )}
            </div>
            {location ? (
              <div style={{ fontSize: 11, color: "#38bdf8", marginTop: 2 }}>
                📍 {location} {spool.location ? `(Base: ${spool.location})` : ""}
              </div>
            ) : spool.location ? (
              <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 2 }}>
                📍 Spot: {spool.location}
              </div>
            ) : null}
            {isLinkingThisSpool && (
              <div style={{ fontSize: 11, color: "#38bdf8", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                📡 Aproxime a tag...
                <button type="button" onClick={handleCancelLinkNfc} style={{ background: "#334155", color: "#cbd5e1", border: "none", padding: "1px 6px", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Cancelar</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 14, color: "#38bdf8" }}>{spool.current_weight}g</strong>
          <button onClick={() => openWeighModal(spool)} title="Pesar / atualizar peso real" style={{ background: spoolNeedsWeighing ? "#d97706" : "#334155", color: "#fff", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>⚖️</button>
          <button
            onClick={() => handleStartLinkNfc(spool.id)}
            disabled={isLinkingThisSpool}
            title={spool.nfc_uid ? "Trocar a tag NFC vinculada (lê uma nova tag e substitui, mediante confirmação)" : "Vincular NFC: aproxime uma tag já gravada para associá-la a este carretel"}
            style={{ background: spool.nfc_uid ? "#0f172a" : "rgba(56, 189, 248, 0.2)", color: "#38bdf8", border: "1px solid #38bdf8", padding: "4px 8px", borderRadius: 4, cursor: isLinkingThisSpool ? "not-allowed" : "pointer", fontSize: 11 }}
          >
            📶
          </button>
          <button onClick={() => selectWriterSpool(spool)} title="Gravar tag NFC nova neste carretel" style={{ background: spool.nfc_uid ? "#0f172a" : "rgba(56, 189, 248, 0.2)", color: "#38bdf8", border: "1px solid #38bdf8", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>🏷️</button>
          <button onClick={() => openEditModal(spool)} style={{ background: "#0f172a", color: "#38bdf8", border: "1px solid #334155", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✏️</button>
          <button onClick={() => handleArchiveSpool(spool)} title="Arquivar (sai do estoque; o histórico continua)" style={{ background: "rgba(148, 163, 184, 0.15)", color: "#cbd5e1", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>📦</button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0f172a" }}>
        <div style={{ maxWidth: 380, width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, boxSizing: "border-box" }}>
          <div style={{ textAlign: "center", marginBottom: 22, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <FilamapIcon size={64} style={{ marginBottom: 12, filter: "drop-shadow(0 4px 14px rgba(2, 132, 199, 0.4))" }} />
            <FilamapLogo height={38} alt="FILAMAP" style={{ margin: "0 auto" }} />
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 12, fontWeight: 500 }}>Acesso à Oficina &amp; Estoque NFC</p>
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
      <style>{`
        @keyframes filamapNfcPulse {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(1.9); opacity: 0; }
        }
        @media (max-width: 520px) {
          .filamap-header-sub { display: none !important; }
        }
      `}</style>
      {/* Topo */}
      <header style={{ borderBottom: "1px solid #334155", paddingBottom: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <FilamapLogo height={36} alt="FILAMAP" />
            <div className="filamap-header-sub" style={{ borderLeft: "1px solid #334155", paddingLeft: 10, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>Bambu Lab A1 &amp; Estoque NFC</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span
              title={`Agent: ${agentStatus}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 700,
                background: agentBadge.bg,
                color: agentBadge.color,
                border: `1px solid ${agentBadge.border}`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: agentBadge.dotColor }} />
              {agentBadge.label}
            </span>
            <span
              title={`Impressora: ${printerStatus}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 700,
                background: printerBadge.bg,
                color: printerBadge.color,
                border: `1px solid ${printerBadge.border}`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: printerBadge.dotColor }} />
              {printerBadge.label}
            </span>
            {canInstall && (
              <button onClick={install} title="Instalar o Filamap como app neste aparelho" style={{ background: "#0284c7", color: "#fff", border: "none", padding: "5px 9px", borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                📲 Instalar
              </button>
            )}
            <button onClick={handleLogout} style={{ background: "#334155", color: "#cbd5e1", border: "none", padding: "5px 9px", borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              Sair
            </button>
          </div>
        </div>

        {/* 4 BOTÕES DO CABEÇALHO */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          <button onClick={() => setActiveTab("ams")} style={{ padding: "10px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: activeTab === "ams" ? "#0284c7" : "#1e293b", color: activeTab === "ams" ? "#fff" : "#94a3b8" }}>
            🖨️ AMS
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

      {pickingSlot !== null && (
        <SlotSpoolPicker
          slotIndex={pickingSlot}
          inventory={inventory}
          activeSlots={activeSlots}
          profiles={filamentProfiles}
          products={products}
          saving={savingSlotPick}
          onPick={handlePickSpoolForSlot}
          onClose={() => setPickingSlot(null)}
        />
      )}

      {showInbox && (
        <InboxPanel
          items={inboxItems}
          ignoredItems={ignoredInboxItems}
          onReopen={handleInboxReopen}
          inventory={inventory}
          profiles={filamentProfiles}
          products={products}
          spoolTitle={spoolTitle}
          busy={inboxBusy}
          onLink={handleInboxLink}
          onCreate={handleInboxCreate}
          onIgnore={handleInboxIgnore}
          onRename={handleInboxRename}
          onClose={() => setShowInbox(false)}
        />
      )}

      {inboxItems.length > 0 && (
        <button
          type="button"
          onClick={() => setShowInbox(true)}
          style={{ width: "100%", marginBottom: 16, padding: 10, background: "rgba(251, 191, 36, 0.12)", border: "1px solid #d97706", borderRadius: 8, color: "#fbbf24", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}
        >
          📥 {inboxItems.length === 1 ? "1 item" : `${inboxItems.length} itens`} na caixa de entrada: toque para resolver
        </button>
      )}

      {feedbackMsg && (
        <div style={{ marginBottom: 16, padding: 10, background: "rgba(52, 211, 153, 0.12)", border: "1px solid #059669", borderRadius: 8, color: "#34d399", fontSize: 13, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>{feedbackMsg}</span>
          <button onClick={() => setFeedbackMsg(null)} style={{ background: "transparent", border: "none", color: "#34d399", cursor: "pointer", fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* ABA 1: MONITOR AMS */}
      {activeTab === "ams" && (
        <div>

          <div style={{ background: isPrinting ? "linear-gradient(145deg, #0f172a, #172554)" : "#1e293b", border: `1px solid ${isPrinting ? "#38bdf8" : "#334155"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
              <strong style={{ fontSize: 15, color: "#f8fafc" }}>{isPrinting ? "IMPRESSÃO AO VIVO" : "STATUS DA IMPRESSORA"}</strong>
              <span style={{
                background: isPrinting ? "rgba(34, 197, 94, 0.2)" : printerStatus === "ONLINE" ? "rgba(16, 185, 129, 0.15)" : printerStatus === "SEM_COMUNICACAO" ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: isPrinting ? "#4ade80" : printerStatus === "ONLINE" ? "#34d399" : printerStatus === "SEM_COMUNICACAO" ? "#fbbf24" : "#f87171",
                border: `1px solid ${isPrinting ? "#16a34a" : printerStatus === "ONLINE" ? "#059669" : printerStatus === "SEM_COMUNICACAO" ? "#d97706" : "#dc2626"}`,
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700
              }}>
                {printerOperationalText}
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 12 }}>
              {printerStatus === "SEM_COMUNICACAO"
                ? "Aguardando comunicação com Desktop Agent"
                : printerStatus === "OFFLINE"
                ? "Impressora desligada ou desconectada da rede local"
                : isPrinting
                ? (activePrinter?.current_task || "Arquivo em impressão")
                : "Pronta para impressão"}
            </div>
            {isPrinting && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, color: "#cbd5e1" }}>
                  <span>Progresso: <strong style={{ color: "#38bdf8" }}>{activePrinter?.print_progress || 0}%</strong></span>
                  <span>Restante: <strong style={{ color: "#f8fafc" }}>{activePrinter?.remaining_time_min || 0} min</strong></span>
                </div>
                <div style={{ width: "100%", height: 10, background: "#0f172a", borderRadius: 5, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ width: `${activePrinter?.print_progress || 0}%`, height: "100%", background: "linear-gradient(90deg, #0284c7, #38bdf8)" }} />
                </div>
              </>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, background: "#0f172a", padding: 10, borderRadius: 8 }}>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>CAMADA</span><div style={{ fontSize: 13, fontWeight: 700 }}>{isPrinting ? `${activePrinter?.current_layer || 0} / ${activePrinter?.total_layers || 0}` : "--"}</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>BICO</span><div style={{ fontSize: 13, fontWeight: 700, color: printerStatus === "ONLINE" ? "#ef4444" : "#94a3b8" }}>{printerStatus === "ONLINE" ? `${activePrinter?.nozzle_temp || 0}°C` : "--"}</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>MESA</span><div style={{ fontSize: 13, fontWeight: 700, color: printerStatus === "ONLINE" ? "#f59e0b" : "#94a3b8" }}>{printerStatus === "ONLINE" ? `${activePrinter?.bed_temp || 0}°C` : "--"}</div></div>
              <div><span style={{ fontSize: 10, color: "#94a3b8" }}>SLOT EM USO</span><div style={{ fontSize: 13, fontWeight: 700, color: isPrinting && activePrinter?.active_slot_index !== null && activePrinter?.active_slot_index !== undefined && activePrinter?.active_slot_index !== 255 ? "#38bdf8" : "#94a3b8" }}>{formatActiveSlotDisplay(activePrinter?.active_slot_index, isPrinting)}</div></div>
            </div>
          </div>

          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155", marginBottom: 16 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Bandejas do AMS Lite</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {[0, 1, 2, 3].map((slotIdx) => {
                const spool = activeSlots[slotIdx];
                const isScanningThisSlot = scanningSlot === slotIdx && isReading;
                return (
                  <div key={slotIdx} style={{ background: "#0f172a", borderRadius: 8, padding: 12, border: isScanningThisSlot ? "1px solid #38bdf8" : "1px solid #334155", minHeight: 120 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                       <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>SLOT {slotIdx + 1}</span>
                       <span style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: spool ? getSpoolSwatchColor(spool) : "#334155", display: "inline-block", border: "1px solid rgba(255, 255, 255, 0.25)", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
                    </div>
                    {spool ? (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc" }}>{spoolTitle(spool)}</div>
                        <div style={{ fontSize: 11, color: "#cbd5e1" }}>{spool.material}</div>
                        <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 800, marginTop: 4 }}>{spool.current_weight}g</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                          <button onClick={() => setPickingSlot(slotIdx)} style={{ flex: 1, padding: 3, background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>🔄 Trocar</button>
                          <button onClick={(e) => handleEjectSlot(e, slotIdx)} style={{ flex: 1, padding: 3, background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>⏏️ Ejetar</button>
                        </div>
                      </div>
                    ) : isScanningThisSlot ? (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: "#38bdf8", fontSize: 11, fontWeight: 700 }}>📡 Aproxime a tag...</div>
                        <button onClick={handleCancelScan} style={{ marginTop: 8, width: "100%", padding: 3, background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Cancelar</button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                        <div style={{ position: "relative", width: 60, height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ position: "absolute", top: "50%", left: "50%", width: 60, height: 60, borderRadius: "50%", border: "1.5px solid #38bdf8", transform: "translate(-50%, -50%)", animation: "filamapNfcPulse 2s ease-out infinite", animationDelay: "0s", pointerEvents: "none" }} />
                          <span style={{ position: "absolute", top: "50%", left: "50%", width: 60, height: 60, borderRadius: "50%", border: "1.5px solid #38bdf8", transform: "translate(-50%, -50%)", animation: "filamapNfcPulse 2s ease-out infinite", animationDelay: "1s", pointerEvents: "none" }} />
                          <button
                            onClick={() => handleScanSlot(slotIdx)}
                            aria-label="Ler tag NFC"
                            style={{ position: "relative", width: 60, height: 60, borderRadius: "50%", background: "#0284c7", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 10px rgba(56, 189, 248, 0.35)" }}
                          >
                            <Nfc size={26} color="#fff" strokeWidth={2.2} />
                          </button>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>Aproximar tag NFC</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Toque para ler</div>
                        </div>
                        <button onClick={() => setPickingSlot(slotIdx)} style={{ width: "100%", padding: "5px 4px", background: "#1e293b", color: "#38bdf8", border: "1px solid #334155", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          📋 Escolher do estoque
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {nfcError && (
              <div style={{ marginTop: 10, padding: 8, background: "rgba(239, 68, 68, 0.1)", border: "1px solid #dc2626", borderRadius: 6, color: "#f87171", fontSize: 12 }}>
                {nfcError}
              </div>
            )}
          </div>

          {/* Histórico Recente */}
          <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={historyOpen}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "#f8fafc", fontSize: 15, fontWeight: 700 }}
            >
              <span>📋 Histórico de Impressões</span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{historyOpen ? "▾ recolher" : "▸ ver"}</span>
            </button>
            {!historyOpen ? null : printLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px", color: "#64748b", fontSize: 12, marginTop: 12 }}>Nenhuma impressão registrada.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {groupPrintLogsByJob(printLogs).map((job) => (
                  <div key={job.key} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{job.subtask_name}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                          {job.completed_at ? new Date(job.completed_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Data não disponível"} • Status: <span style={{ color: "#34d399", fontWeight: 600 }}>{job.status}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#f87171" }}>
                          {`-${formatGramsDisplay(job.total_used_g)}`}
                        </span>
                      </div>
                    </div>

                    {/* Breakdown de carretéis/cores */}
                    <div style={{ borderTop: "1px solid #1e293b", paddingTop: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                      {job.items.map((item) => (
                        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                backgroundColor: item.color_hex,
                                display: "inline-block",
                                flexShrink: 0,
                                border: "1px solid rgba(255, 255, 255, 0.25)",
                                boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.5)",
                              }}
                            />
                            <span style={{ color: item.orphan_slot ? "#f87171" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.orphan_slot ? (
                                <span style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, marginRight: 6 }}>
                                  SEM CARRETEL
                                </span>
                              ) : null}
                              {item.product_name ? item.product_name : `${item.material ? `${item.material} • ` : ""}${item.color_name || item.spool_name}`}
                            </span>
                          </div>
                          <span style={{ color: "#94a3b8", fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>
                            {`-${item.used_g}g`}
                          </span>
                        </div>
                      ))}
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
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "2px 0 0" }}>Na impressora primeiro, demais separados por material</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setShowInbox(true)}
                title="Caixa de entrada: itens da nuvem Bambu e tags aguardando decisão (inclui os ignorados)"
                style={{ padding: "8px 12px", background: "#0f172a", color: inboxItems.length > 0 ? "#fbbf24" : "#94a3b8", border: "1px solid #334155", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              >
                📥 {inboxItems.length > 0 ? inboxItems.length : ""}
              </button>
              <button
                type="button"
                onClick={() => openCreateModal()}
                style={{
                  padding: "8px 14px",
                  background: "#0284c7",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ➕ Novo Carretel
              </button>
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

          {nfcError && linkingSpoolId === null && (
            <div style={{ marginBottom: 16, padding: 8, background: "rgba(239, 68, 68, 0.1)", border: "1px solid #dc2626", borderRadius: 6, color: "#f87171", fontSize: 12 }}>
              {nfcError}
            </div>
          )}

          {totalInPrinterCount > 0 && (
            <div style={{ background: "#0f172a", borderRadius: 10, border: "1px solid #38bdf8", overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "10px 14px", background: "rgba(2, 132, 199, 0.15)", borderBottom: "1px solid #334155" }}>
                <strong style={{ color: "#38bdf8" }}>📍 Na Impressora Agora {getInPrinterCountDisplay(spoolsInPrinter.length, totalInPrinterCount)}</strong>
              </div>
              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {spoolsInPrinter.length > 0 ? (
                  spoolsInPrinter.map((spool) => renderSpoolCard(spool))
                ) : (
                  <div style={{ padding: "10px", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                    Nenhum carretel na impressora corresponde aos filtros aplicados.
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.keys(groupedByMaterial).map((mat) => {
              const spools = groupedByMaterial[mat];
              const totalWeight = spools.reduce((acc, s) => acc + (s.current_weight || 0), 0);
              const totalValue = spools.reduce((acc, s) => acc + (s.price_paid ? (s.current_weight || 0) * (s.price_paid / 1000) : 0), 0);

              return (
                <div key={mat} style={{ background: "#0f172a", borderRadius: 10, border: "1px solid #334155", overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", background: "rgba(30, 41, 59, 0.7)", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between" }}>
                    <strong>{mat} ({spools.length})</strong>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      Total: <strong style={{ color: "#f8fafc" }}>{(totalWeight / 1000).toFixed(2)} kg</strong> • Valor: <strong style={{ color: "#34d399" }}>R$ {totalValue.toFixed(2)}</strong>
                    </div>
                  </div>
                  <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    {spools.map((spool) => renderSpoolCard(spool))}
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
                              <option key={s.id} value={s.id}>{spoolTitle(s)} - {s.price_paid ? `R$${s.price_paid}/kg` : "sem preço (usa o manual)"}</option>
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
          <h2 style={{ fontSize: 17, color: "#f8fafc", margin: "0 0 14px" }}>Gravar Tag NFC no Carretel</h2>
          <form onSubmit={handleWriteTag} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: "#cbd5e1" }}>Selecionar carretel</label>
              <select
                value={writerSpoolId}
                onChange={(e) => {
                  const spool = inventory.find((s) => s.id === e.target.value);
                  if (spool) {
                    selectWriterSpool(spool);
                  } else {
                    setWriterSpoolId("");
                    setCustomTagId("");
                    setGrossWeight("");
                    setTareWeight("");
                  }
                }}
                style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                required
              >
                <option value="">Selecione um carretel do estoque...</option>
                {inventory.map((s) => {
                  return (
                    <option key={s.id} value={s.id}>
                      {spoolTitle(s)}
                      {s.nfc_uid ? " (com tag)" : " (sem tag)"}
                    </option>
                  );
                })}
              </select>
            </div>

            {writerSpool && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#64748b" }}>Marca</label>
                    <div style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#cbd5e1", fontSize: 13 }}>{writerSpool.brand}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#64748b" }}>Material</label>
                    <div style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#cbd5e1", fontSize: 13 }}>{writerSpool.material}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#64748b" }}>Cor</label>
                    <div style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#cbd5e1", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: getSpoolSwatchColor(writerSpool), display: "inline-block", flexShrink: 0, border: "1px solid rgba(255, 255, 255, 0.25)", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
                      {getSpoolDisplayName(writerSpool)}
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tag ID</label>
                  <input type="text" value={customTagId} onChange={(e) => setCustomTagId(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #475569", borderRadius: 6, color: "#38bdf8", fontWeight: 700 }} required />
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
              </>
            )}
          </form>
          {nfcError && <div style={{ marginTop: 8, color: "#f87171", fontSize: 12 }}>{nfcError}</div>}
        </div>
      )}


      {/* Modal Re-pesagem */}
      {weighingSpool && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
            <h3 style={{ margin: "0 0 10px", color: "#fff" }}>⚖️ Re-pesar {getSpoolDisplayName(weighingSpool)}</h3>
            {needsWeighing(weighingSpool) && (
              <p style={{ margin: "0 0 10px", color: "#fbbf24", fontSize: 12 }}>
                Este carretel foi sincronizado via ecossistema Bambu e ainda não foi pesado no Filamap -- o peso {weighingSpool.current_weight}g é só um valor padrão.
              </p>
            )}
            <form onSubmit={handleSaveWeigh} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input type="number" value={modalGross} onChange={(e) => setModalGross(e.target.value)} placeholder="Peso na balança (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              <input type="number" value={modalTare} onChange={(e) => setModalTare(e.target.value)} placeholder="Tara (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
              {needsWeighing(weighingSpool) && (
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Peso inicial (rolo cheio, g) -- confirme ou corrija a sugestão</label>
                  <input type="number" value={modalInitialWeight} onChange={(e) => setModalInitialWeight(e.target.value)} placeholder="Peso inicial (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
                </div>
              )}
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
              <div>
                <label style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>Produto (filamento)</label>
                <select
                  value={editProductId}
                  onChange={(e) => {
                    setEditProductId(e.target.value);
                    setEditProductBrand(products.find((p) => p.id === e.target.value)?.brand || "");
                  }}
                  style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #0284c7", borderRadius: 6, color: "#fff", fontSize: 12 }}
                  required
                >
                  <option value="">Escolha o produto...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Marca do produto</label>
                  <input type="text" value={editProductBrand} onChange={(e) => setEditProductBrand(e.target.value)} placeholder="Ex.: Voolt3D" disabled={!editProductId} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tom</label>
                  <input type="color" value={editColorHex} onChange={(e) => setEditColorHex(e.target.value)} style={{ width: "100%", height: 34, padding: 2, background: "#0f172a", border: "1px solid #334155", borderRadius: 6 }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tara (g)</label>
                  <input type="number" value={editTare} onChange={(e) => setEditTare(e.target.value)} placeholder="Tara" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Saldo (g)</label>
                  <input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} placeholder="Saldo em gramas" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8" }}>Preço pago (R$, opcional)</label>
                <input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="Sem preço" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8" }}>Localização / Spot (fora da impressora)</label>
                <input
                  type="text"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="Ex.: Prateleira A1, Gaveta 2, Caixa Seca 01"
                  style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                />
              </div>
              {editingSpool.nfc_uid ? (
                <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>Tag NFC vinculada:</div>
                    <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 700 }}>{editingSpool.nfc_uid}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = window.confirm(
                        `Desvincular a tag "${editingSpool.nfc_uid}" do carretel "${getSpoolDisplayName(editingSpool)}"?\n\n` +
                        `O carretel continuará existindo normalmente no estoque com seu peso (${editingSpool.current_weight}g), localização e histórico de impressões.`
                      );
                      if (!confirmed) return;
                      const { error } = await unlinkSpoolNfc(editingSpool.id);
                      if (error) {
                        alert("Erro ao desvincular tag: " + error.message);
                        return;
                      }
                      setFeedbackMsg(`✅ Tag desvinculada do carretel "${getSpoolDisplayName(editingSpool)}"!`);
                      setEditingSpool(null);
                      await loadData();
                    }}
                    style={{ padding: "6px 10px", background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "1px solid #dc2626", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                  >
                    ❌ Desvincular NFC
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const spool = editingSpool;
                    setEditingSpool(null);
                    selectWriterSpool(spool);
                  }}
                  style={{ padding: 8, background: "#0f172a", color: "#38bdf8", border: "1px solid #38bdf8", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  🏷️ Gravar tag deste carretel
                </button>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setEditingSpool(null)} style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6 }}>Cancelar</button>
                <button type="submit" style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cadastro de Novo Carretel (Fase I) */}
      {showCreateModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 420, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 6px", color: "#fff" }}>➕ Novo Carretel (Estoque Físico)</h3>
            <p style={{ margin: "0 0 14px", color: "#94a3b8", fontSize: 12 }}>
              Escolha o produto (o filamento, como está no Bambu Studio) e informe o que é deste carretel: peso, tara, preço e local.
            </p>
            {createFromInbox && (
              <p style={{ margin: "-6px 0 12px", color: "#fbbf24", fontSize: 12 }}>
                📥 Criando a partir da caixa de entrada{createFromInbox.source === "nfc" ? ` (tag ${createFromInbox.external_id})` : " (carretel da nuvem Bambu)"}.
                {createFromInbox.payload?.net_weight ? ` Peso nominal na Bambu: ${createFromInbox.payload.net_weight}g.` : ""}
              </p>
            )}

            <form onSubmit={handleSaveCreate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>
                  Produto (filamento)
                </label>
                <select
                  value={createProductChoice}
                  onChange={(e) => handleSelectProductChoice(e.target.value)}
                  style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #0284c7", borderRadius: 6, color: "#fff", fontSize: 12 }}
                  required
                >
                  <option value="">Escolha o produto...</option>
                  {products.length > 0 && (
                    <optgroup label="Seus produtos">
                      {products.map((p) => (
                        <option key={p.id} value={`product:${p.id}`}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {/* Perfis do Bambu Studio em uso que ainda não são produto. Perfis
                      'bambu_cloud' e de pastas antigas do fatiador ficam fora. */}
                  {profilesWithoutProduct(filamentProfiles, products).length > 0 && (
                    <optgroup label="Novo produto a partir do Bambu Studio">
                      {profilesWithoutProduct(filamentProfiles, products).map((p) => (
                        <option key={p.id} value={`profile:${p.id}`}>{p.display_name}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value="manual">➕ Produto que não está no Bambu Studio...</option>
                </select>
              </div>

              {createProductChoice === "manual" && (
              <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Marca</label>
                  <input
                    type="text"
                    value={createBrand}
                    onChange={(e) => setCreateBrand(e.target.value)}
                    placeholder="Ex.: Voolt3D, Bambu Lab..."
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Material</label>
                  <select
                    value={createMaterial}
                    onChange={(e) => setCreateMaterial(e.target.value)}
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                  >
                    <option value="PLA">PLA</option>
                    <option value="PETG">PETG</option>
                    <option value="ABS">ABS</option>
                    <option value="TPU">TPU</option>
                    <option value="ASA">ASA</option>
                    <option value="PC">PC</option>
                    <option value="PA">PA</option>
                    <option value="OUTRO">OUTRO</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Cor</label>
                  <input
                    type="text"
                    value={createColorName}
                    onChange={(e) => setCreateColorName(e.target.value)}
                    placeholder="Ex.: Branco Ultra Silk"
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tom</label>
                  <input
                    type="color"
                    value={createColorHex}
                    onChange={(e) => setCreateColorHex(e.target.value)}
                    style={{ width: "100%", height: 34, padding: 2, background: "#0f172a", border: "1px solid #334155", borderRadius: 6 }}
                  />
                </div>
              </div>
              </>
              )}

              {createProductChoice !== "manual" && createProductChoice !== "" && (
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tom deste carretel</label>
                  <input
                    type="color"
                    value={createColorHex}
                    onChange={(e) => setCreateColorHex(e.target.value)}
                    style={{ width: "100%", height: 34, padding: 2, background: "#0f172a", border: "1px solid #334155", borderRadius: 6 }}
                  />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Saldo Líquido (g)</label>
                  <input
                    type="number"
                    value={createWeight}
                    onChange={(e) => setCreateWeight(e.target.value)}
                    placeholder="Ex.: 1000"
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Tara do Carretel (g)</label>
                  <input
                    type="number"
                    value={createTare}
                    onChange={(e) => setCreateTare(e.target.value)}
                    placeholder="Ex.: 200"
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Preço Pago (R$, opcional)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createPrice}
                    onChange={(e) => setCreatePrice(e.target.value)}
                    placeholder="Ex.: 85.00"
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Localização / Spot</label>
                  <input
                    type="text"
                    value={createLocation}
                    onChange={(e) => setCreateLocation(e.target.value)}
                    placeholder="Ex.: Prateleira A1"
                    style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}
                  />
                </div>
              </div>

              {/* Sem campo para digitar código de tag: a tag só entra lida do chip
                  (caixa de entrada) ou depois, gravando com 🏷️ / lendo com 📶. */}
              {createNfcUid ? (
                <div style={{ fontSize: 12, color: "#34d399" }}>🏷️ Tag lida: {createNfcUid}</div>
              ) : (
                <div style={{ fontSize: 11, color: "#64748b" }}>Tag NFC é opcional: depois de cadastrar, grave uma com 🏷️ ou leia uma existente com 📶.</div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Cadastrar Carretel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}






