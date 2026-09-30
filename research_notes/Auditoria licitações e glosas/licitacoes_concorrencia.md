# Mapa competitivo: ferramentas para fornecedores (ME/EPP) em licitações no Brasil (data de referência 2026-09-30)

Nota de método: o proxy de rede bloqueou WebFetch em todos os sites de fornecedores tentados (licitaia.app, conlicitacao.com.br, youlex.com.br, sigapregao.com.br). Quase tudo abaixo vem de **trechos de resultados de busca**, marcados como "(snippet)". O resumo gerado pelo buscador pode parafrasear ou juntar páginas diferentes. Preços e listas de funcionalidades precisam ser conferidos nos sites antes de qualquer decisão. Foram feitas cerca de 18 chamadas de ferramenta.

## 1. Ferramentas oficiais e gratuitas (PNCP, Compras.gov.br, SICAF, Painel/Pesquisa de Preços, Sebrae, TCE)

### Takeaway
O governo já oferece de graça quatro coisas: dados históricos de preços (Pesquisa de Preços Lite, com estatísticas, e API aberta do PNCP), verificação automática das certidões federais pelo SICAF, capacitação pelo Sebrae e IA voltada ao **lado comprador** (MentorIA, Alice da CGU). Não encontrei nenhum assistente de IA do governo para ajudar o **fornecedor** a montar a habilitação ou redigir impugnações.

