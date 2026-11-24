// Wniosek materiałowy: pola ze wzoru, zapis do arkusza, stan do edycji w PDF.
// Wzór przykładowy (wzory/) jest fikcyjny i leży w repozytorium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fontkit from '@pdf-lib/fontkit';
import { tekstSzablonu } from '../public/src/wypelnianie.js';
import { zbudujPdf } from '../public/src/eksport.js';
import { rozpoznajWzor, wybierzWzor, wzorWniosku } from '../public/src/wzory.js';
import { polaWzoru, wartosciPoczatkowe, pozycjeWniosku, zalacznikiStanu, stanZPdf } from '../public/src/wniosek.js';
import { ZRODLO } from '../public/src/tabela-materialowa.js';

const WZOR = new URL('../wzory/Wniosek materiałowy PV - przykład.pdf', import.meta.url);
const WZOR_PC = new URL('../wzory/Wniosek materiałowy PC - przykład.pdf', import.meta.url);
const CZCIONKA = new URL('../public/vendor/DejaVuSansCondensed.ttf', import.meta.url);

const otworz = bajty => pdfjs.getDocument({ data: new Uint8Array(bajty), verbosity: 0 }).promise;

test('wzór wniosku nie jest brany za wzór audytu; wzór dla rodzaju instalacji', () => {
  assert.deepEqual(rozpoznajWzor('Wniosek materiałowy PV.pdf'), { typ: 'wniosek', rodzaj: null, instalacja: 'pv_me' });
  assert.equal(rozpoznajWzor('WNIOSKI MATERIALOWE - PC.pdf').instalacja, 'pompy');
  assert.equal(rozpoznajWzor('PV.pdf').typ, 'pv_me');
  const wzory = [{ nazwa: 'PV.pdf' }, { nazwa: 'Wniosek materiałowy PV.pdf' }, { nazwa: 'Wniosek materiałowy PC.pdf' }, { nazwa: 'PC powietrzne.pdf' }];
  assert.equal(wybierzWzor(wzory, 'pv_me').nazwa, 'PV.pdf');
  assert.equal(wybierzWzor(wzory, 'pompy', 'powietrze').nazwa, 'PC powietrzne.pdf');
  assert.equal(wzorWniosku(wzory, 'pv_me').nazwa, 'Wniosek materiałowy PV.pdf');
  assert.equal(wzorWniosku(wzory, 'pompy').nazwa, 'Wniosek materiałowy PC.pdf');
  assert.equal(wzorWniosku(wzory, 'solary'), null);
  assert.equal(wzorWniosku([{ nazwa: 'Wniosek materiałowy.pdf' }], 'solary').nazwa, 'Wniosek materiałowy.pdf');
});

test('pola z przykładowego wzoru: nagłówek i pozycje z jednostką', async () => {
  const strony = await tekstSzablonu(await otworz(fs.readFileSync(WZOR)));
  const pola = polaWzoru(strony);
  assert.deepEqual(pola.slice(0, 4).map(p => [p.etykieta, p.rodzaj]), [
    ['Inwestycja', 'inwestycja'], ['Adres', 'adres'], ['Data', 'data'], ['Ekipa', 'tekst']
  ]);
  const pozycje = pola.filter(p => p.rodzaj === 'ilosc');
  assert.equal(pozycje.length, 19);
  assert.deepEqual([pozycje[0].etykieta, pozycje[0].jednostka, pozycje[0].kolumna], ['Moduł fotowoltaiczny 450 W', 'szt.', 'Moduł fotowoltaiczny 450 W [szt.]']);
  assert.deepEqual([pozycje[3].etykieta, pozycje[3].jednostka], ['Magazyn energii', 'kpl.']);
  assert.deepEqual([pozycje[18].etykieta, pozycje[18].jednostka], ['Korytko kablowe', 'm']);
  // Sekcje tabeli z wierszy wielkimi literami; tytuł wzoru nie jest sekcją.
  assert.deepEqual([pozycje[0].sekcja, pozycje[4].sekcja, pozycje[18].sekcja], ['MODUŁY I FALOWNIK', 'KONSTRUKCJA', 'ELEKTRYKA']);
  assert.ok(pola.slice(0, 4).every(p => p.sekcja === ''));
  // Pole ilości leży w kolumnie "Ilość" (x ≈ 434), a nie przy nazwie.
  assert.ok(Math.abs(pozycje[0].x - 433.9) < 1 && pozycje[0].w > 70);
  // Pole w jednym kawałku z etykietą ("Adres: ____") zaczyna się za etykietą.
  const adres = pola.find(p => p.rodzaj === 'adres');
  assert.ok(adres.x > 70 && adres.x < 90, `x pola adresu: ${adres.x}`);
  assert.equal(new Set(pola.map(p => p.id)).size, pola.length);
});

