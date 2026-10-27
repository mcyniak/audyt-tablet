// Kopiuje biblioteki z node_modules do public/vendor - aplikacja nie ładuje
// nic z CDN, bo w terenie musi działać offline. Uruchom po `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const katalog = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLIKI = [
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'public/vendor/xlsx.full.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'public/vendor/pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/vendor/pdf.worker.min.mjs'],
  ['node_modules/pdf-lib/dist/pdf-lib.esm.min.js', 'public/vendor/pdf-lib.esm.min.js'],
  // UMD, bo wersja ES importuje "pako" jako pakiet (nie działa bez bundlera).
  ['node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'public/vendor/fontkit.umd.min.js'],
  ['node_modules/perfect-freehand/dist/esm/index.mjs', 'public/vendor/perfect-freehand.mjs'],
  // Czcionka z polskimi znakami do wpisywania danych w PDF (licencja DejaVu - wolna).
  ['node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf', 'public/vendor/DejaVuSansCondensed.ttf']
];

fs.mkdirSync(path.join(katalog, 'public/vendor'), { recursive: true });
for (const [z, doCelu] of PLIKI) {
  fs.copyFileSync(path.join(katalog, z), path.join(katalog, doCelu));
  console.log(`skopiowano ${doCelu}`);
}
