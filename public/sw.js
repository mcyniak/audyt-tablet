// Service worker: cała aplikacja (pliki statyczne) w pamięci tabletu, żeby
// startowała w terenie bez internetu. Strategia: najpierw sieć (świeża
// wersja po aktualizacji), przy braku sieci - kopia z pamięci.
// Zmień WERSJA przy każdym wydaniu, żeby stare pliki zostały wyrzucone.
const WERSJA = 'audyt-v2';
const PLIKI = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'src/tabela.js',
  'src/magazyn.js',
  'src/wypelnianie.js',
  'src/atrament.js',
  'src/edytor.js',
  'src/eksport.js',
  'vendor/xlsx.full.min.js',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'vendor/pdf-lib.esm.min.js',
  'vendor/fontkit.umd.min.js',
  'vendor/perfect-freehand.mjs',
  'vendor/DejaVuSansCondensed.ttf',
  'manifest.webmanifest',
  'icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(klucze => Promise.all(klucze.filter(k => k !== WERSJA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Tylko własne pliki aplikacji - zapytania do Google (Drive/Sheets) idą
  // zawsze prosto do sieci, nigdy z pamięci podręcznej.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(odpowiedz => {
        if (odpowiedz.ok) {
          const kopia = odpowiedz.clone();
          caches.open(WERSJA).then(c => c.put(e.request, kopia));
        }
        return odpowiedz;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
