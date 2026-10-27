// Rozpoznawanie arkuszy tabeli montażowej i scalanie adresów ze wszystkich
// typów instalacji (kotły, solary, PV_ME, pompy ciepła) w jedną listę.
//
// Moduł bez zależności - działa i w przeglądarce, i w testach Node. Dostaje
// już odczytane arkusze: [{ nazwa, wiersze: [[komórka, ...], ...] }] - to ten
// sam kształt, który zwraca Google Sheets API (values) i SheetJS (header: 1).
//
// Logika rozpoznawania pochodzi ze Scyzoryka (lib/investmentAddressTable.js),
// ale poszerzona po przejrzeniu realnych tabel kilku inwestycji: nazwy
// arkuszy są różne w każdej z nich ("MIASTO - PC", "pompy ciepła audyt",
// "MIASTO PV_", "PV_ME"...), a obok są
// arkusze pomocnicze, które trzeba pominąć.

export const TYPY = [
  { id: 'kotly', etykieta: 'Kotły', skrot: 'KOT' },
  { id: 'solary', etykieta: 'Solary', skrot: 'SOL' },
  { id: 'pv_me', etykieta: 'PV / ME', skrot: 'PV' },
  { id: 'pompy', etykieta: 'Pompy ciepła', skrot: 'PC' }
];

// "ł" nie rozkłada się pod NFD jak pozostałe polskie litery - bez jawnej
// podmiany "kotły" zamienia się w "kot y" (ta sama pułapka co w Scyzoryku).
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

// Arkusze pomocnicze widziane w realnych tabelach: "tabela do protokołu
// odbioru ...", "ekipy", "umowa", "Unikalne Adresy".
const ARKUSZE_POMIJANE = /protok|odbior|ekip|umow|unikaln|zestawien|podsumow/;

// Kolejność ma znaczenie: "pompy" przed "pv_me", bo arkusz PV bywa nazwany
// tylko "PV_", a pompy "PC".
const WZORCE_ARKUSZY = [
  ['kotly', /\bkot|\bkoci/],
  ['solary', /solar|kolektor|\bsol\b/],
  ['pompy', /pomp|\bpc\b/],
  ['pv_me', /\bpv|fotowolt|\bme\b/]
];

// Arkusze z eksportu innego systemu mają losowe nazwy w rodzaju
// "Rdw8Y915ZdaTYRO5aJiw" - nigdy nie są tabelą montażową.
const LOSOWA_NAZWA = /^[A-Za-z0-9]{16,}$/;

export function rozpoznajTypArkusza(nazwa) {
  const surowa = String(nazwa ?? '').trim();
  if (LOSOWA_NAZWA.test(surowa)) return null;
  const n = normalizuj(surowa);
  if (!n || ARKUSZE_POMIJANE.test(n)) return null;
  for (const [typ, wzorzec] of WZORCE_ARKUSZY) {
    if (wzorzec.test(n)) return typ;
  }
  return null;
}

// Każda kolumna: funkcja dopasowująca znormalizowany nagłówek. Uwaga na
// "Odbiór Gmina (wypełnia biuro)" - to NIE jest kolumna z nazwą gminy, więc
// gminy celowo tu nie ma.
const KOLUMNY = {
  adres: n => n === 'adres',
  lp: n => n === 'lp' || n === 'l p',
  uid: n => n === 'uid',
  nazwisko: n => n.startsWith('imie i nazwisko') || n === 'nazwisko' || n === 'imie nazwisko',
  telefon: n => n.includes('telefon') || n === 'nr tel' || n === 'tel',
  email: n => n === 'e mail' || n === 'email' || n === 'mail' || n === 'adres e mail',
  obreb: n => n.startsWith('obreb'),
  rezygnacja: n => n.startsWith('rezyg'),
  rodzajPompy: n => n.startsWith('rodzaj pompy')
};

