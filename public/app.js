import * as pdfjs from './vendor/pdf.min.mjs';
import { TYPY, normalizuj, zbudujListeAdresow } from './src/tabela.js';
import { odczytaj, zapisz, usun, wszystkie } from './src/magazyn.js';
import { wyliczWpisy, tekstSzablonu } from './src/wypelnianie.js';
import { utworzEdytor } from './src/edytor.js';
import { zbudujPdf } from './src/eksport.js';
import { wybierzWzor } from './src/wzory.js';
import * as google from './src/google.js';
import { DYSK } from './config.js';

pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

const TYP = Object.fromEntries(TYPY.map(t => [t.id, t]));
const SKROT_PLIKU = { pompy: 'PC', pv_me: 'PV', solary: 'KOLEKTORY', kotly: 'KOTŁY' };

// Stan aplikacji. Lista inwestycji, otwarte inwestycje (tabela + wzory) i
// protokoły są w IndexedDB - aplikacja działa w terenie bez internetu.
const stan = {
  inwestycje: [], // [{ id, nazwa, tabela, razem }] - foldery z INWESTYCJE_3
  ostatnie: [], // id ostatnio otwieranych inwestycji
  inwestycja: null, // otwarta: { id, nazwa, tabela, arkusze, wzory, folderWzorow, pobrano }
  wynik: null, // zbudujListeAdresow dla otwartej inwestycji
  audyty: new Map(), // klucz protokołu -> { status, inwestycja }
  szukajInwestycji: '',
  szukajAdresu: '',
  filtrTypu: null,
  pokazRezygnacje: false,
  protokol: null // otwarty protokół: { rekord, edytor, dokument, strony, szablon }
};

const $ = id => document.getElementById(id);

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
  wstaw(e, dzieci, false);
  return e;
}

// replaceChildren/append wypisałyby "false" dla warunkowych elementów (a && el(...)).
function wstaw(kontener, dzieci, zastap = true) {
  const elementy = dzieci.flat().filter(d => d !== null && d !== undefined && d !== false && d !== '');
  if (zastap) kontener.replaceChildren(...elementy);
  else kontener.append(...elementy);
}

// Stałe ikony (bez danych użytkownika).
const SVG = {
  strzalka: '<path d="M9 5l7 7-7 7"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  wysylka: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  szkic: '<path d="M4 20h4L19 9l-4-4L4 16z"/>'
};
function ikona(nazwa, klasa = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (klasa) s.setAttribute('class', klasa);
  s.innerHTML = SVG[nazwa];
  return s;
}

const OPIS_STATUSU = { wyslany: 'Na Dysku', zapisany: 'Czeka na wysyłkę', szkic: 'Rozpoczęty' };
function znaczekStatusu(status) {
  if (!status) return null;
  return el('span', { class: `status ${status}`, title: OPIS_STATUSU[status] }, ikona({ wyslany: 'ok', zapisany: 'wysylka', szkic: 'szkic' }[status]));
}

// "GALEWICE 2026 - PC_SOL_ME_PV_KOTŁY" -> ["GALEWICE 2026", "PC_SOL_ME_PV_KOTŁY"]
function rozbijNazwe(nazwa) {
  const [glowna, ...reszta] = nazwa.split(/\s+-\s+/);
  return [glowna.trim(), reszta.join(' - ')];
}

// --- Ekrany i nawigacja (hash, żeby systemowy "wstecz" Androida działał) ---

const EKRANY = ['ekran-start', 'ekran-inwestycje', 'ekran-adresy', 'ekran-protokol'];

function pokazEkran(id, tytul, podtytul = '', { odswiez = false } = {}) {
  for (const e of EKRANY) $(e).hidden = e !== id;
  document.body.classList.toggle('tryb-protokol', id === 'ekran-protokol');
  $('tytul').textContent = tytul;
  $('podtytul').textContent = podtytul;
  $('wstecz').hidden = id === 'ekran-start' || id === 'ekran-inwestycje';
  $('odswiez').hidden = !odswiez;
  window.scrollTo(0, 0);
}

