import { useState, useEffect } from 'react';
import UserView from './UserView';
import AdminView from './AdminView';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    const updateSafeInsets = () => {
      let topInset = 0;
      let bottomInset = 0;

      if (tg) {
        // 1. Telegram Bot API 8.0+ contentSafeAreaInset (specifically accounts for close button & top bar)
        if (tg.contentSafeAreaInset && typeof tg.contentSafeAreaInset.top === 'number' && tg.contentSafeAreaInset.top > 0) {
          topInset = tg.contentSafeAreaInset.top + 8;
          bottomInset = tg.contentSafeAreaInset.bottom || 0;
        } else if (tg.safeAreaInset && typeof tg.safeAreaInset.top === 'number' && tg.safeAreaInset.top > 0) {
          // Telegram floating close button takes ~44px below device safe area
          topInset = tg.safeAreaInset.top + 50;
          bottomInset = tg.safeAreaInset.bottom || 0;
        } else {
          // Check platform & device
          const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || tg?.platform === 'ios';
          const isMobile = isIOS || /Android/i.test(navigator.userAgent) || tg?.platform === 'android';
          if (isIOS) {
            topInset = 96; // iOS status bar + close button
          } else if (isMobile) {
            topInset = 76; // Android status bar + close button
          } else {
            topInset = 24; // Desktop Telegram
          }
        }
      } else {
        topInset = 24;
      }

      document.documentElement.style.setProperty('--app-safe-top', `${topInset}px`);
      if (bottomInset > 0) {
        document.documentElement.style.setProperty('--app-safe-bottom', `${bottomInset + 16}px`);
      }
    };

    if (tg) {
      try {
        tg.ready();
        // 1. To'liq ekranga yoyish
        tg.expand();
        // 2. Telegram 7.0+ To'liq ekran rejimi (Fullscreen)
        if (typeof tg.requestFullscreen === 'function') {
          tg.requestFullscreen();
        }
        // 3. Telegram 7.7+ Pastga surilganda Mini App yopilib ketishini taqiqlash!
        if (typeof tg.disableVerticalSwipes === 'function') {
          tg.disableVerticalSwipes();
        }
        // 4. Tasodifiy yopilishdan tasdiqlash so'rash
        if (typeof tg.enableClosingConfirmation === 'function') {
          tg.enableClosingConfirmation();
        }

        // Listen for Telegram events when insets or fullscreen status change
        if (typeof tg.onEvent === 'function') {
          tg.onEvent('contentSafeAreaChanged', updateSafeInsets);
          tg.onEvent('safeAreaChanged', updateSafeInsets);
          tg.onEvent('fullscreenChanged', updateSafeInsets);
          tg.onEvent('viewportChanged', updateSafeInsets);
        }
      } catch (e) {
        console.warn('Telegram WebApp setup error:', e);
      }
    }

    // Run immediately and after brief intervals as Telegram initializes fullscreen
    updateSafeInsets();
    const t1 = setTimeout(updateSafeInsets, 100);
    const t2 = setTimeout(updateSafeInsets, 300);
    const t3 = setTimeout(updateSafeInsets, 600);
    const t4 = setTimeout(updateSafeInsets, 1200);

    // Check if ?admin=true is in URL or startapp=admin in Telegram initData
    const urlParams = new URLSearchParams(window.location.search);
    const startParam = tg?.initDataUnsafe?.start_param;
    
    if (urlParams.get('admin') === 'true' || startParam === 'admin') {
      setIsAdmin(true);
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (tg && typeof tg.offEvent === 'function') {
        tg.offEvent('contentSafeAreaChanged', updateSafeInsets);
        tg.offEvent('safeAreaChanged', updateSafeInsets);
        tg.offEvent('fullscreenChanged', updateSafeInsets);
        tg.offEvent('viewportChanged', updateSafeInsets);
      }
    };
  }, []);

  return isAdmin ? <AdminView /> : <UserView />;
}

export default App;
