import * as pdfjs from './vendor/pdf.min.mjs';
import { TYPY, normalizuj, rozpoznajTypArkusza, zbudujListeAdresow } from './src/tabela.js';
import { odczytaj, zapisz, wszystkie } from './src/magazyn.js';
import { wyliczWpisy, tekstSzablonu } from './src/wypelnianie.js';
import { utworzEdytor } from './src/edytor.js';
import { zbudujPdf } from './src/eksport.js';
import * as google from './src/google.js';

pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

// Stan aplikacji. "inwestycja" i audyty przeżywają zamknięcie aplikacji
// (IndexedDB), reszta to stan widoku.
const stan = {
  // { nazwa, zrodlo: { rodzaj: 'google'|'plik', id?, nazwa }, arkusze: [{ nazwa, wiersze }],
  //   przypisania, szablony: { typ: idSzablonu }, folder: { id, nazwa } }
  inwestycja: null,
  wynik: null, // wynik zbudujListeAdresow
  audyty: new Map(), // klucz audytu -> { status, zmieniono }
  filtrTypu: null,
  szukaj: '',
  pokazRezygnacje: false,
  audyt: null // otwarty protokół: { rekord, edytor, dokument, strony, szablon }
};

const $ = id => document.getElementById(id);
const TYP = Object.fromEntries(TYPY.map(t => [t.id, t]));

// Budowanie DOM bez innerHTML - dane z arkuszy trafiają tylko do textContent.
function el(tag, wlasciwosci = {}, ...dzieci) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(wlasciwosci)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const d of dzieci.flat()) if (d !== null && d !== undefined && d !== false) e.append(d);
  return e;
}

const znaczekTypu = typ => el('span', { class: `znaczek ${typ}`, title: TYP[typ].etykieta }, TYP[typ].skrot);

// --- Nawigacja: hash, żeby systemowy przycisk "wstecz" Androida działał ---

const EKRANY = ['ekran-tabela', 'ekran-adresy', 'ekran-adres', 'ekran-audyt'];

function pokazEkran(id, tytul) {
  for (const e of EKRANY) $(e).hidden = e !== id;
  document.body.classList.toggle('tryb-audyt', id === 'ekran-audyt');
  $('tytul').textContent = tytul;
  $('wstecz').hidden = id === 'ekran-tabela';
  window.scrollTo(0, 0);
}

const znajdzAdres = id => stan.wynik?.adresy.find(a => a.id === id);

function trasa() {
  const hash = location.hash.slice(1);
  const [ekran, ...parametry] = hash.split('/').map(decodeURIComponent);
  if (ekran !== 'audyt') zamknijAudyt();
  if (ekran === 'adresy' && stan.wynik) return renderujAdresy();
  if (ekran === 'adres' && znajdzAdres(parametry[0])) return renderujAdres(znajdzAdres(parametry[0]));
  if (ekran === 'audyt' && znajdzAdres(parametry[0]) && TYP[parametry[1]]) return otworzAudyt(znajdzAdres(parametry[0]), parametry[1]);
  renderujTabele();
}

const kluczAudytu = (adres, typ) => `${stan.inwestycja.nazwa}|${adres.id}|${typ}`;

window.addEventListener('hashchange', trasa);
$('wstecz').addEventListener('click', () => history.back());

// --- Ekran 1: tabela montażowa ---

function nazwaInwestycji(nazwaPliku) {
  // "MIASTO 2025 - TAB. MONTAŻOWA - solary, pompy, PV, ME.xlsx" -> "MIASTO 2025"
  // "tabela adresowa Miasto.xlsx" -> "Miasto"
  const bezRozszerzenia = nazwaPliku.replace(/\.[^.]+$/, '');
  return bezRozszerzenia.split(/\s+-\s+tab/i)[0].replace(/^tabela (adresowa|montażowa)\s+/i, '').trim() || bezRozszerzenia;
}

