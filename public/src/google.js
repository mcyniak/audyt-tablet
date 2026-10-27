// Google: logowanie, przeglądanie inwestycji na Dysku współdzielonym, odczyt
// tabeli montażowej (arkusz Google albo .xlsx), wzory protokołów, zapis
// protokołu do folderu adresu w wizjach lokalnych.
//
// Uprawnienie "drive": aplikacja musi sama przeglądać INWESTYCJE_3 i zapisywać
// w istniejących folderach adresów. To aplikacja wewnętrzna firmowego Google
// Workspace, więc Google nie wymaga dla niej weryfikacji.
import { GOOGLE } from '../config.js';

const ZAKRES = 'https://www.googleapis.com/auth/drive';
export const MIME = {
  folder: 'application/vnd.google-apps.folder',
  arkusz: 'application/vnd.google-apps.spreadsheet',
  dokument: 'application/vnd.google-apps.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf'
};

// --- Logowanie ---

let biblioteka = null;
function zaladujBiblioteke() {
  biblioteka ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { biblioteka = null; reject(new Error('Brak połączenia z Google')); };
    document.head.append(s);
  });
  return biblioteka;
}

const KLUCZ_TOKENU = 'audyt.token';
let token = (() => {
  try { return JSON.parse(sessionStorage.getItem(KLUCZ_TOKENU)); } catch { return null; }
})();

export const zalogowany = () => Boolean(token && token.wygasa > Date.now() + 60_000);

// Okno logowania Google. Po pierwszej zgodzie kolejne odnowienia (co godzinę)
// przechodzą bez pytania - okienko tylko mignie.
export async function zaloguj() {
  if (zalogowany()) return token.wartosc;
  await zaladujBiblioteke();
  return new Promise((resolve, reject) => {
    const klient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE.clientId,
      scope: ZAKRES,
      callback: odp => {
        if (odp.error) { reject(new Error(odp.error_description || odp.error)); return; }
        token = { wartosc: odp.access_token, wygasa: Date.now() + Number(odp.expires_in) * 1000 };
        try { sessionStorage.setItem(KLUCZ_TOKENU, JSON.stringify(token)); } catch { /* bez pamięci sesji też działa */ }
        resolve(token.wartosc);
      },
      error_callback: blad => reject(new Error(blad.type === 'popup_closed' ? 'Logowanie przerwane' : (blad.message || blad.type)))
    });
    klient.requestAccessToken({ prompt: token ? '' : undefined });
  });
}

