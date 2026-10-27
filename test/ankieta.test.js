// Pytania audytu PV -> kolumny tabeli montażowej, odpowiedzi z kratek na
// protokole. Dane zmyślone; na końcu sprawdzenie na prawdziwych tabelach i
// wzorze z test/lokalne.json (jeśli są).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PYTANIA_PV, kolumnyPytan, klasyfikuj, pisownia, odpowiedziZWiersza, znajdzWiersz, kolumnaA1, zmianyWiersza,
  linieWzoru, pytaniaNaWzorze, odpowiedziZProtokolu
} from '../public/src/ankieta.js';
import { znajdzNaglowek } from '../public/src/tabela.js';
import { tekstSzablonu } from '../public/src/wypelnianie.js';
import { lokalne } from './lokalne.js';

const P = Object.fromEntries(PYTANIA_PV.map(p => [p.id, p]));
const odp = (...opcje) => ({ opcje, dopisek: '' });

const NAGLOWEK = ['LP', 'REZYGNACJA (T/N)', 'UID', 'Imię i Nazwisko', 'Adres', 'miejsce montażu PV z Gminy', 'Miejsce montażu PV',
  'Miejsce montażu magazynu energii', 'czy trzeba zwiększyć moc umowną', 'Czy jest prywatna instalacja PV', 'Pokrycie dachowe',
  'Czy trzeba zmniejszyć moc instalacji PV', 'Czy trzeba usunąć magazyn energii'];

const arkusz = () => [
  NAGLOWEK,
  [1, '', 'U1', 'Jan Przykładowy', 'Przykładowo 1', 'Dach', 'mieszkalny', 'garaż', 'nie', 'nie', 'Dachówka', 'nie', ''],
  [2, '', 'U2', 'Anna Testowa', 'Przykładowo 2', 'Grunt', 'grunt', 'kotłownia', 'tak', 'nie', 'blacha trapezowa', 'nie', ''],
  [3, '', 'U3', 'Ewa Zmyślona', 'ul. Polna 7, Testowo', 'Dach', 'mieszkalny, grunt', '', '', '', 'Inne; eternit', '', ''],
  [4, '', 'U4', 'Piotr Fikcyjny', 'Przykładowo 4', '', '', '', '', '', '', '', '']
];

test('kolumny: "Miejsce montażu PV", nie "… z Gminy"; rezygnacja po prefiksie', () => {
  const k = kolumnyPytan(NAGLOWEK);
  assert.equal(k.miejscePv, 6);
  assert.equal(k.magazyn, 7);
  assert.equal(k.pokrycie, 10);
  assert.equal(k.rezygnacja, 1);
  assert.equal(kolumnyPytan(['Czy istnieje instalacja fotowoltaiczna']).prywatnaPv, 0);
});

test('klasyfikacja wartości z tabeli', () => {
  assert.deepEqual(klasyfikuj(P.miejscePv, 'Dach budynku gospodarczego'), odp('gospodarczy'));
  assert.deepEqual(klasyfikuj(P.miejscePv, 'Dach budynku gospodarczego, Grunt'), odp('gospodarczy', 'grunt'));
  assert.deepEqual(klasyfikuj(P.pokrycie, 'Blachodachówka'), odp('blachodachowka'));
  assert.deepEqual(klasyfikuj(P.pokrycie, 'styropapa'), odp('styropapa'));
  assert.deepEqual(klasyfikuj(P.pokrycie, 'Inne; Blacha falista'), { opcje: ['inne'], dopisek: 'Blacha falista' });
  assert.deepEqual(klasyfikuj(P.magazyn, 'inne pomieszczenie gospodarcze'), odp('gospodarcze'));
  assert.deepEqual(klasyfikuj(P.zwiekszycMoc, true), odp('tak'));
  assert.equal(klasyfikuj(P.zwiekszycMoc, 'może'), null);
  assert.equal(klasyfikuj(P.pokrycie, '  '), null);
});