async function wczytajPlik(plik) {
  $('blad-tabeli').hidden = true;
  try {
    const wb = window.XLSX.read(await plik.arrayBuffer(), { type: 'array' });
    const arkusze = wb.SheetNames.map(nazwa => ({
      nazwa,
      // Surowe wartości: sformatowane zamieniłyby telefon 500100200 w "500,100,200".
      wiersze: window.XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, defval: null, blankrows: false })
    }));
    await ustawNowaTabele(nazwaInwestycji(plik.name), { rodzaj: 'plik', nazwa: plik.name }, arkusze);
  } catch (blad) {
    pokazBladTabeli(`Nie udało się odczytać pliku: ${blad.message}`);
  }
}

function pokazBladTabeli(tekst) {
  if (tekst) console.error(tekst);
  $('blad-tabeli').textContent = tekst || '';
  $('blad-tabeli').hidden = !tekst;
}

// Szablony, folder i ręczne przypisania arkuszy zostają przy wczytaniu
// nowszej wersji tej samej tabeli (np. "Odśwież z Dysku").
async function ustawNowaTabele(nazwa, zrodlo, arkusze) {
  const poprzednia = stan.inwestycja?.nazwa === nazwa ? stan.inwestycja : {};
  await ustawInwestycje({
    nazwa,
    zrodlo,
    arkusze,
    przypisania: poprzednia.przypisania || {},
    szablony: poprzednia.szablony || {},
    folder: poprzednia.folder || null
  });
  renderujTabele();
}

async function wczytajZGoogle(idArkusza) {
  pokazBladTabeli('');
  const przycisk = $('z-drive');
  przycisk.disabled = true;
  try {
    const plik = idArkusza ? { id: idArkusza } : await google.wybierzTabele();
    if (!plik) return;
    const { tytul, arkusze } = await google.odczytajTabele(plik.id);
    await ustawNowaTabele(nazwaInwestycji(tytul), { rodzaj: 'google', id: plik.id, nazwa: tytul }, arkusze);
  } catch (blad) {
    pokazBladTabeli(`Nie udało się wczytać tabeli z Dysku: ${blad.message}`);
  } finally {
    przycisk.disabled = false;
  }
}

$('z-drive').addEventListener('click', () => {
  if (!google.skonfigurowany()) { pokazBladTabeli('Połączenie z Google nie jest jeszcze skonfigurowane (config.js).'); return; }
  if (!navigator.onLine) { pokazBladTabeli('Brak internetu – tabelę z Dysku wczytasz, gdy będzie zasięg.'); return; }
  wczytajZGoogle();
});
$('odswiez-tabele').addEventListener('click', () => wczytajZGoogle(stan.inwestycja?.zrodlo?.id));

async function ustawInwestycje(inwestycja) {
  stan.inwestycja = inwestycja;
  stan.wynik = zbudujListeAdresow(inwestycja.arkusze, inwestycja.przypisania);
  try {
    await zapisz('inwestycje', 'biezaca', inwestycja);
  } catch (blad) {
    // Bez pamięci (np. tryb prywatny) aplikacja działa dalej, tylko nie
    // zapamięta tabeli do następnego uruchomienia.
    console.warn('Nie zapisano tabeli w pamięci tabletu', blad);
  }
}

$('z-pliku').addEventListener('change', e => {
  const plik = e.target.files[0];
  e.target.value = '';
  if (plik) wczytajPlik(plik);
});

