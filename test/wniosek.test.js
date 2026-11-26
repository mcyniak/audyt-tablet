// Materiałówka: pola z PDF zestawu, wiersze do arkusza „Materiałówka”, daty
// w tabeli montażowej, stan do edycji w PDF. Zestaw jest fikcyjny - budowany
// w teście (układ jak zestawy z biura: l.p. / Nazwa / Materiał / ilość).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { tekstSzablonu } from '../public/src/wypelnianie.js';
import { zbudujPdf } from '../public/src/eksport.js';
import {
  polaZestawu, wartosciPoczatkowe, iloscKoncowa, recznaIlosc, wierszeMaterialowki, zmianyMaterialowki, arkuszMaterialowki,
  datyWMontazowej, datyZMontazowej, wyczyscWydanie, czyDataKomorki, ekipaZMontazowej, dataZKomorki, podpowiedzZestawu, zalacznikiStanu, stanZPdf
} from '../public/src/wniosek.js';
import { przypiszKreski } from '../public/src/odczyt-pisma.js';

const CZCIONKA = new URL('../public/vendor/DejaVuSansCondensed.ttf', import.meta.url);
const otworz = bajty => pdfjs.getDocument({ data: new Uint8Array(bajty), verbosity: 0 }).promise;

// Zestaw na 2 strony: nagłówek, tabela, ciąg dalszy bez nagłówka, podpis.
async function zestaw() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const t = (s, x, y, tekst) => s.drawText(tekst, { x, y, size: 7, font: f });
  const s1 = doc.addPage([595, 842]);
  t(s1, 52, 762, 'Ekipa:'); t(s1, 367, 762, 'Data');
  t(s1, 52, 719, 'Adres montazu'); t(s1, 404, 723, 'Set dla PC TEST'); t(s1, 420, 714, 'VPM9012');
  t(s1, 65, 693, 'l.p.'); t(s1, 88, 693, 'Nazwa'); t(s1, 362, 693, 'Material');
  const wiersze = [
    ['', 'Sterownik bezprzewodowy', '', '1'],
    ['1', 'Zawor przelaczajacy DN32', 'Armatura', '1'],
    ['2', 'Beton 25kg', 'Inne', '5'],
    ['3', 'Bufor 400 l', '', ''],
    ['4', 'Glikol propylenowy', 'Inne', '80 l'],
    ['5', 'Kolano pp 32 2k', 'PP', '20']
  ];
  let y = 683;
  for (const [lp, nazwa, mat, il] of wiersze) {
    if (lp) t(s1, 67, y, lp);
    t(s1, 88, y, nazwa);
    if (mat) t(s1, 360, y, mat);
    if (il) t(s1, 433, y, il);
    y -= 9.5;
  }
  const s2 = doc.addPage([595, 842]);
  t(s2, 67, 780, '6'); t(s2, 88, 780, 'Redukcja 5/4 x 1'); t(s2, 358, 780, 'Stal czarna'); t(s2, 433, 780, '6');
  // pozycja w trzech liniach (nazwa zawinięta, l.p. i materiał w środkowej)
  t(s2, 88, 770.5, 'Zestaw regulacyjny 3-drogowy');
  t(s2, 66, 765.5, '7'); t(s2, 360, 765.5, 'Armatura');
  t(s2, 88, 760.5, 'z silownikiem');
  t(s2, 67, 751, '8'); t(s2, 88, 751, 'Kabel YDY 5x2,5'); t(s2, 360, 751, 'Elektryka');
  t(s2, 52, 722, 'Podpis instalatora'); t(s2, 110, 722, '..........................');
  return doc.save();
}