test('pisownia jak w tabeli, domyślnie etykieta; pole wyboru -> true/false', () => {
  const kolumna = ['mieszkalny', 'mieszkalny', 'Dach budynku mieszkalnego', 'grunt', 'Dach budynku gospodarczego, Grunt'];
  assert.equal(pisownia(P.miejscePv, odp('mieszkalny'), kolumna), 'mieszkalny');
  assert.equal(pisownia(P.miejscePv, odp('gospodarczy'), kolumna), 'dach budynku gospodarczego', 'komórka z dwiema opcjami nie jest wzorem pisowni; kolumna pisana małymi');
  assert.equal(pisownia(P.miejscePv, odp('grunt', 'mieszkalny'), kolumna), 'mieszkalny, grunt');
  assert.equal(pisownia(P.miejscePv, { opcje: ['inne'], dopisek: 'na wiacie' }, ['Inny']), 'Inny; na wiacie');
  assert.equal(pisownia(P.zwiekszycMoc, odp('tak'), ['nie', 'tak', 'tak']), 'tak');
  assert.equal(pisownia(P.zwiekszycMoc, odp('tak'), ['nie', 'nie', 'Nie', '']), 'tak', 'kolumna pisana małymi');
  assert.equal(pisownia(P.pokrycie, odp('gont'), ['Dachówka', 'Blachodachówka']), 'Gont');
  assert.equal(pisownia(P.zwiekszycMoc, odp('nie'), [true, false, '']), false);
  assert.equal(pisownia(P.rezygnacja, odp('tak'), ['T', 'T', 'tak']), 'T');
});

test('odpowiedzi z wiersza tabeli', () => {
  assert.deepEqual(odpowiedziZWiersza(arkusz(), 3), {
    miejscePv: odp('grunt'),
    magazyn: odp('kotlownia'),
    zwiekszycMoc: odp('tak'),
    prywatnaPv: odp('nie'),
    pokrycie: odp('trapezowa'),
    zmniejszycMoc: odp('nie')
  });
});

test('wiersz: zapamiętany numer, a po przesunięciu - po adresie i UID', () => {
  const w = arkusz();
  assert.equal(znajdzWiersz(w, { wiersz: 4, adres: 'Testowo, Polna 7', uid: 'U3' }), 4);
  w.splice(1, 0, [9, '', 'U9', 'Nowy', 'Przykładowo 9']); // biuro dopisało wiersz wyżej
  assert.equal(znajdzWiersz(w, { wiersz: 4, adres: 'ul. Polna 7, Testowo', uid: 'U3' }), 5);
  assert.equal(znajdzWiersz(w, { wiersz: 4, adres: 'ul. Polna 7, Testowo', uid: 'INNY' }), null);
  w.push([10, '', '', 'Duplikat', 'Przykładowo 1']);
  assert.equal(znajdzWiersz(w, { wiersz: 2, adres: 'Przykładowo 1', uid: '' }), null, 'dwa wiersze - nie zgadujemy');
});

