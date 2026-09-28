import { useEffect, useState } from "react";

// Botão "Instalar app": Android/computador (Chrome/Edge) usam o instalador do
// navegador; iPhone/iPad não têm esse instalador -- o caminho é o Compartilhar do Safari.

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const ios = isIos();

  async function install() {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    if (ios) {
      alert('No iPhone/iPad: abra o Filamap no Safari, toque em Compartilhar (quadrado com a seta) e depois em "Adicionar à Tela de Início".');
    }
  }

  return { canInstall: !installed && (deferred !== null || ios), install };
}
