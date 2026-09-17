# Filamap (Sistema de Controle de Filamentos 3D com NFC)

## 1. Visão Geral do Produto
Solução comercial composta por:
1. **Agente Desktop Local:** Aplicativo leve em background que descobre impressoras Bambu Lab na rede local, conecta via MQTT local e envia telemetria de consumo para o backend.
2. **Backend & Banco de Dados:** Gerencia autenticação, carretéis, impressoras, histórico de impressões e regras de desconto de saldo de filamento.
3. **App Web / Mobile (PWA):** Interface com leitura de tags NFC para associar carretéis aos slots do AMS e acompanhar saldos e métricas de custo.

---

## 2. Stack Técnica & Padrões
- **Agente Desktop:** Node.js / TypeScript (ou Tauri) rodando como worker/tray.
- **Protocolo de Rede Local:** SSDP para descoberta da Bambu Lab + MQTT TLS (porta 8883, user: `bblp`, pass: `access_code`).
- **Backend / Banco:** Supabase (PostgreSQL + Row Level Security + Auth).
- **Frontend / PWA:** React / Next.js ou Vite + Tailwind CSS com suporte à Web NFC API.
- **Versionamento & Deploy:** Git, Netlify / Vercel para frontend/API.

---

## 3. Regras de Negócio Inegociáveis
- **Tara Automática:** O saldo do filamento NUNCA considera a tara do carretel vazio. O peso do carretel vazio deve ser mantido em tabela e abatido automaticamente.
- **Desconto de Filamento:** O abatimento só é efetivado após status `FINISH` da impressora ou calculado proporcionalmente em caso de `FAILED` / `STOP`.
- **Zero Fricção no Onboarding:** O agente local precisa descobrir o IP da impressora automaticamente via SSDP; o usuário só insere o Access Code da máquina.
- **Estrutura Modular:** O agente local NÃO deve conter regras complexas de precificação — ele apenas coleta dados brutos da máquina e posta via webhook/API para o backend.

---

## 4. Estrutura do Repositório
```text
├── desktop-agent/        # Serviço local de captura MQTT Bambu Lab
├── web-app/              # Interface do usuário (PWA com NFC e dashboards)
├── supabase/             # Migrations, esquemas SQL e funções RPC
└── CLAUDE.md             # Este arquivo de contexto e regras

- NUNCA peça para o usuário criar pastas, criar arquivos manualmente ou abrir arquivos para colar trechos de código.
- SEMPRE entregue scripts em PowerShell (Windows) prontos para execução que criem diretórios, instalem dependências e usem `Set-Content` para preencher os arquivos com o código final completo.