async function trasa() {
  const [ekran, ...p] = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (ekran !== 'p') zamknijProtokol();
  try {
    if (ekran === 'i') return await ekranAdresy(p[0]);
    if (ekran === 'p') return await ekranProtokol(p[0], p[1], p[2]);
    return await ekranInwestycje();
  } catch (blad) {
    console.error(blad);
    alert(blad.message);
  }
}

window.addEventListener('hashchange', trasa);
$('wstecz').addEventListener('click', () => history.back());

// --- Logowanie ---

$('zaloguj').addEventListener('click', async () => {
  $('blad-logowania').hidden = true;
  try {
    await google.zaloguj();
    await pobierzInwestycje();
    ekranInwestycje();
  } catch (blad) {
    $('blad-logowania').textContent = blad.message;
    $('blad-logowania').hidden = false;
  }
});

// --- Inwestycje ---

async function pobierzInwestycje() {
  const lista = await google.listaInwestycji(DYSK.inwestycje);
  const razem = new Map(stan.inwestycje.map(i => [i.id, i.razem]));
  stan.inwestycje = lista.map(i => ({ ...i, razem: razem.get(i.id) }));
  await zapisz('ustawienia', 'inwestycje', stan.inwestycje);
}

// Ile adresów inwestycji ma już zapisany protokół.
function zrobione(idInwestycji) {
  const adresy = new Set();
  for (const [klucz, a] of stan.audyty) {
    if (a.inwestycja === idInwestycji && (a.status === 'zapisany' || a.status === 'wyslany')) adresy.add(klucz.split('|')[1]);
  }
  return adresy.size;
}

async function ekranInwestycje() {
  if (!stan.inwestycje.length) {
    if (!navigator.onLine) {
      pokazEkran('ekran-inwestycje', 'Inwestycje');
      pokazInfo('info-inwestycje', 'Brak internetu, a na tym tablecie nie ma jeszcze zapisanych inwestycji.');
      return;
    }
    if (!google.zalogowany()) { pokazEkran('ekran-start', 'Audyt'); return; }
    pokazEkran('ekran-inwestycje', 'Inwestycje');
    pokazInfo('info-inwestycje', 'Wczytuję inwestycje z Dysku…');
    await pobierzInwestycje();
  }
  pokazEkran('ekran-inwestycje', 'Inwestycje', DYSK.inwestycje, { odswiez: true });
  pokazInfo('info-inwestycje', '');
  renderujInwestycje();
}

function wierszInwestycji(inw) {
  const [glowna, dodatkowa] = rozbijNazwe(inw.nazwa);
  const ile = zrobione(inw.id);
  return el('li', {}, el('button', { type: 'button', onclick: () => { location.hash = `i/${encodeURIComponent(inw.id)}`; } },
    el('span', { class: 'tresc' }, el('span', { class: 'glowna' }, glowna), dodatkowa && el('span', { class: 'dodatkowa' }, dodatkowa)),
    el('span', { class: 'prawa' }, inw.razem ? el('span', { class: 'postep' }, `${ile} / ${inw.razem}`) : null, ikona('strzalka', 'strzalka'))
  ));
}

function renderujInwestycje() {
  const fraza = normalizuj(stan.szukajInwestycji);
  const wszystkie = [...stan.inwestycje].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true }));
  const kontener = $('lista-inwestycji');
  if (fraza) {
    const wyniki = wszystkie.filter(i => normalizuj(i.nazwa).includes(fraza));
    kontener.replaceChildren(wyniki.length ? el('ul', { class: 'lista' }, wyniki.map(wierszInwestycji)) : el('p', { class: 'pusto' }, 'Brak inwestycji o tej nazwie.'));
    return;
  }
  const ostatnie = stan.ostatnie.map(id => stan.inwestycje.find(i => i.id === id)).filter(Boolean).slice(0, 4);
  wstaw(kontener, [
    ostatnie.length > 0 && el('h2', { class: 'naglowek-sekcji' }, 'Ostatnio otwierane'),
    ostatnie.length > 0 && el('ul', { class: 'lista' }, ostatnie.map(wierszInwestycji)),
    el('h2', { class: 'naglowek-sekcji' }, `Wszystkie inwestycje (${wszystkie.length})`),
    el('ul', { class: 'lista' }, wszystkie.map(wierszInwestycji))
  ]);
}

