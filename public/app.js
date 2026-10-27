import * as pdfjs from './vendor/pdf.min.mjs';
import { TYPY, normalizuj, zbudujListeAdresow } from './src/tabela.js';
import { odczytaj, zapisz, usun, wszystkie } from './src/magazyn.js';
import { wyliczWpisy, tekstSzablonu } from './src/wypelnianie.js';
import { utworzEdytor } from './src/edytor.js';
import { zbudujPdf } from './src/eksport.js';
import { wybierzWzor } from './src/wzory.js';
import { ikona, wstawIkony } from './src/ikony.js';
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
  ostrzezenieOdswiezania: '',
  protokol: null // otwarty protokół: { rekord, edytor, dokument, strony, szablon }
};

const $ = id => document.getElementById(id);

// Budowanie DOM bez innerHTML - dane z arkuszy trafiają tylko do textContent.
function el(tag, wlasciwosci = {}, ...dzieci) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(wlasciwosci)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
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

const OPIS_STATUSU = { wyslany: 'Na Dysku', zapisany: 'Czeka na wysyłkę', szkic: 'Rozpoczęty' };
const kolkoStatusu = status => el('span', { class: `kolko ${status || ''}`, title: OPIS_STATUSU[status] || 'Nie rozpoczęty' },
  status && ikona({ wyslany: 'ok', zapisany: 'wysylka', szkic: 'pioro' }[status]));

const pasekPostepu = (ile, razem) => el('span', { class: 'pasek-postepu' }, el('i', { style: `width:${razem ? Math.round(ile / razem * 100) : 0}%` }));

// "GALEWICE 2026 - PC_SOL_ME_PV_KOTŁY" -> ["GALEWICE 2026", "PC_SOL_ME_PV_KOTŁY"]
// "MASŁOWICE 2025_PC PV ME"           -> ["MASŁOWICE 2025", "PC PV ME"]
function rozbijNazwe(nazwa) {
  const [glowna, ...reszta] = nazwa.split(/\s+-\s+/);
  if (reszta.length) return [glowna.trim(), reszta.join(' - ')];
  const poRoku = /^(.+?\b(?:19|20)\d{2})[\s_-]+(.+)$/.exec(nazwa);
  return poRoku ? [poRoku[1], poRoku[2]] : [nazwa.trim(), ''];
}

// Typy instalacji z nazwy folderu inwestycji ("- pv, me, pc", "_PC PV ME").
function typyZNazwy(nazwa) {
  const n = ` ${normalizuj(nazwa)} `;
  return [
    [/\s(pc|pompy|pompa)\s/, 'PC'], [/\spv\s/, 'PV'], [/\sme\s/, 'ME'],
    [/\s(sol|solary|kolektory)\s/, 'SOL'], [/\skotl/, 'KOTŁY']
  ].filter(([w]) => w.test(n)).map(([, s]) => s);
}

// --- Powiadomienia ---

function toast(tekst, { typ = 'info', akcja = null, czas = 4000 } = {}) {
  const t = el('div', { class: `toast ${typ}` },
    ikona(typ === 'ok' ? 'ok' : typ === 'blad' ? 'uwaga' : 'wysylka'),
    el('span', {}, tekst),
    akcja && el('button', { type: 'button', class: 'btn btn-glowny', onclick: () => { t.remove(); akcja.onclick(); } }, akcja.etykieta)
  );
  $('toasty').append(t);
  if (czas) setTimeout(() => t.remove(), czas);
  return t;
}

function pokazUwage(id, tekst, { neutralna = false } = {}) {
  const e = $(id);
  wstaw(e, [tekst && ikona(neutralna ? 'wysylka' : 'uwaga'), tekst && el('span', {}, tekst)]);
  e.classList.toggle('neutralna', neutralna);
  e.hidden = !tekst;
}

// --- Ekrany i nawigacja (hash, żeby systemowy "wstecz" Androida działał) ---

const EKRANY = ['ekran-start', 'ekran-inwestycje', 'ekran-adresy', 'ekran-protokol'];

