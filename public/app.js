import * as pdfjs from './vendor/pdf.min.mjs';
import { TYPY, normalizuj, zbudujListeAdresow, znajdzNaglowek } from './src/tabela.js';
import { odczytaj, zapisz, usun, wszystkie } from './src/magazyn.js';
import { wyliczWpisy, tekstSzablonu } from './src/wypelnianie.js';
import { utworzEdytor } from './src/edytor.js';
import { zbudujPdf } from './src/eksport.js';
import { wybierzWzor, rozpoznajWzor } from './src/wzory.js';
import { PYTANIA_PV, kolumnyPytan, odpowiedziZWiersza, znajdzWiersz, zmianyWiersza, pytaniaNaWzorze, odpowiedziZProtokolu } from './src/ankieta.js';
import { polaZestawu, wartosciPoczatkowe, iloscKoncowa, recznaIlosc, wierszeMaterialowki, zmianyMaterialowki, arkuszMaterialowki, datyWMontazowej, datyZMontazowej, wyczyscWydanie, ekipaZMontazowej, podpowiedzZestawu, blokiDoUsuniecia, dataCzytelna, zalacznikiStanu, stanZPdf } from './src/wniosek.js';
import { zakres } from './src/tabela-materialowa.js';
import { przypiszKreski, podpisPisma, wycinekPola, odczytajIlosci, zlyKlucz } from './src/odczyt-pisma.js';
import { ikona, wstawIkony } from './src/ikony.js';
import * as google from './src/google.js';
import { DYSK, WERSJA_APLIKACJI } from './config.js';

pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

const TYP = Object.fromEntries(TYPY.map(t => [t.id, t]));
const SKROT_PLIKU = { pompy: 'PC', pv_me: 'PV', solary: 'KOLEKTORY', kotly: 'KOTŁY' };

// Dwie osobne aplikacje z jednego kodu - korzystają z nich inne osoby:
//   Audyty       – …/audyt-tablet/                      (audytorzy w terenie)
//   Materiałówki – …/audyt-tablet/?app=materialowki      (magazyn; skrót …/materialowki/)
// Każda ma własny manifest (nazwa i ikona na tablecie) i nie pokazuje
// ekranów, przełącznika ani liczników drugiej.
const MATERIALOWKI = new URLSearchParams(location.search).get('app') === 'materialowki';