// Drugi układ (zestawy PV): ADRES/Data/Ekipa w jednej linii, kolumny „jedn.”
// i pusta „Ile pozostało [szt.]”, tytuły grup bez jednostki, zawinięta nazwa,
// jednostka 3 pt niżej niż nazwa, ciąg dalszy na 2. stronie.
async function zestawJednostkowy() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const t = (s, x, y, tekst) => s.drawText(tekst, { x, y, size: 9, font: f });
  const s1 = doc.addPage([595, 842]);
  t(s1, 20, 776, 'ADRES'); t(s1, 360, 776, 'Data'); t(s1, 473, 776, 'Ekipa');
  t(s1, 20, 734, 'MODULY FOTOWOLTAICZNE'); t(s1, 360, 734, 'jedn.'); t(s1, 443, 733, 'Ile pozostalo [szt.]');
  t(s1, 20, 720, 'Modul testowy 450W'); t(s1, 364, 719, 'szt');
  t(s1, 20, 704, 'FALOWNIKI');
  t(s1, 20, 690, 'Falownik 5K'); t(s1, 364, 690, 'szt');
  t(s1, 20, 676, 'Stycznik modulowy 4P 40A'); t(s1, 364, 676, 'szt');
  t(s1, 20, 663.6, 'PRODUCENT TESTOWY');
  t(s1, 20, 651, 'Kable');
  t(s1, 20, 637, 'Kabel solarny 4mm2'); t(s1, 363, 634, 'mb');
  const s2 = doc.addPage([595, 842]);
  t(s2, 20, 778, 'Kabel YKY 5x6'); t(s2, 363, 778, 'mb');
  return doc.save();
}

test('pola zestawu w układzie z „jedn.”: pozycje z jednostką, kolumna „Ile pozostało”, nagłówek w jednej linii', async () => {
  const pola = polaZestawu(await tekstSzablonu(await otworz(await zestawJednostkowy())));
  const pozycje = pola.filter(p => p.rodzaj === 'ilosc');
  assert.deepEqual(pozycje.map(p => [p.etykieta, p.material, p.strona]), [
    ['Modul testowy 450W', 'szt', 0],
    ['Falownik 5K', 'szt', 0],
    ['Stycznik modulowy 4P 40A PRODUCENT TESTOWY', 'szt', 0],
    ['Kabel solarny 4mm2', 'mb', 0],
    ['Kabel YKY 5x6', 'mb', 1]
  ]);
  assert.ok(pozycje.every(p => !p.wydrukowano && p.x > 380 && p.x < 443 && p.x + p.w > 526));
  assert.notEqual(pozycje[0].sekcja, pozycje[1].sekcja);
  const naglowek = Object.fromEntries(pola.filter(p => p.rodzaj !== 'ilosc').map(p => [p.id, [Math.round(p.x), Math.round(p.x + p.w)]]));
  assert.ok(naglowek.adres[1] <= 350 && naglowek.data[0] > 360 && naglowek.data[1] <= 463 && naglowek.ekipa[0] > 473);
});

test('pola zestawu: nagłówek, pozycje z wydrukowaną ilością, ciąg dalszy na 2. stronie', async () => {
  const pola = polaZestawu(await tekstSzablonu(await otworz(await zestaw())));
  const naglowek = pola.filter(p => p.rodzaj !== 'ilosc');
  assert.deepEqual(naglowek.map(p => [p.id, p.rodzaj, p.strona]), [['ekipa', 'tekst', 0], ['data', 'data', 0], ['adres', 'adres', 0]]);
  const poz = pola.filter(p => p.rodzaj === 'ilosc');
  assert.deepEqual(poz.map(p => [p.lp, p.etykieta, p.material, p.wydrukowano, p.strona]), [
    ['', 'Sterownik bezprzewodowy', '', '1', 0],
    ['1', 'Zawor przelaczajacy DN32', 'Armatura', '1', 0],
    ['2', 'Beton 25kg', 'Inne', '5', 0],
    ['3', 'Bufor 400 l', '', '', 0],
    ['4', 'Glikol propylenowy', 'Inne', '80 l', 0],
    ['5', 'Kolano pp 32 2k', 'PP', '20', 0],
    ['6', 'Redukcja 5/4 x 1', 'Stal czarna', '6', 1],
    ['7', 'Zestaw regulacyjny 3-drogowy z silownikiem', 'Armatura', '', 1],
    ['8', 'Kabel YDY 5x2,5', 'Elektryka', '', 1]
  ]);
  // Kolumna ilości obejmuje wydrukowane liczby, nie wchodzi na kolumnę Materiał.
  for (const p of poz) {
    assert.ok(p.x <= 433 && p.x + p.w >= 440, `${p.etykieta}: ${p.x}..${p.x + p.w}`);
    assert.ok(p.x > 390, `${p.etykieta}: kolumna zaczyna się na Materiale (${p.x})`);
  }
  // Środek wiersza (wys - y - 5 od góry) wypada na linii pozycji.
  const beton = poz.find(p => p.lp === '2');
  assert.ok(Math.abs((842 - beton.y - 5) - (842 - 664 - 3)) < 1.5);
});

