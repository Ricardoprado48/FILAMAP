# 06 — Registro de Decisões do Projeto

Este arquivo registra decisões duradouras identificadas no repositório. Novas decisões devem receber o próximo número.

## DEC-001 — Supabase como backend principal

**Status:** adotada  
**Decisão:** usar Supabase para autenticação, PostgreSQL, RLS e acesso de frontend/Agent.

## DEC-002 — Desktop Agent como ponte local

**Status:** adotada  
**Decisão:** comunicação com a impressora Bambu Lab acontece por processo local, não diretamente pelo navegador/cloud.

**Motivo:** MQTT/FTPS e descoberta dependem da rede local.

## DEC-003 — MQTT local Bambu Lab

**Status:** implementada com validações contínuas  
**Decisão:** monitorar a impressora via MQTT TLS, usuário `bblp`, Access Code local.

## DEC-004 — FTPS + `.3mf` para consumo do slicer

**Status:** parcialmente implementada  
**Decisão:** tentar obter dados de consumo a partir do arquivo `.3mf` e de `Metadata/slice_info.config`.

**Pendência:** confirmar caminho/estrutura/mapeamento em hardware e jobs reais.

## DEC-005 — NFC como identidade do spool

**Status:** parcialmente implementada  
**Decisão:** cada carretel pode receber uma identidade NFC e ser associado ao AMS.

**Pendência:** fechar o fluxo de leitura/deep link no frontend.

## DEC-006 — Saldo líquido separado da tara

**Status:** implementada no modelo atual  
**Decisão:** `current_weight` representa filamento líquido; tara é campo separado.

## DEC-007 — RLS por `user_id`

**Status:** implementada nas migrations de hardening  
**Decisão:** dados operacionais são isolados pelo proprietário autenticado.

## DEC-008 — Persistir job ativo localmente

**Status:** implementada  
**Decisão:** salvar o estado do trabalho em `agent-state.json` para sobreviver a reinício do Agent.

## DEC-009 — Código + docs são a memória do projeto

**Status:** adotada em 18/09/2026  
**Decisão:** nenhuma conversa de IA deve ser tratada como fonte oficial de contexto. Novas conversas devem começar por `GEMINI.md` e `docs/`.

**Motivo:** conversas longas perderam contexto e passaram a contradizer decisões/código existentes.

## DEC-010 — Desacoplamento Semântico de Status: Agent ≠ Impressora

**Status:** implementada em 27/09/2026 (Fase H)  
**Decisão:** Agent e Impressora possuem estados operacionais independentes no header e status card:
1. **Agent Status:**
   - `ONLINE`: heartbeat `last_seen_at` atualizado em menos de 45s (cadência nominal 15s).
   - `OFFLINE`: heartbeat ausente ou expirado (>= 45s).
   - `VERIFICANDO`: estado inicial de startup antes da primeira carga.
2. **Impressora Status:**
   - `ONLINE`: Agent Online E telemetria recente da impressora (< 60s) com `is_online === true`.
   - `OFFLINE`: Agent Online E telemetria expirada/desconectada (`is_online === false`).
   - `SEM COMUNICAÇÃO`: Agent Offline (ausência de observador confiável impede atestar se a impressora física está ligada/desligada).
   - `VERIFICANDO`: estado inicial de startup.

## DEC-011 — Perfil de Fatiador ≠ Carretel Físico

**Status:** implementada em 27/09/2026 (Fase I)  
**Decisão:** Perfis de filamento de fatiadores (BambuStudio, BambuStudioBeta, OrcaSlicer) são receitas lógicas sincronizadas para `user_filament_profiles`. Elas auxiliam no preenchimento de cadastros de carretéis (marca, material, cor nominal, tom hex, densidade), mas carretéis físicos (`spools`) exigem conferência de peso líquido e tara e NUNCA são criados automaticamente por perfis de fatiador. Um perfil pode ter zero ou N carretéis físicos associados.

## DEC-012 — Localização Física e NFC Desacoplados

**Status:** implementada em 27/09/2026 (Fase I)  
**Decisão:** A coluna `spools.location` é a fonte única da verdade para localização de carretéis armazenados fora da impressora (spots físicos). A tag NFC é uma identidade física opcional de conveniência/atalho. O vínculo ou desvinculação de NFC (`Desvincular NFC`) é estritamente isolado e preserva integralmente saldo líquido, tara, histórico de impressões e localização do carretel. Conflitos de spots ocupados exigem confirmação explícita de transferência de posse.

## Decisões ainda NÃO tomadas

Os itens abaixo aparecem como visão ou necessidade, mas não devem ser tratados como arquitetura já aprovada em implementação:

- estrutura final de multi-tenancy/workspaces;
- formato definitivo de ledger de movimentos;
- política definitiva quando não houver peso autoritativo do slicer;
- formato de instalador/auto-update do Agent;
- estratégia final de descoberta de rede;
- modelo definitivo de idempotência de jobs;
- arquitetura de eventos/offline queue.