// Stan aplikacji. Lista inwestycji, otwarte inwestycje (tabela + wzory) i
// protokoły są w IndexedDB - aplikacja działa w terenie bez internetu.
const stan = {
  inwestycje: [], // [{ id, nazwa, tabela, razem }] - foldery z INWESTYCJE_3
  ostatnie: [], // id ostatnio otwieranych inwestycji
  inwestycja: null, // otwarta: { id, nazwa, tabela, arkusze, wzory, folderWzorow, pobrano }
  wynik: null, // zbudujListeAdresow dla otwartej inwestycji
  audyty: new Map(), // klucz protokołu/wniosku -> { status, inwestycja, typ, zatwierdzono }
  tryb: MATERIALOWKI ? 'wnioski' : 'audyty', // stały dla aplikacji: audyty albo wnioski (materiałówki)
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

function pokazUwage(id, tekst, { neutralna = false, znak = null } = {}) {
  const e = $(id);
  wstaw(e, [tekst && ikona(znak || (neutralna ? 'wysylka' : 'uwaga')), tekst && el('span', {}, tekst)]);
  e.classList.toggle('neutralna', neutralna);
  e.hidden = !tekst;
}

// --- Ekrany i nawigacja (hash, żeby systemowy "wstecz" Androida działał) ---

const EKRANY = ['ekran-start', 'ekran-inwestycje', 'ekran-adresy', 'ekran-protokol'];
const TYLKO_ARKUSZ_GOOGLE = 'tabela montażowa jest plikiem Excela – aplikacja wpisuje tylko do Arkuszy Google';

function pokazEkran(id, { tytul = '', podtytul = '', wstecz = true, odswiez = false, duzyTytul = false } = {}) {
  for (const e of EKRANY) $(e).hidden = e !== id;
  document.body.classList.toggle('tryb-protokol', id === 'ekran-protokol');
  $('tytul').textContent = tytul;
  $('podtytul').textContent = podtytul;
  $('wstecz').hidden = !wstecz;
  $('odswiez').hidden = !odswiez;
  $('zapisz-protokol').hidden = id !== 'ekran-protokol';
  $('zatwierdz-wniosek').hidden = true;
  document.body.classList.remove('tryb-wniosek', 'wniosek-zablokowany');
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
  if (ekran !== 'p' && ekran !== 'w') zamknijProtokol();
  if (stan.czekaAktualizacja && ekran !== 'p' && ekran !== 'w') { location.reload(); return; }
  // Link do ekranu drugiej aplikacji (protokół w Materiałówkach, materiałówka
  // w Audytach) - tylko lista adresów tej inwestycji.
  if ((ekran === 'p' && MATERIALOWKI) || (ekran === 'w' && !MATERIALOWKI)) { location.replace(`#i/${encodeURIComponent(p[0] || '')}`); return; }
  try {
    if (ekran === 'i') return await ekranAdresy(p[0]);
    if (ekran === 'p') return await ekranProtokol(p[0], p[1], p[2]);
    if (ekran === 'w') return await ekranWniosek(p[0], p[1], p[2], p[3]);
    return await ekranInwestycje();
  } catch (blad) {
    console.error(blad);
    toast(blad.message, { typ: 'blad', czas: 8000 });
  }
}

// Numer wpisu w historii (state.n): wejście do inwestycji/adresu dostaje
// kolejny numer. Aplikacja otwarta od razu w środku (odświeżona, przywrócona
// karta) dostaje pod spodem wpisy rodziców - „wstecz” (także przycisk tabletu)
// wraca do listy adresów i inwestycji, zamiast zamykać aplikację.
window.addEventListener('hashchange', () => {
  if (history.state?.n == null) history.replaceState({ n: (stan.wpisHistorii ?? 0) + 1 }, '');
  stan.wpisHistorii = history.state.n;
  trasa();
});
$('wstecz').addEventListener('click', () => history.back());

function historiaRodzicow() {
  if (history.state?.n != null) { stan.wpisHistorii = history.state.n; return; }
  const [ekran, idInwestycji] = location.hash.slice(1).split('/');
  const baza = location.pathname + location.search;
  const cel = location.hash;
  history.replaceState({ n: 0 }, '', baza);
  stan.wpisHistorii = 0;
  if (!['i', 'p', 'w'].includes(ekran) || !idInwestycji) return;
  if (ekran !== 'i') history.pushState({ n: ++stan.wpisHistorii }, '', `${baza}#i/${idInwestycji}`);
  history.pushState({ n: ++stan.wpisHistorii }, '', baza + cel);
}

// --- Logowanie ---

$('zaloguj').addEventListener('click', async () => {
  $('blad-logowania').hidden = true;
  try {
    await google.zaloguj();
    await pobierzInwestycje();
    stan.poAktualizacji = false;
    $('info-logowania').hidden = true;
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

// Ile adresów inwestycji ma już zapisany protokół (Audyty) albo zatwierdzoną
// materiałówkę (Materiałówki) - każda aplikacja liczy tylko swoje.
function zrobione(idInwestycji) {
  const adresy = new Set();
  for (const [klucz, a] of stan.audyty) {
    if ((a.typ === 'wniosek') !== MATERIALOWKI || a.inwestycja !== idInwestycji) continue;
    if (MATERIALOWKI ? a.zatwierdzono : (a.status === 'zapisany' || a.status === 'wyslany')) adresy.add(klucz.split('|')[1]);
  }
  return adresy.size;
}

const szkieletListy = (ile = 6) => el('div', { class: 'lista' }, Array.from({ length: ile }, () => el('div', { class: 'szkielet' })));

async function ekranInwestycje() {
  if ((!stan.inwestycje.length || stan.poAktualizacji) && navigator.onLine && !google.zalogowany()) {
    $('info-logowania').hidden = !stan.poAktualizacji;
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
    el('span', { class: 'karta-dol' }, !inw.razem
      ? el('span', { class: 'nowa' }, 'Jeszcze nie otwierana')
      : MATERIALOWKI
        ? el('span', { class: 'liczba' }, ile ? `Zatwierdzone: ${ile}` : 'Brak zatwierdzonych')
        : [pasekPostepu(ile, inw.razem), el('span', { class: 'liczba' }, `${ile} z ${inw.razem}`)])
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
  // Materiałówki: zestawy (PDF, od razu do pamięci tabletu) i arkusz
  // „Materiałówka” - brak albo błąd nie blokuje audytów.
  let materialowki = null;
  try {
    materialowki = await google.materialowkiInwestycji(wpis.id, DYSK.foldery);
    for (const r of Object.values(materialowki?.rodzaje || {})) for (const z of r.zestawy) await wersjaWzoru(z);
  } catch (blad) {
    console.warn('Nie odczytano materiałówek', blad);
  }
  const inwestycja = { id: wpis.id, nazwa: wpis.nazwa, tabela: wpis.tabela, arkusze, materialowki, ...folder, pobrano: new Date().toISOString(), wersja: WERSJA_APLIKACJI };
  await zapisz('inwestycje', wpis.id, inwestycja);
  return inwestycja;
}

async function zaladujInwestycje(id, { odswiez = false } = {}) {
  if (stan.inwestycja?.id === id && !odswiez) return;
  const wpis = stan.inwestycje.find(i => i.id === id);
  let inwestycja = await odczytaj('inwestycje', id);
  let ostrzezenie = '';
  // Inwestycja zapisana przez starszą wersję aplikacji - pobieramy od nowa,
  // bez czekania na „Odśwież” (nowa wersja może czytać z Dysku więcej).
  const przestarzala = inwestycja && inwestycja.wersja !== WERSJA_APLIKACJI;
  if (wpis && navigator.onLine && (odswiez || !inwestycja || przestarzala)) {
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

// Wniosek jest osobny dla każdej instalacji pod adresem (PV i PC to dwa wnioski).
const kluczWniosku = (idInwestycji, idAdresu, typ) => `${idInwestycji}|${idAdresu}|wniosek|${typ}`;
// Rodzaj w tabeli materiałowej i nazwa folderu: PV, PC, KOLEKTORY, kotły.
const rodzajWniosku = typ => DYSK.foldery[typ] || typ;

// Wiersze adresu w tabeli montażowej (arkusz danego rodzaju instalacji).
const wierszeMontazowe = (a, typ) => a.rekordy.filter(r => r.typ === typ).map(({ arkusz, wiersz, uid, adres }) => ({ arkusz, wiersz, uid, adres }));

// Daty materiałówki z tabeli montażowej wczytanej z inwestycją.
function datyAdresu(a, typ) {
  const d = { wydano: '', zakonczono: '' };
  for (const r of wierszeMontazowe(a, typ)) {
    const z = datyZMontazowej(wierszeArkusza(r.arkusz), r.wiersz);
    d.wydano ||= z.wydano;
    d.zakonczono ||= z.zakonczono;
  }
  return d;
}

// Materiałówka: zatwierdzona (w tablecie albo w tabeli montażowej z innego
// urządzenia), czeka na wysyłkę, rozpoczęta, albo brak.
function statusWniosku(a, typ) {
  const lokalny = stan.audyty.get(kluczWniosku(stan.inwestycja.id, a.id, typ));
  const zTabeli = datyAdresu(a, typ);
  if (lokalny?.zatwierdzono || (zTabeli.zakonczono && (!lokalny || lokalny.status === 'wyslany'))) return 'zatwierdzony';
  if (lokalny?.status === 'zapisany') return 'zapisany';
  return lokalny?.status || zTabeli.wydano ? 'rozpoczety' : null;
}

const OPIS_WNIOSKU = { zatwierdzony: 'Zatwierdzony', zapisany: 'Czeka na wysyłkę', rozpoczety: 'W trakcie' };
const kolkoWniosku = status => el('span', { class: `kolko ${{ zatwierdzony: 'wyslany', zapisany: 'zapisany', rozpoczety: 'szkic' }[status] || ''}`, title: OPIS_WNIOSKU[status] || 'Nie rozpoczęty' },
  status && ikona({ zatwierdzony: 'klodka', zapisany: 'wysylka', rozpoczety: 'pioro' }[status]));

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
  const wnioski = stan.tryb === 'wnioski';
  const typy = TYPY.filter(t => stan.wynik.liczniki[t.id] > 0);
  // Wnioski: najpierw rodzaj instalacji (PV / PC), potem adres - bez "Wszystkie".
  if (wnioski && !typy.some(t => t.id === stan.filtrTypu)) stan.filtrTypu = typy.find(t => zestawyTypu(t.id).length)?.id || typy[0]?.id || null;
  const typWniosku = wnioski ? stan.filtrTypu : null;
  const sWniosku = a => statusWniosku(a, typWniosku);
  pokazEkran('ekran-adresy', { tytul: glowna, odswiez: true, duzyTytul: true });
  $('nazwa-inwestycji').textContent = glowna;
  if (wnioski) {
    const adresyTypu = aktywne.filter(a => a.typy.includes(typWniosku));
    const zatwierdzone = adresyTypu.filter(a => sWniosku(a) === 'zatwierdzony').length;
    const wTrakcie = adresyTypu.filter(a => ['rozpoczety', 'zapisany'].includes(sWniosku(a))).length;
    wstaw($('podsumowanie'), [pasekPostepu(zatwierdzone, adresyTypu.length), el('span', {}, el('strong', {}, String(zatwierdzone)), ` z ${adresyTypu.length} materiałówek zatwierdzonych`, wTrakcie ? ` · ${wTrakcie} w trakcie` : '')]);
  } else {
    const ile = zrobione(inw.id);
    wstaw($('podsumowanie'), [pasekPostepu(ile, aktywne.length), el('span', {}, el('strong', {}, String(ile)), ` z ${aktywne.length} adresów zrobione`)]);
  }
  wstaw($('tryb'), []); // audyty i materiałówki to osobne aplikacje - bez przełącznika

  const segment = (id, etykieta, liczba) => el('button', { type: 'button', 'aria-pressed': String(stan.filtrTypu === id), onclick: () => { stan.filtrTypu = id; renderujAdresy(); } },
    etykieta, el('span', { class: 'ile' }, String(liczba)));
  const segmentTypu = t => segment(t.id, t.etykieta, aktywne.filter(a => a.typy.includes(t.id)).length);
  wstaw($('filtry'), wnioski
    ? typy.map(segmentTypu)
    : typy.length > 1 ? [segment(null, 'Wszystkie', aktywne.length), ...typy.map(segmentTypu)] : []);

  const nazwaRodzaju = TYP[typWniosku]?.etykieta || '';
  pokazUwage('info-adresy', stan.ostrzezenieOdswiezania || (wnioski
    ? (zestawyTypu(typWniosku).length ? '' : `Brak zestawów materiałówek${nazwaRodzaju ? ` dla: ${nazwaRodzaju}` : ''}. Wrzuć PDF-y zestawów do folderu „${folderMaterialowek()} / ${rodzajWniosku(typWniosku || 'pompy')}” tej inwestycji i odśwież.`)
    : brakujaceWzory()));

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
        wnioski ? kolkoWniosku(sWniosku(a)) : kolkoStatusu(statusAdresu(a)),
        el('span', { class: 'tresc' },
          el('span', { class: 'adres' }, a.adres),
          el('span', { class: 'osoba' }, [a.rezygnacja ? 'Rezygnacja' : '', a.nazwisko].filter(Boolean).join(' · ') || ' ')
        ),
        el('span', { class: 'prawa' }, wieleTypow && !wnioski && a.typy.map(t => el('span', { class: 'pigulka' }, TYP[t].skrot)), ikona('dalej', 'dalej'))
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
  if (stan.tryb === 'wnioski') { location.hash = `w/${encodeURIComponent(stan.inwestycja.id)}/${encodeURIComponent(a.id)}/${stan.filtrTypu}`; return; }
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

const czekajace = () => [...stan.audyty].filter(([, a]) => a.status === 'zapisany' && a.inwestycja === stan.inwestycja?.id && (a.typ === 'wniosek') === MATERIALOWKI).map(([k]) => k);

function pokazKolejke() {
  const ile = czekajace().length;
  $('kolejka').hidden = ile === 0;
  if (!ile) return;
  $('kolejka-opis').textContent = `Czeka na wysyłkę na Dysk: ${ile}`;
  $('wyslij-kolejke').disabled = !navigator.onLine;
}

const bezpiecznaNazwa = t => t.replace(/[\\/:*?"<>|]+/g, '-').trim();
const takaSama = nazwa => n => normalizuj(n) === normalizuj(nazwa);

// Protokół i zdjęcia trafiają do:
//   INWESTYCJE_3 / AUDYTY / <inwestycja> / <PC|PV|KOLEKTORY|kotły> / <adres> /
// materiałówki do folderu materiałówek inwestycji, obok zestawów:
//   INWESTYCJE_3 / <inwestycja> / <…Materiałówki> / <PC|PV|...> / <adres> /
// Brakujące foldery zakładamy; id folderu typu zapamiętujemy w ustawieniach,
// id folderu adresu w protokole (rekord.drive.folder).
const kluczFolderu = rekord => rekord.typ === 'wniosek'
  ? `folder|${rekord.inwestycja}|materialowka|${rekord.instalacja}`
  : `folder|${rekord.inwestycja}|${rekord.typ}`;

async function folderTypu(rekord) {
  const klucz = kluczFolderu(rekord);
  const zapamietany = await odczytaj('ustawienia', klucz);
  if (zapamietany) return zapamietany;
  let idTypu;
  if (rekord.typ === 'wniosek') {
    const { materialowki } = await odczytaj('inwestycje', rekord.inwestycja);
    if (!materialowki) throw new Error('w inwestycji nie ma folderu materiałówek');
    const rodzaj = rodzajWniosku(rekord.instalacja);
    idTypu = materialowki.rodzaje?.[rekord.instalacja]?.folder || await google.folderPodrzedny(materialowki.id, takaSama(rodzaj), rodzaj);
  } else {
    const inw = await odczytaj('inwestycje', rekord.inwestycja);
    const idDysku = await google.idDysku(DYSK.inwestycje);
    const idAudytow = await google.folderPodrzedny(idDysku, takaSama(DYSK.audyty), DYSK.audyty);
    const idInw = await google.folderPodrzedny(idAudytow, takaSama(inw.nazwa), bezpiecznaNazwa(inw.nazwa));
    idTypu = await google.folderPodrzedny(idInw, takaSama(DYSK.foldery[rekord.typ]), DYSK.foldery[rekord.typ]);
  }
  await zapisz('ustawienia', klucz, idTypu);
  return idTypu;
}

async function folderAdresu(rekord) {
  const nazwa = bezpiecznaNazwa(rekord.adres);
  return google.folderPodrzedny(await folderTypu(rekord), takaSama(nazwa), nazwa);
}

const kluczZdjecia = (rekord, z) => `${rekord.klucz}|${z.id}`;

// Protokół (nadpisywany przy poprawkach), potem zdjęcia jeszcze niewysłane -
// każde odhaczane od razu, więc przerwana wysyłka nie powtarza wysłanych.
async function wyslijRekord(rekord, ponowienie = false) {
  try {
    const idFolderu = rekord.drive?.folder || await folderAdresu(rekord);
    const wynik = await google.wyslijPlik({ plik: rekord.pdf, nazwa: rekord.nazwaPliku, idFolderu, idPliku: rekord.drive?.id });
    rekord.drive = { id: wynik.id, link: wynik.webViewLink, folder: idFolderu, modifiedTime: wynik.modifiedTime };
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
    await usun('ustawienia', kluczFolderu(rekord));
    rekord.drive = null;
    for (const z of rekord.zdjecia || []) z.drive = null;
    return wyslijRekord(rekord, true);
  }
  // Tabela po plikach i poza blokiem wyżej: 404 z arkusza to nie skasowany folder.
  if (rekord.tabela && !rekord.tabela.wpisano) {
    await zapiszRekord(rekord);
    if (rekord.typ === 'wniosek') await wpiszWniosek(rekord);
    else await wpiszDoTabeli(rekord);
    rekord.tabela.wpisano = true;
  }
  rekord.status = 'wyslany';
  rekord.wyslano = new Date().toISOString();
  await zapiszRekord(rekord);
}

// Odpowiedzi PV do każdego wiersza PV tego adresu, na świeżo pobranym arkuszu.
async function wpiszDoTabeli(rekord) {
  const { tabela } = await odczytaj('inwestycje', rekord.inwestycja);
  if (tabela.mimeType !== google.MIME.arkusz) throw new Error(TYLKO_ARKUSZ_GOOGLE);
  try {
    for (const cel of rekord.wiersze || []) {
      const wiersze = await google.wartosciArkusza(tabela.id, cel.arkusz);
      const nrWiersza = znajdzWiersz(wiersze, cel);
      if (!nrWiersza) throw new Error(`nie znalazłem w tabeli wiersza „${cel.adres}” (arkusz ${cel.arkusz})`);
      const { dane } = zmianyWiersza({ arkusz: cel.arkusz, wiersze, nrWiersza, odpowiedzi: rekord.tabela.odpowiedzi });
      if (dane.length) await google.zapiszKomorki(tabela.id, dane);
    }
  } catch (blad) {
    if (blad.status === 403) throw new Error('to konto nie może edytować tabeli montażowej – biuro musi dać uprawnienia „Edytujący”');
    throw blad;
  }
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
  document.body.classList.remove('tryb-wniosek', 'wniosek-zablokowany', 'klawiatura-ilosci');
  $('akcje-wniosku').hidden = true;
  $('klawiatura-ilosci').setAttribute('aria-pressed', 'false');
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
  if (stan.protokol?.rekord?.klucz === klucz) return;
  zamknijProtokol();
  pokazEkran('ekran-protokol', { tytul: a.adres, podtytul: `${TYP[typ].etykieta} · ${rozbijNazwe(stan.inwestycja.nazwa)[0]}` });
  pokazKontakt(a);
  $('strony').replaceChildren(el('div', { class: 'strona szkielet', style: 'aspect-ratio: 595 / 842' }));
  pokazUwage('komunikat', '');
  $('zapisz-protokol').disabled = true;

  const wzor = wybierzWzor(stan.inwestycja.wzory, typ, a.rodzajPompy);
  if (!wzor) {
    $('strony').replaceChildren();
    const ileWzorowPc = stan.inwestycja.wzory.filter(w => rozpoznajWzor(w.nazwa).typ === 'pompy').length;
    pokazUwage('komunikat', typ === 'pompy' && !a.rodzajPompy && ileWzorowPc > 1
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
  // Wiersze tabeli tego adresu i typu - do wpisania odpowiedzi z audytu.
  rekord.wiersze = a.rekordy.filter(r => r.typ === typ).map(({ arkusz, wiersz, uid, adres }) => ({ arkusz, wiersz, uid, adres }));
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
  // Gdzie na wzorze są kratki pytań do tabeli (na razie tylko PV).
  otwarty.mapa = typ === 'pv_me' ? pytaniaNaWzorze(otwarty.strony) : {};
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
    stan.audyty.set(rekord.klucz, { status: rekord.status, inwestycja: rekord.inwestycja, typ: rekord.typ, zatwierdzono: rekord.zatwierdzono || null });
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
  // Materiałówki są bez zdjęć.
  const otwarty = stan.protokol?.rekord && stan.protokol.rekord.typ !== 'wniosek' ? stan.protokol : null;
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

$('dodaj-zdjecia').addEventListener('click', () => { if (stan.protokol?.edytor && stan.protokol.rekord.typ !== 'wniosek') $('wybierz-zdjecia').click(); });

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

// --- Dane do tabeli (PV) ---

const wierszeArkusza = nazwa => stan.inwestycja?.arkusze.find(a => a.nazwa === nazwa)?.wiersze || [];

// Pytanie, którego nie ma na protokole - audytor zaznacza przyciskiem.
function pytanieTabeli(p, odpowiedzi) {
  const wybrana = id => Boolean(odpowiedzi[p.id]?.opcje.includes(id));
  const dopisek = el('input', {
    class: 'dopisek',
    placeholder: 'Jakie? (opcjonalnie)',
    autocomplete: 'off',
    value: odpowiedzi[p.id]?.dopisek || '',
    oninput: e => { if (odpowiedzi[p.id]) odpowiedzi[p.id].dopisek = e.target.value.trim(); }
  });
  const przyciski = p.opcje.map(o => el('button', {
    type: 'button',
    class: p.id === 'rezygnacja' ? 'wybor grozny' : 'wybor',
    // Drugie stuknięcie odznacza - wtedy komórka w tabeli zostaje bez zmian.
    onclick: () => {
      if (wybrana(o.id)) delete odpowiedzi[p.id];
      else odpowiedzi[p.id] = { opcje: [o.id], dopisek: o.dopisek ? dopisek.value.trim() : '' };
      odswiez();
    }
  }, o.etykieta));
  const odswiez = () => {
    przyciski.forEach((b, i) => b.setAttribute('aria-pressed', String(wybrana(p.opcje[i].id))));
    dopisek.hidden = !p.opcje.some(o => o.dopisek && wybrana(o.id));
  };
  odswiez();
  return el('fieldset', { class: 'pytanie' }, el('legend', {}, p.pytanie), el('div', { class: 'wybory' }, przyciski), dopisek);
}

// Odpowiedź odczytana z kratek protokołu - tylko do wglądu; poprawia się ją
// na protokole, żeby PDF i tabela zawsze mówiły to samo.
function odczytZProtokolu(p, odpowiedz, niejasne) {
  const tresc = niejasne
    ? el('p', { class: 'odczyt ostrzezenie' }, ikona('uwaga'), 'Zaznaczone dwie sprzeczne kratki – popraw na protokole. W tabeli bez zmian.')
    : odpowiedz
      ? el('div', { class: 'wybory' }, p.opcje.filter(o => odpowiedz.opcje.includes(o.id))
        .map(o => el('span', { class: p.id === 'rezygnacja' ? 'odczytana grozna' : 'odczytana' }, ikona('ok'), p.id === 'rezygnacja' ? 'Klient rezygnuje (wypełniona sekcja rezygnacji)' : o.etykieta)))
      : el('p', { class: 'odczyt' }, 'Nic nie zaznaczono – w tabeli bez zmian');
  return el('div', { class: 'pytanie' }, el('div', { class: 'legenda' }, p.pytanie), tresc);
}

// Okno przed zapisem PV. Pytania tylko te, które mają kolumnę w tabeli:
// odpowiedzi z kratek zaznaczonych na protokole (podgląd) + przyciski dla
// pytań, których na protokole nie ma (na start: poprzedni wybór albo stan tabeli).
// undefined: tabela nie ma żadnej z kolumn, null: audytor wrócił do protokołu.
function zapytajOTabele(otwarty) {
  const { rekord, mapa } = otwarty;
  const cel = rekord.wiersze?.[0];
  const wiersze = cel ? wierszeArkusza(cel.arkusz) : [];
  const naglowek = znajdzNaglowek(wiersze);
  const kolumny = naglowek ? kolumnyPytan(wiersze[naglowek.wiersz]) : {};
  const pytania = PYTANIA_PV.filter(p => kolumny[p.id] !== undefined);
  if (!pytania.length) return Promise.resolve(undefined);

  const { odpowiedzi: zProtokolu, niejasne } = odpowiedziZProtokolu(mapa, otwarty.edytor.kreski, otwarty.strony);
  const naProtokole = pytania.filter(p => mapa[p.id] && (p.id !== 'rezygnacja' || zProtokolu.rezygnacja));
  const doZaznaczenia = pytania.filter(p => !mapa[p.id]);
  const wczesniej = rekord.tabela?.odpowiedzi || odpowiedziZWiersza(wiersze, cel.wiersz);
  const odpowiedzi = Object.fromEntries(doZaznaczenia.filter(p => wczesniej[p.id]).map(p => [p.id, structuredClone(wczesniej[p.id])]));

  $('dialog-tabela-opis').textContent = naProtokole.length
    ? 'Odczytane z kratek zaznaczonych na protokole. Jeśli coś się nie zgadza, wróć i popraw na protokole.'
    : 'Zaznaczone odpowiedzi trafią do tabeli montażowej. Pytania bez zaznaczenia zostają w tabeli bez zmian.';
  wstaw($('pytania'), [
    naProtokole.length && doZaznaczenia.length && el('h3', { class: 'sekcja' }, 'Z protokołu'),
    naProtokole.map(p => odczytZProtokolu(p, zProtokolu[p.id], niejasne.includes(p.id))),
    naProtokole.length && doZaznaczenia.length && el('h3', { class: 'sekcja' }, 'Tego nie ma na protokole'),
    doZaznaczenia.map(p => pytanieTabeli(p, odpowiedzi))
  ]);
  const okno = $('dialog-tabela');
  okno.returnValue = '';
  okno.showModal();
  okno.scrollTop = 0;
  return new Promise(ok => okno.addEventListener('close', () => ok(okno.returnValue === 'ok' ? { ...odpowiedzi, ...zProtokolu } : null), { once: true }));
}

// "Bartodzieje 21_PC.pdf" - tak jak dotychczasowe audyty w folderach projektów.
const nazwaPliku = rekord => bezpiecznaNazwa(`${rekord.adres}_${SKROT_PLIKU[rekord.typ]}`) + '.pdf';

$('zapisz-protokol').addEventListener('click', async () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor) return;
  if (otwarty.rekord.typ === 'wniosek') { await zapiszWniosek(otwarty); return; }
  if (otwarty.rekord.typ === 'pv_me') {
    const odpowiedzi = await zapytajOTabele(otwarty);
    if (odpowiedzi === null || stan.protokol !== otwarty) return;
    if (odpowiedzi) otwarty.rekord.tabela = { odpowiedzi, wpisano: false };
  }
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
      const tabela = rekord.tabela?.wpisano ? ', wpisano do tabeli' : '';
      toast(`Zapisano na Dysku: ${rekord.nazwaPliku}${zdjecia}${tabela}`, { typ: 'ok', akcja: nastepny, czas: 8000 });
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

// --- Materiałówka (wniosek materiałowy) ---
//
// Szef magazynu wybiera rodzaj instalacji (przełącznik u góry listy), adres
// i zestaw - PDF z folderu <inwestycja> / <…Materiałówki> / <PC|PV>.
// Ilości z wydruku zostają; poprawki (skreślenie, nowa liczba) i puste
// pozycje pisze rysikiem - odczytuje je Claude przy zatwierdzeniu albo
// wysyłce (src/odczyt-pisma.js). Zapis: PDF do folderu adresu obok zestawów,
// wiersze do arkusza „Materiałówka”, data zapisu i zatwierdzenia do tabeli
// montażowej. Zatwierdzenie kończy edycję; biuro odblokowuje, czyszcząc
// datę zakończenia w tabeli montażowej.

const zestawyTypu = typ => stan.inwestycja?.materialowki?.rodzaje?.[typ]?.zestawy || [];
const folderMaterialowek = () => (stan.inwestycja?.materialowki?.nazwa || 'Materiałówki').trim();
const bezPdf = nazwa => String(nazwa || '').replace(/\.pdf$/i, '').trim();
const nazwaPlikuWniosku = (adres, zestaw) => bezpiecznaNazwa(`${adres}_${bezPdf(zestaw) || 'materiałówka'}`) + '.pdf';
const dataDzisiaj = () => dataCzytelna(new Date().toISOString()).slice(0, 10);
const ROZMIAR_WPISU = 10;

// Zestaw zapamiętany z wersją: biuro może podmienić plik, a rozpoczęta
// materiałówka ma zostać na tym, na którym ją zaczęto.
async function wersjaWzoru(wzor) {
  const klucz = `${wzor.id}@${wzor.modifiedTime}`;
  if (await odczytaj('szablony', klucz)) return klucz;
  let szablon = await odczytaj('szablony', wzor.id);
  if (szablon?.modifiedTime !== wzor.modifiedTime) {
    if (!navigator.onLine) return szablon ? wzor.id : null;
    szablon = { nazwa: wzor.nazwa, modifiedTime: wzor.modifiedTime, bajty: await google.pobierzPlik(wzor) };
    await zapisz('szablony', wzor.id, szablon);
  }
  await zapisz('szablony', klucz, szablon);
  return klucz;
}

// Materiałówka tego adresu na Dysku - bez zakładania folderów.
async function znajdzWniosekNaDysku(a, typ) {
  const idTypu = stan.inwestycja.materialowki?.rodzaje?.[typ]?.folder;
  const idAdresu = idTypu && await google.znajdzFolder(idTypu, takaSama(bezpiecznaNazwa(a.adres)));
  if (!idAdresu) return null;
  const prefiks = normalizuj(bezpiecznaNazwa(a.adres));
  return (await google.plikiPdf(idAdresu)).find(p => normalizuj(p.name).startsWith(prefiks)) || null;
}

// Wersja z Dysku, gdy w tablecie jej nie ma albo na Dysku jest nowsza
// (poprawiana na innym urządzeniu). Niewysłane zmiany z tabletu mają pierwszeństwo.
async function wniosekZDysku(rekord, a, klucz, typ) {
  if (rekord && rekord.status !== 'wyslany') return null;
  let plik = rekord?.drive?.id ? await google.metadanePliku(rekord.drive.id) : null;
  plik ||= await znajdzWniosekNaDysku(a, typ);
  if (!plik || plik.modifiedTime === rekord?.drive?.modifiedTime) return null;
  const bajty = await google.pobierzPlik({ id: plik.id, mimeType: google.MIME.pdf });
  const dokument = await pdfjs.getDocument({ data: new Uint8Array(bajty) }).promise;
  let odczyt;
  try { odczyt = await stanZPdf(dokument); } finally { dokument.destroy(); }
  if (!odczyt) return null; // PDF wrzucony ręcznie, nie z aplikacji
  const s = odczyt.stan;
  const kluczWzoru = s.wzor?.klucz || `wniosek|${plik.id}`;
  if (!await odczytaj('szablony', kluczWzoru)) {
    await zapisz('szablony', kluczWzoru, { nazwa: s.wzor?.nazwa || 'Zestaw', modifiedTime: s.wzor?.modifiedTime || null, bajty: odczyt.wzor.slice().buffer });
  }
  const zDysku = {
    klucz,
    inwestycja: stan.inwestycja.id,
    adresId: a.id,
    adres: a.adres,
    typ: 'wniosek',
    instalacja: typ,
    wzor: kluczWzoru,
    zestaw: s.zestaw || s.wzor?.nazwa || null,
    dodatkowe: s.dodatkowe || [],
    wartosci: s.wartosci || {},
    kreski: s.kreski || null,
    pola: s.pola || null,
    rozmiaryStron: s.rozmiaryStron || null,
    odczyt: s.odczyt || null,
    wydaniePrzed: s.wydaniePrzed || null,
    utworzono: s.rozpoczeto,
    rozpoczeto: s.rozpoczeto,
    zmieniono: s.zmieniono,
    zatwierdzono: s.zatwierdzono || null,
    zatwierdzenieWTabeli: Boolean(s.zatwierdzono),
    status: 'wyslany',
    nazwaPliku: plik.name,
    drive: { id: plik.id, link: plik.webViewLink, folder: plik.parents?.[0], modifiedTime: plik.modifiedTime }
  };
  await zapiszRekord(zDysku);
  return zDysku;
}

// Biuro odblokowuje zatwierdzoną materiałówkę, czyszcząc datę zakończenia
// w wierszu adresu w tabeli montażowej. Tylko gdy ta data była tam wpisana
// przez aplikację - inaczej pusta komórka nic nie znaczy.
async function odblokowanyWArkuszu(rekord) {
  if (!rekord.zatwierdzenieWTabeli || !rekord.wiersze?.length) return false;
  const { tabela } = await odczytaj('inwestycje', rekord.inwestycja);
  if (tabela.mimeType !== google.MIME.arkusz) return false;
  try {
    for (const cel of rekord.wiersze) {
      const wiersze = await google.wartosciArkusza(tabela.id, cel.arkusz);
      const nr = znajdzWiersz(wiersze, cel);
      const daty = nr && datyZMontazowej(wiersze, nr);
      if (!daty || !daty.maKolumneZatwierdzenia || daty.zakonczono) return false;
    }
    return true;
  } catch { return false; }
}

// Wybór zestawu przy nowej materiałówce: podświetlony ten, którego numer
// (np. 9012) stoi w wierszu adresu w tabeli montażowej (np. „VPM9012”).
function pokazWyborZestawu(otwarty, a, typ) {
  const zestawy = zestawyTypu(typ);
  $('strony').replaceChildren();
  otwarty.klucz = `${otwarty.klucz}|wybor`; // wybór zestawu otwiera ten sam ekran od nowa
  if (!zestawy.length) {
    pokazUwage('komunikat', `Brak zestawów materiałówek dla: ${TYP[typ].etykieta}. Biuro wrzuca PDF-y zestawów do folderu „${folderMaterialowek()} / ${rodzajWniosku(typ)}” tej inwestycji.`);
    return;
  }
  const podpowiedz = podpowiedzZestawu(zestawy, wierszeMontazowe(a, typ).map(r => wierszeArkusza(r.arkusz)[r.wiersz - 1] || []));
  const kolejnosc = podpowiedz ? [podpowiedz, ...zestawy.filter(z => z !== podpowiedz)] : zestawy;
  const adresTrasy = z => `w/${encodeURIComponent(stan.inwestycja.id)}/${encodeURIComponent(a.id)}/${typ}/${encodeURIComponent(z.id)}`;
  $('strony').append(el('div', { class: 'wybor-zestawu' },
    el('h2', {}, 'Wybierz zestaw'),
    el('p', {}, podpowiedz ? 'Pierwszy zestaw pasuje do pompy wpisanej w tabeli montażowej.' : 'Zestaw zostaje przy materiałówce po pierwszym zapisie.'),
    ...kolejnosc.map(z => el('button', { type: 'button', class: `opcja${z === podpowiedz ? ' polecana' : ''}`, onclick: () => { location.replace(`#${adresTrasy(z)}`); } },
      el('span', { class: 'tresc' }, el('strong', {}, bezPdf(z.nazwa)), el('small', {}, z === podpowiedz ? 'Pasuje do tabeli montażowej' : 'Zestaw z Dysku')),
      ikona('dalej', 'dalej')))
  ));
}

async function ekranWniosek(idInwestycji, idAdresu, typ, idZestawu) {
  await zaladujInwestycje(idInwestycji);
  const a = stan.wynik.adresy.find(x => x.id === idAdresu);
  if (!a || !TYP[typ]) { location.hash = `i/${encodeURIComponent(idInwestycji)}`; return; }
  const klucz = kluczWniosku(stan.inwestycja.id, a.id, typ);
  if (stan.protokol?.klucz === klucz) return;
  zamknijProtokol();
  const [nazwaInwestycji] = rozbijNazwe(stan.inwestycja.nazwa);
  pokazEkran('ekran-protokol', { tytul: a.adres, podtytul: `Materiałówka ${rodzajWniosku(typ)} · ${nazwaInwestycji}` });
  document.body.classList.add('tryb-wniosek');
  pokazKontakt(a);
  $('strony').replaceChildren(el('div', { class: 'strona szkielet', style: 'aspect-ratio: 595 / 842' }));
  pokazUwage('komunikat', '');
  $('zapisz-protokol').disabled = true;
  $('zatwierdz-wniosek').disabled = true;

  const otwarty = { klucz, rekord: null };
  stan.protokol = otwarty;
  let rekord = await odczytaj('audyty', klucz);
  let uwaga = '';
  if (navigator.onLine) {
    try {
      rekord = await wniosekZDysku(rekord, a, klucz, typ) || rekord;
      if (rekord?.zatwierdzono && rekord.status === 'wyslany' && await odblokowanyWArkuszu(rekord)) {
        rekord.zatwierdzono = null;
        rekord.zatwierdzenieWTabeli = false;
        await zapiszRekord(rekord);
        uwaga = 'Biuro wyczyściło datę zakończenia w tabeli montażowej – materiałówkę znów można poprawiać.';
      }
    } catch (blad) {
      console.warn(blad);
      uwaga = `Nie udało się sprawdzić wersji na Dysku (${blad.message}). Pokazuję wersję z tabletu.`;
    }
  }
  if (stan.protokol !== otwarty) return;

  let kluczWzoru = rekord?.wzor;
  let szablon = kluczWzoru && await odczytaj('szablony', kluczWzoru);
  let zestaw = rekord?.zestaw || szablon?.nazwa || null;
  if (!szablon) {
    const zestawy = zestawyTypu(typ);
    const wybrany = zestawy.find(z => z.id === idZestawu) || (zestawy.length === 1 ? zestawy[0] : null);
    if (!wybrany) { pokazWyborZestawu(otwarty, a, typ); return; }
    zestaw = wybrany.nazwa;
    kluczWzoru = await wersjaWzoru(wybrany);
    szablon = kluczWzoru && await odczytaj('szablony', kluczWzoru);
  }
  if (stan.protokol !== otwarty) return;
  if (!szablon) {
    $('strony').replaceChildren();
    pokazUwage('komunikat', 'Zestawu nie ma w pamięci tabletu, a nie ma internetu.');
    return;
  }
  pokazEkran('ekran-protokol', { tytul: a.adres, podtytul: `Materiałówka ${rodzajWniosku(typ)} · ${bezPdf(zestaw)} · ${nazwaInwestycji}` });
  document.body.classList.add('tryb-wniosek');

  rekord ||= {
    klucz,
    inwestycja: stan.inwestycja.id,
    adresId: a.id,
    adres: a.adres,
    typ: 'wniosek',
    instalacja: typ,
    wartosci: null,
    kreski: null,
    status: null,
    utworzono: new Date().toISOString()
  };
  rekord.wzor = kluczWzoru;
  rekord.zestaw = zestaw;
  // Wiersze adresu w tabeli montażowej - tam idą daty zapisu i zatwierdzenia.
  rekord.wiersze = wierszeMontazowe(a, typ);
  otwarty.rekord = rekord;
  otwarty.szablon = szablon;
  otwarty.dokument = await pdfjs.getDocument({ data: new Uint8Array(szablon.bajty.slice(0)) }).promise;
  otwarty.strony = await tekstSzablonu(otwarty.dokument);
  otwarty.pola = polaZestawu(otwarty.strony);
  rekord.wartosci ||= wartosciPoczatkowe(otwarty.pola, { adres: a.adres, data: dataDzisiaj() });
  // Ekipa z kolumny „Ekipa” tabeli montażowej, gdy jeszcze nie wpisana.
  const ekipa = rekord.wiersze.map(r => ekipaZMontazowej(wierszeArkusza(r.arkusz), r.wiersz)).find(Boolean);
  for (const p of otwarty.pola.filter(p => p.id === 'ekipa')) {
    if (ekipa && !rekord.zatwierdzono && !String(rekord.wartosci[p.id] ?? '').trim()) rekord.wartosci[p.id] = ekipa;
  }
  ustawKlawiature(Boolean(await odczytaj('ustawienia', 'klawiaturaIlosci')));
  if (stan.protokol !== otwarty) return;
  otwarty.edytor = await utworzEdytor($('strony'), {
    dokument: otwarty.dokument,
    wpisy: [],
    kreski: rekord.kreski,
    onZmiana: kreski => zapiszSzkic(otwarty, kreski)
  });
  if (stan.protokol !== otwarty) return;
  polaNaStronach(otwarty);
  ustawPrzyciski();
  $('zapisz-protokol').disabled = false;
  $('zatwierdz-wniosek').disabled = false;
  $('akcje-wniosku').hidden = false;
  pokazDopisane(otwarty);
  ustawBlokade(otwarty);
  if (!otwarty.pola.some(p => p.rodzaj === 'ilosc')) uwaga ||= 'W tym PDF nie rozpoznałem tabeli pozycji (wiersza z „Nazwa”) – ilości nie trafią do Materiałówki.';
  if (!rekord.zatwierdzono && uwaga) pokazUwage('komunikat', uwaga, { neutralna: true });
}

// Pola "____" jako pola tekstowe na stronach. Pozycje w punktach PDF
// przeliczone na procenty strony - zgadzają się przy każdym rozmiarze ekranu.
function polaNaStronach(otwarty) {
  const strony = otwarty.edytor.strony;
  const wejscia = [];
  for (const p of otwarty.pola) {
    const s = strony[p.strona];
    if (!s) continue;
    const proc = (v, z) => `${(v / z * 100).toFixed(3)}%`;
    // Ilość pisze się rysikiem - tylko lekkie podświetlenie miejsca.
    if (p.rodzaj === 'ilosc') {
      const h = p.h || 19;
      const polozenie = `left:${proc(p.x, s.szer)};width:${proc(p.w, s.szer)};top:${proc(s.wys - p.y - 5 - h / 2, s.wys)};height:${proc(h, s.wys)}`;
      s.div.append(el('div', { class: 'miejsce-ilosci', style: polozenie }));
      // Tryb „Ilości z klawiatury”: pole na komórce, podpowiedź = obecna ilość.
      const wejscie = el('input', {
        class: 'ilosc-klawiatura', type: 'text', inputmode: 'decimal', enterkeyhint: 'next', autocomplete: 'off',
        'aria-label': `Ilość: ${p.etykieta}`, title: p.etykieta,
        style: `${polozenie};font-size:${(Math.min(8, h - 1.5) / s.szer * 100).toFixed(3)}cqw`,
        oninput: e => {
          otwarty.rekord.wartosci[p.id] = e.target.value;
          e.target.classList.toggle('wpisana', Boolean(e.target.value.trim()));
          zapiszSzkic(otwarty, otwarty.edytor.kreski);
        },
        onkeydown: e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const nastepne = otwarty.ilosciKlawiatura[otwarty.ilosciKlawiatura.indexOf(e.target) + 1];
          if (nastepne) nastepne.focus(); else e.target.blur();
        }
      });
      wejscie.value = recznaIlosc(p, otwarty.rekord.wartosci);
      wejscie.placeholder = iloscKoncowa(p, otwarty.rekord.odczyt);
      wejscie.classList.toggle('wpisana', Boolean(wejscie.value));
      s.div.append(wejscie);
      (otwarty.ilosciKlawiatura ||= []).push(wejscie);
      continue;
    }
    const wejscie = el('input', {
      class: 'pole-wniosku',
      type: 'text',
      inputmode: 'text',
      enterkeyhint: 'next',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': p.kolumna || p.etykieta,
      title: p.kolumna || p.etykieta,
      style: `left:${proc(p.x, s.szer)};width:${proc(p.w, s.szer)};top:${proc(s.wys - p.y - 12.5, s.wys)};height:${proc(16, s.wys)};font-size:${(ROZMIAR_WPISU / s.szer * 100).toFixed(3)}cqw`,
      oninput: e => {
        otwarty.rekord.wartosci[p.id] = e.target.value;
        zapiszSzkic(otwarty, otwarty.edytor.kreski);
      },
      // Enter przechodzi do następnej pozycji - szybkie wpisywanie listy.
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const nastepne = wejscia[wejscia.indexOf(e.target) + 1];
        if (nastepne) nastepne.focus(); else e.target.blur();
      }
    });
    wejscie.value = otwarty.rekord.wartosci[p.id] ?? '';
    s.div.append(wejscie);
    wejscia.push(wejscie);
  }
  otwarty.wejscia = wejscia;
}

function ustawBlokade(otwarty) {
  const zablokowany = Boolean(otwarty.rekord.zatwierdzono);
  otwarty.edytor.ustawTylkoOdczyt(zablokowany);
  for (const w of [...(otwarty.wejscia || []), ...(otwarty.ilosciKlawiatura || [])]) w.readOnly = zablokowany;
  document.body.classList.toggle('wniosek-zablokowany', zablokowany);
  $('zapisz-protokol').hidden = zablokowany;
  $('zatwierdz-wniosek').hidden = zablokowany;
  $('usun-wniosek').hidden = zablokowany;
  if (zablokowany) {
    pokazUwage('komunikat', `Materiałówka zatwierdzona ${dataCzytelna(otwarty.rekord.zatwierdzono)} – tylko do podglądu.`, { neutralna: true, znak: 'klodka' });
  }
}

const wartoscPola = (otwarty, p) => String(otwarty.rekord.wartosci[p.id] ?? '').trim();

function tekstyWniosku(otwarty, zatwierdzono) {
  // Ilości pisane rysikiem są w PDF pismem; wpisane z klawiatury - tekstem
  // w prawej części komórki (wydrukowana liczba przekreślona, kreskiWniosku).
  const teksty = otwarty.pola.filter(p => p.rodzaj !== 'ilosc' && wartoscPola(otwarty, p)).map(p => ({
    strona: p.strona, x: p.x + 2, y: p.y + 2, tekst: wartoscPola(otwarty, p), rozmiar: ROZMIAR_WPISU, maxSzer: Math.max(p.w - 4, 12)
  }));
  for (const p of otwarty.pola.filter(p => p.rodzaj === 'ilosc' && recznaIlosc(p, otwarty.rekord.wartosci))) {
    teksty.push({ strona: p.strona, x: p.x + p.w * 0.62, y: p.y + 2, tekst: recznaIlosc(p, otwarty.rekord.wartosci), rozmiar: 8, maxSzer: p.w * 0.36 });
  }
  // Pieczątka w prawym górnym rogu pierwszej strony - widać ją w podglądzie Dysku.
  const pierwsza = otwarty.strony[0];
  if (zatwierdzono && pierwsza) {
    teksty.push({ strona: 0, x: pierwsza.szer - 200, y: pierwsza.wys - 24, tekst: `ZATWIERDZONO ${dataCzytelna(zatwierdzono)}`, rozmiar: 9, kolor: '#1b7f3b' });
  }
  return teksty;
}

// Przekreślenie wydrukowanej ilości tam, gdzie wpisano ją z klawiatury.
function kreskiWniosku(otwarty) {
  const kreski = (otwarty.edytor.kreski || []).map(k => [...(k || [])]);
  for (const p of otwarty.pola.filter(p => p.rodzaj === 'ilosc' && p.wydrukowano && recznaIlosc(p, otwarty.rekord.wartosci))) {
    const y = otwarty.strony[p.strona].wys - p.y - 5;
    while (kreski.length <= p.strona) kreski.push([]);
    kreski[p.strona].push({ kolor: '#c62828', rozmiar: 0.9, rysik: true, punkty: [[p.x + 4, y, 0.5], [p.x + p.w * 0.58, y, 0.5]] });
  }
  return kreski;
}

// Pozycje dopisane spoza zestawu - lista na przycisku i okno dopisywania.
function pokazDopisane(otwarty) {
  const ile = otwarty.rekord.dodatkowe?.length || 0;
  $('dopisz-pozycje').textContent = ile ? `+ Dopisane pozycje (${ile})` : '+ Dopisz pozycję';
  const zablokowany = Boolean(otwarty.rekord.zatwierdzono);
  $('lista-dopisanych').replaceChildren(...(otwarty.rekord.dodatkowe || []).map((d, i) => el('li', {},
    el('span', {}, d.nazwa), el('strong', {}, d.ilosc),
    !zablokowany && el('button', { type: 'button', onclick: () => {
      otwarty.rekord.dodatkowe.splice(i, 1);
      zapiszSzkic(otwarty, otwarty.edytor.kreski);
      pokazDopisane(otwarty);
    } }, 'Usuń'))));
}

$('dopisz-pozycje').addEventListener('click', () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor) return;
  pokazDopisane(otwarty);
  $('dopisz-nazwa').value = '';
  $('dopisz-ilosc').value = '';
  $('dialog-dopisane').showModal();
  $('dopisz-nazwa').focus();
});

function dodajDopisana() {
  const otwarty = stan.protokol;
  const nazwa = $('dopisz-nazwa').value.trim();
  const ilosc = $('dopisz-ilosc').value.trim();
  if (!otwarty?.edytor || !nazwa || !ilosc) { (nazwa ? $('dopisz-ilosc') : $('dopisz-nazwa')).focus(); return; }
  (otwarty.rekord.dodatkowe ||= []).push({ nazwa, ilosc });
  zapiszSzkic(otwarty, otwarty.edytor.kreski);
  pokazDopisane(otwarty);
  $('dopisz-nazwa').value = '';
  $('dopisz-ilosc').value = '';
  $('dopisz-nazwa').focus();
}
$('dopisz-dodaj').addEventListener('click', dodajDopisana);
$('dopisz-nazwa').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('dopisz-ilosc').focus(); } });
$('dopisz-ilosc').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); dodajDopisana(); } });

// Tryb klawiatury zapamiętany w tablecie - kto wpisuje z klawiatury, ma go od razu.
function ustawKlawiature(wlaczona) {
  document.body.classList.toggle('klawiatura-ilosci', wlaczona);
  $('klawiatura-ilosci').setAttribute('aria-pressed', String(wlaczona));
}
$('klawiatura-ilosci').addEventListener('click', () => {
  const wlaczona = !document.body.classList.contains('klawiatura-ilosci');
  ustawKlawiature(wlaczona);
  zapisz('ustawienia', 'klawiaturaIlosci', wlaczona).catch(() => {});
  if (wlaczona) toast('Kliknij ilość w kolumnie i wpisz ją z klawiatury. Puste pole = ilość z pisma albo wydruku.', { czas: 5000 });
});

// Usunięcie niezatwierdzonej materiałówki: PDF z Dysku do kosza, wiersze
// adresu z Materiałówki, data wydania z tabeli montażowej, rekord z tabletu.
$('usun-wniosek').addEventListener('click', async () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor || otwarty.rekord.zatwierdzono) return;
  const rekord = otwarty.rekord;
  const wyslana = Boolean(rekord.drive?.id || rekord.status === 'wyslany');
  if (wyslana && !navigator.onLine) { toast('Do usunięcia zapisanej materiałówki potrzebny jest internet.', { typ: 'blad', czas: 6000 }); return; }
  if (!confirm(wyslana
    ? `Usunąć materiałówkę ${rekord.adres}? PDF trafi do kosza na Dysku, pozycje adresu znikną z Materiałówki, a data wydania z tabeli montażowej.`
    : `Usunąć materiałówkę ${rekord.adres}? Pismo i wpisane ilości znikną z tabletu.`)) return;
  const trwa = toast('Usuwam materiałówkę…', { czas: 0 });
  try {
    const uwagi = navigator.onLine ? await usunWniosekZDysku(rekord) : [];
    clearTimeout(czasAutozapisu);
    await usun('audyty', rekord.klucz);
    stan.audyty.delete(rekord.klucz);
    trwa.remove();
    toast('Usunięto materiałówkę.', { typ: 'ok' });
    for (const u of uwagi) toast(u, { typ: 'blad', czas: 15000 });
    zamknijProtokol();
    history.back();
  } catch (blad) {
    console.error(blad);
    trwa.remove();
    toast(`Nie udało się usunąć materiałówki: ${blad.message}`, { typ: 'blad', czas: 10000 });
  }
});

