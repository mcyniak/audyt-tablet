// Ilości we wniosku materiałowym pisane rysikiem: kreski z pola ilości są
// wycinane (sam atrament na białym tle, bez wzoru) i odczytywane przez Claude
// jednym zapytaniem na materiałówkę. Tani i szybki model, jak w aplikacji Listy
// materiałowe. Niepewne odczyty trafiają do tabeli z „Do sprawdzenia: tak”.
//
// Funkcje przypisania kresek do pól są czyste (testy w Node); wycinki i
// zapytanie działają w przeglądarce.

export const MODEL = 'claude-haiku-5-5';

// Kreska należy do pola ilości, gdy jej środek leży w kolumnie pola (z małym
// zapasem) i najbliżej linii tego pola. y pola: linia bazowa od DOŁU strony,
// kreski: y od GÓRY strony.
const ZAPAS_X = 8;
const MAX_ODLEGLOSC_Y = 14;

function ramka(kreska) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of kreska.punkty) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

// Środek pola (wysokość pisma ~ od linii bazowej w górę).
const srodekPolaY = (pole, wysStrony) => wysStrony - pole.y - 5;

/**
 * pola: pola zestawu z polaZestawu (strona, x, y, w, rodzaj), kreski: [[kreska] na stronę],
 * wysokosci: wysokość każdej strony w punktach.
 * @returns {Map<string, object[]>} id pola ilości -> jego kreski
 */
export function przypiszKreski(pola, kreski, wysokosci) {
  const wynik = new Map();
  const ilosci = pola.filter(p => p.rodzaj === 'ilosc');
  (kreski || []).forEach((kreskiStrony, s) => {
    const naStronie = ilosci.filter(p => p.strona === s);
    if (!naStronie.length) return;
    for (const k of kreskiStrony || []) {
      if (!k.punkty?.length) continue;
      const r = ramka(k);
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      let najlepsze = null;
      for (const p of naStronie) {
        if (cx < p.x - ZAPAS_X || cx > p.x + p.w + ZAPAS_X) continue;
        const d = Math.abs(cy - srodekPolaY(p, wysokosci[s]));
        if (d <= MAX_ODLEGLOSC_Y && (!najlepsze || d < najlepsze.d)) najlepsze = { p, d };
      }
      if (!najlepsze) continue;
      if (!wynik.has(najlepsze.p.id)) wynik.set(najlepsze.p.id, []);
      wynik.get(najlepsze.p.id).push(k);
    }
  });
  return wynik;
}

// Podpis pisma w polach - odczyt powtarzamy tylko, gdy pismo się zmieniło.
export function podpisPisma(przypisane) {
  return [...przypisane].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ks]) => `${id}:${ks.map(k => `${k.punkty.length}@${k.punkty[0].map(v => Math.round(v * 10)).join(',')}`).join(';')}`)
    .join('|');
}

// --- wycinki (przeglądarka) -------------------------------------------------------

const SKALA = 5; // pikseli na punkt PDF - cyfry wysokie na ~50-80 px

// Wycinek pola: obszar pola powiększony o kreski, które z niego wystają.
export async function wycinekPola(pole, kreskiPola, wysStrony) {
  const { obrysKreski, sciezkaSvg } = await import('./atrament.js');
  const sy = srodekPolaY(pole, wysStrony);
  let x0 = pole.x - 4, x1 = pole.x + pole.w + 4, y0 = sy - 12, y1 = sy + 10;
  for (const k of kreskiPola) {
    const r = ramka(k);
    x0 = Math.min(x0, r.x0 - 3); x1 = Math.max(x1, r.x1 + 3);
    y0 = Math.min(y0, r.y0 - 3); y1 = Math.max(y1, r.y1 + 3);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((x1 - x0) * SKALA);
  canvas.height = Math.ceil((y1 - y0) * SKALA);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(SKALA, 0, 0, SKALA, -x0 * SKALA, -y0 * SKALA);
  ctx.fillStyle = '#111111';
  for (const k of kreskiPola) ctx.fill(new Path2D(sciezkaSvg(obrysKreski(k))));
  return canvas.toDataURL('image/png').split(',')[1];
}

// --- odczyt przez Claude -------------------------------------------------------------

const SCHEMAT = {
  type: 'object',
  additionalProperties: false,
  required: ['pola'],
  properties: {
    pola: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nr', 'odczyt', 'pewnosc', 'alternatywa', 'uwagi'],
        properties: {
          nr: { type: 'integer' },
          odczyt: { type: 'string' },
          pewnosc: { type: 'string', enum: ['wysoka', 'srednia', 'niska'] },
          alternatywa: { type: 'string' },
          uwagi: { type: 'string' }
        }
      }
    }
  }
};

