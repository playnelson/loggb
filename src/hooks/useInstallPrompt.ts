'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/macintosh|windows|linux|cros/.test(ua)) return 'desktop';
  return 'unknown';
}

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setPlatform(detectPlatform(window.navigator.userAgent));

    const standaloneByMedia = window.matchMedia('(display-mode: standalone)').matches;
    const standaloneByIos = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    const installed = standaloneByMedia || standaloneByIos;
    setIsStandalone(installed);
    setIsInstalled(installed);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const canInstall = !isInstalled && Boolean(promptEvent);
  const needsManualInstall = !isInstalled && !promptEvent;

  const triggerInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!promptEvent) return 'unavailable';

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setPromptEvent(null);
      return 'accepted';
    }

    return 'dismissed';
  }, [promptEvent]);

  const manualInstallHint = useMemo(() => {
    if (!needsManualInstall) return null;

    if (platform === 'ios') {
      return 'No iPhone/iPad (Safari): toque em Compartilhar e depois em Adicionar à Tela de Início.';
    }

    if (platform === 'android') {
      return 'No Android: abra o menu do navegador e toque em Instalar app ou Adicionar à tela inicial.';
    }

    return 'No desktop: abra o menu do navegador e escolha Instalar app.';
  }, [needsManualInstall, platform]);

  return {
    canInstall,
    isInstalled,
    isStandalone,
    needsManualInstall,
    manualInstallHint,
    platform,
    triggerInstall,
  };
}
