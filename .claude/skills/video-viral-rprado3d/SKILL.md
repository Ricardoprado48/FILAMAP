---
name: video-viral-rprado3d
description: Recria a fórmula de vídeos virais do TikTok (de qualquer nicho) para os produtos físicos da rprado3d, como a caneca de time. Use quando o usuário enviar um vídeo de referência para analisar ("analisa esse vídeo", "extrai a fórmula", "faz a engenharia reversa"), pedir um roteiro, prompt ou vídeo para um produto ("gera o vídeo da caneca", "roteiro com a fórmula F-002", "prompt pro Flow/Higgsfield/HeyGen") ou quiser registrar e comparar resultados de vídeos postados ("registra o resultado", "qual fórmula vende mais").
---

# Vídeo Viral rprado3d

A ideia: **não copiamos o vídeo, copiamos a fórmula.** O gancho, o ritmo, a estrutura e o gatilho de compra de um vídeo que já viralizou, de qualquer nicho, são aplicados a um produto da rprado3d. O vídeo novo é gravado ou gerado do zero.

A Skill tem três modos. Descubra pelo pedido qual deles usar. Se não der para saber, pergunte.

| Modo | Quando | Entrada | Saída |
|---|---|---|---|
| **A. Extrair fórmula** | O usuário mandou um vídeo de referência | .mp4 + transcrição da narração | Nova fórmula salva em `references/formulas.md` |
| **B. Gerar vídeo** | O usuário quer um vídeo para um produto | Foto do produto + fórmula (ou "escolhe você") | Roteiro, cenas, prompts, legenda |
| **C. Registrar resultado** | O usuário postou e tem os números | Fórmula usada + métricas | Linha em `historico/resultados.csv` + ranking |
| **D. Série por time** | "Um vídeo para cada time", "faz a série" | Fórmula + lista de times | Plano de gravação único + 1 pacote por time |

**Prioridade do dono:** vídeos curtos de IA no estilo das fórmulas **F-013** (POV estádio) e **F-014** (kit presente), validadas por receita, depois as POV F-008 a F-012. Um vídeo por time, postado no **Instagram Reels** (venda pelo Direct/link na bio) e no **TikTok**.

Arquivos de apoio (leia quando o modo pedir):
- `references/formulas.md`: biblioteca de fórmulas, já com 6 iniciais (F-001 a F-006).
- `references/produtos.md`: ficha de cada produto (o que é, regras do que pode e não pode ser mostrado).
- `references/regras.md`: regras de publicação (TikTok, consumidor, marcas, conteúdo de IA). **Leia sempre no modo B.**
- `scripts/analisar_video.py`: duração, resolução, cortes de cena e grades de frames.
- `scripts/checar_prompt.py`: conta caracteres de um prompt com código, nunca no olho.

---

## Modo A: extrair a fórmula de um vídeo de referência

O vídeo pode ser de **qualquer nicho** (cozinha, beleza, pet, humor). O que importa é a estrutura.

1. **Analise o visual, sem chutar.** Rode:
   ```bash
   python3 scripts/analisar_video.py <video.mp4> <pasta_saida>
   ```
   O script imprime duração, resolução, fps, se há áudio e os **timestamps de cada corte de cena**, e gera `grade_XX.jpg` (12 frames por grade, 2 frames/s, ou seja, 6 s por grade). **Abra e veja todas as grades**, cobrindo o vídeo inteiro.
2. **Peça a transcrição.** Você não ouve áudio. Peça ao usuário para colar a narração (pelas legendas do TikTok). Se o vídeo não tiver fala, registre "sem narração" e analise o texto na tela pelas grades.
3. **Monte o DNA da fórmula** no formato abaixo e **confirme com o usuário antes de salvar**:
   ```markdown
   ## F-0XX: <nome curto>
   - **Origem:** <nicho do vídeo de referência, link se houver>
   - **Por que funciona:** <gatilho psicológico: curiosidade, emoção, polêmica, satisfação, prova social>
   - **Duração / cortes:** <X s, N cortes, corte médio a cada Y s>
   - **Gancho (0–3 s):** <o que aparece + o que é dito/escrito>
   - **Estrutura:**
     | Tempo | Cena (câmera, enquadramento, ação) | Fala / texto |
   - **Narração:** <tom, palavras por segundo, voz (gênero, idade, energia)>
   - **Gatilho de compra:** <onde e como o desejo é criado>
   - **CTA:** <como termina>
   - **Exige filmagem real?** <sim/não e de quê>
   - **Adaptação para a caneca de time:** <1 frase>
   ```
   Para calcular palavras por segundo, conte as palavras da transcrição e divida pela duração.
4. **Salve** acrescentando a fórmula ao final de `references/formulas.md` com o próximo ID livre. Se o arquivo não puder ser gravado (por exemplo, no claude.ai), entregue o `formulas.md` atualizado como arquivo para download.

---

## Modo B: gerar o vídeo para um produto

Antes de tudo, leia `references/regras.md` e a ficha do produto em `references/produtos.md`. Se o produto não tiver ficha, faça ao usuário as perguntas da seção "Produto novo" e adicione a ficha.

