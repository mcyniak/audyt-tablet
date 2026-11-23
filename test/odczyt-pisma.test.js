// Kreski z rysika -> pola ilości wniosku (bez Claude; sam odczyt wymaga klucza).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { przypiszKreski, podpisPisma } from '../public/src/odczyt-pisma.js';
import { pozycjeWniosku } from '../public/src/wniosek.js';

const WYS = 842;
// Dwa pola ilości jedno pod drugim (linie bazowe 600 i 582 od dołu) i pole tekstowe.
const pola = [
  { id: 'ekipa', rodzaj: 'tekst', strona: 0, x: 230, y: 700, w: 150 },
  { id: 'falownik', rodzaj: 'ilosc', etykieta: 'Falownik', jednostka: 'szt.', strona: 0, x: 434, y: 600, w: 80 },
  { id: 'modul', rodzaj: 'ilosc', etykieta: 'Moduł', jednostka: 'szt.', strona: 0, x: 434, y: 582, w: 80 }
];
// Kreska: cyfra wysoka na ~10 pt nad linią bazową (y od góry strony).
const cyfra = (x, linia) => ({ kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: [[x, WYS - linia - 10, 0.5], [x + 3, WYS - linia, 0.5]] });

test('kreski trafiają do pola, na którego linii leżą', () => {
  const kreski = [[
    cyfra(440, 600), cyfra(446, 600), // "12" w Falowniku
    cyfra(450, 582),                  // Moduł
    cyfra(300, 700),                  // przy polu tekstowym - nie ilość
    cyfra(100, 300)                   // podpis gdzieś niżej
  ]];
  const p = przypiszKreski(pola, kreski, [WYS]);
  assert.deepEqual([...p.keys()].sort(), ['falownik', 'modul']);
  assert.equal(p.get('falownik').length, 2);
  assert.equal(p.get('modul').length, 1);
  // Pismo bez zmian = ten sam podpis (bez ponownego odczytu), inne = inny.
  assert.equal(podpisPisma(p), podpisPisma(przypiszKreski(pola, structuredClone(kreski), [WYS])));
  assert.notEqual(podpisPisma(p), podpisPisma(przypiszKreski(pola, [kreski[0].slice(1)], [WYS])));
  assert.equal(przypiszKreski(pola, [[]], [WYS]).size, 0);
});

test('niepewny odczyt -> „Do sprawdzenia” w tabeli', () => {
  const wiersze = pozycjeWniosku({ pola, wartosci: { falownik: '1', modul: '7' }, niepewne: ['modul'], adres: 'Testowa 1', rodzaj: 'PV' });
  assert.deepEqual(wiersze.map(w => [w.Pozycja, w['Ilość'], w['Do sprawdzenia']]), [['Falownik', 1, ''], ['Moduł', 7, 'tak']]);
});
