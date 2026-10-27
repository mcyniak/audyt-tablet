# Audyt (tablet)

Aplikacja dla audytorów z tabletami z Androidem. Audytor wybiera adres z tabeli
montażowej (kotły, solary, PV_ME, pompy ciepła – jedna wspólna lista), pisze
rysikiem po szablonie audytu PDF i zapisuje go na Google Drive.

Forma: aplikacja webowa instalowana z Chrome („Dodaj do ekranu głównego”),
działająca offline. Bez serwera z danymi: adresy i audyty idą prosto między
tabletem a Google Drive/Sheets.

## Uruchomienie lokalne

```
npm install
npm run vendor   # kopiuje biblioteki do public/vendor (aplikacja nie korzysta z CDN)
npm start        # http://localhost:5173
npm test         # testy rozpoznawania arkuszy, także na prawdziwych tabelach z Pobranych
```

## Struktura

- `public/src/tabela.js` – rozpoznawanie arkuszy i scalanie adresów (bez zależności,
  działa w przeglądarce i w testach).
- `public/src/magazyn.js` – IndexedDB (tabela i audyty w pamięci tabletu).
- `public/src/wypelnianie.js` – auto-wpisy (imię, adres, telefon, e-mail, data) w szablon;
  szuka etykiet w tekście PDF, nie sztywnych współrzędnych.
- `public/src/edytor.js` – strony szablonu + warstwa pisma (rysik pisze, palec przewija).
- `public/src/atrament.js` – kształt kreski (wspólny dla ekranu i PDF).
- `public/src/eksport.js` – gotowy PDF: szablon + wpisy + pismo jako wektory.
- `public/app.js` – ekrany: tabela → lista adresów → adres → protokół.
- `public/sw.js` – tryb offline. Przy wydaniu zmień `WERSJA`.
- `scripts/probny-protokol.js` – wypełnia szablon przykładowymi danymi (sprawdzenie auto-wpisów).

Szablony protokołów i tabele z danymi klientów **nie** trafiają do repozytorium –
testy na prawdziwych plikach czytają listę z `test/lokalne.json` (poza repozytorium,
wzór w `test/lokalne.przyklad.json`) i pomijają się, gdy go nie ma.

## Reguły scalania adresów (sprawdzone na realnych tabelach kilku inwestycji)

- Ten sam adres po normalizacji (bez polskich znaków, bez „ul.”, kolejność słów
  dowolna, „13 A” = „13A”) to jeden adres.
- Ten sam UID w **różnych** arkuszach scala literówki („FREDRY”/„FREDY”), a różne
  zapisy są pokazywane audytorowi.
- UID w obrębie jednego arkusza **nie** scala – w jednej z tabel ten sam UID mają różne domy.
- Znacznik „ŻŻŻ ” przed adresem (spotykany w arkuszach pomp) jest usuwany.
- Rezygnacja liczy się tylko, gdy zrezygnowano ze wszystkich instalacji pod adresem.

## Konwencja na Dysku (dysk współdzielony INWESTYCJE_3)

```
INWESTYCJE_3/
├── <INWESTYCJA>/                     ← inwestycja = folder z tabelą montażową
│   ├── <…> tab. montażowa <…>         (arkusz Google albo .xlsx, nazwa zawiera „montaż”)
│   └── Wzory audytów/                 (PDF lub dokument Google na typ audytu;
│       ├── PC powietrzne.pdf           typ rozpoznawany z nazwy: PC/pompa, grunt/powietrz,
│       ├── PC gruntowe.pdf             PV/fotowolt, KOLEKTORY/solar, KOTŁY)
│       └── PV.pdf
└── AUDYTY/                           ← gotowe protokoły (foldery zakładane same)
    └── <INWESTYCJA>/
        ├── PC/
        │   └── <adres>/
        │       ├── <adres>_PC.pdf
        │       ├── <adres>_PC_zdjęcie 01.jpg
        │       └── <adres>_PC_zdjęcie 02.jpg
        └── PV/
            └── <adres>/<adres>_PV.pdf
```

Zdjęcia dodaje się w protokole (przycisk ze zdjęciem na pasku narzędzi albo
kafelek „Dodaj”, wybór z galerii). Trzymane w tablecie do „Zapisz”, potem
wysyłane do folderu adresu; JPEG do 4,5 MB bez zmian, większe zmniejszane
do 3000 px (wysyłka jednym zapytaniem przyjmuje do 5 MB).

Nazwy i wzorce są w `public/config.js`. Dla pomp wzór gruntowy/powietrzny wybiera
kolumna „rodzaj pompy” z tabeli.

## Audyt PV → tabela montażowa

Audytor zaznacza kratki ☐ na protokole jak na papierze; przy „Zapisz” aplikacja
sprawdza, przez które kratki przechodzą kreski rysika (`public/src/ankieta.js`) -
to geometria, nie odczyt pisma. Kratki pytań znajdowane są we wzorze automatycznie
(tekst pytania, potem kolejne kratki z pasującymi podpisami).

Pytania: miejsce montażu PV, zwiększenie mocy umownej, prywatna/istniejąca
instalacja PV, pokrycie dachowe, zmniejszenie mocy PV, usunięcie magazynu,
rezygnacja (pismo w linii „Ja niżej podpisany” sekcji rezygnacji). Miejsca montażu
magazynu energii nie ma na wzorze - o nie okno pyta przyciskami.

- Okno przed zapisem pokazuje odczyt z protokołu tylko do wglądu; poprawia się na
  protokole, żeby PDF i tabela mówiły to samo. TAK i NIE naraz = w tabeli bez zmian.
- Tylko pytania, dla których tabela ma kolumnę (dopasowanie po nazwie).
- Wpis po wysłaniu PDF-a, na świeżo pobranym arkuszu. Wiersz: zapamiętany numer,
  a gdy się przesunął - po adresie (i UID); dwa pasujące wiersze = błąd, bez zgadywania.
- Zmieniane są tylko komórki z inną odpowiedzią, pisownią używaną już w tej
  kolumnie („mieszkalny” / „Dach budynku mieszkalnego”, true/false w polach wyboru).
- Tylko Arkusze Google (nie .xlsx); konto audytora musi mieć prawo edycji tabeli.

## Etapy

1. ✅ Szkielet, wczytanie tabeli, rozpoznanie arkuszy, lista adresów.
2. ✅ Szablon PDF, auto-wpisy z tabeli, pisanie rysikiem, gumka, cofnij.
3. ✅ Zapis protokołu w tablecie (autozapis szkicu po każdej kresce, PDF do pobrania).
4. Google: logowanie, wybór tabeli z Drive (Sheets API), wysyłka PDF na Drive,
   opcjonalnie status audytu w tabeli.
5. Hosting na https (GitHub Pages) i instalacja na tabletach.
