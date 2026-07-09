import { useState, useEffect } from 'react';
import { Trash2, Plus, Users, Crown, CreditCard, Settings, Send, Save, Box, BarChart2, Clock, Upload, XCircle, Edit2 } from 'lucide-react';
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
  adminId: string;
  plans: Plan[];
}

const tg = (window as any).Telegram?.WebApp;
const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function AdminView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState({ totalUsers: 0, activeSubs: 0, totalChannels: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('payments'); // payments, channels, cards, users, broadcast, stats, settings

  // Settings
  const [settings, setSettings] = useState({ paymentChannelId: '' });
  const [savingSettings, setSavingSettings] = useState(false);

  // Broadcast
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastImageBase64, setBroadcastImageBase64] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);

  // Users, Payments, Revenue
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentFilter, setPaymentFilter] = useState('PENDING');
  const [revenue, setRevenue] = useState({ totalRevenue: 0, totalPayments: 0 });
  const [monthlyRevenue, setMonthlyRevenue] = useState<any[]>([]);
  
  // Cards
  const [cards, setCards] = useState<any[]>([]);
  const [newCardSlot, setNewCardSlot] = useState('');
  const [newCardNumber, setNewCardNumber] = useState('');
  const [newCardHolder, setNewCardHolder] = useState('');
  const [newCardBank, setNewCardBank] = useState('');

  // Mandatory Channels
  const [mandatoryChannels, setMandatoryChannels] = useState<any[]>([]);
  const [newMandatoryId, setNewMandatoryId] = useState('');
  const [newMandatoryTitle, setNewMandatoryTitle] = useState('');
  const [newMandatoryLink, setNewMandatoryLink] = useState('');
  
  // Add Channel
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelTitle, setNewChannelTitle] = useState('');
  const [newChannelImage, setNewChannelImage] = useState<string | null>(null);

  // Add Plan form
  const [activeChannelForPlan, setActiveChannelForPlan] = useState<string | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDesc, setNewPlanDesc] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanDuration, setNewPlanDuration] = useState('30');
  const [isLifetime, setIsLifetime] = useState(false);

  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-init-data': tg?.initData || ''
  };

  const fetchData = async () => {
    try {
      const [chRes, stRes, setRes, usrRes, payRes, revRes, cardsRes, mandRes] = await Promise.all([
        fetch(`${API_URL}/channels`),
        fetch(`${API_URL}/admin/stats`, { headers }),
        fetch(`${API_URL}/admin/settings`, { headers }),
        fetch(`${API_URL}/admin/users`, { headers }),
        fetch(`${API_URL}/admin/payments?status=${paymentFilter}`, { headers }),
        fetch(`${API_URL}/admin/revenue`, { headers }),
        fetch(`${API_URL}/cards`, { headers }),
        fetch(`${API_URL}/admin/mandatory-channels`, { headers })
      ]);
      if (chRes.ok) setChannels(await chRes.json());
      if (stRes.ok) setStats(await stRes.json());
      if (setRes.ok) setSettings(await setRes.json());
      if (usrRes.ok) setUsers(await usrRes.json());
      if (payRes.ok) setPayments(await payRes.json());
      if (revRes.ok) setRevenue(await revRes.json());
      if (cardsRes.ok) setCards(await cardsRes.json());
      if (mandRes.ok) setMandatoryChannels(await mandRes.json());

      // Fetch monthly revenue separately
      const monthlyRes = await fetch(`${API_URL}/admin/monthly-revenue`, { headers });
      if (monthlyRes.ok) setMonthlyRevenue(await monthlyRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [paymentFilter]);

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#0b0c10');
      document.documentElement.style.setProperty('--text-main', tg.themeParams.text_color || '#f0f2f5');
    }
    fetchData();
  }, []);

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelId || !newChannelTitle) return;
    
    try {
      const res = await fetch(`${API_URL}/admin/channels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: newChannelId, title: newChannelTitle, image: newChannelImage })
      });
      if (res.ok) {
        setNewChannelId('');
        setNewChannelTitle('');
        setNewChannelImage(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add channel');
      }
    } catch (err) {
      alert('Error adding channel');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('Haqiqatan ham bu kanalni o`chirmoqchimisiz?')) return;
    try {
      const res = await fetch(`${API_URL}/admin/channels/${id}`, { method: 'DELETE', headers });
      if (res.ok) fetchData();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error deleting channel');
      }
    } catch (err) {
      alert('Error deleting channel');
    }
  };

  const handleAddPlan = async (e: React.FormEvent, channelId: string) => {
    e.preventDefault();
    if (!newPlanName || !newPlanPrice || (!newPlanDuration && !isLifetime)) return;

    try {
      const res = await fetch(`${API_URL}/admin/channels/${channelId}/plans`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newPlanName,
          description: newPlanDesc,
          price: Number(newPlanPrice),
          duration: isLifetime ? 0 : Number(newPlanDuration)
        })
      });
      if (res.ok) {
        setActiveChannelForPlan(null);
        setNewPlanName('');
        setNewPlanDesc('');
        setNewPlanPrice('');
        setNewPlanDuration('30');
        setIsLifetime(false);
        fetchData();
      } else {
        alert('Failed to add plan');
      }
    } catch (err) {
      alert('Error adding plan');
    }
  };

  const handleDeletePlan = async (id: number) => {
    if (!confirm('Tarifni o`chirasizmi?')) return;
    try {
      const res = await fetch(`${API_URL}/admin/plans/${id}`, { method: 'DELETE', headers });
      if (res.ok) fetchData();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error deleting plan');
      }
    } catch (err) {
      alert('Error deleting plan');
    }
  };

  const compressImage = (file: File, callback: (base64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        callback(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) compressImage(file, setBroadcastImageBase64);
  };

  const handleChannelImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) compressImage(file, setNewChannelImage);
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText && !broadcastImageBase64) return;
    setBroadcasting(true);
    try {
      const res = await fetch(`${API_URL}/admin/broadcast`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: broadcastText, imageBase64: broadcastImageBase64 })
      });
      if (res.ok) {
        alert('Xabar yuborildi!');
        setBroadcastText('');
        setBroadcastImageBase64(null);
      } else {
        alert('Xatolik yuz berdi');
      }
    } catch (err) {
      alert('Xatolik yuz berdi');
    } finally {
      setBroadcasting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_URL}/admin/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(settings)
      });
      if (res.ok) alert('Sozlamalar saqlandi!');
      else alert('Xatolik yuz berdi');
    } catch (err) {
      alert('Xatolik');
    } finally {
      setSavingSettings(false);
    }
  };

  const handlePaymentAction = async (id: number, action: 'confirm' | 'reject') => {
    if (!confirm(`Haqiqatan ham bu to'lovni ${action === 'confirm' ? 'tasdiqlaysizmi' : 'bekor qilasizmi'}?`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/payments/${id}/${action}`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        alert("Bajarildi!");
        fetchData();
      } else {
        alert("Xatolik yuz berdi");
      }
    } catch (err) {
      alert("Xatolik yuz berdi");
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><div className="spinner"></div></div>;
  }

  return (
    <>
      <div className="aurora-bg"></div>
      <header>
        <div className="logo-text">kassa bot</div>
        <div className="header-controls">
          <div className="pill-tag" style={{ border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'rgba(0,240,255,0.1)', padding: '8px 16px' }}>Admin Panel</div>
          <div className="icon-btn">✨</div>
          {tg?.initDataUnsafe?.user?.photo_url ? (
            <img src={tg.initDataUnsafe.user.photo_url} alt="Profile" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }} />
          ) : (
            <div className="icon-btn">{tg?.initDataUnsafe?.user?.first_name?.charAt(0) || 'U'}</div>
          )}
        </div>
      </header>

      <div className="cyber-card" style={{ padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 className="gradient-title" style={{ fontSize: '20px', margin: 0 }}>Admin Panel</h2>
          <div style={{ background: 'rgba(0, 255, 102, 0.1)', color: 'var(--accent-green)', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', display: 'flex', alignItems: 'center', border: '1px solid rgba(0, 255, 102, 0.2)' }}>
            <div style={{ width: '6px', height: '6px', background: 'var(--accent-green)', borderRadius: '50%', marginRight: '6px', boxShadow: '0 0 5px var(--accent-green)' }}></div>
            Admin
          </div>
        </div>

      <div className="admin-tabs">
        <div className={`admin-tab-item ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
          <div className="admin-tab-icon"><CreditCard size={24} color={activeTab === 'payments' ? 'var(--accent-cyan)' : 'var(--accent)'} /></div>
          <div className="admin-tab-label">To'lovlar</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'broadcast' ? 'active' : ''}`} onClick={() => setActiveTab('broadcast')}>
          <div className="admin-tab-icon"><Send size={24} color={activeTab === 'broadcast' ? 'var(--accent-cyan)' : '#f59e0b'} /></div>
          <div className="admin-tab-label">Xabarnoma</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'cards' ? 'active' : ''}`} onClick={() => setActiveTab('cards')}>
          <div className="admin-tab-icon"><CreditCard size={24} color={activeTab === 'cards' ? 'var(--accent-cyan)' : '#8b5cf6'} /></div>
          <div className="admin-tab-label">Kartalar</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>
          <div className="admin-tab-icon"><Box size={24} color={activeTab === 'channels' ? 'var(--accent-cyan)' : '#eab308'} /></div>
          <div className="admin-tab-label">Kanal +</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          <div className="admin-tab-icon"><Users size={24} color={activeTab === 'users' ? 'var(--accent-cyan)' : '#10b981'} /></div>
          <div className="admin-tab-label">Foydalanuvchilar</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>
          <div className="admin-tab-icon"><BarChart2 size={24} color={activeTab === 'stats' ? 'var(--accent-cyan)' : '#a855f7'} /></div>
          <div className="admin-tab-label">Statistika</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <div className="admin-tab-icon"><Settings size={24} color={activeTab === 'settings' ? 'var(--accent-cyan)' : '#ef4444'} /></div>
          <div className="admin-tab-label">Sozlamalar</div>
        </div>
      </div>

      <main>
        {activeTab === 'stats' && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Statistika <span style={{ width: '60px', height: '2px', background: 'linear-gradient(90deg, var(--accent-cyan), transparent)' }}></span>
            </h2>
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div className="payment-card" style={{ padding: '20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Users size={28} style={{ color: 'var(--accent-cyan)', marginBottom: '8px', filter: 'drop-shadow(0 0 8px rgba(0, 240, 255, 0.5))' }} />
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>{stats.totalUsers}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Foydalanuvchilar</div>
              </div>
              <div className="payment-card" style={{ padding: '20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <CreditCard size={28} style={{ color: 'var(--accent-green)', marginBottom: '8px', filter: 'drop-shadow(0 0 8px rgba(0, 255, 102, 0.5))' }} />
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>{stats.activeSubs}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Faol Obunalar</div>
              </div>
              <div className="cyber-card" style={{ padding: '24px', textAlign: 'center', gridColumn: 'span 2', background: 'linear-gradient(135deg, rgba(0, 255, 102, 0.15) 0%, rgba(0, 240, 255, 0.15) 100%)', border: '1px solid rgba(0, 255, 102, 0.3)', boxShadow: '0 0 20px rgba(0, 255, 102, 0.1)' }}>
                <div style={{ fontSize: '14px', color: 'var(--accent-green)', marginBottom: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>💰 Jami Daromad</div>
                <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', textShadow: '0 0 15px rgba(0, 255, 102, 0.5)' }}>{revenue.totalRevenue.toLocaleString('ru-RU')} UZS</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>{revenue.totalPayments} ta tasdiqlangan to'lov</div>
              </div>
            </div>

            {/* Monthly Revenue Breakdown */}
            <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📅 Oylik daromad
            </h3>
            {monthlyRevenue.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                Hali tasdiqlangan to'lovlar yo'q
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {monthlyRevenue.map((m, i) => {
                  const maxRev = Math.max(...monthlyRevenue.map(x => x.revenue));
                  const pct = maxRev > 0 ? (m.revenue / maxRev) * 100 : 0;
                  return (
                    <div key={m.key} style={{ background: i === 0 ? 'rgba(0,255,102,0.07)' : 'rgba(255,255,255,0.03)', border: i === 0 ? '1px solid rgba(0,255,102,0.2)' : '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {i === 0 && <span style={{ fontSize: '10px', background: 'var(--accent-green)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: '800' }}>JORIY</span>}
                          <span style={{ fontWeight: '600', color: '#fff', fontSize: '14px' }}>{m.label}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '700', color: i === 0 ? '#00ff66' : '#fff', fontSize: '15px' }}>{m.revenue.toLocaleString('ru-RU')} UZS</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.count} ta to'lov</div>
                        </div>
                      </div>
                      <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: i === 0 ? 'linear-gradient(90deg, #00ff66, #00f0ff)' : 'linear-gradient(90deg, var(--accent), var(--accent-cyan))', borderRadius: '4px', transition: 'width 0.5s ease' }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'cards' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 className="gradient-title" style={{ fontSize: '24px', margin: 0, textShadow: 'none' }}>Karta va Limitlar</h2>
              <button 
                onClick={async () => {
                  if (!confirm("Haqiqatan ham keyingi kartaga o'tkazmoqchimisiz?")) return;
                  await fetch(`${API_URL}/admin/cards/rotate`, { method: 'POST', headers });
                  fetchData();
                }}
                className="btn-small-glow" 
                style={{ padding: '8px 12px', background: 'rgba(255, 0, 85, 0.1)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)' }}
              >
                Keyingisiga o'tish
              </button>
            </div>

            <div style={{ display: 'grid', gap: '16px', marginBottom: '32px' }}>
              {cards.map(card => (
                <div key={card.id} className={`credit-card-item ${card.isActive ? 'active-card' : ''}`}>
                  {/* Top row: slot + badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: '700', fontSize: '15px', color: card.isActive ? '#00ff66' : '#fff', letterSpacing: '0.5px', wordBreak: 'break-all' }}>
                      Slot {card.slot}: {card.cardNumber}
                    </span>
                    {card.isActive && <div style={{ flexShrink: 0, fontSize: '10px', background: 'var(--accent-green)', color: '#000', padding: '2px 7px', borderRadius: '5px', fontWeight: '800', boxShadow: '0 0 8px rgba(0,255,102,0.4)' }}>FAOL</div>}
                  </div>

                  {/* Bank info */}
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>{card.bankName} — {card.cardHolder}</div>

                  {/* Progress bar */}
                  <div className="progress-track" style={{ marginBottom: '6px' }}>
                    <div className="progress-fill" style={{ 
                      width: `${Math.min(100, (card.transferCount / card.maxTransfers) * 100)}%`, 
                      background: (card.transferCount >= card.maxTransfers) ? 'var(--accent-red)' : (card.isActive ? 'var(--accent-green)' : 'var(--accent-cyan)') 
                    }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                    <span>{card.transferCount} tushum</span>
                    <span>Limit: {card.maxTransfers}</span>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {!card.isActive && (
                      <button onClick={async () => {
                        await fetch(`${API_URL}/admin/cards/${card.id}/activate`, { method: 'POST', headers });
                        fetchData();
                      }} className="action-btn activate" style={{ flex: 1 }}>Faollashtirish</button>
                    )}
                    <button onClick={async () => {
                      if (!confirm("Limitni nolga tushirasizmi?")) return;
                      await fetch(`${API_URL}/admin/cards/${card.id}/reset`, { method: 'POST', headers });
                      fetchData();
                    }} className="action-btn reset" style={{ flex: 1 }}>⟳ Reset</button>
                    <button onClick={async () => {
                      if (!confirm("Kartani o'chirasizmi?")) return;
                      await fetch(`${API_URL}/admin/cards/${card.id}`, { method: 'DELETE', headers });
                      fetchData();
                    }} className="action-btn delete"><Trash2 size={15}/></button>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '4px', color: '#e0b3ff' }}>Yangi karta qo'shish</h3>
            {cards.length >= 10 && (
              <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,0,85,0.1)', border: '1px solid rgba(255,0,85,0.3)', fontSize: '13px', color: '#ff6b9d' }}>
                ⚠️ Maksimal 10 ta karta qo'shilgan. Yangi karta qo'shish uchun biron kartani o'chiring.
              </div>
            )}
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (cards.length >= 10) return alert('Maksimum 10 ta karta qo\'shish mumkin');
              try {
                const res = await fetch(`${API_URL}/admin/cards`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ slot: newCardSlot, cardNumber: newCardNumber, cardHolder: newCardHolder, bankName: newCardBank, maxTransfers: 40 })
                });
                const data = await res.json();
                if (res.ok) {
                  setNewCardSlot(''); setNewCardNumber(''); setNewCardHolder(''); setNewCardBank('');
                  fetchData();
                } else {
                  alert(data.error || 'Xatolik');
                }
              } catch { alert('Xatolik'); }
            }} style={{ 
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              background: 'rgba(20, 22, 35, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              opacity: cards.length >= 10 ? 0.5 : 1
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                <input className="cyber-input" placeholder="Slot (1-10)" value={newCardSlot} onChange={e => setNewCardSlot(e.target.value)} required type="number" min="1" max="10" disabled={cards.length >= 10} />
                <input className="cyber-input" placeholder="Karta raqami" value={newCardNumber} onChange={e => setNewCardNumber(e.target.value)} required disabled={cards.length >= 10} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input className="cyber-input" placeholder="Egasi (ism)" value={newCardHolder} onChange={e => setNewCardHolder(e.target.value)} disabled={cards.length >= 10} />
                <input className="cyber-input" placeholder="Bank nomi" value={newCardBank} onChange={e => setNewCardBank(e.target.value)} disabled={cards.length >= 10} />
              </div>
              <button type="submit" className="neon-btn" style={{ width: '100%', marginTop: '4px' }} disabled={cards.length >= 10}>Qo'shish</button>
            </form>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>Sozlamalar</h2>
            
            {/* SMS kanal settings */}
            <form onSubmit={handleSaveSettings} className="cyber-card" style={{ padding: '20px', marginBottom: '24px' }}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginBottom: '5px' }}>SMS Kanal ID (To'lovlarni tekshirish uchun)</label>
                <input 
                  className="cyber-input" 
                  style={{ width: '100%' }}
                  placeholder="-100..." 
                  value={settings.paymentChannelId || ''} 
                  onChange={e => setSettings({...settings, paymentChannelId: e.target.value})} 
                />
                <p style={{ fontSize: '11px', opacity: 0.6, marginTop: '5px' }}>Bot ushbu kanalda admin bo'lishi va kanalga kelgan to'lov haqidagi xabarlarni ko'ra olishi kerak.</p>
              </div>
              <button type="submit" className="neon-btn" disabled={savingSettings}>
                {savingSettings ? <div className="spinner"></div> : <><Save size={16} style={{ display: 'inline', marginRight: '5px' }} /> Saqlash</>}
              </button>
            </form>

            {/* Mandatory subscription channels */}
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#e0b3ff' }}>🔒 Majburiy Obuna Kanallari</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{mandatoryChannels.length}/10</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Bu kanallarga obuna bo'lmagan foydalanuvchilar botni ishlatа olmaydi.
            </p>

            {/* Existing mandatory channels list */}
            {mandatoryChannels.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                {mandatoryChannels.map((ch: any) => (
                  <div key={ch.id} className="credit-card-item" style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '2px' }}>{ch.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{ch.channelId}</div>
                      {ch.inviteLink && <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '2px' }}>{ch.inviteLink}</div>}
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`"${ch.title}" ni o'chirasizmi?`)) return;
                        const res = await fetch(`${API_URL}/admin/mandatory-channels/${ch.id}`, { method: 'DELETE', headers });
                        if (res.ok) fetchData();
                      }}
                      className="action-btn delete"
                    ><Trash2 size={15}/></button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new mandatory channel form */}
            {mandatoryChannels.length >= 10 ? (
              <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,0,85,0.1)', border: '1px solid rgba(255,0,85,0.3)', fontSize: '13px', color: '#ff6b9d' }}>
                ⚠️ Maksimal 10 ta kanal qo'shilgan.
              </div>
            ) : (
              <div style={{ padding: '18px', background: 'rgba(20, 22, 35, 0.8)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h4 style={{ fontSize: '14px', color: '#e0b3ff', margin: 0 }}>Yangi kanal qo'shish</h4>
                <input className="cyber-input" style={{ width: '100%' }} placeholder="Kanal ID (-100... yoki @username)" value={newMandatoryId} onChange={e => setNewMandatoryId(e.target.value)} />
                <input className="cyber-input" style={{ width: '100%' }} placeholder="Kanal nomi (ko'rsatiladigan nom)" value={newMandatoryTitle} onChange={e => setNewMandatoryTitle(e.target.value)} />
                <input className="cyber-input" style={{ width: '100%' }} placeholder="Invite link (ixtiyoriy: https://t.me/...)" value={newMandatoryLink} onChange={e => setNewMandatoryLink(e.target.value)} />
                <button
                  className="neon-btn"
                  style={{ width: '100%' }}
                  onClick={async () => {
                    if (!newMandatoryId || !newMandatoryTitle) return alert('Kanal ID va nom majburiy');
                    const res = await fetch(`${API_URL}/admin/mandatory-channels`, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({ channelId: newMandatoryId, title: newMandatoryTitle, inviteLink: newMandatoryLink || null })
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setNewMandatoryId(''); setNewMandatoryTitle(''); setNewMandatoryLink('');
                      fetchData();
                    } else {
                      alert(data.error || 'Xatolik');
                    }
                  }}
                >+ Qo'shish</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'broadcast' && (
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Hammaga xabar yuborish</h2>
            <form onSubmit={handleBroadcast} className="cyber-card" style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>Rasm (ixtiyoriy):</label>
                
                <input 
                  type="file" 
                  id="broadcast-image-input"
                  accept="image/*" 
                  onChange={handleImageUpload}
                  style={{ display: 'none' }} 
                />
                
                {!broadcastImageBase64 ? (
                  <label 
                    htmlFor="broadcast-image-input" 
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '24px 16px',
                      borderRadius: '12px',
                      border: '2px dashed rgba(0, 240, 255, 0.3)',
                      background: 'rgba(0, 240, 255, 0.02)',
                      color: 'var(--accent-cyan)',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      textAlign: 'center',
                      boxShadow: 'inset 0 0 10px rgba(0, 240, 255, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                      e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.15), inset 0 0 15px rgba(0, 240, 255, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.3)';
                      e.currentTarget.style.boxShadow = 'inset 0 0 10px rgba(0, 240, 255, 0.05)';
                    }}
                  >
                    <Upload size={28} style={{ marginBottom: '8px', filter: 'drop-shadow(0 0 5px var(--accent-cyan))' }} />
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>Rasm tanlash</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>PNG, JPG formatlar (avtomatik siqiladi)</span>
                  </label>
                ) : (
                  <div 
                    style={{ 
                      position: 'relative', 
                      borderRadius: '12px', 
                      border: '1px solid rgba(176, 38, 255, 0.3)', 
                      background: 'rgba(20, 22, 35, 0.8)',
                      padding: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      boxShadow: '0 0 15px rgba(176, 38, 255, 0.15)'
                    }}
                  >
                    <img 
                      src={broadcastImageBase64} 
                      alt="preview" 
                      style={{ 
                        width: '60px', 
                        height: '60px', 
                        objectFit: 'cover', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.1)' 
                      }} 
                    />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#fff' }}>Rasm tanlandi</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Yuklashga tayyor</div>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => {
                        setBroadcastImageBase64(null);
                        const fileInput = document.getElementById('broadcast-image-input') as HTMLInputElement;
                        if (fileInput) fileInput.value = '';
                      }}
                      style={{ 
                        background: 'rgba(255, 0, 85, 0.1)', 
                        border: '1px solid rgba(255, 0, 85, 0.3)', 
                        color: 'var(--accent-red)', 
                        cursor: 'pointer', 
                        padding: '8px', 
                        borderRadius: '8px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 0, 85, 0.2)';
                        e.currentTarget.style.boxShadow = '0 0 8px rgba(255, 0, 85, 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 0, 85, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              <textarea 
                className="cyber-input" 
                style={{ height: '100px', width: '100%', resize: 'vertical', marginBottom: '16px' }}
                placeholder="Xabar matni (barcha foydalanuvchilarga boradi)..." 
                value={broadcastText} 
                onChange={e => setBroadcastText(e.target.value)} 
                required={!broadcastImageBase64} 
              />
              <button type="submit" className="neon-btn" disabled={broadcasting} style={{ background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)' }}>
                {broadcasting ? <div className="spinner"></div> : <><Send size={16} style={{ display: 'inline', marginRight: '5px' }} /> Yuborish</>}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'payments' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                To'lovlar <span style={{ width: '60px', height: '2px', background: 'linear-gradient(90deg, var(--accent-cyan), transparent)' }}></span>
              </h2>
              <span style={{ color: 'var(--accent-cyan)', fontSize: '14px', fontWeight: '500' }}>{payments.length} ta</span>
            </div>
            
            <div className="filter-pills">
              <button className={`filter-pill ${paymentFilter === 'PENDING' ? 'active' : ''}`} onClick={() => setPaymentFilter('PENDING')}>
                ⏳ Kutayotgan
              </button>
              <button className={`filter-pill ${paymentFilter === 'COMPLETED' ? 'active' : ''}`} onClick={() => setPaymentFilter('COMPLETED')}>
                ✅ Tasdiqlangan
              </button>
              <button className={`filter-pill ${paymentFilter === 'CANCELLED' ? 'active' : ''}`} onClick={() => setPaymentFilter('CANCELLED')}>
                ❌ Bekor
              </button>
              <button className={`filter-pill ${paymentFilter === 'ALL' ? 'active' : ''}`} onClick={() => setPaymentFilter('ALL')}>
                📋 Hammasi
              </button>
            </div>

            {payments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>
                To'lovlar yo'q
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {payments.map(pay => (
                  <div key={pay.id} className="payment-card">
                    <div className="pay-user">
                      {pay.user?.firstName || 'Ismsiz'} {pay.user?.username ? <span style={{ color: 'var(--text-muted)' }}>(@{pay.user?.username})</span> : ''}
                    </div>
                    <div className="pay-amount">{pay.amount.toLocaleString('ru-RU')} UZS</div>
                    <div className="pay-desc">
                      {pay.plan?.name} <br/>
                      {new Date(pay.createdAt).toLocaleString('uz-UZ')}
                    </div>
                    
                    {pay.status === 'PENDING' && (
                      <div className="action-buttons">
                        <button className="btn-confirm" onClick={() => handlePaymentAction(pay.id, 'confirm')}>
                          ✅ Tasdiqlash
                        </button>
                        <button className="btn-reject" onClick={() => handlePaymentAction(pay.id, 'reject')}>
                          ❌ Bekor
                        </button>
                      </div>
                    )}
                    {pay.status !== 'PENDING' && (
                       <div style={{ marginTop: '16px', zIndex: 2, position: 'relative' }}>
                         <span style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', 
                           background: pay.status === 'COMPLETED' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 0, 85, 0.1)',
                           color: pay.status === 'COMPLETED' ? 'var(--accent-green)' : 'var(--accent-red)',
                           border: `1px solid ${pay.status === 'COMPLETED' ? 'rgba(0, 255, 102, 0.3)' : 'rgba(255, 0, 85, 0.3)'}`
                         }}>
                           {pay.status === 'COMPLETED' ? '✅ Tasdiqlangan' : '❌ Bekor qilingan'}
                         </span>
                       </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'users' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                Foydalanuvchilar <span style={{ width: '60px', height: '2px', background: 'linear-gradient(90deg, var(--accent-cyan), transparent)' }}></span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ color: 'var(--accent-cyan)', fontSize: '14px', fontWeight: '500' }}>Jami: {stats.totalUsers} ta</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>(Oxirgi 100 tasi ro'yxatda)</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {users.map(user => {
                const joinedDate = new Date(user.createdAt || Date.now()).toLocaleDateString('uz-UZ');
                const profileUrl = user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}`;
                return (
                  <div key={user.id} className="payment-card" style={{ padding: '0', overflow: 'hidden', position: 'relative' }}>
                    {/* Top blue bar like in screenshot */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '120px', height: '6px', background: 'linear-gradient(90deg, #3b82f6, #00f0ff)', borderBottomRightRadius: '8px' }}></div>
                    
                    {/* Circuit Board overlay & Code Watermark on the right side */}
                    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', opacity: 0.12, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
                      <svg width="100%" height="100%" viewBox="0 0 200 150" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1">
                        {/* Circuit board paths */}
                        <path d="M120,10 L160,10 L180,30 L180,90 L200,110" />
                        <circle cx="120" cy="10" r="2.5" fill="rgba(255,255,255,0.4)" />
                        <circle cx="200" cy="110" r="2.5" fill="rgba(255,255,255,0.4)" />
                        <path d="M140,40 L155,55 L155,100 L170,115" />
                        <circle cx="140" cy="40" r="2.5" fill="rgba(255,255,255,0.4)" />
                        <circle cx="170" cy="115" r="2.5" fill="rgba(255,255,255,0.4)" />
                        
                        {/* Code matrix/lines */}
                        <text x="10" y="25" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"# DATABASE_CONNECTION_URL = ..."}</text>
                        <text x="10" y="38" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"FuncClass DbCreate() {"}</text>
                        <text x="20" y="51" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"const list = await prisma.user.findMany({"}</text>
                        <text x="30" y="64" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"include: { subs: true }"}</text>
                        <text x="20" y="77" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"});"}</text>
                        <text x="20" y="90" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"return list.map(u => u.id);"}</text>
                        <text x="10" y="103" fill="#00f0ff" fontFamily="monospace" fontSize="6.5">{"}"}</text>
                      </svg>
                    </div>

                    <div style={{ display: 'flex', padding: '16px', position: 'relative', zIndex: 2, alignItems: 'center' }}>
                      {/* Avatar with click handler redirecting to Telegram */}
                      <a 
                        href={profileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        style={{ 
                          textDecoration: 'none', 
                          display: 'block',
                          cursor: 'pointer',
                          marginRight: '16px',
                          zIndex: 2,
                          transition: 'transform 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <div style={{ 
                          width: '60px', 
                          height: '60px', 
                          borderRadius: '50%', 
                          background: 'radial-gradient(circle, #1e3a8a, #0b0f19)', 
                          border: '2px solid #3b82f6', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          fontSize: '24px', 
                          fontWeight: 'bold', 
                          color: '#fff', 
                          boxShadow: '0 0 15px rgba(59, 130, 246, 0.5)',
                        }}>
                          {user.firstName ? user.firstName.charAt(0) : 'U'}
                        </div>
                      </a>
                      
                      {/* User Info */}
                      <div style={{ flex: 1, zIndex: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', textShadow: '0 0 5px rgba(255,255,255,0.3)' }}>{user.firstName || 'Ismsiz'}</div>
                        </div>
                        <div style={{ color: '#3b82f6', fontSize: '14px', marginBottom: '2px' }}>
                          <a 
                            href={profileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            {user.username ? `@${user.username}` : `@user${user.id}`} <Send size={12} style={{ filter: 'drop-shadow(0 0 5px #3b82f6)' }} />
                          </a>
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                          ID: {user.id}
                        </div>
                        
                        {/* Stretched green obuna pill as in screenshot */}
                        <div style={{ 
                          background: 'rgba(0, 255, 102, 0.08)', 
                          border: '1px solid rgba(0, 255, 102, 0.3)', 
                          color: 'var(--accent-green)', 
                          padding: '6px 14px', 
                          borderRadius: '8px', 
                          display: 'block', 
                          width: '100%',
                          maxWidth: '280px',
                          fontSize: '13px', 
                          fontWeight: '600', 
                          marginTop: '8px', 
                          backdropFilter: 'blur(4px)',
                          boxShadow: 'inset 0 0 8px rgba(0, 255, 102, 0.05)'
                        }}>
                          {user.subs?.length || 0} obuna
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', color: '#9ca3af', fontSize: '12px', marginTop: '8px' }}>
                          <Clock size={12} style={{ marginRight: '6px', color: '#00f0ff' }} />
                          Qo'shilgan: {joinedDate}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'channels' && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>Kanallar ({channels.length})</h2>
            {/* Channels List */}
            <div className="channels">
              {channels.map((channel) => (
                <div key={channel.id} style={{ marginBottom: '20px' }}>
                  <div className="channel-header" style={{ marginBottom: '15px' }}>
                    <div className="glass-icon" style={{ width: 36, height: 36, borderRadius: 8 }}>
                      <Crown size={20} color="#fff" />
                    </div>
                    <div className="channel-info" style={{ flexGrow: 1 }}>
                      <h2 style={{ fontSize: '16px', color: '#fff' }}>{channel.title}</h2>
                      <p style={{ opacity: 0.6, fontSize: '11px' }}>ID: {channel.id}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={async () => {
                        const newTitle = prompt('Kanalning yangi nomini kiriting:', channel.title);
                        if (newTitle && newTitle !== channel.title) {
                          const res = await fetch(`${API_URL}/admin/channels/${channel.id}`, {
                            method: 'PUT',
                            headers,
                            body: JSON.stringify({ title: newTitle })
                          });
                          if (res.ok) fetchData();
                        }
                      }} style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer' }} title="Nomini o'zgartirish">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDeleteChannel(channel.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="O'chirish">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Plans */}
                  <div className="plans">
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>Tariflar:</div>
                    {channel.plans.length === 0 ? <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '10px' }}>Tariflar yo'q</div> : null}
                    
                    {channel.plans.map(plan => (
                      <div key={plan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(20, 22, 35, 0.6)', padding: '12px 16px', borderRadius: '12px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>{plan.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--accent)' }}>{plan.price.toLocaleString('ru-RU')} UZS / {plan.duration === 0 ? 'Butun umrlik' : `${plan.duration} kun`}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button onClick={async () => {
                            const newPrice = prompt(`"${plan.name}" uchun yangi narxni kiriting (UZS):`, plan.price.toString());
                            if (newPrice !== null && !isNaN(Number(newPrice)) && newPrice.trim() !== '') {
                              const res = await fetch(`${API_URL}/admin/plans/${plan.id}`, {
                                method: 'PUT',
                                headers,
                                body: JSON.stringify({ price: Number(newPrice) })
                              });
                              if (res.ok) fetchData();
                            }
                          }} style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer' }} title="Narxini o'zgartirish">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => handleDeletePlan(plan.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="O'chirish">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add Plan Button/Form */}
                    {activeChannelForPlan === channel.id ? (
                      <form onSubmit={(e) => handleAddPlan(e, channel.id)} className="cyber-card" style={{ marginTop: '15px', padding: '16px' }}>
                        <input 
                          className="cyber-input" 
                          style={{ width: '100%', marginBottom: '10px' }}
                          placeholder="Tarif nomi (masalan: 1 Oylik)" 
                          value={newPlanName} onChange={e => setNewPlanName(e.target.value)} required 
                        />
                        <input 
                          className="cyber-input" 
                          style={{ width: '100%', marginBottom: '10px' }}
                          placeholder="Ta'rif (masalan: Barcha darslar)" 
                          value={newPlanDesc} onChange={e => setNewPlanDesc(e.target.value)} 
                        />
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                          <input 
                            className="cyber-input" 
                            style={{ flex: 1 }}
                            type="number" placeholder="Narxi (UZS)" 
                            value={newPlanPrice} onChange={e => setNewPlanPrice(e.target.value)} required 
                          />
                          {!isLifetime && (
                            <input 
                              className="cyber-input" 
                              style={{ flex: 1 }}
                              type="number" placeholder="Muddat (kun)" 
                              value={newPlanDuration} onChange={e => setNewPlanDuration(e.target.value)} required 
                            />
                          )}
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                          <label style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px', 
                            color: isLifetime ? 'var(--accent)' : 'var(--text-muted)', 
                            fontSize: '14px', 
                            cursor: 'pointer', 
                            background: isLifetime ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)', 
                            padding: '12px 16px', 
                            borderRadius: '10px', 
                            border: isLifetime ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)', 
                            transition: 'all 0.3s ease',
                            userSelect: 'none'
                          }}>
                            <input 
                              type="checkbox" 
                              checked={isLifetime} 
                              onChange={e => setIsLifetime(e.target.checked)} 
                              style={{ accentColor: 'var(--accent)', width: '18px', height: '18px', cursor: 'pointer', margin: 0 }}
                            />
                            <span style={{ fontWeight: isLifetime ? '500' : 'normal', textShadow: isLifetime ? '0 0 10px rgba(0, 240, 255, 0.3)' : 'none' }}>Butun umrlik obuna (muddat cheklovisiz)</span>
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button type="submit" className="btn-small-glow" style={{ flex: 1, padding: '12px', justifyContent: 'center' }}>Saqlash</button>
                          <button type="button" onClick={() => setActiveChannelForPlan(null)} className="btn-small-glow" style={{ flex: 1, padding: '12px', justifyContent: 'center', background: 'transparent', border: '1px solid rgba(255,255,255,0.3)' }}>Bekor qilish</button>
                        </div>
                      </form>
                    ) : (
                      <button onClick={() => setActiveChannelForPlan(channel.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '12px', color: 'var(--text-main)', cursor: 'pointer', marginTop: '10px', transition: 'all 0.2s' }}>
                        <Plus size={16} style={{ marginRight: '5px' }} /> Yangi tarif qo'shish
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Channel Form */}
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '30px 0 15px 0' }}>Yangi kanal qo'shish</h2>
            <form onSubmit={handleAddChannel} className="cyber-card" style={{ padding: '20px' }}>
              <p style={{ fontSize: '12px', opacity: 0.7, marginBottom: '15px' }}>Kanal ID raqamini kiritish uchun oldin botni kanalingizga admin qiling. ID odatda "-100" bilan boshlanadi.</p>
              <input 
                className="cyber-input" 
                style={{ width: '100%', marginBottom: '10px' }}
                placeholder="Kanal ID (masalan: -10012345678)" 
                value={newChannelId} onChange={e => setNewChannelId(e.target.value)} required 
              />
              <input 
                className="cyber-input" 
                style={{ width: '100%', marginBottom: '15px' }}
                placeholder="Kanal nomi (masalan: VIP Darslar)" 
                value={newChannelTitle} onChange={e => setNewChannelTitle(e.target.value)} required 
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', flex: 1, justifyContent: 'center' }}>
                  <Upload size={18} /> Kanal rasmi (ixtiyoriy)
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChannelImageUpload} />
                </label>
              </div>
              {newChannelImage && (
                <div style={{ position: 'relative', width: '60px', height: '60px', marginBottom: '15px', borderRadius: '12px', overflow: 'hidden' }}>
                  <img src={newChannelImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', padding: '2px', cursor: 'pointer' }} onClick={() => setNewChannelImage(null)}>
                    <XCircle size={14} color="#fff" />
                  </div>
                </div>
              )}
              <button type="submit" className="btn-small-glow" style={{ width: '100%', padding: '12px', justifyContent: 'center' }}>
                <Plus size={18} style={{ marginRight: '5px' }} /> Qo'shish
              </button>
            </form>
          </div>
        )}


      </main>
      </div>

      <div className="tag-bottom">
        <div className="pill-tag">@Diora_vip_bot</div>
      </div>
    </>
  );
}
