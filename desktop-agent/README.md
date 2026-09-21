# Filamap Desktop Agent

Serviço local que descobre a impressora Bambu Lab na rede, conecta via MQTT
e reporta telemetria/consumo de filamento para o backend Filamap.

## Fluxo de onboarding comercial (implementado)

1. Cliente baixa/roda o Agent (`node dist/index.js`, `npm start` em dev, ou
   `filamap-agent.exe` quando empacotado -- ver `npm run package-exe`).
2. Se não houver `.env` completo (caso normal do cliente final), o Agent
   pergunta no terminal só o que ainda não sabe:
   - e-mail da conta Filamap (se ainda não salvo);
   - senha (só se não houver sessão salva -- nunca é gravada em disco);
   - número de série da impressora (só se a descoberta automática por SSDP
     não conseguir detectá-lo -- ver "Descoberta automática" abaixo);
   - Access Code da impressora (tela da própria impressora).
3. E-mail, serial e último IP conhecido são salvos em
   `config.json` (não secreto -- ver "Onde fica cada coisa"). Sessão
   (refresh token) e Access Code passam pelo `SecretStore` (ver
   "Segredos" abaixo).
4. Da próxima vez que o Agent iniciar (manualmente ou via auto-start do
   Windows), o que já foi salvo não é perguntado de novo -- **contanto que
   o `SecretStore` ativo persista segredos entre execuções**. Isso é
   verdade em modo dev/CI (`.env` com `PRINTER_ACCESS_CODE` e/ou
   `SUPABASE_REFRESH_TOKEN`) e no cliente final rodando Windows, via DPAPI
   (`WindowsDpapiSecretStore`, ver "Segredos" abaixo). Fora do Windows e
   sem `.env`, ainda não há cofre implementado -- o Access Code precisa
   ser digitado de novo a cada execução (ver
   docs/11_AGENT_ONBOARDING_V2.md).
5. Se o Agent iniciar sem configuração completa **e** sem terminal
   interativo (`stdin` não é TTY -- é o caso do auto-start via Tarefa
   Agendada), ele não fica esperando input que nunca vai chegar: imprime um
   erro claro dizendo o que falta e encerra, pedindo pra rodar manualmente
   uma vez primeiro.

### Descoberta automática

O Agent já escuta anúncios SSDP da Bambu Lab na rede local (portas 2021 e
1990) para achar o IP da impressora sem perguntar nada -- isso já existia
antes desta rodada e continua igual (`src/printerDiscovery.ts`, hot-path de
conexão/reconexão MQTT intocado).

Nesta rodada, o onboarding também aproveita esse mesmo listener para tentar
capturar o **número de série** anunciado (campo `USN` do SSDP) quando ele
ainda não é conhecido. Quando a rede permite (a maioria dos casos com um
único Bambu Lab na LAN), o cliente não precisa digitar nada além do Access
Code. Quando o roteador bloqueia SSDP/multicast entre segmentos de rede
(2.4GHz/5GHz em alguns roteadores, VLANs, etc.), a detecção automática do
serial pode falhar -- nesse caso o assistente pede o serial manualmente,
como já documentava `src/discovery.ts` (script diagnóstico separado, veja
abaixo).

### Segredos: o que é salvo e onde

| Dado | Onde | Observação |
| --- | --- | --- |
| E-mail da conta | `config.json` | não é segredo |
| Número de série da impressora | `config.json` | não é segredo |
| Último IP conhecido | `config.json` | só um hint, descoberta roda de novo sempre |
| Senha da conta Filamap | **nunca persistida** | usada uma vez pra autenticar, descartada da memória |
| Sessão Supabase (refresh token) | `SecretStore` | ver abaixo |
| Access Code da impressora | `SecretStore` | ver abaixo |

`config.json` fica em:
- Windows: `%APPDATA%\Filamap\config.json`
- macOS: `~/Library/Application Support/Filamap/config.json`
- Linux: `~/.config/filamap/config.json` (ou `$XDG_CONFIG_HOME/filamap/config.json`)

**`SecretStore` (`src/config/secretStore.ts`)** é a abstração para os dois
segredos que precisam sobreviver entre execuções. `resolveSecretStore()`
escolhe a implementação nesta ordem:

1. **`EnvSecretStore`** -- se `PRINTER_ACCESS_CODE` e/ou
   `SUPABASE_REFRESH_TOKEN` estiverem no `.env`/ambiente (modo dev/CI),
   sempre tem prioridade, em qualquer SO.
