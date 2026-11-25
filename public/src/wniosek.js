// Materiałówka (wniosek materiałowy): PDF zestawu z folderu
//   <inwestycja> / <…Materiałówki> / <PC|PV> / set 9012.pdf
// wypełniany rysikiem na tablecie. Zestaw to gotowa lista pozycji (l.p.,
// Nazwa, Materiał, ilość) - część ilości jest już wydrukowana. Magazynier
// zostawia je, skreśla albo poprawia rysikiem; puste dopisuje rysikiem.
// Pismo w kolumnie ilości odczytuje Claude (src/odczyt-pisma.js).
//
// Zapis: PDF do folderu adresu obok zestawów, wiersze (adres, towar, liczba,
// daty) do arkusza „Materiałówka”, data zapisu i zatwierdzenia do kolumn
// „…wydania…” i „…zakończenia…” w wierszu adresu w tabeli montażowej.
//
// Moduł bez zależności od przeglądarki, więc testy w Node też go używają.
import { normalizuj, znajdzNaglowek, kluczAdresu } from './tabela.js';
import { wartoscKomorki, dataCzytelna, zakres, blokiDoUsuniecia } from './tabela-materialowa.js';

export { dataCzytelna, blokiDoUsuniecia };

// Folder materiałówek w inwestycji („8. Materiałówki ”), arkusz „Materiałówka”.
export const MATERIALOWKI = /materia[lł][oó]wk/i;

// --- pola zestawu ------------------------------------------------------------

const LP = /^\d{1,3}[.)]?$/;
// Wydrukowana ilość: "5", "2,5", "80 l".
const ILOSC = /^\d+([.,]\d+)?(\s*[a-ząćęłńóśźż.]{1,4})?$/i;
// Wiersze tabeli są co ~9,5 pt; bliżej to dalszy ciąg tej samej pozycji.
const CIAG_DALSZY = 7;

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

const czysc = t => t.replace(/\s+/g, ' ').trim();
const mediana = l => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * Pola zestawu z tekstu PDF (wynik tekstSzablonu; y linii bazowej od dołu strony).
 * Pozycje: { id, rodzaj: 'ilosc', etykieta, material, lp, wydrukowano, sekcja, strona, x, y, w, h }
 *   x/w - kolumna ilości (pismo), y - tak, by środek wiersza wypadał w wys - y - 5
 *   (jak w src/odczyt-pisma.js), h - wysokość wiersza.
 * Nagłówek: { id: 'ekipa' | 'data' | 'adres', rodzaj: 'tekst' | 'data' | 'adres', ... }.
 */
