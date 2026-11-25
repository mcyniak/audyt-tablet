// Budowa gotowego protokołu: oryginalny szablon + wpisane dane z tabeli +
// pismo audytora jako wektorowe ścieżki (ostre przy druku, dobre do OCR).
// Strony szablonu nie są rasteryzowane - zostają w oryginalnej jakości.
import { PDFDocument, rgb } from '../vendor/pdf-lib.esm.min.js';
import { obrysKreski, sciezkaSvg, kolorRgb, KOLORY } from './atrament.js';

// teksty: wynik wyliczWpisy (y od dołu strony),
// kreski: [[kreska, ...] na stronę] (y od góry strony),
// fontkit: window.fontkit w przeglądarce, moduł @pdf-lib/fontkit w testach,
// zalaczniki: [{ nazwa, bajty, mimeType, opis }] - pliki osadzone w PDF,
// dodatkoweStrony: [{ tytul, linie: [tekst] }] - strony dopisane na końcu (A4).
export async function zbudujPdf({ szablon, czcionka, fontkit, teksty, kreski, tytul, zalaczniki = [], dodatkoweStrony = [] }) {
  const pdf = await PDFDocument.load(szablon);
  pdf.registerFontkit(fontkit);
  // Własna czcionka, bo standardowe czcionki PDF nie mają "ą, ę, ł...".
  const font = await pdf.embedFont(czcionka, { subset: true });
  const strony = pdf.getPages();
  const [r, g, b] = kolorRgb(KOLORY.niebieski);

  for (const t of teksty) {
    const strona = strony[t.strona];
    if (!strona) continue;
    const { x: x0, y: y0 } = strona.getMediaBox();
    let rozmiar = t.rozmiar;
    if (t.maxSzer) rozmiar = Math.min(rozmiar, rozmiar * t.maxSzer / font.widthOfTextAtSize(t.tekst, rozmiar));
    const kolor = t.kolor ? kolorRgb(t.kolor) : [r, g, b];
    strona.drawText(t.tekst, { x: x0 + t.x, y: y0 + t.y, size: rozmiar, font, color: rgb(...kolor) });
  }

  kreski.forEach((kreskiStrony, i) => {
    const strona = strony[i];
    if (!strona || !kreskiStrony?.length) return;
    const { x: x0, y: y0, height } = strona.getMediaBox();
    for (const kreska of kreskiStrony) {
      const d = sciezkaSvg(obrysKreski(kreska));
      if (!d) continue;
      const [kr, kg, kb] = kolorRgb(kreska.kolor);
      // drawSvgPath: początek układu SVG w (x, y), oś Y w dół - tak jak nasze punkty.
      strona.drawSvgPath(d, { x: x0, y: y0 + height, color: rgb(kr, kg, kb), borderWidth: 0 });
    }
  });

  for (const d of dodatkoweStrony) {
    let strona = null;
    let y = 0;
    const nowa = () => {
      strona = pdf.addPage([595.28, 841.89]);
      strona.drawText(d.tytul, { x: 50, y: 790, size: 13, font, color: rgb(0, 0, 0) });
      y = 760;
    };
    nowa();
    for (const linia of d.linie) {
      if (y < 50) nowa();
      strona.drawText(linia, { x: 50, y, size: 10.5, font, color: rgb(r, g, b), maxWidth: 495 });
      y -= 18;
    }
  }

  for (const z of zalaczniki) {
    await pdf.attach(z.bajty, z.nazwa, { mimeType: z.mimeType, description: z.opis });
  }

  if (tytul) pdf.setTitle(tytul);
  pdf.setProducer('Audyt (tablet)');
  return pdf.save();
}