async function usunWniosekZDysku(rekord) {
  const uwagi = [];
  const inw = await odczytaj('inwestycje', rekord.inwestycja);
  const a = stan.wynik?.adresy.find(x => x.id === rekord.adresId);
  const plik = (rekord.drive?.id && await google.metadanePliku(rekord.drive.id)) || (a && await znajdzWniosekNaDysku(a, rekord.instalacja));
  if (plik && !await google.doKosza(plik.id, `USUNIĘTA – ${plik.name}`)) {
    uwagi.push(`To konto nie może usuwać plików z Dysku – PDF ma teraz nazwę „USUNIĘTA – ${plik.name}”, biuro może go skasować.`);
  }
  const mat = inw.materialowki?.rodzaje?.[rekord.instalacja];
  if (mat?.tabela) {
    const id = mat.tabela.id;
    const arkusze = await google.arkuszeTabeli(id);
    const tytul = arkuszMaterialowki(arkusze.map(x => x.title), rodzajWniosku(rekord.instalacja));
    if (tytul) {
      const arkusz = arkusze.find(x => x.title === tytul);
      const { doUsuniecia } = zmianyMaterialowki({ arkusz: tytul, wiersze: await google.wartosciArkusza(id, tytul), nowe: [], adres: rekord.adres });
      const bloki = blokiDoUsuniecia(doUsuniecia);
      if (bloki.length) await google.zmianyTabeli(id, bloki.map(b => ({ deleteDimension: { range: { sheetId: arkusz.sheetId, dimension: 'ROWS', startIndex: b.start, endIndex: b.koniec } } })));
    }
  }
  // Data wydania w tabeli montażowej - błąd nie blokuje usunięcia.
  if (inw.tabela.mimeType === google.MIME.arkusz) {
    for (const cel of rekord.wiersze || []) {
      try {
        const wiersze = await google.wartosciArkusza(inw.tabela.id, cel.arkusz);
        const nr = znajdzWiersz(wiersze, cel);
        const poprzednia = rekord.wydaniePrzed?.[`${cel.arkusz}|${nr}`];
        const { dane, kolumna, wartosc } = nr ? wyczyscWydanie({ arkusz: cel.arkusz, wiersze, nrWiersza: nr, poprzednia }) : { dane: [], kolumna: -1 };
        if (dane.length) await google.zapiszKomorki(inw.tabela.id, dane);
        // Kopia tabeli w tablecie - status na liście adresów od razu bez materiałówki.
        const lokalne = wierszeArkusza(cel.arkusz)[cel.wiersz - 1];
        if (lokalne && kolumna >= 0) lokalne[kolumna] = wartosc;
      } catch (blad) {
        console.warn(blad);
        uwagi.push(`Nie wyczyściłem daty wydania w tabeli montażowej (${blad.status === 403 ? 'brak uprawnień do edycji' : blad.message}).`);
      }
    }
    if (stan.inwestycja?.id === inw.id) await zapisz('inwestycje', inw.id, stan.inwestycja);
  }
  return uwagi;
}

