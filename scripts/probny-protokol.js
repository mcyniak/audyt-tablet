// Narzędzie deweloperskie: wypełnia szablon przykładowymi danymi i zapisuje
// PDF, żeby sprawdzić, czy auto-wpisy trafiają w kropki.
//   node scripts/probny-protokol.js "<szablon.pdf>" "<wynik.pdf>"
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fontkit from '@pdf-lib/fontkit';
import { wyliczWpisy, tekstSzablonu } from '../public/src/wypelnianie.js';
import { zbudujPdf } from '../public/src/eksport.js';

const [szablonSciezka, wynikSciezka] = process.argv.slice(2);
if (!szablonSciezka || !wynikSciezka) {
  console.error('Użycie: node scripts/probny-protokol.js <szablon.pdf> <wynik.pdf>');
  process.exit(1);
}

const szablon = fs.readFileSync(szablonSciezka);
const dokument = await pdfjs.getDocument({ data: new Uint8Array(szablon), verbosity: 0 }).promise;
const teksty = wyliczWpisy(await tekstSzablonu(dokument), {
  imie: 'Jan i Anna Przykładowi',
  adres: 'Testowo 210, 00-000 Przykładowo',
  telefon: '+48 500 100 200',
  email: 'jan@example.com',
  data: new Date('2026-10-27')
});
for (const t of teksty) console.log(`str. ${t.strona + 1}  x=${t.x.toFixed(1)} y=${t.y.toFixed(1)}  ${t.tekst}`);

// Przykładowe "pismo": zygzak w polu "Rok budowy" i krzyżyk w pierwszym checkboksie.
const kreski = [[
  { kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: Array.from({ length: 30 }, (_, i) => [190 + i * 2.5, 343 + Math.sin(i / 2) * 3, 0.4 + i / 60]) },
  { kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: [[37, 210, 0.5], [45, 218, 0.6]] },
  { kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: [[45, 210, 0.5], [37, 218, 0.6]] }
]];
const bajty = await zbudujPdf({ szablon, czcionka: fs.readFileSync(new URL('../public/vendor/DejaVuSansCondensed.ttf', import.meta.url)), fontkit, teksty, kreski, tytul: 'Protokół – próba' });
fs.writeFileSync(wynikSciezka, bajty);
console.log(`zapisano ${wynikSciezka} (${bajty.length} B)`);
