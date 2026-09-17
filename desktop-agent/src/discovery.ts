import dgram from "node:dgram";

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const TIMEOUT_MS = 5000;

console.log("?? [Diagnóstico] Enviando busca UDP Multicast na porta 1900...");

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
let found = false;

socket.on("error", (err) => {
  console.error("? Erro no socket:", err.message);
  socket.close();
});

socket.on("message", (msg, rinfo) => {
  const text = msg.toString();
  if (text.includes("bambu") || text.includes("Bambu")) {
    found = true;
    console.log(`\n? Impressora detectada em ${rinfo.address}:${rinfo.port}`);
    
    const lines = text.split("\r\n");
    for (const line of lines) {
      if (line.toLowerCase().startsWith("usn:") || 
          line.toLowerCase().includes("devmodel") || 
          line.toLowerCase().includes("devname")) {
        console.log(`   ${line}`);
      }
    }
  }
});

socket.bind(0, () => {
  const searchMessage = 
    "M-SEARCH * HTTP/1.1\r\n" +
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
    'MAN: "ssdp:discover"\r\n' +
    "MX: 3\r\n" +
    "ST: ssdp:all\r\n\r\n";

  socket.send(searchMessage, 0, searchMessage.length, SSDP_PORT, SSDP_ADDRESS);
});

setTimeout(() => {
  socket.close();
  if (!found) {
    console.log("\n??  Nenhuma resposta UDP recebida.");
    console.log("?? DICA COMERCIAL / PLANO B:");
    console.log("   Muitos roteadores bloqueiam multicast UDP entre 2.4GHz e 5GHz.");
    console.log("   No app real, se a busca automática falhar, oferecemos o campo: 'Digitar IP manual'.");
  }
  process.exit(0);
}, TIMEOUT_MS);
