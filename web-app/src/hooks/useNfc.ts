import { useState, useCallback } from "react";

// writeTagUrl grava o ID lógico do carretel dentro de uma URL
// (https://.../?tag=<id>) como registro NDEF "url" — não usa o serial
// number de hardware do chip. Pra casar a leitura com o que foi gravado
// (e com spools.nfc_uid, que guarda o <id> puro), é preciso decodificar o
// mesmo registro NDEF na leitura, em vez de usar event.serialNumber.
function extractTagIdFromMessage(message: any): string | null {
  if (!message || !message.records) return null;
  for (const record of message.records) {
    // "absolute-url" cobre leitores/chips que não normalizam o record type
    // de uma URI NDEF para "url" — mesmo conteúdo, rótulo diferente.
    if (record.recordType !== "url" && record.recordType !== "absolute-url" && record.recordType !== "text") continue;
    try {
      const decoder = new TextDecoder(record.encoding || "utf-8");
      const text = decoder.decode(record.data).trim();
      try {
        const url = new URL(text);
        const tagParam = url.searchParams.get("tag");
        if (tagParam) return tagParam;
      } catch {
        // texto não é uma URL absoluta válida (ex.: prefixo do identifier
        // code da URI NDEF não expandido pelo leitor) — tenta extrair
        // "tag=" direto da query string bruta antes de desistir do registro
        const match = text.match(/[?&]tag=([^&#]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    } catch {
      // registro não decodifica como texto válido — tenta o próximo
    }
  }
  return null;
}

export function useNfc() {
  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [nfcUid, setNfcUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writeSuccess, setWriteSuccess] = useState(false);

  // Inicia leitura de tag aproximada
  const startScanning = useCallback(async () => {
    if (!("NDEFReader" in window)) {
      setError("Web NFC não suportado neste dispositivo. Acesse pelo Chrome no Android.");
      return;
    }

    try {
      setIsReading(true);
      setError(null);
      // @ts-ignore
      const ndef = new window.NDEFReader();
      await ndef.scan();

      ndef.onreading = (event: any) => {
        const tagId = extractTagIdFromMessage(event.message) || event.serialNumber || `TAG_${Date.now()}`;
        setNfcUid(tagId);
        setIsReading(false);
      };

      ndef.onreadingerror = () => {
        setError("Erro ao ler tag física. Aproxime novamente.");
        setIsReading(false);
      };
    } catch (err: any) {
      setError(err.message || "Permissão NFC negada.");
      setIsReading(false);
    }
  }, []);

  // Grava URL oficial diretamente no chip NFC
  const writeTagUrl = useCallback(async (fullUrl: string) => {
    if (!("NDEFReader" in window)) {
      setError("Web NFC não suportado para escrita. Use o Chrome no celular.");
      return false;
    }

    try {
      setIsWriting(true);
      setError(null);
      setWriteSuccess(false);

      // @ts-ignore
      const ndef = new window.NDEFReader();
      await ndef.write({
        records: [
          {
            recordType: "url",
            data: fullUrl,
          },
        ],
      });

      setWriteSuccess(true);
      setIsWriting(false);
      if ("vibrate" in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
      return true;
    } catch (err: any) {
      setError("Falha na gravação: " + (err.message || "Aproxime a tag com firmeza."));
      setIsWriting(false);
      return false;
    }
  }, []);

  return {
    isReading,
    isWriting,
    writeSuccess,
    nfcUid,
    error,
    startScanning,
    writeTagUrl,
    setNfcUid,
    setError,
    setWriteSuccess,
  };
}