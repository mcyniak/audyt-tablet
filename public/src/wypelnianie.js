// Automatyczne wpisanie danych z tabeli (imię i nazwisko, adres, telefon,
// e-mail, data) w szablon protokołu. Szukamy ETYKIET w tekście szablonu
// (pdf.js getTextContent), a nie sztywnych współrzędnych - ten sam kod
// działa dla wersji protokołu z różnych gmin (różnią się tylko nazwą
// gminy w nagłówku) i przeżyje drobne przesunięcia w Wordzie.
//
// Wejście:  strony = [{ szer, wys, elementy: [{ tekst, x, y, w, h }] }]
//           (x, y = początek linii bazowej w punktach PDF, y liczone od dołu)
// Wyjście:  [{ strona, x, y, tekst, rozmiar, maxSzer }] - y też od dołu.

const ROZMIAR = 10;
const KROPKI = /^[….]{2,}/;

// Przybliżone szerokości znaków Times New Roman (w em) - potrzebne, gdy
// etykieta i kropki są w JEDNYM kawałku tekstu ("DATA: ………… / ………… / 202…… r.")
// i trzeba policzyć, gdzie zaczynają się kropki.
function szerokoscZnaku(z) {
  if (z === '…') return 1;
  if ('.,:;\'| '.includes(z)) return 0.25;
  if (z === '/') return 0.28;
  if (/[0-9]/.test(z)) return 0.5;
  if (/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(z)) return 0.67;
  return 0.45;
}
const szerokoscTekstu = t => [...t].reduce((s, z) => s + szerokoscZnaku(z), 0);

// x początku podciągu [od, ...] wewnątrz elementu tekstu
function xWElemencie(el, od) {
  const calosc = szerokoscTekstu(el.tekst);
  return calosc ? el.x + el.w * (szerokoscTekstu(el.tekst.slice(0, od)) / calosc) : el.x;
}

function szerokoscPodciagu(el, od, doIndeksu) {
  const calosc = szerokoscTekstu(el.tekst);
  return calosc ? el.w * (szerokoscTekstu(el.tekst.slice(od, doIndeksu)) / calosc) : 0;
}

const tenSamWiersz = (a, b) => Math.abs(a.y - b.y) < 2;

function kropkiZaEtykieta(elementy, etykieta) {
  return elementy
    .filter(e => e !== etykieta && tenSamWiersz(e, etykieta) && e.x > etykieta.x && KROPKI.test(e.tekst))
    .sort((a, b) => a.x - b.x);
}

export function formatujDate(data) {
  const d = data instanceof Date ? data : new Date(data);
  return {
    dd: String(d.getDate()).padStart(2, '0'),
    mm: String(d.getMonth() + 1).padStart(2, '0'),
    rrrr: String(d.getFullYear())
  };
}

// Wpis na kropkach: tekst lekko nad linią bazową kropek, nie dłuższy niż one.
const wpis = (strona, x, y, tekst, maxSzer) => ({ strona, x: x + 2, y: y + 1.5, tekst, rozmiar: ROZMIAR, maxSzer: maxSzer ? Math.max(maxSzer - 4, 20) : undefined });

// Pola daty "…/…/202…" - dzień, miesiąc i reszta roku po wydrukowanym "202".
function wpisyDaty(strona, sloty, data) {
  const { dd, mm, rrrr } = formatujDate(data);
  const wartosci = [dd, mm, rrrr.startsWith('202') ? rrrr.slice(3) : rrrr];
  return sloty.slice(0, 3).map((s, i) => ({ strona, x: s.x + Math.max(0, (s.w - szerokoscTekstu(wartosci[i]) * ROZMIAR) / 2), y: s.y + 1.5, tekst: wartosci[i], rozmiar: ROZMIAR }));
}

// Daty zapisane w jednym kawałku tekstu: "w dniu ……/……/202…. r.", "DATA: ………… / ………… / 202…… r."
const DATA_W_TEKSCIE = /([….]{2,})\s*\/\s*([….]{2,})\s*\/\s*202([….]{1,})/;

export function wyliczWpisy(strony, dane) {
  const wpisy = [];
  strony.forEach((strona, s) => {
    const el = strona.elementy;
    for (const e of el) {
      const t = e.tekst.trim();

      // --- etykieta + osobny kawałek z kropkami w tym samym wierszu ---
      const pola = [
        [/^Imię i Nazwisko/i, dane.imie],
        [/^Adres miejsca instalacji/i, dane.adres],
        [/^Telefon:?$/i, dane.telefon],
        [/^E-?mail:?$/i, dane.email]
      ];
      for (const [wzorzec, wartosc] of pola) {
        if (!wzorzec.test(t) || !wartosc) continue;
        const [kropki] = kropkiZaEtykieta(el, e);
        if (kropki) wpisy.push(wpis(s, kropki.x, kropki.y, wartosc, kropki.w));
      }

      if (/^SPORZĄDZONY DNIA/i.test(t) && dane.data) {
        wpisy.push(...wpisyDaty(s, kropkiZaEtykieta(el, e), dane.data));
      }

      // --- "zlokalizowanego w" na końcu wiersza, adres w następnym wierszu ---
      if (/^zlokalizowanego/i.test(t) && dane.adres) {
        const nastepny = el
          .filter(x => x.y < e.y - 4 && x.y > e.y - 30 && KROPKI.test(x.tekst))
          .sort((a, b) => b.y - a.y || a.x - b.x)[0];
        if (nastepny) wpisy.push(wpis(s, nastepny.x, nastepny.y, dane.adres, nastepny.w));
      }

      // --- etykieta i kropki w jednym kawałku tekstu ---
      const panPani = /Pan\/Pani\s*([….]{3,})/.exec(e.tekst);
      if (panPani && dane.imie) {
        const od = panPani.index + panPani[0].length - panPani[1].length;
        wpisy.push(wpis(s, xWElemencie(e, od), e.y, dane.imie, szerokoscPodciagu(e, od, e.tekst.length)));
      }

      const dataWTekscie = DATA_W_TEKSCIE.exec(e.tekst);
      if (dataWTekscie && dane.data && /w dniu|DATA:/i.test(e.tekst)) {
        const sloty = [];
        let od = dataWTekscie.index;
        for (const grupa of dataWTekscie.slice(1)) {
          const i = e.tekst.indexOf(grupa, od);
          sloty.push({ x: xWElemencie(e, i), y: e.y, w: szerokoscPodciagu(e, i, i + grupa.length) });
          od = i + grupa.length;
        }
        wpisy.push(...wpisyDaty(s, sloty, dane.data));
      }
    }
  });
  return wpisy;
}

// Odczyt tekstu szablonu przez pdf.js do kształtu, którego używa wyliczWpisy.
export async function tekstSzablonu(dokument) {
  const strony = [];
  for (let n = 1; n <= dokument.numPages; n += 1) {
    const strona = await dokument.getPage(n);
    const [x0, y0, x1, y1] = strona.view;
    const tresc = await strona.getTextContent();
    strony.push({
      szer: x1 - x0,
      wys: y1 - y0,
      elementy: tresc.items
        .filter(i => i.str && i.str.trim())
        .map(i => ({ tekst: i.str, x: i.transform[4] - x0, y: i.transform[5] - y0, w: i.width, h: i.height }))
    });
  }
  return strony;
}
