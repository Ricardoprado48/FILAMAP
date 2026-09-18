# 08 — Backlog Priorizado

Este backlog foi criado a partir do código auditado em 18/09/2026. Prioridade indica risco técnico/operacional, não esforço.

## P0 — Integridade e confiança do núcleo

### P0.1 — Reconciliar banco remoto com migrations

**Problema:** migrations locais não criam todo o schema que o código usa.

**Concluído quando:** um projeto Supabase vazio consegue receber todas as migrations e executar Web App + Agent sem criação manual no dashboard.

### P0.2 — Idempotência + transação de finalização

**Problema:** baixa do spool e criação de log são operações separadas e repetíveis.

**Objetivo:** criar identidade estável do job/evento e uma operação atômica no banco que:

- verifique dono;
- impeça duplicação;
- desconte saldo;
- grave movimentos/logs;
- marque job finalizado.

### P0.3 — Corrigir consumo multicolor/AMS

**Problema:** job atual tende a descontar um único spool.

**Objetivo:** mapear todos os filamentos usados pelo job para seus slots/spools e aplicar consumo individual.

### P0.4 — Validar FTPS + `slice_info.config` com arquivos reais

Criar conjunto de amostras reais:

- uma cor;
- 2+ cores;
- suporte;
- flush/purga;
- impressão interrompida.

Registrar estrutura observada e criar testes de parser.

### P0.5 — Política de fallback de consumo

Decidir e documentar o que acontece se não houver peso autoritativo.

O comportamento atual (`0,22 g/min` / fallback 35 g) não deve ser tratado como exato. Definir se:

- estima e marca qualidade;
- pede reconciliação;
- não baixa até obter dado melhor;
- outra política explicitamente aprovada.

## P1 — Fechar os fluxos atuais

### P1.1 — Leitura NFC no frontend

- [x] integrar `startScanning()` à UI (botão "Ler tag NFC" por slot do AMS);
- [x] resolver spool por tag lida (associa existente ou auto-cria);
- [x] fluxo claro de associação ao slot (por slot, com timeout/cancelamento);
- [ ] ler `?tag=` no carregamento (deep link passivo — ainda não
      interpretado; mecanismo separado do scan ativo acima).

### P1.2 — Descoberta/re-descoberta robusta

Integrar estratégia em camadas:

1. descoberta rápida;
2. mecanismo alternativo/varredura controlada;
3. entrada manual de IP;
4. redescoberta quando conexão persistente falhar.

### P1.3 — Schema de qualidade do consumo

Adicionar origem/qualidade ao log/movimento, evitando que estimado pareça exato.

### P1.4 — Histórico/ledger de movimentos

Registrar não só impressão, mas também:

- cadastro inicial;
- baixa por job;
- re-pesagem;
- correção manual;
- descarte/fim de bobina.

### P1.5 — Testes automatizados

Mínimo:

- parser 3MF/XML;
- cálculo de consumo;
- baixa idempotente;
- RLS;
- cálculo de tara;
- orçamento.

## P2 — Produto comercial

### P2.1 — Onboarding do Agent

Eliminar necessidade do usuário editar `.env`.

### P2.2 — Armazenamento seguro do Access Code

Usar mecanismo seguro do SO/credencial local em vez de arquivo texto como solução final.

### P2.3 — Instalador/auto-start/auto-update

Empacotamento robusto para Windows e, se desejado, outros sistemas.

### P2.4 — Offline queue

Persistir eventos/ações quando Supabase estiver indisponível e sincronizar com idempotência.

### P2.5 — Alertas de estoque baixo

Após saldo confiável, adicionar alertas e previsão.

### P2.6 — UX/refatoração do frontend

`App.tsx` concentra quase toda a aplicação. Separar componentes, hooks e serviços quando a base funcional estiver estável.

## P3 — Evoluções da visão

- workspaces/equipes;
- farm management;
- previsão de autonomia;
- custo por job automatizado;
- análise de desperdício;
- compras/reposição;
- rastreabilidade por lote.
