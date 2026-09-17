import * as mqtt from "mqtt";
import { registerOrUpdatePrinter, processJobFinish } from "./sync-service.js";

const PRINTER_IP = "192.168.15.15";
const ACCESS_CODE = "11325200";
const SERIAL = "03919D570307088";

console.log(`[Filamap Agent] Conectando na Bambu Lab (${SERIAL})...`);

const client = mqtt.connect(`mqtts://${PRINTER_IP}:8883`, {
  username: "bblp",
  password: ACCESS_CODE,
  rejectUnauthorized: false,
  clientId: `filamap_${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  keepalive: 60,
  reconnectPeriod: 5000,
});

let lastState = "";
let currentSubtask = "";
let lastPercent = -1;

client.on("connect", async () => {
  console.log("✅ [Filamap Agent] Conectado ao broker local da Bambu!");

  // Registra ou atualiza o status online da impressora no Supabase
  await registerOrUpdatePrinter(SERIAL, PRINTER_IP, "A1");
  console.log("☁️  [Supabase] Impressora sincronizada na nuvem.");

  const reportTopic = `device/${SERIAL}/report`;
  const requestTopic = `device/${SERIAL}/request`;

  client.subscribe(reportTopic, { qos: 0 }, (err) => {
    if (err) {
      console.error("❌ Erro ao assinar tópico:", err.message);
      return;
    }

    client.publish(requestTopic, JSON.stringify({
      pushing: { sequence_id: "0", command: "pushall" }
    }));
  });
});

client.on("message", async (_topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    if (!payload.print) return;

    const p = payload.print;

    if (p.subtask_name) {
      currentSubtask = p.subtask_name;
    }

    // Detecta mudança de estado
    if (p.gcode_state && p.gcode_state !== lastState) {
      console.log(`\n🔔 [MUDANÇA DE ESTADO] ${lastState || "INICIAL"} -> ${p.gcode_state}`);

      if (p.gcode_state === "FINISH") {
        console.log("🎉 [Filamap] Impressão finalizada com sucesso!");

        // Slot ativo (fallback para o slot 0 / Bandeja 1 se não vier explícito)
        const activeSlot = p.ams?.tray_now != null ? parseInt(p.ams.tray_now, 10) : 0;
        
        // Peso padrão estimado ou extraído do job (ex: 50g para teste se não vier no delta)
        const estimatedGrams = 50.0;

        console.log(`📦 Enviando baixa para o Supabase (Slot ${activeSlot + 1})...`);
        await processJobFinish(SERIAL, currentSubtask || "Job Desconhecido", estimatedGrams, activeSlot);
      }

      lastState = p.gcode_state;
    }

    // Progresso a cada 5%
    if (p.mc_percent != null && p.mc_percent !== lastPercent && p.mc_percent % 5 === 0) {
      lastPercent = p.mc_percent;
      console.log(`⏳ Progresso: ${p.mc_percent}% | Tempo restante: ${p.mc_remaining_time || 0} min`);
    }
  } catch {
    // Ignora pacotes de controle
  }
});
