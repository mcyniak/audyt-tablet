// Pytania z audytu PV wpisywane do tabeli montażowej. Odpowiedzi biorą się
// z kratek ☐ zaznaczonych rysikiem na protokole (aplikacja zna położenie
// kratek ze wzoru i kresek z edytora - to nie jest odczyt pisma), a pytania,
// których na protokole nie ma, audytor zaznacza przyciskiem. Do kolumny o
// nazwie pytania trafia odpowiedź pisownią, której dana tabela już używa
// ("mieszkalny" w jednej, "Dach budynku mieszkalnego" w innej).
//
// Odpowiedź: { opcje: [id, ...], dopisek } - kilka opcji tylko przy pytaniach
// "wielokrotne" (np. panele na dachu i na gruncie).
import { normalizuj, znajdzNaglowek, oczyscAdres, kluczAdresu } from './tabela.js';

const TAK = { id: 'tak', etykieta: 'Tak', pasuje: n => /^(t|tak|true|1)$/.test(n) };
const NIE = { id: 'nie', etykieta: 'Nie', pasuje: n => /^(n|nie|false|0)$/.test(n) };
// "Inne" z dopiskiem audytora: w tabeli "Inne; Eternit pod blachą".
const INNE = { id: 'inne', etykieta: 'Inne', pasuje: n => /^inn[ey]$/.test(n), dopisek: true };

export const PYTANIA_PV = [
  {
    id: 'miejscePv',
    pytanie: 'Miejsce montażu PV',
    kolumna: n => n === 'miejsce montazu pv',
    naWzorze: ['miejsce montazu paneli pv'],
    wielokrotne: true,
    opcje: [
      { id: 'mieszkalny', etykieta: 'Dach budynku mieszkalnego', pasuje: n => /mieszkal/.test(n) },
      { id: 'gospodarczy', etykieta: 'Dach budynku gospodarczego', pasuje: n => /gospodar/.test(n) },
      { id: 'grunt', etykieta: 'Grunt', pasuje: n => /grunt/.test(n) },
      { id: 'elewacja', etykieta: 'Elewacja', pasuje: n => /elewac/.test(n) },
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
    naWzorze: ['czy trzeba zwiekszyc moc umowna'],
    opcje: [TAK, NIE]
  },
  {
    id: 'prywatnaPv',
    pytanie: 'Czy jest prywatna instalacja PV?',
    kolumna: n => n === 'czy jest prywatna instalacja pv' || n === 'czy istnieje instalacja fotowoltaiczna',
    naWzorze: ['istnieje juz instalacja fotowoltaiczna', 'prywatna instalacja pv'],
    opcje: [TAK, NIE]
  },
  {
    id: 'pokrycie',
    pytanie: 'Pokrycie dachowe',
    kolumna: n => n === 'pokrycie dachowe',
    naWzorze: ['pokrycie dachowe'],
    wielokrotne: true,
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
      { id: 'ondulina', etykieta: 'Ondulina', pasuje: n => /ondulin/.test(n) },
      { id: 'eurofala', etykieta: 'Eurofala', pasuje: n => /eurofal/.test(n) },
      { id: 'obornicka', etykieta: 'Płyta obornicka', pasuje: n => /obornick/.test(n) },
      { id: 'beton', etykieta: 'Beton', pasuje: n => /beton/.test(n) },
      INNE
    ]
  },
  {
    id: 'zmniejszycMoc',
    pytanie: 'Czy trzeba zmniejszyć moc instalacji PV?',
    kolumna: n => n === 'czy trzeba zmniejszyc moc instalacji pv',
    naWzorze: ['czy trzeba zmniejszyc moc instalacji'],
    opcje: [TAK, NIE]
  },
  {
    id: 'usunacMagazyn',
    pytanie: 'Czy trzeba usunąć magazyn energii?',
    kolumna: n => n === 'czy trzeba usunac magazyn energii',
    naWzorze: ['czy trzeba usunac magazyn energii'],
    opcje: [TAK, NIE]
  },
  {
    // Tylko "rezygnuje" - brak odpowiedzi niczego nie zmienia, żeby audytor
    // nie cofnął przypadkiem rezygnacji wpisanej przez biuro. Na protokole:
    // pismo w linii "Ja niżej podpisany ..." sekcji rezygnacji.
    id: 'rezygnacja',
    pytanie: 'Rezygnacja',
    kolumna: n => n.startsWith('rezyg'),
    obszarNaWzorze: 'ja nizej podpisany',
    opcje: [{ ...TAK, etykieta: 'Klient rezygnuje' }]
  }
];

