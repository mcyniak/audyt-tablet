// Konfiguracja Google (projekt w Google Cloud Console firmy). Identyfikator
// klienta OAuth NIE jest sekretem - jest widoczny w każdej aplikacji webowej;
// zabezpiecza go ograniczenie do adresu https://mcyniak.github.io (Cloud
// Console) i to, że aplikacja jest wewnętrzna dla firmowego Google Workspace.
// Wersja aplikacji - ZMIEŃ PRZY KAŻDYM WYDANIU. Po zmianie tablet sam się
// przeładuje, wyloguje i pobierze inwestycje od nowa (niewysłane protokoły
// i materiałówki zostają). Ta sama nazwa jest nazwą pamięci offline (sw.js).
export const WERSJA_APLIKACJI = 'audyt-v17';

export const GOOGLE = {
  clientId: '460087887322-dcbpakdmkhor2ahf8tlap11ban8ic6gj.apps.googleusercontent.com'
};

// Gdzie na Dysku są inwestycje i jak się nazywają foldery w ich środku.
export const DYSK = {
  // Dysk współdzielony z folderami inwestycji.
  inwestycje: 'INWESTYCJE_3',
  // Podfolder inwestycji (obok tabeli montażowej) ze wzorami protokołów -
  // PDF lub dokument Google na każdy typ audytu.
  wzory: /wz[oó]r|szablon/i,
  // Folder na gotowe protokoły w głównym katalogu dysku:
  // AUDYTY / <nazwa inwestycji> / <typ> / <adres>_<typ>.pdf
  // Brakujące foldery aplikacja zakłada sama.
  audyty: 'AUDYTY',
  // Materiałówki: folder z „materiałówki” w nazwie w folderze inwestycji,
  // w nim foldery rodzajów (nazwy jak niżej) z PDF-ami zestawów i arkuszem
  // „Materiałówka”. Wypełnione: <rodzaj> / <adres> / <adres>_<zestaw>.pdf
  // Foldery typów (nazwy jak w istniejących inwestycjach).
  foldery: { pompy: 'PC', pv_me: 'PV', solary: 'KOLEKTORY', kotly: 'kotły' }
};
