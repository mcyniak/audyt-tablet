// Wniosek materiałowy: pola wzoru PDF, wartości wpisywane z klawiatury,
// zapis do tabeli materiałowej inwestycji (src/tabela-materialowa.js).
//
// Pola nie są zapisane w kodzie. Bierzemy je z samego wzoru: każdy ciąg
// podkreśleń "____" to pole do wpisania, a nazwą pola (i kolumną w arkuszu)
// jest tekst przed nim w tym samym wierszu. Nowa pozycja we wzorze oznacza
// nową pozycję w tabeli, bez zmian w aplikacji. Wszystko inne na wzorze
// (np. "Uwagi: ......", podpis) wypełnia się rysikiem.
//
// Moduł bez zależności od przeglądarki, więc testy w Node też go używają.
import { normalizuj } from './tabela.js';
import { ZRODLO, STATUS, wartoscKomorki, dataCzytelna } from './tabela-materialowa.js';

export { dataCzytelna };

const PODKRESLENIA = /_{4,}/g;
const JEDNOSTKA = /^(szt|kpl|kompl|m|mb|m2|m²|m3|m³|kg|g|l|op|opak|rolka|rolki|para|pary|komplet|szt\/kpl)\.?$/i;
const LP = /^\d{1,3}[.)]?$/;

// Przybliżona szerokość znaku (w em) - potrzebna, gdy etykieta i
// podkreślenia są w jednym kawałku tekstu: "Adres: ________".
function szerokoscZnaku(z) {
  if (z === '_') return 0.5;
  if (z === ' ') return 0.23;
  if ('.,:;\'|!'.includes(z)) return 0.25;
  if (/[0-9]/.test(z)) return 0.5;
  if (/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(z)) return 0.62;
  return 0.48;
}
const szerokosc = t => [...t].reduce((s, z) => s + szerokoscZnaku(z), 0);

// Kawałki tekstu jednego elementu pdf.js: zwykły tekst i pola (podkreślenia),
// każdy z przybliżonym x i szerokością.
function kawalki(el) {
  const calosc = szerokosc(el.tekst) || 1;
  const xOd = i => el.x + el.w * szerokosc(el.tekst.slice(0, i)) / calosc;
  const wynik = [];
  let od = 0;
  for (const m of el.tekst.matchAll(PODKRESLENIA)) {
    if (m.index > od) wynik.push({ pole: false, tekst: el.tekst.slice(od, m.index), x: xOd(od), x1: xOd(m.index) });
    wynik.push({ pole: true, x: xOd(m.index), x1: xOd(m.index + m[0].length) });
    od = m.index + m[0].length;
  }
  if (od < el.tekst.length) wynik.push({ pole: false, tekst: el.tekst.slice(od), x: xOd(od), x1: el.x + el.w });
  return wynik;
}

// Linie strony: elementy o tej samej linii bazowej (±2 pt), od góry strony.
function linie(elementy) {
  const posortowane = [...elementy].sort((a, b) => b.y - a.y || a.x - b.x);
  const wynik = [];
  for (const e of posortowane) {
    const linia = wynik.find(l => Math.abs(l.y - e.y) < 2);
    if (linia) linia.elementy.push(e);
    else wynik.push({ y: e.y, elementy: [e] });
  }
  for (const l of wynik) l.elementy.sort((a, b) => a.x - b.x);
  return wynik;
}

// Rodzaj pola decyduje o klawiaturze i o tym, co wpisujemy z góry.
function rodzajPola(etykieta, jednostka) {
  const n = normalizuj(etykieta);
  if (/^adres/.test(n)) return 'adres';
  if (/^inwestycj/.test(n)) return 'inwestycja';
  if (/^data\b/.test(n)) return 'data';
  if (/nazwisk|klient|wlasciciel/.test(n)) return 'nazwisko';
  if (jednostka) return 'ilosc';
  // "Ekipa:", "Kierowca:" - pole formularza z tekstem; pozycja tabeli bez
  // dwukropka ("Falownik ____") to ilość.
  return /:\s*$/.test(etykieta) || /ekip|uwag|podpis|osob|kierowc|samoch|telefon|gmina|nr\b/.test(n) ? 'tekst' : 'ilosc';
}