async function api(url, opcje = {}, ponowienie = false) {
  const odp = await fetch(url, { ...opcje, headers: { Authorization: `Bearer ${await zaloguj()}`, ...opcje.headers } });
  // Token unieważniony wcześniej niż zapowiadał - jedna próba z nowym.
  if (odp.status === 401 && !ponowienie) { token = null; return api(url, opcje, true); }
  if (!odp.ok) {
    let opis = `${odp.status}`;
    try { opis = (await odp.json()).error?.message || opis; } catch { /* odpowiedź bez JSON */ }
    throw new Error(`Google: ${opis}`);
  }
  return odp;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const cudzyslow = tekst => String(tekst).replace(/['\\]/g, '\\$&');

// Lista plików (z dociąganiem kolejnych stron) - zawsze z Dyskami współdzielonymi.
async function lista(q, { driveId, pola = 'id,name,mimeType,modifiedTime,parents' } = {}) {
  const wynik = [];
  let strona = '';
  do {
    const p = new URLSearchParams({ q, fields: `nextPageToken,files(${pola})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    if (driveId) { p.set('corpora', 'drive'); p.set('driveId', driveId); } else p.set('corpora', 'allDrives');
    if (strona) p.set('pageToken', strona);
    const odp = await (await api(`${DRIVE}/files?${p}`)).json();
    wynik.push(...odp.files);
    strona = odp.nextPageToken || '';
  } while (strona);
  return wynik;
}

// --- Inwestycje ---

export async function idDysku(nazwa) {
  const odp = await (await api(`${DRIVE}/drives?${new URLSearchParams({ q: `name = '${cudzyslow(nazwa)}'`, pageSize: '10' })}`)).json();
  if (!odp.drives?.length) throw new Error(`Nie widzę dysku współdzielonego „${nazwa}”. Czy to konto ma do niego dostęp?`);
  return odp.drives[0].id;
}

// Inwestycja = folder na Dysku współdzielonym, w którym leży tabela montażowa.
// Dwa zapytania zamiast przeglądania 200 folderów po kolei.
export async function listaInwestycji(nazwaDysku) {
  const driveId = await idDysku(nazwaDysku);
  const [foldery, tabele] = await Promise.all([
    lista(`'${driveId}' in parents and mimeType = '${MIME.folder}' and trashed = false`, { driveId }),
    lista(`(name contains 'montaż' or name contains 'montaz' or name contains 'MONTAŻ') and (mimeType = '${MIME.arkusz}' or mimeType = '${MIME.xlsx}') and trashed = false`, { driveId })
  ]);
  return polaczInwestycje(foldery, tabele);
}

// Najnowsza tabela montażowa leżąca bezpośrednio w folderze inwestycji.
export function polaczInwestycje(foldery, tabele) {
  const poId = new Map(foldery.map(f => [f.id, f]));
  const wynik = new Map();
  for (const t of tabele) {
    const folder = (t.parents || []).map(id => poId.get(id)).find(Boolean);
    if (!folder) continue;
    const obecna = wynik.get(folder.id);
    if (!obecna || t.modifiedTime > obecna.tabela.modifiedTime) {
      wynik.set(folder.id, { id: folder.id, nazwa: folder.name, tabela: { id: t.id, nazwa: t.name, mimeType: t.mimeType, modifiedTime: t.modifiedTime } });
    }
  }
  return [...wynik.values()];
}

// Wzory protokołów z podfolderu inwestycji ("Wzory audytów").
export async function folderInwestycji(idFolderu, { wzory }) {
  const zawartosc = await lista(`'${idFolderu}' in parents and mimeType = '${MIME.folder}' and trashed = false`);
  const folderWzorow = zawartosc.find(f => wzory.test(f.name));
  const pliki = folderWzorow
    ? await lista(`'${folderWzorow.id}' in parents and (mimeType = '${MIME.pdf}' or mimeType = '${MIME.dokument}') and trashed = false`)
    : [];
  return {
    folderWzorow: folderWzorow ? { id: folderWzorow.id, nazwa: folderWzorow.name } : null,
    wzory: pliki.map(p => ({ id: p.id, nazwa: p.name, mimeType: p.mimeType, modifiedTime: p.modifiedTime }))
  };
}

// --- Tabela montażowa ---

// Arkusz Google przez Sheets API (surowe wartości - telefon 500100200 nie
// zamieni się w "500,100,200"), plik .xlsx pobierany i czytany jak z dysku.
export async function odczytajTabele(tabela, czytajXlsx) {
  if (tabela.mimeType === MIME.xlsx) return czytajXlsx(await pobierzPlik(tabela));
  const meta = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${tabela.id}?fields=sheets.properties.title`)).json();
  const nazwy = meta.sheets.map(s => s.properties.title);
  const p = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', majorDimension: 'ROWS' });
  for (const n of nazwy) p.append('ranges', `'${n.replace(/'/g, "''")}'`);
  const wartosci = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${tabela.id}/values:batchGet?${p}`)).json();
  return zArkuszyGoogle(nazwy, wartosci.valueRanges);
}

export function zArkuszyGoogle(nazwy, zakresy) {
  return nazwy.map((nazwa, i) => ({ nazwa, wiersze: zakresy[i]?.values || [] }));
}

// PDF/xlsx - zawartość pliku; dokument Google - eksport do PDF.
export async function pobierzPlik(plik) {
  const url = plik.mimeType === MIME.dokument
    ? `${DRIVE}/files/${plik.id}/export?mimeType=${encodeURIComponent(MIME.pdf)}`
    : `${DRIVE}/files/${plik.id}?alt=media&supportsAllDrives=true`;
  return (await api(url)).arrayBuffer();
}

// --- Zapis protokołu ---

async function utworzFolder(idRodzica, nazwa) {
  return (await (await api(`${DRIVE}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nazwa, mimeType: MIME.folder, parents: [idRodzica] })
  })).json()).id;
}

// Podfolder pasujący do `pasuje(nazwa)`, a jeśli go nie ma - nowy o nazwie `nowa`.
export async function folderPodrzedny(idRodzica, pasuje, nowa) {
  const foldery = await lista(`'${idRodzica}' in parents and mimeType = '${MIME.folder}' and trashed = false`);
  return foldery.find(f => pasuje(f.name))?.id || utworzFolder(idRodzica, nowa);
}

// Z idPliku - nadpisanie poprzedniej wersji (poprawiony protokół nie tworzy
// duplikatu), bez - nowy plik w folderze.
export async function wyslijPdf({ pdf, nazwa, idFolderu, idPliku }) {
  const metadane = idPliku ? { name: nazwa } : { name: nazwa, mimeType: MIME.pdf, parents: [idFolderu] };
  const tresc = new FormData();
  tresc.append('metadata', new Blob([JSON.stringify(metadane)], { type: 'application/json' }));
  tresc.append('file', pdf);
  const url = idPliku
    ? `https://www.googleapis.com/upload/drive/v3/files/${idPliku}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink';
  return (await api(url, { method: idPliku ? 'PATCH' : 'POST', body: tresc })).json();
}
