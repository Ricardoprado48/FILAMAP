import { useState, useCallback } from "react";

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
        const serial = event.serialNumber || `TAG_${Date.now()}`;
        setNfcUid(serial);
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