function renderujTabele() {
  pokazEkran('ekran-tabela', 'Audyt');
  const karta = $('karta-arkusze');
  if (!stan.wynik) { karta.hidden = true; return; }
  karta.hidden = false;
  $('nazwa-inwestycji').textContent = stan.inwestycja.nazwa;
  const zrodlo = stan.inwestycja.zrodlo || {};
  $('zrodlo-tabeli').textContent = zrodlo.rodzaj === 'google' ? `Dysk Google: ${zrodlo.nazwa}` : `Plik: ${zrodlo.nazwa || '—'}`;
  $('odswiez-tabele').hidden = zrodlo.rodzaj !== 'google';
  $('folder-protokolow').textContent = stan.inwestycja.folder?.nazwa || 'nie wybrano – protokoły zostaną w tablecie';
  $('folder-protokolow').classList.toggle('brak', !stan.inwestycja.folder);

  const opcje = [{ id: '', etykieta: '— pomiń —' }, ...TYPY];
  const wierszArkusza = arkusz => {
    const select = el('select', {
      'aria-label': `Typ arkusza ${arkusz.nazwa}`,
      onchange: e => zmienPrzypisanie(arkusz.nazwa, e.target.value || null)
    }, opcje.map(o => el('option', { value: o.id, selected: (arkusz.typ || '') === o.id }, o.etykieta)));
    let info = null;
    if (arkusz.blad) info = el('span', { class: 'info blad' }, arkusz.blad);
    else if (arkusz.typ) info = el('span', { class: 'info' }, `${arkusz.liczbaAdresow} adresów${arkusz.typ !== arkusz.auto ? ' · zmienione ręcznie' : ''}`);
    return el('li', {}, el('span', { class: 'nazwa' }, arkusz.nazwa), select, info);
  };
  // Pominięte arkusze (protokoły, ekipy, umowa...) zwinięte, żeby nie
  // zasłaniały tych ważnych - ale da się je rozwinąć i przypisać ręcznie.
  const uzyte = stan.wynik.arkusze.filter(a => a.typ);
  const pominiete = stan.wynik.arkusze.filter(a => !a.typ);
  $('lista-arkuszy').replaceChildren(...uzyte.map(wierszArkusza));
  if (pominiete.length > 0) {
    $('lista-arkuszy').append(el('li', { class: 'pominiete' },
      el('details', {},
        el('summary', {}, `Pominięte arkusze (${pominiete.length})`),
        el('ul', { class: 'arkusze' }, pominiete.map(wierszArkusza))
      )
    ));
  }

  // Szablon dla każdego typu instalacji, który występuje w tabeli.
  const szablony = stan.inwestycja.szablony || {};
  $('lista-szablonow').replaceChildren(...TYPY.filter(t => stan.wynik.liczniki[t.id] > 0).map(t => el('li', {},
    znaczekTypu(t.id),
    el('span', { class: 'nazwa' }, t.etykieta),
    el('span', { class: szablony[t.id] ? 'plik' : 'plik brak' }, szablony[t.id]?.split('|')[0] || 'brak szablonu'),
    el('button', { type: 'button', class: 'maly', onclick: () => wybierzSzablon(t.id) }, szablony[t.id] ? 'Zmień' : 'Wczytaj PDF')
  )));

  const { razem } = stan.wynik;
  $('pokaz-adresy').textContent = razem ? `Pokaż adresy (${razem})` : 'Brak adresów – przypisz arkusze';
  $('pokaz-adresy').disabled = !razem;
}

// Szablon z Dysku Google (gdy skonfigurowany i jest internet), inaczej z pliku na tablecie.
let typWybieranegoSzablonu = null;
async function wybierzSzablon(typ) {
  typWybieranegoSzablonu = typ;
  if (!google.skonfigurowany() || !navigator.onLine) { $('plik-szablonu').click(); return; }
  try {
    const plik = await google.wybierzSzablon();
    if (plik) await zapamietajSzablon(typ, `${plik.name}|${plik.id}`, plik.name, await google.pobierzPlik(plik.id));
  } catch (blad) {
    alert(`Nie udało się wczytać szablonu z Dysku: ${blad.message}`);
  }
  renderujTabele();
}

async function zapamietajSzablon(typ, id, nazwa, bajty) {
  // Sprawdzenie, czy to w ogóle da się otworzyć, zanim zapamiętamy.
  await pdfjs.getDocument({ data: new Uint8Array(bajty.slice(0)) }).promise;
  await zapisz('szablony', id, { nazwa, bajty });
  await ustawInwestycje({ ...stan.inwestycja, szablony: { ...stan.inwestycja.szablony, [typ]: id } });
}