export function polaZestawu(strony) {
  const wiersze = [];
  const naglowki = [];
  let sekcja = 0;
  let pierwszyNaglowekTabeli = null;
  // Tabela przechodzi na kolejne strony bez powtórzonego nagłówka.
  let tabela = null;
  strony.forEach((strona, s) => {
    let poprzedni = null;
    for (const linia of linie(strona.elementy)) {
      const nazwy = linia.elementy.map(e => normalizuj(e.tekst));
      const iNazwa = nazwy.indexOf('nazwa');
      if (iNazwa !== -1) {
        const material = linia.elementy.find(e => /^materia/.test(normalizuj(e.tekst)));
        tabela = { xNazwa: linia.elementy[iNazwa].x, xMaterial: material?.x ?? null };
        sekcja += 1;
        poprzedni = null;
        pierwszyNaglowekTabeli ??= { strona: s, y: linia.y };
        continue;
      }
      if (!tabela) {
        if (s === 0) naglowki.push(linia);
        continue;
      }
      if (nazwy.some(n => /^podpis/.test(n))) { tabela = null; continue; }
      const czesc = { lp: '', nazwa: [], material: null, ilosc: null };
      for (const e of linia.elementy) {
        const t = czysc(e.tekst);
        if (e.x < tabela.xNazwa - 3) { if (LP.test(t)) czesc.lp = t.replace(/[.)]$/, ''); continue; }
        if (tabela.xMaterial !== null && e.x > tabela.xMaterial + 20 && ILOSC.test(t)) { czesc.ilosc = e; continue; }
        if (tabela.xMaterial !== null && e.x >= tabela.xMaterial - 15) { czesc.material = e; continue; }
        if (tabela.xMaterial === null && e.x > tabela.xNazwa + 150 && ILOSC.test(t)) { czesc.ilosc = e; continue; }
        czesc.nazwa.push(t);
      }
      if (poprzedni && poprzedni.ys.at(-1) - linia.y < CIAG_DALSZY) {
        poprzedni.ys.push(linia.y);
        poprzedni.nazwa.push(...czesc.nazwa);
        poprzedni.lp ||= czesc.lp;
        poprzedni.material ||= czesc.material;
        poprzedni.ilosc ||= czesc.ilosc;
        continue;
      }
      poprzedni = { strona: s, sekcja, ys: [linia.y], ...czesc };
      wiersze.push(poprzedni);
    }
  });

  // Kolumna ilości: od prawej krawędzi kolumny Materiał do lustrzanego odbicia
  // względem środka wydrukowanych ilości (brak ramek tabeli w tekście PDF).
  const prawyMaterial = Math.max(...wiersze.filter(w => w.material).map(w => w.material.x + w.material.w));
  const srodekIlosci = mediana(wiersze.filter(w => w.ilosc).map(w => w.ilosc.x + w.ilosc.w / 2));
  const lewaIlosci = Math.min(...wiersze.filter(w => w.ilosc).map(w => w.ilosc.x));
  // Granica kolumn: w połowie między najdłuższym materiałem a wydrukowaną ilością.
  const x0 = Number.isFinite(prawyMaterial)
    ? (lewaIlosci > prawyMaterial ? (prawyMaterial + lewaIlosci) / 2 : prawyMaterial + 3)
    : (srodekIlosci ?? 420) - 30;
  const x1 = srodekIlosci !== null && srodekIlosci > x0 + 5 ? Math.max(2 * srodekIlosci - x0, srodekIlosci + 35) : x0 + 60;

  const pozycje = wiersze
    .map(w => ({ ...w, nazwa: czysc(w.nazwa.join(' ')) }))
    .filter(w => /[a-ząćęłńóśźż0-9]/i.test(w.nazwa.replace(/[.…]/g, '')))
    .map((w, i) => {
      const yLinii = w.ys.reduce((a, b) => a + b, 0) / w.ys.length;
      return {
        id: `poz-${i + 1}`,
        rodzaj: 'ilosc',
        etykieta: w.nazwa,
        material: w.material ? czysc(w.material.tekst) : '',
        lp: w.lp,
        wydrukowano: w.ilosc ? czysc(w.ilosc.tekst) : '',
        sekcja: w.sekcja,
        strona: w.strona,
        x: x0,
        y: yLinii - 2,
        w: x1 - x0,
        h: 9.5 + (w.ys.length - 1) * 5
      };
    });

  // Nagłówek zestawu (nad pierwszą tabelą na 1. stronie): Ekipa, Data, Adres.
  const elementyNaglowka = naglowki.flatMap(l => l.elementy);
  const etykieta = wzor => elementyNaglowka.find(e => wzor.test(normalizuj(e.tekst)));
  const ekipa = etykieta(/^ekipa/);
  const data = etykieta(/^data\b/);
  const adres = etykieta(/^adres/);
  const kolumnaMaterialu = Number.isFinite(prawyMaterial) ? prawyMaterial : x0;
  const pola = [];
  if (ekipa) {
    const x = ekipa.x + ekipa.w + 4;
    const koniec = data && Math.abs(data.y - ekipa.y) < 3 && data.x > x ? data.x - 10 : kolumnaMaterialu - 50;
    pola.push({ id: 'ekipa', rodzaj: 'tekst', etykieta: 'Ekipa', strona: 0, x, y: ekipa.y, w: Math.max(koniec - x, 40) });
  }
  if (data) {
    const x = Math.max(data.x + data.w + 4, x0);
    pola.push({ id: 'data', rodzaj: 'data', etykieta: 'Data', strona: 0, x, y: data.y, w: Math.max(x1 - x, 50) });
  }
  if (adres) {
    const x = adres.x + adres.w + 8;
    pola.push({ id: 'adres', rodzaj: 'adres', etykieta: 'Adres montażu', strona: 0, x, y: adres.y, w: Math.max(kolumnaMaterialu - 60 - x, 60) });
  }
  return [...pola, ...pozycje];
}

// Wartości wpisane z góry: adres z tabeli montażowej i dzisiejsza data.
export function wartosciPoczatkowe(pola, { adres, data }) {
  const z = { adres, data };
  return Object.fromEntries(pola.filter(p => z[p.rodzaj]).map(p => [p.id, z[p.rodzaj]]));
}

// Ilość pozycji po zapisie: wpisana z klawiatury, odczyt pisma z jej pola
// albo ilość z wydruku - w tej kolejności.
export function iloscKoncowa(pole, odczyt, reczne = {}) {
  const r = String(reczne?.[pole.id] ?? '').trim();
  if (r) return r;
  const w = odczyt?.wartosci || {};
  return pole.id in w ? String(w[pole.id] ?? '').trim() : (pole.wydrukowano || '');
}

// Ilość wpisana z klawiatury (ma pierwszeństwo przed pismem i wydrukiem).
export const recznaIlosc = (pole, reczne) => String(reczne?.[pole.id] ?? '').trim();

// --- arkusz „Materiałówka” ------------------------------------------------------

