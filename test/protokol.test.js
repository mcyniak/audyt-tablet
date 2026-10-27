// Auto-wpisy w szablon protokołu i budowa gotowego PDF. Testy na prawdziwych
// szablonach (lista w test/lokalne.json) są pomijane, gdy ich nie ma.
// Dane osobowe poniżej są fikcyjne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fontkit from '@pdf-lib/fontkit';
import { wyliczWpisy, tekstSzablonu } from '../public/src/wypelnianie.js';
import { zbudujPdf } from '../public/src/eksport.js';
import { rozdzielKontakt } from '../public/src/tabela.js';
import { lokalne } from './lokalne.js';

const DANE = { imie: 'Jan i Anna Przykładowi', adres: 'Testowo 210', telefon: '+48 500 100 200', email: 'jan@example.com', data: new Date(2026, 9, 27) };

async function wczytajSzablon(sciezka) {
  if (!sciezka || !fs.existsSync(sciezka)) return null;
  const bajty = fs.readFileSync(sciezka);
  const dokument = await pdfjs.getDocument({ data: new Uint8Array(bajty), verbosity: 0 }).promise;
  return { bajty, strony: await tekstSzablonu(dokument) };
}

test('telefon i e-mail z jednej komórki są rozdzielane', () => {
  assert.deepEqual(rozdzielKontakt('48500100200 / jan.przykladowy@example.com'), { telefon: '+48 500 100 200', email: 'jan.przykladowy@example.com' });
  assert.deepEqual(rozdzielKontakt(500100200), { telefon: '500 100 200', email: '' });
  assert.deepEqual(rozdzielKontakt('500 100 200, 600 700 800 tu dzwonić'), { telefon: '500 100 200, 600 700 800 tu dzwonić', email: '' });
});

// Syntetyczny układ jak w "Protokole uzgodnień montażowych" - działa bez prawdziwego szablonu.
test('auto-wpisy znajdują etykiety w tekście strony', () => {
  const strony = [{
    szer: 595, wys: 842,
    elementy: [
      { tekst: 'SPORZĄDZONY DNIA:', x: 184, y: 777, w: 114, h: 11 },
      { tekst: '………….', x: 301, y: 777, w: 34, h: 8 },
      { tekst: '………….', x: 338, y: 777, w: 34, h: 8 },
      { tekst: '/202', x: 372, y: 777, w: 19.5, h: 11 },
      { tekst: '……', x: 391.6, y: 777, w: 16, h: 8 },
      { tekst: 'Imię i Nazwisko Uczestnika projektu/ Właściciela:', x: 41, y: 756, w: 203, h: 10 },
      { tekst: '……………………………………………', x: 247, y: 756, w: 304, h: 7 },
      { tekst: 'Telefon:', x: 41, y: 731, w: 34, h: 10 },
      { tekst: '………………………………,', x: 78, y: 731, w: 190, h: 7 },
      { tekst: 'Termin na wykonanie wszystkich wytycznych przez Użytkownika instalacji: ……/……/202…. r.', x: 36, y: 400, w: 500, h: 11 },
      { tekst: 'DATA: ………… / ………… / 202…… r.', x: 36, y: 373, w: 189, h: 11 }
    ]
  }];
  const wpisy = wyliczWpisy(strony, DANE).map(w => w.tekst);
  assert.deepEqual(wpisy, ['27', '10', '6', DANE.imie, DANE.telefon, '27', '10', '6']);
});

for (const sciezka of lokalne.szablony) {
  test(`auto-wpisy trafiają we wszystkie pola: ${path.basename(sciezka)}`, async t => {
    const szablon = await wczytajSzablon(sciezka);
    if (!szablon) return t.skip('brak szablonu');
    const wpisy = wyliczWpisy(szablon.strony, DANE);
    const naStronie = n => wpisy.filter(w => w.strona === n - 1).map(w => w.tekst);

    // Strona 1: data (dzień, miesiąc, końcówka roku po "202"), dane właściciela.
    assert.deepEqual(naStronie(1), ['27', '10', '6', DANE.imie, DANE.adres, DANE.telefon, DANE.email]);
    // Strona 5: data oświadczenia.
    assert.deepEqual(naStronie(5), ['27', '10', '6']);
    // Strona 6: "w dniu", adres, Pan/Pani, DATA - ale NIE "Termin na wykonanie".
    assert.deepEqual(naStronie(6), ['27', '10', '6', DANE.adres, DANE.imie, '27', '10', '6']);

    // Imię i nazwisko na stronie 1 zaczyna się tuż za etykietą, na tej samej linii.
    const imie = wpisy.find(w => w.strona === 0 && w.tekst === DANE.imie);
    assert.ok(imie.x > 245 && imie.x < 255 && Math.abs(imie.y - 758) < 2, JSON.stringify(imie));
  });
}

test('gotowy PDF zawiera wpisane dane i pismo, a strony szablonu zostają', async t => {
  const szablon = await wczytajSzablon(lokalne.szablony[0]);
  if (!szablon) return t.skip('brak szablonu');
  const kreska = { kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: [[100, 100, 0.5], [140, 110, 0.6], [180, 100, 0.5]] };
  const bajty = await zbudujPdf({
    szablon: szablon.bajty,
    czcionka: fs.readFileSync(new URL('../public/vendor/DejaVuSansCondensed.ttf', import.meta.url)),
    fontkit,
    teksty: wyliczWpisy(szablon.strony, DANE),
    kreski: [[kreska]]
  });
  const wynik = await pdfjs.getDocument({ data: bajty, verbosity: 0 }).promise;
  assert.equal(wynik.numPages, szablon.strony.length);
  const tekst = (await (await wynik.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  assert.ok(tekst.includes(DANE.imie));
  const operatory = await (await wynik.getPage(1)).getOperatorList();
  assert.ok(operatory.fnArray.includes(pdfjs.OPS.fill), 'pismo zapisane jako wypełniona ścieżka');
});