function pokazEkran(id, { tytul = '', podtytul = '', wstecz = true, odswiez = false, duzyTytul = false } = {}) {
  for (const e of EKRANY) $(e).hidden = e !== id;
  document.body.classList.toggle('tryb-protokol', id === 'ekran-protokol');
  $('tytul').textContent = tytul;
  $('podtytul').textContent = podtytul;
  $('wstecz').hidden = !wstecz;
  $('odswiez').hidden = !odswiez;
  $('zapisz-protokol').hidden = id !== 'ekran-protokol';
  // Na ekranach z dużym tytułem mały tytuł w pasku pojawia się po przewinięciu.
  $('pasek').classList.toggle('ukryj-tytul', duzyTytul);
  window.scrollTo(0, 0);
  przewiniecie();
}

function przewiniecie() {
  $('pasek').classList.toggle('przewiniety', window.scrollY > 40);
}
window.addEventListener('scroll', przewiniecie, { passive: true });

async function trasa() {
  const [ekran, ...p] = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (ekran !== 'p') zamknijProtokol();
  try {
    if (ekran === 'i') return await ekranAdresy(p[0]);
    if (ekran === 'p') return await ekranProtokol(p[0], p[1], p[2]);
    return await ekranInwestycje();
  } catch (blad) {
    console.error(blad);
    toast(blad.message, { typ: 'blad', czas: 8000 });
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

const szkieletListy = (ile = 6) => el('div', { class: 'lista' }, Array.from({ length: ile }, () => el('div', { class: 'szkielet' })));

async function ekranInwestycje() {
  if (!stan.inwestycje.length && navigator.onLine && !google.zalogowany()) {
    pokazEkran('ekran-start', { wstecz: false });
    return;
  }
  pokazEkran('ekran-inwestycje', { tytul: 'Inwestycje', wstecz: false, odswiez: true, duzyTytul: true });
  if (!stan.inwestycje.length) {
    if (!navigator.onLine) {
      pokazUwage('info-inwestycje', 'Brak internetu, a na tym tablecie nie ma jeszcze zapisanych inwestycji.');
      $('lista-inwestycji').replaceChildren();
      return;
    }
    pokazUwage('info-inwestycje', '');
    $('lista-inwestycji').replaceChildren(szkieletListy());
    await pobierzInwestycje();
  }
  pokazUwage('info-inwestycje', '');
  renderujInwestycje();
}

function kartaInwestycji(inw) {
  const [glowna, dodatkowa] = rozbijNazwe(inw.nazwa);
  const typy = typyZNazwy(dodatkowa || glowna);
  const ile = zrobione(inw.id);
  return el('button', { type: 'button', class: 'karta', onclick: () => { location.hash = `i/${encodeURIComponent(inw.id)}`; } },
    el('span', { class: 'karta-nazwa' }, glowna),
    typy.length > 0 && el('span', { class: 'karta-typy' }, typy.map(t => el('span', { class: 'pigulka' }, t))),
    el('span', { class: 'karta-dol' }, inw.razem
      ? [pasekPostepu(ile, inw.razem), el('span', { class: 'liczba' }, `${ile} z ${inw.razem}`)]
      : el('span', { class: 'nowa' }, 'Jeszcze nie otwierana'))
  );
}

function renderujInwestycje() {
  const fraza = normalizuj(stan.szukajInwestycji);
  const wszystkie = [...stan.inwestycje].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true }));
  const kontener = $('lista-inwestycji');
  if (fraza) {
    const wyniki = wszystkie.filter(i => normalizuj(i.nazwa).includes(fraza));
    wstaw(kontener, [wyniki.length ? el('div', { class: 'karty' }, wyniki.map(kartaInwestycji)) : el('p', { class: 'pusto' }, 'Brak inwestycji o tej nazwie.')]);
    return;
  }
  const ostatnie = stan.ostatnie.map(id => stan.inwestycje.find(i => i.id === id)).filter(Boolean).slice(0, 4);
  wstaw(kontener, [
    ostatnie.length > 0 && el('h2', { class: 'sekcja' }, 'Ostatnio otwierane'),
    ostatnie.length > 0 && el('div', { class: 'karty' }, ostatnie.map(kartaInwestycji)),
    el('h2', { class: 'sekcja' }, `Wszystkie · ${wszystkie.length}`),
    el('div', { class: 'karty' }, wszystkie.map(kartaInwestycji))
  ]);
}