test('kreska w kolumnie ilości trafia do swojego wiersza (wiersze co 9,5 pt)', async () => {
  const pola = polaZestawu(await tekstSzablonu(await otworz(await zestaw())));
  const beton = pola.find(p => p.lp === '2');
  const bufor = pola.find(p => p.lp === '3');
  const yGora = 842 - 664 - 3; // środek wiersza „Beton” od góry strony
  const kreska = (x, y) => ({ punkty: [[x, y - 2, 0.5], [x + 3, y + 2, 0.5]] });
  const przypisane = przypiszKreski(pola, [[kreska(440, yGora), kreska(440, yGora + 9.5)], []], [842, 842]);
  assert.equal(przypisane.get(beton.id).length, 1);
  assert.equal(przypisane.get(bufor.id).length, 1);
});

test('wartości początkowe: adres i data', () => {
  const pola = [{ id: 'ekipa', rodzaj: 'tekst' }, { id: 'data', rodzaj: 'data' }, { id: 'adres', rodzaj: 'adres' }];
  assert.deepEqual(wartosciPoczatkowe(pola, { adres: 'Testowo 12', data: '24.11.2026' }), { data: '24.11.2026', adres: 'Testowo 12' });
});

test('wiersze Materiałówki: wydruk bez pisma, poprawka rysikiem, skreślenie do zera, niepewne', () => {
  const pola = [
    { id: 'p1', rodzaj: 'ilosc', etykieta: 'Beton 25kg', wydrukowano: '5' },
    { id: 'p2', rodzaj: 'ilosc', etykieta: 'Kolano', wydrukowano: '20' },
    { id: 'p3', rodzaj: 'ilosc', etykieta: 'Bufor', wydrukowano: '' },
    { id: 'p4', rodzaj: 'ilosc', etykieta: 'Glikol', wydrukowano: '80 l' },
    { id: 'p5', rodzaj: 'ilosc', etykieta: 'Kabel', wydrukowano: '' },
    { id: 'ekipa', rodzaj: 'tekst', etykieta: 'Ekipa' }
  ];
  const odczyt = { wartosci: { p2: '18', p3: '1', p4: '0' }, niepewne: ['p3'] };
  assert.equal(iloscKoncowa(pola[0], odczyt), '5');
  assert.equal(iloscKoncowa(pola[1], odczyt), '18');
  const w = wierszeMaterialowki({ pola, odczyt, adres: 'Testowo 12', zestaw: 'set 9012', zapisano: '2026-11-24T09:05:00', zatwierdzono: null });
  assert.deepEqual(w.map(r => [r.towar, r.liczba, r['do sprawdzenia']]), [['Beton 25kg', 5, ''], ['Kolano', 18, ''], ['Bufor', 1, 'tak']]);
  assert.deepEqual(wierszeMaterialowki({ pola, odczyt, adres: 'Testowo 12', ekipa: ' Flexi Nowak ' }).map(r => r.ekipa), ['Flexi Nowak', 'Flexi Nowak', 'Flexi Nowak']);
  assert.deepEqual(w[0], { adres: 'Testowo 12', towar: 'Beton 25kg', liczba: 5, zestaw: 'set 9012', ekipa: '', 'data zapisania': '24.11.2026 09:05', 'data zatwierdzenia': '', 'do sprawdzenia': '' });
});

