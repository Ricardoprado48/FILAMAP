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

## Decisões ainda NÃO tomadas

Os itens abaixo aparecem como visão ou necessidade, mas não devem ser tratados como arquitetura já aprovada em implementação:

- estrutura final de multi-tenancy/workspaces;
- formato definitivo de ledger de movimentos;
- política definitiva quando não houver peso autoritativo do slicer;
- formato de instalador/auto-update do Agent;
- estratégia final de descoberta de rede;
- modelo definitivo de idempotência de jobs;
- arquitetura de eventos/offline queue.
