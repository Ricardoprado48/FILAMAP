# 04 — Jornadas do Usuário

Este documento resume as jornadas **como o código funciona hoje** e aponta a jornada-alvo quando diferente.

## 1. Acesso ao Web App — atual

1. Usuário abre o Filamap.
2. Informa e-mail e senha.
3. Frontend autentica via Supabase.
4. Após login, `loadData()` carrega impressora, AMS, estoque, catálogo e histórico.
5. O frontend repete a leitura a cada 3 segundos.

### Lacuna

Não existe fluxo de criação de conta/onboarding dentro do frontend auditado.

## 2. Instalação/conexão do Agent — atual

1. Configura-se `desktop-agent/.env` com Supabase, conta do Agent, serial, Access Code e opcionalmente IP.
2. Executa-se o Agent.
3. Ele autentica no Supabase.
4. Se não houver IP configurado, tenta broadcast UDP BBLP.
5. Localiza/cria a impressora no banco.
6. Conecta ao MQTT local.
7. Passa a enviar telemetria.

### Jornada-alvo

Instalação guiada, descoberta automática confiável, pedido de Access Code uma única vez, credenciais protegidas e nenhuma edição manual de `.env` pelo usuário final.

## 3. Monitorar impressão — atual

1. Agent recebe `gcode_state`, nome, progresso, tempos e outros dados MQTT.
2. Frontend mostra status ao vivo.
3. Ao iniciar um job, Agent tenta encontrar o `.3mf` via FTPS e parsear `slice_info.config`.
4. Estado do job é salvo em `agent-state.json`.
5. Ao finalizar/interromper, Agent calcula consumo, baixa saldo e grava `print_logs`.

### Pontos que exigem validação

- caminho remoto real do arquivo;
- estrutura real do slice info;
- mapeamento entre slice e AMS;
- jobs multicolor;
- duplicidade de eventos de finalização.

## 4. Cadastrar um carretel — atual

Pela aba **Tags**:

1. usuário escolhe marca, material, cor, peso bruto, tara e preço;
2. app calcula peso líquido;
3. gera/usa um Tag ID;
4. tenta gravar uma URL NFC no celular;
5. faz upsert do spool no Supabase.

### Observação

O app salva o spool mesmo que o fluxo de leitura posterior não esteja integrado.

## 5. Identificar carretel por NFC e associar ao AMS — intenção atual

Há código para:

1. ler uma tag e preencher `nfcUid`;
2. clicar em um slot vazio/ocupado;
3. localizar ou criar spool por `nfc_uid`;
4. associá-lo a `ams_slots`.

### Lacuna real

O `App.tsx` não chama `startScanning()`, e o parâmetro `?tag=` gravado na tag também não é interpretado. Logo, a jornada não está fechada na UI atual.

## 6. Re-pesar carretel — atual

1. usuário abre Estoque;
2. clica no botão de balança;
3. informa peso bruto e tara;
4. app grava `current_weight = bruto - tara`.

Esse fluxo serve hoje como recalibração manual do saldo.

## 7. Orçar uma peça — atual

1. usuário abre Orçamento → Simulador;
2. informa nome da peça, horas, pesos de até quatro filamentos e custos extras;
3. pode selecionar spools do inventário para usar seus preços;
4. app soma filamento, energia e depreciação;
5. aplica markup;
6. permite salvar no catálogo.

## 8. Jornada ideal de longo prazo

A visão registrada no projeto é:

**Criar conta → instalar Agent → detectar impressora → informar Access Code uma vez → cadastrar bobinas → produzir normalmente → Filamap acompanha e baixa automaticamente → usuário só age em exceções/reposição.**

O objetivo de produto é tornar a conversa com o sistema exceção, não rotina.
