// Edytor protokołu: strony szablonu (pdf.js) jedna pod drugą, nad każdą
// warstwa z pismem. Rysik pisze, palec przewija i powiększa (chyba że
// włączony tryb "pisz palcem" - dla tabletów bez rysika).
//
// Kreski trzymamy w punktach PDF względem lewego górnego rogu strony - nie
// zależą od rozmiaru ekranu ani obrotu tabletu.
import { obrysKreski, sciezkaSvg, KOLORY } from './atrament.js';

const CZCIONKA = 'AudytDejaVu';
const KOLOR_WPISOW = KOLORY.niebieski;
const PROMIEN_GUMKI = 6; // pt

let czcionkaGotowa = null;
function zaladujCzcionke() {
  if (!czcionkaGotowa) {
    const font = new FontFace(CZCIONKA, 'url(vendor/DejaVuSansCondensed.ttf)');
    czcionkaGotowa = font.load().then(f => document.fonts.add(f)).catch(() => {});
  }
  return czcionkaGotowa;
}

const sciezki = new WeakMap();
function sciezkaKreski(kreska) {
  if (!sciezki.has(kreska)) sciezki.set(kreska, new Path2D(sciezkaSvg(obrysKreski(kreska))));
  return sciezki.get(kreska);
}

function odlegloscOdOdcinka(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const dl2 = dx * dx + dy * dy;
  const t = dl2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dl2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function trafiaKreske(kreska, x, y) {
  const p = kreska.punkty;
  const prog = PROMIEN_GUMKI + kreska.rozmiar;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) < prog;
  for (let i = 1; i < p.length; i += 1) if (odlegloscOdOdcinka(x, y, p[i - 1], p[i]) < prog) return true;
  return false;
}

