# Audyt (tablet)

Aplikacja dla audytorów z tabletami z Androidem. Audytor wybiera adres z tabeli
montażowej (kotły, solary, PV_ME, pompy ciepła – jedna wspólna lista), pisze
rysikiem po szablonie audytu PDF i zapisuje go na Google Drive.

Forma: aplikacja webowa instalowana z Chrome („Dodaj do ekranu głównego”),
działająca offline. Bez serwera z danymi: adresy i audyty idą prosto między
tabletem a Google Drive/Sheets.

## Dwie aplikacje: Audyty i Materiałówki

Z jednego kodu, ale dla innych osób – żadna nie pokazuje części drugiej
(przełącznika, ekranów, liczników):

| Aplikacja | Adres | Dla kogo |
|---|---|---|
| **Audyty** | https://mcyniak.github.io/audyt-tablet/ | audytorzy w terenie |
| **Materiałówki** | https://mcyniak.github.io/audyt-tablet/materialowki/ (→ `?app=materialowki`) | magazyn |

Każdą instaluje się osobno z Chrome („Dodaj do ekranu głównego”) – własna
nazwa, ikona (zielona paczka) i manifest (`manifest-materialowki.webmanifest`).
Tryb wynika z adresu (`?app=materialowki`), nie z ustawień. Link do ekranu
drugiej aplikacji kończy się na liście adresów. To rozdzielenie widoku, nie
uprawnień – dostęp do plików wyznaczają uprawnienia na Dysku.

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
- `public/src/wniosek.js` – materiałówka: pozycje z PDF zestawu, wiersze do arkusza „Materiałówka”, daty w tabeli montażowej, stan do edycji w PDF.
- `public/src/odczyt-pisma.js` – ilości pisane rysikiem: przypisanie kresek do pól, wycinki, odczyt przez Claude.
- `public/src/tabela-materialowa.js` – pomocnicze funkcje arkuszy (zakresy A1, daty, liczby).
  **Ten sam plik jest w repozytorium listy-materialowe** (tam zapis „Tabeli materiałowej”) – zmieniać w obu.
- `public/app.js` – ekrany: tabela → lista adresów → adres → protokół / wniosek.
- `public/sw.js` – tryb offline (pamięć nazwana wersją z `config.js`).
- **Przy każdym wydaniu zmień `WERSJA_APLIKACJI` w `public/config.js`.** Tablet z
  internetem sam się wtedy przeładuje (także otwarty – przy powrocie do aplikacji;
  w trakcie wypełniania dopiero po wyjściu do listy), wyloguje i pobierze listę
  inwestycji oraz każdą otwieraną inwestycję od nowa. Niewysłane protokoły
  i materiałówki zostają.
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
│   ├── 8. Materiałówki/               ← folder z „materiałówki” w nazwie (zakłada biuro)
│   │   ├── PC/                         (nazwy folderów rodzajów: PC, PV, KOLEKTORY, kotły)
│   │   │   ├── set 9008.pdf            ← zestawy (PDF lub dokument Google) – wybór przy adresie
│   │   │   ├── set 9012.pdf
│   │   │   ├── Materiałówka            ← arkusz Google: zakładki PC / PV (adres, towar, liczba…)
│   │   │   └── <adres>/<adres>_set 9012.pdf   ← wypełnione (foldery zakładane same)
│   │   └── PV/ …
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
rezygnacja (cokolwiek napisane lub skreślone w sekcji rezygnacji). Miejsca montażu
magazynu energii nie ma na wzorze - o nie okno pyta przyciskami.

- Okno przed zapisem pokazuje odczyt z protokołu tylko do wglądu; poprawia się na
  protokole, żeby PDF i tabela mówiły to samo. TAK i NIE naraz = w tabeli bez zmian.
- Tylko pytania, dla których tabela ma kolumnę (dopasowanie po nazwie).
- Wpis po wysłaniu PDF-a, na świeżo pobranym arkuszu. Wiersz: zapamiętany numer,
  a gdy się przesunął - po adresie (i UID); dwa pasujące wiersze = błąd, bez zgadywania.