test('ilość z klawiatury ma pierwszeństwo; pozycje dopisane spoza zestawu', () => {
  const pola = [
    { id: 'p1', rodzaj: 'ilosc', etykieta: 'Beton 25kg', wydrukowano: '5' },
    { id: 'p2', rodzaj: 'ilosc', etykieta: 'Kolano', wydrukowano: '20' },
    { id: 'p3', rodzaj: 'ilosc', etykieta: 'Bufor', wydrukowano: '' }
  ];
  const odczyt = { wartosci: { p2: '18' }, niepewne: ['p2'] };
  const reczne = { p1: ' 6 ', p2: '19', ekipa: 'E1' };
  assert.equal(recznaIlosc(pola[0], reczne), '6');
  assert.equal(iloscKoncowa(pola[1], odczyt, reczne), '19');
  assert.equal(iloscKoncowa(pola[2], odczyt, reczne), '');
  const w = wierszeMaterialowki({ pola, odczyt, reczne, dodatkowe: [{ nazwa: 'Kabel 3x2,5', ilosc: '15' }, { nazwa: 'Taśma', ilosc: '0' }], adres: 'Testowo 12', zestaw: 'set 9012', zapisano: '2026-11-24T09:05:00' });
  assert.deepEqual(w.map(r => [r.towar, r.liczba, r.zestaw, r['do sprawdzenia']]), [
    ['Beton 25kg', 6, 'set 9012', ''],
    ['Kolano', 19, 'set 9012', ''], // wpisane ręcznie - już nie „do sprawdzenia”
    ['Kabel 3x2,5', 15, 'set 9012 – dopisane', '']
  ]);
});

test('Materiałówka: wiersze adresu zastępowane, brakujące kolumny dopisane do nagłówka', () => {
  const wiersze = [
    ['adres', 'towar', 'liczba'],
    ['Testowo 12', 'Beton', 4],
    ['Inna 1', 'Beton', 2],
    ['ul. Testowo 12', 'Kolano', 10]
  ];
  const z = zmianyMaterialowki({ arkusz: 'PC', wiersze, adres: 'Testowo 12', nowe: [{ adres: 'Testowo 12', towar: 'Beton', liczba: 5, 'data zapisania': '24.11.2026 09:05' }] });
  assert.deepEqual(z.doUsuniecia, [1, 3]);
  assert.deepEqual(z.dane.map(d => d.range), ["'PC'!D1", "'PC'!E1", "'PC'!F1", "'PC'!G1", "'PC'!H1"]);
  assert.equal(z.dane[1].values[0][0], 'ekipa');
  assert.equal(z.dane[2].values[0][0], 'data zapisania');
  assert.deepEqual(z.dopisz, { wiersz: 5, wartosci: [['Testowo 12', 'Beton', 5, '', '', '24.11.2026 09:05', '', '']] });
  assert.equal(z.szerokosc, 8);
  // Pusty arkusz - cały nagłówek od A1.
  assert.equal(zmianyMaterialowki({ arkusz: 'PV', wiersze: [], adres: 'X 1', nowe: [] }).dane[0].range, "'PV'!A1");
});

test('zakładka Materiałówki dla rodzaju instalacji', () => {
  assert.equal(arkuszMaterialowki(['PC', 'PV'], 'PV'), 'PV');
  assert.equal(arkuszMaterialowki(['pc'], 'PC'), 'pc');
  assert.equal(arkuszMaterialowki(['Wszystko'], 'PC'), 'Wszystko');
  assert.equal(arkuszMaterialowki(['PC', 'Inne'], 'PV'), null);
});

