// Pytania z audytu PV wpisywane do tabeli montażowej. Audytor wybiera
// odpowiedź przyciskiem (bez odczytywania pisma), a aplikacja wpisuje ją do
// kolumny o tej nazwie w wierszu adresu - pisownią, której dana tabela już
// używa ("mieszkalny" w jednej, "Dach budynku mieszkalnego" w innej).
import { normalizuj, znajdzNaglowek, oczyscAdres, kluczAdresu } from './tabela.js';

const TAK = { id: 'tak', etykieta: 'Tak', pasuje: n => /^(t|tak|true|1)$/.test(n) };
const NIE = { id: 'nie', etykieta: 'Nie', pasuje: n => /^(n|nie|false|0)$/.test(n) };
const TAK_NIE = [TAK, NIE];
// "Inne" z dopiskiem audytora: w tabeli "Inne; Eternit pod blachą".
const INNE = { id: 'inne', etykieta: 'Inne', pasuje: n => /^inn[ey]$/.test(n), dopisek: true };

export const PYTANIA_PV = [
  {
    id: 'miejscePv',
    pytanie: 'Miejsce montażu PV',
    kolumna: n => n === 'miejsce montazu pv',
    opcje: [
      { id: 'mieszkalny', etykieta: 'Dach budynku mieszkalnego', pasuje: n => /mieszkal/.test(n) },
      { id: 'gospodarczy', etykieta: 'Dach budynku gospodarczego', pasuje: n => /gospodar/.test(n) },
      { id: 'grunt', etykieta: 'Grunt', pasuje: n => /grunt/.test(n) },
      INNE
    ]
  },
  {
    id: 'magazyn',
    pytanie: 'Miejsce montażu magazynu energii',
    kolumna: n => n === 'miejsce montazu magazynu energii',
    opcje: [
      { id: 'garaz', etykieta: 'Garaż', pasuje: n => /garaz/.test(n) },
      { id: 'kotlownia', etykieta: 'Kotłownia', pasuje: n => /kotlown/.test(n) },
      { id: 'piwnica', etykieta: 'Piwnica', pasuje: n => /piwnic/.test(n) },
      { id: 'gospodarcze', etykieta: 'Pomieszczenie gospodarcze', pasuje: n => /gospodarcz/.test(n) },
      INNE
    ]
  },
  {
    id: 'zwiekszycMoc',
    pytanie: 'Czy trzeba zwiększyć moc umowną?',
    kolumna: n => n === 'czy trzeba zwiekszyc moc umowna',
    opcje: TAK_NIE
  },
  {
    id: 'prywatnaPv',
    pytanie: 'Czy jest prywatna instalacja PV?',
    kolumna: n => n === 'czy jest prywatna instalacja pv' || n === 'czy istnieje instalacja fotowoltaiczna',
    opcje: TAK_NIE
  },
  {
    id: 'pokrycie',
    pytanie: 'Pokrycie dachowe',
    kolumna: n => n === 'pokrycie dachowe',
    // Kolejność ma znaczenie: "blachodachówka" zawiera "dachówka", "styropapa" - "papa".
    opcje: [
      { id: 'blachodachowka', etykieta: 'Blachodachówka', pasuje: n => /blachodach/.test(n) },
      { id: 'dachowka', etykieta: 'Dachówka', pasuje: n => /dachowk/.test(n) },
      { id: 'trapezowa', etykieta: 'Blacha trapezowa', pasuje: n => /trapez/.test(n) },
      { id: 'rabek', etykieta: 'Blacha na rąbek', pasuje: n => /rabek/.test(n) },
      { id: 'styropapa', etykieta: 'Styropapa', pasuje: n => /styropap/.test(n) },
      { id: 'papa', etykieta: 'Papa', pasuje: n => /papa/.test(n) },
      { id: 'gont', etykieta: 'Gont', pasuje: n => /gont/.test(n) },
      { id: 'warstwowa', etykieta: 'Płyta warstwowa', pasuje: n => /warstwow/.test(n) },
      INNE
    ]
  },
  {
    id: 'zmniejszycMoc',
    pytanie: 'Czy trzeba zmniejszyć moc instalacji PV?',
    kolumna: n => n === 'czy trzeba zmniejszyc moc instalacji pv',
    opcje: TAK_NIE
  },
  {
    id: 'usunacMagazyn',
    pytanie: 'Czy trzeba usunąć magazyn energii?',
    kolumna: n => n === 'czy trzeba usunac magazyn energii',
    opcje: TAK_NIE
  },
  {
    // Tylko "rezygnuje" - brak zaznaczenia niczego nie zmienia, żeby audytor
    // nie cofnął przypadkiem rezygnacji wpisanej przez biuro.
    id: 'rezygnacja',
    pytanie: 'Rezygnacja',
    kolumna: n => n.startsWith('rezyg'),
    opcje: [{ ...TAK, etykieta: 'Klient rezygnuje' }]
  }
];

// { [id pytania]: indeks kolumny } - pierwsza pasująca kolumna od lewej.
export function kolumnyPytan(naglowek) {
  const kolumny = {};
  (naglowek || []).forEach((komorka, i) => {
    const n = normalizuj(komorka);
    if (!n) return;
    for (const p of PYTANIA_PV) if (kolumny[p.id] === undefined && p.kolumna(n)) kolumny[p.id] = i;
  });
  return kolumny;
}