$('plik-szablonu').addEventListener('change', async e => {
  const plik = e.target.files[0];
  e.target.value = '';
  if (!plik || !typWybieranegoSzablonu) return;
  try {
    await zapamietajSzablon(typWybieranegoSzablonu, `${plik.name}|${plik.size}`, plik.name, await plik.arrayBuffer());
  } catch (blad) {
    console.error(blad);
    alert(`Nie udało się wczytać szablonu: ${blad.message}`);
  }
  renderujTabele();
});

$('wybierz-folder').addEventListener('click', async () => {
  if (!google.skonfigurowany()) { alert('Połączenie z Google nie jest jeszcze skonfigurowane.'); return; }
  if (!navigator.onLine) { alert('Brak internetu – folder wybierzesz, gdy będzie zasięg.'); return; }
  try {
    const folder = await google.wybierzFolder();
    if (folder) await ustawInwestycje({ ...stan.inwestycja, folder: { id: folder.id, nazwa: folder.name } });
  } catch (blad) {
    alert(`Nie udało się wybrać folderu: ${blad.message}`);
  }
  renderujTabele();
});

async function zmienPrzypisanie(nazwaArkusza, typ) {
  const przypisania = { ...stan.inwestycja.przypisania };
  if (typ === rozpoznajTypArkusza(nazwaArkusza)) delete przypisania[nazwaArkusza];
  else przypisania[nazwaArkusza] = typ;
  await ustawInwestycje({ ...stan.inwestycja, przypisania });
  renderujTabele();
}

$('pokaz-adresy').addEventListener('click', () => { location.hash = 'adresy'; });

// --- Ekran 2: lista adresów ---

function tekstDoSzukania(a) {
  return normalizuj([a.adres, ...a.warianty, a.nazwisko, a.telefon, a.obreb].join(' '));
}

function renderujAdresy() {
  pokazEkran('ekran-adresy', stan.inwestycja.nazwa);
  // Liczniki zgodne z tym, co widać na liście - bez rezygnacji, chyba że
  // audytor je włączył.
  const adresy = stan.wynik.adresy.filter(a => stan.pokazRezygnacje || !a.rezygnacja);
  const razem = adresy.length;
  const liczniki = Object.fromEntries(TYPY.map(t => [t.id, adresy.filter(a => a.typy.includes(t.id)).length]));

  const chip = (id, etykieta, liczba) => el('button', {
    type: 'button',
    class: `licznik${id ? '' : ' razem'}`,
    'aria-pressed': String(stan.filtrTypu === id),
    onclick: () => { stan.filtrTypu = id; renderujAdresy(); }
  }, `${etykieta} `, el('b', {}, String(liczba)));
  $('liczniki').replaceChildren(
    chip(null, 'Razem', razem),
    ...TYPY.filter(t => liczniki[t.id] > 0).map(t => chip(t.id, t.etykieta, liczniki[t.id]))
  );

  const fraza = normalizuj(stan.szukaj);
  const widoczne = adresy.filter(a =>
    (!stan.filtrTypu || a.typy.includes(stan.filtrTypu)) &&
    (!fraza || tekstDoSzukania(a).includes(fraza))
  );

  $('lista-adresow').replaceChildren(...widoczne.map(a => el('li', {},
    el('button', { type: 'button', class: a.rezygnacja ? 'zrezygnowal' : null, onclick: () => { location.hash = 'adres/' + encodeURIComponent(a.id); } },
      el('span', { class: 'adres' }, a.adres),
      el('span', { class: 'znaczki' },
        a.typy.map(znaczekTypu),
        a.rezygnacja && el('span', { class: 'znaczek rez' }, 'REZ'),
        a.warianty.length > 1 && el('span', { class: 'znaczek uwaga', title: 'Różne zapisy adresu w arkuszach' }, '!'),
        znaczekStatusu(a)
      ),
      el('span', { class: 'osoba' }, [a.nazwisko, a.telefon].filter(Boolean).join(' · '))
    )
  )));
  $('brak-wynikow').hidden = widoczne.length > 0;
  pokazKolejke();
}

