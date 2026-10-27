// Kształt pociągnięcia rysika - wspólny dla podglądu na ekranie i dla PDF,
// żeby zapisany protokół wyglądał dokładnie tak, jak audytor go widział.
//
// Kreska: { kolor: '#1a3d8f', rozmiar: 1.6, rysik: true, punkty: [[x, y, nacisk], ...] }
// x, y w punktach PDF względem lewego GÓRNEGO rogu strony.
import { getStroke } from '../vendor/perfect-freehand.mjs';

export const KOLORY = {
  niebieski: '#1a3d8f',
  czarny: '#111111',
  czerwony: '#c62828'
};

export function obrysKreski(kreska) {
  return getStroke(kreska.punkty, {
    size: kreska.rozmiar,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.35,
    // Palec i mysz nie mają nacisku - wtedy grubość z prędkości ruchu.
    simulatePressure: !kreska.rysik,
    last: true
  });
}

// Obrys -> ścieżka SVG (gładka, krzywe kwadratowe przez środki odcinków).
export function sciezkaSvg(obrys) {
  if (obrys.length < 2) return '';
  const r = n => Math.round(n * 100) / 100;
  let d = `M ${r(obrys[0][0])} ${r(obrys[0][1])} Q`;
  for (let i = 0; i < obrys.length; i += 1) {
    const [x0, y0] = obrys[i];
    const [x1, y1] = obrys[(i + 1) % obrys.length];
    d += ` ${r(x0)} ${r(y0)} ${r((x0 + x1) / 2)} ${r((y0 + y1) / 2)}`;
  }
  return d + ' Z';
}

export function kolorRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
