// Pytania audytu PV -> kolumny tabeli montażowej. Dane zmyślone; na końcu
// sprawdzenie na prawdziwych tabelach z test/lokalne.json (jeśli są).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { PYTANIA_PV, kolumnyPytan, klasyfikuj, pisownia, odpowiedziZWiersza, znajdzWiersz, kolumnaA1, zmianyWiersza } from '../public/src/ankieta.js';
import { znajdzNaglowek } from '../public/src/tabela.js';
import { lokalne } from './lokalne.js';

const P = Object.fromEntries(PYTANIA_PV.map(p => [p.id, p]));

const NAGLOWEK = ['LP', 'REZYGNACJA (T/N)', 'UID', 'Imię i Nazwisko', 'Adres', 'miejsce montażu PV z Gminy', 'Miejsce montażu PV',
  'Miejsce montażu magazynu energii', 'czy trzeba zwiększyć moc umowną', 'Czy jest prywatna instalacja PV', 'Pokrycie dachowe',
  'Czy trzeba zmniejszyć moc instalacji PV', 'Czy trzeba usunąć magazyn energii'];

const arkusz = () => [
  NAGLOWEK,
  [1, '', 'U1', 'Jan Przykładowy', 'Przykładowo 1', 'Dach', 'mieszkalny', 'garaż', 'nie', 'nie', 'Dachówka', 'nie', ''],
  [2, '', 'U2', 'Anna Testowa', 'Przykładowo 2', 'Grunt', 'grunt', 'kotłownia', 'tak', 'nie', 'blacha trapezowa', 'nie', ''],
  [3, '', 'U3', 'Ewa Zmyślona', 'ul. Polna 7, Testowo', 'Dach', 'mieszkalny', '', '', '', 'Inne; eternit', '', ''],
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
  assert.deepEqual(klasyfikuj(P.miejscePv, 'Dach budynku gospodarczego'), { opcja: 'gospodarczy', dopisek: '' });
  assert.deepEqual(klasyfikuj(P.pokrycie, 'Blachodachówka'), { opcja: 'blachodachowka', dopisek: '' });
  assert.deepEqual(klasyfikuj(P.pokrycie, 'styropapa'), { opcja: 'styropapa', dopisek: '' });
  assert.deepEqual(klasyfikuj(P.pokrycie, 'Inne; Blacha falista'), { opcja: 'inne', dopisek: 'Blacha falista' });
  assert.deepEqual(klasyfikuj(P.magazyn, 'inne pomieszczenie gospodarcze'), { opcja: 'gospodarcze', dopisek: '' });
  assert.deepEqual(klasyfikuj(P.zwiekszycMoc, true), { opcja: 'tak', dopisek: '' });
  assert.equal(klasyfikuj(P.zwiekszycMoc, 'może'), null);
  assert.equal(klasyfikuj(P.pokrycie, '  '), null);
});

test('pisownia jak w tabeli, domyślnie etykieta; pole wyboru -> true/false', () => {
  const kolumna = ['mieszkalny', 'mieszkalny', 'Dach budynku mieszkalnego', 'grunt'];
  assert.equal(pisownia(P.miejscePv, { opcja: 'mieszkalny' }, kolumna), 'mieszkalny');
  assert.equal(pisownia(P.miejscePv, { opcja: 'gospodarczy' }, kolumna), 'Dach budynku gospodarczego');
  assert.equal(pisownia(P.miejscePv, { opcja: 'inne', dopisek: 'na wiacie' }, ['Inny']), 'Inny; na wiacie');
  assert.equal(pisownia(P.zwiekszycMoc, { opcja: 'tak' }, ['nie', 'tak', 'tak']), 'tak');
  assert.equal(pisownia(P.zwiekszycMoc, { opcja: 'nie' }, [true, false, '']), false);
  assert.equal(pisownia(P.rezygnacja, { opcja: 'tak' }, ['T', 'T', 'tak']), 'T');
});

test('odpowiedzi z wiersza tabeli', () => {
  assert.deepEqual(odpowiedziZWiersza(arkusz(), 3), {
    miejscePv: { opcja: 'grunt', dopisek: '' },
    magazyn: { opcja: 'kotlownia', dopisek: '' },
    zwiekszycMoc: { opcja: 'tak', dopisek: '' },
    prywatnaPv: { opcja: 'nie', dopisek: '' },
    pokrycie: { opcja: 'trapezowa', dopisek: '' },
    zmniejszycMoc: { opcja: 'nie', dopisek: '' }
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
      miejscePv: { opcja: 'mieszkalny' },
      magazyn: { opcja: 'garaz' },
      pokrycie: { opcja: 'inne', dopisek: 'eternit' },
      zwiekszycMoc: { opcja: 'nie' },
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

  // Ta sama odpowiedź (inną pisownią) już jest - bez zmian.
  const bezZmian = zmianyWiersza({ arkusz: 'PV', wiersze: arkusz(), nrWiersza: 4, odpowiedzi: { pokrycie: { opcja: 'inne', dopisek: 'eternit' }, miejscePv: { opcja: 'mieszkalny' } } });
  assert.deepEqual(bezZmian.dane, []);

  const stara = [['LP', 'Adres', 'Pokrycie dachowe'], [1, 'Przykładowo 1', '']];
  const wynik = zmianyWiersza({ arkusz: 'PV', wiersze: stara, nrWiersza: 2, odpowiedzi: { pokrycie: { opcja: 'gont' }, zwiekszycMoc: { opcja: 'tak' } } });
  assert.deepEqual(wynik.dane, [{ range: "'PV'!C2", values: [['Gont']] }]);
  assert.deepEqual(wynik.brak, ['Czy trzeba zwiększyć moc umowną?']);
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
