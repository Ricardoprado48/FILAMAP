# GEMINI.md — Instruções permanentes do projeto Filamap

Este arquivo é a porta de entrada obrigatória para qualquer nova conversa ou agente de IA que trabalhe neste repositório.

## 1. Regra principal

**A ordem de precedência para decidir o que é verdade sobre o projeto é:**

1. `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md` — **fonte oficial de estado e
   visão do projeto**, por decisão explícita do responsável pelo produto.
   Contém, na Seção 62, o estado real de implementação mais atual
   conhecido, incluindo achados de auditorias técnicas.
2. código atualmente versionado no repositório;
3. migrations e configuração realmente presentes no repositório;
4. `docs/07_CURRENT_STATE.md` e demais documentação técnica em `docs/`;
5. histórico de conversa apenas como contexto auxiliar.

Se `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md` e o código divergirem, **não
escolha silenciosamente um dos dois**. Informe a divergência e sinalize
para que a Seção 62 daquele documento seja atualizada — ela é o registro
que deve refletir a realidade mais recente confirmada.

A documentação em `docs/00`–`09` continua útil como detalhamento técnico
(schema, features, regras de negócio, backlog), mas qualquer conflito
sobre **estado atual do projeto** é resolvido a favor de
`FILAMAP_USER_JOURNEY_ARQUITETURA (2).md`.

## 1.1 Snapshot vigente — 24/09/2026

- branch oficial: `main`;
- baseline confirmado: `3ce850a`;
- Agent: build PASS, 106/106 unitários PASS, 13/13 integração PASS;
- Web: 33/33 testes PASS e build produção PASS;
- migrations local/remoto alinhadas até `20260923120000`;
- o Agent instalado usado na última homologação física é anterior a
  `3ce850a` e não valida a resolução física nova;
- não tratar a prioridade Bambu Cloud × NFC como homologada até teste de
  hardware com a release atual e Golden Test.

## 2. Leitura obrigatória antes de alterar código

Antes de qualquer implementação:

1. Leia este `GEMINI.md`.
2. Leia `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md`, especialmente a Seção 62
   (estado real) e as seções de regras/princípios de produto.
3. Leia `docs/00_PROJECT_CONTEXT.md` e `docs/07_CURRENT_STATE.md` como
   apoio técnico complementar.
4. Leia `docs/08_BACKLOG.md`.
5. Consulte os documentos específicos em `docs/` relacionados à tarefa.
6. Inspecione os arquivos de código afetados antes de propor alterações.

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

- o que encontrou no estado atual (cruzando código real com a Seção 62 de
  `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md`);
- quais arquivos serão alterados;
- qual comportamento será preservado;
- quais riscos ou dependências existem.

Se houver uma divergência importante entre `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md`, migrations e código, sinalize antes de seguir — não decida sozinho qual está certo.

## 5. Depois de implementar

Informe objetivamente:

- arquivos alterados;
- comportamento implementado;
- validações/testes executados;
- o que não foi possível validar;
- pendências restantes.

Atualize a documentação **somente quando a alteração mudar o estado real do produto**:

- `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md` (Seção 62) — estado funcional atual, fonte oficial;
- `docs/08_BACKLOG.md` — pendências/prioridades técnicas;
- `docs/09_CHANGELOG.md` — histórico técnico;
- `docs/06_DECISIONS.md` — decisões arquiteturais ou de produto duradouras;
- outros documentos de `docs/` quando a mudança os tornar incorretos.

## 6. Regras de negócio que não devem ser alteradas sem decisão explícita

- O objetivo do Filamap é reduzir ao mínimo o controle manual de filamento.
- Tara do carretel não faz parte do saldo líquido de filamento.
- O Desktop Agent deve ser a ponte local com a Bambu Lab; regras complexas de negócio não devem ficar espalhadas nele sem necessidade.
- Credenciais LAN da impressora devem permanecer locais sempre que possível e nunca ser documentadas em texto claro.
- Isolamento de dados por usuário via RLS é obrigatório.
- Baixa de estoque deve ser idempotente/segura contra duplicidade antes de ser considerada confiável para produção.
- Não inventar consumo quando o dado autoritativo não estiver disponível sem deixar explícita a qualidade/origem da estimativa (`needs_weighing`/`consumption_quality` deve refletir a realidade — ver pendência crítica registrada na Seção 62 do documento oficial).

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

- `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md` — **fonte oficial de estado e visão do produto** (ver Seção 62).
- `docs/00_PROJECT_CONTEXT.md` — visão rápida e objetivo do produto.
- `docs/01_ARCHITECTURE.md` — arquitetura implementada e alvo.
- `docs/02_DATABASE.md` — schema conhecido, RLS e lacunas de migrations.
- `docs/03_FEATURES.md` — funcionalidades e grau de implementação.
- `docs/04_USER_JOURNEYS.md` — jornadas reais e desejadas.
- `docs/05_BUSINESS_RULES.md` — regras duradouras.
- `docs/06_DECISIONS.md` — decisões e ADRs resumidos.
- `docs/07_CURRENT_STATE.md` — snapshot operacional técnico (complementar).
- `docs/08_BACKLOG.md` — pendências priorizadas.
- `docs/09_CHANGELOG.md` — histórico técnico relevante.

## 11. Regra para encerrar uma sessão de IA

Antes de encerrar um bloco significativo de trabalho, garanta que a Seção 62 de `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md`, `docs/08_BACKLOG.md` e `docs/09_CHANGELOG.md` continuam verdadeiros. Se uma decisão permanente mudou, registre em `docs/06_DECISIONS.md`.

O objetivo é permitir que uma conversa nova continue o projeto sem depender da memória da conversa anterior — usando `FILAMAP_USER_JOURNEY_ARQUITETURA (2).md` como ponto de partida.
