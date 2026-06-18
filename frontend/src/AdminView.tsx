import { useState, useEffect } from 'react';
import { Trash2, Plus, Users, Crown, CreditCard, Settings, Send, Save, Box, BarChart2, Clock, Tag } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('payments'); // payments, channels, users, broadcast, stats, settings

  // Settings
  const [settings, setSettings] = useState({ cardNumber: '', paymentChannelId: '' });
  const [savingSettings, setSavingSettings] = useState(false);

  // Broadcast
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  // Users, Payments, Revenue, Promos
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentFilter, setPaymentFilter] = useState('PENDING');
  const [revenue, setRevenue] = useState({ totalRevenue: 0, totalPayments: 0 });
  const [promos, setPromos] = useState<any[]>([]);
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoType, setNewPromoType] = useState('percent');
  const [newPromoValue, setNewPromoValue] = useState('');
  const [newPromoMaxUses, setNewPromoMaxUses] = useState('');
  
  // New channel form
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelTitle, setNewChannelTitle] = useState('');

  // New plan form
  const [activeChannelForPlan, setActiveChannelForPlan] = useState<string | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDesc, setNewPlanDesc] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanDuration, setNewPlanDuration] = useState('30');

  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-init-data': tg?.initData || ''
  };

  const fetchData = async () => {
    try {
      const [chRes, stRes, setRes, usrRes, payRes, revRes, promoRes] = await Promise.all([
        fetch(`${API_URL}/channels`),
        fetch(`${API_URL}/admin/stats`, { headers }),
        fetch(`${API_URL}/admin/settings`, { headers }),
        fetch(`${API_URL}/admin/users`, { headers }),
        fetch(`${API_URL}/admin/payments?status=${paymentFilter}`, { headers }),
        fetch(`${API_URL}/admin/revenue`, { headers }),
        fetch(`${API_URL}/admin/promos`, { headers })
      ]);
      if (chRes.ok) setChannels(await chRes.json());
      if (stRes.ok) setStats(await stRes.json());
      if (setRes.ok) setSettings(await setRes.json());
      if (usrRes.ok) setUsers(await usrRes.json());
      if (payRes.ok) setPayments(await payRes.json());
      if (revRes.ok) setRevenue(await revRes.json());
      if (promoRes.ok) setPromos(await promoRes.json());
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
        body: JSON.stringify({ id: newChannelId, title: newChannelTitle })
      });
      if (res.ok) {
        setNewChannelId('');
        setNewChannelTitle('');
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
    } catch (err) {
      alert('Error deleting channel');
    }
  };

  const handleAddPlan = async (e: React.FormEvent, channelId: string) => {
    e.preventDefault();
    if (!newPlanName || !newPlanPrice || !newPlanDuration) return;

    try {
      const res = await fetch(`${API_URL}/admin/channels/${channelId}/plans`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newPlanName,
          description: newPlanDesc,
          price: Number(newPlanPrice),
          duration: Number(newPlanDuration)
        })
      });
      if (res.ok) {
        setActiveChannelForPlan(null);
        setNewPlanName('');
        setNewPlanDesc('');
        setNewPlanPrice('');
        setNewPlanDuration('30');
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
    } catch (err) {
      alert('Error deleting plan');
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

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText) return;
    setBroadcasting(true);
    try {
      const res = await fetch(`${API_URL}/admin/broadcast`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: broadcastText })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${data.count} ta foydalanuvchiga xabar yuborildi!`);
        setBroadcastText('');
      } else {
        alert('Xatolik');
      }
    } catch (err) {
      alert('Xatolik');
    } finally {
      setBroadcasting(false);
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
          <div className="icon-btn">✕</div>
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
        <div className={`admin-tab-item ${activeTab === 'promos' ? 'active' : ''}`} onClick={() => setActiveTab('promos')}>
          <div className="admin-tab-icon"><Tag size={24} color={activeTab === 'promos' ? 'var(--accent-cyan)' : '#f472b6'} /></div>
          <div className="admin-tab-label">Promo</div>
        </div>
        <div className={`admin-tab-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <div className="admin-tab-icon"><Settings size={24} color={activeTab === 'settings' ? 'var(--accent-cyan)' : '#ef4444'} /></div>
          <div className="admin-tab-label">Sozlamalar</div>
        </div>
      </div>

      <main>
        {activeTab === 'stats' && (
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Statistika</h2>
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              <div className="card" style={{ padding: '15px', textAlign: 'center' }}>
                <Users size={24} style={{ color: 'var(--accent)', marginBottom: '5px' }} />
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalUsers}</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>Foydalanuvchilar</div>
              </div>
              <div className="card" style={{ padding: '15px', textAlign: 'center' }}>
                <CreditCard size={24} style={{ color: '#4ade80', marginBottom: '5px' }} />
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.activeSubs}</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>Faol Obunalar</div>
              </div>
              <div className="card" style={{ padding: '15px', textAlign: 'center', gridColumn: 'span 2', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
                <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '5px' }}>💰 Jami Daromad</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{revenue.totalRevenue.toLocaleString('ru-RU')} UZS</div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px' }}>{revenue.totalPayments} ta tasdiqlangan to'lov</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>Sozlamalar</h2>
            <form onSubmit={handleSaveSettings} className="card" style={{ padding: '20px' }}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginBottom: '5px' }}>Karta Raqami (To'lovlar uchun)</label>
                <input 
                  className="admin-input" 
                  placeholder="masalan: 8600 1234 5678 9012" 
                  value={settings.cardNumber || ''} 
                  onChange={e => setSettings({...settings, cardNumber: e.target.value})} 
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginBottom: '5px' }}>SMS Kanal ID (To'lovlarni tekshirish uchun)</label>
                <input 
                  className="admin-input" 
                  placeholder="-100..." 
                  value={settings.paymentChannelId || ''} 
                  onChange={e => setSettings({...settings, paymentChannelId: e.target.value})} 
                />
                <p style={{ fontSize: '11px', opacity: 0.6, marginTop: '5px' }}>Bot ushbu kanalda admin bo'lishi va kanalga kelgan to'lov haqidagi xabarlarni ko'ra olishi kerak.</p>
              </div>
              <button type="submit" className="pay-btn" disabled={savingSettings}>
                {savingSettings ? <div className="spinner"></div> : <><Save size={16} style={{ display: 'inline', marginRight: '5px' }} /> Saqlash</>}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'broadcast' && (
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Hammaga xabar yuborish</h2>
            <form onSubmit={handleBroadcast} className="card" style={{ padding: '20px', background: '#151a28', border: '1px solid #2a3441', borderRadius: '16px' }}>
              <textarea 
                className="admin-input" 
                style={{ height: '100px', resize: 'vertical', background: '#111827', border: '1px solid #374151' }}
                placeholder="Xabar matni (barcha foydalanuvchilarga boradi)..." 
                value={broadcastText} 
                onChange={e => setBroadcastText(e.target.value)} 
                required 
              />
              <button type="submit" className="pay-btn" disabled={broadcasting} style={{ background: '#3b82f6' }}>
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
                      {pay.plan?.name} {pay.promoCode ? `| Promo: ${pay.promoCode}` : ''} <br/>
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
              <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>Foydalanuvchilar</h2>
              <span style={{ color: '#3b82f6', fontSize: '14px', fontWeight: '500' }}>{users.length} ta</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {users.map(user => {
                // Determine joined date (using dummy date as it's not in user model, or just ID if numeric)
                // For layout purposes we use a static string since it's just visual structure for now
                const joinedDate = '16/06/2026';
                return (
                  <div key={user.id} className="user-card">
                    <div className="user-card-top">
                      <div className="user-avatar">
                        {user.firstName ? user.firstName.charAt(0) : 'U'}
                      </div>
                      <div className="user-info">
                        <div className="user-name">{user.firstName || 'Ismsiz'}</div>
                        <div className="user-username">{user.username ? `@${user.username}` : ''}</div>
                      </div>
                      <a href={`tg://user?id=${user.id}`} className="user-action-btn">
                        <Send size={16} />
                      </a>
                    </div>
                    <div className="user-card-middle">
                      <div className="user-phone">{user.id}</div>
                      <div className="user-badge">{user.subs?.length || 0} obuna</div>
                    </div>
                    <div className="user-card-bottom">
                      <Clock size={12} style={{ marginRight: '6px' }} />
                      Qo'shilgan: {joinedDate}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'channels' && (
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>Kanallar ({channels.length})</h2>
            {/* Channels List */}
            <div className="channels">
              {channels.map((channel) => (
                <div key={channel.id} className="card" style={{ marginBottom: '15px' }}>
                  <div className="channel-header" style={{ marginBottom: '15px' }}>
                    <div className="channel-icon">
                      <Crown size={24} />
                    </div>
                    <div className="channel-info" style={{ flexGrow: 1 }}>
                      <h2>{channel.title}</h2>
                      <p style={{ opacity: 0.6, fontSize: '12px' }}>ID: {channel.id}</p>
                    </div>
                    <button onClick={() => handleDeleteChannel(channel.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                      <Trash2 size={20} />
                    </button>
                  </div>

                  {/* Plans */}
                  <div className="plans">
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>Tariflar:</div>
                    {channel.plans.length === 0 ? <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '10px' }}>Tariflar yo'q</div> : null}
                    
                    {channel.plans.map(plan => (
                      <div key={plan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg)', padding: '10px', borderRadius: '8px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{plan.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--accent)' }}>{plan.price.toLocaleString('ru-RU')} UZS / {plan.duration} kun</div>
                        </div>
                        <button onClick={() => handleDeletePlan(plan.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}

                    {/* Add Plan Button/Form */}
                    {activeChannelForPlan === channel.id ? (
                      <form onSubmit={(e) => handleAddPlan(e, channel.id)} style={{ marginTop: '15px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
                        <input 
                          className="admin-input" 
                          placeholder="Tarif nomi (masalan: 1 Oylik)" 
                          value={newPlanName} onChange={e => setNewPlanName(e.target.value)} required 
                        />
                        <input 
                          className="admin-input" 
                          placeholder="Ta'rif (masalan: Barcha darslar)" 
                          value={newPlanDesc} onChange={e => setNewPlanDesc(e.target.value)} 
                        />
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <input 
                            className="admin-input" 
                            type="number" placeholder="Narxi (UZS)" 
                            value={newPlanPrice} onChange={e => setNewPlanPrice(e.target.value)} required 
                          />
                          <input 
                            className="admin-input" 
                            type="number" placeholder="Muddat (kun)" 
                            value={newPlanDuration} onChange={e => setNewPlanDuration(e.target.value)} required 
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                          <button type="submit" className="pay-btn" style={{ flex: 1, padding: '10px' }}>Saqlash</button>
                          <button type="button" onClick={() => setActiveChannelForPlan(null)} className="pay-btn" style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }}>Bekor qilish</button>
                        </div>
                      </form>
                    ) : (
                      <button onClick={() => setActiveChannelForPlan(channel.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', color: 'var(--text-main)', cursor: 'pointer', marginTop: '10px' }}>
                        <Plus size={16} style={{ marginRight: '5px' }} /> Yangi tarif qo'shish
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Channel Form */}
            <h2 style={{ fontSize: '18px', margin: '25px 0 15px 0' }}>Yangi kanal qo'shish</h2>
            <form onSubmit={handleAddChannel} className="card" style={{ padding: '20px' }}>
              <p style={{ fontSize: '12px', opacity: 0.7, marginBottom: '15px' }}>Kanal ID raqamini kiritish uchun oldin botni kanalingizga admin qiling. ID odatda "-100" bilan boshlanadi.</p>
              <input 
                className="admin-input" 
                placeholder="Kanal ID (masalan: -10012345678)" 
                value={newChannelId} onChange={e => setNewChannelId(e.target.value)} required 
              />
              <input 
                className="admin-input" 
                placeholder="Kanal nomi (masalan: VIP Darslar)" 
                value={newChannelTitle} onChange={e => setNewChannelTitle(e.target.value)} required 
              />
              <button type="submit" className="pay-btn" style={{ marginTop: '10px' }}>
                <Plus size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} /> Qo'shish
              </button>
            </form>
          </div>
        )}

        {activeTab === 'promos' && (
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Promo-kodlar</h2>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await fetch(`${API_URL}/admin/promos`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ code: newPromoCode, discountType: newPromoType, discountValue: newPromoValue, maxUses: newPromoMaxUses })
                });
                if (res.ok) {
                  setNewPromoCode(''); setNewPromoValue(''); setNewPromoMaxUses('');
                  fetchData();
                } else alert('Xatolik');
              } catch { alert('Xatolik'); }
            }} className="card" style={{ padding: '20px', background: '#151a28', border: '1px solid #2a3441', borderRadius: '16px', marginBottom: '20px' }}>
              <input className="admin-input" placeholder="Promo kod (masalan: SALE50)" value={newPromoCode} onChange={e => setNewPromoCode(e.target.value)} required style={{ textTransform: 'uppercase' }} />
              <div style={{ display: 'flex', gap: '10px' }}>
                <select className="admin-input" value={newPromoType} onChange={e => setNewPromoType(e.target.value)} style={{ background: '#111827', border: '1px solid #374151', color: '#fff' }}>
                  <option value="percent">Foiz (%)</option>
                  <option value="fixed">Summa (UZS)</option>
                </select>
                <input className="admin-input" type="number" placeholder="Qiymat" value={newPromoValue} onChange={e => setNewPromoValue(e.target.value)} required />
              </div>
              <input className="admin-input" type="number" placeholder="Maks ishlatilish (0 = cheksiz)" value={newPromoMaxUses} onChange={e => setNewPromoMaxUses(e.target.value)} />
              <button type="submit" className="pay-btn" style={{ background: '#f472b6' }}>
                <Plus size={16} style={{ display: 'inline', marginRight: '5px' }} /> Promo yaratish
              </button>
            </form>

            {promos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>Promo-kodlar yo'q</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {promos.map(p => (
                  <div key={p.id} className="user-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#f472b6' }}>{p.code}</div>
                      <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                        {p.discountType === 'percent' ? `${p.discountValue}% chegirma` : `${p.discountValue.toLocaleString()} UZS chegirma`}
                        {p.maxUses > 0 ? ` | ${p.usedCount}/${p.maxUses} ishlatilgan` : ` | ${p.usedCount} marta ishlatilgan`}
                      </div>
                    </div>
                    <button onClick={async () => {
                      if (!confirm('Bu promo-kodni o\'chirasizmi?')) return;
                      await fetch(`${API_URL}/admin/promos/${p.id}`, { method: 'DELETE', headers });
                      fetchData();
                    }} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      </div>

      <div className="tag-bottom">
        <div className="pill-tag">@KanalKassaBot</div>
      </div>
    </>
  );
}