// Arkusz z eksportu innego systemu audytów (np. zakładka "Pompy Ciepła" w
// tabeli Masłowic) zaczyna się od angielskich kluczy "uid", "address", ...
// To nie jest lista montażowa. Uwaga: prawdziwe tabele montażowe też mają
// kolumny "audit_0_..." doklejone daleko po prawej - dlatego patrzymy tylko
// na pierwsze kolumny.
export function czyEksport(wiersze) {
  return (wiersze || []).slice(0, 3).some(w => (w || []).slice(0, 5).some(k => String(k ?? '').trim() === 'address'));
}

// "Gruntowa" -> grunt, "Powietrze-woda" / "powietrzna" -> powietrze.
function rodzajPompy(wartosc) {
  const n = normalizuj(wartosc);
  if (/grunt/.test(n)) return 'grunt';
  if (/powietrz/.test(n)) return 'powietrze';
  return null;
}

function indeksKolumn(wierszNaglowka) {
  const indeks = {};
  wierszNaglowka.forEach((komorka, i) => {
    const n = normalizuj(komorka);
    if (!n) return;
    for (const [pole, pasuje] of Object.entries(KOLUMNY)) {
      if (indeks[pole] === undefined && pasuje(n)) indeks[pole] = i;
    }
  });
  return indeks;
}

export function znajdzNaglowek(wiersze) {
  for (let i = 0; i < Math.min(wiersze.length, 20); i += 1) {
    const indeks = indeksKolumn(wiersze[i] || []);
    if (indeks.adres !== undefined) return { wiersz: i, indeks };
  }
  return null;
}

function tekst(wartosc) {
  if (wartosc === null || wartosc === undefined) return '';
  const t = String(wartosc).trim();
  // Błędy formuł z Excela/Sheets traktujemy jak pustą komórkę.
  return /^#(N\/A|ERROR!|REF!|VALUE!|DIV\/0!|NAME\?)$/i.test(t) ? '' : t;
}

