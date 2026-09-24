# FILAMAP
## Jornada do Utilizador e Funcionamento Técnico

**Versão:** 1.5  
**Tipo de documento:** Product Journey + Technical Architecture — **fonte oficial de estado do projeto** (ver Seção 62)  
**Produto:** Filamap  
**Categoria:** SaaS / IoT / Automação para impressão 3D  
**Ecossistema inicial:** Impressoras Bambu Lab + AMS

---

## Log de atualizações

**v1.5** — 24/09/2026 — Gate Zero e baseline atualizados. `main@3ce850a`
passou em build e testes: Agent 106/106 unitários + 13/13 integração; Web
33/33 + build produção; migrations local/remoto alinhadas até
`20260923120000`. O código atual inclui onboarding gráfico Windows, DPAPI
CurrentUser, instalador/auto-start, Cloud Spool Sync, weight gate e resolução
automática de spool físico. O MVP ainda não está homologado E2E porque a
última impressão real observada usou um Agent instalado anterior a
`3ce850a`, e a prioridade Bambu Cloud × NFC ainda precisa ser comprovada
em hardware com a build atual.

**v1.4** — Correções trazidas por trabalho técnico real em 20/09/2026
(não auditoria, implementação): consumo multicolor, finalização
idempotente/atômica e a cascata de 4 níveis de `consumption_quality`
foram implementados e validados com execução real (Postgres local +
`tsc`/build) — ver detalhe no aviso da Seção 62 e o changelog completo em
`docs/09_CHANGELOG.md`. `GEMINI.md`, lido nesta mesma sessão, já lista
este documento como item 1 da ordem de precedência (Seção 1) — a
pendência registrada na v1.3 abaixo ("GEMINI.md precisa ser corrigido")
parece já ter sido resolvida em algum momento não capturado no changelog
deste documento; sinalizado aqui em vez de presumido silenciosamente.

**v1.3** — Decisão explícita de Ricardo: este documento é a fonte oficial
de estado do projeto, não `docs/07_CURRENT_STATE.md`/`GEMINI.md`. Os
achados técnicos da auditoria do Gemini (v1.2) permanecem incorporados
como fatos confirmados sobre o código — mudou apenas qual documento tem
precedência, não a validade dos achados. `GEMINI.md` precisa ser corrigido
pra refletir essa hierarquia (pendência registrada na Seção 62).

**v1.2** — Correção importante: uma auditoria independente (Gemini,
18/09/2026) contradisse diretamente vários pontos que a v1.1 registrava
como "confirmados em produção" (ver aviso na Seção 62). O projeto também
adotou uma estrutura formal de documentação no repositório
(`docs/00`–`docs/09` + `GEMINI.md`) que passa a ter precedência sobre este
documento para qualquer questão de estado atual. Este documento segue
válido como visão de produto/filosofia, não como snapshot de implementação.

**v1.1** — Incorporadas descobertas técnicas confirmadas em revisão de código e
pesquisa direta (não apenas conceitual): correção de brechas de segurança
encontradas na implementação real (RLS ausente, RPC sem checagem de dono),
localização confirmada do arquivo `Metadata/slice_info.config` dentro do
`.gcode.3mf` (é um ZIP comum), plano de descoberta automática em camadas
(SSDP → varredura de sub-rede → entrada manual) motivado por um caso real de
IP de impressora mudando em produção, e o desenho da margem de segurança
sobre o saldo exibido. Ver **Seção 62** para o estado real de implementação
vs. a visão descrita neste documento, e as notas "⚠️ Nota v1.1" inseridas
pontualmente ao longo do texto.

**v1.0** — Versão original.

---

# 1. Visão do Produto

O **Filamap** é uma plataforma SaaS para gestão automática de inventário de filamentos utilizados em impressoras 3D Bambu Lab.

O princípio central do produto é simples:

> O utilizador não deve controlar manualmente quanto filamento foi consumido.

Depois da configuração inicial, a rotina normal de produção continua praticamente idêntica à que o utilizador já possui:

**Bambu Studio → Fatiar → Imprimir → Retirar a peça.**

O Filamap trabalha em segundo plano.

Ele acompanha a impressora pela rede local, identifica qual trabalho está sendo executado, obtém os dados de consumo do trabalho, relaciona os filamentos utilizados aos carretéis físicos cadastrados e atualiza automaticamente o saldo de cada bobina.

O sistema elimina práticas como:

- pesar bobinas constantemente;
- anotar pesos em etiquetas;
- atualizar planilhas;
- estimar visualmente quanto filamento resta;
- informar manualmente o consumo após cada impressão;
- clicar em "finalizar consumo";
- confirmar manualmente cada baixa de estoque.

A proposta de valor do Filamap não é simplesmente criar um "estoque de filamento".

A proposta é criar um:

**inventário de filamentos que se mantém atualizado sozinho.**

---

# 2. Princípios de Experiência

O desenvolvimento do Filamap deve seguir cinco princípios.

## 2.1 Automação primeiro

Sempre que uma informação puder ser obtida automaticamente da impressora, AMS, arquivo `.3mf` ou Bambu Studio, ela não deve ser solicitada ao utilizador.

## 2.2 Configurar uma vez, usar continuamente

O trabalho manual deve estar concentrado principalmente no onboarding e na entrada de uma nova bobina.

## 2.3 Invisibilidade operacional

Durante uma impressão normal, o Filamap não deve exigir nenhuma interação.

## 2.4 Estoque baseado em eventos reais

O consumo deve estar relacionado a trabalhos reais executados pela impressora, e não apenas a estimativas inseridas manualmente.

## 2.5 Exceção, não confirmação

O sistema não deve perguntar:

> "Esta impressão consumiu 183 g. Deseja dar baixa?"

Ele deve efetuar a baixa automaticamente.

Somente situações anormais devem chamar a atenção do utilizador.

---

# 3. Arquitetura Conceitual

A solução é composta por três grandes componentes.

## 3.1 Filamap Cloud

Aplicação SaaS responsável por:

- autenticação;
- empresas/workspaces;
- utilizadores;
- impressoras;
- AMS;
- cadastro de bobinas;
- inventário;
- histórico de consumo;
- jobs de impressão;
- alertas;
- relatórios;
- sincronização entre dispositivos.

O backend utiliza **Supabase** como camada principal de dados.

## 3.2 Filamap Desktop Agent

Pequeno serviço instalado em um computador da mesma rede local das impressoras.

