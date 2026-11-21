// cloudflared giả lập cho kiểm thử: in các dòng giống cloudflared thật, ghi lại token nhận được
const fs = require('fs');
if (process.env.FAKE_CF_OUT) fs.writeFileSync(process.env.FAKE_CF_OUT, JSON.stringify({ token: process.env.TUNNEL_TOKEN, args: process.argv.slice(2) }));
console.error('2026-11-21T06:00:00Z INF Starting tunnel tunnelID=00000000-0000-0000-0000-000000000000');
if (process.env.TUNNEL_TOKEN === 'eyJsai') { console.error('2026-11-21T06:00:01Z ERR Provided Tunnel token is not valid.'); process.exit(1); }
setTimeout(() => console.error('2026-11-21T06:00:01Z INF Registered tunnel connection connIndex=0 location=sin01 protocol=quic'), 300);
setInterval(() => {}, 1000);