// Zmiana zestawu (także po zapisie, przed zatwierdzeniem): pismo i ilości
// z poprzedniego zestawu nie pasują do nowego - znikają; ekipa, adres, data
// i dopisane pozycje zostają. Plik na Dysku podmieniany przy następnym zapisie.
$('zmien-zestaw').addEventListener('click', async () => {
  const otwarty = stan.protokol;
  if (!otwarty?.edytor || otwarty.rekord.zatwierdzono) return;
  const rekord = otwarty.rekord;
  const coKolwiek = (otwarty.edytor.kreski || []).some(k => k?.length) || otwarty.pola.some(p => p.rodzaj === 'ilosc' && recznaIlosc(p, rekord.wartosci));
  if (coKolwiek && !confirm('Zmienić zestaw? Pismo i ilości wpisane na tym zestawie zostaną usunięte (ekipa, data i dopisane pozycje zostają).')) return;
  const naglowek = new Set(otwarty.pola.filter(p => p.rodzaj !== 'ilosc').map(p => p.id));
  Object.assign(rekord, {
    wzor: null, zestaw: null, kreski: null, odczyt: null, pola: null, rozmiaryStron: null,
    wartosci: Object.fromEntries(Object.entries(rekord.wartosci || {}).filter(([id]) => naglowek.has(id)))
  });
  await zapiszRekord(rekord);
  const cel = `#w/${encodeURIComponent(rekord.inwestycja)}/${encodeURIComponent(rekord.adresId)}/${rekord.instalacja}`;
  zamknijProtokol();
  // Zastępujemy wpis karty - „wstecz” (i Usuń) ma wrócić do listy adresów,
  // nie do karty poprzedniego zestawu.
  if (location.hash === cel) trasa(); else location.replace(cel);
});

