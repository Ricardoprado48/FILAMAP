# 09 — Changelog Técnico

Este changelog registra apenas alterações que podem ser confirmadas pelos arquivos presentes no repositório auditado. Datas anteriores nem sempre estão disponíveis no pacote, então os itens históricos são agrupados por evidência/migration.

## 20/09/2026 — Redesign do estado vazio do card de slot na aba AMS

- só visual, sem tocar em lógica de leitura NFC, schema ou outras abas;
- `web-app/src/App.tsx`: o botão outline pequeno ("📡 Ler tag NFC") do
  estado vazio de cada card de slot foi substituído por um alvo circular
  de 60px (fundo `#0284c7`, ícone `Nfc` do lucide-react centralizado),
  com dois anéis concêntricos (`#38bdf8`) em animação de pulso contínua
  (`@keyframes filamapNfcPulse`, scale + fade, 2s, defasados em 1s) e
  texto abaixo ("Aproximar tag NFC" / "Toque para ler");
- número do slot e bolinha de status no topo do card mantidos como
  estavam; `onClick` continua chamando `handleScanSlot(slotIdx)`, sem
  mudança de comportamento;
- validado com `tsc --noEmit` e `npm run build` (ambos sem erro) e com
  preview visual isolado (HTML/CSS espelhando os mesmos estilos) via
  screenshot; não foi possível validar na aba AMS autenticada real dentro
  desta sessão (sem credenciais de login do usuário no ambiente).

## 18/09/2026 — Leitura de tag na aba AMS nunca reconhecia carretel já gravado

- causa raiz confirmada: `writeTagUrl` (aba Tags) grava um registro NDEF do
  tipo `url` cujo conteúdo é `https://filamap.pages.dev/?tag=<finalTagId>`
  — `spools.nfc_uid` guarda só o `<finalTagId>` (ex.: `FILA-PETG-...` ou
  valor customizado). Já `startScanning` (`web-app/src/hooks/useNfc.ts`)
  usava `event.serialNumber` — o número de série de **hardware do chip**,
  uma propriedade do NDEFReadingEvent totalmente independente do conteúdo
  gravado nele. Os dois nunca coincidem, então `handleAssignSlot` nunca
  encontrava o spool existente e sempre criava um placeholder novo
  (`Voolt3D`/`PETG`/`Preto`/1000g/218g);
- corrigido em `useNfc.ts`: `onreading` agora decodifica o registro NDEF
  lido (`event.message.records`), extrai o parâmetro `tag` da URL gravada
  e usa esse valor como `nfcUid` — a mesma string que `spools.nfc_uid`
  guarda. `event.serialNumber` vira fallback só para tags que nunca
  passaram pelo fluxo de gravação do app (sem registro NDEF reconhecível);
- **possível dado afetado (não corrigido nesta sessão, a pedido — ajuste
  manual)**: qualquer spool com `brand='Voolt3D'`, `material='PETG'`,
  `color_name='Preto'`, `current_weight=1000`, `spool_tare_weight=218` e
  `nfc_uid` no formato de serial de hardware (ex.: hexadecimal com `:`),
  em vez do padrão `FILA-...` ou de um ID customizado, é candidato a ter
  sido criado por este bug ao tentar ler uma tag já gravada (ex.: o
  "Vermelho Velvet" citado) pela aba AMS. O carretel original citado pelo
  usuário não deve ter sido alterado por este bug — o efeito colateral é a
  criação de um spool "fantasma" adicional, não a corrupção do original.

## 18/09/2026 — Falha silenciosa ao salvar edição de carretel

- investigado relato de que a Tara editada no modal "Editar Carretel" não
  persistia: conferido campo a campo, `handleSaveEdit` (`web-app/src/App.tsx`)
  já incluía `brand`, `material`, `color_name`, `color_hex`,
  `spool_tare_weight`, `current_weight` e `price_paid` no payload do
  `UPDATE` — nenhum campo exibido/editável no modal estava faltando;
- causa raiz real: a chamada ao Supabase não verificava o retorno (`error`
  nem linhas afetadas). No PostgREST/Supabase, quando o RLS filtra a linha
  alvo de um `UPDATE` (ex.: registro cujo `user_id` não é o do usuário
  logado — consistente com o achado anterior de que alguns carretéis têm
  valores "crus" de default, indício de inserção fora do fluxo normal do
  app), a operação retorna sucesso com 0 linhas afetadas, sem `error`. O
  modal fechava e recarregava como se tivesse salvo, mas nada mudava no
  banco — exatamente o sintoma relatado;
- corrigido: `handleSaveEdit` agora usa `.select()` no `update` e verifica
  tanto `error` quanto `data.length === 0`; em qualquer um dos dois casos,
  mostra alerta e mantém o modal aberto (sem descartar o que o usuário
  digitou), só fecha e recarrega em sucesso confirmado;
- não foi alterado schema nem corrigidos dados existentes — se o carretel
  de teste realmente estiver sem `user_id` compatível, isso é um problema
  de dado, fora do escopo desta correção.

## 18/09/2026 — Leitura de tag NFC ligada ao fluxo de slot do AMS

- aba AMS (`web-app/src/App.tsx`): cada slot vazio ganhou o botão "📡 Ler tag
  NFC", que chama `startScanning()` (hook `useNfc`, já existia mas não
  estava conectado a nenhum elemento da UI) e aguarda a leitura de uma tag
  física para aquele slot específico;