test('pola: dwa w jednej linii, jednostka za polem, powtórzone nazwy, bez Lp', () => {
  const strony = [{
    szer: 595, wys: 842,
    elementy: [
      { tekst: 'Data: ______   Kierowca: ________', x: 40, y: 800, w: 200, h: 10 },
      { tekst: '1.', x: 40, y: 700, w: 8, h: 10 },
      { tekst: 'Śruba M8', x: 60, y: 700, w: 40, h: 10 },
      { tekst: '________', x: 300, y: 700, w: 50, h: 10 },
      { tekst: 'szt.', x: 355, y: 700, w: 15, h: 10 },
      { tekst: 'Śruba M8 ________ szt.', x: 60, y: 680, w: 120, h: 10 },
      { tekst: 'Moduł PV ________', x: 60, y: 300, w: 90, h: 10 }
    ]
  }];
  const pola = polaWzoru(strony);
  assert.deepEqual(pola.map(p => [p.etykieta, p.jednostka, p.rodzaj, p.kolumna]), [
    ['Data', '', 'data', 'Data'],
    ['Kierowca', '', 'tekst', 'Kierowca'],
    ['Śruba M8', 'szt.', 'ilosc', 'Śruba M8 [szt.]'],
    ['Śruba M8', 'szt.', 'ilosc', 'Śruba M8 [szt.] (2)'],
    ['Moduł PV', '', 'ilosc', 'Moduł PV']
  ]);
  assert.ok(pola[1].x > pola[0].x + pola[0].w);
  assert.ok(pola.every(p => p.sekcja === ''));
  assert.deepEqual(wartosciPoczatkowe(pola, { adres: 'Testowo 1', data: '23.11.2026' }), { data: '23.11.2026' });
});

test('wzór PC: inne pozycje, te same zasady', async () => {
  const pola = polaWzoru(await tekstSzablonu(await otworz(fs.readFileSync(WZOR_PC))));
  const pozycje = pola.filter(p => p.rodzaj === 'ilosc');
  assert.equal(pozycje.length, 15);
  assert.deepEqual([pozycje[0].kolumna, pozycje[0].sekcja], ['Pompa ciepła powietrzna 8 kW [szt.]', 'POMPA CIEPŁA I ZASOBNIKI']);
});

