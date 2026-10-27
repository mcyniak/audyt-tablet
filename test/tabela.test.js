// Testy rozpoznawania arkuszy i scalania adresów. Część na danych
// syntetycznych (zawsze), część na prawdziwych tabelach montażowych z listy
// w test/lokalne.json (pomijane, jeśli listy albo pliku nie ma).
// Wszystkie nazwiska, adresy i UID-y poniżej są fikcyjne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { rozpoznajTypArkusza, kluczAdresu, zbudujListeAdresow } from '../public/src/tabela.js';
import { zArkuszyGoogle } from '../public/src/google.js';
import { lokalne } from './lokalne.js';

function wczytaj(sciezka) {
  if (!fs.existsSync(sciezka)) return null;
  const wb = XLSX.read(fs.readFileSync(sciezka));
  return wb.SheetNames.map(nazwa => ({
    nazwa,
    wiersze: XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, defval: null, blankrows: false })
  }));
}

test('rozpoznaje nazwy arkuszy widziane w realnych tabelach', () => {
  const oczekiwane = {
    'MIASTO - PC': 'pompy',
    'pompy ciepła ': 'pompy',
    'pompy ciepła audyt': 'pompy',
    'PC Gmina': 'pompy',
    'MIASTO - SOLARY': 'solary',
    'Kolektory słoneczne': 'solary',
    'PV_ME': 'pv_me',
    'MIASTO PV_': 'pv_me',
    'PV_': 'pv_me',
    'Kotły': 'kotly',
    'KOTŁY NA BIOMASĘ': 'kotly',
    'tabela do protokołu odbioru pom': null,
    'tabela do protokołu odbioru PV': null,
    'ekipy': null,
    'ekipy+ moce i l. modułó': null,
    'UMOWA': null,
    'Unikalne Adresy': null,
    'Ab3dEf6hIj9kLm2nOp5q': null,
    'Zz8yXw7vUt6sRq5pOn4m': null
  };
  for (const [nazwa, typ] of Object.entries(oczekiwane)) {
    assert.equal(rozpoznajTypArkusza(nazwa), typ, nazwa);
  }
});

test('ten sam adres zapisany na różne sposoby daje ten sam klucz', () => {
  assert.equal(kluczAdresu('ul. Pogodna 31, Przykładowo'), kluczAdresu('Przykładowo, ul. Pogodna 31'));
  assert.equal(kluczAdresu('Wola Testowa 1A'), kluczAdresu('Wola Testowa, 1A'));
  assert.equal(kluczAdresu('Przykładowo 13 a'), kluczAdresu('Przykładowo 13A'));
  assert.equal(kluczAdresu('ŁĄKOWO UL. POŁUDNIOWA 26'), kluczAdresu('Łąkowo, ul. Południowa 26'));
  assert.notEqual(kluczAdresu('Przykładowo 13 a'), kluczAdresu('Przykładowo 13b'));
  assert.notEqual(kluczAdresu('Testowo 1'), kluczAdresu('Testowo 1A'));
});

test('scala adresy z kilku arkuszy i oznacza typy', () => {
  const wynik = zbudujListeAdresow([
    { nazwa: 'PV_ME', wiersze: [['LP', 'UID', 'Imię i Nazwisko', 'Adres', 'REZYGNACJA (T/N)'], [1, 'abcdefgh12', 'Jan Przykładowy', 'Testowo 1', null], [2, 'x', 'Anna Testowa', 'Wzorowo 5', 'TAK']] },
    { nazwa: 'pompy ciepła', wiersze: [['LP', 'Imię i Nazwisko', 'Adres'], [], [7, 'Jan Przykładowy', 'TESTOWO 1']] },
    { nazwa: 'ekipy', wiersze: [['Adres'], ['nie liczyć']] }
  ]);
  assert.equal(wynik.razem, 2);
  assert.deepEqual(wynik.liczniki, { kotly: 0, solary: 0, pv_me: 2, pompy: 1 });
  const testowo = wynik.adresy.find(a => a.adres === 'Testowo 1');
  assert.deepEqual(testowo.typy, ['pv_me', 'pompy']);
  assert.equal(testowo.nazwisko, 'Jan Przykładowy');
  assert.equal(wynik.adresy.find(a => a.adres === 'Wzorowo 5').rezygnacja, true);
});

test('ten sam UID pod różnymi adresami NIE scala adresów', () => {
  const wynik = zbudujListeAdresow([
    { nazwa: 'PV_', wiersze: [['UID', 'Adres'], ['Qw3rTy6uIo9pAs2dFg5h', 'Przykładowo 13 a'], ['Qw3rTy6uIo9pAs2dFg5h', 'Przykładowo 13b']] }
  ]);
  assert.equal(wynik.razem, 2);
});

