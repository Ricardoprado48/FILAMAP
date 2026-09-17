import { useState, useCallback } from "react";

export function useNfc() {
  const [isReading, setIsReading] = useState(false);
  const [nfcUid, setNfcUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startScanning = useCallback(async () => {
    if (!("NDEFReader" in window)) {
      setError("NFC indisponível. No desktop, use inserção manual.");
      return;
    }

    try {
      setIsReading(true);
      setError(null);
      // @ts-ignore
      const ndef = new window.NDEFReader();
      await ndef.scan();

      ndef.onreading = (event: any) => {
        setNfcUid(event.serialNumber || `NFC_${Date.now()}`);
        setIsReading(false);
      };

      ndef.onreadingerror = () => {
        setError("Erro ao ler a tag NFC.");
        setIsReading(false);
      };
    } catch (err: any) {
      setError(err.message || "Permissão NFC recusada.");
      setIsReading(false);
    }
  }, []);

  return { isReading, nfcUid, error, startScanning, setNfcUid };
}
