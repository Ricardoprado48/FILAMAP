export const POPULAR_BRANDS = [
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
  "Outra...",
];

export const TARE_PRESETS = [
  { label: "Voolt Vazado (218g)", val: "218" },
  { label: "Voolt Fechado/Antigo (250g)", val: "250" },
  { label: "Voolt Transparente (195g)", val: "195" },
  { label: "MasterPrint (230g)", val: "230" },
  { label: "Padrão (220g)", val: "220" },
];

export const AGENT_ONLINE_THRESHOLD_MS = 45000;
// Idade máxima de printers.last_online (última telemetria MQTT real da
// impressora) para considerá-la Online. Regra definida antes da medição:
// max(60s, 3 x p99 do intervalo entre escritas de telemetria + 8s de
// polling/tick da Web). Medição M0 (2026-09-27, RUNNING, 600s): p99 23.9s
// -> 80s. Revisar com a medição em IDLE.
export const PRINTER_ONLINE_THRESHOLD_MS = 80000;
