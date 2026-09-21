# 11 — Onboarding Comercial do Desktop Agent (v2)

**Data:** 21/09/2026
**Branch:** `claude/agent-onboarding-v2`, criada a partir de `origin/main`
(commit `5704d43`).
**Escopo desta sessão:** exclusivamente onboarding comercial do Desktop
Agent. Web App, migrations, arquitetura de consumo/descoberta/MQTT
existentes **não foram alterados** (só reutilizados).

---

## 0. Estado de partida (verificado antes de qualquer mudança)

- `git fetch origin` + nova branch a partir de `origin/main` — confirmado
  que os 9 commits citados no pedido (`5704d43` até `d0bfec2`) estão
  presentes no log antes de qualquer edição.
- `npm test` (baseline, antes de mudanças): **24/24 passando**, framework
  `node:test` nativo (não Vitest — não foi adicionado).
- `npm run test:integration` (baseline): falha com
  `Error: Configure SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL e
  AGENT_PASSWORD no .env` — comportamento **esperado e preexistente**: não
  há `.env` neste sandbox e o teste não tem skip condicional (diferente do
  que uma sessão anterior, descartada, tinha implementado numa base
  diferente). Não alterado.
- Não havia nenhum onboarding comercial no código (`docs/07_CURRENT_STATE.md`
  já registrava isso: "O Agent depende de configuração por `.env`. Não
  existe onboarding comercial guiado no código auditado.").
- `desktop-agent/src/discovery.ts` **já existia** como script diagnóstico
  standalone (SSDP M-SEARCH manual, porta 1900, não integrado ao Agent —
  documentado em `docs/01_ARCHITECTURE.md`). Não foi tocado. Isso só foi
  descoberto depois de uma tentativa inicial equivocada de sobrescrevê-lo
  (revertida antes de qualquer commit — ver seção 9).

---

## 1. Arquitetura implementada

```
desktop-agent/src/
├── printerDiscovery.ts     # extraído de index.ts (comportamento idêntico)
├── config/
│   ├── configStore.ts      # config NÃO secreta, persistida em disco
│   ├── secretStore.ts      # abstração p/ segredos (SecretStore)
│   ├── supabaseDefaults.ts # URL/anon key públicos embutidos
│   ├── onboarding.ts       # decide o que falta, orquestra tudo
│   ├── onboardingCli.ts    # única "UI" hoje: prompts via terminal
│   └── *.test.ts           # 21 testes novos (node:test)
└── index.ts                 # só o bootstrap inicial mudou
```

Separação deliberada (pedida explicitamente):

- **Config não secreta** (`configStore.ts`) → `%APPDATA%\Filamap\config.json`
  no Windows (e equivalentes em macOS/Linux). Cross-platform testado via
  `path.win32.join`/`path.posix.join` explícitos, não `path.join` genérico
  (senão o teste rodando em Linux não valida o caminho real do Windows).
- **Segredos** (`secretStore.ts`) → interface `SecretStore`, nunca
  misturada com `configStore.ts`.
- **Lógica de decisão** (`onboarding.ts`) → não lê `stdin`/`stdout`
  diretamente. Recebe uma implementação de `OnboardingPrompts` injetada.
- **UI/CLI** (`onboardingCli.ts`) → única implementação de
  `OnboardingPrompts` hoje, via `readline/promises`. Trocável por uma tela
  gráfica sem tocar em `onboarding.ts` — é exatamente essa a razão da
  interface existir.

`printerDiscovery.ts` é uma extração **mecânica** da função
`discoverPrinterIp` que já existia dentro de `index.ts` (mesmas portas
2021/1990, mesmo grupo multicast, mesmo timeout de 12s, mesmas mensagens de
log). O único acréscimo é uma função irmã, `discoverPrinter`, que devolve
também o serial anunciado no campo `USN` do SSDP — usada só pelo
onboarding, não pelo hot-path de conexão/reconexão MQTT (que continua
usando `discoverPrinterIp`, inalterado em comportamento).

`index.ts`: a autenticação e a conexão MQTT continuam morando lá (não
foram movidas para dentro do módulo de config, para manter a arquitetura
existente). O que mudou é só o bootstrap: em vez de ler 7 variáveis de
ambiente direto e abortar se alguma faltar, `startAgent()` chama
`bootstrapRuntimeConfig()`, que devolve a config resolvida e a estratégia
de autenticação a usar.

---

## 2. Fluxo da primeira execução

1. Cliente roda o Agent com um terminal visível (duplo-clique no `.exe`
   ou `npm start`).
2. Sem `.env` completo, `resolveAgentRuntimeConfig()` entra em ação:
   a. Carrega o que existir em `config.json` (nada, na primeira vez) e no
      `SecretStore` ativo (nada, também).
   b. Como o serial da impressora ainda não é conhecido, tenta descoberta
      automática via SSDP (reaproveitando `printerDiscovery.ts`) — se um
      Bambu Lab responder com o campo `USN`, o serial é capturado sem
      perguntar nada.
   c. Pergunta só o que ainda falta, na ordem: e-mail → senha (nunca
      salva) → serial da impressora (só se a descoberta automática
      falhou) → Access Code.
   d. Salva e-mail + serial + IP detectado (se houve) em `config.json`.
   e. Tenta salvar o Access Code (e o refresh token, depois do login) no
      `SecretStore` ativo — hoje, sem `.env`, isso é um aviso explícito
      de que não vai ser lembrado (ver seção 5 e 9).
3. `index.ts` autentica com a senha recém-digitada
   (`signInWithPassword`), conecta ao MQTT com o Access Code fornecido e
   segue normalmente (descoberta de IP, conexão, telemetria — tudo
   inalterado).

## 3. Fluxo das execuções seguintes

Dois cenários, dependendo de como os segredos foram fornecidos:

**A) Com `.env` completo (dev/CI/conta de teste)** — comportamento
100% preservado: as 5 variáveis de sempre (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `AGENT_EMAIL`, `AGENT_PASSWORD`, `PRINTER_SERIAL`)
são usadas diretamente, nenhum onboarding roda, nenhum arquivo é tocado.
Verificado manualmente (ver seção 8).

