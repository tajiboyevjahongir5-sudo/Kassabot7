import { useState, useEffect } from 'react';
import { Crown, Lock, CheckCircle2, AlertTriangle, Copy, Check, Radio, Video } from 'lucide-react';
import VideoChat from './VideoChat';
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
  const urlParams = new URLSearchParams(window.location.search);
  const initTab = urlParams.get('tab') === 'videochat' || urlParams.get('startapp') === 'videochat' ? 'videochat' : 'subscription';
  const [currentTab, setCurrentTab] = useState<'subscription' | 'videochat'>(initTab);
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [activePayment, setActivePayment] = useState<any>(null);
  const [cardNumber, setCardNumber] = useState<string>('');
  const [cardHolder, setCardHolder] = useState<string>('');
  const [clickP2pUrl, setClickP2pUrl] = useState<string>('https://my.click.uz/clickp2p/C06ECB532D9343697037D7B7ABE7375562668EE6FB8327DC05EDD96B6C4E4445');
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

  const openPaymentApp = () => {
    const amount = activePayment?.amount || 0;
    const cleanCard = cardNumber.replace(/\s+/g, '');

    // 1. To'lanadigan aniq summani avtomatik nusxalash (Click P2P kartani o'zi tanlaydi, summa buferda tayyor turadi)
    try {
      navigator.clipboard.writeText(String(amount));
    } catch (e) {
      if (cleanCard) navigator.clipboard.writeText(cleanCard);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);

    if (tg && tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('medium');
    }

    // 2. Click P2P havolasi (kartani avtomat tanlab ochadi)
    const baseUrl = clickP2pUrl || 'https://my.click.uz/clickp2p/C06ECB532D9343697037D7B7ABE7375562668EE6FB8327DC05EDD96B6C4E4445';
    const sep = baseUrl.includes('?') ? '&' : '?';
    const finalClickUrl = `${baseUrl}${sep}amount=${amount}&sum=${amount}&summa=${amount}`;

    if (tg && typeof tg.openLink === 'function') {
      tg.openLink(finalClickUrl);
    } else {
      window.open(finalClickUrl, '_blank');
    }
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
        if (data.clickP2pUrl) setClickP2pUrl(data.clickP2pUrl);
      })
      .catch(err => console.error(err));

    // Poll live stream status every 10 seconds
    const checkLive = async () => {
      try {
        const res = await fetch(`${API_URL}/live/status`);
        if (res.ok) {
          const data = await res.json();
          setIsLiveActive(Boolean(data.active));
        }
      } catch {}
    };
    checkLive();
    const liveInterval = setInterval(checkLive, 10000);

    return () => clearInterval(liveInterval);
  }, []);

  const [timeLeft, setTimeLeft] = useState<number>(1800);

  useEffect(() => {
    if (!activePayment) return;

    const createdAtTime = new Date(activePayment.createdAt).getTime();
    const expiresAtTime = createdAtTime + 30 * 60 * 1000; // 30 minutes in ms

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - var(--app-safe-top, 110px))' }}>
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
          minHeight: 'calc(100vh - var(--app-safe-top, 110px))', padding: '20px', textAlign: 'center'
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
      <header style={{ marginBottom: '14px' }}>
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

      {/* Navigation Tabs: VIP Obuna & VIDEOCHAT */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'rgba(255, 255, 255, 0.05)',
        padding: '4px',
        borderRadius: '16px',
        marginBottom: '20px',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <button
          type="button"
          onClick={() => setCurrentTab('subscription')}
          style={{
            padding: '10px 14px',
            borderRadius: '12px',
            border: 'none',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: currentTab === 'subscription' ? 'linear-gradient(135deg, #a855f7, #6366f1)' : 'transparent',
            color: currentTab === 'subscription' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
            boxShadow: currentTab === 'subscription' ? '0 4px 15px rgba(168, 85, 247, 0.4)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          <Crown size={15} /> VIP Obuna
        </button>

        <button
          type="button"
          onClick={() => setCurrentTab('videochat')}
          style={{
            padding: '10px 14px',
            borderRadius: '12px',
            border: 'none',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: currentTab === 'videochat' ? 'linear-gradient(135deg, #ef4444, #f43f5e)' : 'transparent',
            color: currentTab === 'videochat' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
            boxShadow: currentTab === 'videochat' ? '0 4px 15px rgba(239, 68, 68, 0.4)' : 'none',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
        >
          {isLiveActive ? (
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: '#22c55e', 
              boxShadow: '0 0 8px #22c55e',
              display: 'inline-block'
            }} />
          ) : (
            <Radio size={15} />
          )}
          <span>VIDEOCHAT</span>
          {isLiveActive && (
            <span style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '6px',
              background: '#ef4444',
              color: '#fff',
              fontWeight: '800'
            }}>LIVE</span>
          )}
        </button>
      </div>

      <main>
        {currentTab === 'videochat' ? (
          <VideoChat
            userId={tg?.initDataUnsafe?.user?.id?.toString() || new URLSearchParams(window.location.search).get('userId') || ''}
            userName={tg?.initDataUnsafe?.user?.first_name || new URLSearchParams(window.location.search).get('userName') || 'Foydalanuvchi'}
            onBack={() => setCurrentTab('subscription')}
          />
        ) : activePayment ? (
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

            {/* Quick Click Payment Button */}
            <div style={{ 
              marginBottom: '20px', 
              background: 'linear-gradient(180deg, rgba(0, 115, 255, 0.08) 0%, rgba(0, 115, 255, 0.02) 100%)', 
              border: '1px solid rgba(0, 140, 255, 0.25)', 
              borderRadius: '16px', 
              padding: '16px',
              boxShadow: '0 8px 24px -6px rgba(0, 100, 255, 0.15)'
            }}>
              <button
                type="button"
                onClick={openPaymentApp}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #0056e0 0%, #0076ff 50%, #00b4d8 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  color: '#fff',
                  padding: '14px 18px',
                  borderRadius: '14px',
                  fontWeight: '700',
                  fontSize: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  boxShadow: '0 8px 25px -4px rgba(0, 115, 255, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <div style={{
                  background: '#ffffff',
                  borderRadius: '8px',
                  padding: '5px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)'
                }}>
                  <svg viewBox="0 0 21333.4 5394.4" style={{ height: '18px', width: 'auto', display: 'block' }}>
                    <path fill="#0065FF" d="M5350.2 2718.41c0,1029.91 -1646.14,2676.08 -2676.08,2676.08 -1029.94,0 -2676.1,-1646.17 -2676.1,-2676.08 0,-1029.92 1646.16,-2676.13 2676.1,-2676.13 1029.94,0 2676.08,1646.21 2676.08,2676.13zm-1605.66 0c0,411.96 -658.48,1070.42 -1070.42,1070.42 -411.99,0 -1070.45,-658.46 -1070.45,-1070.42 0,-411.96 658.49,-1070.45 1070.45,-1070.45 411.94,0 1070.42,658.49 1070.42,1070.45z"/>
                    <path fill="#192024" d="M8264.48 5394.14c998.68,0 1624.56,-625.88 1814.45,-1448.73l-1097.11 0c-133.6,281.3 -344.59,492.29 -717.34,492.29 -450.1,0 -780.62,-323.49 -780.62,-879.1 0,-555.57 330.52,-879.1 780.62,-879.1 372.75,0 583.74,210.98 717.34,492.32l1097.11 0c-189.89,-822.84 -815.77,-1448.77 -1814.45,-1448.77 -1068.99,0 -1849.61,815.82 -1849.61,1835.55 0,1019.77 780.62,1835.54 1849.61,1835.54zm2188.96 -77.34l1061.96 0 0 -5274.56 -1061.96 0 0 5274.56zm2224.12 -3994.62c372.74,0 668.11,-295.37 668.11,-661.08 0,-365.68 -295.37,-661.05 -668.11,-661.05 -358.65,0 -661.09,295.37 -661.09,661.05 0,365.71 302.44,661.08 661.09,661.08zm-527.45 3994.62l1061.96 0 0 -3516.36 -1061.96 0 0 3516.36zm3335.3 77.34c998.67,0 1624.56,-625.88 1814.45,-1448.73l-1097.12 0c-133.6,281.3 -344.58,492.29 -717.33,492.29 -450.1,0 -780.62,-323.49 -780.62,-879.1 0,-555.57 330.52,-879.1 780.62,-879.1 372.75,0 583.73,210.98 717.33,492.32l1097.12 0c-189.89,-822.84 -815.78,-1448.77 -1814.45,-1448.77 -1068.99,0 -1849.61,815.82 -1849.61,1835.55 0,1019.77 780.62,1835.54 1849.61,1835.54zm4558.97 -77.34l1287.01 0 -1603.46 -1926.96 1294.03 -1589.4 -1258.88 0 -1026.76 1258.84 0 -3017.04 -1061.96 0 0 5274.56 1061.96 0 0 -1568.31 1308.06 1568.31z"/>
                  </svg>
                </div>
                <span style={{ letterSpacing: '0.2px' }}>orqali to'lash</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
              <div style={{ 
                fontSize: '11.5px', 
                color: 'rgba(255, 255, 255, 0.75)', 
                marginTop: '10px', 
                textAlign: 'center',
                lineHeight: '1.4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}>
                <span style={{ color: '#38bdf8', fontSize: '13px' }}>⚡</span>
                <span>Bosilganda Click ochiladi va summa nusxalanadi</span>
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
            {/* ========================================= */}
            {/* ASOSIY SAHIFA: VIDEOCHAT BO'LIMI KARTASI */}
            {/* ========================================= */}
            <div 
              onClick={() => setCurrentTab('videochat')}
              className="cyber-card" 
              style={{
                padding: '20px',
                marginBottom: '22px',
                cursor: 'pointer',
                border: isLiveActive ? '1px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.35)',
                background: isLiveActive 
                  ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.22) 0%, rgba(20, 24, 38, 0.95) 100%)' 
                  : 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(20, 24, 38, 0.9) 100%)',
                boxShadow: isLiveActive ? '0 0 30px rgba(239, 68, 68, 0.4)' : '0 10px 30px rgba(0, 0, 0, 0.4)',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '18px'
              }}
            >
              {/* Glowing Background Accent */}
              <div style={{
                position: 'absolute',
                top: '-40px',
                right: '-40px',
                width: '130px',
                height: '130px',
                background: isLiveActive ? '#ef4444' : '#f43f5e',
                filter: 'blur(50px)',
                opacity: 0.35,
                pointerEvents: 'none'
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: isLiveActive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(244, 63, 94, 0.15)',
                    border: isLiveActive ? '1px solid #ef4444' : '1px solid rgba(244, 63, 94, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Video size={22} color={isLiveActive ? '#ef4444' : '#f43f5e'} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#fff', letterSpacing: '0.3px' }}>
                      VIDEOCHAT
                    </h3>
                    <span style={{ fontSize: '11.5px', color: 'rgba(255, 255, 255, 0.65)' }}>
                      Jonli efir & Video muloqot
                    </span>
                  </div>
                </div>

                {isLiveActive ? (
                  <span style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 0 12px #ef4444'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                    🔴 JONLI EFIR
                  </span>
                ) : (
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    fontSize: '11px',
                    fontWeight: '600'
                  }}>
                    ⚪ Efir boshlanmagan
                  </span>
                )}
              </div>

              <p style={{ fontSize: '12.5px', color: 'rgba(255, 255, 255, 0.8)', margin: '0 0 14px 0', lineHeight: '1.45' }}>
                {isLiveActive 
                  ? "🔴 Jonli efir boshlangan! Kamera tasvirini to'liq ekranda ko'rish va fikr qoldirish uchun kiring."
                  : "Efir boshlanganda xabardor bo'lish uchun bildirishnomani yoqing yoki kamerangizni yoqib efir boshlang."}
              </p>

              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: '14px',
                  border: 'none',
                  fontWeight: '800',
                  fontSize: '14px',
                  cursor: 'pointer',
                  background: isLiveActive 
                    ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' 
                    : 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: isLiveActive ? '0 6px 20px rgba(239, 68, 68, 0.45)' : '0 6px 20px rgba(244, 63, 94, 0.35)'
                }}
              >
                <Video size={17} />
                <span>VIDEOCHAT BO'LIMIGA O'TISH ➜</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Crown size={18} color="#eab308" />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#fff' }}>
                VIP Hamjamiyat Kanallari
              </h3>
            </div>

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
