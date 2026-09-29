# Filamap — Proposta de Preços e Monetização

*Proposta para decisão do Ricardo. Os preços são a **primeira aposta**, feita para aprender com compradores reais, e não um número definitivo. Montada com as skills pricing e offers. Data: 2026-09-29.*

---

## 1. O que o mercado cobra hoje

| Produto | O que faz | Preço |
|---|---|---|
| Spoolman | Estoque de filamento, open source, precisa de servidor próprio | Grátis |
| Spool Buddy, FilaMeter | Estoque manual, simples | Grátis |
| Spoolstock | Estoque manual, app | Grátis até 20 itens; **US$ 2/mês** ilimitado |
| Spoolio | Estoque manual | **US$ 2,99/mês** ou US$ 49,99 vitalício |
| SimplyPrint | Plataforma completa de gerenciamento remoto; desconta filamento automaticamente | Básico **US$ 5,39**, Pro **US$ 8,99/mês**; Farm ~US$ 3–4 por impressora |

Fontes: [Spoolstock](https://play.google.com/store/apps/details?id=io.pixelbus.spoolstock&hl=en_US), [Spoolio](https://spoolio.net/), [Spoolman](https://github.com/Donkie/Spoolman), [SimplyPrint pricing](https://simplyprint.io/pricing) e [SpotSaaS](https://www.spotsaas.com/product/simplyprint/pricing).

**Leitura:**
- Quem só **anota estoque à mão** vale de zero a US$ 3.
- Quem **desconta sozinho** cobra mais, mas a SimplyPrint vende um pacote bem maior (controle remoto, fila, câmera).

**O lugar do Filamap:** desconto automático a partir da impressora Bambu, **custo real por peça** e calculadora de preço, tudo em português e sem servidor. Fica acima dos apps manuais e abaixo de uma plataforma completa de fazenda.

---

## 2. Métrica de valor

A pergunta da skill pricing é: "quanto mais o cliente usa, mais valor ele recebe?"

- **Impressoras:** cada impressora a mais é mais filamento controlado e mais peças com custo. **É a métrica principal.**
- **Carretéis ativos:** servem de **limite do plano grátis**. É onde o hobbista sente a necessidade de subir de plano.
- **Recursos de quem vende peças** (margem, preço sugerido, relatórios): separam o Maker do Pro.

---

## 3. Planos propostos

| | **Grátis** | **Maker** | **Pro** *(recomendado)* |
|---|---|---|---|
| Para quem | experimentar | hobbista sério | quem vende peças |
| Preço | R$ 0 | **R$ 19,90/mês** ou **R$ 199/ano** | **R$ 39,90/mês** ou **R$ 399/ano** |
| Impressoras | 1 | até 2 | até 5 |
| Carretéis ativos | 15 | ilimitados | ilimitados |
| Desconto automático pela impressora | ✅ | ✅ | ✅ |
| Histórico de impressões | 30 dias | completo | completo |
| Tags NFC | ✅ | ✅ | ✅ |
| Alerta de estoque baixo | — | ✅ | ✅ |
| Custo real por peça (do histórico) | — | ✅ | ✅ |
| Calculadora: preço sugerido e margem | básica | básica | **completa** |
| Biblioteca de projetos com custo real | — | — | ✅ |
| Relatório mensal (consumo, custo, lucro) e exportar CSV | — | — | ✅ |
| Suporte | comunidade | e-mail | e-mail prioritário |

**Farm (depois, sob consulta):** acima de 5 impressoras, por exemplo **R$ 99/mês até 10 impressoras**. Só vale criar quando aparecer o primeiro cliente assim.

**Por que esses números:**
- O plano grátis **inclui o desconto automático**. É a "mágica" que faz a pessoa querer ficar, e o limite de 15 carretéis é o que empurra para o Maker.
- **Não começar em R$ 9,90** (a "armadilha do US$ 9"): atrai quem nunca pagaria um preço real e torna muito difícil subir depois.
- O **Pro custa o dobro do Maker**, e o Maker existe para o Pro parecer o melhor negócio.
- O **anual sai com cerca de 17% de desconto** (2 meses grátis), o padrão do mercado.
- **Custo por usuário:** baixo. O limite que importa é o Supabase grátis (500 MB), que comporta o piloto com folga. O plano pago do Supabase (US$ 25/mês) se paga a partir de uns 6 assinantes Pro.

---

## 4. Oferta de lançamento (os 10 testers do piloto)

Segue a regra da skill offers: **não dar desconto para atrair gente nova**. Recompensar quem já ajudou é outra coisa.

- **Durante o piloto:** Pro grátis.
- **Ao final:** "Preço de Fundador" de **R$ 19,90/mês no Pro**, travado enquanto a assinatura continuar. É uma escassez **real**: são só os 10 testers.
- **Bônus no plano anual:** kit com 10 tags NFC e clipes impressos.
- **Garantia:** reembolso integral do anual em até 30 dias, sem perguntas.
- **Pesquisa de preço no fim do piloto** (as 4 perguntas do método Van Westendorp):
  - a partir de que preço é caro demais?
  - abaixo de que preço é barato demais para confiar?
  - a partir de que preço é caro, mas ainda pagaria?
  - até que preço é um ótimo negócio?

---

## 5. Outras receitas

| Ideia | Recomendação | Por quê |
|---|---|---|
| **Kit NFC** (tags + clipe impresso, o `clipe_nfc_filamap.stl`) | ✅ Fazer | Margem alta, não depende da Bambu e faz propaganda na prateleira de cada cliente. Sugestão: R$ 49,90 por 10 tags + clipes. |
| **Parceria com lojas de filamento** (botão "Repor" quando o carretel acaba, com cupom para assinantes e link de afiliado) | ✅ Fazer depois do piloto | O app já sabe o que acabou, a marca e a cor. O cupom é **benefício de assinante**, não desconto de aquisição. A comissão vira receita. Depende de acordo com 1–2 lojas. |
| **Biblioteca de projetos** (link do MakerWorld/Printables ou arquivo do próprio usuário + filamento + custo real + preço sugerido) | ✅ Como recurso do Pro | Diferencial que usa dados que só o Filamap tem. |
| **Marketplace de STL** (vender ou hospedar modelos de terceiros) | ❌ Não agora | Licenças "uso não comercial", direitos autorais, armazenamento (1 GB no Supabase grátis), moderação e pagamento dividido. É um produto inteiro à parte. |
| **Designers parceiros em destaque** (só link, sem hospedar arquivo) | ⏳ Talvez depois | Baixo risco, se houver demanda. |
| **Vitalício** (como o Spoolio) | ❌ | O Filamap tem custo recorrente (banco, nuvem). O vitalício vira prejuízo com o tempo. |

---

## 6. O que precisa existir antes de cobrar

1. **Plataforma de pagamento com Pix e cartão recorrente.** Decisão do Ricardo; comparar Asaas, Mercado Pago e Stripe.
2. **Limites do plano aplicados no servidor** (banco), e não só na tela.
3. **Cadastro aberto + e-mail próprio + domínio** (item 2.1b/4.5 do plano).
4. **Termos de Uso e Política de Privacidade completos** (2.2b).
5. **Página de preços** com os valores em texto, legível também por IAs que comparam ferramentas.

---

## 7. Decisões do Ricardo

- [ ] Aprovar a estrutura Grátis / Maker / Pro (ou ajustar limites e preços)
- [ ] Aprovar a oferta de Fundador para os testers
- [ ] Kit NFC: vender? a que preço?
- [ ] Lojas de filamento para sondar parceria
- [ ] Plataforma de pagamento
