import { useState, useEffect } from 'react';
import { Trash2, Plus, Users, Crown, CreditCard, Settings, Send, List, Save } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('channels'); // channels, settings, users, broadcast

  // Settings
  const [settings, setSettings] = useState({ cardNumber: '', paymentChannelId: '' });
  const [savingSettings, setSavingSettings] = useState(false);

  // Broadcast
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  // Users List
  const [users, setUsers] = useState<any[]>([]);
  
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
      const [chRes, stRes, setRes, usrRes] = await Promise.all([
        fetch(`${API_URL}/channels`),
        fetch(`${API_URL}/admin/stats`, { headers }),
        fetch(`${API_URL}/admin/settings`, { headers }),
        fetch(`${API_URL}/admin/users`, { headers })
      ]);
      if (chRes.ok) setChannels(await chRes.json());
      if (stRes.ok) setStats(await stRes.json());
      if (setRes.ok) setSettings(await setRes.json());
      if (usrRes.ok) setUsers(await usrRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><div className="spinner"></div></div>;
  }

  return (
    <>
      <header>
        <h1>🛠 Admin Panel</h1>
        <p>Tizimni boshqarish</p>
      </header>

      <div style={{ display: 'flex', gap: '10px', padding: '0 15px', overflowX: 'auto', marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('channels')} className="pay-btn" style={{ padding: '8px 15px', opacity: activeTab === 'channels' ? 1 : 0.5, flex: '0 0 auto', background: activeTab === 'channels' ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}><Crown size={16} style={{display: 'inline', marginRight: 5}}/>Kanallar</button>
        <button onClick={() => setActiveTab('users')} className="pay-btn" style={{ padding: '8px 15px', opacity: activeTab === 'users' ? 1 : 0.5, flex: '0 0 auto', background: activeTab === 'users' ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}><List size={16} style={{display: 'inline', marginRight: 5}}/>Foydalanuvchilar</button>
        <button onClick={() => setActiveTab('broadcast')} className="pay-btn" style={{ padding: '8px 15px', opacity: activeTab === 'broadcast' ? 1 : 0.5, flex: '0 0 auto', background: activeTab === 'broadcast' ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}><Send size={16} style={{display: 'inline', marginRight: 5}}/>Xabar yuborish</button>
        <button onClick={() => setActiveTab('settings')} className="pay-btn" style={{ padding: '8px 15px', opacity: activeTab === 'settings' ? 1 : 0.5, flex: '0 0 auto', background: activeTab === 'settings' ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}><Settings size={16} style={{display: 'inline', marginRight: 5}}/>Sozlamalar</button>
      </div>

      <main style={{ paddingBottom: '80px' }}>
        {/* Statistics always visible */}
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
        </div>

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
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>Hammaga xabar yuborish</h2>
            <form onSubmit={handleBroadcast} className="card" style={{ padding: '20px' }}>
              <textarea 
                className="admin-input" 
                style={{ height: '100px', resize: 'vertical' }}
                placeholder="Xabar matni (barcha foydalanuvchilarga boradi)..." 
                value={broadcastText} 
                onChange={e => setBroadcastText(e.target.value)} 
                required 
              />
              <button type="submit" className="pay-btn" disabled={broadcasting}>
                {broadcasting ? <div className="spinner"></div> : <><Send size={16} style={{ display: 'inline', marginRight: '5px' }} /> Yuborish</>}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'users' && (
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>Foydalanuvchilar ({users.length})</h2>
            <div className="card" style={{ padding: '10px' }}>
              {users.map(user => (
                <div key={user.id} style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 'bold' }}>{user.firstName || 'Ismsiz'} {user.username ? `(@${user.username})` : ''}</div>
                  <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '5px' }}>ID: {user.id}</div>
                  {user.subs && user.subs.length > 0 ? (
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {user.subs.map((s: any) => (
                        <span key={s.id} style={{ background: 'var(--accent)', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>
                          {s.channel?.title || 'Kanal'}
                        </span>
                      ))}
                    </div>
                  ) : <div style={{ fontSize: '11px', opacity: 0.4 }}>Obunalar yo'q</div>}
                </div>
              ))}
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
      </main>
    </>
  );
}