// Pola i rozmiary stron zapisywane w rekordzie (i w PDF) - z nich odczyt
// pisma działa także po wczytaniu wniosku na innym urządzeniu.
const polaRekordu = otwarty => otwarty.pola.map(({ id, etykieta, material, lp, wydrukowano, sekcja, rodzaj, strona, x, y, w, h }) => ({ id, etykieta, material, lp, wydrukowano, sekcja, rodzaj, strona, x, y, w, h }));
const rozmiaryStron = otwarty => otwarty.strony.map(s => ({ szer: s.szer, wys: s.wys }));

// Odczyt pisma przed zapisem/zatwierdzeniem, z poprawianiem na miejscu: przy
// każdej ilości napisanej rysikiem wycinek pisma, odczyt w polu do zmiany
// i (gdy AI się waha) przyciski z drugim możliwym odczytem - bez wracania do
// kartki. Wartości pokazane i potwierdzone tu nie są już „do sprawdzenia”.
// Zapis pyta tylko, gdy coś jest niepewne; zatwierdzenie pyta zawsze.
async function sprawdzOdczyt(otwarty, { zatwierdz }) {
  const rekord = otwarty.rekord;
  const opis = $('dialog-zatwierdz-opis');
  const pozycje = otwarty.pola.filter(p => p.rodzaj === 'ilosc');
  opis.replaceChildren();
  const kopia = { ...rekord, pola: polaRekordu(otwarty), rozmiaryStron: rozmiaryStron(otwarty), kreski: otwarty.edytor.kreski };
  let odczyt = null;
  let uwaga = '';
  if (pozycje.length && navigator.onLine) {
    const trwa = toast('Odczytuję ilości…', { czas: 0 });
    try {
      odczyt = await odczytajPismo(kopia);
      rekord.odczyt = odczyt;
    } catch (blad) {
      console.warn(blad);
      uwaga = `Nie udało się teraz odczytać ilości (${blad.message}). Odczytają się przy wysyłce.`;
    } finally {
      trwa.remove();
    }
  } else if (pozycje.length) {
    uwaga = 'Brak internetu – ilości odczytają się przy wysyłce.';
  }
  if (stan.protokol !== otwarty) return false;
  const reczne = rekord.wartosci || {};
  const odczytane = odczyt ? pozycje.filter(p => p.id in odczyt.wartosci && !recznaIlosc(p, reczne)) : [];
  const czyNiepewne = p => odczyt.niepewne.includes(p.id);
  const niepewne = odczytane.filter(czyNiepewne);
  if (!zatwierdz && !niepewne.length) return true;

  const przypisane = przypiszKreski(kopia.pola, kopia.kreski, kopia.rozmiaryStron.map(s => s.wys));
  const wejscia = new Map();
  // Tylko pozycje, których odczytu AI nie jest pewne - pewne nie zajmują miejsca.
  const wiersze = await Promise.all(niepewne.map(async p => {
    const pole = kopia.pola.find(x => x.id === p.id);
    const obraz = await wycinekPola(pole, przypisane.get(p.id) || [], kopia.rozmiaryStron[pole.strona].wys).catch(() => null);
    const wejscie = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'popraw-ilosc', 'aria-label': `Ilość: ${p.etykieta}` });
    wejscie.value = odczyt.wartosci[p.id] ?? '';
    wejscia.set(p.id, wejscie);
    const propozycje = [...new Set([odczyt.wartosci[p.id], odczyt.alternatywy?.[p.id]].filter(Boolean))];
    return el('li', { class: 'niepewny' },
      el('span', { class: 'odczyt-nazwa' }, el('span', {}, p.etykieta), el('small', {}, p.wydrukowano ? `wydrukowano: ${p.wydrukowano}` : 'bez wydrukowanej ilości')),
      obraz && el('img', { class: 'odczyt-pismo', src: `data:image/png;base64,${obraz}`, alt: 'Napisane rysikiem' }),
      el('span', { class: 'odczyt-wybor' },
        propozycje.length > 1 && propozycje.map(v => el('button', { type: 'button', class: 'propozycja', onclick: () => { wejscie.value = v; } }, v)),
        wejscie));
  }));
  if (stan.protokol !== otwarty) return false;
  wstaw(opis, [
    uwaga && el('p', { class: 'uwaga-odczytu' }, uwaga),
    niepewne.length > 0 && el('p', {}, `Do sprawdzenia: ${niepewne.length}. Popraw tutaj, jeśli odczyt się nie zgadza – nie trzeba wracać do kartki.`),
    wiersze.length > 0 && el('ul', { class: 'odczyty' }, wiersze)
  ]);
  $('dialog-zatwierdz-tytul').textContent = zatwierdz ? 'Zatwierdzić materiałówkę?' : 'Sprawdź odczytane ilości';
  $('dialog-zatwierdz-info').hidden = !zatwierdz;
  $('dialog-zatwierdz-ok').textContent = zatwierdz ? 'Zatwierdź' : 'Zapisz';
  $('dialog-zatwierdz-ok').className = `btn ${zatwierdz ? 'btn-zatwierdz' : 'btn-zapisz'}`;
  const okno = $('dialog-zatwierdz');
  okno.returnValue = '';
  okno.showModal();
  const ok = await new Promise(r => okno.addEventListener('close', () => r(okno.returnValue === 'ok'), { once: true }));
  if (!ok) return false;
  // Pokazane wartości sprawdził człowiek - już nie „do sprawdzenia”.
  for (const [id, wejscie] of wejscia) {
    odczyt.wartosci[id] = wejscie.value.trim();
    odczyt.niepewne = odczyt.niepewne.filter(x => x !== id);
  }
  rekord.odczyt = odczyt || rekord.odczyt;
  return true;
}