### Cited Findings
- O MGI e o Serpro lançaram o **MentorIA**, assistente de IA integrado ao Compras.gov.br. Ele atende **servidores públicos** na fase de planejamento da contratação e se baseia em leis, decretos e manuais. (snippet) — [gov.br/compras](https://www.gov.br/compras/pt-br/acesso-a-informacao/noticias/mgi-lanca-mentoria-ferramenta-de-inteligencia-artificial-que-facilita-a-rotina-de-servidores-publicos); [Serpro 2026](https://www.serpro.gov.br/menu/noticias/noticias-2026/serpro-compras-ia); há um artigo de terceiro sobre o que o MentorIA muda para fornecedores (maio/2026) — [Sysevolution](https://sysevolution.com.br/2026/05/11/inteligencia-artificial-nas-compras-publicas-o-que-o-mentoria-muda-para-quem-vende-ao-governo/)
- Em dez/2025, o Compras.gov.br incorporou a ferramenta **Alice** (CGU). Ela analisa editais automaticamente e aponta prazos muito curtos, exigências que restringem a participação e preços acima do mercado. É uma ferramenta de integridade/controle, não do fornecedor. (snippet) — [MGI dez/2025](https://www.gov.br/gestao/pt-br/assuntos/noticias/2025/dezembro/governo-do-brasil-incorpora-ferramenta-de-analise-automatizada-ao-compras-gov-br-para-fortalecer-integridade-nas-contratacoes-publicas)
- A Seplag-CE lançou um assistente de IA para justificativas em contratações, também voltado ao comprador (set/2025). (snippet) — [Portal Compras CE](https://www.portalcompras.ce.gov.br/2025/09/01/assistenteia/)
- O **Painel de Preços** deixou de ser atualizado com dados posteriores a 04/07/2025, mas segue disponível para consulta. A ferramenta atual é a **Pesquisa de Preços Lite**: gratuita, sem login, com 12 meses de preços homologados no Compras.gov.br, média, mediana, desvio padrão, menor e maior preço e filtros por localização. (snippet) — [pesquisaprecos.compras.gov.br](https://pesquisaprecos.compras.gov.br/); [gov.br Pesquisa de Preços](https://www.gov.br/compras/pt-br/sistemas/conheca-o-compras/pesquisa-de-precos); [Painel de Preços](https://paineldeprecos.planejamento.gov.br/)
- A **API pública de consultas do PNCP** fica em `https://pncp.gov.br/api/consulta/v1`. Ela permite consultar contratações por data de publicação, contratações com propostas abertas, atas de registro de preço, contratos e itens do PCA. Os filtros incluem UF, município, CNPJ do órgão e modalidade. (snippet) — [Manual API Consultas PNCP](https://www.gov.br/pncp/pt-br/pncp/manuais/versoes-anteriores/ManualPNCPAPIConsultasVerso1.0.pdf/@@display-file/file); [gist](https://gist.github.com/Micael106/04a3e5515057ab11ea8797603682f0bd)
- Já existem vários scrapers do PNCP prontos na Apify: "Radar de Licitações PNCP — Editais e Vencedores", "PNCP Licitações, Pregões e Contratos" e "PNCP Scraper Brasil". — [Apify 1](https://apify.com/joaosbp/licitacoes-pncp-br/api); [Apify 2](https://apify.com/johnatan029/pncp-licitacoes-brasil/api); [Apify 3](https://apify.com/latinamericadata/pncp-brasil/api)
- Em 2025, o PNCP registrou mais de 1 milhão de compras públicas, cerca de 6 mil novos editais por dia. (snippet, cifra citada em matéria sobre a Settle) — [Bloomberg Línea](https://www.bloomberglinea.com.br/startups/settle-usa-agentes-de-ia-para-destravar-mercado-de-licitacoes-publicas-de-r-1-tri/)
- O **SICAF** integra automaticamente os dados da Receita Federal e as certidões da Receita/PGFN, FGTS, CNDT/TST e INSS. Em situação normal, o fornecedor não precisa anexar essas certidões manualmente. (snippet) — [FAQ SICAF 100% Digital](https://antigo.comprasgovernamentais.gov.br/index.php/sicaf-100digital-faq); [Manual SICAF](http://www.comprasnet.gov.br/publicacoes/manuais/manual_sicafweb_fornecedor.pdf)
- O dataset "Compras Públicas do Governo Federal" está disponível no dados.gov.br. — [dados.gov.br](https://dados.gov.br/dados/conjuntos-dados/compras-publicas-do-governo-federal)
- O Sebrae oferece o curso gratuito "3 passos para o sucesso em compras governamentais" (3h), apoio pelo programa Cidade Empreendedora e apoio ao cadastro na BEC-SP. Algumas unidades estaduais mantêm listas de oportunidades, como o Sebrae-ES. (snippet) — [Loja Sebrae](https://loja.sebrae.com.br/3-passos-para-o-sucesso-em-compras-governamentais-1-372000122849); [Sebrae-SP BEC](https://sebrae.com.br/sites/PortalSebrae/ufs/sp/programas/bolsa-eletronica-de-compras-bec-sp,6f98d5c6409b1610VgnVCM1000004c00210aRCRD); [Sebrae-ES](https://cliente.sebraees.com.br/licitacoes)

### Inferences
- **Análise de preços históricos já é commodity.** Os dados são gratuitos e já vêm com estatísticas (Pesquisa de Preços Lite), a API é aberta e há scrapers de prateleira. Um diferencial só pode vir da interpretação, por exemplo casar o item do edital com itens comparáveis e calcular a margem da empresa, e não do acesso ao dado.
- **Regularidade fiscal federal é parcialmente commodity** pelo SICAF. Continuam manuais as certidões estaduais e municipais, os atestados de capacidade técnica, o balanço e índices e as declarações.
- A IA oficial (MentorIA, Alice) fortalece o **comprador**. A Alice sinaliza cláusulas restritivas, o mesmo insumo de uma impugnação. Isso pode reduzir a quantidade de editais impugnáveis no nível federal, mas também valida o conceito.

### Gaps
- Não encontrei nenhum assistente de IA do governo para fornecedores. É plausível que não exista, mas não consegui confirmar isso de forma conclusiva.
- Não investiguei ferramentas de TCEs para fornecedores; nenhum resultado apareceu. Também não confirmei se a Alice publica os achados para o público/fornecedores.
- Os detalhes do Portal de Compras Públicas, BLL, Licitações-e/BB e Licitanet como plataformas de disputa (taxas ao fornecedor) não foram pesquisados. Pelo que sei de antemão, eles cobram mensalidade/taxa do fornecedor para participar, e não oferecem IA de análise. Isso não foi verificado.

## 2. Ferramentas pagas: funcionalidades, preços, IA e captação

### Takeaway
As empresas grandes já vêm com IA de edital (resumo e "pergunte ao edital") e o **ConLicitação já vende geração de impugnação/recurso com teses** (Dr. Licita). Depois de 2024 surgiram várias startups "AI-first" baratas, de R$ 39,90 a R$ 149 por mês, que já anunciam checklist de habilitação, impugnação e preços do PNCP. O pacote descrito no brief **não é inédito**.

### Cited Findings (por empresa; todos snippets)
- **Effecti (Minha Effecti + Aimê)**: a Aimê lê o edital, responde perguntas citando a cláusula de origem, destaca prazos, obrigações e requisitos, e promete reduzir em até 80% o tempo de análise. — [Effecti IA](https://effecti.com.br/ia-para-licitacoes-nas-compras-publicas/); [plataforma](https://effecti.com.br/plataforma/). A empresa foi comprada pela **Nuvini** (holding listada na Nasdaq) em 2021. Tem mais de 3.000 clientes ativos, cerca de 25% enterprise (J&J, Boston Scientific, Cremer), cresceu 30% em 2024 e 20% em 2025 acumulado, e seus clientes monitoraram R$ 112,3 bi em licitações em 2025. — [ACATE](https://www.acate.com.br/noticias/effecti-aposta-em-automacao-para-acompanhar-avanco-regulatorio/); [Exame](https://exame.com/pme/nuvini-compra-startup-effecti-e-avanca-no-plano-de-criar-uma-holding-de-tecnologia/); [Startupi](https://startupi.com.br/startup-especializada-em-software-para-licitacoes-on-line-e-adquirida-por-nuvini/). Tem produto específico para consultores. — [Effecti consultores](https://effecti.com.br/consultores/). Preço não encontrado; há teste grátis. — [teste grátis](https://effecti.com.br/teste-gratis/)
- **Grupo ConLicitação**: grupo "desde 1999". Lançou um "ecossistema de IA" com **Resumo do Edital, Pergunte ao Edital, Dr. Licita (IA jurídica) e Consultor Jurídico** e se diz "a maior plataforma de IA para licitações". Anunciou um "investimento milionário", valor não divulgado no trecho. — [ConLicitação](https://conlicitacao.com.br/grupo-conlicitacao-faz-investimento-milionario-e-lanca-no-mercado-a-maior-plataforma-de-ia-para-licitacoes-publicas/); [ConLicitação IA](https://conlicitacao.com.br/ia/). Os planos são semestrais, anuais ou bienais. — [B2B Stack](https://www.b2bstack.com.br/product/conlicitacao); [Planos](https://conlicitacao.com.br/planos/)
- **Dr. Licita** (investimento estratégico do ConLicitação em janeiro, ano não confirmado no trecho, provavelmente 2025): redige **impugnações, recursos e petições** "em menos de 1 minuto", com teses reais de uma base validada pelo jurídico do ConLicitação. Preços: a partir de R$ 1.586 (semestral), R$ 2.490 (anual) e R$ 4.053 (bienal). — [ConLicitação/Dr. Licita](https://conlicitacao.com.br/grupo-conlicitacao-realiza-investimento-estrategico-na-dr-licita-para-impulsionar-ia-no-setor-publico/); [drlicita.com](https://drlicita.com/); [conlicitacao.com.br/dr-licita](https://conlicitacao.com.br/dr-licita/)
- **SIGA Pregão**: vende "Software para Licitações com IA e Robô de Lances". Preços: Basic R$ 397/mês, Ultimate R$ 497/mês, Infinity R$ 3.600/ano (12x R$ 253,31), Multiempresas R$ 797/mês (2 empresas) e R$ 1.397/mês (5 empresas). — [SIGA preços](https://www.sigapregao.com.br/p/precos/); [B2B Stack](https://www.b2bstack.com.br/product/siga-pregao/planos-e-precos); [Multiempresas](https://www.sigapregao.com.br/multiempresas/)
- **Licitei** (startup incubada na UFJF, lançada em 2024 como "sistema gratuito com IA"): busca no PNCP, "Pergunte ao Edital", gestão de documentos, alertas, geração automática de declarações e propostas. O plano Premium inclui cadastro automático de proposta, disputa automática (**robô de lances** no ComprasNet, Portal de Compras Públicas, BLL, BNC e Licitanet) e análise de concorrentes. Teste de 7 dias; o site diz "IA analisa editais em 30s" e "checa documentos de habilitação e identifica riscos". Preço exato não capturado. — [Licitei](https://www.licitei.com.br/); [Licitei IA](https://www.licitei.com.br/ia); [robô novos portais](https://www.licitei.com.br/blog/robo-de-lances-novos-portais); [UFJF 2024](https://www2.ufjf.br/noticias/2024/02/19/startup-lanca-sistema-gratuito-com-ia-para-agilizar-licitacoes-publicas/)
- **LicitaIA (licitaia.app)**: faz leitura do edital, viabilidade de preço, **pedidos de impugnação, esclarecimento, recursos e contrarrazões**, montagem de propostas e "marcas e preços com base em dados reais". Afirma que uma impugnação de "6 a 13 horas" fica pronta em minutos. **Esse produto se sobrepõe quase inteiramente à ideia proposta.** Preço não capturado. — [licitaia.app](https://www.licitaia.app/)
- **Licita.ia (portallicitaia.com.br)**: lê o PDF inteiro, extrai itens, prazos e requisitos, **cruza preços com o PNCP**, verifica **sanções de concorrentes** e oferece chat com o edital. Preços: grátis (2 análises), Elite R$ 149/mês ilimitado, R$ 990/ano. — [portallicitaia.com.br](https://portallicitaia.com.br/)
- **LicitaGov (licitagov.org)**: monitoramento em tempo real, match por CNPJ e uma IA que entrega **resumo, checklist de habilitação, riscos e "dossiê de impugnação" com links e páginas do PDF**. Teste de 7 dias. — [licitagov.org](https://licitagov.org/); [resumo de edital](https://licitagov.org/resume-edital-ia/)
- **LicitaCerto IA**: funciona por créditos que não expiram, com análise de edital a partir de R$ 49,90 a R$ 79,90. Cobre análise, habilitação, proposta e recursos. — [licitacertoia.com.br](https://licitacertoia.com.br/)
- **LicitAI (licitaieditais.com.br)**: busca com IA e análise em 30s, a partir de R$ 39,90/mês. — [LicitAI](https://www.licitaieditais.com.br/)
- **Facilita Licitações**: "IA que analisa editais, gera documentos e organiza seus prazos". — [facilitaweb](https://facilitaweb.app.br/site)
- **Guia da Licitação** ("Deixe essa IA ler o seu Edital"), **Licita IA (licitaia.com.br)**, **Visão Licita**, **Liciton** e **LicitaSmart** também apareceram nos resultados. Não verifiquei as funcionalidades deles. — [guiadalicitacao](https://guiadalicitacao.com.br/); [licitaia.com.br](https://licitaia.com.br/); [visaolicita](https://www.visaolicita.com.br/); [liciton](https://www.liciton.com.br/blog/preco-mercado-licitacoes-como-pesquisar); [licitasmart](https://licitasmart.com.br/blog/certidoes-negativas-licitacao/)
- **Licita Já**: busca ampliada por IA, alertas e editais. — [licitaja.com.br](https://www.licitaja.com.br/)
- **Alerta Licitação**: alertas e gestão de certidões negativas com e-mails automáticos. — [alertalicitacao.com.br](https://alertalicitacao.com.br/)
- **Settle** (fundada no fim de 2024): pré-seed de **US$ 3,08 mi** liderada por Canary e Row Capital. Roda mais de 100 agentes de IA que leem, filtram e pontuam editais, integrando PNCP, portais de disputa, diários oficiais, atas, contratos, PCA e dados internos do cliente. Diz que dobra a participação dos clientes em licitações. Parece mirar empresas médias e grandes (fala em CAC e vendas B2G). Recebeu cobertura na imprensa em set/2026. — [Bloomberg Línea](https://www.bloomberglinea.com.br/startups/settle-usa-agentes-de-ia-para-destravar-mercado-de-licitacoes-publicas-de-r-1-tri/); [Inforchannel set/2026](https://inforchannel.com.br/2026/09/10/startup-brasileira-settle-cria-plataforma-de-ia-para-transformar-vendas-ao-governo/); [Business Moment](https://businessmoment.com.br/settle-agentes-ia-licitacoes-publicas/)
- **StartGi**: licitações e CRM para vendas públicas, investida do Fundo GovTech (KPTL + Cedro). O fundo passou de R$ 49 mi para R$ 105,7 mi e planeja R$ 150 mi em 2026. — [Startups.com.br](https://startups.com.br/negocios/investimentos-em-govtechs-crescem-mas-setor-ainda-enfrenta-desafios-para-se-consolidar/); [Exame StartGi](https://exame.com/negocios/ele-usa-ia-para-melhorar-uma-burocracia-que-movimenta-12-do-pib-e-impacta-a-vida-de-todos/)
- Há um comparativo "Melhor IA para Licitações 2026" publicado pela Youlex, o que sugere que existe mais um concorrente jurídico/IA. O conteúdo não pôde ser lido (bloqueado). — [youlex](https://youlex.com.br/comparacao/ia-para-licitacoes)
- Validação documental com IA para habilitação é oferecida por players horizontais como a Dynadok, voltada sobretudo a órgãos compradores. Ela cruza CNPJ com certidões, razão social com declarações e responsável técnico com atestado, e verifica vigência nas bases da Receita, Caixa, TST e Transparência. — [Dynadok](https://blog.dynadok.com/administracao/habilitacao-empresas-licitacao-contratos-ia/); [Dynadok 14.133](https://blog.dynadok.com/governo/como-automatizar-a-habilitacao-de-fornecedores-na-lei-no-14-133-2021/)

### Inferences
- **Mais de 10 produtos** já anunciam em 2026 "IA que lê edital + checklist de habilitação". Pelo menos 4 anunciam geração de impugnação/esclarecimento/recurso (Dr. Licita, LicitaIA.app, LicitaGov com "dossiê", LicitaCerto com "recursos") e pelo menos 2 anunciam cruzamento de preços com o PNCP (Licita.ia, LicitaIA.app).
- O piso de preço das startups (R$ 39,90 a R$ 149/mês, ou por crédito) torna difícil competir por preço sendo desenvolvedor solo.

### Gaps
- Não obtive dados sobre Acumi, Radar Oficial, Licitar Digital, Zello, LicitaNet, BLL, Portal de Compras Públicas (lado fornecedor) e Licitações-e: não fiz buscas específicas por eles por limite de orçamento de chamadas.
- Os preços de Effecti, ConLicitação, Licitei, LicitaIA.app e LicitaGov não foram capturados.
- Não verifiquei a qualidade real de impugnação/checklist dos concorrentes: são alegações de marketing.
- O valor do "investimento milionário" do ConLicitação e o ano exato do aporte no Dr. Licita não foram confirmados.

## 3. Funcionalidades commoditizadas vs. raras

### Takeaway
São commodity: busca/alerta, resumo de edital e chat com edital, gestão de certidões com alerta de vencimento, preços históricos (dado gratuito) e robô de lances. Continuam **raros ou pouco comprovados**: (a) cruzar os documentos reais da empresa com cada exigência do edital, com veredito de "apto/inapto" item a item; (b) impugnação com jurisprudência **verificável** (acórdãos do TCU com número e trecho); (c) viabilidade que combine preço histórico com o custo da própria empresa.

### Cited Findings
- Resumo e "pergunte ao edital" aparecem em Effecti/Aimê, ConLicitação, Licitei, Licita.ia, LicitaGov, LicitAI e Guia da Licitação — ver fontes na seção 2.
- Alerta de vencimento de certidões: Alerta Licitação, módulos de "gerenciamento de arquivos" e SICAF com certidões federais automáticas; também há ferramentas contábeis de CND automática (Jettax, Comtax). — [Alerta Licitação](https://alertalicitacao.com.br/); [Jettax](https://www.jettax.com.br/blog/cnd-automatica-como-escritorios-estao-eliminando-o-trabalho-manual/); [Comtax](https://comtax.com.br/controle-certidoes-negativas-rotina-fiscal/); [LicitaGov automação](https://licitagov.org/artigos/automacao-processos-licitatorios/)
- Robô de lances: SIGA Pregão e Licitei, entre outros. — [SIGA](https://www.sigapregao.com.br/p/precos/); [Licitei robô](https://www.licitei.com.br/robo-de-lances)
- Petição com "teses reais" (Dr. Licita) e "dossiê de impugnação com links e páginas do PDF" (LicitaGov) mostram que a impugnação fundamentada já está sendo atacada, mas as citações apontam para teses ou páginas do edital, e não há evidência pública de citação verificável de acórdãos do TCU. — [Dr. Licita](https://drlicita.com/); [LicitaGov](https://licitagov.org/)
- Um artigo da Conjur (nov/2024) discute critérios de escolha de ferramentas de IA para licitações. — [Conjur](https://conjur.com.br/2024-nov-01/licitacoes-com-inteligencia-artificial-a-escolha-das-ferramentas/)

### Inferences
- A lacuna defensável mais plausível para um desenvolvedor solo é estreita. Seria um "**dossiê de habilitação verificado**": carregar o acervo da empresa (contrato social, balanço, atestados, CATs, certidões estaduais e municipais), casar cada exigência do edital com uma evidência, calcular índices de liquidez e apontar lacunas, por exemplo atestado com quantitativo inferior ao exigido. Somado a isso, impugnação com citação de jurisprudência TCU checável. Licitei e LicitaGov já **anunciam** partes disso, então a diferença teria de ser de profundidade e precisão, não de categoria.
- Canal alternativo: vender para **consultorias** como ferramenta de produtividade (white-label, multi-CNPJ), em vez de vender direto para ME/EPP.

### Gaps
- Sem testes práticos, não é possível afirmar quão bem os concorrentes fazem o cruzamento de documentos da empresa.

## 4. Reclamações e lacunas relatadas por usuários

### Takeaway
As reclamações públicas encontradas são sobre **contrato e cobrança** (fidelidade, renovação automática, cancelamento), não sobre funcionalidades. Não encontrei depoimentos sobre falhas de IA.

### Cited Findings
- SIGA Pregão: 26 reclamações, 100% respondidas. Os temas são fidelidade pouco clara (cancelamento só nos primeiros 7 dias), renovação automática não autorizada (cobranças de R$ 350/mês), "pagando sem usar" e "siga pregão é uma furada". (snippet) — [Lista RA](https://www.reclameaqui.com.br/empresa/siga-pregao/lista-reclamacoes/); [renovação](https://www.reclameaqui.com.br/siga-pregao/cobranca-indevida-e-renovacao-automatica-nao-autorizada-da-licenca-da-plataforma-siga-pregao_trQ30iPXUzgO5NAB/); [furada](https://www.reclameaqui.com.br/siga-pregao/siga-pregao-e-uma-furada_e381s4rjNdPdpOqL/); [pagando sem usar](https://www.reclameaqui.com.br/siga-pregao/pagando-sem-usar_dyO6jPqEoo8GdJJt/)
- ConLicitação: "cancelamento de conta" responde por 33,33% dos problemas. (snippet) — [RA ConLicitação](https://www.reclameaqui.com.br/empresa/conlicitacao/)
- Effecti: 4 reclamações, sem nota; há pedido de cancelamento por "não execução dos serviços contratados". (snippet) — [RA Effecti](https://www.reclameaqui.com.br/empresa/effecti/)

### Inferences
- Planos mensais sem fidelidade e com cobrança por uso (modelo da LicitaCerto) são um ponto de diferenciação comercial, mas fácil de copiar.

### Gaps
- Não coletei avaliações do B2B Stack/Capterra nem posts do LinkedIn ou de fóruns (GestGov, grupos de licitantes). Não há evidência sobre precisão das IAs, alucinação ou inabilitações causadas por erro de ferramenta.

## 5. Consultorias de licitação: modelo de preço e se são clientes ou concorrentes

### Takeaway
As consultorias costumam cobrar mensalidade de cerca de 1 salário mínimo até R$ 2,5–3 mil, mais comissão de cerca de 3–4% sobre contratos ganhos. Elas são **clientes** explícitos dos grandes softwares (Effecti tem produto para consultores; SIGA vende plano multiempresas), e ao mesmo tempo são concorrentes substitutos para ME/EPP que preferem terceirizar.

### Cited Findings
- Os modelos de cobrança são: fixo, mensal, por processo ou mensalidade mais êxito. A média citada é mensal de R$ 2.500–3.000 mais cerca de 3% por contrato; outro exemplo é 4% do valor global; a mensalidade costuma ter como base o salário mínimo. (snippet; as fontes são blogs de fornecedores de software, não pesquisa independente) — [Effecti comissão](https://effecti.com.br/comissao-consultoria-licitacoes/); [Effecti comissionamento](https://effecti.com.br/como-cobrar-comissionamento-na-consultoria-de-licitacoes/); [SIGA cobrança](https://www.sigapregao.com.br/como-o-assessor-de-licitacoes-pode-cobrar-pelo-servico/); [SIGA quanto ganha](https://www.sigapregao.com.br/consultor-de-licitacoes-saiba-quanto-ganha/)
- A Effecti tem página "Software para Consultores de Licitações" e o SIGA Pregão tem planos Multiempresas (2 a 5 empresas). — [Effecti consultores](https://effecti.com.br/consultores/); [SIGA multiempresas](https://www.sigapregao.com.br/multiempresas/)

### Inferences
- Um agente que reduza o trabalho de horas por edital (habilitação e impugnação) tem valor mensurável para uma consultoria com vários CNPJs, o que torna esse segmento o provável comprador B2B2SMB.

### Gaps
- Não encontrei o número de consultorias de licitação no Brasil (nenhuma fonte, nem CNAE específico).

## 6. Sinais de consolidação e captação 2024–2026

### Takeaway
O mercado se consolida em torno de incumbentes (Nuvini/Effecti; ConLicitação comprando capacidade de IA com o Dr. Licita) e atrai capital de risco para agentes de IA (Settle, US$ 3,08 mi pré-seed; Fundo GovTech crescendo). A janela para "primeiro com IA" já passou.

### Cited Findings
- A Nuvini comprou a Effecti (2021) como parte de uma holding de SaaS listada na Nasdaq. — [Exame](https://exame.com/pme/nuvini-compra-startup-effecti-e-avanca-no-plano-de-criar-uma-holding-de-tecnologia/); [Effecti Nasdaq](https://effecti.com.br/effecti-mercado-acoes-nasdaq/)
- O ConLicitação fez investimento estratégico no Dr. Licita e anunciou "investimento milionário" em plataforma de IA. — [ConLicitação](https://conlicitacao.com.br/grupo-conlicitacao-realiza-investimento-estrategico-na-dr-licita-para-impulsionar-ia-no-setor-publico/)
- A Settle fez pré-seed de US$ 3,08 mi (Canary, Row Capital), com cobertura na imprensa em set/2026. — [Bloomberg Línea](https://www.bloomberglinea.com.br/startups/settle-usa-agentes-de-ia-para-destravar-mercado-de-licitacoes-publicas-de-r-1-tri/); [ABES](https://abes.org.br/en/startup-brasileira-settle-cria-plataforma-de-ia-para-transformar-vendas-ao-governo/)
- O Fundo GovTech (KPTL/Cedro) passou de R$ 49 mi para R$ 105,7 mi, com meta de R$ 150 mi em 2026; a StartGi, de licitações/CRM, é investida do fundo. — [Startups.com.br](https://startups.com.br/negocios/investimentos-em-govtechs-crescem-mas-setor-ainda-enfrenta-desafios-para-se-consolidar/)

### Inferences
- Com incumbentes que têm mais de 3.000 clientes e distribuição própria, mais uma startup com VC e mais de 10 microSaaS de IA, o espaço de um desenvolvedor solo está num nicho vertical: um segmento de objeto (por exemplo, obras e engenharia, onde atestados e CATs são complexos, ou saúde) ou o canal de consultorias. Uma ferramenta horizontal de "habilitação + impugnação + preços" não parece ter espaço.

### Gaps
- Não verifiquei captações de Licitei, LicitaIA.app, LicitaGov ou Licita.ia, nem o faturamento do ConLicitação e do SIGA Pregão.
