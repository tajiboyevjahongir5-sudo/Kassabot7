import { useState, useEffect } from 'react';
import UserView from './UserView';
import AdminView from './AdminView';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    const updateSafeInsets = () => {
      let topInset = 110;
      let bottomInset = 0;

      if (tg) {
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || tg?.platform === 'ios';
        const isMobile = isIOS || /Android/i.test(navigator.userAgent) || tg?.platform === 'android';

        if (isIOS) {
          // On iOS, status bar/dynamic island is 44-59px.
          // Telegram's floating close button is ~36px tall and ends around 88-95px.
          // To start cleanly below "✕ Yopish", we need at least 110px.
          const safeTop = tg.safeAreaInset?.top || tg.contentSafeAreaInset?.top || 54;
          topInset = Math.max(safeTop + 54, 110);
          bottomInset = tg.safeAreaInset?.bottom || tg.contentSafeAreaInset?.bottom || 0;
        } else if (isMobile) {
          // Android
          const safeTop = tg.safeAreaInset?.top || tg.contentSafeAreaInset?.top || 32;
          topInset = Math.max(safeTop + 50, 92);
          bottomInset = tg.safeAreaInset?.bottom || tg.contentSafeAreaInset?.bottom || 0;
        } else {
          // Desktop Telegram
          topInset = 20;
        }
      } else {
        // Regular browser preview
        topInset = 20;
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
