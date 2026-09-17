import https from "node:https";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/['"]/g, "").replace(/\/$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "").trim().replace(/['"]/g, "");

function postPreset(data: any) {
  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/filament_presets`);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      }
    }, (res) => {
      resolve(res.statusCode);
    });
    req.write(JSON.stringify(data));
    req.end();
  });
}

const meusFilamentos = [
  { name: "PLA ROSA CHOQUE VOOLT", material: "PLA", brand: "Voolt3D", color_hex: "#FF1493" },
  { name: "PLA ROSE GOLD VSILK VOOLT", material: "PLA", brand: "Voolt3D", color_hex: "#B76E79" },
  { name: "Creality PLA BRANCO", material: "PLA", brand: "Creality", color_hex: "#FFFFFF" },
  { name: "PLA AMARELO PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#EAB308" },
  { name: "PLA AZUL PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#2563EB" },
  { name: "PLA BRANCO OFF WHITE PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#F8FAFC" },
  { name: "PLA BRANCO VOOLT3D PLA VELVET", material: "PLA", brand: "Voolt3D", color_hex: "#FFFFFF" },
  { name: "PLA CAUCASIANO PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#F5D0A9" },
  { name: "PLA DOURADO VOOLT PLA DOURADO VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#D4AF37" },
  { name: "PLA LARANJA PLA VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#F97316" },
  { name: "PLA PLA VERDE SILK VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#10B981" },
  { name: "PLA PRETO VOOLT3D PLA VELVET", material: "PLA", brand: "Voolt3D", color_hex: "#111827" },
  { name: "PLA VERDE PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#16A34A" },
  { name: "PLA VERMELHO PLA VELVET VOOLT3D", material: "PLA", brand: "Voolt3D", color_hex: "#DC2626" },
  { name: "PETG AZUL CLARO XIAOZHUZI", material: "PETG", brand: "Outra...", color_hex: "#38BDF8" },
  { name: "PETG BEGE CAUCASIANO VOOLT", material: "PETG", brand: "Voolt3D", color_hex: "#ECC59E" },
  { name: "PETG CHAMPAGNE METALICO EASYPRINT", material: "PETG", brand: "Easy Print", color_hex: "#F7E7CE" },
  { name: "PETG PRATA METALICO EASY", material: "PETG", brand: "Easy Print", color_hex: "#C0C0C0" },
  { name: "PETG VERDE MILITAR FISION", material: "PETG", brand: "Fusion", color_hex: "#4B5320" },
  { name: "Anycubic PETG ROSA", material: "PETG", brand: "Anycubic", color_hex: "#F472B6" },
  { name: "PETG BRANCO DENTAL VOOLT3D PETG HF", material: "PETG", brand: "Voolt3D", color_hex: "#F1F5F9" },
  { name: "PETG CINZA CLARO PETG VOOLT3D", material: "PETG", brand: "Voolt3D", color_hex: "#94A3B8" },
  { name: "PETG PETG AMARELO LIMAO FUSIONX", material: "PETG", brand: "Fusion", color_hex: "#CCFF00" },
  { name: "PETG PETG BRANCO MASTERPRINT", material: "PETG", brand: "MasterPrint", color_hex: "#FFFFFF" },
  { name: "PETG PETG PRETO MASTERPRINT", material: "PETG", brand: "MasterPrint", color_hex: "#0F172A" },
  { name: "PETGE PETG VERDE", material: "PETG", brand: "Outra...", color_hex: "#22C55E" },
  { name: "TPU PRETO TPU GENERTECH", material: "TPU", brand: "Outra...", color_hex: "#000000" }
];

async function run() {
  console.log("🚀 Enviando seus 27 perfis para o Supabase...");
  for (const f of meusFilamentos) {
    await postPreset(f);
    console.log(`✅ Cadastrado: ${f.name} (${f.material})`);
  }
  console.log("🎉 Todos os filamentos disponíveis no Filamap!");
}

run();