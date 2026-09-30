# Agente de IA para ME/EPP em licitações: demanda, risco jurídico, viabilidade técnica e timing (status 2026-09-30)

Método: o proxy de rede bloqueou gov.br, pncp.gov.br (incluindo a API, testada via curl: CONNECT 403), dadosabertos.compras.gov.br, transparencia.org.br, migalhas, effecti e outros. Quase todos os achados vêm de snippets de busca e estão marcados "(snippet)". Nenhum PDF primário foi lido na íntegra. Trate os números como indicativos e confira na fonte antes de publicar.

## 1. Demanda: quantas empresas licitam de fato, participação de ME/EPP, taxas e causas de inabilitação

### Takeaway
O mercado é grande e dominado por ME/EPP em número de fornecedores e de compras: cerca de 68% dos fornecedores do Compras.gov.br e R$ 272,6 bi homologados com ME/EPP em 2025. A dor documental é consistentemente citada (certidão vencida, atestado, índices de balanço), mas não encontrei nenhuma estatística oficial e confiável de "% de inabilitação por falha documental". Esse é o maior buraco de evidência da tese.

### Cited Findings
- 2025, Compras.gov.br (só o sistema federal, embora usado também por outros entes): mais de R$ 465 bi movimentados, cerca de 282 mil processos, 3.346 órgãos. Foram 481,7 mil compras com ME/EPP, somando R$ 272,6 bi, e 62,22 mil compras com MEI (R$ 12,08 bi). Dos 452,5 mil fornecedores cadastrados, 67,7% (297,2 mil) são ME/EPP (snippet) — [MGI, jan/2026](https://www.gov.br/gestao/pt-br/assuntos/noticias/2026/janeiro/ano-de-2025-e-marcado-pela-inovacao-no-mercado-de-compras-publicas-brasileiro). Observação: "compras" com ME/EPP (481,7 mil) supera o total de "processos" (282 mil). Provavelmente a unidade é item ou resultado, não processo, e isso não está claro.
- Em jul/2024 o MGI informou mais de 700 mil fornecedores e 4 mil municípios credenciados no Compras.gov.br (snippet) — [MGI, jul/2024](https://www.gov.br/gestao/pt-br/assuntos/noticias/2024/julho/compras-gov-br-ja-tem-mais-de-700-mil-fornecedores-e-4-mil-municipios-credenciados). Isso **conflita** com os 452,5 mil de 2025. As bases diferem (SICAF total vs. cadastro ativo?), então não dá para tratar nenhum dos dois como "empresas que efetivamente licitam".
- Até out/2024 o Compras.gov.br movimentou R$ 153,1 bi, alta de 42% sobre 2023, e ME/EPP cresceram 53%. Segundo a mesma fonte, "82% dos fornecedores do governo são MPE" (snippet) — [MGI, jan/2025](https://www.gov.br/gestao/pt-br/assuntos/noticias/2025/janeiro/contratacoes-publicas-impulsionam-participacao-de-micro-e-pequenas-empresas); reproduzido em [Fenacon](https://fenacon.org.br/noticias/contratacoes-publicas-impulsionam-participacao-de-micro-e-pequenas-empresas/).
- Sebrae: a participação de MPE nas compras públicas cresceu 93% em três anos (título/snippet) — [Agência Sebrae](https://agenciasebrae.com.br/economia-e-politica/participacao-das-mpe-nas-compras-publicas-cresceu-93-nos-ultimos-tres-anos/). Outro veículo diz que pequenos negócios representam 25% das compras públicas (título) — [Diário do Comércio](https://diariodocomercio.com.br/negocios/pequenos-negocios-compras-publicas-governo/).
- PNCP (todos os entes): cerca de R$ 1 trilhão homologado e mais de 1 milhão de compras em 2025, média acima de 83 mil registros/mês. Os sistemas integrados passaram de 105 (2023) para 199 (2024) e 205 (2025) (snippet) — [Convergência Digital](https://convergenciadigital.com.br/governo/compras-governamentais-ultrapassam-r-1-trilhao-em-2025/); [Effecti](https://effecti.com.br/tamanho-mercado-licitacoes-brasil/).
- Causas de inabilitação citadas por consultorias e escritórios: certidão vencida (uma só basta para inabilitar), atestado de capacidade técnica incompatível com o objeto, índices de liquidez/solvência do balanço abaixo do edital e contrato social desatualizado (snippets, fontes comerciais e não estatísticas) — [Wavecode](https://www.wavecode.com.br/licitante-inabilitado-principais-erros-que-causam-desclassificacao-nas-licitacoes/); [Schiefler Advocacia](https://schiefler.adv.br/problemas-mais-comuns-que-levam-a-inabilitacao-de-licitantes/); [Contabilidade Economy](https://www.contabilidadeeconomy.com.br/post/por-que-empresas-perdem-licita%C3%A7%C3%B5es-por-erros-simples-de-documenta%C3%A7%C3%A3o).
- Uma causa recorrente específica de ME/EPP é achar que estão dispensadas de apresentar balanço patrimonial (snippet) — [Jusbrasil, artigo](https://www.jusbrasil.com.br/artigos/obrigatoriedade-de-apresentacao-do-balanco-patrimonial-em-licitacoes-por-me-epp-e-mei-inclusive-nas-contratacoes-pelo-sistema-de-registro-de-precos/267666589).
- Na literatura acadêmica, os fatores limitantes para MPE incluem documentação excessiva, burocracia, capital de giro, acesso a informação e falta de conhecimento técnico (snippet) — [Revista Foco, "Principais dificuldades... MPE no acesso ao mercado de compras públicas"](https://ojs.focopublicacoes.com.br/foco/article/view/1266).
- O único dado quantitativo de "fracasso" encontrado é de nicho. Em 2012, num hospital universitário de SP, 49,59% dos itens de medicamentos fracassaram, principalmente por preço inaceitável (62,10%) e ausência de propostas (16,40%). Inabilitação documental não é a causa dominante nesse recorte (snippet) — [Rev. Adm. em Saúde/CQH](https://cqh.org.br/ojs-2.4.8/index.php/ras/article/view/174/281). Há também um estudo sobre índices de fracasso e deserto em pregões de objetos complexos — [Revista Geo](https://revistageo.com.br/revgeo/article/view/3476) (não lido).
- Lei 14.133, art. 64, e TCU: o Acórdão 1211/2021-Plenário (Rel. Walton Alencar) admite juntar "documento novo" em diligência para comprovar condição que já existia na abertura da sessão, vedando o formalismo exacerbado (snippets) — [Zênite](https://zenite.blog.br/tcu-nao-cabe-interpretacao-literal-para-a-vedacao-a-inclusao-de-documento-novo/); [ConLicitação](https://conlicitacao.com.br/o-que-o-tcu-tem-decidido-sobre-o-dever-de-diligencia-do-pregoeiro/); [NELCA](https://gestgov.discourse.group/t/tcu-sanear-documento-em-licitacao-a-prevalencia-do-fim-sobre-os-meios/13604).

### Inferences
- A base endereçável é de centenas de milhares de CNPJs cadastrados. O número de licitantes ativos por ano (que deram ao menos um lance) é desconhecido e provavelmente bem menor. Uma estimativa grosseira de "dezenas de milhares a ~150 mil ativos" é apenas hipótese.
- O saneamento pelo art. 64 e pelo Ac. 1211/2021 **reduz, mas não elimina** a dor. Só é saneável o que prova condição preexistente: uma certidão emitida depois da sessão pode ser aceita se a regularidade já existia, mas índices de balanço insuficientes ou falta de atestado não se corrigem. Além disso, a diligência é discricionária e varia muito entre pregoeiros, sobretudo nos municípios. O valor do produto se desloca de "evitar erro formal" para "detectar incompatibilidade substantiva cedo" (atestado, índices, parcela de maior relevância) e para decidir se vale participar.
- O alerta de certidões vencendo tem valor baixo e é fácil de copiar, já que o SICAF e vários ERPs fazem algo parecido. Sozinho, dificilmente sustenta cobrança.

### Gaps
- Não achei relatório do TCU/CGU/MGI com a taxa de inabilitação por motivo. Os dados poderiam ser obtidos via API do Compras.gov.br (resultados de itens/situação do fornecedor), que estava bloqueada neste ambiente. Recomendo extrair diretamente.
- Número de CNPJs distintos que ofertaram lance por ano: não encontrado.
- Sebrae: não achei pesquisa recente com percentual de MPE que já foram inabilitadas.

## 2. Quem paga hoje e quanto

### Takeaway
Existe um mercado de assessores e consultorias de licitação que combina mensalidade (~R$ 2,5–3 mil) com êxito (0,5%–4% do contrato). Há também softwares de radar/lances e staff interno. Isso mostra disposição a pagar, com teto provavelmente em centenas de reais/mês para software de ME.

### Cited Findings
- Modelos: fixo mensal (frequentemente atrelado ao salário mínimo), por processo, ou mensal mais comissão de êxito. Exemplos: mensalidade média de R$ 2.500–3.000 mais cerca de 3% por contrato fechado. Há comissões de 0,50% sobre o valor da proposta vencedora e de 4% sobre o valor global recebido. Uma consulta avulsa sai por cerca de R$ 4.000 (snippets, fontes de fornecedores de software) — [Effecti](https://effecti.com.br/comissao-consultoria-licitacoes/); [SigaPregão](https://www.sigapregao.com.br/como-o-assessor-de-licitacoes-pode-cobrar-pelo-servico/); [Scribd, modelo de contrato por êxito](https://www.scribd.com/document/569771655/CONTRATO-DE-PRESTACAO-DE-SERVICOS-DE-ASSESSORIA-EM-LICITACOES-EXITO).
- Não há percentual oficial de comissão. O contrato define a base (homologação, assinatura, faturamento ou recebimento) (snippet) — [Effecti](https://effecti.com.br/como-cobrar-comissionamento-na-consultoria-de-licitacoes/).
- Tabela pública de preços de assessoria (não lida): [AM Consulte](https://amconsulte.com.br/index.php/precos/). Referência salarial de "consultor de licitações": [SigaPregão](https://www.sigapregao.com.br/consultor-de-licitacoes-saiba-quanto-ganha/).
- Sebrae oferece capacitação e consultoria subsidiada em compras públicas, o que faz dele um potencial canal e também um concorrente gratuito (snippet) — [Sebrae RS](https://expansao.co/sebrae-rs-amplia-programa-para-aproximar-pequenos-negocios-das-compras-publicas/); [Sebrae AP](https://sebrae.com.br/sites/PortalSebrae/ufs/ap/artigos/passo-a-passo-para-a-microempresa-participar-de-licitacoes-no-sebrae,768fce14b63f5610VgnVCM1000004c00210aRCRD).

### Inferences
- Há dois pagadores prováveis: (a) a ME/EPP que licita com frequência, substituindo parte do assessor humano; (b) os próprios assessores e consultorias, que atendem dezenas de clientes e ganham com escala (checagem de habilitação multi-CNPJ). O canal (b) também reduz o risco OAB, porque o humano assina (ver seção 3).
- O preço de referência do assessor humano (~R$ 30 mil/ano mais êxito) comporta um SaaS de R$ 200–1.000/mês. Não validei isso com dados de pricing de concorrentes, que é tema de outra pesquisa.

### Gaps
- Não encontrei pesquisa sobre quantas ME/EPP usam assessoria externa ou qual a fatia de mercado dos assessores.

## 3. Risco jurídico: redigir impugnações e recursos é ato privativo de advogado?

### Takeaway
Pedidos de esclarecimento, impugnações e recursos administrativos em licitação **não exigem advogado**: qualquer pessoa pode impugnar (art. 164) e o licitante pode recorrer em nome próprio. O risco está em **vender** "consultoria/assessoria jurídica" (Lei 8.906/94, art. 1º, II) por empresa não inscrita na OAB. A OAB está ativamente litigando contra empresas de IA que "praticam atos privativos", mas o STJ manteve no ar uma plataforma de petições por IA em 2025. O risco é real, mas gerenciável com posicionamento e modelo de negócio adequados.

### Cited Findings
- Lei 14.133, art. 164: "qualquer pessoa é parte legítima para impugnar edital... ou para solicitar esclarecimento", até 3 dias úteis antes da abertura. A regra supera a dicotomia cidadão x licitante da Lei 8.666 (snippet) — [Conjur, João Transmontano](https://www.conjur.com.br/2022-dez-04/joao-transmontano-impugnacao-edital-lei-licitacoes/); [texto comentado](https://modeloinicial.com.br/lei/L-14133-2021/lei-licitacoes-contratos-administrativos/art-164). Texto oficial: [Planalto, Lei 14.133](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm).
- Recurso administrativo em licitação não tem forma prescrita e não precisa ser elaborado nem assinado por advogado (snippet, artigo em Jusbrasil) — [Jusbrasil](https://www.jusbrasil.com.br/artigos/recursos-administrativos-nas-licitacoes-publicas/1123984296).
- Justiça Federal reconheceu exercício ilegal da advocacia, multou uma empresa sem registro na OAB e a proibiu de ofertar consultoria jurídica. A distinção feita: atividades instrumentais ou automatizadas sem interpretação jurídica individualizada diferem de consultoria jurídica aplicada a caso concreto (snippet, nomes das partes não visíveis) — [Migalhas 450737](https://www.migalhas.com.br/quentes/450737/justica-multa-empresa-sem-registro-na-oab-e-proibe-venda-de-consultoria-juridica).
- Caso "Resolve Juizado" (2025): a OAB-RJ pediu ao STJ a suspensão de um site que vende petições iniciais feitas por IA, alegando exercício ilegal. O presidente do STJ, Min. Herman Benjamin, negou o pedido e a plataforma seguiu no ar (snippets) — [Conjur, 24/05/2025](https://conjur.com.br/2025-mai-24/oab-rj-pede-que-stj-suspenda-site-que-vende-peticoes-feitas-por-inteligencia-artificial/); [Conjur, 02/06/2025](https://conjur.com.br/2025-jun-02/stj-nega-pedido-da-oab-rj-e-mantem-no-ar-site-que-que-vende-peticoes-feitas-por-ia/).
- O Conselho Federal da OAB aprovou por unanimidade medidas judiciais contra empresas de IA que pratiquem atos privativos ou atuem como intermediárias entre clientes e advogados. Prepara ainda um provimento sobre IA na advocacia (snippet) — [OAB notícia 64465](https://www.oab.org.br/noticia/64465/oab-defende-advocacia-contra-empresas-de-ia-que-praticarem-atos-exclusivos-da-classe); [OAB notícia 64268](https://www.oab.org.br/noticia/64268/conselho-federal-da-oab-anuncia-plano-nacional-para-integrar-inteligencia-artificial-a-advocacia).

### Inferences
- A mitigação provável é posicionar o produto como ferramenta de autoatendimento do próprio licitante: a empresa revisa, assina e protocola, com linguagem "gerador de minutas/modelos" e não "consultoria jurídica". Ajudam também um marketplace ou parceria com advogados para as peças contenciosas e termos de uso explícitos.
- Na esfera administrativa a empresa atua em nome próprio (art. 164), o que é mais defensável do que peças judiciais. Mas anúncios como "nossa IA faz sua impugnação com fundamentação jurídica" atraem a OAB. A checagem de habilitação e o cálculo de viabilidade de preço têm risco baixo.
- A decisão do STJ foi liminar (suspensão de decisão) e não resolve o mérito. O risco regulatório pode aumentar com o provimento da OAB sobre IA.

### Gaps
- Não achei decisão específica sobre "assessoria em licitações" por não advogados (despachantes de licitação), nem parecer do Tribunal de Ética da OAB sobre o tema. Vale buscar nas ementas do TED-OAB/SP.
- O status (set/2026) do provimento da OAB sobre IA não foi confirmado.

## 4. Viabilidade técnica: PNCP, Compras.gov.br, editais em PDF, qualidade de dados

### Takeaway
A API pública do PNCP permite listar contratações, itens, resultados (preços homologados), atas e contratos, e baixar arquivos anexos. Isso basta para o módulo de viabilidade e preços. O gargalo está no conteúdo dos editais: PDFs heterogêneos, às vezes escaneados, com habilitação espalhada entre edital, TR e anexos, e a qualidade dos dados do PNCP tem problemas documentados pela Transparência Brasil. Portais que não integram o PNCP (municípios pequenos até 2027) exigem scraping.

### Cited Findings
- API de consulta: `pncp.gov.br/api/consulta/v1/`. Endpoints principais: `/v1/contratacoes/publicacao` (por data de publicação; o mais usado), `/v1/atas` (vigência; dataInicial, dataFinal e pagina obrigatórios), `/v1/contratos`, `/v1/pca/`. Os tamanhos de página variam (50 para contratações, 500 para atas/contratos/PCA) (snippet) — [StatusLicitações](https://statuslicitacoes.com.br/api-pncp); [Manual de Integração PNCP v2.6](https://pncp.gov.br/manual/pt-br/latest/singlehtml/).
- API "pncp/v1" (integração/detalhe): `/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`, `.../itens` e `.../itens/{numeroItem}/resultados` (preço homologado e fornecedor). Há endpoint de arquivos da contratação, exposto inclusive em um MCP de terceiros (`compras_pncp_contratacao_arquivos`) (snippets) — [Manual PNCP](https://pncp.gov.br/manual/pt-br/latest/singlehtml/); [MCP Compras.gov.br (glama)](https://glama.ai/mcp/servers/opedrosoares/MCP_Compras/tools/compras_pncp_contratacao_arquivos).
- A Transparência Brasil publicou dois relatórios técnicos: "PNCP: API & Acesso aos dados" (jun/2024) e "Qualidade de dados" (dez/2024), com recomendações e desafios (não lidos, bloqueados) — [API & Acesso](https://backend.transparencia.org.br/wp-content/uploads/2025/09/portalnacionaldecontratacoespublicas_recomendacoesedesafiostecnicos.pdf); [Qualidade de dados](https://www.transparencia.org.br/downloads/publicacoes/qualidade_dados_portal_nacional_de_contratacoes_publicas.pdf).
- Existe um serviço de terceiros só para monitorar se a API do PNCP está fora do ar, o que indica instabilidade recorrente (inferência a partir do título) — [StatusLicitações](https://statuslicitacoes.com.br/api-pncp).
- 205 sistemas de compra integrados ao PNCP em 2025 (snippet) — [Effecti](https://effecti.com.br/tamanho-mercado-licitacoes-brasil/).
- Na extração de editais por IA, o problema central é a qualidade do arquivo: documento escaneado sem OCR produz leitura parcial, e omitir um anexo custa a habilitação. Recomenda-se OCR/IDP com validação humana de datas, valores e requisitos (snippet, blog comercial) — [Tecnoag](https://tecnoag.com.br/inteligencia-artificial-para-licitacoes-guia-pratico-2026/); [ConLicitação](https://conlicitacao.com.br/inteligencia-artificial-para-licitacoes/).
- Vários projetos open source já fazem radar PNCP com análise de edital por IA e checklist de habilitação, o que mostra baixa barreira técnica — [GitHub licitaflow](https://github.com/Enzo47961/licitaflow-licitacoes); [GitHub topic licitacoes](https://github.com/topics/licitacoes).
- Compras.gov.br tem API de dados abertos própria (`dadosabertos.compras.gov.br`, módulos de fornecedor, pregões, preços praticados). Estava bloqueada no teste, então a cobertura não foi verificada.

### Inferences
- Viabilidade de preço: dá para fazer bem com os itens e resultados do PNCP (preço homologado por item e CATMAT/CATSER). O ruído vem de descrições livres e unidades de medida inconsistentes, que exigem normalização.
- Checagem de habilitação: o dado de requisitos não é estruturado em lugar nenhum. É LLM sobre PDF, com risco de falso negativo, e cada erro custa a licitação ao cliente. Isso gera responsabilidade civil e exige disclaimers e human-in-the-loop.
- Certidões: CND federal (Receita/PGFN), FGTS (Caixa), CNDT (TST) e as estaduais/municipais têm emissão online heterogênea, algumas com captcha. Automatizar a emissão é possível só em parte, então o alerta de validade é o caminho mais simples.

### Gaps
- Não confirmei o percentual de contratações do PNCP com edital anexado em PDF, nem se os anexos (TR, minutas) vêm completos.
- Rate limits oficiais da API do PNCP: não encontrados.
- Conteúdo dos relatórios da Transparência Brasil: não lido. É leitura prioritária.

## 5. Timing: adoção da Lei 14.133, PNCP municipal, tendências 2025–2030

### Takeaway
A Lei 14.133 é o regime único desde 30/12/2023, e o PNCP já concentra cerca de R$ 1 tri/ano. A lacuna restante são os municípios com até 20 mil habitantes, que têm até 01/04/2027 para a publicação obrigatória. Em 2026–2027 a reforma tributária (CBS em jan/2027) cria uma nova camada de complexidade (formação de preço, reequilíbrio), o que tende a *aumentar* a dor e a disposição a pagar.

### Cited Findings
- Municípios com até 20 mil habitantes têm prazo de 6 anos, até 01/04/2027, para cumprir a publicação em sítio oficial e no PNCP. Para os demais entes a publicação já é obrigatória e é condição de eficácia de contratos e aditivos (snippet) — [Aprova](https://aprova.com.br/blog/pncp-guia-completo); [Megasoft](https://megasoft.com.br/pncp-prazos-legais-e-a-importancia-da-implementacao). Base legal: art. 176 da Lei 14.133 ([Planalto](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm)). A data exata depende de como se conta a partir de 01/04/2021; confirmar.
- Decreto 12.807/2025 atualizou os valores da Lei 14.133 para 2026 (atualização anual dos limites) — [Planalto D12807](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12807.htm); [Effecti](https://effecti.com.br/decreto-12807-de-2025/).
- Reforma tributária: a CBS substitui PIS/Cofins em jan/2027, e a LC 214/2025 prevê mecanismos de reequilíbrio. Fornecedores precisam revisar a formação de preços, as propostas e os contratos em execução, sem presumir reequilíbrio automático (snippets) — [Conjur, 29/09/2026](https://conjur.com.br/2026-set-29/reforma-tributaria-e-contratos-publicos-o-risco-que-o-edital-nao-alocou/); [SigaPregão](https://www.sigapregao.com.br/reforma-tributaria-nas-licitacoes-o-que-muda-em-2027/); [Effecti](https://effecti.com.br/reforma-tributaria-licitacoes/).
- Crescimento de MPE nas compras: +53% (2024 vs. 2023, até out) no Compras.gov.br — [MGI](https://www.gov.br/gestao/pt-br/assuntos/noticias/2025/janeiro/contratacoes-publicas-impulsionam-participacao-de-micro-e-pequenas-empresas) (snippet); +93% em três anos (Sebrae) — [Agência Sebrae](https://agenciasebrae.com.br/economia-e-politica/participacao-das-mpe-nas-compras-publicas-cresceu-93-nos-ultimos-tres-anos/) (título).

### Inferences
- 2027 é uma boa janela: os municípios pequenos entram no PNCP (mais dados e editais acessíveis por API) e a reforma tributária força a revisão de preços.
- Há riscos de redução da dor. A centralização de compras e as atas de registro de preço com adesão reduzem o número de certames. O SICAF, com certidões automáticas via integração, pode comoditizar o alerta de certidões. E se o saneamento pelo art. 64 se consolidar nos municípios, a inabilitação formal diminui.

### Gaps
- Não pesquisei em profundidade a margem de preferência (Decreto 11.890/2024), as compras sustentáveis e as tendências de centralização. Não achei dado sobre a adesão real de municípios ao PNCP (o painel "PNCP em números, municípios" existe em gov.br/pncp, mas estava bloqueado).

## 6. LGPD e outros riscos

### Takeaway
O risco LGPD é baixo a moderado. Os dados são majoritariamente de PJ e públicos (editais, resultados), mas os documentos de habilitação trazem dados pessoais de sócios e responsáveis técnicos. O risco mais relevante é a responsabilidade por erro de checagem que cause inabilitação.

### Cited Findings
- Nenhuma fonte específica foi encontrada sobre LGPD em ferramentas de licitação nesta rodada.
- A OAB está ativa contra IA que pratica atos privativos (ver seção 3) — [OAB 64465](https://www.oab.org.br/noticia/64465/oab-defende-advocacia-contra-empresas-de-ia-que-praticarem-atos-exclusivos-da-classe).
- Declarar-se falsamente ME/EPP para usufruir dos benefícios da LC 123 leva a anulação e sanções. Uma ferramenta que automatize a declaração de porte sem verificar o faturamento acumulado (incluindo o limite de contratações no ano) pode induzir o cliente a erro (snippets) — [ConLicitação](https://conlicitacao.com.br/a-declaracao-falsa-de-microempresa-e-empresa-de-pequeno-porte-nas-licitacoes/); [NELCA](https://gestgov.discourse.group/t/beneficios-me-epp-inaplicaveis-se-empresa-ja-contratou-acima-do-limite-no-ano/34111); [TCU, Licitações & Contratos 4.5.2.4](https://licitacoesecontratos.tcu.gov.br/4-5-2-4-participacao-de-microempresas-e-de-empresas-de-pequeno-porte-2/).

### Inferences
- Documentos de habilitação contêm RG/CPF de sócios, CREA/CRA de responsáveis técnicos e balanços. A ferramenta atua como operadora (contrato de tratamento, retenção mínima, criptografia). Usar LLM de terceiros exige transferência internacional com cláusulas adequadas.
- A maior ameaça não concorrencial é a responsabilidade e a reputação: um falso "OK" no checklist que resulte em inabilitação de um contrato relevante.

### Gaps
- Sem jurisprudência encontrada sobre responsabilidade de software de licitação por erro de análise.
