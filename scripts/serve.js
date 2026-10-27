// Lokalny serwer do testów (bez zależności). Domyślnie tylko ten komputer:
//   npm start                    -> http://localhost:5173
// Test na tablecie w tej samej sieci Wi-Fi:
//   set AUDYT_HOST=0.0.0.0 && npm start
// (przez zwykłe http na adresie IP Chrome nie włączy trybu offline ani
// instalacji - to zadziała dopiero po wystawieniu na https).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const HOST = process.env.AUDYT_HOST || '127.0.0.1';
const PORT = Number(process.env.AUDYT_PORT || 5173);
const TYPY = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf'
};

http.createServer((req, res) => {
  const sciezka = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const plik = path.normalize(path.join(KATALOG, sciezka.endsWith('/') ? sciezka + 'index.html' : sciezka));
  if (!plik.startsWith(KATALOG + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(plik, (blad, dane) => {
    if (blad) { res.writeHead(404).end('Nie znaleziono'); return; }
    res.writeHead(200, { 'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dane);
  });
}).listen(PORT, HOST, () => console.log(`Audyt: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
