import { useState, useEffect } from 'react';
import UserView from './UserView';
import AdminView from './AdminView';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
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
      } catch (e) {
        console.warn('Telegram WebApp setup error:', e);
      }
    }

    // Check if ?admin=true is in URL or startapp=admin in Telegram initData
    const urlParams = new URLSearchParams(window.location.search);
    const startParam = tg?.initDataUnsafe?.start_param;
    
    if (urlParams.get('admin') === 'true' || startParam === 'admin') {
      setIsAdmin(true);
    }
  }, []);

  return isAdmin ? <AdminView /> : <UserView />;
}

export default App;