async function zapiszWniosek(otwarty, { zatwierdz = false } = {}) {
  const rekord = otwarty.rekord;
  if (!otwarty.edytor || rekord.zatwierdzono) return;
  if (!await sprawdzOdczyt(otwarty, { zatwierdz }) || stan.protokol !== otwarty) return;
  document.activeElement?.blur?.();
  const przyciski = [$('zapisz-protokol'), $('zatwierdz-wniosek')];
  for (const p of przyciski) p.disabled = true;
  const trwa = toast(zatwierdz ? 'Zatwierdzam materiałówkę…' : 'Zapisuję materiałówkę…', { czas: 0 });
  const nastepny = { etykieta: 'Następny adres', onclick: () => history.back() };
  try {
    const teraz = new Date().toISOString();
    const zatwierdzono = zatwierdz ? teraz : null;
    const rozpoczeto = rekord.rozpoczeto || rekord.utworzono || teraz;
    const kreski = otwarty.edytor.kreski;
    const pola = polaRekordu(otwarty);
    const strony = rozmiaryStron(otwarty);
    const nazwa = nazwaPlikuWniosku(rekord.adres, rekord.zestaw);
    const stanDoEdycji = {
      typ: 'wniosek',
      instalacja: rekord.instalacja,
      adres: rekord.adres,
      zestaw: rekord.zestaw,
      dodatkowe: rekord.dodatkowe || [],
      wzor: { klucz: rekord.wzor, nazwa: otwarty.szablon.nazwa, modifiedTime: otwarty.szablon.modifiedTime || null },
      wartosci: rekord.wartosci,
      kreski,
      pola,
      rozmiaryStron: strony,
      odczyt: rekord.odczyt || null,
      wydaniePrzed: rekord.wydaniePrzed || null,
      rozpoczeto,
      zmieniono: teraz,
      zatwierdzono
    };
    const bajty = await zbudujPdf({
      szablon: otwarty.szablon.bajty.slice(0),
      czcionka: await (await fetch('vendor/DejaVuSansCondensed.ttf')).arrayBuffer(),
      fontkit: window.fontkit,
      teksty: tekstyWniosku(otwarty, zatwierdzono),
      kreski: kreskiWniosku(otwarty),
      dodatkoweStrony: rekord.dodatkowe?.length
        ? [{ tytul: `Pozycje dopisane spoza zestawu – ${rekord.adres}`, linie: rekord.dodatkowe.map((d, i) => `${i + 1}. ${d.nazwa} – ${d.ilosc}`) }]
        : [],
      tytul: nazwa.replace(/\.pdf$/, ''),
      zalaczniki: zalacznikiStanu(stanDoEdycji, otwarty.szablon.bajty)
    });
    Object.assign(rekord, {
      kreski, pola, rozmiaryStron: strony, rozpoczeto, zmieniono: teraz, zatwierdzono, nazwaPliku: nazwa,
      pdf: new Blob([bajty], { type: 'application/pdf' }),
      status: 'zapisany', zapisano: teraz, tabela: { wpisano: false }
    });
    clearTimeout(czasAutozapisu);
    await zapiszRekord(rekord);
    if (zatwierdzono && stan.protokol === otwarty) ustawBlokade(otwarty);

    if (!navigator.onLine) {
      trwa.remove();
      toast('Zapisano w tablecie. Wyślesz z listy adresów, gdy będzie internet.', { typ: 'ok', akcja: nastepny, czas: 8000 });
      return;
    }
    try {
      await wyslijRekord(rekord);
      trwa.remove();
      toast(`${zatwierdzono ? 'Zatwierdzono' : 'Zapisano'} na Dysku i w Materiałówce: ${nazwa}`, { typ: 'ok', akcja: nastepny, czas: 8000 });
      if (rekord.uwagaMontazowa) toast(`Daty nie wpisały się do tabeli montażowej: ${rekord.uwagaMontazowa}.`, { typ: 'blad', czas: 15000 });
    } catch (blad) {
      console.error(blad);
      trwa.remove();
      toast(`Zapisano w tablecie, ale wysyłka się nie udała (${blad.message}). Wyślesz z listy adresów.`, { typ: 'blad', akcja: nastepny, czas: 10000 });
    }
  } catch (blad) {
    console.error(blad);
    trwa.remove();
    toast(`Nie udało się zapisać materiałówki: ${blad.message}`, { typ: 'blad', czas: 10000 });
  } finally {
    for (const p of przyciski) p.disabled = false;
  }
}

