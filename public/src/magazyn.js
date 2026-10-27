// Mała nakładka na IndexedDB - trzyma wczytaną tabelę (i później audyty
// czekające na wysyłkę), żeby aplikacja działała w terenie bez internetu.
// localStorage nie wystarcza: surowe arkusze dużej tabeli mają kilka MB.

const BAZA = 'audyt-tablet';
const WERSJA = 3;
// zdjecia: pliki zdjęć osobno od protokołu - autozapis po każdej kresce nie
// przepisuje wtedy megabajtów zdjęć.
const MAGAZYNY = ['ustawienia', 'inwestycje', 'audyty', 'szablony', 'zdjecia'];

let polaczenie = null;

function otworz() {
  if (polaczenie) return polaczenie;
  polaczenie = new Promise((resolve, reject) => {
    const zadanie = indexedDB.open(BAZA, WERSJA);
    zadanie.onupgradeneeded = () => {
      for (const nazwa of MAGAZYNY) {
        if (!zadanie.result.objectStoreNames.contains(nazwa)) zadanie.result.createObjectStore(nazwa);
      }
    };
    zadanie.onsuccess = () => resolve(zadanie.result);
    zadanie.onerror = () => reject(zadanie.error);
  });
  return polaczenie;
}

async function transakcja(magazyn, tryb, akcja) {
  const db = await otworz();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(magazyn, tryb);
    const zadanie = akcja(tx.objectStore(magazyn));
    tx.oncomplete = () => resolve(zadanie?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const odczytaj = (magazyn, klucz) => transakcja(magazyn, 'readonly', s => s.get(klucz));
export const zapisz = (magazyn, klucz, wartosc) => transakcja(magazyn, 'readwrite', s => s.put(wartosc, klucz));
export const usun = (magazyn, klucz) => transakcja(magazyn, 'readwrite', s => s.delete(klucz));
export const wszystkie = magazyn => transakcja(magazyn, 'readonly', s => s.getAll());
