import { useState, useEffect } from 'react';
import { Crown, Lock, CheckCircle2, AlertTriangle, Copy, Check } from 'lucide-react';
import './index.css';

// TypeScript interfaces
interface Plan {
  id: number;
  name: string;
  description: string | null;
  price: number;
  priceType: string;
  duration: number;
}

interface Channel {
  id: string;
  title: string;
  image?: string;
  plans: Plan[];
}

// Ensure Telegram Web App exists
const tg = (window as any).Telegram?.WebApp;

function UserView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [activePayment, setActivePayment] = useState<any>(null);
  const [cardNumber, setCardNumber] = useState<string>('');
  const [cardHolder, setCardHolder] = useState<string>('');
  const [complaintSent, setComplaintSent] = useState(false);
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [subCheckLoading, setSubCheckLoading] = useState(true);
  const [subOk, setSubOk] = useState(true);
  const [missingChannels, setMissingChannels] = useState<any[]>([]);

  const handleCopy = () => {
    if (cardNumber) {
      navigator.clipboard.writeText(cardNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (tg && tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
      }
    }
  };

  const openPaymentApp = (appName: 'payme' | 'click' | 'uzum') => {
    if (!cardNumber) {
      alert("Karta raqami topilmadi!");
      return;
    }
    const cleanCard = cardNumber.replace(/\s+/g, '');

    // 1. Karta raqamini avtomatik nusxalash (Click va Payme ilovasi ochilganda buferdan avtomat taniydi)
    try {
      navigator.clipboard.writeText(cleanCard);
    } catch (e) {}

    setCopied(true);
    setTimeout(() => setCopied(false), 3000);

    if (tg && tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('medium');
    }

    // 2. To'g'ridan-to'g'ri telefon ilovasini (App) ochuvchi maxsus sxemalar
    let appScheme = '';
    if (appName === 'click') {
      appScheme = 'clickuz://';
    } else if (appName === 'payme') {
      appScheme = 'payme://';
    } else if (appName === 'uzum') {
      appScheme = 'uzumbank://';
    }

    // 3. Brauzerga bormasdan, to'g'ridan-to'g'ri ilovani ochish
    try {
      const a = document.createElement('a');
      a.href = appScheme;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {}

    setTimeout(() => {
      window.location.href = appScheme;
    }, 50);
  };

  // Use relative path by default so it works correctly on production domain
  const API_URL = import.meta.env.VITE_API_URL || '/api';

  const checkSubscription = async () => {
    const userId = tg?.initDataUnsafe?.user?.id;
    if (!userId) {
      setSubCheckLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/check-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      setSubOk(data.ok);
      setMissingChannels(data.missing || []);
    } catch (err) {
      console.error('Sub check error:', err);
      setSubOk(true); // fail open
    }
    setSubCheckLoading(false);
  };

  useEffect(() => {
    // Initialize Telegram Web App
    if (tg) {
      tg.ready();
      tg.expand();
      // Set theme based on telegram theme
      document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#0b0c10');
      document.documentElement.style.setProperty('--text-main', tg.themeParams.text_color || '#f0f2f5');
    }

    // Check mandatory subscriptions first
    checkSubscription();

    // Fetch channels and plans
    fetch(`${API_URL}/channels`)
      .then(res => res.json())
      .then(data => {
        setChannels(data);
        if (data.length > 0 && data[0].plans.length > 0) {
          setSelectedChannel(data[0].id);
          setSelectedPlan(data[0].plans[0].id);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });

    // Fetch public settings for card number and rub rate
    fetch(`${API_URL}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.cardNumber) setCardNumber(data.cardNumber);
        if (data.cardHolder) setCardHolder(data.cardHolder);
      })
      .catch(err => console.error(err));
  }, []);

  const [timeLeft, setTimeLeft] = useState<number>(180);

  useEffect(() => {
    if (!activePayment) return;

    const createdAtTime = new Date(activePayment.createdAt).getTime();
    const expiresAtTime = createdAtTime + 3 * 60 * 1000; // 3 minutes in ms

    const updateTimer = () => {
      const now = Date.now();
      const difference = Math.max(0, Math.floor((expiresAtTime - now) / 1000));
      setTimeLeft(difference);
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => clearInterval(intervalId);
  }, [activePayment]);


  const handlePay = async () => {
    if (!selectedChannel || !selectedPlan || paying) return;
    
    setPaying(true);
    
    try {
      const userId = tg?.initDataUnsafe?.user?.id;
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!userId && !isDev) {
        alert("Xatolik: Iltimos, sahifani faqat Telegram ilovasi orqali oching!");
        return;
      }
      const finalUserId = userId || 'dummy_user';

      const res = await fetch(`${API_URL}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel, planId: selectedPlan, userId: finalUserId })
      });
      
      const data = await res.json();
      
      if (data.adminBypass) {
        alert("Siz adminsiz! Obuna tekinga faollashtirildi.");
        window.location.reload();
        return;
      }

      if (data.payment) {
        setActivePayment(data.payment);
      } else {
        alert("Xatolik: To'lov ma'lumotlarini olishning imkoni bo'lmadi.");
      }
    } catch (err) {
      console.error(err);
      alert("Xatolik yuz berdi. Qaytadan urinib ko'ring.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  // Show subscription required screen if not subscribed
  if (!subCheckLoading && !subOk && missingChannels.length > 0) {
    return (
      <>
        <div className="aurora-bg"></div>
        <div style={{ 
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '20px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Obuna talab qilinadi</h2>
          <p style={{ fontSize: '14px', opacity: 0.7, marginBottom: '24px' }}>
            Botdan foydalanish uchun quyidagi kanal(lar)ga obuna bo'lishingiz shart:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '300px', marginBottom: '24px' }}>
            {missingChannels.map((ch: any) => (
              <a
                key={ch.id}
                href={ch.inviteLink || `https://t.me/${ch.channelId.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="neon-btn"
                style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}
              >
                📢 {ch.title}
              </a>
            ))}
          </div>
          <button 
            className="neon-btn" 
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', width: '100%', maxWidth: '300px' }}
            onClick={() => {
              setSubCheckLoading(true);
              checkSubscription();
            }}
          >
            ✅ Tekshirish
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="aurora-bg"></div>
      <header>
        <div className="logo-text">DIORA VIP</div>
        <div className="header-controls">
          <div className="icon-btn">✨</div>
          {tg?.initDataUnsafe?.user?.photo_url ? (
            <img src={tg.initDataUnsafe.user.photo_url} alt="Profile" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }} />
          ) : (
            <div className="icon-btn">{tg?.initDataUnsafe?.user?.first_name?.charAt(0) || 'U'}</div>
          )}
        </div>
      </header>

      <div className="title-container">
        <h1 className="gradient-title">Premium Obuna</h1>
        <p className="subtitle">Yopiq guruhlar va maxsus materiallarga kirish</p>
      </div>

      <main>
        {activePayment ? (
          <div className="cyber-card" style={{ padding: '20px', textAlign: 'center' }}>
            <h2 className="gradient-title" style={{ fontSize: '22px', marginBottom: '15px' }}>To'lov qilish</h2>
            <div style={{ 
              background: 'linear-gradient(90deg, rgba(255, 170, 0, 0.1), rgba(255, 50, 50, 0.05))', 
              borderLeft: '4px solid #ffaa00', 
              padding: '14px 18px', 
              borderRadius: '8px', 
              marginBottom: '20px',
              textAlign: 'left',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}>
              <div style={{ color: '#ffaa00', marginTop: '2px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                <strong style={{ color: '#ffaa00', display: 'block', marginBottom: '4px' }}>Diqqat!</strong>
                Iltimos, faqat ekranda ko'rsatilgan <b>aniq summani</b> o'tkazing. 1 so'm farq qilsa ham to'lov avtomat tasdiqlanmaydi!
              </div>
            </div>
            
            <div 
              onClick={handleCopy}
              style={{ 
                background: 'linear-gradient(135deg, #191b2d 0%, #251636 50%, #111325 100%)', 
                border: '1px solid rgba(255, 255, 255, 0.12)', 
                padding: '20px 22px', 
                borderRadius: '18px', 
                marginBottom: '20px',
                position: 'relative',
                boxShadow: '0 15px 35px -10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              {/* Card Ambient Glow Highlights */}
              <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '130px', height: '130px', background: 'var(--accent-cyan)', filter: 'blur(55px)', opacity: 0.2, pointerEvents: 'none' }}></div>
              <div style={{ position: 'absolute', bottom: '-40px', left: '-40px', width: '130px', height: '130px', background: 'var(--accent-purple)', filter: 'blur(55px)', opacity: 0.25, pointerEvents: 'none' }}></div>
              
              {/* Subtle Card Background Pattern */}
              <div style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.03) 0%, transparent 60%)',
                pointerEvents: 'none'
              }}></div>

              {/* Card Header: Label & Copy Button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
                  O'tkazma uchun karta
                </div>

                <div 
                  style={{ 
                    background: copied ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255,255,255,0.08)', 
                    border: copied ? '1px solid rgba(0, 255, 102, 0.4)' : '1px solid rgba(255,255,255,0.15)',
                    padding: '5px 12px', 
                    borderRadius: '20px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    fontSize: '12px', 
                    color: copied ? '#00ff66' : '#fff', 
                    transition: 'all 0.2s ease',
                    fontWeight: '600',
                    backdropFilter: 'blur(10px)',
                    boxShadow: copied ? '0 0 12px rgba(0,255,102,0.3)' : 'none'
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Nusxa olindi!' : 'Nusxalash'}
                </div>
              </div>

              {/* Metallic Chip & Contactless Icon */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', position: 'relative', zIndex: 1 }}>
                {/* Metallic Gold Chip SVG */}
                <div style={{ 
                  width: '38px', 
                  height: '28px', 
                  borderRadius: '6px', 
                  background: 'linear-gradient(135deg, #e6c875 0%, #b8860b 50%, #ffd700 100%)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 2px 4px rgba(0,0,0,0.3)',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <div style={{ position: 'absolute', top: '35%', left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.3)' }}></div>
                  <div style={{ position: 'absolute', top: '65%', left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.3)' }}></div>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: '1px', background: 'rgba(0,0,0,0.3)' }}></div>
                </div>

                {/* Contactless Waves Icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
                  <path d="M8.5 14.5A5 5 0 0 1 8.5 9.5" />
                  <path d="M12 17A9 9 0 0 0 12 7" />
                  <path d="M15.5 19.5A13 13 0 0 0 15.5 4.5" />
                </svg>
              </div>

              {/* Card Number Line (Nowrap, Responsive Font Size) */}
              <div style={{ 
                fontSize: 'clamp(15px, 4.8vw, 21px)', 
                fontWeight: '700', 
                letterSpacing: '1.5px', 
                userSelect: 'all', 
                color: '#ffffff',
                fontFamily: "'Courier New', Courier, monospace, sans-serif",
                textAlign: 'left',
                textShadow: '0 2px 8px rgba(0,0,0,0.7)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                position: 'relative',
                zIndex: 1,
                marginBottom: cardHolder ? '12px' : '4px'
              }}>
                {cardNumber ? cardNumber.replace(/(\d{4})/g, '$1 ').trim() : "Admin karta kiritmagan!"}
              </div>

              {/* Card Holder Name */}
              {cardHolder && (
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: '600',
                  color: 'rgba(255,255,255,0.75)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '1.5px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  position: 'relative',
                  zIndex: 1
                }}>
                  <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  {cardHolder}
                </div>
              )}
            </div>

            <div style={{ background: 'rgba(176, 38, 255, 0.1)', border: '1px solid var(--accent)', padding: '15px', borderRadius: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--accent)' }}>To'lanadigan summa:</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', userSelect: 'all', textShadow: '0 0 10px rgba(176, 38, 255, 0.5)' }}>
                {activePayment.amount.toLocaleString('ru-RU')} UZS
              </div>
            </div>

            {/* Quick Payment Apps */}
            <div style={{ 
              marginBottom: '20px', 
              background: 'rgba(255, 255, 255, 0.03)', 
              border: '1px solid rgba(255, 255, 255, 0.08)', 
              borderRadius: '14px', 
              padding: '14px' 
            }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)', marginBottom: '10px', textAlign: 'center', fontWeight: '600' }}>
                ⚡ Ilova orqali 1 bosishda to'lash:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => openPaymentApp('click')}
                  style={{
                    background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    padding: '10px 4px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                    transition: 'transform 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>🟢</span>
                  Click
                </button>

                <button
                  type="button"
                  onClick={() => openPaymentApp('payme')}
                  style={{
                    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    padding: '10px 4px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 4px 12px rgba(13, 148, 136, 0.25)',
                    transition: 'transform 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>🔵</span>
                  Payme
                </button>

                <button
                  type="button"
                  onClick={() => openPaymentApp('uzum')}
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    padding: '10px 4px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)',
                    transition: 'transform 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>🟣</span>
                  Uzum
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
                Tugmani bossangiz, karta nusxalanadi va ilova ochiladi
              </div>
            </div>

            {/* Countdown Timer */}
            <div style={{ 
              background: timeLeft > 30 ? 'rgba(0, 240, 255, 0.05)' : 'rgba(255, 0, 85, 0.05)', 
              border: `1px dashed ${timeLeft > 30 ? 'rgba(0, 240, 255, 0.3)' : 'rgba(255, 0, 85, 0.3)'}`, 
              padding: '12px 16px', 
              borderRadius: '12px', 
              marginBottom: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: timeLeft > 30 ? 'inset 0 0 10px rgba(0, 240, 255, 0.05)' : '0 0 15px rgba(255, 0, 85, 0.1), inset 0 0 10px rgba(255, 0, 85, 0.05)',
              transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>To'lov tugash muddati:</span>
              <span style={{ 
                fontSize: '18px', 
                fontWeight: 'bold', 
                color: timeLeft > 30 ? 'var(--accent-cyan)' : 'var(--accent-red)',
                textShadow: timeLeft > 30 ? '0 0 10px rgba(0, 240, 255, 0.4)' : '0 0 10px rgba(255, 0, 85, 0.4)',
                fontFamily: 'monospace'
              }}>
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {timeLeft === 0 && (
              <div style={{ color: 'var(--accent-red)', fontSize: '13px', fontWeight: '500', marginBottom: '15px', textShadow: '0 0 10px rgba(255, 0, 85, 0.2)' }}>
                ⚠️ To'lov muddati tugadi. Bu summa va qo'shilgan raqam boshqa foydalanuvchilarga berildi. Iltimos, "Ortga qaytish" tugmasini bosib qaytadan urinib ko'ring.
              </div>
            )}

            <button 
              className="neon-btn" 
              disabled={timeLeft === 0}
              onClick={() => {
                if (tg) {
                  tg.showAlert("To'lov qilganingizdan so'ng bot sizga avtomatik ravishda yopiq kanal havolasini yuboradi. Kuting...");
                  tg.close();
                } else {
                  alert("To'lovingiz tekshirilmoqda. Botga qayting.");
                }
              }}
            >
              {timeLeft === 0 ? "Vaqt tugadi" : "Men to'lov qildim"}
            </button>
            <button 
              style={{ 
                marginTop: '15px', 
                background: 'rgba(255, 255, 255, 0.1)', 
                border: '1px solid rgba(255, 255, 255, 0.2)', 
                color: '#fff', 
                padding: '14px', 
                borderRadius: '12px', 
                cursor: 'pointer', 
                width: '100%', 
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
              }}
              onClick={() => { setActivePayment(null); setComplaintSent(false); }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
              Orqaga qaytish
            </button>

            {/* Complaint Button */}
            <button
              style={{
                marginTop: '12px',
                background: complaintSent ? 'rgba(0, 255, 102, 0.08)' : 'rgba(255, 0, 85, 0.06)',
                border: complaintSent ? '1px solid rgba(0, 255, 102, 0.25)' : '1px solid rgba(255, 0, 85, 0.2)',
                color: complaintSent ? 'var(--accent-green)' : 'var(--accent-red)',
                padding: '10px 16px',
                borderRadius: '10px',
                cursor: complaintSent || complaintLoading ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: complaintSent ? 0.7 : 1,
                transition: 'all 0.3s ease',
                width: '100%',
              }}
              disabled={complaintSent || complaintLoading}
              onClick={async () => {
                setComplaintLoading(true);
                try {
                  const userId = tg?.initDataUnsafe?.user?.id || 'unknown';
                  const res = await fetch(`${API_URL}/complaint`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId: String(userId),
                      paymentId: activePayment.id,
                      amount: activePayment.amount
                    })
                  });
                  if (res.ok) {
                    setComplaintSent(true);
                  } else {
                    const data = await res.json();
                    if (res.status === 429) {
                      setComplaintSent(true);
                    } else {
                      alert(data.error || "Xatolik yuz berdi");
                    }
                  }
                } catch {
                  alert("Tarmoq xatoligi. Qaytadan urinib ko'ring.");
                } finally {
                  setComplaintLoading(false);
                }
              }}
            >
              {complaintSent ? (
                <><CheckCircle2 size={14} /> Shikoyat yuborildi</>  
              ) : complaintLoading ? (
                <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></div> Yuborilmoqda...</>
              ) : (
                <><AlertTriangle size={14} /> To'lov tushmadimi? Shikoyat qilish</>  
              )}
            </button>
          </div>
        ) : (
          <>
            {channels.length === 0 ? (
              <div className="cyber-card" style={{ textAlign: 'center' }}>
                <p>Hozircha obunalar mavjud emas.</p>
              </div>
            ) : (
              <div className="channels">
                {channels.map((channel) => (
                  <div key={channel.id} className="cyber-card">
                    <div className="channel-header">
                      <div className="glass-icon" style={{ overflow: 'hidden', padding: channel.image ? 0 : undefined }}>
                        {channel.image ? (
                          <img src={channel.image} alt={channel.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <Crown size={28} color="#fff" />
                        )}
                      </div>
                      <div className="channel-info" style={{ flex: 1 }}>
                        <h2 style={{ color: '#fff' }}>{channel.title}</h2>
                        <p><Lock size={12} color="var(--text-muted)" /> Yopiq hamjamiyat</p>
                      </div>
                      <div className="icon-btn" style={{ width: 32, height: 32 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                      </div>
                    </div>

                    <div className="plans">
                      {channel.plans.map((plan) => (
                        <div key={plan.id} style={{ display: 'flex', flexDirection: 'column' }}>
                          <div 
                            className={`plan-item ${selectedPlan === plan.id ? 'selected' : 'unselected'}`}
                            style={{ cursor: 'pointer', WebkitTapHighlightColor: 'transparent', width: '100%', display: 'flex', userSelect: 'none' }}
                            onClick={() => {
                              if (selectedPlan === plan.id) {
                                setShowWarningModal(true);
                              } else {
                                setSelectedPlan(plan.id);
                                setSelectedChannel(channel.id);
                              }
                            }}
                          >
                            <div 
                              style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedPlan === plan.id) setShowWarningModal(true);
                                else { setSelectedPlan(plan.id); setSelectedChannel(channel.id); }
                              }}
                            >
                              <div className="plan-name">{plan.name}</div>
                              <div className="plan-desc">{plan.description}</div>
                            </div>
                            <div 
                              className="plan-price" 
                              style={{ display: 'flex', alignItems: 'center' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedPlan === plan.id) setShowWarningModal(true);
                                else { setSelectedPlan(plan.id); setSelectedChannel(channel.id); }
                              }}
                            >
                              <div>{plan.price.toLocaleString('ru-RU')} UZS</div>
                              {selectedPlan === plan.id && (
                                <CheckCircle2 size={20} color="#00ff66" style={{ marginLeft: 4, filter: 'drop-shadow(0 0 5px #00ff66)' }} />
                              )}
                            </div>
                          </div>
                          {selectedPlan === plan.id && (
                            <button 
                              className="neon-btn" 
                              disabled={paying}
                              onClick={() => setShowWarningModal(true)}
                              style={{ marginTop: '8px', marginBottom: '4px', padding: '12px', fontSize: '14px' }}
                            >
                              {paying ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div> : "Obunani Faollashtirish"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </>
        )}
      </main>

      <div className="tag-bottom">
        <div className="pill-tag">@Diora_vip_bot</div>
      </div>
      
      {/* Warning Modal */}
      {showWarningModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(5px)' }}>
          <div style={{ background: '#1c1c1e', padding: '24px', borderRadius: '20px', maxWidth: '350px', width: '100%', textAlign: 'center', border: '1px solid rgba(255,59,48,0.5)', boxShadow: '0 0 40px rgba(255,59,48,0.2)' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(255,59,48,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', border: '2px dashed rgba(255,59,48,0.5)' }}>
              <AlertTriangle size={32} color="#ff3b30" />
            </div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '20px', color: '#ff3b30', textTransform: 'uppercase', letterSpacing: '1px' }}>Diqqat!</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '15px', color: '#ddd', lineHeight: '1.6' }}>
              Keyingi sahifada sizga <b>TIYIN-TIYINIGACHA ANIQ</b> summa beriladi.<br/><br/>
              Siz <span style={{color: '#ff3b30', fontWeight: 'bold'}}>AYNAN</span> o'sha summani o'tkazishingiz shart, 1 tiyin ham farq qilmasligi kerak!<br/><br/>
              Aks holda to'lov <b>QABUL QILINMAYDI</b> va pulingiz kuyadi!
            </p>
            <button 
              className="neon-btn" 
              style={{ width: '100%', background: '#ff3b30', color: 'white', border: 'none', boxShadow: '0 0 15px rgba(255,59,48,0.4)', fontWeight: 'bold', fontSize: '16px', padding: '14px' }}
              onClick={() => {
                setShowWarningModal(false);
                handlePay();
              }}
              disabled={paying}
            >
              {paying ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: '#fff', borderTopColor: 'transparent' }}></div> : "Tushundim"}
            </button>
            <button 
              style={{ width: '100%', background: 'transparent', border: 'none', color: '#888', marginTop: '16px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
              onClick={() => setShowWarningModal(false)}
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default UserView;
