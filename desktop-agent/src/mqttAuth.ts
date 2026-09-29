// A impressora recusou o Access Code? (CONNACK 5 "Not authorized" ou 4 "Bad
// username or password"). Queda de rede, impressora desligada ou reinício dão
// outros erros (ECONNRESET, ETIMEDOUT, EHOSTUNREACH) e NÃO contam aqui.
export function isAccessCodeRejected(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 4 || e.code === 5) return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /not authori[sz]ed|bad user ?name or password/i.test(msg);
}
