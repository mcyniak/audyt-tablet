// Google: logowanie, wybór plików z Dysku (także Dysków współdzielonych),
// odczyt tabeli z Google Sheets, pobranie szablonu PDF, wysyłka protokołu.
//
// Uprawnienie tylko "drive.file": aplikacja widzi WYŁĄCZNIE pliki, które
// audytor sam wskaże w oknie wyboru Google (tabela, szablon, folder), i te,
// które sama utworzy (protokoły). Nie ma dostępu do reszty Dysku.
import { GOOGLE } from '../config.js';

const ZAKRES = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
const ARKUSZ = 'application/vnd.google-apps.spreadsheet';

export const skonfigurowany = () => Boolean(GOOGLE.clientId && GOOGLE.apiKey && GOOGLE.appId);

// --- Ładowanie bibliotek Google (tylko online; offline aplikacja działa na danych z pamięci) ---

const skrypty = new Map();
function zaladujSkrypt(src) {
  if (!skrypty.has(src)) {
    skrypty.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { skrypty.delete(src); reject(new Error('Brak połączenia z Google')); };
      document.head.append(s);
    }));
  }
  return skrypty.get(src);
}

async function bibliotekaPicker() {
  await zaladujSkrypt('https://apis.google.com/js/api.js');
  await new Promise(resolve => window.gapi.load('picker', resolve));
}

// --- Token dostępu (ważny ok. godziny, odnawiany przy potrzebie) ---

let token = null; // { wartosc, wygasa }
let klientTokenu = null;

async function pobierzToken({ cicho = false } = {}) {
  if (token && token.wygasa > Date.now() + 60_000) return token.wartosc;
  await zaladujSkrypt('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    klientTokenu = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE.clientId,
      scope: ZAKRES,
      callback: odp => {
        if (odp.error) { reject(new Error(odp.error_description || odp.error)); return; }
        token = { wartosc: odp.access_token, wygasa: Date.now() + Number(odp.expires_in) * 1000 };
        resolve(token.wartosc);
      },
      error_callback: blad => reject(new Error(blad.type === 'popup_closed' ? 'Logowanie przerwane' : (blad.message || blad.type)))
    });
    // Po pierwszym logowaniu kolejne odnowienia przechodzą bez pytania.
    klientTokenu.requestAccessToken({ prompt: cicho ? '' : undefined });
  });
}

export const zaloguj = () => pobierzToken();

async function api(url, opcje = {}, ponowienie = false) {
  const odp = await fetch(url, { ...opcje, headers: { Authorization: `Bearer ${await pobierzToken({ cicho: true })}`, ...opcje.headers } });
  // Token unieważniony wcześniej niż zapowiadał - jedna próba z nowym.
  if (odp.status === 401 && !ponowienie) { token = null; return api(url, opcje, true); }
  if (!odp.ok) {
    let opis = `${odp.status}`;
    try { opis = (await odp.json()).error?.message || opis; } catch { /* odpowiedź bez JSON */ }
    throw new Error(`Google: ${opis}`);
  }
  return odp;
}

// --- Okno wyboru plików Google (Picker) ---

async function wybierz(widok, tytul) {
  const [tokenDostepu] = await Promise.all([pobierzToken(), bibliotekaPicker()]);
  const { picker } = window.google;
  return new Promise(resolve => {
    new picker.PickerBuilder()
      .addView(widok(picker))
      .enableFeature(picker.Feature.SUPPORT_DRIVES) // Dyski współdzielone
      .setOAuthToken(tokenDostepu)
      .setDeveloperKey(GOOGLE.apiKey)
      .setAppId(GOOGLE.appId)
      .setLocale('pl')
      .setTitle(tytul)
      .setCallback(dane => {
        if (dane.action === picker.Action.PICKED) resolve(dane.docs[0]);
        else if (dane.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

const widokPlikow = typMime => p => new p.DocsView()
  .setMimeTypes(typMime)
  .setIncludeFolders(true)
  .setEnableDrives(true)
  .setMode(p.DocsViewMode.LIST);

export const wybierzTabele = () => wybierz(widokPlikow(ARKUSZ), 'Wybierz tabelę montażową');
export const wybierzSzablon = () => wybierz(widokPlikow('application/pdf'), 'Wybierz szablon protokołu (PDF)');
export const wybierzFolder = () => wybierz(p => new p.DocsView(p.ViewId.FOLDERS)
  .setSelectFolderEnabled(true)
  .setIncludeFolders(true)
  .setEnableDrives(true)
  .setMimeTypes(FOLDER), 'Wybierz folder na protokoły');

// --- Tabela z Google Sheets ---

// Zwraca ten sam kształt co odczyt .xlsx: { tytul, arkusze: [{ nazwa, wiersze }] }.
// UNFORMATTED_VALUE: surowe wartości - telefon 500100200 nie zamieni się w "500,100,200".
export async function odczytajTabele(idArkusza) {
  const meta = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${idArkusza}?fields=properties.title,sheets.properties.title`)).json();
  const nazwy = meta.sheets.map(s => s.properties.title);
  const parametry = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', majorDimension: 'ROWS' });
  for (const n of nazwy) parametry.append('ranges', `'${n.replace(/'/g, "''")}'`);
  const wartosci = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${idArkusza}/values:batchGet?${parametry}`)).json();
  return { tytul: meta.properties.title, arkusze: zArkuszyGoogle(nazwy, wartosci.valueRanges) };
}

export function zArkuszyGoogle(nazwy, zakresy) {
  return nazwy.map((nazwa, i) => ({ nazwa, wiersze: zakresy[i]?.values || [] }));
}

// --- Pliki na Dysku ---

export async function pobierzPlik(idPliku) {
  return (await api(`https://www.googleapis.com/drive/v3/files/${idPliku}?alt=media&supportsAllDrives=true`)).arrayBuffer();
}

// Wysyłka PDF. Z idPliku - nadpisanie poprzedniej wersji (poprawiony protokół
// nie tworzy duplikatu), bez - nowy plik w folderze.
export async function wyslijPdf({ pdf, nazwa, idFolderu, idPliku }) {
  const metadane = idPliku ? { name: nazwa } : { name: nazwa, mimeType: 'application/pdf', parents: [idFolderu] };
  const tresc = new FormData();
  tresc.append('metadata', new Blob([JSON.stringify(metadane)], { type: 'application/json' }));
  tresc.append('file', pdf);
  const url = idPliku
    ? `https://www.googleapis.com/upload/drive/v3/files/${idPliku}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink';
  return (await api(url, { method: idPliku ? 'PATCH' : 'POST', body: tresc })).json();
}
