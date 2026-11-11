'use client';

import { useEffect } from 'react';

export default function PwaServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // updateViaCache 'none': o navegador sempre busca o sw.js novo, para correções chegarem logo.
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch((error) => {
        console.error('Falha ao registrar service worker:', error);
      });
  }, []);

  return null;
}