const czysc = t => t.replace(/\s+/g, ' ').trim();

// Nagłówek sekcji tabeli: linia bez pól, cała wielkimi literami ("KONSTRUKCJA").
const SEKCJA = /^[^a-ząćęłńóśźż]*[A-ZĄĆĘŁŃÓŚŹŻ]{3}[^a-ząćęłńóśźż]*$/;

// strony: wynik tekstSzablonu (y linii bazowej od dołu strony).
// Wynik: [{ id, etykieta, jednostka, rodzaj, kolumna, sekcja, strona, x, y, w }].
export function polaWzoru(strony) {
  const pola = [];
  let sekcja = { tekst: '', nr: 0 };
  strony.forEach((strona, s) => {
    for (const linia of linie(strona.elementy)) {
      const tekstLinii = czysc(linia.elementy.map(e => e.tekst).join(' '));
      if (!/_{4,}/.test(tekstLinii) && SEKCJA.test(tekstLinii)) { sekcja = { tekst: tekstLinii, nr: sekcja.nr + 1 }; continue; }
      const czesci = linia.elementy.flatMap(e => kawalki(e).map(k => ({ ...k, y: e.y })));
      let teksty = [];
      let ostatnie = null; // pole przed tym tekstem - jednostka może stać ZA polem ("____ szt.")
      for (const c of czesci) {
        if (!c.pole) {
          const t = czysc(c.tekst);
          if (!t) continue;
          if (ostatnie && !ostatnie.jednostka && !teksty.length && JEDNOSTKA.test(t)) { ostatnie.jednostka = t; continue; }
          teksty.push(t);
          continue;
        }
        // Lp. z początku wiersza tabeli nie jest częścią nazwy.
        const bezLp = teksty.filter((t, i) => !(i === 0 && LP.test(t)));
        let jednostka = '';
        if (bezLp.length > 1 && JEDNOSTKA.test(bezLp.at(-1))) jednostka = bezLp.pop();
        const pole = { etykieta: czysc(bezLp.join(' ')), jednostka, sekcja, strona: s, x: c.x, y: c.y, w: c.x1 - c.x };
        pola.push(pole);
        ostatnie = pole;
        teksty = [];
      }
    }
  });

  const uzyte = new Map();
  // Tytuł wzoru też jest wielkimi literami - sekcja liczy się dopiero, gdy
  // między nią a pozycją nie było pól nagłówka ("Data: ____").
  let poNaglowku = -1;
  return pola.map((p, i) => {
    const etykieta = p.etykieta.replace(/:\s*$/, '') || `Pole ${i + 1}`;
    const rodzaj = rodzajPola(p.etykieta, p.jednostka);
    if (rodzaj !== 'ilosc') poNaglowku = p.sekcja.nr;
    const sekcja = rodzaj === 'ilosc' && p.sekcja.nr > poNaglowku ? p.sekcja.tekst : '';
    const kolumna = p.jednostka ? `${etykieta} [${p.jednostka}]` : etykieta;
    const baza = normalizuj(kolumna) || `pole ${i + 1}`;
    const nr = (uzyte.get(baza) || 0) + 1;
    uzyte.set(baza, nr);
    return { ...p, etykieta, rodzaj, sekcja, id: nr > 1 ? `${baza} ${nr}` : baza, kolumna: nr > 1 ? `${kolumna} (${nr})` : kolumna };
  });
}

// Wartości wpisane z góry: adres i nazwisko z tabeli, nazwa inwestycji, data.
export function wartosciPoczatkowe(pola, { adres, nazwisko, inwestycja, data }) {
  const z = { adres, nazwisko, inwestycja, data };
  return Object.fromEntries(pola.filter(p => z[p.rodzaj]).map(p => [p.id, z[p.rodzaj]]));
}

