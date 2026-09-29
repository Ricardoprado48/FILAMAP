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