1. **Escolha a fórmula.** Se o usuário não indicar, leia `historico/resultados.csv` e sugira as 2 ou 3 fórmulas com mais vendas por vídeo. Sem histórico, sugira pela "Adaptação para a caneca de time" de cada fórmula.
2. **Roteiro primeiro, cenas depois.** Escreva a fala em **português do Brasil** seguindo a fórmula (gancho → corpo → CTA), respeitando as palavras por segundo da referência para caber no tempo. Só então monte as cenas em volta da fala.
3. **Classifique cada cena** como `REAL` (gravar com o celular: impressora, a peça de verdade, embalagem, mãos) ou `IA` (gerar no Flow/Higgsfield/avatar). O produto em close deve ser `REAL` sempre que possível: a IA deforma escudo, texto e as camadas da impressão.
4. **Entregue, nesta ordem:**
   1. **Roteiro cronometrado** (tabela `Tempo | Cena | REAL/IA | Fala | Texto na tela`).
   2. **Lista de gravação**: só as cenas `REAL`, com dica de enquadramento (vertical 9:16, luz, fundo).
   3. **Legendas** sincronizadas com a fala, em texto separado (para colar no CapCut).
   4. **Prompt Google Flow** (Veo 3): descrição visual em inglês, fala em português entre aspas, **no máximo 500 caracteres**, sem citar duração nem proporção (o 9:16 é configurado na interface).
   5. **Prompt timeline Higgsfield** (Veo 3): blocos `[00:00-00:03]`, 9:16 vertical, até 15 s, fala em português entre aspas.
   6. **Roteiro de avatar** (HeyGen / CapCut / TikTok Symphony): só a fala, com marcações de pausa `[pausa]` e ênfase em MAIÚSCULAS. Só gere este item se a fórmula usar alguém falando para a câmera.
   7. **Legenda do post + hashtags**, em português, **uma versão por plataforma**:
      - **Instagram Reels:** CTA de conversa ("Chama no Direct com o nome do seu time", "Link na bio"), 3 a 5 hashtags, capa sugerida (frame do copo em destaque).
      - **TikTok:** CTA de comentário/carrinho ("Comenta seu time", "Tá no carrinho"), 3 a 5 hashtags.
   8. **Checklist de publicação** (copie de `references/regras.md`).
5. **Confira os limites com código.** Salve cada prompt em arquivo e rode `python3 scripts/checar_prompt.py <arquivo> 500` (Flow). Se passar do limite, corte descrição visual, **nunca a fala**.
6. **Não invente** pessoas, animais ou elementos que a fórmula não tenha. Não altere o produto: cores, escudo, formato e proporção iguais aos da foto.
7. **Geração automática (opcional):** se houver um conector do Higgsfield e o usuário disser "gerar", use o prompt timeline + a foto do produto como referência, modelo Veo 3. Consulte o status do job e **nunca envie o mesmo pedido duas vezes**.

---

## Modo C: registrar resultado e comparar fórmulas

1. Peça ao usuário (ou leia da mensagem): data de postagem, produto, ID da fórmula, gancho usado, link do vídeo, visualizações em 48 h, curtidas, comentários, compartilhamentos e vendas atribuídas.
2. Acrescente uma linha a `historico/resultados.csv` mantendo o cabeçalho existente. Sem permissão de escrita, entregue o CSV atualizado para download.
3. Mostre o ranking com código (não de cabeça), agrupando por `formula_id`: nº de vídeos, média de visualizações, média de comentários e **vendas por vídeo**. Ordene por vendas por vídeo.
4. Comente em 2 ou 3 linhas: qual fórmula repetir, qual abandonar e qual gancho testar a seguir. Com menos de 3 vídeos por fórmula, avise que ainda é cedo para concluir.

---

## Modo D: série por time (um vídeo para cada time)

1. Confirme a **fórmula** (de preferência uma POV) e a **lista de times** com estoque ou produção possível (`references/produtos.md`). Se a lista não vier, pergunte.
2. Para cada time, preencha as variáveis da fórmula: `{time}`, `{apelido}`, `{torcedor}`, `{rival}`, cores. Use apelidos e rivalidades **corretos**; na dúvida, pergunte em vez de inventar.
3. Entregue **um plano de gravação único** para a série inteira: mesmo enquadramento, mesma luz e mesmo ângulo, trocando só o copo e os objetos do time. Assim uma sessão de 1 a 2 horas rende todos os vídeos.
4. Entregue uma **tabela da série** (`Time | Texto POV | Objetos de cena | Legenda Reels | Legenda TikTok | Data sugerida`). A data sugerida vem da semana de jogo do time ou de clássico, se o usuário informar o calendário.
5. Se houver par de clássico (F-009), gere os dois lados do clássico juntos.
6. Ao final, ofereça registrar cada vídeo no histórico (Modo C) com `formula_id` + time no campo `produto` (ex.: `copo-flamengo`), para comparar desempenho **por time** e **por fórmula**.

---

## Como esta Skill foi construída

- Método base: engenharia reversa de vídeos virais com `ffprobe`/`ffmpeg` (frames a 2/s em grades, para o modelo realmente ver o vídeo inteiro) + transcrição colada pelo usuário, gerando prompts para Google Flow e Higgsfield (Veo 3).
- Adaptado para a rprado3d: português do Brasil, produto próprio (não afiliado), mistura de cenas reais e de IA, biblioteca de fórmulas reutilizável entre nichos e histórico de resultados para descobrir quais fórmulas vendem.
- Para criar uma Skill igual para outro produto: copie esta pasta, troque a ficha em `references/produtos.md` e mantenha as regras.