$('szukaj-inwestycji').addEventListener('input', e => { stan.szukajInwestycji = e.target.value; renderujInwestycje(); });

function pokazInfo(id, tekst, ...dzieci) {
  $(id).replaceChildren(tekst, ...dzieci);
  $(id).hidden = !tekst;
}

// --- Otwarcie inwestycji: tabela montażowa + wzory, zapamiętane na offline ---

const czytajXlsx = bajty => {
  const wb = window.XLSX.read(bajty, { type: 'array' });
  return wb.SheetNames.map(nazwa => ({ nazwa, wiersze: window.XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, defval: null, blankrows: false }) }));
};

async function pobierzInwestycje1(wpis) {
  const [folder, arkusze] = await Promise.all([
    google.folderInwestycji(wpis.id, DYSK),
    google.odczytajTabele(wpis.tabela, czytajXlsx)
  ]);
  // Wzory od razu do pamięci tabletu - w terenie może nie być zasięgu.
  for (const w of folder.wzory) {
    const zapisany = await odczytaj('szablony', w.id);
    if (zapisany?.modifiedTime !== w.modifiedTime) await zapisz('szablony', w.id, { nazwa: w.nazwa, modifiedTime: w.modifiedTime, bajty: await google.pobierzPlik(w) });
  }
  const inwestycja = { id: wpis.id, nazwa: wpis.nazwa, tabela: wpis.tabela, arkusze, ...folder, pobrano: new Date().toISOString() };
  await zapisz('inwestycje', wpis.id, inwestycja);
  return inwestycja;
}

async function zaladujInwestycje(id, { odswiez = false } = {}) {
  if (stan.inwestycja?.id === id && !odswiez) return;
  const wpis = stan.inwestycje.find(i => i.id === id);
  let inwestycja = await odczytaj('inwestycje', id);
  let ostrzezenie = '';
  if (wpis && navigator.onLine && (odswiez || !inwestycja)) {
    pokazEkran('ekran-adresy', rozbijNazwe(wpis.nazwa)[0], 'Wczytuję tabelę i wzory…');
    $('lista-adresow').replaceChildren();
    try {
      inwestycja = await pobierzInwestycje1(wpis);
    } catch (blad) {
      if (!inwestycja) throw blad;
      ostrzezenie = `Nie udało się odświeżyć z Dysku (${blad.message}) – pokazuję wersję zapisaną w tablecie.`;
    }
  }
  if (!inwestycja) throw new Error('Tej inwestycji nie ma jeszcze w tablecie. Otwórz ją raz z internetem.');
  stan.inwestycja = inwestycja;
  stan.wynik = zbudujListeAdresow(inwestycja.arkusze);
  stan.filtrTypu = null;
  stan.szukajAdresu = '';
  $('szukaj-adresu').value = '';
  stan.ostrzezenieOdswiezania = ostrzezenie;

  stan.ostatnie = [id, ...stan.ostatnie.filter(x => x !== id)].slice(0, 10);
  if (wpis) wpis.razem = stan.wynik.adresy.filter(a => !a.rezygnacja).length;
  await zapisz('ustawienia', 'ostatnie', stan.ostatnie);
  await zapisz('ustawienia', 'inwestycje', stan.inwestycje);
}

// --- Adresy ---

async function ekranAdresy(id) {
  await zaladujInwestycje(id);
  renderujAdresy();
}