test('ten sam UID w różnych arkuszach scala literówki i pokazuje warianty', () => {
  const wynik = zbudujListeAdresow([
    { nazwa: 'PV_ME', wiersze: [['UID', 'Adres'], ['abcdefgh12', 'UL. FREDRY 21, TESTOWO']] },
    { nazwa: 'pompy', wiersze: [['UID', 'Adres'], ['abcdefgh12', 'UL. FREDY 21, TESTOWO']] }
  ]);
  assert.equal(wynik.razem, 1);
  assert.deepEqual(wynik.adresy[0].warianty, ['UL. FREDRY 21, TESTOWO', 'UL. FREDY 21, TESTOWO']);
});

test('na główny adres wybierany jest zapis z numerem domu, nie z numerem działki', () => {
  const wynik = zbudujListeAdresow([
    { nazwa: 'pompy', wiersze: [['UID', 'Adres'], ['abcdefgh12', 'Wzorowo dz. Ewid. 31/2']] },
    { nazwa: 'PV_ME', wiersze: [['UID', 'Adres'], ['abcdefgh12', 'Wzorowo 22D']] }
  ]);
  assert.equal(wynik.adresy[0].adres, 'Wzorowo 22D');
});

test('znacznik „ŻŻŻ” przed adresem i przecinek na końcu nie są częścią adresu', () => {
  const wynik = zbudujListeAdresow([
    { nazwa: 'PV_ME', wiersze: [['Adres'], ['Testowo 67,']] },
    { nazwa: 'MIASTO - PC', wiersze: [['Adres'], ['ŻŻŻ Testowo 67']] }
  ]);
  assert.equal(wynik.razem, 1);
  assert.equal(wynik.adresy[0].adres, 'Testowo 67');
});

test('ręczne przypisanie arkusza nadpisuje rozpoznanie', () => {
  const arkusze = [{ nazwa: 'Arkusz1', wiersze: [['Adres'], ['Testowo 6A']] }, { nazwa: 'PV_ME', wiersze: [['Adres'], ['Testowo 7']] }];
  const wynik = zbudujListeAdresow(arkusze, { Arkusz1: 'kotly', PV_ME: null });
  assert.equal(wynik.razem, 1);
  assert.deepEqual(wynik.adresy[0].typy, ['kotly']);
});

test('dane z Google Sheets (poszarpane wiersze, puste arkusze) dają tę samą listę', () => {
  // Sheets API pomija puste komórki na końcu wiersza, pusty wiersz w środku
  // zwraca jako [], a dla pustego arkusza w ogóle nie ma "values".
  const arkusze = zArkuszyGoogle(['PV_ME', 'ekipy', 'pompy ciepła'], [
    { range: "'PV_ME'!A1:Z100", values: [['LP', 'Imię i Nazwisko', 'Adres', 'Nr telefonu'], [], [1, 'Jan Przykładowy', 'Testowo 1', 500100200], [2, 'Anna Testowa', 'Wzorowo 5']] },
    { range: "'ekipy'!A1:Z100" },
    { range: "'pompy ciepła'!A1:Z100", values: [['LP', 'Adres'], [1, 'TESTOWO 1']] }
  ]);
  const wynik = zbudujListeAdresow(arkusze);
  assert.equal(wynik.razem, 2);
  assert.deepEqual(wynik.adresy.find(a => a.adres === 'Testowo 1').typy, ['pv_me', 'pompy']);
  assert.equal(wynik.adresy.find(a => a.adres === 'Testowo 1').telefon, '500 100 200');
  assert.equal(wynik.adresy.find(a => a.adres === 'Wzorowo 5').telefon, '');
});

test('arkusz bez kolumny Adres zgłasza błąd zamiast cicho liczyć 0', () => {
  const wynik = zbudujListeAdresow([{ nazwa: 'PV_ME', wiersze: [['LP', 'Nazwisko'], [1, 'X']] }]);
  assert.match(wynik.arkusze[0].blad, /Adres/);
});

for (const { plik, arkusze: arkuszeOczekiwane, razem } of lokalne.tabele) {
  test(`realna tabela: ${path.basename(plik)}`, t => {
    const arkusze = wczytaj(plik);
    if (!arkusze) return t.skip('brak pliku');
    const wynik = zbudujListeAdresow(arkusze);
    const rozpoznane = Object.fromEntries(wynik.arkusze.filter(a => a.typ).map(a => [a.nazwa, a.typ]));
    assert.deepEqual(rozpoznane, arkuszeOczekiwane);
    assert.ok(wynik.arkusze.every(a => !a.blad), 'żaden arkusz bez błędu nagłówka');
    if (razem !== undefined) assert.equal(wynik.razem, razem);
    assert.ok(wynik.adresy.every(a => a.adres && a.typy.length > 0));
  });
}
