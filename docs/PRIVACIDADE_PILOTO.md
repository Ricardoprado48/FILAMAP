# Filamap — Aviso de Privacidade do Piloto

*Aprovado pelo Ricardo em 2026-09-29. Texto para entregar a cada tester junto com o convite. Não substitui uma Política de Privacidade completa revisada por advogado, que será exigida antes da venda.*

---

Olá! Obrigado por testar o Filamap.

Durante o piloto, o Filamap coleta alguns dados técnicos para conseguirmos encontrar e corrigir problemas sem precisar pedir prints ou acesso ao seu computador. Este aviso explica o que é coletado e o que não é.

## O que coletamos

**Para o app funcionar** (é o próprio serviço):
- seu e-mail de login;
- seus carretéis, pesos, preços, localização dos carretéis e histórico de impressões;
- dados da impressora: número de série, status, bandejas do AMS e progresso da impressão;
- os perfis de filamento do seu Bambu Studio e os carretéis da sua conta Bambu, só para identificar qual filamento está em cada slot.

**Para diagnóstico técnico** (a "Central de Observabilidade"):
- eventos como: o Agent iniciou, a impressora conectou ou desconectou, uma impressão começou ou terminou, uma finalização falhou e foi reenviada, e erros do programa;
- a versão do Agent e do app;
- um identificador aleatório da instalação, que não revela quem você é nem qual computador você usa;
- uma impressão digital curta (hash) do nome do computador, usada só para saber se a mesma instalação aparece em duas máquinas. O nome em si não é enviado.

## O que NÃO coletamos

- sua senha do Filamap ou da Bambu;
- o Access Code da impressora;
- tokens de sessão, cookies ou chaves;
- arquivos de impressão, modelos 3D ou fotos;
- endereço IP ou localização geográfica, na Central de Observabilidade.

Antes de sair do seu computador, todo texto técnico passa por uma limpeza automática que remove senhas, códigos, tokens, e-mails e o seu nome de usuário do Windows.

## Para que usamos

Só para fazer o Filamap funcionar e para diagnosticar e corrigir falhas durante o piloto. Não vendemos, não compartilhamos e não usamos os dados para publicidade.

## Quem acessa

Apenas o responsável pelo Filamap (Ricardo), para suporte. Os dados ficam no Supabase (provedor de banco de dados), protegidos por regras que impedem um usuário de ver os dados de outro.

## Por quanto tempo

- **Eventos técnicos:** 30 dias, depois são apagados automaticamente.
- **Dados do app** (carretéis, histórico): enquanto você usar o Filamap. Ao final do piloto, você pode pedir a exclusão.

## Seus direitos

Você pode, a qualquer momento:
- pedir uma cópia dos seus dados;
- pedir a correção ou a exclusão dos seus dados;
- desligar os eventos técnicos no seu computador (colocando `"telemetry": false` no arquivo de configuração do Agent). O app continua funcionando, mas o suporte fica mais difícil.

Para qualquer pedido, fale com: **rprado3d@gmail.com**.

Ao participar do piloto, você concorda com este aviso.
