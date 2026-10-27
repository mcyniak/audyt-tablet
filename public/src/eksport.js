// Budowa gotowego protokołu: oryginalny szablon + wpisane dane z tabeli +
// pismo audytora jako wektorowe ścieżki (ostre przy druku, dobre do OCR).
// Strony szablonu nie są rasteryzowane - zostają w oryginalnej jakości.
import { PDFDocument, rgb } from '../vendor/pdf-lib.esm.min.js';
import { obrysKreski, sciezkaSvg, kolorRgb, KOLORY } from './atrament.js';

// teksty: wynik wyliczWpisy (y od dołu strony),
// kreski: [[kreska, ...] na stronę] (y od góry strony),
// fontkit: window.fontkit w przeglądarce, moduł @pdf-lib/fontkit w testach.
export async function zbudujPdf({ szablon, czcionka, fontkit, teksty, kreski, tytul }) {
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
    strona.drawText(t.tekst, { x: x0 + t.x, y: y0 + t.y, size: rozmiar, font, color: rgb(r, g, b) });
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

  if (tytul) pdf.setTitle(tytul);
  pdf.setProducer('Audyt (tablet)');
  return pdf.save();
}
