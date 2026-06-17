import { useState, useEffect } from 'react';
import { Crown, Star, Lock, CheckCircle2 } from 'lucide-react';
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

function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  // You can set this to your local API URL or use production URL
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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
  }, []);

  const handlePay = async () => {
    if (!selectedChannel || !selectedPlan || paying) return;
    
    setPaying(true);
    
    try {
      // Get invoice link from backend
      const res = await fetch(`${API_URL}/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel, planId: selectedPlan })
      });
      
      const data = await res.json();
      
      if (data.invoiceLink && tg) {
        // Open Telegram Invoice
        tg.openInvoice(data.invoiceLink, (status: string) => {
          if (status === 'paid') {
            tg.showAlert("To'lovingiz qabul qilindi! Endi botga o'tib maxsus havolani oling.");
            tg.close();
          } else if (status === 'failed') {
            tg.showAlert("To'lov amalga oshmadi.");
          } else {
             // cancelled or pending
          }
        });
      } else {
        alert("Botdan to'lov ma'lumotlarini olishning imkoni bo'lmadi.");
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
                        {plan.price} 
                        {plan.priceType === 'STARS' ? <Star className="stars-icon" fill="currentColor" /> : 'UZS'}
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

        <button 
          className="pay-btn" 
          disabled={!selectedPlan || paying}
          onClick={handlePay}
        >
          {paying ? <div className="spinner"></div> : "Obunani Faollashtirish"}
        </button>
      </main>
    </>
  );
}

export default App;
