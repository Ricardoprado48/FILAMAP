import https from "node:https";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/['"]/g, "").replace(/\/$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "").trim().replace(/['"]/g, "");

function postSpool(data: any) {
  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/spools`);
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

const estoqueInicial = [
  { nfc_uid: "FILA-PLA-ROSA-CHOQUE", brand: "Voolt3D", material: "PLA", color_name: "Rosa Choque", color_hex: "#FF1493", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-ROSE-GOLD", brand: "Voolt3D", material: "PLA", color_name: "Rose Gold Silk", color_hex: "#B76E79", initial_weight: 1000, current_weight: 1000, price_paid: 95.00 },
  { nfc_uid: "FILA-PLA-BRANCO-CREALITY", brand: "Creality", material: "PLA", color_name: "Branco", color_hex: "#FFFFFF", initial_weight: 1000, current_weight: 1000, price_paid: 89.00 },
  { nfc_uid: "FILA-PLA-AMARELO-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Amarelo Velvet", color_hex: "#EAB308", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-AZUL-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Azul Velvet", color_hex: "#2563EB", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-OFFWHITE-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Branco Off White Velvet", color_hex: "#F8FAFC", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-BRANCO-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Branco Velvet", color_hex: "#FFFFFF", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-CAUCASIANO", brand: "Voolt3D", material: "PLA", color_name: "Caucasiano Velvet", color_hex: "#F5D0A9", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-DOURADO", brand: "Voolt3D", material: "PLA", color_name: "Dourado", color_hex: "#D4AF37", initial_weight: 1000, current_weight: 1000, price_paid: 95.00 },
  { nfc_uid: "FILA-PLA-LARANJA", brand: "Voolt3D", material: "PLA", color_name: "Laranja", color_hex: "#F97316", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-VERDE-SILK", brand: "Voolt3D", material: "PLA", color_name: "Verde Silk", color_hex: "#10B981", initial_weight: 1000, current_weight: 1000, price_paid: 95.00 },
  { nfc_uid: "FILA-PLA-PRETO-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Preto Velvet", color_hex: "#111827", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-VERDE-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Verde Velvet", color_hex: "#16A34A", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PLA-VERMELHO-VELVET", brand: "Voolt3D", material: "PLA", color_name: "Vermelho Velvet", color_hex: "#DC2626", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-AZUL-CLARO", brand: "Xiaozhuzi", material: "PETG", color_name: "Azul Claro", color_hex: "#38BDF8", initial_weight: 1000, current_weight: 1000, price_paid: 80.00 },
  { nfc_uid: "FILA-PETG-BEGE-CAUCASIANO", brand: "Voolt3D", material: "PETG", color_name: "Bege Caucasiano", color_hex: "#ECC59E", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-CHAMPAGNE", brand: "Easy Print", material: "PETG", color_name: "Champagne Metálico", color_hex: "#F7E7CE", initial_weight: 1000, current_weight: 1000, price_paid: 90.00 },
  { nfc_uid: "FILA-PETG-PRATA", brand: "Easy Print", material: "PETG", color_name: "Prata Metálico", color_hex: "#C0C0C0", initial_weight: 1000, current_weight: 1000, price_paid: 90.00 },
  { nfc_uid: "FILA-PETG-VERDE-MILITAR", brand: "Fusion", material: "PETG", color_name: "Verde Militar", color_hex: "#4B5320", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-ROSA-ANYCUBIC", brand: "Anycubic", material: "PETG", color_name: "Rosa", color_hex: "#F472B6", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-BRANCO-DENTAL", brand: "Voolt3D", material: "PETG", color_name: "Branco Dental HF", color_hex: "#F1F5F9", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-CINZA-CLARO", brand: "Voolt3D", material: "PETG", color_name: "Cinza Claro", color_hex: "#94A3B8", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-AMARELO-LIMAO", brand: "Fusion", material: "PETG", color_name: "Amarelo Limão", color_hex: "#CCFF00", initial_weight: 1000, current_weight: 1000, price_paid: 85.00 },
  { nfc_uid: "FILA-PETG-BRANCO-MASTERPRINT", brand: "MasterPrint", material: "PETG", color_name: "Branco", color_hex: "#FFFFFF", initial_weight: 1000, current_weight: 1000, price_paid: 80.00 },
  { nfc_uid: "FILA-PETG-PRETO-MASTERPRINT", brand: "MasterPrint", material: "PETG", color_name: "Preto", color_hex: "#0F172A", initial_weight: 1000, current_weight: 1000, price_paid: 80.00 },
  { nfc_uid: "FILA-PETG-VERDE", brand: "Genérico", material: "PETG", color_name: "Verde", color_hex: "#22C55E", initial_weight: 1000, current_weight: 1000, price_paid: 80.00 },
  { nfc_uid: "FILA-TPU-PRETO", brand: "Genertech", material: "TPU", color_name: "Preto TPU", color_hex: "#000000", initial_weight: 1000, current_weight: 1000, price_paid: 120.00 }
];

async function run() {
  console.log("📦 Inserindo carretéis no Almoxarifado...");
  for (const s of estoqueInicial) {
    await postSpool(s);
    console.log(`  ➕ Rolo em estoque: ${s.color_name} (${s.brand} - ${s.material})`);
  }
  console.log("🎉 Todos os carretéis estão agora no Almoxarifado!");
}

run();