2. **`WindowsDpapiSecretStore`** (`src/config/dpapiSecretStore.ts`) -- no
   Windows, sem segredos no ambiente. Cofre de verdade: usa DPAPI
   (`CryptProtectData`/`CryptUnprotectData`, escopo do usuário atual do
   Windows) via `powershell.exe` (`System.Security.Cryptography.ProtectedData`)
   chamado como processo filho -- **sem dependência nativa nova e sem
   mudar o pipeline do `pkg`** (ver comentário no topo do arquivo e
   docs/11_AGENT_ONBOARDING_V2.md seção 10 para a análise completa das
   alternativas consideradas). O segredo só trafega em memória/stdin-stdout,
   nunca como argumento de linha de comando. Em disco fica só
   `%APPDATA%\Filamap\secrets.dat`, contendo exclusivamente o blob
   criptografado pelo DPAPI -- nenhum campo (nem os nomes
   `supabaseRefreshToken`/`printerAccessCode`, nem os valores) aparece em
   texto puro nesse arquivo. Um arquivo ausente, corrompido ou que o DPAPI
   se recuse a descriptografar (ex.: outro usuário do Windows) é tratado
   como "sem segredo salvo", não como erro fatal.
3. **`UnavailableSecretStore`** -- macOS/Linux sem `.env`: funciona (o
   onboarding continua perguntando o que falta), mas nada é lembrado de
   uma execução pra outra. Isso é deliberado, não um bug esquecido -- ver
   docs/11_AGENT_ONBOARDING_V2.md seção 10 para a análise das opções ainda
   não implementadas fora do Windows (Keychain no macOS, libsecret no
   Linux, ou uma lib cross-platform como `keytar`).

`.env` continua funcionando (prioridade total sobre tudo o mais, igual
antes) para desenvolvimento, CI ou contas de teste -- ver `.env.example`.
Não é o caminho esperado para o cliente final.

### Reconfigurar / trocar de conta ou impressora

Apague `config.json` (caminho acima) e rode o Agent de novo com um terminal
visível -- o assistente roda outra vez. Se estiver usando `.env` com
`PRINTER_ACCESS_CODE`/`SUPABASE_REFRESH_TOKEN`, edite/apague essas linhas
também. No Windows, se os segredos estiverem persistidos via DPAPI, apague
também `%APPDATA%\Filamap\secrets.dat` (ou deixe o assistente rodar de
novo -- ele sobrescreve o arquivo ao salvar os novos segredos).

### CLI provisório

O assistente de configuração hoje é só texto (`src/config/onboardingCli.ts`,
via `readline/promises`). A lógica de decisão (o que falta, quando tentar
descoberta, quando persistir) está isolada em `src/config/onboarding.ts` e
não sabe nada sobre terminal -- ela recebe uma implementação de
`OnboardingPrompts` injetada. Trocar o CLI por uma tela gráfica de
configuração no futuro não deve exigir mudar `onboarding.ts`, só escrever
uma nova implementação de `OnboardingPrompts`.

## Auto-start no Windows

`install-autostart.ps1` registra uma Tarefa Agendada no logon do usuário
(sem janela visível, com restart automático). Ver comentários no próprio
script e em `run-agent.ps1`. `uninstall-autostart.ps1` remove. Não foi
alterado nesta rodada -- já cobria o caso "iniciar sozinho no logon"; o
onboarding comercial foi construído para funcionar com ele sem mudanças
(checagem de `stdin.isTTY` é o que evita o Agent travar quando a Tarefa
Agendada o inicia sem terminal).

## Testes

```
npm test              # unitários (src/**/*.test.ts), sem dependências externas
npm run test:integration  # RPC real contra um Supabase de TESTE (exige .env)
```

Usa `node --test` nativo (não Vitest) -- mesmo framework já usado no resto
do projeto.

## O que falta para o instalador `.exe` completo

- **Instalador gráfico (wizard `.exe`/MSI)** — hoje `npm run package-exe`
  gera um binário único (`pkg`), não um instalador com wizard, atalho no
  menu iniciar, desinstalador registrado no Painel de Controle. Ferramentas
  como Inno Setup/NSIS/electron-builder resolvem isso, mas envolvem
  escolher uma delas e configurar um pipeline de build novo — decisão de
  produto/ferramenta.
- **Assinatura de código (code signing)** — sem isso, o Windows/SmartScreen
  mostra aviso de "editor desconhecido" ao abrir o `.exe`. Exige um
  certificado de assinatura que só o dono do produto pode providenciar.
- **Cofre de segredos do SO** — implementado no Windows via DPAPI (ver
  seção "Segredos" acima); ainda falta em macOS/Linux, ver
  docs/11_AGENT_ONBOARDING_V2.md.
- **Auto-update** — não implementado. Depende de como distribuir novas
  versões e, de novo, de assinatura de código.

## `src/discovery.ts` vs. `src/printerDiscovery.ts`

São coisas diferentes, apesar do nome parecido:

- `src/discovery.ts` é um script diagnóstico standalone (SSDP M-SEARCH
  manual em `239.255.255.250:1900`), não integrado ao Agent -- já existia
  antes desta rodada, documentado em `docs/01_ARCHITECTURE.md`. Roda
  isolado, útil pra depurar rede na mão.
- `src/printerDiscovery.ts` é a descoberta real usada pelo Agent em
  produção (portas 2021/1990, mesmo timeout e mensagens de sempre) --
  extraída de `index.ts` nesta rodada só pra ser reaproveitada pelo
  onboarding, sem mudar comportamento.
