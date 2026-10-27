// Konfiguracja Google (projekt w Google Cloud Console firmy). To NIE są
// sekrety - identyfikator klienta OAuth i klucz API są widoczne w każdej
// aplikacji webowej; zabezpiecza je ograniczenie do adresu
// https://mcyniak.github.io (ustawione w Cloud Console).
// Puste = przycisk "Z Google Drive" pokazuje, że Google nie jest skonfigurowany.
export const GOOGLE = {
  clientId: '', // OAuth 2.0 Client ID (typ: aplikacja internetowa), …apps.googleusercontent.com
  apiKey: '', // klucz API ograniczony do Google Picker API i strony mcyniak.github.io
  appId: '' // numer projektu (Project number) z Cloud Console
};