const kluczProtokolu = (adres, typ) => `${stan.inwestycja.id}|${adres.id}|${typ}`;
const statusAdresu = a => {
  const s = a.typy.map(typ => stan.audyty.get(kluczProtokolu(a, typ))?.status);
  if (s.every(x => x === 'wyslany')) return 'wyslany';
  if (s.every(x => x === 'wyslany' || x === 'zapisany')) return 'zapisany';
  return s.some(Boolean) ? 'szkic' : null;
};

function brakujaceWzory() {
  const inw = stan.inwestycja;
  if (!inw.folderWzorow) return `W tej inwestycji nie ma folderu „Wzory audytów”. Poproś biuro o wrzucenie wzorów protokołów.`;
  const typy = TYPY.filter(t => stan.wynik.liczniki[t.id] > 0);
  const brak = typy.filter(t => t.id === 'pompy'
    ? !wybierzWzor(inw.wzory, 'pompy', 'grunt') && !wybierzWzor(inw.wzory, 'pompy', 'powietrze')
    : !wybierzWzor(inw.wzory, t.id));
  return brak.length ? `Brak wzoru protokołu dla: ${brak.map(t => t.etykieta).join(', ')} (folder „${inw.folderWzorow.nazwa}”).` : '';
}

function renderujAdresy() {
  const inw = stan.inwestycja;
  const [glowna] = rozbijNazwe(inw.nazwa);
  const aktywne = stan.wynik.adresy.filter(a => !a.rezygnacja);
  pokazEkran('ekran-adresy', glowna, `${aktywne.length} adresów · zrobione ${zrobione(inw.id)}`, { odswiez: true });

  const typy = TYPY.filter(t => stan.wynik.liczniki[t.id] > 0);
  const filtr = (id, etykieta) => el('button', { type: 'button', 'aria-pressed': String(stan.filtrTypu === id), onclick: () => { stan.filtrTypu = id; renderujAdresy(); } }, etykieta);
  $('filtry').replaceChildren(...(typy.length > 1 ? [filtr(null, 'Wszystkie'), ...typy.map(t => filtr(t.id, t.etykieta))] : []));

  pokazInfo('info-adresy', stan.ostrzezenieOdswiezania || brakujaceWzory());

  const fraza = normalizuj(stan.szukajAdresu);
  const widoczne = stan.wynik.adresy.filter(a =>
    (stan.pokazRezygnacje || !a.rezygnacja) &&
    (!stan.filtrTypu || a.typy.includes(stan.filtrTypu)) &&
    (!fraza || normalizuj([a.adres, ...a.warianty, a.nazwisko, a.telefon].join(' ')).includes(fraza))
  );
  const wieleTypow = typy.length > 1;
  $('lista-adresow').replaceChildren(...widoczne.map(a => el('li', {},
    el('button', { type: 'button', class: a.rezygnacja ? 'zrezygnowal' : null, onclick: () => wybierzAdres(a) },
      el('span', { class: 'tresc' },
        el('span', { class: 'glowna' }, a.adres),
        el('span', { class: 'dodatkowa' }, [a.rezygnacja ? 'rezygnacja' : '', a.nazwisko].filter(Boolean).join(' · '))
      ),
      el('span', { class: 'prawa' }, wieleTypow && a.typy.map(t => el('span', { class: 'typ' }, TYP[t].skrot)), znaczekStatusu(statusAdresu(a)))
    )
  )));
  $('brak-adresow').hidden = widoczne.length > 0;

  const rezygnacje = stan.wynik.adresy.length - aktywne.length;
  $('pokaz-rezygnacje').hidden = rezygnacje === 0;
  $('pokaz-rezygnacje').textContent = stan.pokazRezygnacje ? 'Ukryj rezygnacje' : `Pokaż rezygnacje (${rezygnacje})`;
  pokazKolejke();
}

