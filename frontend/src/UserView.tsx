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
      <header>
        <h1>Premium Obuna</h1>
        <p>Yopiq guruhlar va maxsus materiallarga kirish</p>
      </header>

      <main>
        {activePayment ? (
          <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '15px' }}>To'lov qilish</h2>
            <p style={{ marginBottom: '15px', fontSize: '14px', opacity: 0.9 }}>
              Iltimos, quyidagi karta raqamiga <b>aynan</b> ko'rsatilgan summani o'tkazing. Agar 1 tiyin kam yoki ko'p bo'lsa tizim avtomat qabul qilmaydi!
            </p>
            
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '12px', marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', opacity: 0.6 }}>Karta raqami:</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '1px', userSelect: 'all' }}>
                {cardNumber || "Admin karta kiritmagan!"}
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid var(--accent)' }}>
              <div style={{ fontSize: '12px', opacity: 0.6 }}>To'lanadigan summa (UZS):</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent)', userSelect: 'all' }}>
                {activePayment.amount.toLocaleString('ru-RU')}
              </div>
            </div>

            <button 
              className="pay-btn" 
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
              <div className="card" style={{ textAlign: 'center' }}>
                <p>Hozircha obunalar mavjud emas.</p>
              </div>
            ) : (
              <div className="channels">
                {channels.map((channel) => (
                  <div key={channel.id} className="card">
                    <div className="channel-header">
                      <div className="channel-icon">
                        <Crown size={24} />
                      </div>
                      <div className="channel-info">
                        <h2>{channel.title}</h2>
                        <p><Lock size={12} style={{ display: 'inline', marginRight: 4 }} />Yopiq hamjamiyat</p>
                      </div>
                    </div>

                    <div className="plans">
                      {channel.plans.map((plan) => (
                        <div 
                          key={plan.id}
                          className={`plan-item ${selectedPlan === plan.id ? 'selected' : ''}`}
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
                              <CheckCircle2 size={18} color="var(--accent)" style={{ marginLeft: 8 }} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#111827', color: '#fff', fontSize: '14px', textTransform: 'uppercase' }}
                  placeholder="Promo-kod (ixtiyoriy)"
                  value={promoCode}
                  onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); }}
                />
                <button
                  type="button"
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
                  style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >Tekshir</button>
              </div>
              {promoStatus && <div style={{ fontSize: '13px', marginTop: '6px', color: promoStatus.startsWith('✅') ? '#10b981' : '#ef4444' }}>{promoStatus}</div>}
            </div>

            <button 
              className="pay-btn" 
              disabled={!selectedPlan || paying || channels.length === 0}
              onClick={handlePay}
            >
              {paying ? <div className="spinner"></div> : "Obunani Faollashtirish"}
            </button>
          </>
        )}
      </main>
    </>
  );
}

export default UserView;
