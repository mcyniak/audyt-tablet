// Dopasowanie wzoru protokołu do typu instalacji po NAZWIE pliku w folderze
// "Wzory audytów" inwestycji, np. "PC powietrzne.pdf", "Forma do Audytów PC
// Gruntowe.pdf", "KOLEKTORY SŁONECZNE-DO AUDYTÓW-PROTOKÓŁ...pdf", "PV.pdf".
import { normalizuj } from './tabela.js';

export function rozpoznajWzor(nazwaPliku) {
  const n = normalizuj(String(nazwaPliku).replace(/\.[^.]+$/, ''));
  let typ = null;
  if (/kotl|kociol|kotly/.test(n)) typ = 'kotly';
  else if (/kolektor|solar/.test(n)) typ = 'solary';
  else if (/\bpc\b|pomp|grunt|powietrz/.test(n)) typ = 'pompy';
  else if (/\bpv\b|fotowolt|\bme\b/.test(n)) typ = 'pv_me';
  const rodzaj = /grunt/.test(n) ? 'grunt' : /powietrz/.test(n) ? 'powietrze' : null;
  return { typ, rodzaj };
}

// Wzór dla typu instalacji; przy pompach najpierw ten zgodny z rodzajem pompy
// z tabeli (gruntowa/powietrzna), potem ogólny, na końcu jakikolwiek PC.
export function wybierzWzor(wzory, typ, rodzajPompy = null) {
  const pasujace = wzory.map(w => ({ ...w, ...rozpoznajWzor(w.nazwa) })).filter(w => w.typ === typ);
  if (typ !== 'pompy') return pasujace[0] || null;
  return pasujace.find(w => rodzajPompy && w.rodzaj === rodzajPompy)
    || pasujace.find(w => !w.rodzaj)
    || (pasujace.length === 1 ? pasujace[0] : null);
}