// ✔ wszystkie protokoły pod adresem na Dysku, ⇡ zapisane w tablecie i czekają
// na wysyłkę, ✎ coś rozpoczęte.
function znaczekStatusu(a) {
  const statusy = a.typy.map(typ => stan.audyty.get(kluczAudytu(a, typ))?.status);
  if (statusy.every(s => s === 'wyslany')) return el('span', { class: 'znaczek gotowe', title: 'Protokół na Dysku Google' }, '✔');
  if (statusy.every(s => s === 'wyslany' || s === 'zapisany')) return el('span', { class: 'znaczek czeka', title: 'Zapisany w tablecie, czeka na wysyłkę' }, '⇡');
  if (statusy.some(Boolean)) return el('span', { class: 'znaczek szkic', title: 'Protokół rozpoczęty' }, '✎');
  return null;
}

// --- Wysyłka na Dysk Google ---

const czekajaceNaWysylke = () => [...stan.audyty].filter(([klucz, a]) => a.status === 'zapisany' && klucz.startsWith(`${stan.inwestycja.nazwa}|`)).map(([klucz]) => klucz);

function pokazKolejke() {
  const ile = stan.inwestycja ? czekajaceNaWysylke().length : 0;
  $('kolejka').hidden = ile === 0;
  if (!ile) return;
  const folder = stan.inwestycja.folder;
  $('kolejka-opis').textContent = `${ile} ${ile === 1 ? 'protokół czeka' : 'protokoły(-ów) czekają'} na wysyłkę${folder ? '' : ' – najpierw wybierz folder na ekranie tabeli'}.`;
  $('wyslij-kolejke').disabled = !folder || !navigator.onLine || !google.skonfigurowany();
}

async function wyslijRekord(rekord) {
  const folder = stan.inwestycja.folder;
  if (!folder || !rekord.pdf) return false;
  // Ten sam plik na Dysku nadpisujemy (poprawiony protokół bez duplikatu),
  // chyba że w międzyczasie zmieniono folder docelowy.
  const idPliku = rekord.drive?.folder === folder.id ? rekord.drive.id : undefined;
  const wynik = await google.wyslijPdf({ pdf: rekord.pdf, nazwa: rekord.nazwaPliku, idFolderu: folder.id, idPliku });
  rekord.drive = { id: wynik.id, link: wynik.webViewLink, folder: folder.id };
  rekord.status = 'wyslany';
  rekord.wyslano = new Date().toISOString();
  await zapiszRekord(rekord);
  return true;
}

$('wyslij-kolejke').addEventListener('click', async () => {
  const przycisk = $('wyslij-kolejke');
  przycisk.disabled = true;
  let wyslane = 0;
  try {
    for (const klucz of czekajaceNaWysylke()) {
      const rekord = await odczytaj('audyty', klucz);
      if (rekord && await wyslijRekord(rekord)) wyslane += 1;
      $('kolejka-opis').textContent = `Wysłano ${wyslane}…`;
    }
  } catch (blad) {
    alert(`Wysyłka przerwana (wysłano ${wyslane}): ${blad.message}`);
  }
  renderujAdresy();
});

$('szukaj').addEventListener('input', e => { stan.szukaj = e.target.value; renderujAdresy(); });
$('pokaz-rezygnacje').addEventListener('change', e => { stan.pokazRezygnacje = e.target.checked; renderujAdresy(); });

// --- Ekran 3: szczegóły adresu ---