$('zatwierdz-wniosek').addEventListener('click', () => {
  const otwarty = stan.protokol;
  if (otwarty?.rekord?.typ === 'wniosek') zapiszWniosek(otwarty, { zatwierdz: true });
});

// --- Odczyt ilości pisanych rysikiem ---

// Klucz do usługi odczytu (Claude) - wpisywany raz na tablecie.
async function kluczOdczytu({ pytaj = false } = {}) {
  const zapisany = await odczytaj('ustawienia', 'kluczOdczytu');
  if (zapisany && !pytaj) return zapisany;
  const okno = $('dialog-klucz');
  $('klucz-odczytu').value = zapisany || '';
  okno.returnValue = '';
  okno.showModal();
  await new Promise(ok => okno.addEventListener('close', ok, { once: true }));
  const klucz = $('klucz-odczytu').value.trim();
  if (okno.returnValue !== 'ok' || !klucz) throw new Error('brak klucza do odczytu pisma');
  await zapisz('ustawienia', 'kluczOdczytu', klucz);
  return klucz;
}

// Odczyt ilości z pisma w polach - powtarzany tylko, gdy pismo się zmieniło.
// Wynik w rekord.odczyt: { podpis, wartosci: { idPola: tekst }, niepewne: [idPola] }.
async function odczytajPismo(rekord) {
  const pola = rekord.pola || [];
  const wysokosci = (rekord.rozmiaryStron || []).map(s => s.wys);
  // Pola z ilością wpisaną z klawiatury nie idą do odczytu.
  const przypisane = new Map([...przypiszKreski(pola, rekord.kreski, wysokosci)].filter(([id]) => !String(rekord.wartosci?.[id] ?? '').trim()));
  const podpis = podpisPisma(przypisane);
  if (rekord.odczyt?.podpis === podpis) return rekord.odczyt;
  const zPismem = pola.filter(p => p.rodzaj === 'ilosc' && przypisane.has(p.id));
  const doOdczytu = await Promise.all(zPismem.map(async (p, i) => ({
    nr: i + 1, etykieta: p.etykieta || p.kolumna, jednostka: p.jednostka, wydrukowano: p.wydrukowano, obraz: await wycinekPola(p, przypisane.get(p.id), wysokosci[p.strona])
  })));
  let wyniki = new Map();
  if (doOdczytu.length) {
    for (let proba = 0; ; proba += 1) {
      const klucz = await kluczOdczytu({ pytaj: proba > 0 });
      try {
        wyniki = await odczytajIlosci({ klucz, pola: doOdczytu });
        break;
      } catch (blad) {
        if (proba === 0 && await zlyKlucz(blad)) continue; // zły klucz - zapytaj raz jeszcze
        throw new Error(`odczyt pisma: ${blad.message}`);
      }
    }
  }
  const wartosci = {};
  const niepewne = [];
  const alternatywy = {};
  zPismem.forEach((p, i) => {
    const w = wyniki.get(i + 1);
    wartosci[p.id] = w?.odczyt || '';
    if (w?.alternatywa && w.alternatywa !== w.odczyt) alternatywy[p.id] = w.alternatywa;
    if (!w?.odczyt || w.pewnosc !== 'wysoka') niepewne.push(p.id);
  });
  rekord.odczyt = { podpis, wartosci, niepewne, alternatywy };
  return rekord.odczyt;
}

