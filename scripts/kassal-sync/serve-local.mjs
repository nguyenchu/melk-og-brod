// Liten lokal statisk server for products.json under utvikling (CORS på, så
// både Expo web og native/emulator kan hente den). Ikke ment for produksjon.
//   node scripts/kassal-sync/serve-local.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(process.argv[2] ?? join(here, 'out', 'products.json'));
const PORT = Number(process.env.PORT ?? 8089);

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = await readFile(FILE);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} → 200 (${body.length}B)`);
  } catch {
    res.statusCode = 404;
    res.end('{"error":"products.json mangler – kjør npm run sync"}');
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} → 404`);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Serverer ${FILE}`);
  console.log(`→ http://localhost:${PORT}/products.json  (LAN: http://192.168.0.7:${PORT}/products.json)`);
});