function renderujAdres(a) {
  pokazEkran('ekran-adres', a.adres);
  const telefony = a.telefon ? a.telefon.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
  const wiersz = (etykieta, ...wartosc) => [el('dt', {}, etykieta), el('dd', {}, ...wartosc)];

  $('szczegoly').replaceChildren(
    el('h2', { class: 'szczegoly-adres' }, a.adres),
    el('div', { class: 'znaczki' }, a.typy.map(znaczekTypu), a.rezygnacja && el('span', { class: 'znaczek rez' }, 'REZYGNACJA')),
    el('dl', { class: 'dane' },
      a.nazwisko && wiersz('Osoba', a.nazwisko),
      telefony.length > 0 && wiersz('Telefon', telefony.flatMap((t, i) => {
        const numer = t.replace(/[^\d+]/g, '');
        const link = numer.length >= 9 ? el('a', { href: `tel:${numer}` }, t) : t;
        return i ? [', ', link] : [link];
      })),
      a.obreb && wiersz('Obręb', a.obreb),
      a.uid && wiersz('UID', a.uid)
    ),
    a.warianty.length > 1 && el('div', { class: 'ostrzezenie' },
      el('strong', {}, 'Adres zapisany różnie w arkuszach:'),
      el('ul', {}, a.warianty.map(w => el('li', {}, w)))
    ),
    el('div', { class: 'zrodla' }, 'W tabeli:',
      el('ul', {}, a.rekordy.map(r => el('li', {},
        `${TYP[r.typ].etykieta} – arkusz „${r.arkusz}”, wiersz ${r.wiersz}${r.lp ? `, LP ${r.lp}` : ''}${r.rezygnacja ? ' (rezygnacja)' : ''}`
      )))
    )
  );

  // Osobny protokół dla każdej instalacji pod adresem (PV i PC to różne szablony).
  const szablony = stan.inwestycja.szablony || {};
  $('protokoly').replaceChildren(...a.typy.map(typ => {
    const status = stan.audyty.get(kluczAudytu(a, typ))?.status;
    const opis = !szablony[typ] ? 'brak szablonu – wczytaj go na ekranie tabeli'
      : status === 'wyslany' ? 'na Dysku Google ✔ – otwórz, żeby poprawić'
        : status === 'zapisany' ? 'zapisany w tablecie, czeka na wysyłkę'
          : status === 'szkic' ? 'rozpoczęty – kontynuuj'
            : 'nowy';
    return el('button', {
      type: 'button',
      class: `duzy${status === 'zapisany' || status === 'wyslany' ? ' drugorzedny' : ''}`,
      disabled: !szablony[typ],
      onclick: () => { location.hash = `audyt/${encodeURIComponent(a.id)}/${typ}`; }
    }, `Protokół – ${TYP[typ].etykieta}`, el('small', {}, opis));
  }));
}

// --- Ekran 4: protokół ---

const dzisiaj = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// "2026-10-27" jako data lokalna (new Date("2026-10-27") to północ UTC - w Polsce poprzedni dzień wieczorem).
const dataLokalna = tekst => {
  const [r, m, d] = String(tekst).split('-').map(Number);
  return new Date(r, m - 1, d);
};

function komunikat(tekst, ...dzieci) {
  const k = $('komunikat');
  k.replaceChildren(tekst, ...dzieci);
  k.hidden = !tekst;
}

function zamknijAudyt() {
  if (!stan.audyt) return;
  stan.audyt.edytor?.zniszcz();
  stan.audyt.dokument?.destroy();
  stan.audyt = null;
}