const MONTAZ = [
  ['LP', 'Imię i Nazwisko', 'Adres', 'POMPA', 'data wydania materiału', 'Data zakończenia montażu'],
  [1, 'Jan Przykładowy', 'Testowo 12', 'VPM9012', '', ''],
  [2, 'Anna Testowa', 'Testowo 14', 'VPM9020', 46350, 46351]
];

test('tabela montażowa: data zapisu do „wydania”, zatwierdzenia do „zakończenia” (nigdy nie czyszczona)', () => {
  const zapis = datyWMontazowej({ arkusz: 'pompy ciepła audyt', wiersze: MONTAZ, nrWiersza: 2, zapisano: '2026-11-24T09:05:00', zatwierdzono: null });
  assert.deepEqual(zapis, { dane: [{ range: "'pompy ciepła audyt'!E2", values: [['2026-11-24']] }], brak: [], poprzednia: '' });
  const zatw = datyWMontazowej({ arkusz: 'PV_ME', wiersze: MONTAZ, nrWiersza: 2, zapisano: '2026-11-25T10:00:00', zatwierdzono: '2026-11-25T10:00:00' });
  assert.deepEqual(zatw.dane.map(d => [d.range, d.values[0][0]]), [["'PV_ME'!E2", '2026-11-25'], ["'PV_ME'!F2", '2026-11-25']]);
  const bezKolumn = datyWMontazowej({ arkusz: 'X', wiersze: [['Adres', 'Uwagi'], ['Testowo 12']], nrWiersza: 2, zapisano: '2026-11-24T09:05:00', zatwierdzono: '2026-11-24T09:05:00' });
  assert.equal(bezKolumn.dane.length, 0);
  assert.equal(bezKolumn.brak.length, 2);
});

test('stan materiałówki z tabeli montażowej; data z liczby seryjnej', () => {
  assert.deepEqual(datyZMontazowej(MONTAZ, 2), { wydano: '', zakonczono: '', maKolumneZatwierdzenia: true });
  assert.deepEqual(datyZMontazowej(MONTAZ, 3), { wydano: '46350', zakonczono: '46351', maKolumneZatwierdzenia: true });
  assert.equal(datyZMontazowej([['Adres'], ['X']], 2).maKolumneZatwierdzenia, false);
  assert.equal(dataZKomorki(46350), '24.11.2026');
  assert.equal(dataZKomorki('24.11.2026'), '24.11.2026');
});

test('usunięcie materiałówki czyści datę wydania; ekipa z kolumny „Ekipa”', () => {
  assert.deepEqual(wyczyscWydanie({ arkusz: 'PC', wiersze: MONTAZ, nrWiersza: 3 }), { dane: [{ range: "'PC'!E3", values: [['']] }], kolumna: 4, wartosc: '' });
  assert.deepEqual(wyczyscWydanie({ arkusz: 'PC', wiersze: MONTAZ, nrWiersza: 2 }).dane, []);
  const zEkipa = [['Adres', 'Ekipa montażowa'], ['Testowo 12', ' Ekipa 3 ']];
  assert.equal(ekipaZMontazowej(zEkipa, 2), 'Ekipa 3');
  assert.equal(ekipaZMontazowej(MONTAZ, 2), '');
});

test('ekipa pomp: „Ekipa…” ma pierwszeństwo, pusta → „monter”; bez uwag, maila i #N/A', () => {
  const nag = ['Adres', 'monter', '"Ekipa W PRZYPADKU BRAKU EKIPY PROSZĘ WYPEŁNIĆ FORMULARZ', 'UWAGI EKIPY INSTALATORSKIEJ', 'email ekipa'];
  const pompy = [nag,
    ['Testowo 1', 'Flexi Nowak', 'F Kowalski', 'uwaga', 'a@b.pl'],
    ['Testowo 2', 'Flexi Nowak', '', 'uwaga', 'a@b.pl'],
    ['Testowo 3', '', '#N/A', 'uwaga', '#N/A (Did not find value)']];
  assert.equal(ekipaZMontazowej(pompy, 2), 'F Kowalski');
  assert.equal(ekipaZMontazowej(pompy, 3), 'Flexi Nowak');
  assert.equal(ekipaZMontazowej(pompy, 4), '');
});