const takNie = pytanie => pytanie.opcje.includes(TAK);

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

const dopasujOpcje = (pytanie, tekst) => {
  const n = normalizuj(tekst);
  return n ? pytanie.opcje.find(o => o.pasuje(n)) : null;
};

// Wartość z komórki -> { opcje, dopisek } albo null (pusta / nieznana).
// Przy pytaniach wielokrotnych "Dach budynku gospodarczego, Grunt" to dwie opcje.
export function klasyfikuj(pytanie, wartosc) {
  const tekst = String(wartosc ?? '').trim();
  if (!normalizuj(tekst)) return null;
  const czesci = pytanie.wielokrotne ? tekst.split(',').filter(c => normalizuj(c)) : [tekst];
  const inne = pytanie.opcje.find(o => o.dopisek);
  const opcje = [];
  const dopiski = [];
  for (const c of czesci) {
    const opcja = dopasujOpcje(pytanie, c) || inne;
    if (!opcja) continue;
    if (!opcje.includes(opcja.id)) opcje.push(opcja.id);
    if (opcja === inne && !inne.pasuje(normalizuj(c))) dopiski.push(c.trim().replace(/^inn[ey]\s*[;:,.-]?\s*/i, ''));
  }
  return opcje.length ? { opcje, dopisek: dopiski.join(', ') } : null;
}

const takieSame = (a, b) => Boolean(a && b)
  && [...a.opcje].sort().join() === [...b.opcje].sort().join()
  && (a.dopisek || '') === (b.dopisek || '');

// Co wpisać do komórki: każda opcja najczęstszą pisownią z kolumny (domyślnie
// etykietą), kilka opcji po przecinku; pole wyboru (true/false) - wartość logiczna.
export function pisownia(pytanie, odpowiedz, wartosciKolumny) {
  const wybrane = pytanie.opcje.filter(o => odpowiedz.opcje?.includes(o.id));
  if (!wybrane.length) return null;
  if (takNie(pytanie) && wybrane.length === 1 && wartosciKolumny.some(v => typeof v === 'boolean')) return wybrane[0] === TAK;
  // id opcji -> Map(pisownia -> ile razy); liczą się tylko komórki z jedną
  // opcją bez dopisku, inaczej "Dach budynku gospodarczego, Grunt" stałby się
  // pisownią samego dachu gospodarczego.
  const ile = new Map();
  for (const v of wartosciKolumny) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    const k = klasyfikuj(pytanie, t);
    if (!k || k.opcje.length !== 1 || k.dopisek) continue;
    if (!ile.has(k.opcje[0])) ile.set(k.opcje[0], new Map());
    ile.get(k.opcje[0]).set(t, (ile.get(k.opcje[0]).get(t) || 0) + 1);
  }
  // Odpowiedzi jeszcze w kolumnie nie było - etykieta małą literą, jeśli tak
  // pisze się w tej kolumnie ("nie", "nie" -> "tak", a nie "Tak").
  const poczatki = wartosciKolumny.map(v => (typeof v === 'string' ? v.trim()[0] : '')).filter(z => z && z.toLowerCase() !== z.toUpperCase());
  const malymi = poczatki.filter(z => z === z.toLowerCase()).length > poczatki.length / 2;
  const domyslna = o => (malymi ? o.etykieta[0].toLowerCase() + o.etykieta.slice(1) : o.etykieta);
  return wybrane.map(o => {
    const baza = [...(ile.get(o.id) || [])].sort((a, b) => b[1] - a[1])[0]?.[0] || domyslna(o);
    return o.dopisek && odpowiedz.dopisek ? `${baza}; ${odpowiedz.dopisek}` : baza;
  }).join(', ');
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
// już mają tę odpowiedź (choćby inną pisownią).
export function zmianyWiersza({ arkusz, wiersze, nrWiersza, odpowiedzi }) {
  const naglowek = znajdzNaglowek(wiersze);
  const kolumny = kolumnyPytan(naglowek ? wiersze[naglowek.wiersz] : []);
  const dane = [];
  const brak = [];
  for (const p of PYTANIA_PV) {
    const odp = odpowiedzi[p.id];
    if (!odp?.opcje?.length) continue;
    const k = kolumny[p.id];
    if (k === undefined) { brak.push(p.pytanie); continue; }
    if (takieSame(klasyfikuj(p, wiersze[nrWiersza - 1]?.[k]), odp)) continue;
    const wartosc = pisownia(p, odp, wiersze.slice(naglowek.wiersz + 1).map(w => w?.[k]));
    if (wartosc === null) continue;
    dane.push({ range: `'${arkusz.replace(/'/g, "''")}'!${kolumnaA1(k)}${nrWiersza}`, values: [[wartosc]] });
  }
  return { dane, brak };
}