**B) Sem `.env` completo (cliente final, hoje)** — `config.json` já tem
e-mail e serial, então a descoberta de serial não roda de novo (só a de
IP, que sempre roda — impressora pode ter trocado de endereço). Mas como
**não há cofre de segredos persistente implementado** (ver seção 9), o
Access Code não sobrevive ao fim do processo: numa nova execução sem
`.env`, o assistente pergunta o Access Code de novo. Se essa execução for
via auto-start do Windows (sem terminal), o Agent não trava esperando
input — registra um erro claro em `agent.log` e encerra (mesmo padrão já
usado para outras faltas de configuração).

**B'.1) Sem `.env`, mas com `SUPABASE_REFRESH_TOKEN`/`PRINTER_ACCESS_CODE`
manualmente no ambiente** — cenário intermediário testado manualmente:
config.json fornece e-mail/serial, o `EnvSecretStore` fornece os segredos,
nada é perguntado, a sessão é restaurada via `refreshSession()` em vez de
login por senha. É o mais próximo do fluxo comercial final que dá pra
demonstrar hoje sem um cofre de SO real.

## 4. O que é salvo em arquivo (`config.json`)

```json
{
  "formatVersion": 1,
  "agentEmail": "cliente@example.com",
  "printerSerial": "01P00A000000009",
  "lastKnownPrinterIp": "192.168.1.50",
  "onboardingCompletedAt": "2026-09-21T00:00:00.000Z",
  "updatedAt": "2026-09-21T00:00:00.000Z"
}
```

Nenhum campo aqui é segredo. `lastKnownPrinterIp` é só um hint — a
descoberta de IP sempre roda de novo no início (mesmo comportamento de
sempre: IP pode mudar por DHCP).

## 5. O que é considerado segredo

- **Senha da conta Filamap** — usada uma única vez para autenticar
  (`signInWithPassword`), nunca gravada em nenhum arquivo, nunca logada.
- **Access Code da impressora** — passa por `SecretStore`, nunca por
  `config.json`.
