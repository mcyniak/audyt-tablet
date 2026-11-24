// Tabela materiałowa inwestycji: Arkusz Google „Tabela materiałowa” w folderze
// inwestycji (INWESTYCJE_3 / <inwestycja> / Tabela materiałowa). Piszą do niej
// dwie aplikacje: Audyt (wnioski materiałowe z tabletu) i Listy materiałowe
// (odczytane skany list). TEN PLIK JEST W OBU REPOZYTORIACH (audyt-tablet
// i listy-materialowe) I MA BYĆ W NICH TAKI SAM.
//
// Arkusze:
//   Pozycje - wiersz na pozycję materiału, każdy z adresem (jak tabela
//             z aplikacji Listy materiałowe); wiersze wniosku niosą też
//             jego status, datę rozpoczęcia i zatwierdzenia,
//   Wnioski - wiersz na wniosek: status, kiedy rozpoczęty, kiedy zatwierdzony,
//             link do PDF (biuro odblokowuje wniosek, czyszcząc „Zatwierdzono”),
//   Razem   - suma każdej pozycji, formułą z arkusza Pozycje.
//
// Kolumny szukamy po nagłówku, nie po literze: biuro może dopisać własne
// kolumny, a brakujące aplikacja dopisuje na końcu.

export const NAZWA_TABELI = 'Tabela materiałowa';
export const ARKUSZ = { pozycje: 'Pozycje', wnioski: 'Wnioski', razem: 'Razem' };
export const ZRODLO = { wniosek: 'Wniosek materiałowy', lista: 'Lista materiałowa (skan)' };
export const STATUS = { wTrakcie: 'W trakcie', zatwierdzony: 'Zatwierdzony' };

export const KOLUMNY_POZYCJI = ['Adres', 'Rodzaj', 'Źródło', 'Sekcja', 'Pozycja', 'Jedn.', 'Ilość', 'Dodatkowo', 'Uwagi', 'Data', 'Ekipa', 'Moc', 'Status', 'Rozpoczęto', 'Zatwierdzono', 'Do sprawdzenia', 'Plik', 'Zapisano'];
export const KOLUMNY_WNIOSKOW = ['Adres', 'Rodzaj', 'Status', 'Rozpoczęto', 'Ostatnia zmiana', 'Zatwierdzono', 'PDF'];

// Suma ilości każdej pozycji osobno dla źródła i rodzaju instalacji
// (składnia formuł w Sheets API: angielskie nazwy, przecinki).
export const FORMULA_RAZEM = `=QUERY(${ARKUSZ.pozycje}!A:Z,"select C, B, E, F, sum(G) where E <> '' group by C, B, E, F order by C, B, E label C 'Źródło', B 'Rodzaj', E 'Pozycja', F 'Jedn.', sum(G) 'Ilość razem'",1)`;

// --- tekst ---------------------------------------------------------------------