const INSTRUKCJA = `Odczytujesz ilości materiałów napisane odręcznie rysikiem na tablecie w materiałówce (lista materiałów do montażu pompy ciepła albo fotowoltaiki). Każdy obraz to jedno pole ilości: samo pismo na białym tle, bez wydruku. Przed obrazem jest numer pola, nazwa materiału i - gdy jest - ilość wydrukowana na liście. Nazwa pomaga ocenić, czy odczyt ma sens, ale zapisuj to, co napisano.

Gdy podano wydrukowaną ilość, pismo jest jej poprawką:
- samo skreślenie (kreska, zygzak, krzyżyk) bez nowej liczby = magazynier nie wydaje tej pozycji: odczyt "0",
- nowa liczba (obok albo na skreśleniu) = ta liczba; kreskę skreślenia pomiń,
- sam znak potwierdzenia (ptaszek, "ok") = wydrukowana ilość bez zmian: zwróć ją.

Zasady:
- Przepisz dokładnie to, co napisano: zwykle liczbę ("12", "2,5", "35"). Nie licz, nie zaokrąglaj, nie dopisuj jednostki. Przecinek dziesiętny zapisz jako przecinek.
- Gdy w polu jest coś innego niż liczba (np. "2x5", "-", słowo), przepisz to dosłownie.
- Gdy pismo jest przekreślone albo zamazane i nie da się ustalić wartości, zwróć pusty odczyt i pewnosc "niska" z opisem w uwagach.
- Pismo jest polskie: "1" bywa z długim daszkiem (podobna do "Λ" albo "/1"), "7" ma poprzeczkę, "4" bywa otwarta, "0" bywa niedomknięte.
- pewnosc: "wysoka", gdy znaki są jednoznaczne; "srednia" albo "niska", gdy możliwe jest inne odczytanie.
- alternatywa: drugie możliwe odczytanie, sama wartość (np. "7", gdy napisane "1" przypomina 7); pusty tekst, gdy innego odczytania nie ma.

Zwróć jeden wpis na każdy numer pola.`;

/**
 * pola: [{ nr, etykieta, jednostka, obraz (PNG base64) }]
 * @returns {Promise<Map<number, {odczyt, pewnosc, uwagi}>>}
 */
export async function odczytajIlosci({ klucz, pola }) {
  if (!pola.length) return new Map();
  const { default: Anthropic } = await import('../vendor/anthropic.mjs');
  // Klucz wpisuje biuro na tablecie i zostaje w jego pamięci - stąd dangerouslyAllowBrowser.
  const client = new Anthropic({ apiKey: klucz, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const content = pola.flatMap(p => [
    { type: 'text', text: `Pole ${p.nr}: ${p.etykieta}${p.jednostka ? ` [${p.jednostka}]` : ''}${p.wydrukowano ? ` – wydrukowano: ${p.wydrukowano}` : ' – bez wydrukowanej ilości'}` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: p.obraz } }
  ]);
  content.push({ type: 'text', text: 'Odczytaj ilości we wszystkich polach.' });
  const odp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAT } },
    system: INSTRUKCJA,
    messages: [{ role: 'user', content }]
  });
  if (odp.stop_reason === 'refusal') throw new Error('odczyt pisma odrzucony');
  if (odp.stop_reason === 'max_tokens') throw new Error('odpowiedź odczytu ucięta');
  const json = JSON.parse(odp.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  return new Map(json.pola.map(p => [p.nr, { odczyt: p.odczyt.trim(), pewnosc: p.pewnosc, alternatywa: String(p.alternatywa || '').trim(), uwagi: p.uwagi }]));
}

// Rozpoznanie błędów SDK dla komunikatów (klasy z tego samego modułu co klient).
export async function zlyKlucz(blad) {
  const { default: Anthropic } = await import('../vendor/anthropic.mjs');
  return blad instanceof Anthropic.AuthenticationError || blad instanceof Anthropic.PermissionDeniedError;
}
