import { useState, useEffect, useRef, type FormEvent } from 'react';
import { 
  Radio, Bell, BellOff, Video, VideoOff, Mic, MicOff, 
  Send, Eye, X, RefreshCw, Heart, Sparkles, Volume2, VolumeX, ShieldAlert 
} from 'lucide-react';

interface Comment {
  id: number;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
}

interface FloatingHeart {
  id: number;
  emoji: string;
  left: number;
}

interface VideoChatProps {
  userId: string;
  userName: string;
  onBack: () => void;
}

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function VideoChat({ userId, userName, onBack }: VideoChatProps) {
  // Stream & User states
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);
  const [liveStream, setLiveStream] = useState<any | null>(null);
  const [isStreamer, setIsStreamer] = useState<boolean>(false);
  const [liveNotify, setLiveNotify] = useState<boolean>(false);
  const [togglingNotify, setTogglingNotify] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Chat & Viewers
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState<string>('');
  const [sendingComment, setSendingComment] = useState<boolean>(false);
  const [viewersCount, setViewersCount] = useState<number>(1);
  const [floatingHearts, setFloatingHearts] = useState<FloatingHeart[]>([]);

  // Streamer Live state
  const [isBroadcasting, setIsBroadcasting] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [micMuted, setMicMuted] = useState<boolean>(false);
  const [videoDisabled, setVideoDisabled] = useState<boolean>(false);
  const [audioMutedForViewer, setAudioMutedForViewer] = useState<boolean>(false);
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const frameIntervalRef = useRef<any>(null);
  const commentsEndRef = useRef<HTMLDivElement | null>(null);

  // 1. Initial Status & User Permission check
  const fetchStatusAndPermissions = async () => {
    try {
      const [statusRes, userStateRes] = await Promise.all([
        fetch(`${API_URL}/live/status`),
        userId ? fetch(`${API_URL}/live/user-state/${userId}`) : Promise.resolve(null as any)
      ]);

      if (statusRes.ok) {
        const sData = await statusRes.json();
        setIsLiveActive(Boolean(sData.active));
        setLiveStream(sData.stream || null);
        if (sData.recentComments) {
          setComments(sData.recentComments);
        }
        if (sData.stream?.viewersCount) {
          setViewersCount(sData.stream.viewersCount);
        }
      }

      if (userStateRes && userStateRes.ok) {
        const uData = await userStateRes.json();
        setLiveNotify(Boolean(uData.liveNotify));
        setIsStreamer(Boolean(uData.isStreamer));
      } else if (!userId) {
        setIsStreamer(false);
      }
    } catch (err) {
      console.error('Error fetching live status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndPermissions();
    const interval = setInterval(fetchStatusAndPermissions, 8000);
    return () => clearInterval(interval);
  }, [userId]);

  // 2. Notification Toggle Handler
  const handleToggleNotify = async () => {
    setTogglingNotify(true);
    const nextState = !liveNotify;
    try {
      const res = await fetch(`${API_URL}/live/toggle-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, enabled: nextState })
      });
      if (res.ok) {
        const data = await res.json();
        setLiveNotify(Boolean(data.liveNotify));
      }
    } catch (err) {
      console.error('Toggle notify error:', err);
    } finally {
      setTogglingNotify(false);
    }
  };

  // 3. Connect to SSE Events when on live stream
  useEffect(() => {
    if (!isLiveActive && !isBroadcasting) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    const role = isBroadcasting ? 'streamer' : 'viewer';
    const sse = new EventSource(`${API_URL}/live/events?userId=${userId}&name=${encodeURIComponent(userName)}&role=${role}`);
    sseRef.current = sse;

    sse.addEventListener('init', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (data.viewersCount) setViewersCount(data.viewersCount);
      } catch {}
    });

    sse.addEventListener('viewers_count', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setViewersCount(data.count || 1);
      } catch {}
    });

    sse.addEventListener('new_comment', (e: any) => {
      try {
        const comment = JSON.parse(e.data);
        setComments(prev => [...prev.slice(-40), comment]);
      } catch {}
    });

    sse.addEventListener('stream_ended', () => {
      setIsLiveActive(false);
      setLiveStream(null);
      setIsBroadcasting(false);
      stopMediaStream();
      alert('Jonli efir yakunlandi.');
    });

    sse.addEventListener('video_frame', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (data.frame) {
          setFallbackFrame(data.frame);
        }
      } catch {}
    });

    // WebRTC signaling
    if (!isBroadcasting) {
      // Viewer WebRTC listener
      sse.addEventListener('webrtc_signal', async (e: any) => {
        try {
          const { type, data } = JSON.parse(e.data);
          if (type === 'offer' && viewerPeerConnectionRef.current) {
            const pc = viewerPeerConnectionRef.current;
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await fetch(`${API_URL}/live/signal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetRole: 'streamer', senderId: userId, type: 'answer', data: answer })
            });
          } else if (type === 'candidate' && viewerPeerConnectionRef.current) {
            await viewerPeerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
          }
        } catch (signalErr) {
          console.error('WebRTC viewer signal error:', signalErr);
        }
      });
    } else {
      // Streamer WebRTC listener
      sse.addEventListener('viewer_joined', async (e: any) => {
        try {
          const { clientId } = JSON.parse(e.data);
          if (clientId && localStreamRef.current) {
            setupStreamerPeerConnection(clientId, localStreamRef.current);
          }
        } catch {}
      });

      sse.addEventListener('webrtc_signal', async (e: any) => {
        try {
          const { senderId, type, data } = JSON.parse(e.data);
          if (type === 'answer') {
            const pc = peerConnectionsRef.current.get(senderId);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data)).catch(() => {});
            }
          } else if (type === 'candidate') {
            const pc = peerConnectionsRef.current.get(senderId);
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
            }
          }
        } catch {}
      });
    }

    return () => {
      sse.close();
    };
  }, [isLiveActive, isBroadcasting, userId, userName]);

  // Setup WebRTC for Viewer
  useEffect(() => {
    if (isLiveActive && !isBroadcasting) {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      viewerPeerConnectionRef.current = pc;

      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          fetch(`${API_URL}/live/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetRole: 'streamer', senderId: userId, type: 'candidate', data: event.candidate })
          }).catch(() => {});
        }
      };

      return () => {
        pc.close();
        viewerPeerConnectionRef.current = null;
      };
    }
  }, [isLiveActive, isBroadcasting, userId]);

  // Setup WebRTC connection for Streamer towards a specific viewer
  const setupStreamerPeerConnection = async (viewerClientId: string, stream: MediaStream) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      peerConnectionsRef.current.set(viewerClientId, pc);

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          fetch(`${API_URL}/live/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetClientId: viewerClientId, senderId: userId, type: 'candidate', data: event.candidate })
          }).catch(() => {});
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await fetch(`${API_URL}/live/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetClientId: viewerClientId, senderId: userId, type: 'offer', data: offer })
      });
    } catch (err) {
      console.error('Error setting up streamer peer connection:', err);
    }
  };

  // Helper: Start Camera
  const startCamera = async (facing: 'user' | 'environment') => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Kamera yoki mikrofondan foydalanishga ruxsat berilmadi.');
      return null;
    }
  };

  const stopMediaStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  };

  // Start Broadcasting
  const handleStartBroadcast = async () => {
    const stream = await startCamera(cameraFacing);
    if (!stream) return;

    try {
      const res = await fetch(`${API_URL}/live/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamerId: userId,
          streamerName: userName || 'VIP Streamer',
          title: 'VIP Jonli Efir'
        })
      });

      if (res.ok) {
        const data = await res.json();
        setLiveStream(data.stream);
        setIsLiveActive(true);
        setIsBroadcasting(true);

        // Frame relay fallback (captures canvas snapshot every 900ms)
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 640;
        const ctx = canvas.getContext('2d');

        frameIntervalRef.current = setInterval(() => {
          if (localVideoRef.current && ctx) {
            try {
              ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
              const frame = canvas.toDataURL('image/jpeg', 0.5);
              fetch(`${API_URL}/live/frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame, streamerId: userId })
              }).catch(() => {});
            } catch {}
          }
        }, 900);
      } else {
        const data = await res.json();
        alert(data.error || 'Efirni boshlab bo\'lmadi');
        stopMediaStream();
      }
    } catch (err) {
      alert('Server bilan bog\'lanishda xatolik');
      stopMediaStream();
    }
  };

  // End Broadcasting
  const handleEndBroadcast = async () => {
    if (!confirm('Haqiqatan ham jonli efirni tugatmoqchimisiz?')) return;
    try {
      await fetch(`${API_URL}/live/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: liveStream?.id, streamerId: userId })
      });
    } catch {}

    stopMediaStream();
    setIsBroadcasting(false);
    setIsLiveActive(false);
    setLiveStream(null);
  };

  // Flip Camera
  const handleFlipCamera = async () => {
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    setCameraFacing(nextFacing);
    if (isBroadcasting) {
      const stream = await startCamera(nextFacing);
      if (stream) {
        // Replace tracks in all peer connections
        const videoTrack = stream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack).catch(() => {});
          }
        });
      }
    }
  };

  // Toggle Mic
  const handleToggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle Video Pause
  const handleToggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoDisabled(!videoTrack.enabled);
      }
    }
  };

  // Post comment
  const handleSendComment = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!newComment.trim() || sendingComment) return;

    setSendingComment(true);
    const commentToSend = newComment.trim();
    setNewComment('');

    try {
      await fetch(`${API_URL}/live/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId: liveStream?.id,
          userId,
          userName,
          text: commentToSend
        })
      });
    } catch (err) {
      console.error('Send comment error:', err);
    } finally {
      setSendingComment(false);
    }
  };

  // Trigger floating heart reaction
  const handleSendReaction = (emoji: string = '❤️') => {
    const newHeart: FloatingHeart = {
      id: Date.now() + Math.random(),
      emoji,
      left: Math.floor(Math.random() * 50) + 20
    };
    setFloatingHearts(prev => [...prev.slice(-15), newHeart]);
    setTimeout(() => {
      setFloatingHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 2200);

    // Also send reaction as quick chat emoji
    fetch(`${API_URL}/live/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streamId: liveStream?.id,
        userId,
        userName,
        text: emoji
      })
    }).catch(() => {});
  };

  // Auto-scroll comments to bottom
  useEffect(() => {
    if (commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
        <p>Videochat yuklanmoqda...</p>
      </div>
    );
  }

  // ==========================================
  // CASE 1: JONLI EFIR BO'LMAGANDA (NOT ACTIVE)
  // ==========================================
  if (!isLiveActive && !isBroadcasting) {
    return (
      <div style={{ padding: '10px 0' }}>
        {/* Back to main page navigation */}
        <div style={{ marginBottom: '14px' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              padding: '8px 14px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: '600',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            ← Asosiy sahifaga qaytish
          </button>
        </div>

        {/* Waiting Card */}
        <div className="cyber-card" style={{ 
          padding: '30px 20px', 
          textAlign: 'center', 
          position: 'relative',
          overflow: 'hidden',
          marginBottom: '20px'
        }}>
          {/* Ambient Glow */}
          <div style={{ 
            position: 'absolute', 
            top: '-30px', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            width: '160px', 
            height: '160px', 
            background: 'radial-gradient(circle, rgba(239, 68, 68, 0.35) 0%, rgba(0,0,0,0) 70%)',
            filter: 'blur(30px)',
            pointerEvents: 'none'
          }} />

          {/* Animated Radar Icon */}
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(244, 63, 94, 0.1))',
            border: '2px solid rgba(239, 68, 68, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 18px',
            boxShadow: '0 0 25px rgba(239, 68, 68, 0.3)',
            position: 'relative'
          }}>
            <Radio size={36} color="#ef4444" style={{ animation: 'pulse 2s infinite' }} />
          </div>

          <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#fff', marginBottom: '10px' }}>
            VIDEOCHAT hali boshlanmadi
          </h2>

          <p style={{ 
            fontSize: '13.5px', 
            color: 'rgba(255, 255, 255, 0.8)', 
            lineHeight: '1.6', 
            maxWidth: '340px', 
            margin: '0 auto 24px' 
          }}>
            VIDEOCHAT hali boshlanmadi, boshlangan payti xabar berishimiz uchun bildirishnomani yoqing.
          </p>

          {/* Notification Toggle Button */}
          <button
            type="button"
            onClick={handleToggleNotify}
            disabled={togglingNotify}
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '14px 20px',
              borderRadius: '16px',
              fontWeight: '700',
              fontSize: '15px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.25s ease',
              border: liveNotify ? '1.5px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
              background: liveNotify 
                ? 'rgba(34, 197, 94, 0.15)' 
                : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #0284c7 100%)',
              color: liveNotify ? '#4ade80' : '#ffffff',
              boxShadow: liveNotify ? '0 0 20px rgba(34, 197, 94, 0.2)' : '0 8px 24px rgba(37, 99, 235, 0.4)'
            }}
          >
            {togglingNotify ? (
              <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
            ) : liveNotify ? (
              <>
                <BellOff size={18} />
                <span>✅ Bildirishnoma yoqilgan (O'chirish)</span>
              </>
            ) : (
              <>
                <Bell size={18} />
                <span>🔔 Bildirishnomani yoqish</span>
              </>
            )}
          </button>
        </div>

        {/* If user is authorized streamer, show Streamer Studio controls */}
        {isStreamer && (
          <div className="cyber-card" style={{ 
            padding: '20px', 
            border: '1px solid rgba(239, 68, 68, 0.4)', 
            background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, rgba(20, 24, 38, 0.8) 100%)' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span style={{ fontSize: '18px' }}>👑</span>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#f87171', margin: 0 }}>
                  Streamer Studiyasi
                </h3>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
                  Sizga jonli efir o'tkazish ruxsati berilgan
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartBroadcast}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '14px',
                border: 'none',
                fontWeight: '800',
                fontSize: '16px',
                cursor: 'pointer',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #991b1b 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: '0 8px 25px rgba(239, 68, 68, 0.5)'
              }}
            >
              <Video size={20} />
              <span>🔴 Jonli Efirni Boshlash</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // ===============================================================
  // CASE 2: JONLI EFIR DAVOM ETMOQDA (YOUTUBE SHORTS LIVE AESTHETIC)
  // ===============================================================
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 99999,
      background: '#000000',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 1. Live Video Element (Full screen cover) */}
      {isBroadcasting ? (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none'
          }}
        />
      ) : (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={audioMutedForViewer}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
          {/* Fallback frame canvas poster if WebRTC stream is buffering */}
          {fallbackFrame && (
            <img
              src={fallbackFrame}
              alt="Live"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: remoteVideoRef.current?.srcObject ? 0 : 1,
                transition: 'opacity 0.3s ease'
              }}
            />
          )}
        </>
      )}

      {/* Top Gradient for controls legibility */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '120px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
        zIndex: 10
      }} />

      {/* Bottom Gradient for comments & input legibility */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '320px',
        background: 'linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
        zIndex: 10
      }} />

      {/* 2. Top Header Bar (Over video) */}
      <div style={{
        position: 'relative',
        zIndex: 20,
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        {/* Streamer Badge & Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            fontWeight: '900',
            fontSize: '11px',
            padding: '4px 8px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 0 10px rgba(239, 68, 68, 0.6)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', animation: 'pulse 1s infinite' }} />
            JONLI
          </div>

          <div style={{
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(8px)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '700',
            padding: '4px 10px',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}>
            <Eye size={13} color="#38bdf8" />
            <span>{viewersCount}</span>
          </div>

          <div style={{
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(8px)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '600',
            padding: '4px 10px',
            borderRadius: '20px',
            maxWidth: '120px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            👑 {liveStream?.streamerName || 'Streamer'}
          </div>
        </div>

        {/* Right Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isBroadcasting ? (
            <>
              {/* Flip camera */}
              <button
                type="button"
                onClick={handleFlipCamera}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={16} />
              </button>

              {/* Mic toggle */}
              <button
                type="button"
                onClick={handleToggleMic}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: micMuted ? 'rgba(239,68,68,0.7)' : 'rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              {/* End Stream Button */}
              <button
                type="button"
                onClick={handleEndBroadcast}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: '700',
                  fontSize: '12px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 10px rgba(239,68,68,0.5)'
                }}
              >
                Tugatish
              </button>
            </>
          ) : (
            <>
              {/* Viewer audio mute/unmute */}
              <button
                type="button"
                onClick={() => setAudioMutedForViewer(!audioMutedForViewer)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                {audioMutedForViewer ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={onBack}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <X size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Spacer to push comments to bottom */}
      <div style={{ flex: 1 }} />

      {/* 3. Floating Comments Layer (YouTube Shorts Live Style) */}
      <div style={{
        position: 'absolute',
        bottom: '80px',
        left: '12px',
        right: '72px',
        maxHeight: '40vh',
        overflowY: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        zIndex: 30,
        pointerEvents: 'none',
        maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 95%)',
        WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 95%)'
      }}>
        {comments.slice(-12).map((c, i) => (
          <div
            key={c.id || i}
            style={{
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '16px',
              padding: '6px 12px',
              marginBottom: '6px',
              maxWidth: '92%',
              alignSelf: 'flex-start',
              animation: 'slideUp 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <span style={{ 
              fontWeight: '700', 
              fontSize: '12px', 
              color: c.userId === String(liveStream?.streamerId) ? '#fbbf24' : '#38bdf8', 
              marginRight: '6px' 
            }}>
              {c.userName}:
            </span>
            <span style={{ fontSize: '13px', color: '#ffffff', wordBreak: 'break-word' }}>
              {c.text}
            </span>
          </div>
        ))}
        <div ref={commentsEndRef} />
      </div>

      {/* 4. Floating Reactions (Hearts floating upwards on right) */}
      <div style={{
        position: 'absolute',
        bottom: '90px',
        right: '16px',
        width: '50px',
        height: '240px',
        pointerEvents: 'none',
        zIndex: 35,
        overflow: 'hidden'
      }}>
        {floatingHearts.map(h => (
          <div
            key={h.id}
            style={{
              position: 'absolute',
              bottom: 0,
              left: `${h.left}%`,
              fontSize: '24px',
              animation: 'floatUp 2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards'
            }}
          >
            {h.emoji}
          </div>
        ))}
      </div>

      {/* 5. Bottom Comment Input Bar */}
      <div style={{
        position: 'relative',
        zIndex: 40,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <form 
          onSubmit={handleSendComment} 
          style={{ flex: 1, display: 'flex', alignItems: 'center', position: 'relative' }}
        >
          <input
            type="text"
            placeholder="Sharh qoldiring..."
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: '24px',
              padding: '12px 48px 12px 16px',
              color: '#fff',
              fontSize: '14px',
              outline: 'none',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
            }}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || sendingComment}
            style={{
              position: 'absolute',
              right: '6px',
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: newComment.trim() ? '#38bdf8' : 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: newComment.trim() ? 'pointer' : 'default',
              transition: 'background 0.2s ease'
            }}
          >
            <Send size={15} />
          </button>
        </form>

        {/* Floating Heart / Like Button */}
        <button
          type="button"
          onClick={() => handleSendReaction('❤️')}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #ef4444, #f43f5e)',
            border: 'none',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(239, 68, 68, 0.5)',
            flexShrink: 0
          }}
        >
          <Heart size={20} fill="#fff" />
        </button>
      </div>

      {/* Global CSS for Animations */}
      <style>{`
        @keyframes floatUp {
          0% {
            opacity: 1;
            transform: translateY(0) scale(0.8);
          }
          50% {
            opacity: 0.9;
            transform: translateY(-100px) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translateY(-220px) scale(1);
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(15px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
