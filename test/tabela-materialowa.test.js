// Tabela materiałowa (plik wspólny z aplikacją Listy materiałowe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KOLUMNY_POZYCJI, KOLUMNY_WNIOSKOW, ARKUSZ, ZRODLO, STATUS, FORMULA_RAZEM,
  zmianyPozycji, blokiDoUsuniecia, zmianyWniosku, statusyWnioskow, kluczWniosku,
  wartoscKomorki, kolumnaA1, tabelaMaterialowa, zapiszPozycje, zapiszWniosek
} from '../public/src/tabela-materialowa.js';

const komorki = dane => Object.fromEntries(dane.flatMap(d => {
  const [, a1] = d.range.split('!');
  const [, kol, w] = /^([A-Z]+)(\d+)$/.exec(a1);
  return d.values.flatMap((wiersz, i) => wiersz.map((v, j) => [`${kolumnaA1(kolumnaNr(kol) + j)}${Number(w) + i}`, v]));
}));
const kolumnaNr = kol => [...kol].reduce((s, z) => s * 26 + z.charCodeAt(0) - 64, 0) - 1;

test('wartości i kolumny', () => {
  assert.equal(wartoscKomorki('12'), 12);
  assert.equal(wartoscKomorki(' 2,5 '), 2.5);
  assert.equal(wartoscKomorki('2 x 5 m'), '2 x 5 m');
  assert.equal(wartoscKomorki(7), 7);
  assert.equal(kolumnaA1(0), 'A');
  assert.equal(kolumnaA1(26), 'AA');
  assert.equal(kluczWniosku('ul. Testowa 3 A, Testowo', 'PV'), kluczWniosku('Testowo, Testowa 3A', 'pv'));
});

test('pozycje: pusty arkusz dostaje nagłówek, nowe kolumny na końcu', () => {
  const z = zmianyPozycji({
    wiersze: [],
    nowe: [{ Adres: 'Testowa 1', Rodzaj: 'PV', 'Źródło': ZRODLO.wniosek, Pozycja: 'Falownik', 'Jedn.': 'szt.', 'Ilość': 1, Kierowca: 'Jan' }],
    czyStary: () => true
  });
  const k = komorki(z.naglowekDane);
  assert.deepEqual(KOLUMNY_POZYCJI.map((_, i) => k[`${kolumnaA1(i)}1`]), KOLUMNY_POZYCJI);
  assert.equal(k[`${kolumnaA1(KOLUMNY_POZYCJI.length)}1`], 'Kierowca');
  assert.equal(z.dopisz.wiersz, 2);
  assert.equal(z.dopisz.wartosci[0][0], 'Testowa 1');
  assert.equal(z.dopisz.wartosci[0][KOLUMNY_POZYCJI.indexOf('Ilość')], 1);
  assert.equal(z.dopisz.wartosci[0].at(-1), 'Jan');
  assert.deepEqual(z.doUsuniecia, []);
});

test('pozycje: stare wiersze tego zapisu do usunięcia, kolumny biura nietknięte', () => {
  const wiersze = [
    ['Adres', 'Rodzaj', 'Źródło', 'Pozycja', 'Ilość', 'Uwagi biura'],
    ['Testowa 1', 'PV', ZRODLO.wniosek, 'Falownik', 1, 'ok'],
    ['Testowa 1', 'PC', ZRODLO.wniosek, 'Bufor', 1],
    ['Testowa 1', 'PV', ZRODLO.lista, 'Falownik', 1],
    ['ul. Testowa 1', 'PV', ZRODLO.wniosek, 'Moduł', 10],
    ['Inna 2', 'PV', ZRODLO.wniosek, 'Moduł', 8]
  ];
  const z = zmianyPozycji({
    wiersze,
    nowe: [{ Adres: 'Testowa 1', Rodzaj: 'PV', 'Źródło': ZRODLO.wniosek, Pozycja: 'Falownik', 'Ilość': 2 }],
    czyStary: w => w['Źródło'] === ZRODLO.wniosek && kluczWniosku(w.Adres, w.Rodzaj) === kluczWniosku('Testowa 1', 'PV')
  });
  assert.deepEqual(z.doUsuniecia, [1, 4]);
  assert.equal(z.dopisz.wiersz, 7);
  // Brakujące kolumny wspólne dopisane za kolumną biura.
  const k = komorki(z.naglowekDane);
  assert.equal(k.G1, 'Sekcja');
  assert.equal(z.dopisz.wartosci[0][4], 2);
  assert.equal(z.dopisz.wartosci[0][5], '');
  assert.deepEqual(blokiDoUsuniecia([1, 4, 5, 2, 9]), [{ start: 9, koniec: 10 }, { start: 4, koniec: 6 }, { start: 1, koniec: 3 }]);
});