// Arkusz „Materiałówka” (w folderze rodzaju albo folderze materiałówek;
// brak - zakładamy): wiersze adresu zastępują poprzednie. Potem daty
// w tabeli montażowej - ich błąd nie blokuje materiałówki.
async function wpiszWniosek(rekord) {
  const odczyt = await odczytajPismo(rekord);
  await zapiszRekord(rekord);
  const inw = await odczytaj('inwestycje', rekord.inwestycja);
  const rodzaj = rodzajWniosku(rekord.instalacja);
  const mat = inw.materialowki?.rodzaje?.[rekord.instalacja];
  if (!mat) throw new Error(`w folderze materiałówek nie ma folderu „${rodzaj}”`);
  try {
    if (!mat.tabela) {
      mat.tabela = { id: await google.utworzArkuszGoogle(mat.folder, 'Materiałówka'), nazwa: 'Materiałówka' };
      await zapisz('inwestycje', inw.id, inw);
      if (stan.inwestycja?.id === inw.id) stan.inwestycja.materialowki = inw.materialowki;
    }
    await zapiszMaterialowke(mat.tabela.id, rodzaj, {
      adres: rekord.adres,
      nowe: wierszeMaterialowki({ pola: rekord.pola || [], odczyt, reczne: rekord.wartosci, dodatkowe: rekord.dodatkowe, adres: rekord.adres, zestaw: bezPdf(rekord.zestaw), zapisano: rekord.zmieniono, zatwierdzono: rekord.zatwierdzono })
    });
  } catch (blad) {
    if (blad.status === 403) throw new Error('to konto nie może edytować arkusza „Materiałówka” – biuro musi dać uprawnienia „Edytujący”');
    throw blad;
  }
  rekord.uwagaMontazowa = await datyDoMontazowej(rekord);
}

async function zapiszMaterialowke(id, rodzaj, { adres, nowe }) {
  let arkusze = await google.arkuszeTabeli(id);
  let tytul = arkuszMaterialowki(arkusze.map(a => a.title), rodzaj);
  // Nowy arkusz Google ma pusty „Arkusz1” - zostaje zakładką rodzaju.
  if (!tytul || (arkusze.length === 1 && /^(sheet|arkusz)\s*1$/i.test(tytul))) {
    const domyslny = arkusze.length === 1 && /^(sheet|arkusz)\s*1$/i.test(arkusze[0].title);
    await google.zmianyTabeli(id, [domyslny
      ? { updateSheetProperties: { properties: { sheetId: arkusze[0].sheetId, title: rodzaj }, fields: 'title' } }
      : { addSheet: { properties: { title: rodzaj } } }]);
    arkusze = await google.arkuszeTabeli(id);
    tytul = rodzaj;
  }
  const arkusz = arkusze.find(a => a.title === tytul);
  const wiersze = await google.wartosciArkusza(id, tytul);
  const z = zmianyMaterialowki({ arkusz: tytul, wiersze, nowe, adres });
  const siatka = [];
  const { rowCount, columnCount } = arkusz.gridProperties;
  if (z.szerokosc > columnCount) siatka.push({ appendDimension: { sheetId: arkusz.sheetId, dimension: 'COLUMNS', length: z.szerokosc - columnCount } });
  const wierszy = z.dopisz.wiersz + z.dopisz.wartosci.length;
  if (wierszy > rowCount) siatka.push({ appendDimension: { sheetId: arkusz.sheetId, dimension: 'ROWS', length: wierszy - rowCount + 500 } });
  if (siatka.length) await google.zmianyTabeli(id, siatka);
  const dane = [...z.dane];
  if (z.dopisz.wartosci.length) dane.push({ range: zakres(tytul, 0, z.dopisz.wiersz), values: z.dopisz.wartosci });
  if (dane.length) await google.zapiszKomorki(id, dane);
  // Stare wiersze adresu usuwane po dopisaniu nowych - przerwany zapis nie gubi danych.
  const bloki = blokiDoUsuniecia(z.doUsuniecia);
  if (bloki.length) await google.zmianyTabeli(id, bloki.map(b => ({ deleteDimension: { range: { sheetId: arkusz.sheetId, dimension: 'ROWS', startIndex: b.start, endIndex: b.koniec } } })));
}

// Data zapisu (kolumna „…wydania…”) i zatwierdzenia („…zakończenia…”) w wierszu
// adresu w tabeli montażowej. Zwraca opis problemu albo null.
async function datyDoMontazowej(rekord) {
  const { tabela } = await odczytaj('inwestycje', rekord.inwestycja);
  rekord.zatwierdzenieWTabeli = false;
  if (tabela.mimeType !== google.MIME.arkusz) return TYLKO_ARKUSZ_GOOGLE;
  const problemy = [];
  let zatwierdzenieWpisane = Boolean(rekord.zatwierdzono && rekord.wiersze?.length);
  for (const cel of rekord.wiersze || []) {
    try {
      const wiersze = await google.wartosciArkusza(tabela.id, cel.arkusz);
      const nrWiersza = znajdzWiersz(wiersze, cel);
      if (!nrWiersza) { problemy.push(`nie ma wiersza „${cel.adres}” w arkuszu ${cel.arkusz}`); zatwierdzenieWpisane = false; continue; }
      const { dane, brak, poprzednia } = datyWMontazowej({ arkusz: cel.arkusz, wiersze, nrWiersza, zapisano: rekord.zmieniono, zatwierdzono: rekord.zatwierdzono });
      // Wartość sprzed pierwszego zapisu - Usuń ją przywróci (np. planowaną datę biura).
      rekord.wydaniePrzed ||= {};
      const kluczKomorki = `${cel.arkusz}|${nrWiersza}`;
      if (poprzednia !== undefined && !(kluczKomorki in rekord.wydaniePrzed)) rekord.wydaniePrzed[kluczKomorki] = poprzednia;
      problemy.push(...brak);
      if (brak.some(b => /zakończenia/.test(b))) zatwierdzenieWpisane = false;
      if (dane.length) await google.zapiszKomorki(tabela.id, dane, 'USER_ENTERED');
    } catch (blad) {
      console.warn(blad);
      zatwierdzenieWpisane = false;
      if (/chronion|protected/i.test(blad.message)) problemy.push(`kolumny dat w arkuszu ${cel.arkusz} są chronione – właściciel tabeli musi dać temu kontu prawo ich edycji`);
      else if (blad.status === 403) problemy.push('to konto nie może edytować tabeli montażowej – biuro musi dać uprawnienia „Edytujący”');
      else problemy.push(blad.message);
    }
  }
  rekord.zatwierdzenieWTabeli = zatwierdzenieWpisane;
  return problemy.length ? [...new Set(problemy)].join('; ') : null;
}

// --- Start ---

function pokazSiec() {
  $('siec').hidden = navigator.onLine;
  if (stan.inwestycja && !$('ekran-adresy').hidden) pokazKolejke();
}
window.addEventListener('online', pokazSiec);
window.addEventListener('offline', pokazSiec);

async function start() {
  if (MATERIALOWKI) {
    document.querySelector('#ekran-start h1').textContent = 'Materiałówki';
    document.querySelector('#ekran-start .powitanie > p').textContent = 'Wybierz inwestycję, rodzaj instalacji i adres, wpisz wydane ilości – materiałówka trafi na Dysk i do arkusza „Materiałówka”.';
    document.querySelector('#ekran-start .logo').src = 'icons/materialowki.svg';
  }
  wstawIkony();
  pokazSiec();
  try {
    stan.inwestycje = await odczytaj('ustawienia', 'inwestycje') || [];
    stan.ostatnie = await odczytaj('ustawienia', 'ostatnie') || [];
    for (const r of await wszystkie('audyty')) if (r.inwestycja) stan.audyty.set(r.klucz, { status: r.status, inwestycja: r.inwestycja, typ: r.typ, zatwierdzono: r.zatwierdzono || null });
    await poAktualizacji();
  } catch (blad) {
    console.warn('Nie odczytano danych z pamięci tabletu', blad);
  }
  historiaRodzicow();
  trasa();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(WERSJA_APLIKACJI)}`).catch(blad => console.warn('Service worker', blad));
}

// Nowa wersja aplikacji (z internetem): wylogowanie i start od listy
// inwestycji - po zalogowaniu lista i każda otwierana inwestycja pobierają
// się od nowa. Niewysłane protokoły i materiałówki zostają w tablecie.
async function poAktualizacji() {
  const poprzednia = await odczytaj('ustawienia', 'wersja');
  if (poprzednia === WERSJA_APLIKACJI || !navigator.onLine) return;
  await zapisz('ustawienia', 'wersja', WERSJA_APLIKACJI);
  if (!poprzednia && !stan.inwestycje.length) return; // pierwsze uruchomienie na tym tablecie
  google.wyloguj();
  stan.poAktualizacji = true;
  history.replaceState({ n: 0 }, '', location.pathname + location.search);
}

// Aplikacja otwarta długo (tablet tylko usypiany): po powrocie sprawdzamy,
// czy na serwerze nie ma nowej wersji. W trakcie wypełniania nie przeładowujemy -
// dopiero po powrocie do listy.
async function sprawdzAktualizacje() {
  if (document.hidden || !navigator.onLine) return;
  try {
    const tekst = await (await fetch(`config.js?t=${Date.now()}`, { cache: 'no-store' })).text();
    const nowa = /WERSJA_APLIKACJI = '([^']+)'/.exec(tekst)?.[1];
    if (!nowa || nowa === WERSJA_APLIKACJI) return;
    if (stan.protokol) {
      if (!stan.czekaAktualizacja) toast('Jest nowa wersja aplikacji – zapisz i wróć do listy, wtedy się zaktualizuje.', { czas: 10000 });
      stan.czekaAktualizacja = true;
      return;
    }
    location.reload();
  } catch { /* bez sieci - sprawdzimy następnym razem */ }
}
document.addEventListener('visibilitychange', sprawdzAktualizacje);

start();