- **Refresh token da sessão Supabase** — idem. Capturado depois de um
  login bem-sucedido (`authData.session.refresh_token`), usado em
  execuções seguintes via `supabase.auth.refreshSession()` em vez de pedir
  a senha de novo.

`SecretStore` hoje tem duas implementações:

- `EnvSecretStore` — lê `PRINTER_ACCESS_CODE`/`SUPABASE_REFRESH_TOKEN` do
  `.env`/ambiente. `persists = true` (o `.env` em si persiste; o código
  nunca escreve nele). Cobre dev/CI.
- `UnavailableSecretStore` — usada quando não há `.env`. `persists =
  false`: o onboarding funciona (pergunta o que falta, completa o fluxo),
  mas nada sobrevive ao fim do processo. **Isto é deliberado**, não uma
  simplificação esquecida — ver seção 9.

## 6. Como a autenticação Supabase funciona

`index.ts` (`startAgent()`) decide entre duas estratégias, devolvidas por
`resolveAgentRuntimeConfig()`:

- `{ type: "password", password }` — chama `supabase.auth.signInWithPassword`.
  Usado quando não há refresh token salvo (primeira vez, ou `.env` com
  `AGENT_PASSWORD`).
- `{ type: "refresh_token", refreshToken }` — chama
  `supabase.auth.refreshSession({ refresh_token })`. Usado quando o
  `SecretStore` ativo já tinha um refresh token.

Depois de qualquer login bem-sucedido, `persistSessionSecrets()` salva o
refresh token **novo** (ele muda a cada refresh) de volta no
`SecretStore` — só tem efeito se `persists === true`.

Se um refresh token salvo falhar (expirado/revogado), ele é descartado
(`persistSessionSecrets(store, null, ...)`) para não repetir a mesma
falha para sempre — a próxima execução interativa volta a pedir a senha.

`SUPABASE_URL`/`SUPABASE_ANON_KEY` têm um valor padrão embutido
(`supabaseDefaults.ts`, mesmo par já publicado no bundle JS do web-app,
protegido por RLS) — o cliente final nunca precisa descobrir ou colar
isso. `.env` continua tendo prioridade, para apontar a uma instância de
teste.

**Não usa `service_role`** em nenhum ponto — só a `anon key` pública, como
já era.

## 7. Como a descoberta da Bambu foi reutilizada

A função `discoverPrinterIp` que já existia dentro de `index.ts` foi
extraída, sem mudança de comportamento, para
`src/printerDiscovery.ts`. `index.ts` importa e usa exatamente a mesma
função (mesmas portas, timeout, mensagens de log) nos dois pontos onde já
era usada: descoberta inicial e redescoberta em `rediscoverPrinter()`
(que também não mudou de lógica — só passou a receber `PRINTER_SERIAL`
como parâmetro em vez de fechar sobre uma constante do módulo).

Uma função irmã, `discoverPrinter(serialHint, timeoutMs)`, foi adicionada
no mesmo módulo — reaproveita o mesmo parsing SSDP, mas devolve também o
serial anunciado (campo `USN`), usado só pelo onboarding pra evitar
perguntar o serial quando a rede permite descobri-lo.

**Limitação documentada, não resolvida às cegas:** em redes que bloqueiam
SSDP/multicast entre segmentos (comum com Wi-Fi 2.4GHz/5GHz em alguns
roteadores domésticos, VLANs, etc.), a descoberta pode não encontrar a
impressora — nesse caso o serial (e, se for o caso, o IP) continuam
precisando ser digitados manualmente, exatamente como o script diagnóstico
`src/discovery.ts` (pré-existente, não tocado) já observava: *"Muitos
roteadores bloqueiam multicast UDP entre 2.4GHz e 5GHz... no app real, se a
busca automática falhar, oferecemos o campo 'Digitar IP manual'."* O
onboarding desta rodada segue exatamente essa recomendação para o serial.

## 8. Testes executados

**Antes de qualquer mudança (baseline):**
```
npm test               → 24/24 passando
npm run test:integration → falha (sem .env; comportamento preexistente)
```

