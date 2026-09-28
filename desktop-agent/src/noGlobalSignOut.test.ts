import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Guarda contra o gatilho do incidente 2026-09-27: auth.signOut() sem
// escopo usa "global" no supabase-js e revoga TODAS as sessões da conta,
// inclusive a do Desktop Agent em produção.
const ROOTS = ["desktop-agent/src", "web-app/src"];

function repoRoot(): string {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "web-app")) || !fs.existsSync(path.join(dir, "desktop-agent"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("raiz do repositório não encontrada");
    dir = up;
  }
  return dir;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("nenhum auth.signOut() sem escopo explícito no código-fonte", () => {
  const root = repoRoot();
  const offenders: string[] = [];
  for (const r of ROOTS) {
    for (const file of walk(path.join(root, r))) {
      if (file.endsWith("noGlobalSignOut.test.ts")) continue;
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/auth\.signOut\(\s*\)/.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `signOut() global encontrado em: ${offenders.join(", ")}`);
});