async function otworzAudyt(a, typ) {
  if (stan.audyt?.rekord.klucz === kluczAudytu(a, typ)) return;
  zamknijAudyt();
  pokazEkran('ekran-audyt', `${TYP[typ].skrot} · ${a.adres}`);
  komunikat('Otwieram szablon…');
  const idSzablonu = stan.inwestycja.szablony?.[typ];
  const szablon = idSzablonu && await odczytaj('szablony', idSzablonu);
  if (!szablon) { komunikat('Brak szablonu dla tego typu instalacji. Wczytaj go na ekranie tabeli.'); return; }

  const klucz = kluczAudytu(a, typ);
  const rekord = await odczytaj('audyty', klucz) || {
    klucz,
    inwestycja: stan.inwestycja.nazwa,
    adresId: a.id,
    adres: a.adres,
    typ,
    szablon: idSzablonu,
    dane: { imie: a.nazwisko, adres: a.adres, telefon: a.telefon, email: a.email, data: dzisiaj() },
    kreski: null,
    status: null,
    utworzono: new Date().toISOString()
  };
  const otwarty = { rekord, szablon };
  stan.audyt = otwarty;

  // pdf.js przejmuje bufor na własność - zawsze dajemy mu kopię.
  otwarty.dokument = await pdfjs.getDocument({ data: new Uint8Array(szablon.bajty.slice(0)) }).promise;
  otwarty.strony = await tekstSzablonu(otwarty.dokument);
  if (stan.audyt !== otwarty) return; // audytor zdążył wyjść
  otwarty.edytor = await utworzEdytor($('strony'), {
    dokument: otwarty.dokument,
    wpisy: wpisyDla(otwarty),
    kreski: rekord.kreski,
    onZmiana: kreski => zapiszSzkic(otwarty, kreski)
  });
  ustawPrzyciski();
  komunikat(rekord.status === 'zapisany' || rekord.status === 'wyslany' ? 'Ten protokół był już zapisany. Zmiany wymagają ponownego „Zapisz”.' : '');
}

const wpisyDla = otwarty => wyliczWpisy(otwarty.strony, { ...otwarty.rekord.dane, data: dataLokalna(otwarty.rekord.dane.data) });

// Autozapis szkicu po każdej kresce - zamknięcie aplikacji albo rozładowany
// tablet nie gubi pracy.
let czasAutozapisu = null;
function zapiszSzkic(otwarty, kreski) {
  otwarty.rekord.kreski = kreski;
  otwarty.rekord.status = 'szkic';
  otwarty.rekord.zmieniono = new Date().toISOString();
  ustawPrzyciski();
  clearTimeout(czasAutozapisu);
  czasAutozapisu = setTimeout(() => zapiszRekord(otwarty.rekord), 300);
}

async function zapiszRekord(rekord) {
  try {
    await zapisz('audyty', rekord.klucz, rekord);
    stan.audyty.set(rekord.klucz, { status: rekord.status, zmieniono: rekord.zmieniono });
  } catch (blad) {
    console.error(blad);
    komunikat(`Nie udało się zapisać w pamięci tabletu: ${blad.message}`);
  }
}

function ustawPrzyciski() {
  $('cofnij').disabled = !stan.audyt?.edytor?.mozeCofnac;
}

for (const przycisk of document.querySelectorAll('#narzedzia [data-narzedzie]')) {
  przycisk.addEventListener('click', () => {
    for (const p of document.querySelectorAll('#narzedzia [data-narzedzie]')) p.setAttribute('aria-pressed', String(p === przycisk));
    stan.audyt?.edytor?.ustawNarzedzie(przycisk.dataset.narzedzie, przycisk.dataset.kolor);
  });
}

$('cofnij').addEventListener('click', () => {
  stan.audyt?.edytor?.cofnij();
  ustawPrzyciski();
});

$('tryb-palca').addEventListener('click', e => {
  const wlaczony = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(wlaczony));
  e.currentTarget.textContent = wlaczony ? '✍ Palec pisze' : '✋ Palec przewija';
  stan.audyt?.edytor?.ustawTrybPalca(wlaczony);
});

$('edytuj-dane').addEventListener('click', () => {
  if (!stan.audyt) return;
  const form = $('form-dane');
  for (const [pole, wartosc] of Object.entries(stan.audyt.rekord.dane)) if (form.elements[pole]) form.elements[pole].value = wartosc || '';
  $('dialog-dane').showModal();
});

$('dialog-dane').addEventListener('close', () => {
  const otwarty = stan.audyt;
  if ($('dialog-dane').returnValue !== 'ok' || !otwarty) return;
  const form = $('form-dane');
  for (const pole of ['imie', 'adres', 'telefon', 'email', 'data']) otwarty.rekord.dane[pole] = form.elements[pole].value.trim();
  if (!otwarty.rekord.dane.data) otwarty.rekord.dane.data = dzisiaj();
  otwarty.edytor.ustawWpisy(wpisyDla(otwarty));
  zapiszSzkic(otwarty, otwarty.edytor.kreski);
});