// Wartość z komórki -> { opcja, dopisek } albo null (pusta / nieznana).
export function klasyfikuj(pytanie, wartosc) {
  const tekst = String(wartosc ?? '').trim();
  const n = normalizuj(tekst);
  if (!n) return null;
  const opcja = pytanie.opcje.find(o => o.pasuje(n));
  if (opcja) return { opcja: opcja.id, dopisek: '' };
  const inne = pytanie.opcje.find(o => o.dopisek);
  return inne ? { opcja: inne.id, dopisek: tekst.replace(/^inn[ey]\s*[;:,.-]?\s*/i, '') } : null;
}

// Co wpisać do komórki: najczęstsza pisownia tej odpowiedzi w kolumnie, a gdy
// kolumna jest polem wyboru (true/false) - wartość logiczna.
export function pisownia(pytanie, odpowiedz, wartosciKolumny) {
  const opcja = pytanie.opcje.find(o => o.id === odpowiedz.opcja);
  if (!opcja) return null;
  if (opcja === TAK || opcja === NIE) {
    if (wartosciKolumny.some(v => typeof v === 'boolean')) return opcja === TAK;
  }
  const ile = new Map();
  for (const v of wartosciKolumny) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    const n = normalizuj(t);
    if (n && pytanie.opcje.find(o => o.pasuje(n)) === opcja) ile.set(t, (ile.get(t) || 0) + 1);
  }
  const baza = [...ile].sort((a, b) => b[1] - a[1])[0]?.[0] || opcja.etykieta;
  return opcja.dopisek && odpowiedz.dopisek ? `${baza}; ${odpowiedz.dopisek}` : baza;
}

// Odpowiedzi odczytane z wiersza tabeli - na start okna, żeby audytor widział,
// co już jest wpisane.
export function odpowiedziZWiersza(wiersze, nrWiersza) {
  const naglowek = znajdzNaglowek(wiersze);
  if (!naglowek) return {};
  const kolumny = kolumnyPytan(wiersze[naglowek.wiersz]);
  const wiersz = wiersze[nrWiersza - 1] || [];
  const wynik = {};
  for (const p of PYTANIA_PV) {
    const odp = kolumny[p.id] === undefined ? null : klasyfikuj(p, wiersz[kolumny[p.id]]);
    if (odp) wynik[p.id] = odp;
  }
  return wynik;
}

// Numer wiersza (od 1) adresu w świeżo pobranym arkuszu. Najpierw zapamiętany
// numer, a jeśli biuro w międzyczasie dopisało/usunęło wiersze - szukamy po
// adresie (i UID, gdy jest). Dwa pasujące wiersze = nie zgadujemy.
export function znajdzWiersz(wiersze, cel) {
  const naglowek = znajdzNaglowek(wiersze);
  if (!naglowek) return null;
  const { indeks } = naglowek;
  const klucz = kluczAdresu(cel.adres);
  const zgodny = w => Boolean(w)
    && kluczAdresu(oczyscAdres(w[indeks.adres])) === klucz
    && (!cel.uid || indeks.uid === undefined || String(w[indeks.uid] ?? '').trim() === cel.uid);
  if (cel.wiersz - 1 > naglowek.wiersz && zgodny(wiersze[cel.wiersz - 1])) return cel.wiersz;
  const pasujace = [];
  for (let i = naglowek.wiersz + 1; i < wiersze.length; i += 1) if (zgodny(wiersze[i])) pasujace.push(i + 1);
  return pasujace.length === 1 ? pasujace[0] : null;
}

export function kolumnaA1(indeks) {
  let litery = '';
  for (let i = indeks + 1; i > 0; i = Math.floor((i - 1) / 26)) litery = String.fromCharCode(65 + (i - 1) % 26) + litery;
  return litery;
}

// Komórki do zmiany w wierszu: [{ range, values }] dla Sheets values:batchUpdate.
// Pomija odpowiedzi bez kolumny w tabeli (zwraca je w `brak`) i komórki, które
// już mają tę wartość.
export function zmianyWiersza({ arkusz, wiersze, nrWiersza, odpowiedzi }) {
  const naglowek = znajdzNaglowek(wiersze);
  const kolumny = kolumnyPytan(naglowek ? wiersze[naglowek.wiersz] : []);
  const dane = [];
  const brak = [];
  for (const p of PYTANIA_PV) {
    const odp = odpowiedzi[p.id];
    if (!odp?.opcja) continue;
    const k = kolumny[p.id];
    if (k === undefined) { brak.push(p.pytanie); continue; }
    // Ta sama odpowiedź już jest (może inną pisownią) - komórki nie ruszamy.
    const teraz = klasyfikuj(p, wiersze[nrWiersza - 1]?.[k]);
    if (teraz && teraz.opcja === odp.opcja && teraz.dopisek === (odp.dopisek || '')) continue;
    const wartosc = pisownia(p, odp, wiersze.slice(naglowek.wiersz + 1).map(w => w?.[k]));
    if (wartosc === null) continue;
    dane.push({ range: `'${arkusz.replace(/'/g, "''")}'!${kolumnaA1(k)}${nrWiersza}`, values: [[wartosc]] });
  }
  return { dane, brak };
}
