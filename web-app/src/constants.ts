export const POPULAR_BRANDS = [
  "Voolt3D", "3D Fila", "Bambu Lab", "Creality", "Anycubic", "Elegoo",
  "Easy Print", "Esun", "Fusion", "GTMax3D", "MasterPrint", "Multifila",
  "PolyMaker", "PrintaLot", "Sulun", "Suntop", "TopRecicla", "Outra..."
];

export const TARE_PRESETS = [
  { label: "Voolt Vazado (218g)", val: "218" },
  { label: "Voolt Fechado/Antigo (250g)", val: "250" },
  { label: "Voolt Transparente (195g)", val: "195" },
  { label: "MasterPrint (230g)", val: "230" },
  { label: "Padrão (220g)", val: "220" }
];

// O Desktop Agent grava last_seen_at a cada heartbeat de 15s (independente
// da conexão MQTT com a impressora estar de pé ou não — é o sinal de "o
// processo do Agent ainda está rodando"). 30s = 2 ciclos de heartbeat: uma
// folga cobre uma gravação perdida por instabilidade de rede sem deixar a
// impressora aparecer "ONLINE" por muito tempo depois que o processo
// realmente morreu (PC desligado, hibernação, crash, queda de energia —
// nenhum desses casos consegue gravar is_online:false na saída).
export const PRINTER_ONLINE_THRESHOLD_MS = 30000;