- Zmieniane są tylko komórki z inną odpowiedzią, pisownią używaną już w tej
  kolumnie („mieszkalny” / „Dach budynku mieszkalnego”, true/false w polach wyboru).
- Tylko Arkusze Google (nie .xlsx); konto audytora musi mieć prawo edycji tabeli.

## Materiałówki (wnioski materiałowe)

Osobna aplikacja **Materiałówki** (adres wyżej). Materiałówkę wypełnia szef
magazynu: inwestycja → rodzaj instalacji (segmenty nad listą, bez „Wszystkie”)
→ adres → zestaw. Pod jednym adresem PV i PC to dwie osobne materiałówki.

- **Zestawy** to PDF-y w folderze rodzaju (`8. Materiałówki/PC/set 9012.pdf`).
  Gdy jest ich kilka, aplikacja pokazuje wybór; zestaw, którego numer (np.
  9012) stoi w wierszu adresu w tabeli montażowej (np. „VPM9012” w kolumnie
  POMPA), jest pierwszy i podświetlony. Po pierwszym zapisie zestaw zostaje.
- **Pozycje odczytywane z samego PDF** (`polaZestawu`): tabela od wiersza z
  „Nazwa” (i „Materiał”), także na kolejnych stronach bez powtórzonego
  nagłówka, do linii „Podpis…”. Pozycja = nazwa, materiał, l.p. i ilość
  wydrukowana w kolumnie na prawo od „Materiał”; zawinięta nazwa (linie bliżej
  niż 7 pt) to jedna pozycja. Nad tabelą: „Ekipa” (z kolumny „Ekipa…”
  tabeli montażowej, gdy jest; można zmienić), „Data” i „Adres montażu”
  (wpisują się same).
- **Drugi układ zestawu** (np. zestawy PV): bez „Nazwa/Materiał”, z kolumnami
  „jedn.” i pustą „Ile pozostało [szt.]”. Pozycja = linia z jednostką (szt,
  mb, kpl, op…); linia bez jednostki tuż pod pozycją (<13,4 pt) to dalszy
  ciąg nazwy, dalej – tytuł grupy. Pole ilości w kolumnie „Ile pozostało”;
  „ADRES / Data / Ekipa” w jednej linii – pola między etykietami.
- **Ilości:** wydrukowana zostaje, jeśli w jej polu nic nie napisano.
  Rysikiem: skreślenie = 0 (pozycja nie trafia do arkusza), nowa liczba =
  poprawka, liczba w pustym polu = dopisana ilość. Przy zatwierdzeniu (z
  internetem) i przy wysyłce aplikacja wycina pismo z pól (sam atrament,
  `src/odczyt-pisma.js`) i odczytuje je jednym zapytaniem Claude Haiku 5.5
  (effort low), podając wydrukowaną ilość. Okno zatwierdzenia pokazuje
  poprawki („2 → 7”); niepewne mają w arkuszu „do sprawdzenia: tak”. Odczyt
  powtarza się tylko po zmianie pisma. Klucz API wpisuje się raz na tablecie.
  Wiersze mają ~9,5 pt – przy pisaniu warto powiększyć stronę.
- **Sprawdzenie odczytu bez wracania do kartki:** okno przy „Zapisz” i
  „Zatwierdź” pokazuje tylko ilości, których AI nie jest pewne: wycinek
  pisma, odczyt w polu do poprawienia i przyciski z drugim możliwym odczytem
  (AI zwraca `alternatywa`). Poprawione tu tracą „do sprawdzenia”. Gdy
  wszystko pewne: „Zapisz” bez okna, „Zatwierdź” – samo pytanie bez listy.
- **Kolory:** „Zapisz” niebieski (można dalej poprawiać), „Zatwierdź”
  zielony z kłódką (koniec poprawek).