- ao ler um `nfcUid`: se já existir `spool` com esse `nfc_uid`, associa ao
  slot; se não existir, segue o fluxo já corrigido de `handleAssignSlot`
  (auto-cria com placeholder e abre a edição pré-preenchida na hora);
- erros tratados com mensagem visível (banner vermelho no painel do AMS):
  `NDEFReader` ausente no navegador/dispositivo, permissão negada, falha de
  leitura da tag — todos já reportados pelo hook `useNfc` via `error`; foi
  adicionado timeout de 20s próprio do fluxo de slot (o hook em si não
  expõe timeout/cancelamento) e um botão "Cancelar" que interrompe a espera
  do lado da UI;
- removido o `onClick` solto que existia no card do slot (associava o
  `nfcUid` corrente a qualquer slot clicado, sem nunca ter uma forma de
  popular esse `nfcUid`) — substituído pelo fluxo explícito por botão;
- investigado (sem alterar) o mecanismo `?tag=<id>` gravado por
  `handleWriteTag` na URL do NDEF: ele é escrito na tag física para uso
  como **deep link passivo** (qualquer leitor NFC do SO abre essa URL ao
  encostar no carretel, mesmo com o app fechado), mas hoje a página não lê
  `location.search`/`URLSearchParams` no carregamento — confirma a lacuna
  já registrada em `docs/08_BACKLOG.md` (P1.1: "ler `?tag=` no
  carregamento"). Não é redundante com `startScanning()`: um é leitura
  ativa dentro do app (usada agora para vincular um slot do AMS), o outro é
  abertura passiva do navegador a partir de qualquer leitor NFC do
  aparelho. Não foi unificado, por estar fora do escopo desta tarefa.

## 18/09/2026 — Auditoria de todos os pontos de INSERT em `spools`

- levantamento completo (grep por `.from("spools").insert`/`.upsert` em
  `web-app/` e `desktop-agent/`) confirma que existe **um único** ponto de
  criação de carretel disparado por ação do usuário: `handleAssignSlot`
  (`web-app/src/App.tsx`), acionado ao clicar num slot vazio do AMS com uma
  tag NFC física desconhecida já lida. Não existe (e nunca existiu neste
  repositório) um botão/formulário "Novo Carretel" na aba Estoque — essa
  hipótese do relatório anterior não se confirmou;
- `handleAssignSlot` gravava marca/material/cor/tara/peso **totalmente
  fixos** (`Voolt3D`/`PETG`/`Preto`/`1000g`/`218g`/`R$85`) porque esse
  fluxo não tem formulário algum — é um auto-cadastro de fallback para tag
  desconhecida, então não há "peso/tara digitado pelo usuário" que estivesse
  sendo descartado; o problema é que o placeholder era persistido como
  definitivo, sem chance de correção imediata;
- correção: após criar o carretel-placeholder e associá-lo ao slot,
  `handleAssignSlot` agora abre automaticamente o modal "Editar Carretel"
  (já com todos os campos, de sessão anterior) pré-preenchido, para que
  marca/material/cor/tara/peso reais sejam informados antes de o registro
  "ficar esquecido" com os defaults;
- `handleWriteTag` (gravação de tag pela aba Tags) segue confirmado como
  `UPDATE` por `spool.id`, nunca `INSERT` — não é fonte deste bug;
- dados já existentes no banco com tara/peso default (1000/200) não foram
  alterados por esta correção — ajuste deve ser feito manualmente pelo
  próprio app, via re-pesagem/edição, conforme solicitado.

## 18/09/2026 — Feedback de gravação de tag e diferenciação visual de carretéis com/sem tag

- `handleWriteTag` (`web-app/src/App.tsx`) agora, após gravação confirmada:
  limpa a seleção do carretel e os campos do formulário da aba Tags e navega
  automaticamente de volta para a aba Estoque, em vez de deixar a tela de
  gravação aberta no mesmo estado;
- a mensagem de sucesso passou a ser um banner global (visível
  independentemente da aba ativa, logo abaixo do cabeçalho), com
  auto-dispensa em 5s e botão de fechar manual;
- Estoque: cada linha de carretel agora mostra um selo visual — verde
  "🏷️ <tag>" quando `nfc_uid` está preenchido, vermelho "⚠️ Sem tag" quando
  não está — no lugar do texto cru "Tag: {nfc_uid}" (que ficava em branco
  sem indicação clara quando vazio);
- aba Tags: o seletor de carretel passou a prefixar cada opção com 🏷️ (já
  tem tag) ou ⚠️ (sem tag), incluindo o sufixo "(sem tag)" nas opções ainda
  não gravadas;
- investigado relato de bug em que os campos Tara/Saldo do modal "Editar
  Carretel" sempre mostravam 1000/200 independente do carretel selecionado:
  auditoria do histórico do git (commit de importação original, commit
  anterior à sessão de vínculo de tags, e o código atual) confirma que
  `openEditModal` sempre derivou `editWeight`/`editTare` a partir do
  `spool` clicado em todas as versões — não há nem nunca houve
  `useState(1000)`/`useState(200)` fixo no código. Os valores 1000 e 200
  coincidem exatamente com os defaults de coluna do Postgres
  (`current_weight NUMERIC(6,2) NOT NULL DEFAULT 1000.00` e
  `spool_tare_weight NUMERIC(6,2) DEFAULT 200.00`, em
  `supabase/migrations/001_initial_schema.sql`), o que indica que os
  registros testados nunca foram pesados/tarados individualmente pelo app
  (prováveis linhas inseridas fora do fluxo `handleAssignSlot`, que grava
  1000/218, não 1000/200) — não uma falha de renderização do formulário.

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