$('szukaj-adresu').addEventListener('input', e => { stan.szukajAdresu = e.target.value; renderujAdresy(); });
$('pokaz-rezygnacje').addEventListener('click', () => { stan.pokazRezygnacje = !stan.pokazRezygnacje; renderujAdresy(); });

$('odswiez').addEventListener('click', async () => {
  if (!navigator.onLine) { alert('Brak internetu.'); return; }
  try {
    if (!$('ekran-adresy').hidden && stan.inwestycja) {
      await zaladujInwestycje(stan.inwestycja.id, { odswiez: true });
      renderujAdresy();
    } else {
      await pobierzInwestycje();
      renderujInwestycje();
    }
  } catch (blad) {
    alert(`Nie udało się odświeżyć: ${blad.message}`);
  }
});

function wybierzAdres(a) {
  const otworz = typ => { location.hash = `p/${encodeURIComponent(stan.inwestycja.id)}/${encodeURIComponent(a.id)}/${typ}`; };
  if (a.typy.length === 1) { otworz(a.typy[0]); return; }
  // Kilka instalacji pod adresem - osobny protokół dla każdej.
  $('dialog-typ-tytul').textContent = a.adres;
  $('dialog-typ-opcje').replaceChildren(...a.typy.map(typ => {
    const status = stan.audyty.get(kluczProtokolu(a, typ))?.status;
    return el('button', { type: 'button', class: 'duzy', onclick: () => { $('dialog-typ').close(); otworz(typ); } },
      `Protokół – ${TYP[typ].etykieta}`, el('small', {}, OPIS_STATUSU[status] || 'nowy'));
  }));
  $('dialog-typ').showModal();
}

// --- Wysyłka na Dysk ---

const czekajace = () => [...stan.audyty].filter(([, a]) => a.status === 'zapisany' && a.inwestycja === stan.inwestycja?.id).map(([k]) => k);

function pokazKolejke() {
  const ile = czekajace().length;
  $('kolejka').hidden = ile === 0;
  if (!ile) return;
  $('kolejka-opis').textContent = `${ile} ${ile === 1 ? 'protokół czeka' : 'protokoły czekają'} na wysyłkę na Dysk`;
  $('wyslij-kolejke').disabled = !navigator.onLine;
}