export const KOLUMNY_MATERIALOWKI = ['adres', 'towar', 'liczba', 'zestaw', 'data zapisania', 'data zatwierdzenia', 'do sprawdzenia'];

/**
 * Wiersze materiałówki: jeden na pozycję z ilością (skreślone do zera pomijamy)
 * i na każdą pozycję dopisaną spoza zestawu.
 * pola: zapisane w rekordzie, odczyt: { wartosci, niepewne } z odczytu pisma,
 * reczne: ilości wpisane z klawiatury (id pola -> tekst),
 * dodatkowe: [{ nazwa, ilosc }] - pozycje dopisane.
 */
export function wierszeMaterialowki({ pola, odczyt, reczne = {}, dodatkowe = [], adres, zestaw, zapisano, zatwierdzono }) {
  const niepewne = odczyt?.niepewne || [];
  const wiersz = (towar, ilosc, zestawWiersza, sprawdzic) => {
    const liczba = wartoscKomorki(ilosc);
    if (ilosc === '' || liczba === 0) return [];
    return [{
      adres,
      towar,
      liczba,
      zestaw: zestawWiersza,
      'data zapisania': dataCzytelna(zapisano),
      'data zatwierdzenia': dataCzytelna(zatwierdzono),
      'do sprawdzenia': sprawdzic ? 'tak' : ''
    }];
  };
  return [
    ...pola.filter(p => p.rodzaj === 'ilosc').flatMap(p =>
      wiersz(p.etykieta, iloscKoncowa(p, odczyt, reczne), zestaw || '', !recznaIlosc(p, reczne) && niepewne.includes(p.id))),
    ...dodatkowe.flatMap(d => wiersz(String(d.nazwa || '').trim(), String(d.ilosc ?? '').trim(), zestaw ? `${zestaw} – dopisane` : 'dopisane', false))
  ];
}

/**
 * Zastąpienie wierszy adresu w arkuszu materiałówki: nowe na końcu, stare
 * (ten sam adres) do usunięcia. Kolumny po nagłówku (1. wiersz), brakujące
 * dopisywane na końcu nagłówka.
 * @returns {{ dane, dopisz: {wiersz, wartosci}, doUsuniecia: number[], szerokosc }}
 */
export function zmianyMaterialowki({ arkusz, wiersze, nowe, adres }) {
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
  KOLUMNY_MATERIALOWKI.forEach(indeks);
  const iAdres = indeks('adres');
  const klucz = kluczAdresu(adres);
  const doUsuniecia = [];
  wiersze.forEach((w, i) => { if (i > 0 && String(w?.[iAdres] ?? '').trim() && kluczAdresu(w[iAdres]) === klucz) doUsuniecia.push(i); });
  const wartosci = nowe.map(obiekt => {
    const w = new Array(kolumny.length).fill('');
    for (const [k, v] of Object.entries(obiekt)) w[indeks(k)] = v ?? '';
    return w;
  });
  return { dane, dopisz: { wiersz: Math.max(wiersze.length, 1) + 1, wartosci }, doUsuniecia, szerokosc: kolumny.length };
}

// Arkusz materiałówki dla rodzaju instalacji: zakładka „PC”/„PV”, a gdy jest
// tylko jedna zakładka - ta jedna.
export function arkuszMaterialowki(tytuly, rodzaj) {
  const n = normalizuj(rodzaj);
  return tytuly.find(t => normalizuj(t) === n) || (tytuly.length === 1 ? tytuly[0] : null);
}

// --- tabela montażowa ----------------------------------------------------------------

// Kolumny dat w wierszu adresu: „data wydania materiału” / „wydania zestawu”
// (zapis) i „Data zakończenia montażu” (zatwierdzenie).
const KOLUMNA_ZAPISU = /wydani/;
const KOLUMNA_ZATWIERDZENIA = /zakonczeni/;

function kolumnyDat(wiersze) {
  const naglowek = znajdzNaglowek(wiersze);
  if (!naglowek) return null;
  const nazwy = (wiersze[naglowek.wiersz] || []).map(normalizuj);
  return { zapis: nazwy.findIndex(n => KOLUMNA_ZAPISU.test(n)), zatwierdzenie: nazwy.findIndex(n => KOLUMNA_ZATWIERDZENIA.test(n)), nazwy: wiersze[naglowek.wiersz] };
}

