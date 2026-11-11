// Service worker do LoggB.
// Regra: páginas SEMPRE vêm da rede (rede primeiro). A cópia guardada só é usada sem internet.
// A versão antiga servia "/" do cache primeiro: depois de cada publicação a página guardada
// apontava para CSS/JS que não existem mais e o site abria sem estilo, travado em "Carregando…".
// Arquivos de /_next/static têm hash no nome e cache do próprio navegador: não passam por aqui.
const CACHE_NAME = 'loggb-pages-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(
          (cached) =>
            cached ||
            new Response('<!doctype html><meta charset="utf-8"><title>Sem conexão</title><body style="font-family:Arial,sans-serif;padding:24px">Sem conexão com a internet. Tente de novo quando a conexão voltar.</body>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
        )
      )
  );
});