const bezpiecznaNazwa = t => t.replace(/[\\/:*?"<>|]+/g, '-').trim();

// Protokół trafia do: INWESTYCJE_3 / AUDYTY / <inwestycja> / <PC|PV|KOLEKTORY|kotły> /
// Brakujące foldery zakładamy; ich id zapamiętujemy, żeby nie szukać za każdym razem.
const takaSama = nazwa => n => normalizuj(n) === normalizuj(nazwa);

async function folderTypu(idInwestycji, typ) {
  const klucz = `folder|${idInwestycji}|${typ}`;
  const zapamietany = await odczytaj('ustawienia', klucz);
  if (zapamietany) return zapamietany;
  const inw = await odczytaj('inwestycje', idInwestycji);
  const idDysku = await google.idDysku(DYSK.inwestycje);
  const idAudytow = await google.folderPodrzedny(idDysku, takaSama(DYSK.audyty), DYSK.audyty);
  const idInw = await google.folderPodrzedny(idAudytow, takaSama(inw.nazwa), bezpiecznaNazwa(inw.nazwa));
  const idTypu = await google.folderPodrzedny(idInw, takaSama(DYSK.foldery[typ]), DYSK.foldery[typ]);
  await zapisz('ustawienia', klucz, idTypu);
  return idTypu;
}

async function wyslijRekord(rekord, ponowienie = false) {
  const idFolderu = rekord.drive?.folder || await folderTypu(rekord.inwestycja, rekord.typ);
  let wynik;
  try {
    wynik = await google.wyslijPdf({ pdf: rekord.pdf, nazwa: rekord.nazwaPliku, idFolderu, idPliku: rekord.drive?.id });
  } catch (blad) {
    // Folder albo plik skasowany/przeniesiony na Dysku w międzyczasie -
    // zapominamy zapamiętane miejsce i zakładamy je od nowa (raz).
    if (ponowienie || !/404|not found/i.test(blad.message)) throw blad;
    await usun('ustawienia', `folder|${rekord.inwestycja}|${rekord.typ}`);
    rekord.drive = null;
    return wyslijRekord(rekord, true);
  }
  rekord.drive = { id: wynik.id, link: wynik.webViewLink, folder: idFolderu };
  rekord.status = 'wyslany';
  rekord.wyslano = new Date().toISOString();
  await zapiszRekord(rekord);
}

$('wyslij-kolejke').addEventListener('click', async () => {
  $('wyslij-kolejke').disabled = true;
  let wyslane = 0;
  try {
    for (const klucz of czekajace()) {
      const rekord = await odczytaj('audyty', klucz);
      if (rekord?.pdf) { await wyslijRekord(rekord); wyslane += 1; }
      $('kolejka-opis').textContent = `Wysłano ${wyslane}…`;
    }
  } catch (blad) {
    alert(`Wysyłka przerwana (wysłano ${wyslane}): ${blad.message}`);
  }
  renderujAdresy();
});

// --- Protokół ---

const dzisiaj = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// "2026-10-27" jako data lokalna (new Date("2026-10-27") to północ UTC).
const dataLokalna = tekst => {
  const [r, m, d] = String(tekst).split('-').map(Number);
  return new Date(r, m - 1, d);
};

function komunikat(tekst, { blad = false } = {}, ...dzieci) {
  const k = $('komunikat');
  k.replaceChildren(tekst, ...dzieci);
  k.classList.toggle('blad', blad);
  k.hidden = !tekst;
}

function zamknijProtokol() {
  if (!stan.protokol) return;
  stan.protokol.edytor?.zniszcz();
  stan.protokol.dokument?.destroy();
  stan.protokol = null;
}

function pokazKontakt(a) {
  const telefony = a.telefon ? a.telefon.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
  const RODZAJ = { grunt: 'pompa gruntowa', powietrze: 'pompa powietrzna' };
  wstaw($('kontakt'), [
    a.nazwisko && el('strong', {}, a.nazwisko),
    ...telefony.map(t => {
      const numer = t.replace(/[^\d+]/g, '');
      return numer.length >= 9 ? el('a', { href: `tel:${numer}` }, `☎ ${t}`) : el('span', {}, t);
    }),
    a.rodzajPompy && el('span', {}, RODZAJ[a.rodzajPompy]),
    a.warianty.length > 1 && el('span', {}, `w tabeli też jako: ${a.warianty.filter(w => w !== a.adres).join('; ')}`)
  ]);
}

async function ekranProtokol(idInwestycji, idAdresu, typ) {
  await zaladujInwestycje(idInwestycji);
  const a = stan.wynik.adresy.find(x => x.id === idAdresu);
  if (!a || !TYP[typ]) { location.hash = `i/${encodeURIComponent(idInwestycji)}`; return; }
  const klucz = kluczProtokolu(a, typ);
  if (stan.protokol?.rekord.klucz === klucz) return;
  zamknijProtokol();
  pokazEkran('ekran-protokol', a.adres, `${TYP[typ].etykieta} · ${rozbijNazwe(stan.inwestycja.nazwa)[0]}`);
  pokazKontakt(a);
  $('strony').replaceChildren();
  komunikat('Otwieram wzór protokołu…');

  const wzor = wybierzWzor(stan.inwestycja.wzory, typ, a.rodzajPompy);
  if (!wzor) {
    komunikat(typ === 'pompy' && !a.rodzajPompy
      ? 'Nie wiem, który wzór wybrać: w tabeli brak „rodzaju pompy”, a w folderze wzorów jest kilka wzorów PC.'
      : `Brak wzoru protokołu dla: ${TYP[typ].etykieta}. Poproś biuro o wrzucenie go do folderu „Wzory audytów” tej inwestycji.`, { blad: true });
    return;
  }
  let szablon = await odczytaj('szablony', wzor.id);
  if (!szablon && navigator.onLine) {
    szablon = { nazwa: wzor.nazwa, modifiedTime: wzor.modifiedTime, bajty: await google.pobierzPlik(wzor) };
    await zapisz('szablony', wzor.id, szablon);
  }
  if (!szablon) { komunikat('Wzoru nie ma w pamięci tabletu, a nie ma internetu.', { blad: true }); return; }

  const rekord = await odczytaj('audyty', klucz) || {
    klucz,
    inwestycja: stan.inwestycja.id,
    adresId: a.id,
    adres: a.adres,
    warianty: a.warianty,
    typ,
    wzor: wzor.id,
    dane: { imie: a.nazwisko, adres: a.adres, telefon: a.telefon, email: a.email, data: dzisiaj() },
    kreski: null,
    status: null,
    utworzono: new Date().toISOString()
  };
  // Wzór zmieniony w biurze po rozpoczęciu protokołu - pismo zostało
  // narysowane na starym, więc zostajemy przy nim, jeśli jest w pamięci.
  if (rekord.wzor !== wzor.id) {
    const stary = await odczytaj('szablony', rekord.wzor);
    if (stary) szablon = stary;
  }
  const otwarty = { rekord, szablon };
  stan.protokol = otwarty;

  // pdf.js przejmuje bufor na własność - zawsze dajemy mu kopię.
  otwarty.dokument = await pdfjs.getDocument({ data: new Uint8Array(szablon.bajty.slice(0)) }).promise;
  otwarty.strony = await tekstSzablonu(otwarty.dokument);
  if (stan.protokol !== otwarty) return; // audytor zdążył wyjść
  otwarty.edytor = await utworzEdytor($('strony'), {
    dokument: otwarty.dokument,
    wpisy: wpisyDla(otwarty),
    kreski: rekord.kreski,
    onZmiana: kreski => zapiszSzkic(otwarty, kreski)
  });
  ustawPrzyciski();
  komunikat(rekord.status === 'wyslany' ? 'Ten protokół jest już na Dysku. Po poprawkach stuknij „Zapisz” – plik się podmieni.' : '');
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
    stan.audyty.set(rekord.klucz, { status: rekord.status, inwestycja: rekord.inwestycja });
  } catch (blad) {
    console.error(blad);
    komunikat(`Nie udało się zapisać w pamięci tabletu: ${blad.message}`, { blad: true });
  }
}

function ustawPrzyciski() {
  $('cofnij').disabled = !stan.protokol?.edytor?.mozeCofnac;
}

for (const przycisk of document.querySelectorAll('#narzedzia [data-narzedzie]')) {
  przycisk.addEventListener('click', () => {
    for (const p of document.querySelectorAll('#narzedzia [data-narzedzie]')) p.setAttribute('aria-pressed', String(p === przycisk));
    stan.protokol?.edytor?.ustawNarzedzie(przycisk.dataset.narzedzie, przycisk.dataset.kolor);
  });
}

$('cofnij').addEventListener('click', () => {
  stan.protokol?.edytor?.cofnij();
  ustawPrzyciski();
});

$('tryb-palca').addEventListener('click', e => {
  const wlaczony = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(wlaczony));
  e.currentTarget.textContent = wlaczony ? 'Palcem: piszę' : 'Palcem: przewijam';
  stan.protokol?.edytor?.ustawTrybPalca(wlaczony);
});