test('kolumny A1', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(kolumnaA1), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('zmiany: tylko inne odpowiedzi, pisownią tabeli, brakujące kolumny osobno', () => {
  const { dane, brak } = zmianyWiersza({
    arkusz: "PV_ME 'nowe'",
    wiersze: arkusz(),
    nrWiersza: 5,
    odpowiedzi: {
      miejscePv: odp('mieszkalny'),
      magazyn: odp('garaz'),
      pokrycie: { opcje: ['inne'], dopisek: 'eternit' },
      zwiekszycMoc: odp('nie'),
      rezygnacja: null
    }
  });
  assert.deepEqual(dane, [
    { range: "'PV_ME ''nowe'''!G5", values: [['mieszkalny']] },
    { range: "'PV_ME ''nowe'''!H5", values: [['garaż']] },
    { range: "'PV_ME ''nowe'''!I5", values: [['nie']] },
    { range: "'PV_ME ''nowe'''!K5", values: [['Inne; eternit']] }
  ]);
  assert.deepEqual(brak, []);

  // Ta sama odpowiedź (inną pisownią, w innej kolejności) już jest - bez zmian.
  const bezZmian = zmianyWiersza({ arkusz: 'PV', wiersze: arkusz(), nrWiersza: 4, odpowiedzi: { pokrycie: { opcje: ['inne'], dopisek: 'eternit' }, miejscePv: odp('grunt', 'mieszkalny') } });
  assert.deepEqual(bezZmian.dane, []);

  const stara = [['LP', 'Adres', 'Pokrycie dachowe'], [1, 'Przykładowo 1', '']];
  const wynik = zmianyWiersza({ arkusz: 'PV', wiersze: stara, nrWiersza: 2, odpowiedzi: { pokrycie: odp('gont'), zwiekszycMoc: odp('tak') } });
  assert.deepEqual(wynik.dane, [{ range: "'PV'!C2", values: [['Gont']] }]);
  assert.deepEqual(wynik.brak, ['Czy trzeba zwiększyć moc umowną?']);
});

// Zmyślony fragment wzoru: kratki jako osobne kawałki tekstu (jak z Worda),
// y = linia bazowa od dołu strony 842 pt.
const el = (tekst, x, y, w = tekst.length * 5) => ({ tekst, x, y, w, h: 10 });
const WZOR = [{
  szer: 595,
  wys: 842,
  elementy: [
    el('Czy trzeba zmniejszyć moc instalacji? ', 40, 700, 170), el('☐', 212, 700, 8.6), el('NIE', 221, 700),
    el('☐', 40, 687, 8.6), el('TAK – Uzasadnienie……………', 49, 687),
    el('Czy trzeba przenieść instalacje? ', 40, 660, 140), el('☐', 182, 660, 8.6), el('NIE', 191, 660),
    el('☐', 40, 647, 8.6), el('TAK – Uzasadnienie……………', 49, 647),
    el('2. Miejsce montażu paneli PV', 40, 600, 120),
    el('☐', 40, 587, 8.6), el(' Dach budynku mieszkalnego', 49, 587),
    el('☐', 40, 574, 8.6), el(' Grunt', 49, 574),
    el('☐', 40, 561, 8.6), el(' Dach budynku gospodarczego, zastosowanie budynku: ……', 49, 561),
    el('3. Rodzaj dachu', 40, 530, 70),
    el('☐', 40, 517, 10), el('Dach dwuspadowy', 51, 517),
    el('16. Rezygnacja z udziału w projekcie/odmowa wpuszczenia audytora', 40, 215, 350),
    el('Ja niżej podpisany ……………………………………', 40, 200, 480),
    el('Rezygnuję z udziału w projekcie / Nie wyrażam zgody na przeprowadzenie wizji lokalnej', 40, 180, 360),
    el('Czytelny podpis Właściciela', 350, 150, 120)
  ]
}];

test('wzór: linie z kratkami i czystymi podpisami', () => {
  const linie = linieWzoru(WZOR);
  const pierwsza = linie.find(l => l.kratki.length && /zmniejsz/.test(l.tekst));
  assert.deepEqual(pierwsza.kratki.map(k => [k.x, k.etykieta]), [[212, 'NIE']]);
  assert.deepEqual(linie.flatMap(l => l.kratki).map(k => k.etykieta).slice(0, 7),
    ['NIE', 'TAK', 'NIE', 'TAK', 'Dach budynku mieszkalnego', 'Grunt', 'Dach budynku gospodarczego']);
});

test('wzór: kratki pytań kończą się na powtórzonej opcji albo obcym podpisie', () => {
  const mapa = pytaniaNaWzorze(WZOR);
  assert.deepEqual(mapa.zmniejszycMoc.kratki.map(k => [k.opcja, k.kratka.y]), [['nie', 700], ['tak', 687]]);
  assert.deepEqual(mapa.miejscePv.kratki.map(k => k.opcja), ['mieszkalny', 'grunt', 'gospodarczy']);
  assert.equal(mapa.pokrycie, undefined);
  assert.deepEqual(mapa.rezygnacja.obszar, { strona: 0, x0: 0, x1: 595, yDol: 142, yGora: 213 });
});

// Kreska w układzie edytora: y od góry strony.
const kreska = (...punkty) => ({ punkty: punkty.map(([x, y]) => [x, 842 - y, 0.5]) });
// "Ptaszek" w kratce o linii bazowej y: z lewej-środka w dół i w górę w prawo.
const ptaszek = (x, y) => kreska([x + 1, y + 4], [x + 3.5, y + 0.5], [x + 10, y + 10]);

test('odpowiedzi z kresek: ptaszek w kratce, pismo obok się nie liczy', () => {
  const mapa = pytaniaNaWzorze(WZOR);
  const kreski = [[
    ptaszek(40, 687), // zmniejszyć: TAK
    kreska([60, 688], [150, 690]), // uzasadnienie pisane obok kratki
    ptaszek(40, 587), ptaszek(40, 574), // dach mieszkalny i grunt
    kreska([120, 203], [200, 201], [300, 204]) // imię w linii rezygnacji
  ]];
  const { odpowiedzi, niejasne } = odpowiedziZProtokolu(mapa, kreski, WZOR);
  assert.deepEqual(odpowiedzi, { zmniejszycMoc: odp('tak'), miejscePv: odp('mieszkalny', 'grunt'), rezygnacja: odp('tak') });
  assert.deepEqual(niejasne, []);
});

test('rezygnacja: samo skreślenie "niepotrzebne skreślić" też się liczy, pismo nad sekcją nie', () => {
  const mapa = pytaniaNaWzorze(WZOR);
  const skreslenie = [[kreska([215, 183], [300, 182], [400, 184])]];
  assert.deepEqual(odpowiedziZProtokolu(mapa, skreslenie, WZOR).odpowiedzi, { rezygnacja: odp('tak') });
  const nadSekcja = [[kreska([100, 240], [300, 240])]];
  assert.deepEqual(odpowiedziZProtokolu(mapa, nadSekcja, WZOR).odpowiedzi, {});
});

test('odpowiedzi z kresek: TAK i NIE naraz to niejasne, kropka to nie zaznaczenie', () => {
  const mapa = pytaniaNaWzorze(WZOR);
  const kreski = [[ptaszek(212, 700), ptaszek(40, 687), kreska([44, 591])]];
  const { odpowiedzi, niejasne } = odpowiedziZProtokolu(mapa, kreski, WZOR);
  assert.deepEqual(odpowiedzi, {});
  assert.deepEqual(niejasne, ['zmniejszycMoc']);
});

// Na prawdziwych tabelach: odpowiedzi odczytane z wiersza i zapisane z powrotem
// nie zmieniają ani jednej komórki.
for (const { plik, arkusze } of lokalne.tabele) {
  const pv = Object.entries(arkusze).filter(([, typ]) => typ === 'pv_me').map(([n]) => n);
  if (!pv.length) continue;
  test(`prawdziwa tabela: odczyt i zapis odpowiedzi bez zmian (${pv.join(', ')})`, { skip: !fs.existsSync(plik) && 'brak pliku' }, () => {
    const wb = XLSX.read(fs.readFileSync(plik));
    for (const nazwa of pv) {
      const wiersze = XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, raw: true, defval: '' });
      const naglowek = znajdzNaglowek(wiersze);
      const kolumny = kolumnyPytan(wiersze[naglowek.wiersz]);
      assert.ok(kolumny.miejscePv !== undefined && kolumny.pokrycie !== undefined, `${nazwa}: brak podstawowych kolumn`);
      for (let nr = naglowek.wiersz + 2; nr <= wiersze.length; nr += 1) {
        const odpowiedzi = odpowiedziZWiersza(wiersze, nr);
        assert.deepEqual(zmianyWiersza({ arkusz: nazwa, wiersze, nrWiersza: nr, odpowiedzi }).dane, [], `${nazwa} wiersz ${nr}`);
      }
    }
  });
}

