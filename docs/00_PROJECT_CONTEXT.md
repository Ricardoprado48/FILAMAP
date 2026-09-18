# 00 — Contexto do Projeto Filamap

**Última auditoria deste documento:** 18/09/2026  
**Fonte:** código e arquivos presentes no pacote auditado.

## Produto

O **Filamap** é um SaaS/IoT para controle de filamentos de impressão 3D, inicialmente focado no ecossistema **Bambu Lab A1 + AMS Lite**.

A proposta central é manter o saldo dos carretéis atualizado com o mínimo de intervenção manual, combinando:

- telemetria local da impressora via MQTT;
- leitura de arquivos de impressão via FTPS;
- extração de metadados do `.3mf`;
- associação de carretéis físicos a slots do AMS;
- inventário de filamentos no Supabase;
- identificação de carretéis por NFC;
- interface web/PWA para operação e acompanhamento.

Princípio de produto já documentado no projeto:

> O utilizador administra a produção. O Filamap administra o filamento.

## Componentes existentes

### 1. `desktop-agent/`

Agente local Node.js + TypeScript que:

- autentica no Supabase com usuário do Agent;
- localiza ou recebe IP da impressora;
- conecta ao MQTT TLS local da Bambu Lab;
- acompanha estado, progresso, temperaturas, camada e slot;
- tenta baixar o `.3mf` via FTPS;
- procura `Metadata/slice_info.config`;
- mantém estado do job ativo em `agent-state.json`;
- calcula consumo ao finalizar/interromper um job;
- atualiza saldo do carretel e grava log no Supabase.

### 2. `web-app/`

Aplicação React 18 + TypeScript + Vite. Atualmente contém, em uma tela principal:

- login Supabase;
- monitor da impressora;
- visualização dos quatro slots do AMS Lite;
- estoque de carretéis;
- re-pesagem manual;
- edição/exclusão de carretéis;
- catálogo de peças;
- simulador de orçamento;
- criação/gravação de tags NFC.

### 3. `supabase/`

Contém migrations de schema inicial e endurecimento de RLS. O banco remoto ligado ao projeto tem referência local salva, porém **o histórico de migrations disponível não reproduz todo o schema que o código atual usa**. Ver `02_DATABASE.md`.

### 4. Arquivos de hardware/apoio

- `clipe_nfc_filamap.scad`
- `clipe_nfc_filamap.stl`
- `generate_clip.js`
- `filamentos_bambu.json`

Representam experimentos/artefatos ligados ao uso físico de NFC/filamentos e não são o núcleo do SaaS.

## Stack real encontrada

- Frontend: React 18, TypeScript, Vite.
- Backend/BaaS: Supabase Auth + PostgreSQL + REST/RLS.
- Agent: Node.js, TypeScript.
- MQTT: pacote `mqtt`, TLS na porta 8883.
- FTPS: `basic-ftp`, porta 990 no código atual.
- `.3mf`: `adm-zip`.
- XML: `fast-xml-parser`.
- NFC: Web NFC API (`NDEFReader`).
- Build de executável: `pkg` para Windows x64.

## Estado de maturidade

O repositório representa um **protótipo funcional em evolução**, não um SaaS comercial concluído. Existem integrações reais já codificadas, mas também premissas ainda não comprovadas em hardware, lacunas de migrations, ausência de testes automatizados e fluxos de onboarding ainda manuais.

## Documento de visão detalhada

`FILAMAP_ARQUITETURA_DA_JORANDA_DO_USUARIO.md` contém a visão extensa de jornada e arquitetura. Ele deve ser lido como **visão-alvo + histórico técnico**, não como prova de que todas as funções descritas já foram implementadas.
