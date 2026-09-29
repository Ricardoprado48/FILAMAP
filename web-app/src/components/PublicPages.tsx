// Páginas públicas (sem login): /guia e /privacidade.
// Ficam no próprio site para o tester não depender de outro serviço.

export const TERMS_VERSION = "piloto-2026-09-29";

const page = { maxWidth: 760, margin: "0 auto", padding: "24px 16px 48px", color: "#e2e8f0", lineHeight: 1.55, fontSize: 15 } as const;
const h1 = { color: "#fff", fontSize: 26, margin: "8px 0 4px" } as const;
const h2 = { color: "#fff", fontSize: 19, margin: "28px 0 8px" } as const;
const muted = { color: "#94a3b8", fontSize: 13 } as const;
const box = { background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "12px 14px", margin: "10px 0" } as const;
const link = { color: "#38bdf8" } as const;

function Top() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <a href="/" style={{ ...link, fontWeight: 700, textDecoration: "none" }}>← Filamap</a>
      <span style={muted}>
        <a href="/guia" style={link}>Guia</a> · <a href="/privacidade" style={link}>Privacidade</a>
      </span>
    </div>
  );
}

export function GuidePage() {
  return (
    <div style={page}>
      <Top />
      <h1 style={h1}>Guia do Tester</h1>
      <p style={muted}>Em uns 15 minutos o Filamap passa a descontar sozinho o filamento de cada impressão da sua Bambu Lab.</p>

      <h2 style={h2}>O que você precisa</h2>
      <ul>
        <li>Uma impressora <strong>Bambu Lab</strong> na rede Wi-Fi da sua casa ou oficina.</li>
        <li>Um <strong>computador com Windows 10 ou 11</strong> na mesma rede, que fique ligado enquanto você imprime.</li>
        <li>O <strong>Access Code</strong> da impressora (veja <a href="#access-code" style={link}>onde achar</a>).</li>
        <li>O <strong>link de convite</strong> que você recebeu.</li>
      </ul>
      <div style={box}>
        Usa outro programa que se conecta à impressora pela rede local (Home Assistant, por exemplo)? Avise antes: algumas impressoras aceitam só uma conexão desse tipo por vez.
      </div>

      <h2 style={h2}>1. Crie sua conta</h2>
      <ol>
        <li>Abra o link do convite. Ele abre a tela <strong>criar conta</strong> com o código já preenchido.</li>
        <li>Digite seu e-mail, crie uma senha (mínimo 8 caracteres), aceite o aviso de privacidade e toque em <strong>Criar conta e entrar</strong>.</li>
        <li>O Filamap abre com a lista <strong>🚀 Primeiros passos</strong>. Ela se marca sozinha conforme você avança.</li>
      </ol>

      <h2 style={h2}>2. Instale o Filamap Agent</h2>
      <p>O Agent é um programa pequeno que fica no computador conversando com a impressora. Ele roda escondido e liga sozinho com o Windows.</p>
      <ol>
        <li>No computador, toque em <strong>💻 Computadores</strong> e depois em <strong>Baixar o Filamap Agent</strong>.</li>
        <li>O navegador pode avisar que o arquivo "não é baixado com frequência" ou é "suspeito". Escolha <strong>Manter</strong> (no Chrome/Edge, pelo menu "…" do download).</li>
        <li>Abra o arquivo. Se aparecer a tela azul <strong>"O Windows protegeu o computador"</strong>, clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.</li>
        <li>Aceite a permissão do Windows e clique em <strong>Avançar</strong> até <strong>Concluir</strong>.</li>
      </ol>
      <p style={muted}>Os avisos aparecem porque o instalador ainda não tem assinatura digital. Isso muda antes da versão comercial.</p>

      <h2 style={h2}>3. Conecte o computador</h2>
      <ol>
        <li>Depois de instalar, a janela <strong>Filamap Agent · Configuração inicial</strong> abre no canto da tela.</li>
        <li>Clique em <strong>Abrir o Filamap para pegar o código</strong>, toque em <strong>Conectar computador</strong> e digite o código na janela do Agent. O código vale 10 minutos.</li>
        <li>Digite o <strong>Access Code</strong> da impressora e clique em <strong>CONECTAR E FINALIZAR</strong>.</li>
        <li>Aparece o aviso <strong>"Pronto! Este computador está conectado"</strong>. A partir daí o Agent trabalha escondido.</li>
      </ol>
      <div style={box}>
        Fechou a janela sem querer? Abra o atalho <strong>Filamap</strong> na Área de Trabalho. Se o código ou o Access Code estiver errado, o Agent avisa e pede de novo.
      </div>

      <h2 style={h2} id="access-code">Onde achar o Access Code</h2>
      <p>Na tela da impressora, toque no ícone de <strong>configurações</strong> e siga o caminho do seu modelo:</p>
      <div style={box}>
        <strong>A1 e A1 mini</strong>
        <ol style={{ margin: "6px 0 0" }}>
          <li>Configurações › <strong>Account</strong> (Conta).</li>
          <li>Ligue <strong>LAN Only Mode</strong>: o Access Code só aparece com ele ligado.</li>
          <li>Anote o código e <strong>desligue o LAN Only Mode de novo</strong> (o código continua valendo e a nuvem da Bambu volta a funcionar).</li>
        </ol>
      </div>
      <div style={box}>
        <strong>P1P e P1S</strong>
        <div>Configurações › <strong>WLAN</strong>. O Access Code fica no fim da tela.</div>
      </div>
      <div style={box}>
        <strong>X1 Carbon, X1E e H2</strong>
        <div>Configurações › aba <strong>General</strong> › <strong>Access Code</strong>.</div>
      </div>
      <p style={muted}>
        Se o código aparecer só com zeros, atualize pelo ícone ao lado ou ligue e desligue o LAN Only Mode. O código tem 8 caracteres.
        Fonte: <a href="https://help.octoeverywhere.com/knowledge-base/bambu-lab-3-d-printers/bambu-lab-find-3d-printer-access-code" style={link} target="_blank" rel="noreferrer">OctoEverywhere</a> e{" "}
        <a href="https://wiki.bambulab.com/en/knowledge-sharing/access-code-connect" style={link} target="_blank" rel="noreferrer">Bambu Lab Wiki</a>.
      </p>

      <h2 style={h2}>4. Seus filamentos</h2>
      <p>O que acontece sozinho e o que é com você:</p>
      <ul>
        <li><strong>Sozinho:</strong> o Agent lê os perfis de filamento do seu Bambu Studio e o material e a cor de cada slot do AMS.</li>
        <li><strong>Sozinho:</strong> se você usa o gerenciador de filamentos do Bambu Studio, esses carretéis chegam na <strong>📥 caixa de entrada</strong>.</li>
        <li><strong>Com você:</strong> aceitar os carretéis da caixa de entrada, ou cadastrar em <strong>➕ Novo Carretel</strong> (marca, material, cor, peso e preço). O peso do carretel vazio é descontado automaticamente.</li>
        <li><strong>Com você:</strong> em cada slot do AMS, tocar em <strong>📋 Escolher do estoque</strong> e dizer qual carretel está ali. Com tags NFC, basta aproximar o celular.</li>
      </ul>

      <h2 style={h2}>5. Imprima</h2>
      <p>Imprima normalmente, pelo Bambu Studio ou pelo app da Bambu. O desconto acontece quando a impressão termina; se você cancelar no meio, o Filamap desconta só o que foi usado. Para a primeira vez, faça uma peça pequena e confira o peso do carretel.</p>

      <h2 style={h2}>Se algo der errado</h2>
      <ul>
        <li><strong>O código expirou:</strong> toque em Conectar computador de novo.</li>
        <li><strong>O Agent não achou a impressora:</strong> confira se o computador e a impressora estão na mesma rede Wi-Fi.</li>
        <li><strong>A impressão não descontou:</strong> não reimprima para testar; me avise com o horário.</li>
        <li><strong>Qualquer outra coisa:</strong> toque em <strong>🛟 Suporte</strong> no Filamap ou escreva para <a href="mailto:rprado3d@gmail.com" style={link}>rprado3d@gmail.com</a>.</li>
      </ul>
      <p>Anote tudo que te confundiu, mesmo o que você conseguiu resolver: é o que mais ajuda no piloto.</p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div style={page}>
      <Top />
      <h1 style={h1}>Aviso de Privacidade do Piloto</h1>
      <p style={muted}>Versão {TERMS_VERSION}. Não substitui a Política de Privacidade completa, que será publicada antes da versão comercial.</p>
      <p>Durante o piloto, o Filamap coleta alguns dados técnicos para encontrar e corrigir problemas sem precisar pedir prints ou acesso ao seu computador. Este aviso explica o que é coletado e o que não é.</p>

      <h2 style={h2}>O que coletamos</h2>
      <p><strong>Para o app funcionar</strong> (é o próprio serviço):</p>
      <ul>
        <li>seu e-mail de login;</li>
        <li>seus carretéis, pesos, preços, localização dos carretéis e histórico de impressões;</li>
        <li>dados da impressora: número de série, status, bandejas do AMS e progresso da impressão;</li>
        <li>os perfis de filamento do seu Bambu Studio e os carretéis da sua conta Bambu, só para identificar qual filamento está em cada slot.</li>
      </ul>
      <p><strong>Para diagnóstico técnico</strong> (a Central de Observabilidade):</p>
      <ul>
        <li>eventos como: o Agent iniciou, a impressora conectou ou desconectou, uma impressão começou ou terminou, uma finalização falhou e foi reenviada, e erros do programa;</li>
        <li>a versão do Agent e do app;</li>
        <li>um identificador aleatório da instalação, que não revela quem você é nem qual computador você usa;</li>
        <li>uma impressão digital curta (hash) do nome do computador, usada só para saber se a mesma instalação aparece em duas máquinas. O nome em si não é enviado.</li>
      </ul>

      <h2 style={h2}>O que NÃO coletamos</h2>
      <ul>
        <li>sua senha do Filamap ou da Bambu;</li>
        <li>o Access Code da impressora;</li>
        <li>tokens de sessão, cookies ou chaves;</li>
        <li>arquivos de impressão, modelos 3D ou fotos;</li>
        <li>endereço IP ou localização geográfica, na Central de Observabilidade.</li>
      </ul>
      <p>Antes de sair do seu computador, todo texto técnico passa por uma limpeza automática que remove senhas, códigos, tokens, e-mails, endereços IP e o seu nome de usuário do Windows.</p>

      <h2 style={h2}>Para que usamos</h2>
      <p>Só para fazer o Filamap funcionar e para diagnosticar e corrigir falhas durante o piloto. Não vendemos, não compartilhamos e não usamos os dados para publicidade.</p>

      <h2 style={h2}>Quem acessa</h2>
      <p>Apenas o responsável pelo Filamap (Ricardo), para suporte. Os dados ficam no Supabase (provedor de banco de dados), protegidos por regras que impedem um usuário de ver os dados de outro.</p>

      <h2 style={h2}>Por quanto tempo</h2>
      <ul>
        <li><strong>Eventos técnicos:</strong> 30 dias, depois são apagados automaticamente.</li>
        <li><strong>Dados do app</strong> (carretéis, histórico): enquanto você usar o Filamap. Ao final do piloto, você pode pedir a exclusão.</li>
      </ul>

      <h2 style={h2}>Seus direitos</h2>
      <p>Você pode, a qualquer momento, pedir uma cópia dos seus dados, pedir a correção ou a exclusão deles, e desligar os eventos técnicos no seu computador (colocando <code>"telemetry": false</code> no arquivo de configuração do Agent). O app continua funcionando, mas o suporte fica mais difícil.</p>
      <p>Para qualquer pedido: <a href="mailto:rprado3d@gmail.com" style={link}>rprado3d@gmail.com</a>.</p>
      <p>Ao criar sua conta no piloto, você concorda com este aviso.</p>
    </div>
  );
}

export function publicPageFor(pathname: string): "guia" | "privacidade" | null {
  const p = pathname.replace(/\/+$/, "").toLowerCase();
  if (p === "/guia") return "guia";
  if (p === "/privacidade") return "privacidade";
  return null;
}