test('pozycje wniosku do tabeli materiałowej: wiersz na wpisaną ilość, z adresem', () => {
  const pola = [
    { id: 'inwestycja', kolumna: 'Inwestycja', etykieta: 'Inwestycja', rodzaj: 'inwestycja' },
    { id: 'adres', kolumna: 'Adres', etykieta: 'Adres', rodzaj: 'adres' },
    { id: 'data', kolumna: 'Data', etykieta: 'Data', rodzaj: 'data' },
    { id: 'ekipa', kolumna: 'Ekipa', etykieta: 'Ekipa', rodzaj: 'tekst' },
    { id: 'kierowca', kolumna: 'Kierowca', etykieta: 'Kierowca', rodzaj: 'tekst' },
    { id: 'falownik szt', kolumna: 'Falownik [szt.]', etykieta: 'Falownik', jednostka: 'szt.', sekcja: 'MODUŁY', rodzaj: 'ilosc' },
    { id: 'kabel m', kolumna: 'Kabel [m]', etykieta: 'Kabel', jednostka: 'm', sekcja: 'ELEKTRYKA', rodzaj: 'ilosc' },
    { id: 'hak szt', kolumna: 'Hak [szt.]', etykieta: 'Hak', jednostka: 'szt.', sekcja: 'KONSTRUKCJA', rodzaj: 'ilosc' }
  ];
  const wiersze = pozycjeWniosku({
    pola,
    wartosci: { inwestycja: 'Testowo', adres: 'Testowa 1', data: '23.11.2026', ekipa: 'Ekipa 2', kierowca: 'Jan', 'falownik szt': '1', 'kabel m': '35,5', 'hak szt': ' ' },
    adres: 'Testowa 1', rodzaj: 'PV', link: 'https://example.com/p', zapisano: '2026-11-23T10:00:00',
    rozpoczeto: '2026-11-22T08:30:00', zatwierdzono: '2026-11-23T10:00:00'
  });
  assert.equal(wiersze.length, 2);
  assert.deepEqual(wiersze[1], {
    Adres: 'Testowa 1', Rodzaj: 'PV', 'Źródło': ZRODLO.wniosek, Data: '23.11.2026', Ekipa: 'Ekipa 2', Kierowca: 'Jan',
    Sekcja: 'ELEKTRYKA', Pozycja: 'Kabel', 'Jedn.': 'm', 'Ilość': 35.5,
    Status: 'Zatwierdzony', 'Rozpoczęto': '22.11.2026 08:30', Zatwierdzono: '23.11.2026 10:00', 'Do sprawdzenia': '', Plik: 'https://example.com/p', Zapisano: '23.11.2026 10:00'
  });
});

test('PDF wniosku niesie stan do edycji (wartości, kreski, czysty wzór)', async () => {
  const wzor = fs.readFileSync(WZOR);
  const stan = { adres: 'Testowo 12', wartosci: { 'falownik szt': '2' }, kreski: [[{ kolor: '#111111', rozmiar: 1.6, rysik: true, punkty: [[100, 100, 0.5], [120, 110, 0.5]] }]], zatwierdzono: null };
  const bajty = await zbudujPdf({
    szablon: wzor,
    czcionka: fs.readFileSync(CZCIONKA),
    fontkit,
    teksty: [{ strona: 0, x: 436, y: 620.6, tekst: '2', rozmiar: 10 }, { strona: 0, x: 400, y: 810, tekst: 'ZATWIERDZONO', rozmiar: 9, kolor: '#c62828' }],
    kreski: stan.kreski,
    zalaczniki: zalacznikiStanu(stan, wzor)
  });
  const odczyt = await stanZPdf(await otworz(bajty));
  assert.deepEqual(odczyt.stan, { wersja: 1, ...stan });
  assert.equal(odczyt.wzor.length, wzor.length);
  // Czysty wzór z załącznika daje te same pola co oryginał.
  const pola = polaWzoru(await tekstSzablonu(await otworz(odczyt.wzor)));
  assert.equal(pola.filter(p => p.rodzaj === 'ilosc').length, 19);
  assert.equal(await stanZPdf(await otworz(wzor)), null);
});

test('wiersz wniosku bez pola Data we wzorze dostaje datę rozpoczęcia', () => {
  const pola = [{ id: 'kabel m', kolumna: 'Kabel [m]', etykieta: 'Kabel', jednostka: 'm', rodzaj: 'ilosc' }];
  const [w] = pozycjeWniosku({ pola, wartosci: { 'kabel m': '12' }, adres: 'Testowa 1', rodzaj: 'PC', zapisano: '2026-11-24T09:00:00', rozpoczeto: '2026-11-20T07:15:00' });
  assert.equal(w.Data, '20.11.2026');
  assert.equal(w.Status, 'W trakcie');
  assert.equal(w['Rozpoczęto'], '20.11.2026 07:15');
  assert.equal(w.Zatwierdzono, '');
});
