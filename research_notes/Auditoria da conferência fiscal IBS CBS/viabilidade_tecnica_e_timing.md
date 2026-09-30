# Viabilidade técnica e risco de timing: auditoria automática de CST/cClassTrib (IBS/CBS) item a item em NF-e/NFS-e

Status as of 2026-09-30. Network note: the egress proxy blocked direct fetches of most Brazilian sites (taxup.com.br, inventti.com.br, tax360.com.br, etc.). Most items below are from search-engine snippets and are marked "(snippet)". GitHub pages were fetched directly. Where snippets conflict, both versions are given.

## 1. Estrutura da tabela cClassTrib e frequência de mudanças

### Takeaway
cClassTrib is a 6-digit code. The first 3 digits are the CST and the last 3 are a sequence number for the legal hypothesis in LC 214/2025. The table is small (about 164 codes across 18 CSTs in the June 2026 version) but changes often: roughly 8 or more versions of Informe Técnico 2025.002 between May 2025 and June 2026, with indicators moved between tables. A rule engine must be versioned and must handle validity dates.

### Cited Findings
- Structure: 6 digits. The first 3 repeat the CST and the last 3 are the sequence number of the hypothesis within that CST. Example: non-incidence has 27 different cClassTrib, one per non-incidence or immunity situation (snippet) — [Contábeis, "Como definir CST e cClassTrib"](https://www.contabeis.com.br/noticias/74001/como-definir-cst-e-cclasstrib-passo-a-passo-pratico-para-a-reforma-tributaria/); [e-Auditoria](https://www.e-auditoria.com.br/blog/cclasstrib/)
- Each cClassTrib corresponds to a specific provision of LC 214/2025. The table also has indicators that link CST/cClassTrib codes to the NF-e validation rules (snippet) — [TecnoSpeed, Informe Técnico RT 2025.002](https://blog.tecnospeed.com.br/tabela-cclasstrib/); [TOTVS, IT 2025.002 with indicators](https://www.totvs.com/blog/fiscal-clientes/reforma-tributaria-informe-tecnico-2025-002-com-nova-tabela-de-classificacao-tributaria-cclasstrib-e-indicadores-de-cst/)
- Size: the version published on 23 June 2026 on the Portal Nacional da NF-e has 164 codes across 18 CSTs. Examples: CST 200 (alíquota zero) 54 codes, CST 410 (imunidade/não incidência) 38, CST 550 (suspensão) 25, CST 820 (tributação em declaração de regime específico) 9 (snippet, secondary aggregator) — [tax360](https://www.tax360.com.br/conteudo/tabela-classificacao-tributaria-ibs-cbs-cclasstrib). Unverified against the official file. Note that the "27 non-incidence codes" figure above is from an earlier version, versus 38 codes in CST 410 here, which is evidence of growth.
- The IT 2025.002 publishes four tables: cClassTrib, CST, cCredPres (crédito presumido), and alíquotas padrão IBS/CBS for 2026–2028 (snippet) — [NDD](https://ndd.tech/fiscal-blog/informe-tecnico-2025-002-tabelas-de-classificacao-tributaria-para-ibs-e-cbs/); [Sefin RO, Apr/2026](https://reformatributaria.sefin.ro.gov.br/2026/04/22/informe-tecnico-detalha-tabelas-de-classificacao-tributaria-cst-e-credito-presumido-do-ibs-e-da-cbs/)
- Version history (snippets):
  - v1.00 in May 2025. The table was published on 06/05/2025 — [Portal SPED Brasil forum](https://portalspedbrasil.com.br/forum/tabela-de-codigo-de-classificacao-tributaria-do-ibs-e-cbs-publicada-em-06-05-2025/)
  - v1.10 and v1.11 in June 2025 — [Focus NFe](https://focusnfe.com.br/notas-tecnicas/informe-tecnico/2025-002/)
  - v1.20 and v1.21 moved indicators, renamed indicators and created new ones — [TOTVS v1.20](https://www.totvs.com/blog/fiscal-clientes/reforma-tributaria-informe-tecnico-2025-002-v-1-20-tabelas-cclass-cst-e-credito-presumido/)
  - v1.30 on 24/11/2025. The indicator ind_RedutorBC moved from the cClassTrib table to the CST table — [TOTVS v1.30](https://www.totvs.com/blog/fiscal-clientes/it-2025-002-v-1-30-publicadas-novas-atualizacoes-nas-tabelas-do-ibs-e-da-cbs/)
  - v1.31 on 15/12/2025. Corrected validity dates in the cCredPres table and added new cClassTrib — [Reforma Tributária 360](https://reformatributaria360.com.br/notas-tecnicas/informe-tecnico-it-2025-002-v-1-31/)
  - v1.50 on 15/04/2026, and a newer table on 23/06/2026 — [tax360 (snippet)](https://www.tax360.com.br/conteudo/tabela-classificacao-tributaria-ibs-cbs-cclasstrib)
- Mapping to NCM/annexes: an NCM does not map one-to-one to a cClassTrib. NCM 9619.00.00 appears in LC 214 with 100% reduction for absorventes (cClassTrib 200013), but the same NCM covers baby diapers, which get only 60% reduction (cClassTrib 200035). The same NCM can allow full rate, 60% reduction or zero rate depending on the item's legal framing (snippet) — [search result aggregating Contábeis / Escola Superior ESN](https://www.contabeis.com.br/noticias/74449/os-4-erros-mais-comuns-na-classificacao-de-cclasstrib-e-como-evita-los/)
- Third-party NCM lookup tools show, for each NCM, its framing in the LC 214 annexes and the eligible cClassTrib, which means candidate lists rather than one answer (snippet) — [buscadorncm.com.br/cclasstrib](https://buscadorncm.com.br/cclasstrib)
- Regulations: Decreto 12.955/2026 (CBS, 620 articles plus 5 annexes) and Resolução CGIBS 6/2026 (IBS, 617 articles plus 5 annexes) were published on 30/04/2026 (snippet) — [Planalto d12955](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm); [PwC Tax Intelligence ed.45](https://www.pwc.com.br/pt/thinking-about-taxes/tax-intelligence/2026/tax-intelligence-express-ed45-Regulamentos-do-IBS-e-da-CBS.pdf); [Mattos Filho](https://www.mattosfilho.com.br/unico/regulamentos-ibs-cbs/)
- A new version of the IBS/CBS regulation may come out by October 2026 (snippet, headline only) — [Contábeis](https://www.contabeis.com.br/noticias/78722/ibs-e-cbs-nova-versao-do-regulamento-pode-sair-ate-outubro/)

### Inferences
- The code space is small, so encoding it is cheap. The costly part is the conditions attached to each code (NCM lists in the annexes, description-level exceptions within an NCM, and conditions on the buyer or destination).
- Changes of roughly one version every 1 to 2 months, including indicators moving between tables, mean the engine must load the official table by version and validity date instead of hard-coding it. A new version of the regulation expected around October 2026 adds more churn.

### Gaps
- Could not download the official table from nfe.fazenda.gov.br (blocked). The exact current code count, the full list of 18 CSTs and the version number after v1.50 are unverified.
- No source found for a machine-readable official crosswalk from annex NCM/NBS lists to cClassTrib. The crosswalks seen are vendor-made (buscadorncm, Y.ModelagemRTC).

## 2. Grau de determinismo: NCM/NBS + CFOP + operação + regime → cClassTrib?

### Takeaway
Most items can be classified by rules. A typical taxable item goes to full taxation, and a clean NCM match in an annex goes to its reduction code. A meaningful minority cannot be derived from NCM or CFOP alone: NCMs shared by products with different treatments, benefits that depend on the buyer or destination use, immunities, and specific regimes. No public, rigorous measure of that share was found. Practitioners say explicitly that classification "is not automatic" from CFOP or NCM.

### Cited Findings
- "A classificação do cClassTrib não é automática e não pode ser determinada apenas por CFOP ou NCM. Ela exige análise estruturada" (snippet) — [search result, Contábeis / MANUAL DE CLASSIFICAÇÃO DO CCLASSTRIB (Nimitz wiki)](https://nimitz.atlassian.net/wiki/spaces/DPU/pages/4876468266)
- A reference implementation of deterministic resolution (Firebird, labeled "didactic") uses these inputs: operation type (TOP), product/NCM, emission date, document model (NF-e/NFC-e) and participant type. The priority order is: operation override, then operation+product exception, then product exception, then NCM→cClassTrib with participant context, then NCM fallback. Each step is checked for validity date and model compatibility. Several classifications per NCM are kept as separate records (fetched) — [GitHub arbsis/Y.ModelagemRTC](https://github.com/arbsis/Y.ModelagemRTC)
  - In other words, the design needs product-level and operation-level exception tables maintained by people. NCM alone is not enough.
- Another open-source tool searches by NCM, by product description (in the special-treatment annexes or the full NCM table), by operation type, or in batch via CSV. It returns the applicable LC 214 annex, the reduction percentage and the estimated rate (snippet) — [GitHub goldtechsistemas/cClassTrib](https://github.com/goldtechsistemas/cClassTrib)
- In NFS-e, IBS/CBS depend on three items: the NBS code, the operation indicator (indOp) and the cClassTrib. In the national standard each service code accepts only certain NBS/indicator/cClassTrib values, and the city rejects incompatible combinations (snippet) — [Escola Superior ESN](https://escolasuperioresn.com.br/nfse-reforma-tributaria-ibs-cbs-notas-ajuste/); [Contábeis NFS-e prazos](https://www.contabeis.com.br/noticias/78630/nfs-e-veja-prazos-para-informar-ibs-e-cbs-em-2026/)
- Data-quality baseline: a recent survey found that 93% of the products analyzed had registry or tax inconsistencies related to adapting to IBS/CBS (snippet; original survey not identified) — [Gazeta do Paraná](https://gazetadoparana.com.br/artigo/reforma-tributaria-2026-lula-flavio-bolsonaro-adiamento-imposto-seletivo-cbs-ibs)
- Vendor claims: AI classifiers that use description, NCM and CEST claim "até 95% de precisão" and "60x mais rápido" / ">98% redução de tempo" in one case (snippet; vendor marketing, no method given) — [conselheiroone cClassTrib com IA](https://cclasstrib.conselheiroone.com/); [Dinelly Contabilidade](https://dinellycontabilidade.com.br/ia-automatiza-classificacao-de-cclasstrib-para-a-reforma-tributaria/)

### Inferences
- A workable design is a hybrid. (1) Deterministic rules from the official tables, annex NCM/NBS lists, CFOP (whether the operation is onerous), and regime (Simples/regular) generate candidates. (2) A description and context step, using AI or a human, resolves NCMs with shared treatments and checks conditions on the buyer or destination.
- An audit product is easier to justify than a classification product. It does not need to produce the right code for every item. It only needs to flag declared codes that are impossible (NCM not in the annex that the declared code claims) or suspicious (NCM appears in an annex but the item is declared at full rate).

### Gaps
- No independent study measuring the share of items that are fully deterministic. The "93%" survey and the "95% precision" claims are unsourced or vendor figures.

## 3. Validação oficial: o que a SEFAZ rejeita e o que passa (espaço da auditoria semântica)

### Takeaway
Official validation checks structure and combinations: the CST+cClassTrib pair exists and is allowed for that model, the group is present, and the indicators are consistent. It does not check whether the code is semantically correct for the product. Rejection of NF-e issued without the IBS/CBS group was also suspended indefinitely on 31/07/2026. The gap for semantic auditing is therefore large.

### Cited Findings
- Validation rules check whether the CST+cClassTrib pair is an existing combination allowed for that document model. A full-taxation cClassTrib applied to an item that should get a rate reduction is a valid combination, and SEFAZ authorizes it. The error only appears later, in the tax calculation (snippet) — [Escola Superior ESN, auditoria pós-emissão](https://escolasuperioresn.com.br/auditoria-nfe-ibs-cbs-cclasstrib/)
- The most common error, and the easiest to find by query, is an item with an exception CST (reduction, exemption, immunity, deferral, suspension) paired with a generic full-taxation cClassTrib (snippet) — [same](https://escolasuperioresn.com.br/auditoria-nfe-ibs-cbs-cclasstrib/)
- NT 2025.002-RTC: rejection 1115 (rule UB12-10) would block NF-e from regular-regime taxpayers issued without the IBS/CBS group from 03/08/2026. One study counts 213 rules taking effect on 03/08/2026 (snippet) — [taxup, "as 213 regras de 03/08/2026"](https://taxup.com.br/estudo-rejeicao-nfe-ibs-cbs/); [NDD, NT v1.40 prazos](https://reformatributaria.ndd.tech/atencao-aos-prazos-nt-2025-002-v1-40-define-inicio-das-rejeicoes-por-falta-de-ibs-e-cbs/)
- These rejections were suspended the day before by Ato Técnico Conjunto CGIBS/RFB nº 1, published on 31/07/2026, with no new date. The legal obligation (Ato Conjunto RFB/CGIBS nº 4/2026) stays in force (snippet) — [Contábeis, novas datas](https://www.contabeis.com.br/artigos/78468/novas-datas-ibs-e-cbs-nas-notas-fiscais-entenda-o-cronograma/); [IOB](https://noticias.iob.com.br/reforma-adiamento-rejeicao-notas-ibs-cbs/); [Inventti](https://inventti.com.br/fisco-desativa-rejeicao-ibs-cbs-obrigatoriedade-permanece/); [SpaceMoney, "sem nova data"](https://www.spacemoney.com.br/economia/legislacao/prazo-extra-ibs-cbs-nota); [reformatributaria.com](https://www.reformatributaria.com/documentos-fiscais/receita-e-comite-gestor-suspende-rejeicao-de-notas-fiscais-de-documentos-fiscais-saiba-quais)
- Conflicting snippet: one Contábeis article says "since February 2026 Sefaz has been validating this information in real time", so inconsistencies can block billing — [Contábeis, revisar NCM e cClassTrib](https://www.contabeis.com.br/noticias/77672/empresas-devem-revisar-ncm-e-cclasstrib-para-evitar-rejeicao-de-nf/). This probably refers to structural validation of fields when they are filled, as opposed to rejection for missing fields. It needs checking.
- NFS-e: missing IBS/CBS does not cause rejection by the national system until 31/12/2026, but the NFS-e is still non-compliant. Incompatible NBS/indOp/cClassTrib combinations are rejected (snippet) — [CRC-MS](https://crcms.org.br/nfs-e-comite-esclarece-prazos-para-ibs-e-cbs-e-regra-de-nao-rejeicao-em-2026/); [CRC-MA](https://crcma.org.br/noticias/nfs-e-comite-esclarece-prazos-para-destaque-de-ibs-e-cbs-e-regra-de-nao-rejeicao-em-2026); [ESN](https://escolasuperioresn.com.br/nfse-reforma-tributaria-ibs-cbs-notas-ajuste/)
- Official NT page (not fetched): [Portal NF-e, Reforma Tributária do Consumo](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=AklZnck3o6I%3D); [SVRS news](https://dfe-portal.svrs.rs.gov.br/Nfe/Noticias/2979); [NFe.io, NT v1.50](https://nfe.io/docs/documentacao/reforma-tributaria/conceitos-funcionais/nota-fiscal-de-produto/adequacao-nt-2025-002-rtc-v150/)

### Inferences
- Errors that pass validation and that a semantic audit can target:
  - (a) Full-taxation code when the NCM is in a reduction or zero-rate annex (lost benefit; overpayment from 2027).
  - (b) Reduction or zero code when the NCM or product is not eligible (under-collection; assessment risk).
  - (c) Code eligible for the NCM but wrong for the description (NCM 9619 example).
  - (d) Conditional benefits without the condition being met (buyer type, destination use).
  - (e) Rate or base inconsistent with the code (for example, a reduced-base indicator versus the vBC and pRedAliq fields).
  - (f) Calculation mismatches against the official calculator.
- Because rejections are suspended, many 2026 documents may be missing the group entirely. That is a simple "completeness" audit and a quick win.

### Gaps
- Could not read the official list of NT 2025.002 rules (UB12-xx etc.) to confirm exactly which cross-checks (for example NCM × cClassTrib) SEFAZ does or does not run. The taxup "213 rules" study was not accessible.

## 4. Dados oficiais e de teste: tabelas, XSD, homologação, datasets, bibliotecas, calculadora

### Takeaway
The rule engine can be built from free official material: the IT 2025.002 tables, the NT 2025.002-RTC with its XSDs, the LC 214 annexes and regulations, and the open-source official Calculadora de Tributos, which has a local REST component. Public real-world XMLs with IBS/CBS are scarce. The Portal da Transparência provides federal purchase invoices in CSV, and several GitHub projects are usable starting points.

### Cited Findings
- Calculadora de Tributos (RFB): Beta released on 18/07/2025. It is official, free and open source, and calculates CBS, IBS and IS. It comes in two forms: a web simulator, and a "Componente para Uso Local" with a REST API for ERP integration that can run offline (snippet) — [Contábeis](https://www.contabeis.com.br/noticias/71865/receita-libera-calculadora-de-tributos-da-reforma-tributaria/); [TOTVS](https://www.totvs.com/blog/fiscal-clientes/reforma-tributaria-receita-federal-lanca-versao-beta-da-calculadora-dos-novos-tributos/); [CBIC](https://cbic.org.br/receita-federal-lanca-calculadora-de-tributos-com-base-nas-novas-regras-da-reforma-tributaria/); [TecnoSpeed](https://blog.tecnospeed.com.br/calculadora-da-reforma-tributaria/)
  - Gap: the exact repository or URL and whether the calculator validates cClassTrib against NCM could not be confirmed. It seems to take cClassTrib as an input rather than infer it (inference).
- Open-source GitHub projects (fetched unless noted):
  - [arbsis/Y.ModelagemRTC](https://github.com/arbsis/Y.ModelagemRTC): DDL, loads and a RESOLVE_CCLASSTRIB procedure with tables CCLASSTRIB_OFICIAL and NCM_NBS_CCLASSTRIB (didactic).
  - [silvioalbqrq/AnaliseXML-IBSeCBS](https://github.com/silvioalbqrq/AnaliseXML-IBSeCBS): client-side JS that reads NF-e XML (gIBSCBS, gIBSUF, gCBS) and checks totals for consistency. It does not use official tables and has no license stated.
  - [goldtechsistemas/cClassTrib](https://github.com/goldtechsistemas/cClassTrib): NCM/description lookup to annex, reduction and cClassTrib (snippet).
  - [RafaelDiasM/IBSCBS](https://github.com/RafaelDiasM/IBSCBS): "Gateway, Motor de Regras (LC 214/2025)" (snippet).
  - [rodrigedilson/audit PR #115](https://github.com/rodrigedilson/audit/pull/115): "sugestão de cClassTrib pelos anexos da LC 214" (snippet).
- Public datasets:
  - Portal da Transparência (CGU + RFB) publishes NF-e for federal-government purchases: about 4,000 notes per day, updated every two weeks, downloadable as CSV, with an API — [Portal da Transparência, Notas Fiscais](https://portaldatransparencia.gov.br/download-de-dados/notas-fiscais); [data dictionary](https://portaldatransparencia.gov.br/dicionario-de-dados/notas-fiscais); [API](https://portaldatransparencia.gov.br/api-de-dados)
  - Other open data: [NFS-e from PBH (Belo Horizonte)](https://dados.pbh.gov.br/dataset/nfs-e-notas-fiscais-de-servicos-eletronicas-geradas-no-mes); [SP NF-e catalog](http://catalogo.governoaberto.sp.gov.br/dataset/312-nfe-nota-fiscal-eletronica); [transparencia-mg/portal_notas_fiscais](https://github.com/transparencia-mg/portal_notas_fiscais)
- Reference tables from vendors: [NFe.io CST/cClassTrib reference](https://nfe.io/docs/documentacao/reforma-tributaria/conceitos-funcionais/tabelas-de-referencia/tabela-referencia-cst-classificacao-tributaria-ibs-cbs/); [Focus NFe NT 2025.002](https://focusnfe.com.br/notas-tecnicas/nfe/2025-002/)

### Inferences
- For test data, the best option is synthetic XMLs built against the NT 2025.002 XSDs and submitted to homologação through a test certificate, plus real CSV item data from the Portal da Transparência (NCM plus description) to test the NCM/description step.
- The official calculator can serve as a ground-truth oracle for amounts, given a CST/cClassTrib. The auditor adds the classification check the calculator does not do.

### Gaps
- Not confirmed whether Portal da Transparência CSVs include IBS/CBS fields (CST/cClassTrib) from 2026 onward. The data dictionary was not read.
- No public anonymized corpus of NF-e XMLs with IBS/CBS groups was found. No Kaggle dataset was found.
- The homologação environment exists (standard for NF-e), but details specific to RTC were not verified in this session.

## 5. Evidência sobre acurácia de IA/LLM em classificação fiscal

### Takeaway
Academic benchmarks on tariff (HS/HTS) classification show LLMs are far from reliable at fine granularity: about 40% accuracy at 10 digits and 57.5% at 6 digits for a fine-tuned 70B model, and about 59% mean level-wise for the best frontier model in 2026. Vendor claims of about 95% for cClassTrib are unverified. AI is best used for ranking candidates and flagging items within a rule-constrained candidate set, not as the classifier.

### Cited Findings
- ATLAS benchmark (18,731 US CBP rulings): a fine-tuned LLaMA-3.3-70B reaches 40% accuracy at 10 digits and 57.5% at 6 digits (snippet) — [ATLAS, CEUR-WS Vol-4162](https://ceur-ws.org/Vol-4162/paper7.pdf)
- HSCodeComp: an expert benchmark of 632 e-commerce products annotated at 10 digits. Cited in a 2026 paper proposing a "deterministic agentic workflow" with rule reasoning (snippet) — [arXiv 2605.14857](https://arxiv.org/pdf/2605.14857)
- Consensus agentic framework: Gemini-3.1-Pro ranks first with 59.45% mean level-wise accuracy, and GPT-OSS-120B reaches 49.17% (snippet) — [arXiv 2606.16987](https://arxiv.org/html/2606.16987v1)
- A Brazilian study evaluating LLMs for a tax or customs classification task exists at UnB PPEE (title only seen, "Avaliação de grandes modelos de linguagem (LLMs) para a...", 2025; content not read) — [UnB PPEE PDF](https://ppee.unb.br/wp-content/uploads/2025/09/AVALIACAO-DE-GRANDES-MODELOS-DE.pdf)
- Vendor claim of "até 95% de precisão" for AI cClassTrib classification (marketing) — [conselheiroone](https://cclasstrib.conselheiroone.com/)

### Inferences
- The cClassTrib problem is much narrower than HS classification: 164 codes, and given the NCM usually only 1 to 3 candidates. So conditional accuracy should be much higher than the HS benchmarks, as long as the NCM is correct. The main AI risk moves upstream to an incorrect NCM, which the HS benchmarks show is hard.
- Suggested positioning: deterministic rules plus LLM rationale or explanation, with human review of flagged items. Avoid claiming autonomous classification.

### Gaps
- No peer-reviewed study specific to NCM (Mercosul) or cClassTrib accuracy was found. The UnB study was not read.

## 6. Timing: obrigações 2026, multas, adiamentos, 2027, split payment, eleições

### Takeaway
The legal obligation for NF-e has been in force since 03/08/2026, for NFS-e since 01/10/2026, and 01/01/2027 for Simples. Penalties could legally apply from 01/08/2026. However, SEFAZ rejection is suspended indefinitely (NF-e) or until 31/12/2026 (NFS-e), and 2026 is an informative test year with no payment. Split payment has slipped to 2028. A presidential candidate (Flávio Bolsonaro, PL) has promised to suspend the reform for a year, and at least 50 bills propose changes. Postponing CBS on 01/01/2027 would require a constitutional amendment (PEC), so urgency is real but politically fragile.

### Cited Findings
- Ato Conjunto RFB/CGIBS nº 1/2025 (Dec/2025): no penalties for missing IBS/CBS fields until the first day of the 4th month after publication of the common part of the regulations. The 2026 calculation is informative only, and payment is waived if ancillary obligations are met — [Ministério da Fazenda](https://www.gov.br/fazenda/pt-br/assuntos/noticias/2025/dezembro/receita-federal-e-comite-gestor-do-ibs-definem-regras-de-obrigacoes-acessorias-da-reforma-tributaria-para-inicio-de-2026); [CGIBS](https://www.cgibs.gov.br/comite-gestor-e-receita-federal-garantem-prazo-de-adaptacao-e-transicao-segura-para-contribuintes-do-ibs-e-da-cbs-em-2026); [Agência Brasil](https://agenciabrasil.ebc.com.br/economia/noticia/2025-12/multa-por-falta-de-cbs-e-ibs-em-notas-e-suspensa-no-inicio-de-2026); [Migalhas](https://www.migalhas.com.br/quentes/447209/receita-suspende-ate-1-de-abril-multas-por-nota-emitida-sem-ibs-e-cbs)
  - Note: early reports said "até 1º de abril". That date was superseded because the regulations were only published on 30/04/2026.
- Regulations were published on 30/04/2026, which makes penalties possible from 01/08/2026 (the first working day of the 4th month) (snippet) — [JBSoft](https://blog.jbsoft.com.br/publicado-regulamento-do-cbs-ibs-dec-12955-2026/); [Contábeis, marco de 1º de agosto](https://www.contabeis.com.br/artigos/76490/reforma-tributaria-marco-de-1o-de-agosto-de-2026-detalhado/); [TecnoSpeed](https://blog.tecnospeed.com.br/regulamentos-da-cbs-e-ibs/)
- Ato Conjunto RFB/CGIBS nº 4/2026 sets four waves: 03/08/2026 for NF-e, CT-e and MDF-e; 01/10/2026 for NFS-e and NFCom; 01/12/2026 for digital platforms; 01/01/2027 for Simples Nacional (snippet) — [Contábeis](https://www.contabeis.com.br/artigos/78468/novas-datas-ibs-e-cbs-nas-notas-fiscais-entenda-o-cronograma/); [Contmatic, 4 ondas](https://simplifique.contmatic.com.br/blogs/obrigatoriedade-ibs-cbs-documentos-fiscais-4-ondas-2026)
- NFS-e: some services start 01/10/2026 and others in December depending on the operation (snippet) — [Convergência Digital](https://convergenciadigital.com.br/governo/obrigatoriedade-do-cbs-e-ibs-nas-nfs-e-comeca-em-outubro-ou-dezembro-conforme-operacao/)
- NF-e rejection was suspended on 31/07/2026 with no new date. Nothing changed regarding fines (snippet) — [Contábeis](https://www.contabeis.com.br/artigos/78468/novas-datas-ibs-e-cbs-nas-notas-fiscais-entenda-o-cronograma/); [ERPWorks, "caiu a rejeição, não a obrigação"](https://erpworks.com.br/conteudos/nfe-ibs-cbs-obrigatoriedade-agosto-2026-rejeicoes/)
- Vendor help center: "CBS e IBS já geram multa na emissão de NF-e e NFS-e" (snippet, title only) — [Conta Azul](https://ajuda.contaazul.com/hc/pt-br/articles/45282194549261-Notas-fiscais-CBS-e-IBS-j%C3%A1-geram-multa-na-emiss%C3%A3o-de-NF-e-e-NFS-e). No evidence of actual assessments was found.
- 2027: CBS starts being charged on 01/01/2027 (test rate of 1% reported), and the transition schedule in the Constitution is unchanged — [Contábeis, split payment](https://www.contabeis.com.br/noticias/78723/split-payment-nao-comeca-em-janeiro-de-2027-entenda/); [Omie](https://www.omie.com.br/blog/adiamento-split-payment-reforma-tributaria/). Flag: the "1% test rate" in 2027 conflicts with the common understanding that CBS is charged at its full reference rate from 2027 (with PIS/Cofins extinguished) and the 0.1% IBS test continues. Verify before use.
- Split payment will not start in January 2027. RFB confirmed it becomes mandatory for B2B only from 2028. In 2027 it is optional (B2B), and so is "RAD" (Recolhimento pelo Adquirente) (snippet) — [Contábeis](https://www.contabeis.com.br/noticias/78723/split-payment-nao-comeca-em-janeiro-de-2027-entenda/); [Omie, adia para 2028](https://www.omie.com.br/blog/receita-federal-adia-obrigatoriedade-do-split-payment-para-2028/); [HLB](https://www.hlb.com.br/split-payment-deve-ficar-para-2028-o-que-muda-para-as-empresas/); [Exame](https://exame.com/economia/split-payment-adiado-nao-e-split-payment-esquecido-o-que-muda-no-caixa-e-nos-sistemas-das-empresas/)
- Elections: Flávio Bolsonaro (PL presidential pre-candidate) said that if elected he would suspend the reform for one year. That would need a PEC (3/5 in two rounds in each House), approved after the election and before inauguration on 05/01/2027 to prevent the 01/01/2027 start — [InfoMoney](https://www.infomoney.com.br/politica/proposta-de-flavio-para-adiar-reforma-tributaria-exigiria-pec-e-aval-do-congresso/)
- At least 50 bills in Congress seek to change the reform, and the opposition wants a postponement — [Gazeta do Paraná](https://gazetadoparana.com.br/artigo/reforma-tributaria-2026-lula-flavio-bolsonaro-adiamento-imposto-seletivo-cbs-ibs); [Nota Gateway](https://notagateway.com.br/blog/reforma-tributaria-sob-disputa-50-projetos-no-congresso-tentam-mudar-as-regras-antes-da-estreia-da-cbs/)
- Practitioner op-ed (29/09/2026): "É urgente adiar o início da Reforma Tributária" — [Mauro Negruni](https://mauronegruni.com.br/2026/09/29/e-urgente-adiar-o-inicio-da-reforma-tributaria/)
- The Imposto Seletivo (about R$ 42 bi) is at risk of being postponed to February 2027 (snippet; low-quality source) — [MixVale](https://www.mixvale.com.br/2026/09/29/imposto-seletivo-de-r-42-bilhoes-corre-risco-de-adiamento-para-fevereiro-de-2027/)

### Inferences
- The pattern in 2026 is repeated soft deferrals of enforcement (penalty grace period, rejection suspended with no date, NFS-e non-rejection until year end, split payment to 2028), while the legal deadlines stay in place. Expect more operational slippage. Hard-date postponement of CBS in 2027 is less likely because it needs a PEC in a short post-election window, but it is not zero if the opposition wins in October 2026 (1st round 04/10/2026, run-off 25/10/2026; dates not verified in this session).
- Urgency risk for an audit product: in 2026 errors cost no money (informative year), so willingness to pay depends on fear of 2027. If CBS starts on 01/01/2027 as scheduled, wrong cClassTrib directly changes the CBS owed and the credits of buyers. That is the real value trigger. Position the product for "2027 readiness" and for buyer-side credit auditing, which does not depend on SEFAZ rejection rules.
- When SEFAZ rejection comes back (date unknown), structural errors will be blocked at issuance, which shrinks the "completeness" market. Semantic errors still pass, so the core audit value survives.

### Gaps
- No official date for re-enabling NF-e rejection rules (as of 30/09/2026).
- No evidence found of fines actually applied in August or September 2026.
- 2027 CBS rate details (reported "1% test") conflict with the standard understanding. Needs verification against LC 214 and EC 132.
- Election result and any post-election PEC are unknown as of the cut-off date.
