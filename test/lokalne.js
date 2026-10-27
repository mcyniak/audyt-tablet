// Lista prawdziwych tabel i szablonów do testów. Celowo poza repozytorium
// (test/lokalne.json jest w .gitignore) - nazwy plików i ścieżki to dane
// firmy, a repozytorium jest publiczne (GitHub Pages). Wzór pliku:
// test/lokalne.przyklad.json. Bez pliku testy na prawdziwych danych są pomijane.
import fs from 'node:fs';

const SCIEZKA = new URL('./lokalne.json', import.meta.url);

export const lokalne = fs.existsSync(SCIEZKA)
  ? JSON.parse(fs.readFileSync(SCIEZKA, 'utf8'))
  : { tabele: [], szablony: [], szablonyPv: [] };