export function normalizuj(wartosc) {
  return String(wartosc ?? '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "ul. Pogodna 31, Przykładowo" i "Przykładowo, ul. Pogodna 31" to ten sam
// adres; "13 A" i "13A" też.
const SLOWA_POMIJANE = new Set(['ul', 'al', 'os', 'pl', 'gm', 'gmina']);
export function kluczAdresu(adres) {
  return normalizuj(adres)
    .replace(/\b(\d+)\s+([a-z])\b/g, '$1$2')
    .split(' ')
    .filter(slowo => slowo && !SLOWA_POMIJANE.has(slowo))
    .sort()
    .join(' ');
}

// "12" -> 12, "2,5" -> 2.5; reszta zostaje tekstem ("2 x 5 m").
export function wartoscKomorki(wartosc) {
  if (typeof wartosc === 'number') return wartosc;
  const t = String(wartosc ?? '').trim();
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return t;
}

// Daty czytelne dla biura: "23.11.2026 14:05" (tekst, nie zależy od strefy arkusza).
export function dataCzytelna(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function kolumnaA1(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

export const zakres = (arkusz, kolumna, wiersz) => `'${arkusz.replace(/'/g, "''")}'!${kolumnaA1(kolumna)}${wiersz}`;

// --- zmiany w arkuszach (czyste funkcje, testowane w Node) --------------------------

// Nagłówek arkusza z dopisanymi brakującymi kolumnami.
function naglowek(arkusz, wiersze, potrzebne) {
  const kolumny = [...(wiersze[0] || [])].map(k => String(k ?? ''));
  const dane = [];
  const indeks = nazwa => {
    const n = normalizuj(nazwa);
    let i = kolumny.findIndex(k => normalizuj(k) === n);
    if (i === -1) {
      i = kolumny.length;
      kolumny.push(nazwa);
      dane.push({ range: zakres(arkusz, i, 1), values: [[nazwa]] });
    }
    return i;
  };
  for (const k of potrzebne) indeks(k);
  return { kolumny, dane, indeks };
}

const jakoObiekt = (kolumny, w) => Object.fromEntries(kolumny.map((k, i) => [k, w?.[i] ?? '']));

/**
 * Pozycje jednego zapisu: nowe wiersze na końcu arkusza i stare wiersze tego
 * samego zapisu (czyStary) do usunięcia - poprawiony wniosek albo ponownie
 * zapisany skan nie dubluje pozycji.
 * nowe: [{ Adres, Rodzaj, ... }] - klucze to nagłówki; nieznany klucz = nowa kolumna.
 * @returns {{ naglowekDane, dopisz: {wiersz, wartosci}, doUsuniecia: number[], szerokosc }}
 *   doUsuniecia - numery wierszy liczone od 0 (jak w Sheets API).
 */
export function zmianyPozycji({ wiersze, nowe, czyStary }) {
  const dodatkowe = [...new Set(nowe.flatMap(Object.keys))].filter(k => !KOLUMNY_POZYCJI.includes(k));
  const { kolumny, dane, indeks } = naglowek(ARKUSZ.pozycje, wiersze, [...KOLUMNY_POZYCJI, ...dodatkowe]);
  const doUsuniecia = [];
  wiersze.forEach((w, i) => {
    if (i > 0 && w?.some(v => v !== '' && v !== null) && czyStary(jakoObiekt(kolumny, w))) doUsuniecia.push(i);
  });
  const wartosci = nowe.map(obiekt => {
    const w = new Array(kolumny.length).fill('');
    for (const [k, v] of Object.entries(obiekt)) w[indeks(k)] = v ?? '';
    return w;
  });
  return { naglowekDane: dane, dopisz: { wiersz: Math.max(wiersze.length, 1) + 1, wartosci }, doUsuniecia, szerokosc: kolumny.length };
}

// Numery wierszy -> bloki do usunięcia od dołu (usunięcie nie przesuwa
// wierszy jeszcze nieusuniętych).
export function blokiDoUsuniecia(numery) {
  const bloki = [];
  for (const n of [...numery].sort((a, b) => a - b)) {
    const ostatni = bloki.at(-1);
    if (ostatni && ostatni.koniec === n) ostatni.koniec = n + 1;
    else bloki.push({ start: n, koniec: n + 1 });
  }
  return bloki.reverse();
}

export const kluczWniosku = (adres, rodzaj) => `${kluczAdresu(adres)}|${normalizuj(rodzaj)}`;

/**
 * Wiersz wniosku w arkuszu Wnioski (szukany po adresie i rodzaju instalacji).
 * wpis: { adres, rodzaj, rozpoczeto, zmieniono, zatwierdzono, link }
 */
export function zmianyWniosku({ wiersze, wpis }) {
  const { kolumny, dane, indeks } = naglowek(ARKUSZ.wnioski, wiersze, KOLUMNY_WNIOSKOW);
  const iAdres = indeks('Adres');
  const iRodzaj = indeks('Rodzaj');
  const klucz = kluczWniosku(wpis.adres, wpis.rodzaj);
  let nr = wiersze.findIndex((w, i) => i > 0 && kluczWniosku(w?.[iAdres], w?.[iRodzaj]) === klucz) + 1;
  if (!nr) nr = Math.max(wiersze.length, 1) + 1;
  const komorki = {
    Adres: wpis.adres,
    Rodzaj: wpis.rodzaj,
    Status: wpis.zatwierdzono ? STATUS.zatwierdzony : STATUS.wTrakcie,
    'Rozpoczęto': dataCzytelna(wpis.rozpoczeto),
    'Ostatnia zmiana': dataCzytelna(wpis.zmieniono),
    Zatwierdzono: dataCzytelna(wpis.zatwierdzono),
    PDF: wpis.link || ''
  };
  for (const [k, v] of Object.entries(komorki)) dane.push({ range: zakres(ARKUSZ.wnioski, indeks(k), nr), values: [[v]] });
  return { dane, szerokosc: kolumny.length, wiersz: nr };
}

// Statusy z arkusza Wnioski: Map(kluczWniosku(adres, rodzaj) -> { zatwierdzony, zatwierdzono })
export function statusyWnioskow(wiersze) {
  const wynik = new Map();
  const kol = (wiersze?.[0] || []).map(normalizuj);
  const iAdres = kol.indexOf('adres');
  const iRodzaj = kol.indexOf('rodzaj');
  const iZatw = kol.indexOf('zatwierdzono');
  if (iAdres === -1) return wynik;
  for (const w of wiersze.slice(1)) {
    const adres = String(w?.[iAdres] ?? '').trim();
    if (!adres) continue;
    const zatwierdzono = iZatw === -1 ? '' : String(w[iZatw] ?? '').trim();
    wynik.set(kluczWniosku(adres, iRodzaj === -1 ? '' : w[iRodzaj]), { zatwierdzony: Boolean(zatwierdzono), zatwierdzono });
  }
  return wynik;
}

// --- zapis przez Google -------------------------------------------------------------
//
// g - klient Google aplikacji (src/google.js), z funkcjami:
//   arkuszeWFolderze(idFolderu) -> [{ id, name }]     (Arkusze Google w folderze)
//   utworzArkuszGoogle(idFolderu, nazwa) -> id
//   arkuszeTabeli(id) -> [{ sheetId, title, gridProperties }]
//   zmianyTabeli(id, requests) -> odpowiedź spreadsheets:batchUpdate
//   wartosciArkusza(id, nazwa) -> wiersze
//   zapiszKomorki(id, dane, opcja = 'RAW')

const toTabela = nazwa => /tabela\s+materia/.test(normalizuj(nazwa));

// Id tabeli materiałowej w folderze inwestycji; bez `utworz` null, gdy jej nie ma.
export async function tabelaMaterialowa(g, idInwestycji, { utworz = true } = {}) {
  const istniejaca = (await g.arkuszeWFolderze(idInwestycji)).find(p => toTabela(p.name));
  if (istniejaca) return istniejaca.id;
  return utworz ? g.utworzArkuszGoogle(idInwestycji, NAZWA_TABELI) : null;
}

const pogrubNaglowek = sheetId => ({
  repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' }
});

// Arkusze Pozycje/Wnioski/Razem - brakujące zakładamy. W nowej tabeli
// pusty „Arkusz1” staje się arkuszem Pozycje.
// Wynik: Map(nazwa -> { sheetId, wierszy, kolumn })
export async function przygotujTabele(g, id) {
  let arkusze = await g.arkuszeTabeli(id);
  const nasze = Object.values(ARKUSZ);
  const requests = [];
  const nowe = [];
  if (!arkusze.some(a => nasze.includes(a.title)) && arkusze.length === 1 && /^(sheet|arkusz)\s*1$/i.test(arkusze[0].title)) {
    const { sheetId } = arkusze[0];
    requests.push({ updateSheetProperties: { properties: { sheetId, title: ARKUSZ.pozycje, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } }, pogrubNaglowek(sheetId));
    arkusze = [{ ...arkusze[0], title: ARKUSZ.pozycje }];
  }
  for (const nazwa of nasze) {
    if (arkusze.some(a => a.title === nazwa)) continue;
    requests.push({ addSheet: { properties: { title: nazwa, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } } } });
    nowe.push(nazwa);
  }
  if (requests.length) {
    const odp = await g.zmianyTabeli(id, requests);
    const dodane = (odp.replies || []).map(r => r.addSheet?.properties).filter(Boolean);
    if (dodane.length) await g.zmianyTabeli(id, dodane.map(p => pogrubNaglowek(p.sheetId)));
    if (nowe.includes(ARKUSZ.razem)) await g.zapiszKomorki(id, [{ range: zakres(ARKUSZ.razem, 0, 1), values: [[FORMULA_RAZEM]] }], 'USER_ENTERED');
    arkusze = await g.arkuszeTabeli(id);
  }
  return new Map(arkusze.map(a => [a.title, { sheetId: a.sheetId, wierszy: a.gridProperties?.rowCount || 0, kolumn: a.gridProperties?.columnCount || 0 }]));
}

// Poszerzenie/wydłużenie siatki - zapis poza nią Sheets API odrzuca.
async function siatka(g, id, arkusz, { wierszy = 0, kolumn = 0 }) {
  const requests = [];
  if (kolumn > arkusz.kolumn) requests.push({ appendDimension: { sheetId: arkusz.sheetId, dimension: 'COLUMNS', length: kolumn - arkusz.kolumn + 10 } });
  if (wierszy > arkusz.wierszy) requests.push({ appendDimension: { sheetId: arkusz.sheetId, dimension: 'ROWS', length: wierszy - arkusz.wierszy + 500 } });
  if (requests.length) await g.zmianyTabeli(id, requests);
}

/**
 * Zastępuje pozycje jednego zapisu: najpierw dopisuje nowe na końcu, potem usuwa
 * stare (przerwany zapis zostawia najwyżej podwójne wiersze, nie gubi danych).
 */
export async function zapiszPozycje(g, id, { nowe, czyStary }) {
  const arkusze = await przygotujTabele(g, id);
  const wiersze = await g.wartosciArkusza(id, ARKUSZ.pozycje);
  const z = zmianyPozycji({ wiersze, nowe, czyStary });
  await siatka(g, id, arkusze.get(ARKUSZ.pozycje), { kolumn: z.szerokosc, wierszy: z.dopisz.wiersz + z.dopisz.wartosci.length });
  const dane = [...z.naglowekDane];
  if (z.dopisz.wartosci.length) dane.push({ range: zakres(ARKUSZ.pozycje, 0, z.dopisz.wiersz), values: z.dopisz.wartosci });
  if (dane.length) await g.zapiszKomorki(id, dane);
  const bloki = blokiDoUsuniecia(z.doUsuniecia);
  if (bloki.length) {
    const { sheetId } = arkusze.get(ARKUSZ.pozycje);
    await g.zmianyTabeli(id, bloki.map(b => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: b.start, endIndex: b.koniec } } })));
  }
  return { dopisano: z.dopisz.wartosci.length, usunieto: z.doUsuniecia.length };
}

export async function zapiszWniosek(g, id, wpis) {
  const arkusze = await przygotujTabele(g, id);
  const wiersze = await g.wartosciArkusza(id, ARKUSZ.wnioski);
  const { dane, szerokosc, wiersz } = zmianyWniosku({ wiersze, wpis });
  await siatka(g, id, arkusze.get(ARKUSZ.wnioski), { kolumn: szerokosc, wierszy: wiersz });
  await g.zapiszKomorki(id, dane);
}

// Arkusz Wnioski (pusty, gdy tabeli albo arkusza jeszcze nie ma).
export async function odczytajWnioski(g, id) {
  if (!id) return [];
  try {
    return await g.wartosciArkusza(id, ARKUSZ.wnioski);
  } catch (blad) {
    if (blad.status === 400) return [];
    throw blad;
  }
}
