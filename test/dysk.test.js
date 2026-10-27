// Logika wokół Dysku Google, którą da się sprawdzić bez logowania:
// rozpoznanie wzorów po nazwie, inwestycje z listy folderów i tabel,
// pomijanie arkuszy-eksportów, rodzaj pompy z tabeli. Dane fikcyjne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rozpoznajWzor, wybierzWzor } from '../public/src/wzory.js';
import { polaczInwestycje } from '../public/src/google.js';
import { zbudujListeAdresow, czyEksport } from '../public/src/tabela.js';

test('wzory rozpoznawane po nazwie pliku', () => {
  assert.deepEqual(rozpoznajWzor('PC powietrzne.pdf'), { typ: 'pompy', rodzaj: 'powietrze' });
  assert.deepEqual(rozpoznajWzor('Forma do Audytów PC Gruntowe.pdf'), { typ: 'pompy', rodzaj: 'grunt' });
  assert.deepEqual(rozpoznajWzor('Protokół uzgodnień montażowych - pompa ciepła.pdf'), { typ: 'pompy', rodzaj: null });
  assert.deepEqual(rozpoznajWzor('KOLEKTORY SŁONECZNE-DO AUDYTÓW-PROTOKÓŁ UZGODNIEŃ MONTAŻOWYCH.pdf'), { typ: 'solary', rodzaj: null });
  assert.deepEqual(rozpoznajWzor('KOTŁY-DO AUDYTÓW-PROTOKÓŁ UZGODNIEŃ MONTAŻOWYCH'), { typ: 'kotly', rodzaj: null });
  assert.deepEqual(rozpoznajWzor('PV.pdf'), { typ: 'pv_me', rodzaj: null });
  assert.deepEqual(rozpoznajWzor('Fotowoltaika i ME.pdf'), { typ: 'pv_me', rodzaj: null });
  assert.equal(rozpoznajWzor('notatki.pdf').typ, null);
});

test('wzór pompy dobierany według rodzaju pompy z tabeli', () => {
  const wzory = [{ id: 'g', nazwa: 'PC gruntowe.pdf' }, { id: 'p', nazwa: 'PC powietrzne.pdf' }, { id: 'v', nazwa: 'PV.pdf' }];
  assert.equal(wybierzWzor(wzory, 'pompy', 'grunt').id, 'g');
  assert.equal(wybierzWzor(wzory, 'pompy', 'powietrze').id, 'p');
  // Nieznany rodzaj i dwa różne wzory - nie zgadujemy.
  assert.equal(wybierzWzor(wzory, 'pompy', null), null);
  // Jeden wzór PC - pasuje do każdej pompy.
  assert.equal(wybierzWzor([{ id: 'x', nazwa: 'PC.pdf' }], 'pompy', 'grunt').id, 'x');
  assert.equal(wybierzWzor(wzory, 'pv_me').id, 'v');
  assert.equal(wybierzWzor(wzory, 'kotly'), null);
});

test('inwestycja = folder z tabelą montażową bezpośrednio w środku', () => {
  const foldery = [{ id: 'f1', name: 'TESTOWO 2026 - PC' }, { id: 'f2', name: 'WZOROWO 2025 - pv' }, { id: 'f3', name: 'STARE' }];
  const tabele = [
    { id: 't1', name: 'TESTOWO 2026 - tab. montażowa PC', mimeType: 'sheet', parents: ['f1'], modifiedTime: '2026-01-01T00:00:00Z' },
    { id: 't1b', name: 'TESTOWO - tab. montażowa (stara)', mimeType: 'sheet', parents: ['f1'], modifiedTime: '2025-01-01T00:00:00Z' },
    { id: 't2', name: 'WZOROWO tab montażowa.xlsx', mimeType: 'xlsx', parents: ['f2'], modifiedTime: '2025-06-01T00:00:00Z' },
    { id: 't9', name: 'tabela montażowa w podfolderze', mimeType: 'sheet', parents: ['jakis-podfolder'], modifiedTime: '2026-01-01T00:00:00Z' }
  ];
  const wynik = polaczInwestycje(foldery, tabele);
  assert.deepEqual(wynik.map(i => [i.nazwa, i.tabela.id]), [['TESTOWO 2026 - PC', 't1'], ['WZOROWO 2025 - pv', 't2']]);
});

test('arkusz-eksport z innego systemu audytów jest pomijany mimo nazwy „Pompy Ciepła”', () => {
  const eksport = [
    ['uid', 'address', 'audit_0_auditor', 'audit_0_building_type'],
    ['UID', 'Adres nieruchomości', 'Audytor', 'Typ budynku'],
    ['Ab3dEf6hIj9kLm2nOp5q', 'Testowo 21', 'audytor@example.com', 'dom_jednorodzinny']
  ];
  assert.equal(czyEksport(eksport), true);
  const wynik = zbudujListeAdresow([
    { nazwa: 'Pompy Ciepła', wiersze: eksport },
    { nazwa: 'pompy ciepła audyt', wiersze: [['LP', 'Adres', 'rodzaj pompy'], [1, 'Wzorowo 5', 'Gruntowa'], [2, 'Wzorowo 6', 'Powietrze-woda'], [3, 'Wzorowo 7', null]] }
  ]);
  assert.equal(wynik.arkusze[0].typ, null);
  assert.equal(wynik.arkusze[0].eksport, true);
  assert.deepEqual(wynik.adresy.map(a => [a.adres, a.rodzajPompy]), [['Wzorowo 5', 'grunt'], ['Wzorowo 6', 'powietrze'], ['Wzorowo 7', null]]);
});
