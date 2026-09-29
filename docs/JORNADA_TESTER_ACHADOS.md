# Jornada do tester — achados da reinstalação real (29/09)

Fonte: Ricardo desinstalou tudo (`ops/desinstalar-tudo.ps1`) e reinstalou só com o Guia do Tester, na própria conta.
Resultado: **funcionou** (pareado 13:56Z, impressora achada sozinha, MQTT conectado, telemetria entregue), mas com atritos.

| # | Onde | O que aconteceu | Correção proposta | Versão |
|---|---|---|---|---|
| J1 | Download | Navegador marca o .exe como suspeito | Assinatura digital (item 4.4); até lá, o guia mostra a tela e onde clicar ("Manter") | 4.4 / guia |
| J2 | Instalador | SmartScreen "O Windows protegeu o computador" | Idem; guia com imagem | 4.4 / guia |
| J3 | Janela do Agent | Fica sempre na frente (TopMost) e cobre o site onde está o código | Tirar TopMost; abrir ao lado; botão **Abrir o Filamap** que leva a `?computadores=1` com o código | Agent 4.2.1 + Web |
| J4 | Janela do Agent | Fechar a janela encerra o Agent sem aviso; só volta pelo atalho | Ao cancelar: aviso "Configuração não concluída — abra o atalho Filamap para continuar"; não registrar como UNHANDLED_REJECTION na Central | Agent 4.2.1 |
| J5 | Depois de conectar | A janela some e não se sabe se deu certo | Tela final "Pronto! Computador conectado à impressora <modelo>" (ou notificação do Windows) + Web mostra o computador online | Agent 4.2.1 |
| J6 | Guia | Mandava digitar e-mail; a janela não pede | Corrigido no guia | ✅ |
| J7 | Site | Abre direto no estoque (sessão salva do navegador) | Normal; guia orienta janela anônima para testar como tester | ✅ guia |

Já na lista da 4.2.1: IP local nos eventos (privacidade), modelo gravado sempre "A1", JOB_DETECTED com 0 g.

## Implementado (4612db4, Agent 4.2.1 — instalador 5E8505B8…, agent 680A0F0E…)

- J3 janela no canto, sem ficar presa na frente; botão "Abrir o Filamap para pegar o código" (`?computadores=1` abre o painel)
- J4 fechar a janela: aviso "abra o atalho Filamap" + encerra limpo (código 0; não vira UNHANDLED_REJECTION)
- J5 aviso "Pronto! Este computador está conectado…" no primeiro MQTT conectado após a configuração
- Novos: código de pareamento recusado → aviso com o motivo; Access Code recusado pela impressora (fora de impressão) → aviso + janela só do Access Code
- Web: 🚀 Primeiros passos (lista automática), /guia (Access Code por modelo; A1 exige LAN Only Mode ligado para ver o código — confirmar na A1 do Ricardo), /privacidade, aceite do aviso no cadastro (signup-invite grava versão + data)
- Privacidade: IP mascarado nos eventos; modelo real da impressora; JOB_DETECTED com gramas
- Teste real: `ops/o4-teste-agent.ps1 -Limpo` (banco de teste, pasta vazia, site de staging)