// Prawdziwy wzór PV: każde pytanie z kratkami ma je znalezione, a ptaszek
// w środku każdej kratki daje dokładnie tę opcję.
for (const plik of lokalne.szablonyPv || []) {
  test('prawdziwy wzór PV: kratki pytań i odczyt ptaszków', { skip: !fs.existsSync(plik) && 'brak pliku' }, async () => {
    const dokument = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(plik)), verbosity: 0 }).promise;
    const strony = await tekstSzablonu(dokument);
    const mapa = pytaniaNaWzorze(strony);
    for (const p of PYTANIA_PV.filter(x => x.naWzorze)) assert.ok(mapa[p.id]?.kratki.length >= 2, `brak kratek: ${p.pytanie}`);
    assert.ok(mapa.rezygnacja?.obszar, 'brak sekcji rezygnacji');
    // Skreślenie w linii "Rezygnuję z udziału w projekcie / Nie wyrażam zgody ..."
    const { strona: sr } = mapa.rezygnacja.obszar;
    const linia = linieWzoru(strony).find(l => l.strona === sr && /^Rezygnuj/.test(l.tekst));
    const skreslenie = strony.map(() => []);
    skreslenie[sr].push({ punkty: [[linia.x1 - 160, strony[sr].wys - (linia.y + 3), 0.5], [linia.x1, strony[sr].wys - (linia.y + 3), 0.5]] });
    assert.deepEqual(odpowiedziZProtokolu(mapa, skreslenie, strony).odpowiedzi, { rezygnacja: odp('tak') });
    for (const [id, { kratki }] of Object.entries(mapa).filter(([, m]) => m.kratki)) {
      for (const { opcja, kratka: k } of kratki) {
        const kreski = strony.map(() => []);
        const wys = strony[k.strona].wys;
        kreski[k.strona].push({ punkty: [[k.x + 1, wys - (k.y + 4), 0.5], [k.x + 3.5, wys - (k.y + 0.5), 0.5], [k.x + 10, wys - (k.y + 10), 0.5]] });
        assert.deepEqual(odpowiedziZProtokolu(mapa, kreski, strony).odpowiedzi, { [id]: odp(opcja) }, `${id}/${opcja}`);
      }
    }
  });
}
