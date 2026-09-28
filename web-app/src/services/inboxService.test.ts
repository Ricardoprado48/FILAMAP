import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase, type FakeQueryCall } from "../testUtils/fakeSupabase";
import { queueUnknownNfcTag, linkInboxItemToSpool, applyPresetRename, canLinkInboxItem } from "./inboxService";
import { archiveSpool } from "./spoolService";
import type { Spool, SpoolInboxItem, UserFilamentProfile } from "../types";

let calls: FakeQueryCall[];

function useFake(resolve: (call: FakeQueryCall) => { data: any; error: any } = (c) => ({ data: [{ id: c.filters[0]?.val ?? "x" }], error: null })) {
  calls = [];
  const fake = createFakeSupabase((call) => {
    calls.push(call);
    return resolve(call);
  });
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation(fake.from as any);
}

const spool = (over: Partial<Spool> = {}): Spool => ({
  id: "s1", nfc_uid: "", brand: "Voolt3D", material: "PLA", color_name: "Azul", color_hex: "#00F", current_weight: 800, ...over,
});
const item = (over: Partial<SpoolInboxItem>): SpoolInboxItem => ({
  id: "i1", source: "nfc", external_id: "TAG-1", payload: {}, status: "pending", ...over,
});

beforeEach(() => useFake());

describe("queueUnknownNfcTag", () => {
  it("tag desconhecida vira item pendente (reabre se já existia) e nunca toca em spools", async () => {
    await queueUnknownNfcTag("TAG-9", "printer-1", 2, "2026-09-28T20:00:00Z");
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spool_inbox");
    expect(calls[0].method).toBe("upsert");
    expect(calls[0].payload).toMatchObject({ source: "nfc", external_id: "TAG-9", status: "pending", payload: { slot_index: 2, printer_id: "printer-1" } });
  });
});

describe("linkInboxItemToSpool", () => {
  it("NFC: grava só nfc_uid no carretel escolhido e marca o item como ligado", async () => {
    await linkInboxItemToSpool(item({}), spool());
    expect(calls[0]).toMatchObject({ table: "spools", method: "update", payload: { nfc_uid: "TAG-1" } });
    expect(Object.keys(calls[0].payload)).toEqual(["nfc_uid"]);
    expect(calls[1]).toMatchObject({ table: "spool_inbox", method: "update" });
    expect(calls[1].payload).toMatchObject({ status: "linked", resolved_spool_id: "s1" });
  });

  it("nuvem Bambu: grava só bambu_spool_id; recusa carretel já ligado a outro registro", async () => {
    await linkInboxItemToSpool(item({ source: "bambu_cloud", external_id: "8594733" }), spool());
    expect(calls[0].payload).toEqual({ bambu_spool_id: "8594733" });

    useFake();
    const res = await linkInboxItemToSpool(item({ source: "bambu_cloud", external_id: "8594733" }), spool({ bambu_spool_id: "111" }));
    expect(res.error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("troca de vínculo com a nuvem só com confirmação explícita (cadastro recriado na Bambu)", async () => {
    await linkInboxItemToSpool(item({ source: "bambu_cloud", external_id: "16151332" }), spool({ bambu_spool_id: "15073794" }), { replaceCloudLink: true });
    expect(calls[0].payload).toEqual({ bambu_spool_id: "16151332" });
    expect(calls[1].payload).toMatchObject({ status: "linked", resolved_spool_id: "s1" });
  });

  it("0 linhas afetadas (RLS) não resolve o item", async () => {
    useFake(() => ({ data: [], error: null }));
    const res = await linkInboxItemToSpool(item({}), spool());
    expect(res.error).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("RFID e preset renomeado não podem ser ligados a carretel", () => {
    expect(canLinkInboxItem(item({ source: "rfid" }))).toBe(false);
    expect(canLinkInboxItem(item({ source: "preset_renamed" }))).toBe(false);
    expect(canLinkInboxItem(item({ source: "bambu_cloud" }))).toBe(true);
  });
});

describe("applyPresetRename (D6)", () => {
  it("liga o perfil novo ao MESMO produto e renomeia o produto (ID mantido)", async () => {
    const prof = { id: "prof-new", display_name: "+ PLA NOME NOVO" } as UserFilamentProfile;
    await applyPresetRename(item({ source: "preset_renamed", suggested_product_id: "p1" }), prof);
    expect(calls[0]).toMatchObject({ table: "user_filament_profiles", payload: { filament_product_id: "p1" } });
    expect(calls[0].filters).toEqual([{ col: "id", val: "prof-new" }]);
    expect(calls[1]).toMatchObject({ table: "filament_products", payload: { name: "+ PLA NOME NOVO" } });
    expect(calls[1].filters).toEqual([{ col: "id", val: "p1" }]);
    expect(calls[2].payload).toMatchObject({ status: "linked" });
  });
});

describe("archiveSpool (D4)", () => {
  it("tira do AMS e marca archived_at; nunca apaga", async () => {
    await archiveSpool("s1", "2026-09-28T20:00:00Z");
    expect(calls.map((c) => [c.table, c.method])).toEqual([["ams_slots", "update"], ["spools", "update"]]);
    expect(calls[1].payload).toEqual({ archived_at: "2026-09-28T20:00:00Z" });
    expect(calls.some((c) => c.method === "delete")).toBe(false);
  });
});