test('wpis biura w kolumnie wydania (nie data) zostaje; usunięcie przywraca planowaną datę', () => {
  const zBiurem = [MONTAZ[0], [1, 'Jan', 'Testowo 12', '', 14, ''], [2, 'Anna', 'Testowo 14', '', 46356, '']];
  assert.ok(czyDataKomorki(46350) && czyDataKomorki('25.11.2026') && czyDataKomorki('2026-11-25'));
  assert.ok(!czyDataKomorki(14) && !czyDataKomorki('14') && !czyDataKomorki('') && !czyDataKomorki('wydano'));
  const zapis = datyWMontazowej({ arkusz: 'PV', wiersze: zBiurem, nrWiersza: 2, zapisano: '2026-11-25T10:00:00', zatwierdzono: null });
  assert.equal(zapis.dane.length, 0);
  assert.match(zapis.brak[0], /„14”/);
  assert.equal(datyZMontazowej(zBiurem, 2).wydano, '');
  assert.deepEqual(wyczyscWydanie({ arkusz: 'PV', wiersze: zBiurem, nrWiersza: 2 }).dane, []);
  // planowana data biura nadpisana datą wydania, po usunięciu wraca
  const poZapisie = [MONTAZ[0], zBiurem[1], [2, 'Anna', 'Testowo 14', '', 46351, '']];
  assert.deepEqual(wyczyscWydanie({ arkusz: 'PV', wiersze: poZapisie, nrWiersza: 3, poprzednia: 46356 }).dane, [{ range: "'PV'!E3", values: [[46356]] }]);
});

test('podpowiedź zestawu z numeru pompy w tabeli montażowej', () => {
  const zestawy = [{ id: 'a', nazwa: 'set 9008.pdf' }, { id: 'b', nazwa: 'set 9012.pdf' }, { id: 'c', nazwa: 'set 9020.pdf' }];
  assert.equal(podpowiedzZestawu(zestawy, [MONTAZ[1]]).id, 'b');
  assert.equal(podpowiedzZestawu(zestawy, [['Testowo 1', '509012345']]), null); // numer w telefonie się nie liczy
  assert.equal(podpowiedzZestawu(zestawy, [['VPM9008 / VPM9012']]), null); // niejednoznaczne
  assert.equal(podpowiedzZestawu(zestawy, [['', 'dobrać moc']]), null);
});

test('PDF materiałówki niesie stan do edycji (wartości, kreski, czysty zestaw)', async () => {
  const wzor = await zestaw();
  const stan = { adres: 'Testowo 12', zestaw: 'set 9012.pdf', wartosci: { ekipa: 'E1' }, kreski: [[{ kolor: '#111111', rozmiar: 1.6, rysik: true, punkty: [[100, 100, 0.5], [120, 110, 0.5]] }]], zatwierdzono: null };
  const bajty = await zbudujPdf({
    szablon: wzor,
    czcionka: fs.readFileSync(CZCIONKA),
    fontkit,
    teksty: [{ strona: 0, x: 80, y: 762, tekst: 'E1', rozmiar: 10 }],
    kreski: stan.kreski,
    zalaczniki: zalacznikiStanu(stan, wzor)
  });
  const odczyt = await stanZPdf(await otworz(bajty));
  assert.deepEqual(odczyt.stan, { wersja: 2, ...stan });
  assert.equal(odczyt.wzor.length, wzor.length);
  assert.equal(await stanZPdf(await otworz(wzor)), null);
});
