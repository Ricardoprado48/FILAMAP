const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const target = path.join(__dirname, "web-app", "src", "App.tsx");
let code = fs.readFileSync(target, "utf8");

// 1. Adiciona a função de cópia caso não exista
if (!code.includes("function copyTagUrl")) {
  const marker = "function handleDeleteSpool";
  const funcCopy = `  function copyTagUrl(tagId: string) {
    const url = \`https://filamap.pages.dev/?tag=\${encodeURIComponent(tagId)}\`;
    navigator.clipboard.writeText(url);
    alert(\`📋 Link copiado para a área de transferência!\\n\\n\${url}\\n\\nCole no app NFC Tools para gravar.\`);
  }\n\n`;
  code = code.replace(marker, funcCopy + marker);
}

// 2. Adiciona o botão "Copiar Link NFC" no Almoxarifado
if (!code.includes("copyTagUrl(spool.nfc_uid)")) {
  const editBtnMarker = 'onClick={() => openEditModal(spool)}';
  const newBtn = `onClick={() => copyTagUrl(spool.nfc_uid)}
                                  title="Copiar Link NFC"
                                  style={{
                                    background: "#0369a1",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 7px",
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  📋 Copiar Link
                                </button>
                                <button
                                  `;
  code = code.replace(editBtnMarker, newBtn + editBtnMarker);
}

// 3. Adiciona a tag de versão para forçar alteração
const versionTag = `// Build Version: ${Date.now()}\n`;
code = versionTag + code.replace(/^\/\/ Build Version:.*\n/, "");

fs.writeFileSync(target, code, "utf8");
console.log("✅ App.tsx modificado com sucesso!");

try {
  console.log("🚀 Enviando para o GitHub e Cloudflare...");
  execSync("git add -A", { stdio: "inherit" });
  execSync(`git commit -m "feat: adicionar botao copiar link nfc v${Date.now()}"`, { stdio: "inherit" });
  execSync("git push origin main", { stdio: "inherit" });
  console.log("🎉 Deploy enviado com sucesso para o Cloudflare Pages!");
} catch (err) {
  console.error("Erro no git:", err.message);
}