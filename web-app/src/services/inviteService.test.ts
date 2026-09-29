import { describe, expect, it } from "vitest";
import { SignupInvite, inviteCodeFromSearch, inviteLink, inviteMessage, inviteStatus, signupErrorMessage } from "./inviteService";

const base: SignupInvite = {
  id: "i1",
  label: "João",
  max_uses: 1,
  used_count: 0,
  expires_at: "2026-10-10T00:00:00Z",
  created_at: "2026-09-29T00:00:00Z",
  revoked_at: null,
  emails: null,
};
const now = Date.parse("2026-10-01T00:00:00Z");

describe("inviteStatus", () => {
  it("ativo enquanto tem uso livre e não venceu", () => {
    expect(inviteStatus(base, now)).toBe("ativo");
  });
  it("esgotado quando usou todos", () => {
    expect(inviteStatus({ ...base, used_count: 1 }, now)).toBe("esgotado");
  });
  it("vencido depois da validade", () => {
    expect(inviteStatus(base, Date.parse("2026-10-11T00:00:00Z"))).toBe("vencido");
  });
  it("cancelado vence qualquer outro estado", () => {
    expect(inviteStatus({ ...base, used_count: 1, revoked_at: "2026-09-30T00:00:00Z" }, now)).toBe("cancelado");
  });
});

describe("link e código do convite", () => {
  it("monta o link com o código", () => {
    expect(inviteLink("ABCDE-FGHJK", "https://filamap.pages.dev/")).toBe("https://filamap.pages.dev/?convite=ABCDE-FGHJK");
  });
  it("lê o código do link, em maiúsculas", () => {
    expect(inviteCodeFromSearch("?convite=abcde-fghjk")).toBe("ABCDE-FGHJK");
    expect(inviteCodeFromSearch("?x=1")).toBe("");
  });
  it("a mensagem pronta traz o link e o código", () => {
    const m = inviteMessage("ABCDE-FGHJK", "https://filamap.pages.dev", "2026-10-10T12:00:00Z");
    expect(m).toContain("https://filamap.pages.dev/?convite=ABCDE-FGHJK");
    expect(m).toContain("ABCDE-FGHJK");
  });
});

describe("signupErrorMessage", () => {
  it("traduz os erros conhecidos", () => {
    expect(signupErrorMessage("email_exists")).toMatch(/já tem conta/);
    expect(signupErrorMessage("invalid_invite")).toMatch(/Convite inválido/);
  });
  it("erro desconhecido vira mensagem genérica", () => {
    expect(signupErrorMessage(undefined)).toMatch(/Não foi possível/);
    expect(signupErrorMessage("xpto")).toMatch(/Não foi possível/);
  });
});
