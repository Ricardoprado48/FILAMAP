import * as mqtt from "mqtt";

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
let lastPercent = -1;

client.on("connect", () => {
  console.log("✅ [Filamap Agent] Conectado ao broker local da Bambu!");

  const reportTopic = `device/${SERIAL}/report`;
  const requestTopic = `device/${SERIAL}/request`;

  client.subscribe(reportTopic, { qos: 0 }, (err) => {
    if (err) {
      console.error("❌ Erro ao assinar tópico:", err.message);
      return;
    }

    // Solicita o estado atual inicial
    client.publish(requestTopic, JSON.stringify({
      pushing: { sequence_id: "0", command: "pushall" }
    }));
  });
});

client.on("message", (_topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    if (!payload.print) return;

    const p = payload.print;

    // Detecta mudança de status (RUNNING -> FINISH / FAILED / PAUSE)
    if (p.gcode_state && p.gcode_state !== lastState) {
      console.log(`\n🔔 [MUDANÇA DE ESTADO] De "${lastState || "INICIAL"}" para -> "${p.gcode_state}"`);
      
      if (p.gcode_state === "FINISH") {
        console.log("🎉 IMPRESSÃO FINALIZADA COM SUCESSO!");
        console.log("📦 Preparando payload para abater gramas no banco de dados...");
      } else if (p.gcode_state === "FAILED") {
        console.log("⚠️ A impressão falhou ou foi cancelada pelo usuário.");
      }
      
      lastState = p.gcode_state;
    }

    // Exibe progresso a cada 5% para manter o terminal limpo
    if (p.mc_percent != null && p.mc_percent !== lastPercent && p.mc_percent % 5 === 0) {
      lastPercent = p.mc_percent;
      console.log(`⏳ Progresso: ${p.mc_percent}% | Tempo restante estimado: ${p.mc_remaining_time || 0} min`);
    }

  } catch {
    // Ignora pacotes de controle
  }
});