// --- Kratki na protokole ---

const KRATKA = '☐';

// Podpis kratki bez dopisków: "TAK – Uzasadnienie……" -> "TAK",
// "Dach budynku gospodarczego, zastosowanie budynku: ……" -> "Dach budynku gospodarczego".
const czystaEtykieta = t => t.replace(/\s[–-](\s.*)?$/, '').split(/[–:…,*(]|\.{2,}/)[0].trim();

// Linie tekstu wzoru w kolejności czytania, z kratkami ☐ i ich podpisami.
// strony: wynik tekstSzablonu() (x, y = linia bazowa od dołu strony).
export function linieWzoru(strony) {
  const linie = [];
  strony.forEach((s, strona) => {
    const grupy = [];
    for (const e of [...s.elementy].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const g = grupy.find(x => Math.abs(x.y - e.y) < 2);
      if (g) g.elementy.push(e);
      else grupy.push({ y: e.y, elementy: [e] });
    }
    for (const g of grupy) {
      g.elementy.sort((a, b) => a.x - b.x);
      const linia = { strona, y: g.y, x0: g.elementy[0].x, x1: 0, tekst: '', kratki: [] };
      let biezaca = null;
      let koniec = null;
      for (const e of g.elementy) {
        if (koniec !== null && e.x - koniec > 1) {
          linia.tekst += ' ';
          if (biezaca) biezaca.etykieta += ' ';
        }
        // Kratka zwykle jest osobnym kawałkiem tekstu; gdy siedzi w środku
        // dłuższego - położenie szacujemy proporcjonalnie do liczby znaków.
        let pozycja = 0;
        e.tekst.split(KRATKA).forEach((czesc, i) => {
          if (i > 0) {
            const szer = e.tekst === KRATKA ? e.w : e.w / e.tekst.length;
            biezaca = { strona, x: e.x + e.w * (pozycja / e.tekst.length), y: e.y, w: szer, etykieta: '' };
            linia.kratki.push(biezaca);
            pozycja += 1;
          }
          linia.tekst += czesc;
          if (biezaca) biezaca.etykieta += czesc;
          pozycja += czesc.length;
        });
        koniec = e.x + e.w;
        linia.x1 = Math.max(linia.x1, koniec);
      }
      for (const k of linia.kratki) k.etykieta = czystaEtykieta(k.etykieta);
      linie.push(linia);
    }
  });
  return linie;
}

// Gdzie na wzorze są odpowiedzi na pytania:
// { [id]: { kratki: [{ opcja, kratka }] } } albo { [id]: { obszar } } (rezygnacja).
// Kratki pytania: kolejne kratki od linii z pytaniem, dopóki podpis pasuje do
// którejś opcji i opcja się nie powtarza (następne pytanie też ma TAK/NIE).
export function pytaniaNaWzorze(strony) {
  const linie = linieWzoru(strony);
  const kratki = linie.flatMap((l, i) => l.kratki.map(kratka => ({ kratka, linia: i })));
  const wynik = {};
  for (const p of PYTANIA_PV) {
    if (p.obszarNaWzorze) {
      const l = linie.find(x => normalizuj(x.tekst).includes(p.obszarNaWzorze));
      if (l) wynik[p.id] = { obszar: { strona: l.strona, x0: l.x0, x1: l.x1, y: l.y } };
      continue;
    }
    for (const [i, l] of (p.naWzorze ? linie.entries() : [])) {
      if (!p.naWzorze.some(f => normalizuj(l.tekst).includes(f))) continue;
      const znalezione = [];
      for (const { kratka } of kratki.filter(k => k.linia >= i)) {
        const opcja = dopasujOpcje(p, kratka.etykieta);
        if (!opcja || znalezione.some(z => z.opcja === opcja.id)) break;
        znalezione.push({ opcja: opcja.id, kratka });
      }
      if (znalezione.length) { wynik[p.id] = { kratki: znalezione }; break; }
    }
  }
  return wynik;
}

// Długość (pt) kreski wewnątrz prostokąta - próbkowanie odcinków co 0,5 pt,
// bo szybki "ptaszek" ma mało punktów, a i tak przecina kratkę.
function tuszWProstokacie(punkty, r) {
  const wewnatrz = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  let dlugosc = 0;
  for (let i = 1; i < punkty.length; i += 1) {
    const [x0, y0] = punkty[i - 1];
    const [x1, y1] = punkty[i];
    const odcinek = Math.hypot(x1 - x0, y1 - y0);
    const kroki = Math.max(1, Math.ceil(odcinek / 0.5));
    for (let s = 0; s < kroki; s += 1) {
      const t = (s + 0.5) / kroki;
      if (wewnatrz(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) dlugosc += odcinek / kroki;
    }
  }
  return dlugosc;
}

// Prostokąt kratki w układzie kresek (y od góry strony), z małym zapasem.
// Znak ☐ o rozmiarze 10 pt zajmuje mniej więcej od linii bazowej -1 do +8.
const prostokatKratki = (k, wys) => ({ x0: k.x - 1.5, x1: k.x + k.w + 1.5, y0: wys - (k.y + 9.5), y1: wys - (k.y - 2.5) });

const MIN_TUSZU_KRATKI = 3;
const MIN_TUSZU_OBSZARU = 15;

// Odpowiedzi z kresek audytora: { odpowiedzi, niejasne: [id] } - niejasne to
// np. zaznaczone i TAK, i NIE (w tabeli zostaje bez zmian).
// kreski: [[{ punkty: [[x, y, nacisk]] }]] na stronę, y od góry strony.
export function odpowiedziZProtokolu(mapa, kreski, strony) {
  const tusz = (strona, r) => (kreski[strona] || []).reduce((s, k) => s + tuszWProstokacie(k.punkty, r), 0);
  const odpowiedzi = {};
  const niejasne = [];
  for (const p of PYTANIA_PV) {
    const m = mapa[p.id];
    if (!m) continue;
    if (m.obszar) {
      const { strona, x0, x1, y } = m.obszar;
      const wys = strony[strona].wys;
      if (tusz(strona, { x0, x1, y0: wys - (y + 12), y1: wys - (y - 4) }) >= MIN_TUSZU_OBSZARU) odpowiedzi[p.id] = { opcje: ['tak'], dopisek: '' };
      continue;
    }
    const zaznaczone = m.kratki
      .filter(({ kratka }) => tusz(kratka.strona, prostokatKratki(kratka, strony[kratka.strona].wys)) >= MIN_TUSZU_KRATKI)
      .map(z => z.opcja);
    if (!zaznaczone.length) continue;
    if (zaznaczone.length > 1 && !p.wielokrotne) niejasne.push(p.id);
    else odpowiedzi[p.id] = { opcje: zaznaczone, dopisek: '' };
  }
  return { odpowiedzi, niejasne };
}