test('wnioski: wiersz po adresie i rodzaju, status i daty', () => {
  const wpis = { adres: 'Testowa 1', rodzaj: 'PV', rozpoczeto: '2026-11-20T08:05:00', zmieniono: '2026-11-21T09:30:00', zatwierdzono: null, link: 'https://example.com/p' };
  const pusty = zmianyWniosku({ wiersze: [], wpis });
  const k = komorki(pusty.dane);
  assert.deepEqual(KOLUMNY_WNIOSKOW.map((_, i) => k[`${kolumnaA1(i)}1`]), KOLUMNY_WNIOSKOW);
  assert.equal(k.A2, 'Testowa 1');
  assert.equal(k.C2, STATUS.wTrakcie);
  assert.equal(k.D2, '20.11.2026 08:05');
  assert.ok(pusty.dane[0].range.startsWith(`'${ARKUSZ.wnioski}'!`));

  const wiersze = [KOLUMNY_WNIOSKOW, ['Testowa 1', 'PC', STATUS.wTrakcie], ['ul. Testowa 1', 'PV', STATUS.wTrakcie]];
  const z = zmianyWniosku({ wiersze, wpis: { ...wpis, zatwierdzono: '2026-11-22T10:00:00' } });
  assert.equal(z.wiersz, 3);
  const k2 = komorki(z.dane);
  assert.equal(k2.C3, STATUS.zatwierdzony);
  assert.equal(k2.F3, '22.11.2026 10:00');

  const statusy = statusyWnioskow([...wiersze.slice(0, 2), ['Testowa 1', 'PV', STATUS.zatwierdzony, '', '', '22.11.2026 10:00']]);
  assert.equal(statusy.get(kluczWniosku('Testowa 1', 'PV')).zatwierdzony, true);
  assert.equal(statusy.get(kluczWniosku('Testowa 1', 'PC')).zatwierdzony, false);
});

// Podstawiony klient Google: arkusze w pamięci.
function sztucznyGoogle() {
  const g = {
    pliki: [], tabele: {}, zapytania: [],
    async arkuszeWFolderze(id) { return g.pliki.filter(p => p.rodzic === id); },
    async utworzArkuszGoogle(rodzic, name) {
      const id = `T${g.pliki.length + 1}`;
      g.pliki.push({ id, name, rodzic });
      g.tabele[id] = { arkusze: [{ sheetId: 0, title: 'Arkusz1', gridProperties: { rowCount: 1000, columnCount: 26 } }], wartosci: { Arkusz1: [] } };
      return id;
    },
    async arkuszeTabeli(id) { return g.tabele[id].arkusze.map(a => ({ ...a })); },
    async zmianyTabeli(id, requests) {
      g.zapytania.push(...requests);
      const t = g.tabele[id];
      return {
        replies: requests.map(r => {
          if (r.updateSheetProperties) {
            const a = t.arkusze.find(x => x.sheetId === r.updateSheetProperties.properties.sheetId);
            t.wartosci[r.updateSheetProperties.properties.title] = t.wartosci[a.title] || [];
            a.title = r.updateSheetProperties.properties.title;
          }
          if (r.addSheet) {
            const p = { sheetId: t.arkusze.length + 10, title: r.addSheet.properties.title, gridProperties: { ...r.addSheet.properties.gridProperties } };
            t.arkusze.push(p);
            t.wartosci[p.title] = [];
            return { addSheet: { properties: p } };
          }
          if (r.deleteDimension) {
            const { sheetId, startIndex, endIndex } = r.deleteDimension.range;
            const a = t.arkusze.find(x => x.sheetId === sheetId);
            t.wartosci[a.title].splice(startIndex, endIndex - startIndex);
          }
          return {};
        })
      };
    },
    async wartosciArkusza(id, nazwa) { return structuredClone(g.tabele[id].wartosci[nazwa] || []); },
    async zapiszKomorki(id, dane, opcja = 'RAW') {
      for (const d of dane) {
        const [ark, a1] = d.range.split('!');
        const nazwa = ark.replace(/^'|'$/g, '').replace(/''/g, "'");
        const [, kol, w] = /^([A-Z]+)(\d+)$/.exec(a1);
        const wiersze = g.tabele[id].wartosci[nazwa];
        d.values.forEach((wiersz, i) => wiersz.forEach((v, j) => {
          const r = Number(w) - 1 + i;
          while (wiersze.length <= r) wiersze.push([]);
          wiersze[r][kolumnaNr(kol) + j] = opcja === 'RAW' || !String(v).startsWith('=') ? v : `formuła:${v}`;
        }));
      }
    }
  };
  return g;
}