Ele funciona como ponte entre:

**Rede local / impressora**

e

**Filamap Cloud.**

O agente é responsável por tarefas que não devem depender diretamente de um navegador ou servidor externo.

Entre elas:

- descobrir impressoras;
- estabelecer conexão MQTT;
- manter conexão MQTT;
- observar eventos da impressora;
- acessar arquivos pela rede local;
- conectar via FTPS;
- baixar `.3mf` / `.gcode.3mf`;
- extrair metadados;
- fazer parsing;
- enviar eventos estruturados ao backend;
- armazenar temporariamente eventos caso a internet esteja indisponível.

O Agent deve rodar automaticamente com o sistema operacional.

Depois da instalação, o utilizador normalmente não precisa abri-lo.

## 3.3 Impressora Bambu Lab

A impressora é a fonte primária de eventos operacionais.

Na arquitetura LAN atual utilizada por ferramentas da comunidade Bambu, a comunicação local normalmente utiliza MQTT sobre TLS na porta `8883`, enquanto operações de arquivo utilizam FTPS na porta `990`.

O Filamap utiliza esses canais principalmente em modo de leitura/monitorização.

---

# 4. Jornada Geral

A jornada pode ser resumida como:

**Criar conta → instalar Agent → detectar impressora → conectar → cadastrar bobinas iniciais → produzir normalmente → Filamap acompanha → calcula consumo → atualiza estoque → avisa quando necessário → trocar bobina → continuar produzindo.**

Depois do onboarding, quase toda a jornada ocorre sem intervenção humana.

---

# FASE 1 — ONBOARDING E INSTALAÇÃO

# 5. Objetivo da fase

Levar o utilizador de:

**"Acabei de criar minha conta"**

para:

**"Minha impressora está sendo monitorada pelo Filamap"**

com o menor número possível de configurações técnicas.

A experiência não deve parecer uma configuração de MQTT ou IoT.

Termos como:

- broker;
- tópico MQTT;
- FTPS;
- hostname;
- porta 8883;
- certificado TLS;

não devem fazer parte da interface normal.

---

# 6. Jornada do utilizador

## Etapa 1 — Criação da conta

O utilizador acessa o Filamap e cria sua conta.

Após entrar, encontra uma tela simples:

**Vamos conectar sua primeira impressora.**

Botão:

**Instalar Filamap Agent**

O sistema detecta automaticamente o sistema operacional quando possível e oferece o instalador adequado.

---

# 7. Instalação do Desktop Agent

O utilizador executa o instalador.

O Agent:

1. instala o serviço local;
2. configura inicialização automática;
3. cria uma identificação única da instalação;
4. inicia comunicação segura com Filamap Cloud;
5. associa temporariamente aquela instalação à sessão do onboarding.

A aplicação web passa a mostrar:

**Agent encontrado ✓**

---

# 8. Descoberta automática de impressoras

Depois da instalação, o Agent inicia uma varredura controlada da rede local.

O objetivo é encontrar dispositivos Bambu Lab sem exigir que o utilizador informe manualmente:

`192.168.1.xxx`

A descoberta pode utilizar os mecanismos disponíveis na rede local e validação dos serviços conhecidos da impressora.