export async function utworzEdytor(kontener, { dokument, wpisy, kreski, onZmiana }) {
  await zaladujCzcionke();
  const stan = {
    narzedzie: 'pioro', // 'pioro' | 'gumka'
    kolor: KOLORY.niebieski,
    rozmiar: 1.6,
    trybPalca: false,
    wpisy,
    kreski: Array.from({ length: dokument.numPages }, (_, i) => kreski?.[i] ? [...kreski[i]] : []),
    historia: [],
    aktywnyRysik: false
  };
  const strony = [];

  kontener.replaceChildren();
  for (let n = 1; n <= dokument.numPages; n += 1) {
    const strona = await dokument.getPage(n);
    const widok = strona.getViewport({ scale: 1 });
    const div = document.createElement('div');
    div.className = 'strona';
    div.style.aspectRatio = `${widok.width} / ${widok.height}`;
    const tlo = document.createElement('canvas');
    const atrament = document.createElement('canvas');
    const zywa = document.createElement('canvas');
    tlo.className = 'tlo';
    atrament.className = 'atrament';
    zywa.className = 'zywa';
    div.append(tlo, atrament, zywa);
    kontener.append(div);
    strony.push({ indeks: n - 1, strona, szer: widok.width, wys: widok.height, div, tlo, atrament, zywa, skala: 1, renderZadanie: null });
  }

  // --- Rysowanie ---

  function rysujAtrament(s) {
    const ctx = s.atrament.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s.atrament.width, s.atrament.height);
    ctx.setTransform(s.skala, 0, 0, s.skala, 0, 0);
    ctx.fillStyle = KOLOR_WPISOW;
    for (const w of stan.wpisy.filter(w => w.strona === s.indeks)) {
      ctx.font = `${w.rozmiar}px ${CZCIONKA}`;
      let rozmiar = w.rozmiar;
      if (w.maxSzer) {
        const szer = ctx.measureText(w.tekst).width;
        if (szer > w.maxSzer) rozmiar = w.rozmiar * w.maxSzer / szer;
        ctx.font = `${rozmiar}px ${CZCIONKA}`;
      }
      ctx.fillText(w.tekst, w.x, s.wys - w.y);
    }
    for (const k of stan.kreski[s.indeks]) {
      ctx.fillStyle = k.kolor;
      ctx.fill(sciezkaKreski(k));
    }
  }

  function rysujZywa(s, kreska) {
    const ctx = s.zywa.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s.zywa.width, s.zywa.height);
    if (!kreska) return;
    ctx.setTransform(s.skala, 0, 0, s.skala, 0, 0);
    ctx.fillStyle = kreska.kolor;
    ctx.fill(new Path2D(sciezkaSvg(obrysKreski(kreska))));
  }

  async function renderujStrone(s) {
    // Rozdzielczość = szerokość na ekranie × gęstość pikseli (max 2 - więcej
    // to setki MB pamięci przy 6 stronach na tablecie).
    const piksele = Math.round(s.div.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    if (!piksele || piksele === s.tlo.width) return;
    s.skala = piksele / s.szer;
    const wysokosc = Math.round(s.wys * s.skala);
    s.renderZadanie?.cancel();
    const tymczasowe = document.createElement('canvas');
    tymczasowe.width = piksele;
    tymczasowe.height = wysokosc;
    s.renderZadanie = s.strona.render({ canvasContext: tymczasowe.getContext('2d'), viewport: s.strona.getViewport({ scale: s.skala }) });
    try {
      await s.renderZadanie.promise;
    } catch (blad) {
      if (blad?.name === 'RenderingCancelledException') return;
      throw blad;
    }
    // Podmiana dopiero po wyrenderowaniu - bez mrugania przy obrocie tabletu.
    for (const c of [s.tlo, s.atrament, s.zywa]) { c.width = piksele; c.height = wysokosc; }
    s.tlo.getContext('2d').drawImage(tymczasowe, 0, 0);
    rysujAtrament(s);
  }

  async function renderujWszystko() {
    for (const s of strony) await renderujStrone(s);
  }

  let opoznienie = null;
  const obserwator = new ResizeObserver(() => {
    clearTimeout(opoznienie);
    opoznienie = setTimeout(renderujWszystko, 200);
  });
  obserwator.observe(kontener);

  // --- Wejście: rysik / palec / mysz ---

  function zmiana() {
    onZmiana?.(stan.kreski.map(k => [...k]));
  }

  function punkt(s, e) {
    const r = s.zywa.getBoundingClientRect();
    return [
      (e.clientX - r.left) / r.width * s.szer,
      (e.clientY - r.top) / r.height * s.wys,
      e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5
    ];
  }

  function gumkaW(s, [x, y]) {
    const lista = stan.kreski[s.indeks];
    const usuniete = lista.filter(k => trafiaKreske(k, x, y));
    if (!usuniete.length) return;
    stan.kreski[s.indeks] = lista.filter(k => !usuniete.includes(k));
    stan.historia.push({ typ: 'usun', strona: s.indeks, kreski: usuniete });
    rysujAtrament(s);
    zmiana();
  }

  for (const s of strony) {
    let kreska = null;
    let gumka = false;
    const warstwa = s.zywa;

    warstwa.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !stan.trybPalca) return; // palec przewija
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      warstwa.setPointerCapture(e.pointerId);
      if (e.pointerType === 'pen') stan.aktywnyRysik = true;
      // Przycisk gumki na rysiku (lub koniec-gumka) działa jak gumka.
      gumka = stan.narzedzie === 'gumka' || e.button === 5 || (e.buttons & 32) === 32;
      if (gumka) { gumkaW(s, punkt(s, e)); return; }
      kreska = { kolor: stan.kolor, rozmiar: stan.rozmiar, rysik: e.pointerType === 'pen', punkty: [punkt(s, e)] };
      rysujZywa(s, kreska);
    });

    warstwa.addEventListener('pointermove', e => {
      if (!kreska && !gumka) return;
      const zdarzenia = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const z of (zdarzenia.length ? zdarzenia : [e])) {
        if (gumka) gumkaW(s, punkt(s, z));
        else kreska.punkty.push(punkt(s, z));
      }
      if (kreska) rysujZywa(s, kreska);
    });

    const koniec = () => {
      stan.aktywnyRysik = false;
      if (gumka) { gumka = false; return; }
      if (!kreska) return;
      stan.kreski[s.indeks].push(kreska);
      stan.historia.push({ typ: 'dodaj', strona: s.indeks, kreska });
      kreska = null;
      rysujZywa(s, null);
      rysujAtrament(s);
      zmiana();
    };
    warstwa.addEventListener('pointerup', koniec);
    warstwa.addEventListener('pointercancel', koniec);

    // Chrome na Androidzie przewija stronę także pociągnięciem rysika.
    // pointerdown przychodzi przed touchstart, więc tu już wiemy, że to
    // rysik - blokujemy przewijanie dla tego dotyku.
    warstwa.addEventListener('touchstart', e => {
      if (stan.aktywnyRysik || stan.trybPalca) e.preventDefault();
    }, { passive: false });
  }

  await renderujWszystko();

  return {
    ustawNarzedzie(narzedzie, kolor) {
      stan.narzedzie = narzedzie;
      if (kolor) stan.kolor = kolor;
    },
    ustawTrybPalca(wlaczony) {
      stan.trybPalca = wlaczony;
      kontener.classList.toggle('pisz-palcem', wlaczony);
    },
    ustawWpisy(wpisy) {
      stan.wpisy = wpisy;
      strony.forEach(rysujAtrament);
    },
    cofnij() {
      const op = stan.historia.pop();
      if (!op) return false;
      if (op.typ === 'dodaj') stan.kreski[op.strona] = stan.kreski[op.strona].filter(k => k !== op.kreska);
      else stan.kreski[op.strona].push(...op.kreski);
      rysujAtrament(strony[op.strona]);
      zmiana();
      return true;
    },
    get mozeCofnac() { return stan.historia.length > 0; },
    get kreski() { return stan.kreski.map(k => [...k]); },
    zniszcz() {
      obserwator.disconnect();
      clearTimeout(opoznienie);
      for (const s of strony) s.renderZadanie?.cancel();
      kontener.replaceChildren();
    }
  };
}