test('zapis przez Google: nowa tabela w folderze inwestycji, poprawka zastępuje pozycje', async () => {
  const g = sztucznyGoogle();
  assert.equal(await tabelaMaterialowa(g, 'INW', { utworz: false }), null);
  const id = await tabelaMaterialowa(g, 'INW');
  assert.equal(g.pliki[0].name, 'Tabela materiałowa');
  assert.equal(await tabelaMaterialowa(g, 'INW'), id);

  const wpis = (ilosc, extra = {}) => ({ Adres: 'Testowa 1', Rodzaj: 'PV', 'Źródło': ZRODLO.wniosek, Pozycja: 'Falownik', 'Jedn.': 'szt.', 'Ilość': ilosc, ...extra });
  const stary = w => w['Źródło'] === ZRODLO.wniosek && kluczWniosku(w.Adres, w.Rodzaj) === kluczWniosku('Testowa 1', 'PV');
  await zapiszPozycje(g, id, { nowe: [wpis(1), wpis(20, { Pozycja: 'Moduł' })], czyStary: stary });
  const t = g.tabele[id];
  assert.deepEqual(t.arkusze.map(a => a.title), [ARKUSZ.pozycje, ARKUSZ.wnioski, ARKUSZ.razem]);
  assert.equal(t.wartosci[ARKUSZ.razem][0][0], `formuła:${FORMULA_RAZEM}`);
  assert.equal(t.wartosci[ARKUSZ.pozycje].length, 3);

  // Inny adres i skan zostają, poprawiony wniosek zastępuje swoje pozycje.
  await zapiszPozycje(g, id, { nowe: [{ ...wpis(5), Adres: 'Inna 2' }], czyStary: () => false });
  await zapiszPozycje(g, id, { nowe: [wpis(2)], czyStary: stary });
  const pozycje = t.wartosci[ARKUSZ.pozycje];
  assert.deepEqual(pozycje.slice(1).map(w => [w[0], w[4], w[6]]), [['Inna 2', 'Falownik', 5], ['Testowa 1', 'Falownik', 2]]);

  await zapiszWniosek(g, id, { adres: 'Testowa 1', rodzaj: 'PV', rozpoczeto: '2026-11-20T08:05:00', zmieniono: '2026-11-20T08:05:00', zatwierdzono: null, link: '' });
  await zapiszWniosek(g, id, { adres: 'Testowa 1', rodzaj: 'PV', rozpoczeto: '2026-11-20T08:05:00', zmieniono: '2026-11-21T08:05:00', zatwierdzono: '2026-11-21T08:05:00', link: '' });
  assert.equal(t.wartosci[ARKUSZ.wnioski].length, 2);
  assert.equal(t.wartosci[ARKUSZ.wnioski][1][2], STATUS.zatwierdzony);
});