// Wiersze arkusza Pozycje tabeli materiałowej: jeden na wpisaną ilość.
// Data i ekipa z nagłówka wniosku idą do swoich kolumn przy każdej pozycji,
// inne pola tekstowe wzoru (np. "Kierowca") - do kolumn o swojej nazwie.
// pola: zapisane w rekordzie ({ id, kolumna, etykieta, jednostka, sekcja, rodzaj }).
// niepewne: id pól, których odczyt pisma trzeba sprawdzić.
export function pozycjeWniosku({ pola, wartosci, adres, rodzaj, link, zapisano, rozpoczeto, zatwierdzono, niepewne = [] }) {
  const wartosc = p => String(wartosci?.[p.id] ?? '').trim();
  const wspolne = { Adres: adres, Rodzaj: rodzaj, 'Źródło': ZRODLO.wniosek };
  for (const p of pola) {
    const v = wartosc(p);
    if (!v || p.rodzaj === 'ilosc' || ['adres', 'inwestycja', 'nazwisko'].includes(p.rodzaj)) continue;
    const n = normalizuj(p.etykieta || p.kolumna);
    const klucz = p.rodzaj === 'data' ? 'Data' : /^ekip/.test(n) ? 'Ekipa' : /^moc\b/.test(n) ? 'Moc' : /^uwag/.test(n) ? 'Uwagi' : p.kolumna;
    wspolne[klucz] ??= v;
  }
  // Wzór bez pola „Data” - data rozpoczęcia wniosku.
  wspolne.Data ??= dataCzytelna(rozpoczeto || zapisano).slice(0, 10);
  return pola.filter(p => p.rodzaj === 'ilosc' && wartosc(p)).map(p => ({
    ...wspolne,
    Sekcja: p.sekcja || '',
    Pozycja: p.etykieta ?? p.kolumna,
    'Jedn.': p.jednostka || '',
    'Ilość': wartoscKomorki(wartosc(p)),
    Status: zatwierdzono ? STATUS.zatwierdzony : STATUS.wTrakcie,
    'Rozpoczęto': dataCzytelna(rozpoczeto),
    Zatwierdzono: dataCzytelna(zatwierdzono),
    'Do sprawdzenia': niepewne.includes(p.id) ? 'tak' : '',
    Plik: link || '',
    Zapisano: dataCzytelna(zapisano)
  }));
}

// --- Stan do edycji zapisany w samym PDF ---
//
// PDF na Dysku ma wpisane ilości i pismo wtopione w stronę. Żeby dało się go
// poprawić na dowolnym urządzeniu, w środku jest załącznik z wartościami,
// kreskami i czystym wzorem. Przeglądarki PDF pokazują normalnie sam wniosek.

export const ZALACZNIK_STANU = 'wniosek-stan.json';
export const ZALACZNIK_WZORU = 'wniosek-wzor.pdf';

export function zalacznikiStanu(stan, wzorBajty) {
  return [
    { nazwa: ZALACZNIK_STANU, bajty: new TextEncoder().encode(JSON.stringify({ wersja: 1, ...stan })), mimeType: 'application/json', opis: 'Dane do edycji wniosku w aplikacji Audyt' },
    { nazwa: ZALACZNIK_WZORU, bajty: new Uint8Array(wzorBajty), mimeType: 'application/pdf', opis: 'Czysty wzór wniosku' }
  ];
}

// dokument: PDFDocumentProxy z pdf.js. null, gdy to nie jest wniosek z aplikacji.
export async function stanZPdf(dokument) {
  const zalaczniki = await dokument.getAttachments();
  const stan = zalaczniki?.[ZALACZNIK_STANU];
  const wzor = zalaczniki?.[ZALACZNIK_WZORU];
  if (!stan?.content || !wzor?.content) return null;
  return { stan: JSON.parse(new TextDecoder().decode(stan.content)), wzor: wzor.content };
}
