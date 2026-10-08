import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EVENT_CATALOG } from "./eventCatalog";

// O banco recusa event_type fora do CHECK: catálogo e migration mais recente
// que define o CHECK precisam listar exatamente os mesmos tipos.
test("catálogo do Agent = CHECK de ops_events.event_type na migration mais recente", () => {
  const dir = path.resolve(__dirname, "..", "..", "..", "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /event_type\s+IN\s*\(/i.test(fs.readFileSync(path.join(dir, f), "utf-8")));
  const latest = fs.readFileSync(path.join(dir, files[files.length - 1]), "utf-8");
  const list = latest.match(/event_type\s+IN\s*\(([\s\S]*?)\)\)/i)?.[1] ?? "";
  const inDb = Array.from(list.matchAll(/'([A-Z_]+)'/g), (m) => m[1]).sort();
  assert.deepEqual(inDb, Object.keys(EVENT_CATALOG).sort());
});
