import { describe, it, expect } from "vitest";
import { ipToInt, intToIp, prefixLength, hostsInRange } from "./discovery";

describe("ipToInt / intToIp", () => {
  it("converte IP para inteiro e volta sem perdas", () => {
    expect(ipToInt("192.168.1.10")).toBe(3232235786);
    expect(intToIp(3232235786)).toBe("192.168.1.10");
  });

  it("é reversível para vários IPs", () => {
    for (const ip of ["10.0.0.1", "192.168.0.254", "172.16.5.5"]) {
      expect(intToIp(ipToInt(ip))).toBe(ip);
    }
  });
});

describe("prefixLength", () => {
  it("calcula prefixo de uma /24", () => {
    expect(prefixLength(ipToInt("255.255.255.0"))).toBe(24);
  });

  it("calcula prefixo de uma /16", () => {
    expect(prefixLength(ipToInt("255.255.0.0"))).toBe(16);
  });

  it("calcula prefixo de uma /32", () => {
    expect(prefixLength(ipToInt("255.255.255.255"))).toBe(32);
  });
});

describe("hostsInRange", () => {
  it("varre uma /24 completa (254 hosts), excluindo o IP local", () => {
    const { ips, description } = hostsInRange("192.168.1.50", "255.255.255.0");
    expect(ips.length).toBe(253);
    expect(ips).not.toContain("192.168.1.50");
    expect(ips).toContain("192.168.1.1");
    expect(ips).toContain("192.168.1.254");
    expect(description).toContain("/24");
  });

  it("não retorna hosts para uma /32 (sem hosts para varrer)", () => {
    const { ips, description } = hostsInRange("192.168.1.50", "255.255.255.255");
    expect(ips).toEqual([]);
    expect(description).toContain("sem hosts");
  });

  it("assume uma /24 quando a máscara real ultrapassa o limite de varredura (ex: /16)", () => {
    const { ips, description } = hostsInRange("172.16.5.5", "255.255.0.0");
    // /16 real teria 65534 hosts (acima do limite) -- cai no fallback de /24
    // assumido a partir do IP local, que exclui o próprio IP (172.16.5.5) do resultado.
    expect(ips.length).toBe(253);
    expect(ips).not.toContain("172.16.5.5");
    expect(description).toContain("assumido a partir do IP local");
  });
});