// Data do komórki arkusza (USER_ENTERED) - ISO, rozumiana w każdym ustawieniu regionalnym.
const dataArkusza = iso => {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Komórki dat w wierszu adresu. Data zatwierdzenia tylko wpisywana, nigdy
 * czyszczona (kolumnę zakończenia montażu może uzupełniać też biuro).
 * @returns {{ dane: {range, values}[], brak: string[] }} brak - opisy brakujących kolumn
 */
export function datyWMontazowej({ arkusz, wiersze, nrWiersza, zapisano, zatwierdzono }) {
  const k = kolumnyDat(wiersze);
  const komorka = (kol, w) => `'${arkusz.replace(/'/g, "''")}'!${kolumnaA1(kol)}${w}`;
  if (!k) return { dane: [], brak: [`arkusz ${arkusz} nie ma nagłówka z kolumną „Adres”`] };
  const dane = [];
  const brak = [];
  if (k.zapis === -1) brak.push(`w arkuszu ${arkusz} nie ma kolumny „data wydania…”`);
  else if (zapisano) dane.push({ range: komorka(k.zapis, nrWiersza), values: [[dataArkusza(zapisano)]] });
  if (zatwierdzono) {
    if (k.zatwierdzenie === -1) brak.push(`w arkuszu ${arkusz} nie ma kolumny „data zakończenia…”`);
    else dane.push({ range: komorka(k.zatwierdzenie, nrWiersza), values: [[dataArkusza(zatwierdzono)]] });
  }
  return { dane, brak };
}

/**
 * Usunięta (niezatwierdzona) materiałówka: czyszczenie daty wydania w wierszu
 * adresu. Data zakończenia zostaje - nie usuwa się zatwierdzonych.
 * @returns {{ dane: {range, values}[], kolumna: number }} kolumna - indeks daty wydania albo -1
 */
export function wyczyscWydanie({ arkusz, wiersze, nrWiersza }) {
  const k = kolumnyDat(wiersze);
  if (!k || k.zapis === -1 || !String(wiersze[nrWiersza - 1]?.[k.zapis] ?? '').trim()) return { dane: [], kolumna: k?.zapis ?? -1 };
  return { dane: [{ range: `'${arkusz.replace(/'/g, "''")}'!${kolumnaA1(k.zapis)}${nrWiersza}`, values: [['']] }], kolumna: k.zapis };
}

// Ekipa z kolumny „Ekipa…” w wierszu adresu tabeli montażowej.
export function ekipaZMontazowej(wiersze, nrWiersza) {
  const naglowek = znajdzNaglowek(wiersze);
  if (!naglowek) return '';
  const i = (wiersze[naglowek.wiersz] || []).map(normalizuj).findIndex(n => /^\s*ekip/.test(n));
  return i === -1 ? '' : String(wiersze[nrWiersza - 1]?.[i] ?? '').trim();
}

// Stan materiałówki z wiersza adresu: { wydano, zakonczono, maKolumneZatwierdzenia }
// (surowe wartości komórek).
export function datyZMontazowej(wiersze, nrWiersza) {
  const k = kolumnyDat(wiersze);
  const w = wiersze[nrWiersza - 1] || [];
  const wartosc = i => (i === -1 || !k ? '' : String(w[i] ?? '').trim());
  return { wydano: wartosc(k?.zapis ?? -1), zakonczono: wartosc(k?.zatwierdzenie ?? -1), maKolumneZatwierdzenia: Boolean(k && k.zatwierdzenie !== -1) };
}

// Wartość komórki daty (liczba seryjna Arkuszy albo tekst) do wyświetlenia.
export function dataZKomorki(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    const p = x => String(x).padStart(2, '0');
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }
  return String(v);
}

function kolumnaA1(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Podpowiedź zestawu z tabeli montażowej: numer z nazwy pliku („set 9012”)
// w którejś komórce wiersza adresu („VPM9012”). Tylko jednoznaczne trafienie.
export function podpowiedzZestawu(zestawy, wierszeAdresu) {
  const komorki = wierszeAdresu.flat().map(v => String(v ?? ''));
  const trafione = zestawy.filter(z => (z.nazwa.match(/\d{3,}/g) || []).some(nr => {
    const wzor = new RegExp(`(^|\\D)${nr}(\\D|$)`);
    return komorki.some(k => wzor.test(k));
  }));
  return trafione.length === 1 ? trafione[0] : null;
}

// --- Stan do edycji zapisany w samym PDF ---
//
// PDF na Dysku ma pismo wtopione w stronę. Żeby dało się go poprawić na
// dowolnym urządzeniu, w środku jest załącznik z wartościami, kreskami
// i czystym wzorem. Przeglądarki PDF pokazują normalnie sam wniosek.

export const ZALACZNIK_STANU = 'wniosek-stan.json';
export const ZALACZNIK_WZORU = 'wniosek-wzor.pdf';

export function zalacznikiStanu(stan, wzorBajty) {
  return [
    { nazwa: ZALACZNIK_STANU, bajty: new TextEncoder().encode(JSON.stringify({ wersja: 2, ...stan })), mimeType: 'application/json', opis: 'Dane do edycji materiałówki w aplikacji Audyt' },
    { nazwa: ZALACZNIK_WZORU, bajty: new Uint8Array(wzorBajty), mimeType: 'application/pdf', opis: 'Czysty zestaw' }
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