**Depois de todas as mudanças:**
```
npm test               → 45/45 passando (24 preexistentes + 21 novos)
npx tsc --noEmit        → limpo
npm run test:integration → mesmo resultado da baseline (arquivo não tocado)
```

Novos testes (`node:test`, mesmo framework de sempre — Vitest **não** foi
instalado):
- `config/configStore.test.ts` (7): resolução de diretório cross-platform
  (win32 com/sem `APPDATA`, darwin, linux com/sem `XDG_CONFIG_HOME`),
  merge/load persistindo em disco de verdade (diretório temporário).
- `config/secretStore.test.ts` (7): `EnvSecretStore` lê do ambiente
  corretamente, `save`/`clear` são no-op, `resolveSecretStore` escolhe a
  implementação certa.
- `config/onboarding.test.ts` (9 + 2 unitários de função pura): caminho
  `.env` completo não toca disco nem pergunta nada; sem TTY e config
  incompleta aciona `onCannotPrompt`; descoberta automática preenche o
  serial e só pergunta o Access Code; `SecretStore` que não persiste avisa
  e segue mesmo assim. Usa fakes de `SecretStore`/`OnboardingPrompts`/
  descoberta — nenhum teste real de rede ou I/O de terminal.

**Validação manual (build de produção, `node dist/index.js`), já que
testes automatizados não cobrem o processo inteiro de ponta a ponta:**
- `.env` completo → login direto, `config.json` nunca criado (confirmado
  via `ls` no diretório de config depois da execução).
- Headless (`stdin` de `/dev/null`), sem config nenhuma → tenta descoberta
  (~12s), depois erro claro citando os campos faltando, `exit 1`.
- Headless, com `config.json` (serial já salvo) + segredos via ambiente
  (`PRINTER_ACCESS_CODE`/`SUPABASE_REFRESH_TOKEN`) → pula descoberta e
  assistente, vai direto para `refreshSession` (que falhou neste sandbox
  por não haver Supabase real acessível — comportamento de rede, não do
  código).
- TTY real via pseudo-terminal (`pty`, Python) → assistente exibe o prompt
  de e-mail, aceita a resposta digitada e avança corretamente para o
  próximo campo. **Não foi possível validar as 4 perguntas em sequência de
  ponta a ponta de forma automatizada** neste sandbox (harness de teste
  com condição de corrida no próprio script Python usado para simular
  digitação, não no Agent) — recomendação: um teste manual real com o
  usuário na frente do terminal antes de considerar o CLI totalmente
  validado (item pendente, seção 9).
- Auditoria de log: nenhuma chamada de `console.*` no código novo imprime
  senha, Access Code ou refresh token.

## 9. Decisões que precisam do usuário / pendências

1. **Cofre de segredos comercial (Windows) — bloqueado por decisão, não
   implementado.** Ver análise completa na seção 10. Sem isso, o Access
   Code precisa ser digitado a cada execução no cliente final (fora do
   fluxo `.env`). Isso é o maior desvio entre o estado atual e o objetivo
   "próximas inicializações são automáticas" do pedido original.
2. **Validação de ponta a ponta do assistente interativo com um usuário
   real** — a lógica de decisão está testada exaustivamente (21 testes) e
   a primeira pergunta foi confirmada funcionando via pseudo-terminal, mas
   as 4 perguntas em sequência não foram confirmadas de ponta a ponta de
   forma automatizada neste sandbox.
3. **`npm run test:integration` nunca executado com sucesso** — requer
   credenciais reais de um projeto Supabase de teste, não disponíveis
   aqui. Arquivo não foi tocado nesta rodada.
4. **Instalador gráfico, assinatura de código, auto-update** — mesmas
   pendências já registradas em `docs/08_BACKLOG.md` (P2.3), não
   revisitadas nesta rodada por serem decisões de produto/ferramenta e
   dependerem de recursos externos (certificado).
