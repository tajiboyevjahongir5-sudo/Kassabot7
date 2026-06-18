import { useState, useEffect } from 'react';
import { Crown, Lock, CheckCircle2 } from 'lucide-react';
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
  const [activePayment, setActivePayment] = useState<any>(null);
  const [cardNumber, setCardNumber] = useState<string>('');
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<string | null>(null);

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

    // Fetch public settings for card number
    fetch(`${API_URL}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.cardNumber) setCardNumber(data.cardNumber);
      })
      .catch(err => console.error(err));
  }, []);

  const handlePay = async () => {
    if (!selectedChannel || !selectedPlan || paying) return;
    
    setPaying(true);
    
    try {
      const userId = tg?.initDataUnsafe?.user?.id || 'dummy_user';

      // Create or get pending payment
      const res = await fetch(`${API_URL}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel, planId: selectedPlan, userId, promoCode: promoCode || undefined })
      });
      
      const data = await res.json();
      
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
        <div className="logo-text">kassa bot</div>
        <div className="header-controls">
          <div className="icon-btn">✨</div>
          <div className="icon-btn">✕</div>
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
            <p style={{ marginBottom: '15px', fontSize: '14px', opacity: 0.9 }}>
              Iltimos, quyidagi karta raqamiga <b>aynan</b> ko'rsatilgan summani o'tkazing. Agar 1 tiyin kam yoki ko'p bo'lsa tizim avtomat qabul qilmaydi!
            </p>
            
            <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', padding: '15px', borderRadius: '12px', marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Karta raqami:</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px', userSelect: 'all', color: '#fff', marginTop: '4px' }}>
                {cardNumber || "Admin karta kiritmagan!"}
              </div>
            </div>

            <div style={{ background: 'rgba(176, 38, 255, 0.1)', border: '1px solid var(--accent)', padding: '15px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: 'var(--accent)' }}>To'lanadigan summa (UZS):</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', userSelect: 'all', textShadow: '0 0 10px rgba(176, 38, 255, 0.5)' }}>
                {activePayment.amount.toLocaleString('ru-RU')}
              </div>
            </div>

            <button 
              className="neon-btn" 
              onClick={() => {
                if (tg) {
                  tg.showAlert("To'lov qilganingizdan so'ng bot sizga avtomatik ravishda yopiq kanal havolasini yuboradi. Kuting...");
                  tg.close();
                } else {
                  alert("To'lovingiz tekshirilmoqda. Botga qayting.");
                }
              }}
            >
              Men to'lov qildim
            </button>
            <button 
              style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--text-main)', opacity: 0.6, cursor: 'pointer' }}
              onClick={() => setActivePayment(null)}
            >
              Bekor qilish
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
                      <div className="glass-icon">
                        <Crown size={28} color="#fff" />
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
                        <div 
                          key={plan.id}
                          className={`plan-item ${selectedPlan === plan.id ? 'selected' : 'unselected'}`}
                          onClick={() => {
                            setSelectedPlan(plan.id);
                            setSelectedChannel(channel.id);
                          }}
                        >
                          <div>
                            <div className="plan-name">{plan.name}</div>
                            <div className="plan-desc">{plan.description}</div>
                          </div>
                          <div className="plan-price">
                            {plan.price.toLocaleString('ru-RU')} UZS
                            {selectedPlan === plan.id && (
                              <CheckCircle2 size={20} color="#00ff66" style={{ marginLeft: 4, filter: 'drop-shadow(0 0 5px #00ff66)' }} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="promo-container">
              <input
                className="cyber-input"
                placeholder="PROMO-KOD (IXTIYORIY)"
                value={promoCode}
                onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); }}
              />
              <button
                type="button"
                className="btn-small-glow"
                onClick={async () => {
                  if (!promoCode || !selectedPlan) return;
                  try {
                    const res = await fetch(`${API_URL}/validate-promo`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ code: promoCode, planId: selectedPlan })
                    });
                    const data = await res.json();
                    if (data.valid) {
                      setPromoStatus(`✅ ${data.discountType === 'percent' ? data.discountValue + '%' : data.discountValue.toLocaleString() + ' UZS'} chegirma! Yangi narx: ${data.discountedPrice.toLocaleString()} UZS`);
                    } else {
                      setPromoStatus('❌ Promo-kod noto\'g\'ri yoki muddati tugagan');
                    }
                  } catch { setPromoStatus('❌ Tekshirishda xatolik'); }
                }}
              >
                <CheckCircle2 size={16} /> Tekshir
              </button>
            </div>
            {promoStatus && <div style={{ fontSize: '13px', marginTop: '-14px', marginBottom: '20px', padding: '0 4px', color: promoStatus.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)', textShadow: '0 0 10px rgba(0,0,0,0.5)' }}>{promoStatus}</div>}

            <button 
              className="neon-btn" 
              disabled={!selectedPlan || paying || channels.length === 0}
              onClick={handlePay}
            >
              {paying ? <div className="spinner"></div> : "Obunani Faollashtirish"}
            </button>
          </>
        )}
      </main>

      <div className="tag-bottom">
        <div className="pill-tag">@KanalKassaBot</div>
      </div>
    </>
  );
}

export default UserView;
