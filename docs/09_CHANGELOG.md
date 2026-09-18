# 09 — Changelog Técnico

Este changelog registra apenas alterações que podem ser confirmadas pelos arquivos presentes no repositório auditado. Datas anteriores nem sempre estão disponíveis no pacote, então os itens históricos são agrupados por evidência/migration.

## 18/09/2026 — Gravação de tag NFC passa a operar sobre carretel já cadastrado

- aba "Tags" (`web-app/src/App.tsx`) deixou de ser um formulário de criação solta:
  Marca/Material/Cor agora são somente leitura, vindos de um seletor de `spools`
  real (query em `inventory`); Tag ID é preenchido a partir de `nfc_uid` do
  carretel selecionado ou gerado se ainda não houver; Peso Balança e Tara
  continuam editáveis; o botão de gravar atualiza o spool existente (`UPDATE`
  por `id`) em vez de criar um novo (antes fazia `upsert` por `nfc_uid`);
- Estoque ganhou atalho por linha (🏷️) para ir direto à aba Tags com o
  carretel já pré-selecionado;
- modal "Editar Carretel" passou a expor marca, material, cor (nome + tom),
  tara e peso — antes só tinha cor e peso; quando o carretel ainda não tem
  `nfc_uid`, o modal oferece um botão para ir direto ao fluxo de gravação de
  tag;
- removida `handleUpdateNfc`, função que já existia mas não estava conectada
  a nenhum elemento da UI;
- nenhuma migration foi criada — `spools.nfc_uid` já cumpre o papel de
  tag_id/slug do carretel.

## 18/09/2026 — Documentação de continuidade para IA

- criado `GEMINI.md`;
- criada estrutura `docs/00` a `docs/09`;
- separado estado implementado de visão-alvo;
- documentadas divergências entre jornada v1.1 e código atual;
- registrado backlog técnico priorizado;
- definido código + documentação como fonte oficial de contexto.

## Migration 004 — correção de `ams_slots.user_id`

- adiciona `user_id` se ausente;
- define default `auth.uid()`;
- realiza backfill pelo dono da impressora.

## Migration 003 — remoção de policies permissivas

- remove policies antigas que poderiam anular as restrictions de RLS por combinação OR.

## Migration 002 — hardening de segurança

- habilita RLS;
- adiciona defaults de `user_id`;
- cria policies por proprietário;
- restringe presets;
- endurece `deduct_spool_filament()`.

## Migration 001 — schema inicial

- cria `spools`;
- cria `printers`;
- cria `ams_slots`;
- cria `print_jobs`;
- cria RPC inicial de desconto.

## Estado funcional identificado no código atual

Sem data de commit disponível no pacote, já existem:

- frontend React com login, AMS, estoque, orçamento, catálogo e NFC writer;
- Agent MQTT;
- tentativa de descoberta automática;
- persistência local de job;
- FTPS + parser 3MF;
- baixa automática + `print_logs`;
- executável Windows do Agent.
