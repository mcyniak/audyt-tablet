// Konfiguracja Google (projekt w Google Cloud Console firmy). To NIE są
// sekrety - identyfikator klienta OAuth i klucz API są widoczne w każdej
// aplikacji webowej; zabezpiecza je ograniczenie do adresu
// https://mcyniak.github.io (ustawione w Cloud Console).
// Puste = przycisk "Z Google Drive" pokazuje, że Google nie jest skonfigurowany.
export const GOOGLE = {
  clientId: '460087887322-dcbpakdmkhor2ahf8tlap11ban8ic6gj.apps.googleusercontent.com', // OAuth 2.0 Client ID (aplikacja internetowa)
  apiKey: 'AIzaSyAIzY_QO3UicnO6H7k7o1yZfdTC1uPkQN4', // klucz API ograniczony do Google Picker API i strony mcyniak.github.io
  appId: '460087887322' // numer projektu (Project number) z Cloud Console
};