// Znacznik dopisywany ręcznie przed adresem, np. "ŻŻŻ Przykładowo 67" w arkuszu
// pomp jednej z inwestycji - to nie jest część adresu.
export function oczyscAdres(adres) {
  return String(adres ?? '')
    .replace(/^\s*([ŻżZzXx*#!])\1{2,}\s*/, '')
    .replace(/[\s,;]+$/, '') // "PRZYKŁADOWO 26," - przecinek na końcu adresu
    .replace(/\s+/g, ' ')
    .trim();
}

// W części tabel e-mail siedzi w kolumnie telefonu:
// "48500100200 / jan.przykladowy@example.com". Protokół ma osobne pola.
const EMAIL = /[^\s/,;]+@[^\s/,;]+\.[a-z]{2,}/gi;

export function rozdzielKontakt(telefonSurowy, emailSurowy = '') {
  const emaile = [...String(telefonSurowy).matchAll(EMAIL), ...String(emailSurowy).matchAll(EMAIL)].map(m => m[0]);
  const telefon = String(telefonSurowy)
    .replace(EMAIL, '')
    .split(/[,;/]/)
    .map(t => formatujTelefon(t.trim()))
    .filter(Boolean)
    .join(', ');
  return { telefon, email: [...new Set(emaile)].join(', ') };
}

// "48500100200" -> "+48 500 100 200", "500100200" -> "500 100 200";
// wszystko inne (np. "504 137 818 tu dzwonić") zostaje bez zmian.
function formatujTelefon(t) {
  const cyfry = t.replace(/[\s-]/g, '');
  const m = /^(?:\+?48)?(\d{9})$/.exec(cyfry);
  if (!m) return t;
  const numer = m[1].replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return /^\+?48\d{9}$/.test(cyfry) ? `+48 ${numer}` : numer;
}

function czyRezygnacja(wartosc) {
  const n = normalizuj(wartosc);
  return Boolean(n) && !['n', 'nie', '0', 'false'].includes(n);
}

export function odczytajArkusz(arkusz, typ) {
  const wiersze = Array.isArray(arkusz.wiersze) ? arkusz.wiersze : [];
  const naglowek = znajdzNaglowek(wiersze);
  if (!naglowek) return { nazwa: arkusz.nazwa, typ, blad: 'Nie znaleziono kolumny „Adres” w pierwszych 20 wierszach.', rekordy: [] };

  const { indeks } = naglowek;
  const wez = (wiersz, pole) => (indeks[pole] === undefined ? '' : tekst(wiersz[indeks[pole]]));
  const rekordy = [];
  for (let i = naglowek.wiersz + 1; i < wiersze.length; i += 1) {
    const wiersz = wiersze[i] || [];
    const adres = oczyscAdres(wez(wiersz, 'adres'));
    if (!adres) continue;
    const { telefon, email } = rozdzielKontakt(wez(wiersz, 'telefon'), wez(wiersz, 'email'));
    rekordy.push({
      typ,
      arkusz: arkusz.nazwa,
      wiersz: i + 1, // numer wiersza jak w arkuszu (od 1) - przyda się do zapisu statusu
      adres,
      lp: wez(wiersz, 'lp'),
      uid: wez(wiersz, 'uid'),
      nazwisko: wez(wiersz, 'nazwisko'),
      telefon,
      email,
      obreb: wez(wiersz, 'obreb'),
      rezygnacja: czyRezygnacja(wez(wiersz, 'rezygnacja')),
      rodzajPompy: typ === 'pompy' ? rodzajPompy(wez(wiersz, 'rodzajPompy')) : null
    });
  }
  return { nazwa: arkusz.nazwa, typ, blad: null, rekordy };
}

// Klucz porównania adresów: bez polskich znaków, bez "ul."/"al.", słowa
// posortowane - żeby "ul. Pogodna 31, Przykładowo" i "Przykładowo, ul. Pogodna 31"
// były tym samym adresem. "13 A" i "13A" też są tym samym.
const SLOWA_POMIJANE = new Set(['ul', 'al', 'os', 'pl', 'gm', 'gmina']);

export function kluczAdresu(adres) {
  return normalizuj(adres)
    .replace(/\b(\d+)\s+([a-z])\b/g, '$1$2')
    .split(' ')
    .filter(slowo => slowo && !SLOWA_POMIJANE.has(slowo))
    .sort()
    .join(' ');
}

// arkusze: [{ nazwa, wiersze }]
// przypisania (opcjonalnie): { [nazwaArkusza]: typ | null } - ręczna korekta
// rozpoznania przez audytora; brak wpisu = rozpoznanie automatyczne.
export function zbudujListeAdresow(arkusze, przypisania = {}) {
  const arkuszeInfo = arkusze.map(arkusz => {
    const eksport = czyEksport(arkusz.wiersze);
    const auto = eksport ? null : rozpoznajTypArkusza(arkusz.nazwa);
    const typ = Object.prototype.hasOwnProperty.call(przypisania, arkusz.nazwa) ? przypisania[arkusz.nazwa] : auto;
    return { nazwa: arkusz.nazwa, auto, typ, eksport, liczbaWierszy: (arkusz.wiersze || []).length };
  });

  const odczytane = [];
  for (const info of arkuszeInfo) {
    if (!info.typ) continue;
    const arkusz = arkusze.find(a => a.nazwa === info.nazwa);
    const wynik = odczytajArkusz(arkusz, info.typ);
    info.blad = wynik.blad;
    info.liczbaAdresow = wynik.rekordy.length;
    odczytane.push(...wynik.rekordy);
  }

  // Scalanie (union-find):
  // 1. ten sam klucz adresu = jeden adres,
  // 2. ten sam UID w RÓŻNYCH arkuszach = jeden adres - łapie literówki między
  //    arkuszami ("UL. FREDRY 21" / "UL. FREDY 21").
  // UID w obrębie jednego arkusza celowo NIE scala: w jednej z tabel ten sam UID
  // mają różne domy ("Przykładowo 13 a" i "Przykładowo 13b"). Z tego samego powodu
  // UID powtórzony w którymkolwiek arkuszu w ogóle nie bierze udziału w
  // scalaniu - inaczej połączyłby łańcuchem różne domy.
  const rodzic = odczytane.map((_, i) => i);
  const korzen = i => (rodzic[i] === i ? i : (rodzic[i] = korzen(rodzic[i])));
  const polacz = (a, b) => { rodzic[korzen(a)] = korzen(b); };

  const poKluczu = new Map();
  odczytane.forEach((r, i) => {
    const k = kluczAdresu(r.adres);
    if (poKluczu.has(k)) polacz(i, poKluczu.get(k)); else poKluczu.set(k, i);
  });

  const poUid = new Map(); // uid -> Map(arkusz -> [indeksy])
  odczytane.forEach((r, i) => {
    if (r.uid.length < 8) return;
    if (!poUid.has(r.uid)) poUid.set(r.uid, new Map());
    const wArkuszach = poUid.get(r.uid);
    if (!wArkuszach.has(r.arkusz)) wArkuszach.set(r.arkusz, []);
    wArkuszach.get(r.arkusz).push(i);
  });
  for (const wArkuszach of poUid.values()) {
    const listy = [...wArkuszach.values()];
    if (listy.length < 2 || listy.some(l => l.length > 1)) continue;
    for (let j = 1; j < listy.length; j += 1) polacz(listy[j][0], listy[0][0]);
  }

  const grupy = new Map();
  odczytane.forEach((r, i) => {
    const k = korzen(i);
    if (!grupy.has(k)) grupy.set(k, []);
    grupy.get(k).push(r);
  });

  const kolejnoscTypow = TYPY.map(t => t.id);
  const adresy = [...grupy.values()].map(rekordy => {
    // Na główny adres wybieramy zapis z numerem domu, a nie numer działki
    // ("Przykładowo 22D" zamiast "Przykładowo dz. Ozn. Nr 31/2") - z nim audytor trafi na miejsce.
    const pierwszy = rekordy.find(r => !/\bdz\b|dzialk|ewid/.test(normalizuj(r.adres))) || rekordy[0];
    const id = kluczAdresu(pierwszy.adres);
    // Różne zapisy tego samego adresu (literówki między arkuszami) - audytor
    // powinien je zobaczyć, zamiast żebyśmy po cichu wybrali jeden.
    const warianty = [...new Map([pierwszy, ...rekordy].map(r => [kluczAdresu(r.adres), r.adres])).values()];
    const zPola = pole => (rekordy.find(r => r[pole]) || {})[pole] || '';
    const typy = [...new Set(rekordy.map(r => r.typ))].sort((a, b) => kolejnoscTypow.indexOf(a) - kolejnoscTypow.indexOf(b));
    // Pod jednym adresem bywa kilka osób (np. dwa gospodarstwa
    // w jednym budynku) - pokazujemy wszystkie, bez powtórzeń.
    const nazwiska = [...new Map(rekordy.filter(r => r.nazwisko).map(r => [normalizuj(r.nazwisko), r.nazwisko])).values()];
    return {
      id,
      adres: pierwszy.adres,
      warianty,
      nazwisko: nazwiska.join('; '),
      telefon: zPola('telefon'),
      email: zPola('email'),
      rodzajPompy: zPola('rodzajPompy') || null,
      uid: zPola('uid'),
      obreb: zPola('obreb'),
      typy,
      // Rezygnacja liczy się tylko, gdy zrezygnowano ze WSZYSTKIEGO pod tym adresem.
      rezygnacja: rekordy.every(r => r.rezygnacja),
      rekordy
    };
  }).sort((a, b) => a.adres.localeCompare(b.adres, 'pl', { numeric: true }));

  const liczniki = Object.fromEntries(TYPY.map(t => [t.id, adresy.filter(a => a.typy.includes(t.id)).length]));
  return { arkusze: arkuszeInfo, adresy, liczniki, razem: adresy.length };
}