> **⚠️ Nota v1.1 — descoberta precisa ter camadas, não só SSDP.**
> Descoberta automática via SSDP (multicast UDP) funciona na maioria das
> redes domésticas, mas não é garantida — roteadores com isolamento entre
> bandas de WiFi (2.4GHz/5GHz), rede de convidados, ou certas configurações
> de VLAN bloqueiam multicast. Isso não é hipotético: aconteceu em uso real
> — a impressora recebeu um IP novo do DHCP depois de ser reiniciada, e o
> Agent ficou apontando pro endereço antigo até intervenção manual. A
> arquitetura correta é em camadas:
> 1. **SSDP** (rápido, funciona na maioria dos casos).
> 2. **Varredura de sub-rede** como fallback — tentar conectar direto na
>    porta MQTT (8883) em cada IP da faixa local, confirmando pelo número de
>    série. Mais lento, mas não depende de multicast.
> 3. **Entrada manual do IP** como último recurso, com uma UI que não pareça
>    fracasso (ex.: "não conseguimos localizar automaticamente — digite o
>    IP da impressora").
>
> Além disso, a descoberta não pode acontecer só uma vez no onboarding: o
> Agent precisa detectar falha persistente de conexão (não uma queda
> passageira) e disparar a redescoberta sozinho, sem exigir reinício manual
> do processo. Esse é o cenário que efetivamente ocorreu e motivou essa nota.

O Filamap tenta obter automaticamente:

- modelo;
- nome;
- número de série;
- endereço de rede;
- presença de AMS;
- estado da impressora.

A interface apresenta algo como:

**Encontramos sua impressora**

Bambu Lab A1  
AMS Lite detectado

Botão:

**Conectar**

---

# 9. Credencial LAN

Existe uma limitação importante.

O Agent pode reduzir enormemente a configuração manual, porém não deve assumir que conseguirá obter silenciosamente todas as credenciais da impressora.

O acesso MQTT/FTPS local utiliza autenticação, normalmente com usuário `bblp` e o LAN Access Code da impressora.

Portanto, quando a credencial ainda não estiver disponível de forma segura para o Agent, o onboarding deve orientar o utilizador visualmente.

Exemplo:

**Falta somente uma etapa.**

> Na tela da sua impressora, abra Rede → Acesso LAN e informe o código exibido.

O utilizador informa o código uma única vez.

Não é necessário pedir:

- MQTT;
- IP;
- portas;
- usuário;
- certificado;
- caminhos FTPS.

Esses detalhes pertencem ao Agent.

---

# 10. Validação automática

Após a credencial ser informada, o Agent realiza um teste.

Ele verifica:

### MQTT

Consegue receber os estados da impressora?

### FTPS

Consegue acessar o sistema de arquivos necessário?

### AMS

Consegue identificar os slots disponíveis?

Se tudo estiver correto:

**Impressora conectada ✓**

O onboarding avança automaticamente.

---

# 11. Segurança

As credenciais LAN devem permanecer preferencialmente no dispositivo local.

O backend não deve precisar armazenar em texto simples:

- Access Code;
- credenciais MQTT;
- credenciais FTPS.

Quando alguma credencial precisar ser persistida, deve utilizar armazenamento criptografado.

O Desktop Agent deve trabalhar segundo o princípio de privilégio mínimo.

> **⚠️ Nota v1.1 — isolamento entre utilizadores é tão crítico quanto a
> credencial LAN.** Uma revisão da implementação real encontrou uma falha
> mais grave do que a guarda de credenciais: as tabelas do Supabase estavam
> sem Row Level Security habilitada, e a anon key ficava exposta no código
> do frontend — na prática, qualquer visitante do site conseguia ler e
> **editar** carretéis, impressoras e histórico de **qualquer** utilizador.
> Já corrigido (RLS habilitada em `spools`, `printers`, `ams_slots`,
> `print_jobs`, com policies por `auth.uid()`), mas fica registrado aqui
> porque é um requisito de arquitetura, não um detalhe de implementação: em
> qualquer iteração futura do schema (incluindo a evolução pra
> `workspaces`/multi-tenancy descrita na Seção 42), toda tabela nova precisa
> nascer com RLS pensada desde o início, e toda função `SECURITY DEFINER`
> (usada pra descontar peso de bobina, por exemplo) precisa checar
> explicitamente que quem chamou é dono do recurso — outra falha real
> encontrada e corrigida (a função de desconto de peso não checava isso).
> Também vale registrar: o Desktop Agent hoje autentica com login/senha reais
> (não só a anon key) pra que `auth.uid()` resolva corretamente e a RLS
> funcione a favor dele, não contra.

---

# FASE 2 — CONFIGURAÇÃO INICIAL DO ESTOQUE

# 12. Objetivo

Esta é a principal intervenção manual inicial do utilizador.

O Filamap já consegue ver:

**AMS → slots**

mas precisa descobrir:

**qual bobina física cadastrada corresponde àquele slot.**

---

# 13. Representação do AMS

O Filamap apresenta graficamente o AMS.

Exemplo:

**AMS Lite**

Slot 1  
Slot 2  
Slot 3  
Slot 4

Quando informações puderem ser identificadas pela impressora, o sistema pode pré-preencher:

- material;
- cor;
- identificação RFID, quando disponível;
- fabricante ou perfil identificado;
- status carregado/descarregado.

O utilizador apenas confirma ou completa os dados necessários.

---

# 14. Cadastro da bobina

Para filamentos novos, o utilizador pode criar:

**Marca:** Bambu Lab  
**Material:** PETG HF  
**Cor:** Preto  
**Peso nominal:** 1.000 g

Outros campos opcionais:

- custo;
- lote;
- data de compra;
- fornecedor;
- temperatura;
- observação;
- localização física.

O sistema cria uma entidade `spool`.

Exemplo conceitual:

```text
spool_id
workspace_id
brand
material
color
initial_weight_g
remaining_weight_g
status
created_at
```

---

# 15. Peso inicial

Para uma bobina nova e conhecida:

`remaining_weight_g = peso_nominal`

Exemplo:

`1000 g`

Para uma bobina parcialmente utilizada antes da adoção do Filamap, existe inevitavelmente um problema de origem:

o sistema não conhece retroativamente o que já foi consumido.

Neste único cenário podem existir alternativas de inicialização:

**Bobina nova**

Informar 1.000 g.

**Bobina parcialmente usada**

Informar um valor aproximado ou realizar uma pesagem inicial.

Essa pesagem, quando necessária, é um procedimento de **migração para o sistema**, e não parte da operação diária.

---

# 16. Mapeamento Slot → Spool

O utilizador relaciona:

**AMS 1 / Slot 1 → Spool A**

**AMS 1 / Slot 2 → Spool B**

etc.

Essa relação deve ser armazenada separadamente.

Exemplo:

```text
ams_slot_assignments

printer_id
ams_id
slot_id
spool_id
assigned_at
removed_at
```

Isso é fundamental.

O Filamap não controla apenas:

"PETG preto".

Ele controla:

**qual bobina física de PETG preto está naquele slot.**

---

# 17. Fim da configuração

Ao terminar:

**Seu Filamap está pronto.**

A partir desse momento, o utilizador não precisa informar consumo depois das impressões.

---

# FASE 3 — ROTINA DIÁRIA DE PRODUÇÃO

# 18. Objetivo

A rotina deve ser indistinguível da rotina normal de uma pessoa que não utiliza Filamap.

---

# 19. Jornada normal

O utilizador abre o Bambu Studio.

Carrega um modelo.

Configura:

- impressora;
- filamentos;
- cores;
- suporte;
- parâmetros.

Clica em:

**Fatiar**

O Bambu Studio calcula o trabalho.

Depois:

**Imprimir placa.**

A impressão é enviada normalmente.

Nesse momento o utilizador não precisa abrir o Filamap.

---

# 20. O que o utilizador faz

Durante uma impressão normal:

**Nada.**

Não existe:

- botão "iniciar consumo";
- botão "finalizar";
- confirmação de peso;
- seleção novamente da bobina;
- lançamento manual;
- leitura manual do fatiador.

Ele apenas recolhe a peça ao final.

---

# 21. O que o Filamap percebe

Paralelamente, o Desktop Agent está inscrito nos eventos da impressora.

Um fluxo simplificado é:

```text
IDLE
↓
PREPARING
↓
RUNNING
↓
FINISH
↓
IDLE
```

Estados reais podem variar conforme modelo e firmware.

Por isso o Filamap deve possuir uma máquina de estados própria, que normalize os estados enviados pela Bambu Lab.

---

# FASE 4 — AUTOMAÇÃO EM SEGUNDO PLANO

# 22. Início de impressão

Quando o Agent detecta que um novo trabalho iniciou, ele cria uma sessão interna.

Exemplo:

```text
print_job

job_id
printer_id
external_task_id
filename
started_at
status = running
```

O Agent também cria um identificador idempotente do trabalho.

Esse detalhe é importante para evitar que reconexões MQTT criem duas baixas para a mesma impressão.

---

# 23. Identificação do arquivo

A partir dos eventos recebidos da impressora, o Agent identifica o arquivo associado ao trabalho.

Quando disponível localmente, utiliza FTPS para obter o `.3mf` ou `.gcode.3mf` correspondente.

Arquivos Bambu `.3mf` são containers estruturados que podem conter diversos arquivos de configuração e metadados internos.

No código atual do Bambu Studio existe explicitamente o caminho:

`Metadata/slice_info.config`

e são definidos campos como:

`used_m`  
`used_g`  
`used_for_support`  
`used_for_object`

entre outros.

> **⚠️ Nota v1.1 — caminho do arquivo confirmado, nomes de campo confirmados
> em produção (2ª atualização).** Confirmamos de forma independente
> (biblioteca `lib3mf-core` e documentação técnica de terceiros) que
> `Metadata/slice_info.config` existe mesmo — o `.gcode.3mf` é um ZIP
> comum, e esse arquivo fica lá dentro com peso estimado e estatísticas por
> filamento. **Atualização:** o Agent real já busca esse arquivo via FTPS
> no início do job e confirma que o peso por cor vem do campo
> **`totalGrams`**, dentro de um array por slot/tray — não os nomes
> `used_m`/`used_g`/`used_for_support`/`used_for_object` originalmente
> supostos nesta seção, nem um total único combinado. Esse é o dado real,
> validado contra a implementação em produção (`index.ts:337-346`), não
> mais suposição.

---

# 24. Extração do .3mf

O Agent não precisa enviar o arquivo inteiro ao SaaS.

Preferencialmente:

1. baixa o arquivo localmente;
2. abre o container;
3. extrai somente os arquivos necessários;
4. realiza parsing local;
5. envia ao backend apenas dados estruturados.

Isso reduz:

- tráfego;
- armazenamento;
- exposição de modelos do cliente;
- problemas de privacidade.

---

# 25. Parsing de slice_info.config

O parser identifica cada filamento utilizado na placa.

Conceitualmente:

```text
Filamento 1
Material: PETG
Cor: #000000
used_g: 84.32

Filamento 2
Material: PETG
Cor: #FFFFFF
used_g: 17.41
```

O Bambu Studio mantém em `slice_info.config` informações de consumo por filamento, incluindo peso utilizado.

---

# 26. Modelo, suporte e desperdício

Para o Filamap existem dois conceitos diferentes:

### Estoque

Quanto saiu fisicamente da bobina.

### Analytics

Para onde aquele material foi.

Exemplo:

```text
Consumo total: 183 g

Peça: 142 g
Suporte: 16 g
Flush/purga/torre/outros: 25 g
```

Para o estoque, o valor crítico é:

**183 g.**

Todo material efetivamente extrudado deve reduzir a bobina.

---

# 27. Regra importante sobre flush/purga

O Filamap não deve assumir que todas as versões do `.3mf` sempre oferecem um único campo explícito chamado:

`flush_weight`

O `slice_info.config` possui valores totais e campos relacionados ao uso em objeto e suporte.

Portanto, a arquitetura correta é:

### Camada 1 — consumo total autoritativo

`used_g`

### Camada 2 — consumo por função quando disponível

- objeto;
- suporte;
- outras categorias expostas.

### Camada 3 — consumo derivado

Quando necessário:

```text
overhead_g =
total_used_g
- object_g
- support_g
```

Esse overhead pode agrupar:

- purge;
- flush;
- prime;
- wipe tower;
- linhas de preparação;
- outros consumos auxiliares.

Caso uma versão futura do Bambu Studio exponha esses valores separadamente, o parser pode incorporar os campos sem alterar o modelo central do Filamap.

---

# 28. Relação Filamento do arquivo → AMS → Spool

Esta é uma das etapas mais importantes.

O arquivo informa:

**Filamento X consumiu Y gramas.**

A impressora informa o mapeamento utilizado para o trabalho.

O Filamap precisa resolver:

```text
Filamento lógico do slice
↓
slot efetivamente utilizado
↓
AMS
↓
spool_id
```

Resultado:

```text
Filamento 1
↓
AMS 1 Slot 3
↓
spool_8472
↓
84,32 g consumidos
```

Só depois dessa resolução o sistema pode lançar estoque.

---

# 29. Durante a impressão

O Filamap registra:

- início;
- progresso;
- camada atual quando disponível;
- status;
- alterações;
- cancelamento;
- erro.

Mas **não efetua repetidamente baixas definitivas de estoque durante a impressão normal**.

Isso evita inconsistências provocadas por:

- reinicialização;
- mensagens MQTT duplicadas;
- perda de conexão;
- reenvio de estado.

O job permanece:

`running`

---

# 30. Conclusão do trabalho

Quando a máquina de estados identifica uma conclusão válida:

`FINISH / COMPLETED`

o backend executa a finalização do job.

Exemplo:

```text
Job 9821

Spool Preto
84,32 g

Spool Branco
17,41 g
```

O Filamap cria movimentos de estoque.

```text
spool_movements

movement_id
spool_id
job_id
type = print_consumption
quantity_g = -84.32
created_at
```

Depois atualiza:

```text
spools.remaining_weight_g
```

---

# 31. Transação atômica

A finalização deve acontecer em uma transação ou operação idempotente.

Objetivo:

**um job só pode gerar uma baixa definitiva uma vez.**

A lógica deve obedecer aproximadamente:

```text
Se job.finalized_at existe:
    não baixar novamente

Caso contrário:
    criar movimentos
    atualizar saldo
    marcar job como finalizado
```

Isso é indispensável para ambientes IoT, onde mensagens podem ser repetidas.

---

# 32. Exemplo completo

Bobina inicial:

**PETG Preto = 1.000 g**

Impressão:

```text
Objeto: 137 g
Suporte: 18 g
Overhead/purga: 25 g
```

Consumo físico:

`180 g`

Saldo:

`1000 - 180 = 820 g`

O utilizador não digitou nenhum desses valores.

---

# 33. Dashboard após a impressão

Ao abrir o Filamap depois, o utilizador pode visualizar:

**PETG Preto**

820 g restantes

**Último consumo**

180 g

**Trabalho**

Suporte celular

**Distribuição**

Objeto: 137 g  
Suporte: 18 g  
Processo/purga: 25 g

O dashboard serve para informar, não para autorizar o lançamento.

---

# 34. Impressão cancelada ou com erro

Este é um cenário diferente de uma impressão concluída.

Em uma impressão interrompida, o valor total previsto pelo slicer não pode simplesmente ser descontado.

Também não é suficientemente preciso assumir:

```text
consumo total × percentual de impressão
```

porque o consumo por camada não é uniforme.

Portanto o Filamap deve tratar:

**Impressão concluída**

Consumo exato disponível no slice.

**Impressão cancelada/falha**

Consumo estimado, calculado pela melhor fonte disponível.

No futuro, o Agent pode aumentar a precisão analisando G-code e extrusão acumulada por camada.

---

# 35. Política para jobs incompletos

O sistema pode registrar:

```text
consumption_quality = exact
```

para impressões concluídas.

E:

```text
consumption_quality = estimated
```

para impressões interrompidas.

A baixa continua podendo ser automática, mas o histórico indica que se trata de estimativa.

Isso mantém a filosofia:

**sem intervenção manual obrigatória.**

---

# 36. Funcionamento offline

O Agent precisa continuar monitorando a impressora mesmo se a internet cair.

Arquitetura:

```text
Impressora
↓
Desktop Agent
↓
SQLite/local queue
↓
Internet retorna
↓
Supabase
```

Eventos relevantes ficam persistidos localmente.

Quando a conexão retorna, o Agent sincroniza os eventos.

O `job_id` / chave idempotente impede lançamentos duplicados.

---

# FASE 5 — CICLO DE VIDA E REPOSIÇÃO

# 37. Estoque baixo

O Filamap acompanha continuamente:

`remaining_weight_g`

Cada workspace pode definir limites.

Exemplo:

**Avisar abaixo de 200 g.**

Ao atingir o limite:

**PETG Preto está chegando ao fim — aproximadamente 176 g restantes.**

---

# 38. Previsão antes da impressão

Uma evolução importante do Filamap é utilizar o consumo previsto do próximo trabalho.

Exemplo:

Bobina disponível:

`176 g`

Trabalho:

`243 g`

O Filamap pode informar:

**Esta bobina provavelmente não possui material suficiente para concluir este trabalho.**

Esse aviso é muito mais útil do que simplesmente dizer que o estoque está baixo.

---

# 38.1 Margem de segurança e recalibração (v1.1)

Mesmo com consumo descontado automaticamente por trabalho, o saldo
calculado nunca é uma medição física direta — é sempre derivado do que o
fatiador previu (Seção 27) ou de uma estimativa proporcional (Seção 34).
Erros pequenos se acumulam impressão após impressão, principalmente por
conta de refile/purga em trocas de cor, que raramente é contabilizado com
100% de exatidão pelo fatiador.

O princípio adotado não é buscar precisão absoluta — é suficiente que o
saldo mostrado seja **confiável o bastante pra decidir "imprimo ou
confiro antes"**. Dois mecanismos resolvem isso:

## Margem de segurança

A margem é aplicada sobre **o que foi consumido desde a última pesagem
confirmada**, não sobre o saldo total da bobina — porque o erro cresce com o
quanto passou pela bobina sem confirmação, não com o quanto ainda resta.
Uma bobina recém-pesada tem erro zero, esteja cheia ou quase vazia.

```text
saldo_seguro = saldo_calculado − (margem% × consumido_desde_ultima_pesagem)
```

Como o desvio tende a puxar sempre pro mesmo lado (a bobina real tem menos
filamento do que o cálculo sugere, quase nunca mais — por causa do refile
não contabilizado), a margem é sempre subtraída, nunca somada ao que a peça
precisa.

## Recalibração periódica

A margem sozinha não segura indefinidamente — depois de várias impressões
sem conferir, mesmo com margem o desvio acumulado pode passar do que ela
cobre. Um contador de "gramas consumidas desde a última pesagem
confirmada" dispara um lembrete discreto (não bloqueante) quando ultrapassa
um limite (ex.: ~150g) sugerindo pesar a bobina na próxima vez que for
usada.

## Dois avisos diferentes

- **De fundo** (não bloqueia impressão): bobina passou do limite de
  recalibração → sugestão discreta de pesagem.
- **Na hora de decidir**: a impressão que o utilizador está prestes a
  iniciar consome mais que uma fração alta (ex.: 75–80%) do saldo já com
  margem aplicada → aviso ativo, "confira antes de imprimir".

## Exibição

O número mostrado carrega o contexto, não só o valor:

> ≈105g seguros (120g calculado, 3 impressões desde a última pesagem)

Isso deixa claro que é uma estimativa com nível de confiança — não um
valor cravado — sem exigir que o utilizador entenda a mecânica por trás.

---

# 39. Fim da bobina

Quando a bobina estiver próxima de zero, o sistema pode classificá-la como:

`low_stock`

Depois:

`depleted`

A bobina não precisa ser apagada.

Ela passa a fazer parte do histórico.

Assim o utilizador consegue posteriormente saber:

- quando foi aberta;
- quanto imprimiu;
- quais trabalhos utilizaram aquela bobina;
- quanto durou;
- qual foi seu custo por grama;
- quanto material foi para peça;
- quanto material foi para suporte;
- quanto foi desperdício operacional.

---

# 40. Troca física da bobina

O utilizador remove a bobina vazia.

Coloca uma nova bobina no AMS.

O Filamap detecta alteração no slot quando essa informação estiver disponível.

A interface solicita somente a informação que não puder ser descoberta automaticamente.

Exemplo:

**Detectamos uma nova bobina no AMS 1 — Slot 2.**

Se for reconhecida automaticamente:

**Bambu PETG HF — Preto — 1 kg**

Botão:

**Confirmar**

Se não for reconhecida:

**Qual bobina você colocou?**

O utilizador seleciona uma bobina já cadastrada ou cria uma nova.

---

# 41. Filosofia da reposição

A troca de bobina é um evento físico real.

Portanto é aceitável existir uma pequena interação nesse momento.

O princípio do Filamap não é:

**zero interação para sempre.**

É:

**zero trabalho administrativo desnecessário.**

Trocar fisicamente uma bobina é inevitável.

Registrar manualmente cada impressão não é.

---

# 42. Modelo de Dados Principal

O MVP pode trabalhar com entidades como:

```text
users
workspaces
workspace_members

agents
printers
ams_units
ams_slots

spools
ams_slot_assignments

print_jobs
print_job_filaments
spool_movements

alerts
agent_events
```

---

# 43. Tabela spools

Exemplo conceitual:

```text
spools

id
workspace_id
brand
material
color_hex
nominal_weight_g
initial_weight_g
remaining_weight_g
cost
status
rfid_uid
created_at
depleted_at
```

---

# 44. Print Jobs

```text
print_jobs

id
workspace_id
printer_id

external_task_id
file_name
file_hash

status

started_at
completed_at
finalized_at

consumption_quality

created_at
```

O `file_hash` ajuda na identificação e auditoria.

---

# 45. Consumo por filamento

```text
print_job_filaments

id
print_job_id

filament_index
ams_id
ams_slot

spool_id

total_g
object_g
support_g
overhead_g
```

---

# 46. Ledger de estoque

O saldo da bobina não deve ser o único registro.

É importante existir um ledger imutável de movimentos.

```text
spool_movements

id
workspace_id
spool_id

print_job_id

movement_type
quantity_g

balance_before_g
balance_after_g

created_at
```

Tipos possíveis:

```text
initial_stock
print_consumption
manual_adjustment
replacement
correction
```

Isso cria auditabilidade.

---

# 47. Máquina de Estados do Job

Uma máquina de estados interna pode usar:

```text
detected
preparing
running
paused
completed
failed
cancelled
processed
```

O estado:

`processed`

significa:

**o consumo já foi lançado no inventário.**

Essa separação é importante.

Uma impressão pode estar:

`completed`

mas ainda aguardando processamento local por alguns segundos.

---

# 48. Fluxo Técnico Completo

```text
Bambu Studio
     │
     │ envia impressão
     ▼
Bambu Lab Printer
     │
     │ MQTT
     ▼
Filamap Agent
     │
     ├── detecta novo job
     │
     ├── registra estado RUNNING
     │
     ├── identifica arquivo
     │
     │
     ├── FTPS
     │      │
     │      ▼
     │   .gcode.3mf
     │
     ├── abre container
     │
     ├── Metadata/slice_info.config
     │
     ├── identifica filamentos
     │
     ├── identifica used_g
     │
     ├── identifica objeto/suporte
     │
     ├── calcula overhead quando necessário
     │
     └── resolve Filamento → AMS → Spool
            │
            ▼
        Job RUNNING
            │
            │ MQTT
            ▼
      Impressão termina
            │
            ▼
       COMPLETED
            │
            ▼
        Supabase RPC
            │
            ├── valida idempotência
            ├── cria spool_movements
            ├── atualiza spools
            └── marca job processed
```

---

# 49. O que acontece para o utilizador

Todo esse fluxo técnico corresponde a somente isto:

```text
Fatiar
↓
Imprimir
↓
Retirar peça
```

Essa diferença entre a complexidade interna e a simplicidade externa é a característica principal do Filamap.

---

# 50. Tratamento de Exceções

O Filamap deve utilizar o conceito:

**Silent Success, Visible Exception.**

Quando tudo funciona corretamente:

nenhuma intervenção.

Quando algo não funciona:

o sistema explica claramente o que ocorreu.

Exemplos:

**Agent offline**

> O computador responsável pela impressora está offline.

**Impressora inacessível**

> Não conseguimos comunicar com a impressora.

**Bobina não mapeada**

> A impressão utilizou o Slot 3, mas não sabemos qual bobina está nele.

**Arquivo indisponível**

> Detectamos a impressão, mas não conseguimos obter os dados de consumo.

**Job cancelado**

> A impressão foi interrompida. O consumo registrado é uma estimativa.

---

# 51. Reconciliação automática

Problemas temporários não devem imediatamente exigir intervenção.

Antes de alertar o utilizador, o Agent deve tentar:

- reconectar MQTT;
- reabrir FTPS;
- localizar novamente o arquivo;
- sincronizar eventos pendentes;
- resolver jobs incompletos.

Só depois disso o evento deve aparecer como pendência.

---

# 52. Métrica principal do produto

Uma das métricas mais importantes do Filamap deve ser:

**Percentual de impressões processadas sem intervenção humana.**

Objetivo de produto:

> >99% das impressões normais devem atualizar o estoque automaticamente.

Outras métricas importantes:

- taxa de jobs identificados;
- taxa de arquivos encontrados;
- taxa de mapeamento automático Spool ↔ AMS;
- diferença entre saldo estimado e saldo real;
- número de intervenções manuais por 100 impressões.

---

# 53. Privacidade

Modelos 3D podem conter propriedade intelectual.

Portanto, a arquitetura deve evitar enviar arquivos completos para a nuvem quando isso não for necessário.

O fluxo preferido é:

```text
3MF permanece local
↓
Agent extrai metadados
↓
Cloud recebe somente informações operacionais
```

Por exemplo:

```text
job
material
peso
AMS
slot
spool
tempo
status
```

e não necessariamente a geometria do objeto.

---

# 54. Responsabilidade do Desktop Agent

O Desktop Agent deve ser considerado um componente central do Filamap e não apenas um utilitário complementar.

Ele funciona como um **Edge Gateway**.

Responsabilidades:

### Device Discovery

Encontrar impressoras.

### Device Communication

Manter MQTT/FTPS.

### Normalization

Transformar protocolos e estados Bambu em eventos Filamap.

### Local Parsing

Interpretar `.3mf`.

### Offline Buffer

Sobreviver a falhas de internet.

### Secure Credential Storage

Guardar credenciais locais.

### Sync

Sincronizar dados com o SaaS.

---

# 55. Responsabilidade do Supabase

O Supabase deve ser responsável principalmente por:

- autenticação;
- multi-tenancy;
- persistência;
- inventário;
- histórico;
- regras de negócio centralizadas;
- APIs;
- realtime do dashboard;
- alertas;
- relatórios.

A comunicação direta:

`Supabase → impressora`

não deve ser necessária.

O caminho é:

```text
Supabase
↕
Desktop Agent
↕
Impressora
```

---

# 56. MVP recomendado

O MVP deve priorizar a promessa fundamental:

> "Imprimiu? O estoque atualizou sozinho."

Portanto, o núcleo do MVP é:

### Agent

Descoberta e conexão.

### MQTT

Identificação de início/fim.

### FTPS

Obtenção do arquivo.

### 3MF Parser

Consumo por filamento.

### AMS Mapping

Associação à bobina física.

### Spool Inventory

Saldo em gramas.

### Automatic Consumption

Baixa automática.

### History

Histórico de impressões e consumo.

### Low Stock

Alertas de estoque baixo.

Tudo que não melhora diretamente esse ciclo pode ficar para fases posteriores.

---

# 57. Funcionalidades posteriores

Após a automação central estar confiável, o Filamap pode evoluir para:

### Previsão de autonomia

"Você possui aproximadamente 14 horas de impressão deste PETG."

### Análise de desperdício

"18% do PETG consumido neste mês foi utilizado em suporte e purga."

### Custo por trabalho

Material realmente consumido × custo por grama.

### Previsão de compra

"PETG Preto deve acabar em aproximadamente 6 dias no ritmo atual."

### Farm Management

Controle de várias impressoras e AMS.

### Rastreabilidade por lote

Identificar quais peças utilizaram determinada bobina.

### Compras

Sugestões de reposição.

### NFC/RFID opcional

Identificação ainda mais fácil de bobinas externas e internas.

---

# 58. Definição da Experiência Ideal

Depois da implantação, um utilizador pode trabalhar durante uma semana inteira sem abrir a tela de estoque.

Ao acessar o Filamap, encontra algo como:

**PETG Preto**

312 g restantes

**PETG Branco**

746 g restantes

**PLA Azul**

891 g restantes

**Últimos 7 dias**

37 impressões  
4,82 kg consumidos  
3,94 kg em modelos  
0,42 kg em suporte  
0,46 kg em processo/purga

Nada disso precisou ser digitado após cada impressão.

Esse é o estado ideal do produto.

---

# 59. Definição de Sucesso

O Filamap estará cumprindo sua proposta quando o utilizador deixar de fazer a pergunta:

> "Será que essa bobina tem filamento suficiente?"

e passar a confiar no sistema para responder:

> "Esta bobina possui aproximadamente 312 g. O próximo trabalho necessita de 186 g."

A verdadeira função do Filamap não é registrar bobinas.

É transformar filamento físico em **estoque digital confiável e automaticamente atualizado**.

---

# 60. Resumo da Jornada

## Primeiro dia

```text
Criar conta
→ instalar Agent
→ detectar impressora
→ conectar
→ mapear bobinas do AMS
→ pronto
```

## Todos os outros dias

```text
Fatiar
→ imprimir
→ retirar peça
```

Enquanto isso:

```text
MQTT detecta
→ FTPS obtém arquivo
→ Parser interpreta
→ AMS identifica bobina
→ Filamap calcula
→ Supabase registra
→ estoque atualiza
```

## Quando acabar uma bobina

```text
Retirar bobina
→ colocar nova
→ Filamap detecta
→ identificar/confirmar bobina
→ continuar imprimindo
```

---

# 62. Estado Real de Implementação (v1.5 — fonte oficial de estado)

> **📌 Snapshot vigente — 24/09/2026 / main@3ce850a.** Build e testes
> atuais passaram: Agent 106/106 unitários + 13/13 integração; Web 33/33 +
> build; migrations local/remoto alinhadas até `20260923120000`. O código
> contém onboarding gráfico Windows, DPAPI, instalador/auto-start, Cloud
> Spool Sync, weight gate e resolução automática de spool físico. O MVP
> permanece **não homologado E2E** porque o Agent usado na última impressão
> real era antigo e a identidade física Bambu Cloud × NFC ainda precisa ser
> provada com a build atual.


> **📌 Aviso v1.3 (19/09/2026) — este documento é a fonte oficial do
> projeto, por decisão explícita de Ricardo.** A estrutura `docs/00`–`09` +
> `GEMINI.md` existe no repositório, mas a precedência real é: **este
> documento manda**. Isso significa que `GEMINI.md` precisa ser corrigido
> pra parar de se autodeclarar acima deste documento na hierarquia —
> registrado como pendência logo abaixo.
>
> As correções trazidas pela auditoria do Gemini (18/09/2026) continuam
> válidas como **fatos sobre o código** — isso não muda com a decisão de
> qual documento manda. O que muda é que agora essas correções são
> incorporadas aqui como estado confirmado, em vez de tratadas como uma
> fonte concorrente:
>
> - ~~**`needs_weighing` não funciona como deveria.**~~ **Corrigido em
>   20/09/2026:** substituído pela cascata de 4 níveis
>   (`consumption_quality`); o fallback fixo de 35g foi removido,
>   `needs_weighing` agora é derivado corretamente como
>   `(consumption_quality = 'unknown')`.
> - ~~**Consumo multicolor está incompleto**~~ **Corrigido em
>   20/09/2026:** o Agent rastreia todos os slots usados durante o job
>   (não só o inicial) e gera uma linha de log/desconto por slot.
> - **`slice_info.config`/FTPS ainda não têm validação com arquivo real**
>   documentada de forma confiável. **Ainda em aberto** — sem hardware
>   físico disponível nas sessões até agora.
> - **A lacuna de migrations é maior do que a coluna `ams_slots.user_id`** —
>   tabelas inteiras (`print_logs`, `catalog_items`, `filament_presets`)
>   existem no banco real mas não em nenhuma migration versionada. **Ainda
>   em aberto, e mais grave do que estava registrado aqui:** em 20/09/2026
>   isso foi executado de verdade contra um Postgres vazio (não só lido) e
>   confirmado com pelo menos 5 pontos de falha distintos, incluindo dois
>   blocos de sintaxe SQL inválida (`do push...end push` e `DO \$\$` com
>   barra invertida) que quebram mesmo depois de resolver a ordem das
>   tabelas. Ver `docs/08_BACKLOG.md` (P0.1) e `docs/09_CHANGELOG.md`.
> - ~~**A RPC segura que foi endurecida não é usada** na baixa real~~
>   **Corrigido em 20/09/2026, de forma diferente do esperado:** em vez de
>   passar a usar `deduct_spool_filament()`, foi criada uma função nova
>   (`public.finalize_print_job`) porque a baixa precisa ser atômica para
>   *vários* spools de uma vez (um job multicolor descontando N slots numa
>   única transação) — `deduct_spool_filament()` só cobre um spool por
>   chamada. `deduct_spool_filament()` em si continua sem uso.
> - **Leitura de NFC não fecha o ciclo** no frontend — isso já estava
>   desatualizado antes desta v1.4: `startScanning()` foi integrado à UI
>   (aba AMS) numa sessão anterior a 20/09/2026; o que ainda falta é só o
>   deep link passivo via `?tag=` no carregamento da página. Ver
>   `docs/07_CURRENT_STATE.md` ("NFC de leitura").
>
> **Pendência de v1.3 — já parece resolvida, não confirmada por quem
> corrigiu:** este parágrafo dizia que `GEMINI.md` se autodeclarava acima
> deste documento. Lido nesta sessão (20/09/2026), `GEMINI.md` (Seção 1)
> já lista este arquivo como item 1 da ordem de precedência — a correção
> parece ter sido feita em algum momento entre a v1.3 e agora, sem deixar
> rastro no changelog deste documento nem em `docs/06_DECISIONS.md`. Não
> apago o parágrafo original pra não apagar histórico; só registro que o
> estado atual de `GEMINI.md` já reflete o que era pedido aqui.
>
> **Como isso se mantém confiável:** este documento não tem acesso direto
> ao repositório, ao Supabase de produção ou à impressora — tudo que entra
> aqui vem do que é relatado na conversa. Pra continuar sendo a fonte que
> manda, sem repetir o episódio de registrar como "confirmado" algo que não
> era, cada achado técnico novo (de auditoria, de teste real, ou de leitura
> direta de código) deve continuar sendo trazido aqui pra ser incorporado —
> a autoridade do documento depende da qualidade do que é alimentado nele.

Este documento descreve a visão-alvo do Filamap. Vale registrar, pra quem
for implementar a partir daqui (incluindo ferramentas de codificação
assistida), onde a implementação real diverge do que está descrito acima.

## Schema realmente em produção hoje

O schema atual é mais simples do que o modelo completo da Seção 42 — não
existem ainda `workspaces`, `print_job_filaments` nem `spool_movements`
como tabelas próprias:

```text
spools          (equivalente à Seção 43, sem multi-tenancy por workspace)
printers
ams_slots       (mapeamento slot → spool, mais simples que
                 ams_slot_assignments da Seção 16 — sem histórico de
                 assigned_at/removed_at ainda)
print_jobs      (log de trabalhos, com needs_weighing em vez do
                 consumption_quality exact/estimated da Seção 35 —
                 recomendo migrar pra essa nomenclatura, é mais expressiva)
```

A evolução pro modelo completo (ledger imutável via `spool_movements`,
idempotência formal via `finalized_at`, multi-tenancy via `workspaces`) é
válida como próximo passo, mas ainda não foi implementada.

## Bugs reais encontrados e corrigidos numa revisão de código

- RLS ausente nas 4 tabelas + anon key exposta no frontend — qualquer
  visitante lia/editava dados de qualquer utilizador. Corrigido e
  **confirmado ao vivo em produção** (auditoria posterior consultou
  `pg_class` direto no banco): RLS habilitada nas 7 tabelas
  (`spools`, `printers`, `ams_slots`, `print_logs`, `catalog_items`,
  `filament_presets`, `print_jobs`), sem policies permissivas remanescentes.
- Função de desconto de peso (`SECURITY DEFINER`) sem checar dono do
  recurso. Corrigido — confirmado lendo a definição da função direto do
  banco (checagem `user_id = auth.uid()` + `search_path` fixo presentes).
- Peso descontado por impressão era um valor fixo (50g) independente do
  tamanho real da peça — substituído por `needs_weighing: true` (sem
  inventar número) até a automação da Seção 25 estar implementada de
  verdade.
- Nome de tabela e de colunas usados pelo Agent pra gravar o log de
  impressão não batiam com o schema real — nenhum histórico estava sendo
  salvo. Corrigido.
- `user_id` não era preenchido nos inserts — resolvido com
  `DEFAULT auth.uid()` na coluna, em vez de caçar todo insert no código.

## Achados de uma auditoria de segurança posterior (risco aceito / debt)

- **TLS sem validação de certificado** (MQTT e FTPS,
  `rejectUnauthorized: false`) — limitação conhecida do firmware Bambu
  (certificado autoassinado, sem CA). Risco residual: atacante já presente
  na mesma rede local poderia se passar pela impressora. Sem correção
  completa disponível hoje (dependeria da Bambu expor um fingerprint fixo
  pra pinning); documentado como risco aceito.
- **Migrations não reproduzíveis do zero** — a coluna `user_id` em
  `ams_slots` foi criada manualmente pelo dashboard do Supabase em algum
  momento, sem migration correspondente na `001`. Rodar as migrations do
  zero num projeto novo (disaster recovery, homologação) falharia na `002`
  exatamente na tabela que ela deveria proteger. Correção: migration `004`
  adicionando `ALTER TABLE public.ams_slots ADD COLUMN IF NOT EXISTS
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` antes do
  `SET DEFAULT` existente. Vale priorizar antes de qualquer ambiente novo
  (homologação, ou onboarding de cliente) precisar ser criado do zero.

## Confirmado em produção (não mais suposição)

- Caminho FTPS do `.gcode.3mf` e extração de `Metadata/slice_info.config`
  — implementados e funcionando em produção (`index.ts:216-239` e
  `:337-346`). Campo real de peso por cor: **`totalGrams`**, por slot/tray.
- Torre de fallback de 3 níveis confirmada no Agent: (1) `totalGrams` real
  do `slice_info.config` → (2) gramatura extraída do nome do arquivo → (3)
  estimativa genérica por duração (`duração × 0.22g/min`, sem info de
  cor/tray). Só o nível 1 é dado real do fatiador.

## Ainda pendente / a verificar

- Confirmação de que o payload MQTT expõe a amarração "filamento do
  projeto → slot físico da AMS" no formato esperado.
- Descoberta em camadas (SSDP → varredura de sub-rede → manual) descrita na
  nota da Seção 8 — hoje só existe um script de diagnóstico SSDP isolado,
  ainda não integrado ao Agent principal, e o Agent ainda depende de um IP
  fixo configurado manualmente.
- Persistência do job ativo em disco (Seção 36 já previa isso pra eventos
  gerais — fica mais crítico agora porque o job ativo também vai carregar o
  breakdown de peso por slot vindo do `slice_info.config`, hoje só em
  memória).
- Tela de "pendente de pesagem" no app — o dado (`needs_weighing`) já existe
  no banco, mas ainda não tem interface pra agir sobre ele.
- **Desconto de purga/flush não é escalado pelo `percentExecuted` em
  `FAILED`/`PAUSE_STOP`/`STOP`** (`index.ts:360-364`) — o valor cheio de
  purga é subtraído mesmo se o job falhar cedo. Direção do erro é
  conservadora (subtrai peso a mais, nunca a menos), então não é risco de
  segurança, só imprecisão a corrigir.
- **Migrar `needs_weighing` (booleano) para `consumption_quality`
  (enum)** — com a torre de fallback confirmada, faz sentido registrar qual
  nível foi usado em cada job: `exact` (nível 1), `estimated_filename`
  (nível 2), `estimated_duration` (nível 3) — em vez de só sim/não. O
  próprio Agent já calcula `sliceInfoFound` internamente; só falta
  persistir isso em `print_jobs`. Isso também dá uma métrica direta de
  quantos jobs caem em cada nível de confiança.

---

# 61. Princípio Orientador

> **O utilizador administra a produção. O Filamap administra o filamento.**
