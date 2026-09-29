// Modelo da impressora a partir do prefixo do número de série Bambu Lab.
// Antes o Agent gravava sempre "A1" em printers.model.
// Prefixos: 039 = A1 (conferido na A1 do piloto); os demais seguem a tabela usada
// pela integração ha-bambulab. Prefixo desconhecido -> null (o chamador não
// sobrescreve o que já estiver gravado).

const PREFIXES: Array<[string, string]> = [
  ["039", "A1"],
  ["030", "A1 mini"],
  ["01S", "P1P"],
  ["01P", "P1S"],
  ["00M", "X1 Carbon"],
  ["00W", "X1"],
  ["03W", "X1E"],
  ["094", "H2D"],
];

export function printerModelFromSerial(serial: string | null | undefined): string | null {
  const s = (serial ?? "").trim().toUpperCase();
  if (s.length < 3) return null;
  for (const [prefix, model] of PREFIXES) {
    if (s.startsWith(prefix)) return model;
  }
  return null;
}
