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

  // Use relative path by default so it works correctly on production domain
  const API_URL = import.meta.env.VITE_API_URL || '/api';

  useEffect(() => {
    // Initialize Telegram Web App
    if (tg) {
      tg.ready();
      tg.expand();
      // Set theme based on telegram theme
      document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#0b0c10');
      document.documentElement.style.setProperty('--text-main', tg.themeParams.text_color || '#f0f2f5');
    }

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
            
            <div style={{ 
              background: 'linear-gradient(135deg, #23253a 0%, #151623 100%)', 
              border: '1px solid rgba(255,255,255,0.05)', 
              padding: '24px', 
              borderRadius: '16px', 
              marginBottom: '20px',
              position: 'relative',
              boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)',
              overflow: 'hidden'
            }}>
              {/* Decorative elements */}
              <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px', background: 'var(--accent-cyan)', filter: 'blur(50px)', opacity: 0.15 }}></div>
              <div style={{ position: 'absolute', bottom: '-20px', left: '-20px', width: '100px', height: '100px', background: 'var(--accent-purple)', filter: 'blur(50px)', opacity: 0.15 }}></div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>O'tkazma uchun karta</div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div 
                    onClick={handleCopy}
                    style={{ 
                      background: copied ? 'rgba(0, 255, 102, 0.15)' : 'rgba(255,255,255,0.1)', 
                      border: copied ? '1px solid rgba(0, 255, 102, 0.3)' : '1px solid rgba(255,255,255,0.2)',
                      padding: '4px 10px', 
                      borderRadius: '8px', 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      fontSize: '12px', 
                      color: copied ? '#00ff66' : '#fff', 
                      transition: 'all 0.2s',
                      fontWeight: '500'
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Nusxa olindi' : 'Nusxalash'}
                  </div>
                  <div style={{ opacity: 0.5, display: 'flex', alignItems: 'center' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                  </div>
                </div>
              </div>

              <div style={{ 
                fontSize: '22px', 
                fontWeight: 'bold', 
                letterSpacing: '3px', 
                userSelect: 'all', 
                color: '#fff',
                fontFamily: 'monospace',
                textAlign: 'left',
                textShadow: '0 2px 5px rgba(0,0,0,0.5)',
                position: 'relative',
                zIndex: 1
              }}>
                {cardNumber ? cardNumber.replace(/(\d{4})/g, '$1 ').trim() : "Admin karta kiritmagan!"}
              </div>

              {cardHolder && (
                <div style={{ 
                  fontSize: '13px', 
                  color: 'rgba(255,255,255,0.7)', 
                  marginTop: '15px', 
                  textTransform: 'uppercase', 
                  letterSpacing: '2px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  position: 'relative',
                  zIndex: 1
                }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  {cardHolder}
                </div>
              )}
            </div>

            <div style={{ background: 'rgba(176, 38, 255, 0.1)', border: '1px solid var(--accent)', padding: '15px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: 'var(--accent)' }}>To'lanadigan summa:</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', userSelect: 'all', textShadow: '0 0 10px rgba(176, 38, 255, 0.5)' }}>
                {activePayment.amount.toLocaleString('ru-RU')} UZS
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
