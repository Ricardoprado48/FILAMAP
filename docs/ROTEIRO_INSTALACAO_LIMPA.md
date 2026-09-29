# Roteiro — Instalação limpa (item 2.5 do plano)

**Caminho escolhido pelo Ricardo (29/09):** desinstalar tudo do próprio PC (`ops/desinstalar-tudo.ps1`, guarda a pasta de dados; `-Restaurar` volta) e reinstalar seguindo só o **Guia do Tester** (https://claude.ai/code/artifact/7b32725a-16f4-48c4-9324-b89211396e59), com a própria conta. O caminho abaixo (usuário Windows separado + conta nova) fica como alternativa para testar conta vazia.

Objetivo: fazer, neste PC, exatamente o que um tester vai fazer — conta nova, Windows sem nada do Filamap, baixar, instalar, parear, imprimir, ver o desconto — e anotar cada tropeço.

**Onde:** um usuário novo do Windows (`FilamapTeste`) e uma conta nova do Filamap na produção. A sua conta e o seu estoque não são tocados (a impressão de teste gasta ~1 g de filamento de verdade que a sua conta não vai registrar).

**Por que um usuário do Windows e não outro PC:** o Windows Home não tem Sandbox; um usuário novo não tem pasta do Filamap nem do Bambu Studio, igual ao PC de um tester.

## Antes (no seu usuário)

1. `& "C:\FILAMAP-staging\ops\o6-impressora-por-conta.ps1"` → **APLICAR**
   (sem isso a sua impressora não entra na conta de teste)
2. `& "C:\FILAMAP-staging\ops\publicar-web-producao.ps1"` → **PUBLICAR**
   (botão "Baixar o Filamap Agent" no painel 💻 Computadores)
3. Supabase (projeto de produção) → Authentication → Users → **Add user** → e-mail `rprado3d+teste1@gmail.com`, uma senha, marque **Auto Confirm User**.
4. PowerShell **como Administrador**: `& "C:\FILAMAP-staging\ops\usuario-windows-teste.ps1"` → senha → **CRIAR**
5. Impressora parada. **Iniciar › seu nome › Sair** (sair, não "trocar de usuário": o seu Agent precisa parar — a A1 aceita um Agent por vez).

## O teste (no usuário FilamapTeste)

Faça como um tester faria, sem atalhos. Anote (ou tire print) de tudo que confundir, travar ou demorar.

1. Abra o navegador → `filamap.pages.dev` → entre com `rprado3d+teste1@gmail.com`.
2. **💻 Computadores** → **Baixar o Filamap Agent** → abra o arquivo baixado.
3. Aviso azul do Windows → **Mais informações** → **Executar assim mesmo** → instale.
4. Na janela do Agent: e-mail da conta de teste; na Web, **Conectar computador** → digite o código; Access Code da impressora.
5. Confira na Web: o computador aparece como conectado; a impressora aparece.
6. Cadastre **1 carretel** (o que está no AMS) e ligue ao slot dele.
7. Imprima algo pequeno (1–2 g) até o fim → confira o desconto no carretel.

## Depois

1. **Sair** do FilamapTeste → entre no seu usuário.
2. `& "C:\FILAMAP-staging\ops\o5-instalar-agent.ps1"` → **INSTALAR** — devolve o início automático ao seu usuário (hoje a tarefa de início automático é uma só por PC; o teste a passa para o FilamapTeste).
3. Me mande as anotações. Eu confiro na Central (a instalação do FilamapTeste aparece lá).
4. Quando não precisar mais: PowerShell como Administrador → `& "C:\FILAMAP-staging\ops\usuario-windows-teste.ps1" -Remover` → **REMOVER**.

## Limitações conhecidas (já sabidas, não precisa anotar)

- Instalador sem assinatura digital → aviso azul do Windows (item 4.4).
- Um usuário do Windows por PC com Agent (tarefa de início automático única).
- Modelo da impressora gravado sempre como "A1" (corrigir antes de testers com P1S/X1C).