$('szukaj-inwestycji').addEventListener('input', e => { stan.szukajInwestycji = e.target.value; renderujInwestycje(); });

// --- Otwarcie inwestycji: tabela montażowa + wzory, zapamiętane na offline ---

const czytajXlsx = bajty => {
  const wb = window.XLSX.read(bajty, { type: 'array' });
  return wb.SheetNames.map(nazwa => ({ nazwa, wiersze: window.XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, defval: null, blankrows: false }) }));
};

async function pobierzZDysku(wpis) {
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
    const [glowna] = rozbijNazwe(wpis.nazwa);
    pokazEkran('ekran-adresy', { tytul: glowna, duzyTytul: true });
    $('nazwa-inwestycji').textContent = glowna;
    wstaw($('podsumowanie'), [el('span', {}, 'Wczytuję tabelę i wzory z Dysku…')]);
    $('lista-adresow').replaceChildren(...Array.from({ length: 8 }, () => el('li', { class: 'szkielet' })));
    try {
      inwestycja = await pobierzZDysku(wpis);
    } catch (blad) {
      if (!inwestycja) throw blad;
      ostrzezenie = `Nie udało się odświeżyć z Dysku (${blad.message}). Pokazuję wersję zapisaną w tablecie.`;
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
  if (!inw.folderWzorow) return 'W tej inwestycji nie ma folderu „Wzory audytów”. Poproś biuro o wrzucenie wzorów protokołów.';
  const brak = TYPY.filter(t => stan.wynik.liczniki[t.id] > 0).filter(t => t.id === 'pompy'
    ? !wybierzWzor(inw.wzory, 'pompy', 'grunt') && !wybierzWzor(inw.wzory, 'pompy', 'powietrze')
    : !wybierzWzor(inw.wzory, t.id));
  return brak.length ? `Brak wzoru protokołu dla: ${brak.map(t => t.etykieta).join(', ')} (folder „${inw.folderWzorow.nazwa}”).` : '';
}

function renderujAdresy() {
  const inw = stan.inwestycja;
  const [glowna] = rozbijNazwe(inw.nazwa);
  const aktywne = stan.wynik.adresy.filter(a => !a.rezygnacja);
  const ile = zrobione(inw.id);
  pokazEkran('ekran-adresy', { tytul: glowna, odswiez: true, duzyTytul: true });
  $('nazwa-inwestycji').textContent = glowna;
  wstaw($('podsumowanie'), [pasekPostepu(ile, aktywne.length), el('span', {}, el('strong', {}, String(ile)), ` z ${aktywne.length} adresów zrobione`)]);

  const typy = TYPY.filter(t => stan.wynik.liczniki[t.id] > 0);
  const segment = (id, etykieta, liczba) => el('button', { type: 'button', 'aria-pressed': String(stan.filtrTypu === id), onclick: () => { stan.filtrTypu = id; renderujAdresy(); } },
    etykieta, el('span', { class: 'ile' }, String(liczba)));
  wstaw($('filtry'), typy.length > 1
    ? [segment(null, 'Wszystkie', aktywne.length), ...typy.map(t => segment(t.id, t.etykieta, aktywne.filter(a => a.typy.includes(t.id)).length))]
    : []);

  pokazUwage('info-adresy', stan.ostrzezenieOdswiezania || brakujaceWzory());

  const fraza = normalizuj(stan.szukajAdresu);
  const widoczne = stan.wynik.adresy.filter(a =>
    (stan.pokazRezygnacje || !a.rezygnacja) &&
    (!stan.filtrTypu || a.typy.includes(stan.filtrTypu)) &&
    (!fraza || normalizuj([a.adres, ...a.warianty, a.nazwisko, a.telefon].join(' ')).includes(fraza))
  );
  const wieleTypow = typy.length > 1;
  $('lista-adresow').replaceChildren(...widoczne.map(a => el('li', {},
    el('button', { type: 'button', class: `wiersz-przycisk${a.rezygnacja ? ' zrezygnowal' : ''}`, onclick: () => wybierzAdres(a) },
      el('span', { class: 'wiersz' },
        kolkoStatusu(statusAdresu(a)),
        el('span', { class: 'tresc' },
          el('span', { class: 'adres' }, a.adres),
          el('span', { class: 'osoba' }, [a.rezygnacja ? 'Rezygnacja' : '', a.nazwisko].filter(Boolean).join(' · ') || ' ')
        ),
        el('span', { class: 'prawa' }, wieleTypow && a.typy.map(t => el('span', { class: 'pigulka' }, TYP[t].skrot)), ikona('dalej', 'dalej'))
      )
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
  if (!navigator.onLine) { toast('Brak internetu.', { typ: 'blad' }); return; }
  try {
    if (!$('ekran-adresy').hidden && stan.inwestycja) {
      await zaladujInwestycje(stan.inwestycja.id, { odswiez: true });
      renderujAdresy();
    } else {
      $('lista-inwestycji').replaceChildren(szkieletListy());
      await pobierzInwestycje();
      renderujInwestycje();
    }
    toast('Odświeżono z Dysku', { typ: 'ok', czas: 2000 });
  } catch (blad) {
    toast(`Nie udało się odświeżyć: ${blad.message}`, { typ: 'blad', czas: 6000 });
  }
});

function wybierzAdres(a) {
  const otworz = typ => { location.hash = `p/${encodeURIComponent(stan.inwestycja.id)}/${encodeURIComponent(a.id)}/${typ}`; };
  if (a.typy.length === 1) { otworz(a.typy[0]); return; }
  // Kilka instalacji pod adresem - osobny protokół dla każdej.
  $('dialog-typ-tytul').textContent = a.adres;
  $('dialog-typ-opcje').replaceChildren(...a.typy.map(typ => {
    const status = stan.audyty.get(kluczProtokolu(a, typ))?.status;
    return el('button', { type: 'button', class: 'opcja', onclick: () => { $('dialog-typ').close(); otworz(typ); } },
      kolkoStatusu(status),
      el('span', { class: 'tresc' }, el('strong', {}, TYP[typ].etykieta), el('small', {}, OPIS_STATUSU[status] || 'Nowy protokół')),
      ikona('dalej', 'dalej'));
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
const takaSama = nazwa => n => normalizuj(n) === normalizuj(nazwa);

// Protokół i zdjęcia trafiają do:
// INWESTYCJE_3 / AUDYTY / <inwestycja> / <PC|PV|KOLEKTORY|kotły> / <adres> /
// Brakujące foldery zakładamy; id folderu typu zapamiętujemy w ustawieniach,
// id folderu adresu w protokole (rekord.drive.folder).
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

async function folderAdresu(rekord) {
  const nazwa = bezpiecznaNazwa(rekord.adres);
  return google.folderPodrzedny(await folderTypu(rekord.inwestycja, rekord.typ), takaSama(nazwa), nazwa);
}

const kluczZdjecia = (rekord, z) => `${rekord.klucz}|${z.id}`;

// Protokół (nadpisywany przy poprawkach), potem zdjęcia jeszcze niewysłane -
// każde odhaczane od razu, więc przerwana wysyłka nie powtarza wysłanych.
async function wyslijRekord(rekord, ponowienie = false) {
  try {
    const idFolderu = rekord.drive?.folder || await folderAdresu(rekord);
    const wynik = await google.wyslijPlik({ plik: rekord.pdf, nazwa: rekord.nazwaPliku, idFolderu, idPliku: rekord.drive?.id });
    rekord.drive = { id: wynik.id, link: wynik.webViewLink, folder: idFolderu };
    for (const z of rekord.zdjecia || []) {
      if (z.drive) continue;
      const plik = await odczytaj('zdjecia', kluczZdjecia(rekord, z));
      if (!plik) continue;
      z.drive = (await google.wyslijPlik({ plik, nazwa: z.nazwa, idFolderu })).id;
      await zapiszRekord(rekord);
    }
  } catch (blad) {
    // Folder albo plik skasowany/przeniesiony na Dysku w międzyczasie -
    // zapominamy zapamiętane miejsce i wysyłamy wszystko od nowa (raz).
    if (ponowienie || !/404|not found/i.test(blad.message)) throw blad;
    await usun('ustawienia', `folder|${rekord.inwestycja}|${rekord.typ}`);
    rekord.drive = null;
    for (const z of rekord.zdjecia || []) z.drive = null;
    return wyslijRekord(rekord, true);
  }
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
    toast(`Wysłano na Dysk: ${wyslane}`, { typ: 'ok' });
  } catch (blad) {
    toast(`Wysyłka przerwana (wysłano ${wyslane}): ${blad.message}`, { typ: 'blad', czas: 8000 });
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

function zamknijProtokol() {
  if (!stan.protokol) return;
  stan.protokol.edytor?.zniszcz();
  stan.protokol.dokument?.destroy();
  stan.protokol = null;
  renderujZdjecia();
}

function pokazKontakt(a) {
  const telefony = a.telefon ? a.telefon.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
  const RODZAJ = { grunt: 'Pompa gruntowa', powietrze: 'Pompa powietrzna' };
  wstaw($('kontakt'), [
    a.nazwisko && el('span', { class: 'chip' }, a.nazwisko),
    telefony.map(t => {
      const numer = t.replace(/[^\d+]/g, '');
      return numer.length >= 9 ? el('a', { class: 'chip', href: `tel:${numer}` }, ikona('telefon'), t) : el('span', { class: 'chip' }, t);
    }),
    a.rodzajPompy && el('span', { class: 'chip cichy' }, RODZAJ[a.rodzajPompy]),
    a.warianty.length > 1 && el('span', { class: 'chip cichy' }, ikona('pinezka'), `w tabeli też: ${a.warianty.filter(w => w !== a.adres).join('; ')}`)
  ]);
}

async function ekranProtokol(idInwestycji, idAdresu, typ) {
  await zaladujInwestycje(idInwestycji);
  const a = stan.wynik.adresy.find(x => x.id === idAdresu);
  if (!a || !TYP[typ]) { location.hash = `i/${encodeURIComponent(idInwestycji)}`; return; }
  const klucz = kluczProtokolu(a, typ);
  if (stan.protokol?.rekord.klucz === klucz) return;
  zamknijProtokol();
  pokazEkran('ekran-protokol', { tytul: a.adres, podtytul: `${TYP[typ].etykieta} · ${rozbijNazwe(stan.inwestycja.nazwa)[0]}` });
  pokazKontakt(a);
  $('strony').replaceChildren(el('div', { class: 'strona szkielet', style: 'aspect-ratio: 595 / 842' }));
  pokazUwage('komunikat', '');
  $('zapisz-protokol').disabled = true;

  const wzor = wybierzWzor(stan.inwestycja.wzory, typ, a.rodzajPompy);
  if (!wzor) {
    $('strony').replaceChildren();
    pokazUwage('komunikat', typ === 'pompy' && !a.rodzajPompy
      ? 'Nie wiem, który wzór wybrać: w tabeli brak „rodzaju pompy”, a w folderze wzorów jest kilka wzorów PC.'
      : `Brak wzoru protokołu dla: ${TYP[typ].etykieta}. Poproś biuro o wrzucenie go do folderu „Wzory audytów” tej inwestycji.`);
    return;
  }
  let szablon = await odczytaj('szablony', wzor.id);
  if (!szablon && navigator.onLine) {
    szablon = { nazwa: wzor.nazwa, modifiedTime: wzor.modifiedTime, bajty: await google.pobierzPlik(wzor) };
    await zapisz('szablony', wzor.id, szablon);
  }
  if (!szablon) { $('strony').replaceChildren(); pokazUwage('komunikat', 'Wzoru nie ma w pamięci tabletu, a nie ma internetu.'); return; }

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
  if (rekord.wzor && rekord.wzor !== wzor.id) {
    const stary = await odczytaj('szablony', rekord.wzor);
    if (stary) szablon = stary;
  }
  rekord.wzor ||= wzor.id;
  rekord.zdjecia ||= [];
  const otwarty = { rekord, szablon, zdjecia: new Map() };
  stan.protokol = otwarty;
  for (const z of rekord.zdjecia) {
    const plik = await odczytaj('zdjecia', kluczZdjecia(rekord, z));
    if (plik) otwarty.zdjecia.set(z.id, plik);
  }
  renderujZdjecia();

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
  $('zapisz-protokol').disabled = false;
  if (rekord.status === 'wyslany') pokazUwage('komunikat', 'Ten protokół jest już na Dysku. Po poprawkach stuknij „Zapisz” – plik się podmieni.', { neutralna: true });
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
    toast(`Nie udało się zapisać w pamięci tabletu: ${blad.message}`, { typ: 'blad', czas: 8000 });
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
  stan.protokol?.edytor?.ustawTrybPalca(wlaczony);
  toast(wlaczony ? 'Pisanie palcem włączone – przewijaj dwoma palcami' : 'Palec przewija, rysik pisze', { czas: 2500 });
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

// --- Zdjęcia ---

// Zdjęcie z aparatu tabletu ma zwykle 3-8 MB. JPEG do 4,5 MB idzie jak jest
// (z datą i GPS w EXIF), większe i inne formaty zmniejszamy do 3000 px -
// wysyłka jednym zapytaniem przyjmuje do 5 MB, a w terenie liczy się transfer.
const BOK_ZDJECIA = 3000;
async function przygotujZdjecie(plik) {
  if (plik.type === 'image/jpeg' && plik.size <= 4.5e6) return plik;
  const obraz = await createImageBitmap(plik, { imageOrientation: 'from-image' });
  const skala = Math.min(1, BOK_ZDJECIA / Math.max(obraz.width, obraz.height));
  const plotno = document.createElement('canvas');
  plotno.width = Math.round(obraz.width * skala);
  plotno.height = Math.round(obraz.height * skala);
  plotno.getContext('2d').drawImage(obraz, 0, 0, plotno.width, plotno.height);
  obraz.close();
  return new Promise((ok, blad) => plotno.toBlob(b => b ? ok(b) : blad(new Error('nie udało się zmniejszyć zdjęcia')), 'image/jpeg', 0.88));
}

const ileZdjec = n => `${n} ${n === 1 ? 'zdjęcie' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'zdjęcia' : 'zdjęć'}`;

let adresyMiniatur = [];
function renderujZdjecia() {
  for (const u of adresyMiniatur) URL.revokeObjectURL(u);
  adresyMiniatur = [];
  const otwarty = stan.protokol;
  const zdjecia = otwarty?.rekord.zdjecia || [];
  $('licznik-zdjec').hidden = !zdjecia.length;
  $('licznik-zdjec').textContent = zdjecia.length;
  wstaw($('zdjecia'), !otwarty ? [] : [
    zdjecia.map(z => {
      const plik = otwarty.zdjecia.get(z.id);
      const url = plik && URL.createObjectURL(plik);
      if (url) adresyMiniatur.push(url);
      return el('div', { class: 'miniatura' },
        url && el('img', { src: url, alt: z.nazwa }),
        z.drive
          ? el('span', { class: 'na-dysku', title: 'Na Dysku' }, ikona('ok'))
          : el('button', { type: 'button', 'aria-label': 'Usuń zdjęcie', onclick: () => usunZdjecie(z) }, ikona('zamknij')));
    }),
    el('button', { type: 'button', class: 'dodaj-zdjecie', onclick: () => $('wybierz-zdjecia').click() }, ikona('zdjecie'), 'Dodaj zdjęcia')
  ]);
}

// Nowe zdjęcie przy wysłanym protokole - protokół czeka na wysyłkę (zdjęcia
// pójdą z kolejki albo po "Zapisz"); przy szkicu zostaje szkic.
function oznaczZdjeciaDoWysylki(rekord) {
  rekord.status = rekord.status === 'wyslany' || rekord.status === 'zapisany' ? 'zapisany' : 'szkic';
  rekord.zmieniono = new Date().toISOString();
}

async function usunZdjecie(z) {
  const otwarty = stan.protokol;
  if (!otwarty) return;
  otwarty.rekord.zdjecia = otwarty.rekord.zdjecia.filter(x => x !== z);
  otwarty.zdjecia.delete(z.id);
  await usun('zdjecia', kluczZdjecia(otwarty.rekord, z));
  await zapiszRekord(otwarty.rekord);
  renderujZdjecia();
}

$('dodaj-zdjecia').addEventListener('click', () => { if (stan.protokol?.edytor) $('wybierz-zdjecia').click(); });

$('wybierz-zdjecia').addEventListener('change', async e => {
  const pliki = [...e.target.files];
  e.target.value = '';
  const otwarty = stan.protokol;
  if (!otwarty || !pliki.length) return;
  const rekord = otwarty.rekord;
  const trwa = toast(`Dodaję ${ileZdjec(pliki.length)}…`, { czas: 0 });
  let dodane = 0;
  try {
    for (const plik of pliki) {
      const gotowy = await przygotujZdjecie(plik);
      rekord.licznikZdjec = (rekord.licznikZdjec || 0) + 1;
      const nr = String(rekord.licznikZdjec).padStart(2, '0');
      const z = { id: crypto.randomUUID(), nazwa: bezpiecznaNazwa(`${rekord.adres}_${SKROT_PLIKU[rekord.typ]}_zdjęcie ${nr}`) + '.jpg', drive: null };
      await zapisz('zdjecia', kluczZdjecia(rekord, z), gotowy);
      otwarty.zdjecia.set(z.id, gotowy);
      rekord.zdjecia.push(z);
      dodane += 1;
    }
  } catch (blad) {
    console.error(blad);
    toast(`Nie udało się dodać zdjęcia: ${blad.message}`, { typ: 'blad', czas: 8000 });
  }
  trwa.remove();
  if (!dodane) return;
  oznaczZdjeciaDoWysylki(rekord);
  await zapiszRekord(rekord);
  if (stan.protokol === otwarty) renderujZdjecia();
  toast(`Dodano ${ileZdjec(dodane)}. Pójdą na Dysk po „Zapisz”.`, { typ: 'ok' });
});

// "Bartodzieje 21_PC.pdf" - tak jak dotychczasowe audyty w folderach projektów.
const nazwaPliku = rekord => bezpiecznaNazwa(`${rekord.adres}_${SKROT_PLIKU[rekord.typ]}`) + '.pdf';

$('zapisz-protokol').addEventListener('click', async () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor) return;
  const przycisk = $('zapisz-protokol');
  przycisk.disabled = true;
  const trwa = toast('Zapisuję protokół…', { czas: 0 });
  const nastepny = { etykieta: 'Następny adres', onclick: () => history.back() };
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
      trwa.remove();
      toast('Zapisano w tablecie. Wyślesz z listy adresów, gdy będzie zasięg.', { typ: 'ok', akcja: nastepny, czas: 8000 });
      return;
    }
    try {
      await wyslijRekord(rekord);
      trwa.remove();
      if (stan.protokol === otwarty) renderujZdjecia();
      const zdjecia = rekord.zdjecia.length ? ` + ${ileZdjec(rekord.zdjecia.length)}` : '';
      toast(`Zapisano na Dysku: ${rekord.nazwaPliku}${zdjecia}`, { typ: 'ok', akcja: nastepny, czas: 8000 });
    } catch (blad) {
      console.error(blad);
      trwa.remove();
      toast(`Zapisano w tablecie, ale wysyłka się nie udała (${blad.message}). Wyślesz z listy adresów.`, { typ: 'blad', akcja: nastepny, czas: 10000 });
    }
  } catch (blad) {
    console.error(blad);
    trwa.remove();
    toast(`Nie udało się zapisać protokołu: ${blad.message}`, { typ: 'blad', czas: 10000 });
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
  wstawIkony();
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