const nazwaPliku = rekord => `Protokół ${TYP[rekord.typ].skrot} - ${rekord.dane.adres || rekord.adres}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');

$('zapisz-protokol').addEventListener('click', async () => {
  const otwarty = stan.audyt;
  if (!otwarty?.edytor) return;
  const przycisk = $('zapisz-protokol');
  przycisk.disabled = true;
  komunikat('Tworzę PDF…');
  try {
    const czcionka = await (await fetch('vendor/DejaVuSansCondensed.ttf')).arrayBuffer();
    const bajty = await zbudujPdf({
      szablon: otwarty.szablon.bajty.slice(0),
      czcionka,
      fontkit: window.fontkit,
      teksty: wpisyDla(otwarty),
      kreski: otwarty.edytor.kreski,
      tytul: nazwaPliku(otwarty.rekord).replace(/\.pdf$/, '')
    });
    const rekord = otwarty.rekord;
    rekord.kreski = otwarty.edytor.kreski;
    rekord.pdf = new Blob([bajty], { type: 'application/pdf' });
    rekord.nazwaPliku = nazwaPliku(rekord);
    rekord.status = 'zapisany';
    rekord.zapisano = new Date().toISOString();
    rekord.zmieniono = rekord.zapisano;
    clearTimeout(czasAutozapisu);
    await zapiszRekord(rekord);
    const pobierz = el('a', { href: URL.createObjectURL(rekord.pdf), download: rekord.nazwaPliku }, 'pobierz PDF');
    // Od razu na Dysk, jeśli się da. Bez zasięgu protokół czeka w tablecie -
    // na liście adresów pojawi się przycisk "Wyślij na Dysk".
    if (!stan.inwestycja.folder || !google.skonfigurowany()) {
      komunikat(`Zapisano w tablecie: ${rekord.nazwaPliku} (`, pobierz, '). Wybierz folder na Dysku na ekranie tabeli, żeby wysyłać protokoły.');
    } else if (!navigator.onLine) {
      komunikat(`Zapisano w tablecie: ${rekord.nazwaPliku}. Brak internetu – wyślesz go z listy adresów, gdy będzie zasięg.`);
    } else {
      komunikat('Wysyłam na Dysk Google…');
      try {
        await wyslijRekord(rekord);
        komunikat(`Wysłano na Dysk: ${rekord.nazwaPliku} → folder „${stan.inwestycja.folder.nazwa}”. `, el('a', { href: rekord.drive.link, target: '_blank', rel: 'noopener' }, 'otwórz'));
      } catch (blad) {
        console.error(blad);
        komunikat(`Zapisano w tablecie, ale wysyłka się nie udała (${blad.message}). Spróbujesz ponownie z listy adresów.`);
      }
    }
  } catch (blad) {
    console.error(blad);
    komunikat(`Nie udało się zapisać protokołu: ${blad.message}`);
  } finally {
    przycisk.disabled = false;
  }
});

// --- Start ---

function pokazSiec() {
  $('siec').textContent = navigator.onLine ? '' : 'offline';
  if (stan.inwestycja) pokazKolejke();
}
window.addEventListener('online', pokazSiec);
window.addEventListener('offline', pokazSiec);

async function start() {
  pokazSiec();
  try {
    const zapisana = await odczytaj('inwestycje', 'biezaca');
    if (zapisana) {
      stan.inwestycja = zapisana;
      stan.wynik = zbudujListeAdresow(zapisana.arkusze, zapisana.przypisania);
    }
    for (const r of await wszystkie('audyty')) stan.audyty.set(r.klucz, { status: r.status, zmieniono: r.zmieniono });
  } catch (blad) {
    console.warn('Nie odczytano zapisanej tabeli', blad);
  }
  trasa();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(blad => console.warn('Service worker', blad));
}

start();