5. **Erro de extração acidental corrigido durante a sessão** — uma
   primeira tentativa de extrair a descoberta SSDP sobrescreveu
   `src/discovery.ts` (script diagnóstico pré-existente) sem lê-lo antes.
   Identificado e revertido (`git restore`) antes de qualquer commit; o
   módulo novo foi criado com outro nome (`printerDiscovery.ts`)
   justamente para não colidir. Mencionado aqui por transparência, não
   porque restou algum problema — `git diff` confirma `src/discovery.ts`
   idêntico ao `origin/main`.

## 10. Recomendação para armazenamento seguro de segredos no Windows

Três opções reais, nenhuma implementada nesta rodada (explicitamente
pedido: não escolher isso sem decisão do usuário):

| Opção | Prós | Contras |
| --- | --- | --- |
| **Windows Credential Manager via DPAPI** | Nativo do Windows, sem instalar nada no cliente; `cmdkey`/APIs DPAPI acessíveis via um binário nativo pequeno ou via `child_process` chamando utilitários do SO | Precisa de um módulo nativo Node (ex. via N-API) ou de invocar ferramentas externas; nenhuma lib pura-JS madura acessa DPAPI diretamente; muda o pipeline do `pkg` (empacotamento de binário nativo por plataforma) |
| **`keytar`** (ou sucessor mantido — `keytar` está sem manutenção ativa; alternativas: `@napi-rs/keyring`) | API cross-platform única (Windows Credential Manager, macOS Keychain, libsecret no Linux) | Dependência nativa compilada — `pkg` precisa embutir o `.node` certo por plataforma/arquitetura; ponto de falha a mais no build/instalador |
| **Arquivo com ACL restrita via `icacls`** (interina, só filesystem) | Zero dependência nova, usa só `child_process` + utilitário já presente no Windows | **Não é um cofre de verdade** — sem criptografia em repouso; se o disco for copiado ou o BitLocker estiver desligado, o arquivo é legível. Só reduz o risco de outro usuário/processo do mesmo Windows ler o arquivo, não de alguém com acesso ao disco |

**Recomendação:** `keytar`/`@napi-rs/keyring` se o roadmap aceitar a
complexidade extra de build nativo por plataforma (mais robusto, já
abstrai as 3 plataformas); DPAPI direto só se o produto for
Windows-only para sempre. A opção "arquivo com ACL" pode servir como
**interina, explicitamente rotulada como não-final** se for inaceitável
lançar sem nenhuma persistência de Access Code — mas isso é uma escolha de
produto (aceitar um risco residual conhecido vs. atrasar o lançamento até
escolher e implementar um cofre de verdade), por isso não foi ativada por
padrão nesta rodada.

Enquanto a decisão não for tomada, o Agent funciona (onboarding sempre
completa, autenticação sempre funciona), só não cumpre 100% a promessa de
"nunca mais perguntar o Access Code" fora do fluxo `.env`.

## 11. Passos para transformar o Agent em instalador comercial

Ordem sugerida, do que mais desbloqueia o resto:

1. **Decidir o cofre de segredos** (seção 10) — é o maior gap funcional
   restante do onboarding em si.
2. **Testar o onboarding com um usuário real**, numa máquina Windows, com
   uma Bambu Lab de verdade na rede — para confirmar que a descoberta
   automática do serial funciona na prática (este sandbox não tem acesso a
   uma impressora real nem a hardware de rede local).
3. **Escolher ferramenta de empacotamento** (Inno Setup, NSIS ou
   electron-builder) e gerar um instalador de verdade (hoje `pkg` só gera
   um binário único).
4. **Assinatura de código** — depende de certificado, decisão/custo
   externo ao time técnico.
5. **Auto-update** — depende dos passos 3 e 4 primeiro.
6. **Mover a implementação do cofre escolhido (passo 1)** para dentro de
   `SecretStore` — a interface já existe, só falta a classe concreta.

`install-autostart.ps1`/`run-agent.ps1`/`uninstall-autostart.ps1` (auto-start
via Tarefa Agendada) já existiam antes desta rodada e não precisaram de
nenhuma mudança — o onboarding foi construído para funcionar com eles sem
modificação (checagem de `stdin.isTTY` é o que evita o Agent travar quando
a Tarefa Agendada o inicia sem terminal).