- **Przyciski nad zestawem** (do zatwierdzenia):
  - *Ilości z klawiatury* – pola na komórkach ilości; wpisana wartość ma
    pierwszeństwo przed pismem i wydrukiem (pole puste = pismo/wydruk). W PDF
    wydrukowana liczba przekreślona, wpisana obok na niebiesko. Tryb
    zapamiętany w tablecie.
  - *Dopisz pozycję* – materiał spoza zestawu (nazwa, ilość): wiersz w
    Materiałówce (zestaw „… – dopisane”) i dodatkowa strona na końcu PDF.
  - *Zmień zestaw* – także po zapisie: pismo i ilości poprzedniego zestawu
    znikają, ekipa/data/dopisane zostają; plik na Dysku ten sam (nowa nazwa).
  - *Usuń materiałówkę* – PDF do kosza Dysku (bez prawa usuwania: nazwa
    „USUNIĘTA – …”), wiersze adresu z Materiałówki, data wydania z tabeli
    montażowej, rekord z tabletu. Zatwierdzonej nie da się usunąć.
- **Poprawki po zapisie:** zapisaną materiałówkę otwiera się z listy i poprawia
  (wszystko: pismo, klawiatura, dopisane); zapis podmienia PDF i wiersze.
- **PDF** do `<…Materiałówki>/<PC|PV>/<adres>/<adres>_<zestaw>.pdf`.
- **Arkusz „Materiałówka”** (w folderze rodzaju albo w folderze materiałówek;
  brak – zakładany w folderze rodzaju), zakładka o nazwie rodzaju („PC”/„PV”):
  adres, towar, liczba, zestaw, data zapisania, data zatwierdzenia, do
  sprawdzenia. Kolumny po nagłówku, brakujące dopisywane. Ponowny zapis
  zastępuje wiersze tego adresu (nowe dopisywane, stare usuwane).
- **Tabela montażowa**, wiersz adresu (arkusz rodzaju): data zapisu do kolumny
  z „wydania” w nagłówku („data wydania materiału” – T w pompach, „wydania
  zestawu” – Y w PV_ME), data zatwierdzenia do kolumny z „zakończenia” („Data
  zakończenia montażu” – U / Z). Data zatwierdzenia nigdy nie jest czyszczona.
  Błąd (brak kolumny, ochrona) nie blokuje materiałówki – uwaga na tablecie
  i ponowna próba przy kolejnym zapisie. Status na liście adresów też z tych
  kolumn.
  Wpis biura w kolumnie wydania, który nie jest datą (w Słupcy numery 1–18,
  w Zagórowie „x”), zostaje – aplikacja go nie nadpisuje (uwaga na tablecie),
  nie czyści i nie liczy jako rozpoczętej materiałówki. Wartość sprzed
  pierwszego zapisu (np. planowana data) jest zapamiętana i *Usuń* ją
  przywraca.
- **Edycja z każdego urządzenia.** PDF ma w środku załączniki
  `wniosek-stan.json` (wartości, kreski, zestaw) i `wniosek-wzor.pdf` (czysty
  zestaw). Gdy na Dysku jest nowsza wersja niż w tablecie, aplikacja wczytuje
  ją z PDF; niewysłane zmiany z tabletu mają pierwszeństwo.
- **Zatwierdzenie** kończy edycję: pieczątka „ZATWIERDZONO <data>” na
  1. stronie, w aplikacji tylko podgląd. Biuro odblokowuje, czyszcząc datę
  zakończenia w wierszu adresu w tabeli montażowej.
- Bez zdjęć.

## Etapy

1. ✅ Szkielet, wczytanie tabeli, rozpoznanie arkuszy, lista adresów.
2. ✅ Szablon PDF, auto-wpisy z tabeli, pisanie rysikiem, gumka, cofnij.
3. ✅ Zapis protokołu w tablecie (autozapis szkicu po każdej kresce, PDF do pobrania).
4. Google: logowanie, wybór tabeli z Drive (Sheets API), wysyłka PDF na Drive,
   opcjonalnie status audytu w tabeli.
5. Hosting na https (GitHub Pages) i instalacja na tabletach.
