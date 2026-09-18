# GEMINI.md — Instruções permanentes do projeto Filamap

Este arquivo é a porta de entrada obrigatória para qualquer nova conversa ou agente de IA que trabalhe neste repositório.

## 1. Regra principal

**A conversa não é a memória oficial do projeto.**

A ordem de precedência para decidir o que é verdade é:

1. código atualmente versionado no repositório;
2. migrations e configuração realmente presentes no repositório;
3. `docs/07_CURRENT_STATE.md`;
4. documentação técnica em `docs/`;
5. `FILAMAP_ARQUITETURA_DA_JORANDA_DO_USUARIO.md` como visão de produto/arquitetura-alvo;
6. histórico de conversa apenas como contexto auxiliar.

Se documentação e código divergirem, **não escolha silenciosamente um dos dois**. Informe a divergência e trate o código atual como estado implementado até que a documentação seja corrigida.

## 2. Leitura obrigatória antes de alterar código

Antes de qualquer implementação:

1. Leia este `GEMINI.md`.
2. Leia `docs/00_PROJECT_CONTEXT.md`.
3. Leia `docs/07_CURRENT_STATE.md`.
4. Leia `docs/08_BACKLOG.md`.
5. Consulte os documentos específicos em `docs/` relacionados à tarefa.
6. Inspecione os arquivos de código afetados antes de propor alterações.

Não é necessário reler integralmente o documento grande de jornada em toda tarefa. Consulte as seções relevantes quando a mudança envolver produto, consumo, AMS, MQTT, FTPS, NFC, onboarding ou arquitetura-alvo.

## 3. Forma de trabalho

- Não invente arquitetura, tabelas, endpoints, campos ou funcionalidades.
- Não recrie algo sem antes procurar se já existe.
- Não amplie o escopo sem autorização.
- Preserve comportamento existente que não faz parte da tarefa.
- Prefira alterações pequenas, rastreáveis e reversíveis.
- Não troque stack, biblioteca central ou padrão arquitetural sem registrar a decisão.
- Não trate código de protótipo como produção sem validar suas premissas.
- Não diga que algo foi testado se não executou o teste.
- Não diga que algo está em produção só porque existe no código.
- Não assuma que o banco remoto é idêntico às migrations locais.

## 4. Antes de implementar

Faça uma análise curta contendo:

- o que encontrou no estado atual;
- quais arquivos serão alterados;
- qual comportamento será preservado;
- quais riscos ou dependências existem.

Se houver uma divergência importante entre documentação, migrations e código, sinalize antes de seguir.

## 5. Depois de implementar

Informe objetivamente:

- arquivos alterados;
- comportamento implementado;
- validações/testes executados;
- o que não foi possível validar;
- pendências restantes.

Atualize a documentação **somente quando a alteração mudar o estado real do produto**:

- `docs/07_CURRENT_STATE.md` — estado funcional atual;
- `docs/08_BACKLOG.md` — pendências/prioridades;
- `docs/09_CHANGELOG.md` — alterações relevantes;
- `docs/06_DECISIONS.md` — decisões arquiteturais ou de produto duradouras;
- outros documentos de `docs/` quando a mudança os tornar incorretos.

## 6. Regras de negócio que não devem ser alteradas sem decisão explícita

- O objetivo do Filamap é reduzir ao mínimo o controle manual de filamento.
- Tara do carretel não faz parte do saldo líquido de filamento.
- O Desktop Agent deve ser a ponte local com a Bambu Lab; regras complexas de negócio não devem ficar espalhadas nele sem necessidade.
- Credenciais LAN da impressora devem permanecer locais sempre que possível e nunca ser documentadas em texto claro.
- Isolamento de dados por usuário via RLS é obrigatório.
- Baixa de estoque deve ser idempotente/segura contra duplicidade antes de ser considerada confiável para produção.
- Não inventar consumo quando o dado autoritativo não estiver disponível sem deixar explícita a qualidade/origem da estimativa.

## 7. Segurança e segredos

- Nunca copie valores de `.env` para documentação, logs, prompts ou commits.
- Existe um `.env` dentro de `desktop-agent/` no pacote auditado. Trate-o como segredo local e mantenha-o fora do versionamento.
- A anon key do Supabase no frontend não é, por si só, um segredo; a segurança depende de RLS corretamente configurado.
- Não usar `service_role` no frontend ou em código distribuído ao cliente.

## 8. Supabase

Antes de qualquer alteração de banco:

- conferir `supabase/migrations/`;
- conferir as referências reais no frontend e no Agent;
- não presumir que tabelas criadas manualmente no dashboard estão reproduzidas nas migrations;
- criar migration idempotente quando possível;
- manter RLS/policies coerentes com `auth.uid()`;
- evitar `SECURITY DEFINER` sem validação explícita de proprietário e `search_path` seguro.

## 9. Desktop Agent / Bambu Lab

As integrações MQTT, FTPS, descoberta e parsing do `.3mf` ainda possuem premissas que precisam de validação em hardware real. Não transformar hipótese em fato.

Em especial, validar antes de considerar concluído:

- caminho do `.gcode.3mf` via FTPS;
- estrutura real de `Metadata/slice_info.config`;
- relação entre IDs do slice e slots físicos do AMS;
- troca de filamento durante jobs multicolor;
- reconexão/redescoberta quando o IP muda;
- idempotência da finalização de jobs.

## 10. Documentação principal

- `docs/00_PROJECT_CONTEXT.md` — visão rápida e objetivo do produto.
- `docs/01_ARCHITECTURE.md` — arquitetura implementada e alvo.
- `docs/02_DATABASE.md` — schema conhecido, RLS e lacunas de migrations.
- `docs/03_FEATURES.md` — funcionalidades e grau de implementação.
- `docs/04_USER_JOURNEYS.md` — jornadas reais e desejadas.
- `docs/05_BUSINESS_RULES.md` — regras duradouras.
- `docs/06_DECISIONS.md` — decisões e ADRs resumidos.
- `docs/07_CURRENT_STATE.md` — snapshot operacional atual.
- `docs/08_BACKLOG.md` — pendências priorizadas.
- `docs/09_CHANGELOG.md` — histórico técnico relevante.
- `FILAMAP_ARQUITETURA_DA_JORANDA_DO_USUARIO.md` — documento detalhado de visão e arquitetura de produto.

## 11. Regra para encerrar uma sessão de IA

Antes de encerrar um bloco significativo de trabalho, garanta que `docs/07_CURRENT_STATE.md` e `docs/08_BACKLOG.md` continuam verdadeiros. Se uma decisão permanente mudou, registre em `docs/06_DECISIONS.md`.

O objetivo é permitir que uma conversa nova continue o projeto sem depender da memória da conversa anterior.