$('edytuj-dane').addEventListener('click', () => {
  if (!stan.protokol) return;
  const form = $('form-dane');
  for (const [pole, wartosc] of Object.entries(stan.protokol.rekord.dane)) if (form.elements[pole]) form.elements[pole].value = wartosc || '';
  $('dialog-dane').showModal();
});

$('dialog-dane').addEventListener('close', () => {
  const otwarty = stan.protokol;
  if ($('dialog-dane').returnValue !== 'ok' || !otwarty?.edytor) return;
  const form = $('form-dane');
  for (const pole of ['imie', 'adres', 'telefon', 'email', 'data']) otwarty.rekord.dane[pole] = form.elements[pole].value.trim();
  if (!otwarty.rekord.dane.data) otwarty.rekord.dane.data = dzisiaj();
  otwarty.edytor.ustawWpisy(wpisyDla(otwarty));
  zapiszSzkic(otwarty, otwarty.edytor.kreski);
});

// "Bartodzieje 21_PC.pdf" - tak jak dotychczasowe audyty w folderach projektów.
const nazwaPliku = rekord => bezpiecznaNazwa(`${rekord.adres}_${SKROT_PLIKU[rekord.typ]}`) + '.pdf';

$('zapisz-protokol').addEventListener('click', async () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor) return;
  const przycisk = $('zapisz-protokol');
  przycisk.disabled = true;
  komunikat('Zapisuję…');
  const nastepny = () => el('button', { type: 'button', class: 'duzy glowny', onclick: () => history.back() }, 'Następny adres');
  try {
    const czcionka = await (await fetch('vendor/DejaVuSansCondensed.ttf')).arrayBuffer();
    const rekord = otwarty.rekord;
    rekord.nazwaPliku = nazwaPliku(rekord);
    const bajty = await zbudujPdf({
      szablon: otwarty.szablon.bajty.slice(0),
      czcionka,
      fontkit: window.fontkit,
      teksty: wpisyDla(otwarty),
      kreski: otwarty.edytor.kreski,
      tytul: rekord.nazwaPliku.replace(/\.pdf$/, '')
    });
    rekord.kreski = otwarty.edytor.kreski;
    rekord.pdf = new Blob([bajty], { type: 'application/pdf' });
    rekord.status = 'zapisany';
    rekord.zapisano = new Date().toISOString();
    clearTimeout(czasAutozapisu);
    await zapiszRekord(rekord);

    if (!navigator.onLine) {
      komunikat('Zapisano w tablecie. Brak internetu – wyślesz z listy adresów, gdy będzie zasięg.', {}, nastepny());
      return;
    }
    komunikat('Wysyłam na Dysk…');
    try {
      await wyslijRekord(rekord);
      komunikat(`✔ Zapisano na Dysku: ${DYSK.audyty} / ${rozbijNazwe(stan.inwestycja.nazwa)[0]} / ${DYSK.foldery[rekord.typ]} / ${rekord.nazwaPliku}`, {}, nastepny());
    } catch (blad) {
      console.error(blad);
      komunikat(`Zapisano w tablecie, ale wysyłka się nie udała (${blad.message}). Wyślesz z listy adresów.`, { blad: true }, nastepny());
    }
  } catch (blad) {
    console.error(blad);
    komunikat(`Nie udało się zapisać protokołu: ${blad.message}`, { blad: true });
  } finally {
    przycisk.disabled = false;
  }
});

// --- Start ---

function pokazSiec() {
  $('siec').hidden = navigator.onLine;
  if (stan.inwestycja && !$('ekran-adresy').hidden) pokazKolejke();
}
window.addEventListener('online', pokazSiec);
window.addEventListener('offline', pokazSiec);

async function start() {
  pokazSiec();
  try {
    stan.inwestycje = await odczytaj('ustawienia', 'inwestycje') || [];
    stan.ostatnie = await odczytaj('ustawienia', 'ostatnie') || [];
    for (const r of await wszystkie('audyty')) if (r.inwestycja) stan.audyty.set(r.klucz, { status: r.status, inwestycja: r.inwestycja });
  } catch (blad) {
    console.warn('Nie odczytano danych z pamięci tabletu', blad);
  }
  trasa();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(blad => console.warn('Service worker', blad));
}

start();
