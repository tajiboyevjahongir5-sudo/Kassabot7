import { useState, useEffect, useRef, type FormEvent } from 'react';
import { 
  Radio, Bell, BellOff, Video, VideoOff, Mic, MicOff, 
  Send, Eye, X, RefreshCw, Heart, Sparkles, Volume2, VolumeX, ShieldAlert,
  Gift, Copy, Check, ArrowLeft, Loader2
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

export interface DonationGift {
  id: string;
  name: string;
  icon: string;
  price: number;
  description: string;
  animClass: string;
  glowColor: string;
}

export const DONATION_GIFTS: DonationGift[] = [
  { id: 'rose', name: 'Atirgul', icon: '🌹', price: 5000, description: 'Chiroyli gullar bilan qo\'llab-quvvatlash', animClass: 'anim-rose', glowColor: 'rgba(244, 63, 94, 0.8)' },
  { id: 'coffee', name: 'Issiq Qahva', icon: '☕', price: 10000, description: 'Streamer uchun quvvat', animClass: 'anim-coffee', glowColor: 'rgba(245, 158, 11, 0.8)' },
  { id: 'chocolate', name: 'Shokolad', icon: '🍫', price: 20000, description: 'Shirin kayfiyat ulashish', animClass: 'anim-chocolate', glowColor: 'rgba(180, 83, 9, 0.8)' },
  { id: 'rocket', name: 'Kosmik Raketa', icon: '🚀', price: 50000, description: 'Efirni koinotga olib chiqish', animClass: 'anim-rocket', glowColor: 'rgba(56, 189, 248, 0.9)' },
  { id: 'crown', name: 'Qirol Toji', icon: '👑', price: 100000, description: 'Haqiqiy VIP ehtirom', animClass: 'anim-crown', glowColor: 'rgba(250, 204, 21, 0.95)' },
  { id: 'supercar', name: 'Sportkar', icon: '🏎️', price: 250000, description: 'Katta tezlik va quvvat', animClass: 'anim-car', glowColor: 'rgba(239, 68, 68, 0.9)' },
  { id: 'diamond', name: 'Katta Olmos', icon: '💎', price: 500000, description: 'Yorqin va bebaho sovg\'a', animClass: 'anim-diamond', glowColor: 'rgba(147, 197, 253, 0.95)' },
  { id: 'castle', name: 'Oltin Qasr', icon: '🏰', price: 1000000, description: 'Eng oliy darajadagi donat', animClass: 'anim-castle', glowColor: 'rgba(245, 158, 11, 1)' }
];

// Web Audio API Cash Chime
function playDonationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const tones = [1046.5, 1318.5, 1567.98];
    tones.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.11);
      gain.gain.setValueAtTime(0.35, ctx.currentTime + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.11 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.11);
      osc.stop(ctx.currentTime + idx * 0.11 + 0.5);
    });
  } catch (e) {
    console.error('Audio chime error:', e);
  }
}

// Natural Human-like Speech Synthesis (Odam o'qigandek)
function speakDonationMessage(userName: string, amount: number, text: string) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance();
    const cleanText = text ? text.replace(/[^\p{L}\p{N}\s,!.?]/gu, '').trim() : '';
    utterance.text = `${userName} ${amount.toLocaleString()} so'm donat qildi. ${cleanText}`;

    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => 
      (v.lang.startsWith('uz') || v.lang.startsWith('ru') || v.lang.startsWith('tr')) &&
      (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Milena') || v.name.includes('Siri') || v.name.includes('Yuri'))
    ) || voices.find(v => v.lang.startsWith('ru') || v.lang.startsWith('uz') || v.lang.startsWith('tr')) || voices[0];

    if (naturalVoice) utterance.voice = naturalVoice;
    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 450);
  } catch (err) {
    console.error('Speech synthesis error:', err);
  }
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

  // Donation States
  const [availableGifts, setAvailableGifts] = useState<DonationGift[]>(DONATION_GIFTS);
  const [showGiftsModal, setShowGiftsModal] = useState<boolean>(false);
  const [donationStep, setDonationStep] = useState<'select' | 'compose' | 'payment' | 'success'>('select');
  const [selectedGift, setSelectedGift] = useState<DonationGift | null>(null);
  const [donationMessage, setDonationMessage] = useState<string>('');
  const [donationPaymentData, setDonationPaymentData] = useState<any | null>(null);
  const [creatingDonation, setCreatingDonation] = useState<boolean>(false);
  const [checkingDonation, setCheckingDonation] = useState<boolean>(false);
  const [checkErrorMessage, setCheckErrorMessage] = useState<string | null>(null);
  const [copiedCard, setCopiedCard] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(30);
  const [currentDonationAlert, setCurrentDonationAlert] = useState<any | null>(null);

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
  const countdownTimerRef = useRef<any>(null);

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

      // Fetch dynamic donation gifts from database
      try {
        const giftsRes = await fetch(`${API_URL}/live/gifts`);
        if (giftsRes.ok) {
          const gData = await giftsRes.json();
          if (gData.gifts && gData.gifts.length > 0) {
            setAvailableGifts(gData.gifts.map((g: any) => ({
              id: g.id || g.giftKey,
              name: g.name,
              icon: g.icon,
              price: g.price,
              description: g.description || '',
              animClass: `anim-${g.animationType || 'bounce'}`,
              glowColor: g.glowColor || 'rgba(245, 158, 11, 0.8)'
            })));
          }
        }
      } catch {}
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

    sse.addEventListener('new_donation', (e: any) => {
      try {
        const donation = JSON.parse(e.data);
        console.log('[LIVE DONATION RECEIVED]', donation);

        // 1. Play audio chime and human-like voice
        playDonationChime();
        speakDonationMessage(donation.userName, donation.amount, donation.message);

        // 2. Show alert banner on top center
        setCurrentDonationAlert(donation);

        // 3. Auto hide after 9 seconds
        setTimeout(() => {
          setCurrentDonationAlert((curr: any) => curr?.id === donation.id ? null : curr);
        }, 9000);
      } catch (err) {
        console.error('new_donation event error:', err);
      }
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
        video: {
          facingMode: facing,
          width: { ideal: 480 },
          height: { ideal: 854 },
          zoom: 1.0
        } as any,
        audio: true
      });

      // Try to reset zoom to 1x if supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities() as any;
          if (capabilities.zoom) {
            await videoTrack.applyConstraints({
              advanced: [{ zoom: capabilities.zoom.min } as any]
            });
          }
        } catch {}
      }

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
    const isTg = typeof window !== 'undefined' && (window as any).Telegram?.WebApp;
    if (isTg && (window as any).Telegram.WebApp.showConfirm) {
      (window as any).Telegram.WebApp.showConfirm("Haqiqatan ham jonli efirni tugatmoqchimisiz?", async (confirmed: boolean) => {
        if (!confirmed) return;
        await executeEndBroadcast();
      });
    } else {
      if (!confirm('Haqiqatan ham jonli efirni tugatmoqchimisiz?')) return;
      await executeEndBroadcast();
    }
  };

  const executeEndBroadcast = async () => {
    try {
      await fetch(`${API_URL}/live/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: liveStream?.id, streamerId: userId })
      });
    } catch (e) {
      console.error('End broadcast error:', e);
    }

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

  // Donation Handlers
  const handleSelectGift = (gift: DonationGift) => {
    setSelectedGift(gift);
    setDonationMessage('');
    setCheckErrorMessage(null);
    setDonationStep('compose');
  };

  const handleProceedToPayment = async () => {
    if (!selectedGift) return;
    setCreatingDonation(true);
    setCheckErrorMessage(null);
    try {
      const res = await fetch(`${API_URL}/live/donate/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          userName: userName || 'Mehmon',
          giftId: selectedGift.id,
          message: donationMessage
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDonationPaymentData(data);
        setDonationStep('payment');
      } else {
        alert(data.error || 'Xatolik yuz berdi');
      }
    } catch (err) {
      alert('Server bilan bog\'lanishda xatolik');
    } finally {
      setCreatingDonation(false);
    }
  };

  const handleCheckPayment = async () => {
    if (!donationPaymentData?.donationId) return;
    setCheckingDonation(true);
    setCheckErrorMessage(null);
    try {
      const res = await fetch(`${API_URL}/live/donate/check/${donationPaymentData.donationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setDonationStep('success');
        setCountdownSeconds(30);
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
          setCountdownSeconds(prev => {
            if (prev <= 1) {
              clearInterval(countdownTimerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setCheckErrorMessage(data.message || 'To\'lov hali tizimda ko\'rinmadi. Iltimos 10-15 soniya kuting yoki qayta tekshiring.');
      }
    } catch (err) {
      setCheckErrorMessage('Server bilan bog\'lanishda xatolik yuz berdi. Qayta urinib ko\'ring.');
    } finally {
      setCheckingDonation(false);
    }
  };

  const handleCopyCard = (num: string) => {
    if (!num) return;
    navigator.clipboard.writeText(num.replace(/\s+/g, '')).catch(() => {});
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2200);
  };

  const handleCloseDonationModal = () => {
    setShowGiftsModal(false);
    setDonationStep('select');
    setSelectedGift(null);
    setDonationMessage('');
    setCheckErrorMessage(null);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

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
          {isBroadcasting && (
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
                title="Kamerani almashtirish"
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
                title="Mikrofon"
              >
                {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            </>
          )}

          {!isBroadcasting && (
            /* Viewer audio mute/unmute */
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
              title="Ovoz"
            >
              {audioMutedForViewer ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          )}

          {/* End Stream Button (Har doim streamer yoki efir egasiga ko'rinadi) */}
          {(isBroadcasting || isStreamer || (liveStream && String(liveStream.streamerId) === String(userId))) && (
            <button
              type="button"
              onClick={handleEndBroadcast}
              style={{
                padding: '7px 14px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                border: '1.5px solid rgba(255,255,255,0.4)',
                color: '#fff',
                fontWeight: '800',
                fontSize: '12px',
                cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(239,68,68,0.6)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Jonli efirni tugatish"
            >
              <span>🛑 Tugatish</span>
            </button>
          )}

          {/* Close Button (Efirdan chiqish) */}
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
            title="Chiqish"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 2.5 DONATION ALERT BANNER (Jonli efirda o'tirgan barchaga chiqadigan chiroyli animatsiyali alert) */}
      {currentDonationAlert && (
        <div style={{
          position: 'absolute',
          top: '72px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 90,
          width: '90%',
          maxWidth: '360px',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95))',
          backdropFilter: 'blur(16px)',
          borderRadius: '18px',
          padding: '12px 16px',
          border: '2px solid rgba(254, 240, 138, 0.9)',
          boxShadow: '0 10px 30px rgba(245, 158, 11, 0.6), 0 0 25px rgba(254, 240, 138, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'donationBannerIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          pointerEvents: 'none'
        }}>
          <div style={{
            fontSize: '36px',
            lineHeight: 1,
            animation: 'bounceGift 1s infinite alternate',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
          }}>
            {currentDonationAlert.giftIcon || '🎁'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '900', fontSize: '13px', color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                {currentDonationAlert.userName}
              </span>
              <span style={{
                background: '#ffffff',
                color: '#b45309',
                fontSize: '11px',
                fontWeight: '800',
                padding: '1px 6px',
                borderRadius: '10px'
              }}>
                {Number(currentDonationAlert.amount).toLocaleString()} so'm
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#fef08a', fontWeight: '700', marginTop: '1px' }}>
              {currentDonationAlert.giftName} sovg'a qildi!
            </div>
            {currentDonationAlert.message && (
              <div style={{
                fontSize: '12px',
                color: '#ffffff',
                fontWeight: '600',
                marginTop: '4px',
                lineHeight: '1.3',
                background: 'rgba(0,0,0,0.2)',
                padding: '4px 8px',
                borderRadius: '8px',
                wordBreak: 'break-word'
              }}>
                "{currentDonationAlert.message}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacer to push comments to bottom */}
      <div style={{ flex: 1 }} />

      {/* 3. Floating Comments Layer (TikTok Live Style — 4 visible + 1 fading) */}
      <div style={{
        position: 'absolute',
        bottom: '80px',
        left: '12px',
        right: '72px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        zIndex: 30,
        pointerEvents: 'none',
      }}>
        {comments.slice(-5).map((c, i, arr) => {
          const isOldest = i === 0 && arr.length === 5;
          return (
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
                animation: isOldest ? 'fadeOutComment 0.5s ease forwards' : 'slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                opacity: isOldest ? 0.3 : 1,
                transition: 'opacity 0.4s ease',
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
          );
        })}
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

        {/* Right Buttons: Donat button on top of Heart button */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0
        }}>
          {/* 1. DONAT BUTTON (Yurakcha tepasida) */}
          <button
            type="button"
            onClick={() => {
              setShowGiftsModal(true);
              setDonationStep('select');
            }}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              border: '2px solid rgba(254, 240, 138, 0.8)',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(245, 158, 11, 0.6)',
              animation: 'pulseDonat 2s infinite',
              gap: '1px'
            }}
            title="Donat qilish"
          >
            <Gift size={18} />
            <span style={{ fontSize: '7.5px', fontWeight: '900', letterSpacing: '0.3px' }}>
              DONAT
            </span>
          </button>

          {/* 2. Floating Heart / Like Button */}
          <button
            type="button"
            onClick={() => handleSendReaction('❤️')}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #ef4444, #f43f5e)',
              border: 'none',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(239, 68, 68, 0.5)'
            }}
          >
            <Heart size={20} fill="#fff" />
          </button>
        </div>
      </div>

      {/* 6. SOVG'ALAR JAVONI VA DANAT MODAL (Jonli efirni to'liq yopmaydi) */}
      {showGiftsModal && (
        <>
          {/* Translucent backdrop (jonli efir orqa fonda ko'rinib turadi) */}
          <div 
            onClick={handleCloseDonationModal}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(3px)',
              zIndex: 100000
            }}
          />

          {/* Bottom Sheet Drawer */}
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: '75vh',
            background: 'linear-gradient(180deg, #131b2e 0%, #0b0f19 100%)',
            borderTop: '2px solid rgba(245, 158, 11, 0.5)',
            borderRadius: '24px 24px 0 0',
            zIndex: 100001,
            overflowY: 'auto',
            padding: '18px 16px 24px 16px',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.8), 0 0 30px rgba(245, 158, 11, 0.2)',
            animation: 'slideUpSheet 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}>
            {/* Grab Handle */}
            <div style={{
              width: '40px',
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255, 255, 255, 0.25)',
              margin: '0 auto 14px auto'
            }} />

            {/* ================= STEP 1: SOVG'ALAR JAVONI ================= */}
            {donationStep === 'select' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🎁</span>
                    <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#fef08a', margin: 0 }}>
                      Sovg'alar javoni (Donat)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseDonationModal}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: '0 0 14px 0' }}>
                  Streamerga sovg'a yuboring! Sovg'angiz efirda chiqadi va xabaringiz ovoz bilan o'qiladi:
                </p>

                {/* Gifts Grid (4 columns) with live animations */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px'
                }}>
                  {availableGifts.map(gift => (
                    <div
                      key={gift.id}
                      onClick={() => handleSelectGift(gift)}
                      className="gift-card-hover"
                      style={{
                        background: 'radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '16px',
                        padding: '10px 4px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.25s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        position: 'relative'
                      }}
                    >
                      <div className={gift.animClass || 'anim-bounce'} style={{
                        fontSize: '32px',
                        lineHeight: 1,
                        filter: `drop-shadow(0 0 10px ${gift.glowColor || 'rgba(245, 158, 11, 0.8)'})`,
                        display: 'inline-block'
                      }}>
                        {gift.icon}
                      </div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {gift.name}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        fontWeight: '800',
                        color: '#fef08a',
                        background: 'rgba(245, 158, 11, 0.2)',
                        padding: '1px 6px',
                        borderRadius: '10px'
                      }}>
                        {gift.price.toLocaleString()} so'm
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ================= STEP 2: TANLANGAN SOVG'A VA XABAR YOZISH ================= */}
            {donationStep === 'compose' && selectedGift && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <button
                    type="button"
                    onClick={() => setDonationStep('select')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '13px',
                      fontWeight: '700',
                      padding: 0
                    }}
                  >
                    <ArrowLeft size={16} /> Sovg'alar
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseDonationModal}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Tanlangan sovg'a ekran o'rtasiga kattalashib va aylanuvchi nur bilan kelgan holati */}
                <div style={{
                  textAlign: 'center',
                  padding: '18px 12px',
                  background: 'radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, rgba(0,0,0,0) 70%)',
                  borderRadius: '16px',
                  marginBottom: '14px',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  {/* Rotating Sunburst Halo Background */}
                  <div style={{
                    position: 'absolute',
                    top: '40%',
                    left: '50%',
                    width: '160px',
                    height: '160px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(254, 240, 138, 0.4) 0%, rgba(245, 158, 11, 0.1) 50%, rgba(0,0,0,0) 70%)',
                    transform: 'translate(-50%, -50%)',
                    animation: 'pulseGlow 2s infinite alternate',
                    pointerEvents: 'none'
                  }} />

                  <div className={selectedGift.animClass || 'anim-bounce'} style={{
                    fontSize: '72px',
                    lineHeight: 1,
                    animation: 'bigGiftCelebration 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                    filter: `drop-shadow(0 0 20px ${selectedGift.glowColor || 'rgba(245, 158, 11, 0.9)'})`,
                    display: 'inline-block',
                    position: 'relative',
                    zIndex: 2
                  }}>
                    {selectedGift.icon}
                  </div>
                  <h4 style={{ fontSize: '18px', fontWeight: '900', color: '#fff', margin: '10px 0 3px 0', position: 'relative', zIndex: 2 }}>
                    {selectedGift.name}
                  </h4>
                  <div style={{
                    display: 'inline-block',
                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(217, 119, 6, 0.3))',
                    border: '1.5px solid rgba(254, 240, 138, 0.7)',
                    color: '#fef08a',
                    fontWeight: '900',
                    fontSize: '14px',
                    padding: '3px 14px',
                    borderRadius: '20px',
                    boxShadow: '0 2px 10px rgba(245, 158, 11, 0.3)',
                    position: 'relative',
                    zIndex: 2
                  }}>
                    {selectedGift.price.toLocaleString()} so'm
                  </div>
                </div>

                {/* Xabar yozish joyi */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginBottom: '6px' }}>
                    Jonli efirda o'qib beriladigan xabar:
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Efirda ovoz bilan o'qib beriladigan xabaringizni yozing..."
                    value={donationMessage}
                    onChange={e => setDonationMessage(e.target.value)}
                    maxLength={200}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                      resize: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                    {donationMessage.length}/200
                  </div>
                </div>

                {/* Danat qilish tugmasi */}
                <button
                  type="button"
                  onClick={handleProceedToPayment}
                  disabled={creatingDonation}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: '15px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 18px rgba(245, 158, 11, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  {creatingDonation ? (
                    <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
                  ) : (
                    <>
                      <span>💳 Donat qilish ({selectedGift.price.toLocaleString()} so'm)</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* ================= STEP 3: TO'LOV QILISH SAHIFASI ================= */}
            {donationStep === 'payment' && donationPaymentData && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '18px' }}>💳</span>
                    <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#fff', margin: 0 }}>
                      To'lov qilish
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseDonationModal}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* To'lov summasi */}
                <div style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  borderRadius: '14px',
                  padding: '12px',
                  textAlign: 'center',
                  marginBottom: '12px'
                }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontWeight: '600' }}>
                    O'tkazish summasi (aynan shu summani o'tkazing):
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#fef08a', margin: '4px 0' }}>
                    {donationPaymentData.amount.toLocaleString()} so'm
                  </div>
                  <div style={{ fontSize: '10.5px', color: '#f59e0b', fontWeight: '600' }}>
                    ⚠️ To'lov avtomatik aniqlanishi uchun bir tiyingacha to'g'ri o'tkazing!
                  </div>
                </div>

                {/* Karta ma'lumotlari */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  marginBottom: '12px'
                }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                    Qabul qiluvchi karta:
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ fontSize: '16px', fontWeight: '800', letterSpacing: '1px', color: '#fff' }}>
                      {donationPaymentData.cardNumber || 'Karta topilmadi'}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyCard(donationPaymentData.cardNumber)}
                      style={{
                        background: copiedCard ? '#22c55e' : 'rgba(56, 189, 248, 0.2)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: copiedCard ? '#fff' : '#38bdf8',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {copiedCard ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedCard ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  {donationPaymentData.cardHolder && (
                    <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.7)', marginTop: '4px' }}>
                      {donationPaymentData.cardHolder} {donationPaymentData.bankName ? `(${donationPaymentData.bankName})` : ''}
                    </div>
                  )}
                </div>

                {/* Click orqali to'lash (agar mavjud bo'lsa) */}
                {donationPaymentData.clickP2pUrl && (
                  <div style={{ marginBottom: '12px' }}>
                    <a
                      href={donationPaymentData.clickP2pUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '12px',
                        borderRadius: '12px',
                        background: '#00a5ff',
                        color: '#fff',
                        fontWeight: '800',
                        fontSize: '13px',
                        textDecoration: 'none',
                        boxShadow: '0 4px 15px rgba(0, 165, 255, 0.4)'
                      }}
                    >
                      <span>📲 Click orqali to'lash</span>
                    </a>
                  </div>
                )}

                {/* Xatolik xabari (agar to'lov hali tushmagan bo'lsa) */}
                {checkErrorMessage && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#fca5a5',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    fontSize: '12px',
                    marginBottom: '12px',
                    lineHeight: '1.4'
                  }}>
                    {checkErrorMessage}
                  </div>
                )}

                {/* To'lov qildim tugmasi */}
                <button
                  type="button"
                  onClick={handleCheckPayment}
                  disabled={checkingDonation}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: '15px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 18px rgba(34, 197, 94, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  {checkingDonation ? (
                    <>
                      <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
                      <span>To'lov tekshirilmoqda...</span>
                    </>
                  ) : (
                    <>
                      <span>✅ To'lov qildim</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* ================= STEP 4: TO'LOV QABUL QILINDI ANIMATSIYASI ================= */}
            {donationStep === 'success' && (
              <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                {/* Oltin yulduzlar va konfeti emojilari */}
                <div style={{ fontSize: '48px', animation: 'bounceGift 1s infinite alternate', marginBottom: '8px' }}>
                  🎉✨👑
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: '900', color: '#fef08a', margin: '0 0 6px 0' }}>
                  To'lovingiz qabul qilindi!
                </h3>
                <p style={{ fontSize: '13px', color: '#ffffff', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                  Donatingiz <span style={{ color: '#f59e0b', fontWeight: '800' }}>{countdownSeconds} sekunddan</span> keyin jonli efirda chiqadi va ovoz bilan o'qib beriladi!
                </p>

                {/* Katta doiraviy countdown taymer */}
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  border: '3px solid #f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px auto',
                  background: 'rgba(245, 158, 11, 0.1)',
                  boxShadow: '0 0 25px rgba(245, 158, 11, 0.5)'
                }}>
                  <span style={{ fontSize: '32px', fontWeight: '900', color: '#fef08a' }}>
                    {countdownSeconds}
                  </span>
                </div>

                {/* Jonli efirga qaytish tugmasi */}
                <button
                  type="button"
                  onClick={handleCloseDonationModal}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: '15px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 18px rgba(56, 189, 248, 0.4)'
                  }}
                >
                  🎥 Jonli efirga qaytish
                </button>
              </div>
            )}
          </div>
        </>
      )}

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
        @keyframes fadeOutComment {
          0% {
            opacity: 0.3;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-10px);
            max-height: 0;
            padding: 0;
            margin: 0;
            overflow: hidden;
          }
        }
        @keyframes pulseDonat {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.6);
          }
          50% {
            transform: scale(1.08);
            box-shadow: 0 4px 22px rgba(245, 158, 11, 0.9), 0 0 10px rgba(254, 240, 138, 0.7);
          }
        }
        @keyframes popInGift {
          0% {
            transform: scale(0.4);
            opacity: 0;
          }
          70% {
            transform: scale(1.15);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes slideUpSheet {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        @keyframes donationBannerIn {
          from {
            opacity: 0;
            transform: translate(-50%, -20px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
        }
        @keyframes bounceGift {
          from {
            transform: translateY(0) scale(1);
          }
          to {
            transform: translateY(-6px) scale(1.08);
          }
        }

        .anim-bounce { animation: animBounce 1.4s ease-in-out infinite alternate; }
        .anim-sway { animation: animSway 2.2s ease-in-out infinite alternate; }
        .anim-fly { animation: animFly 1.8s ease-in-out infinite alternate; }
        .anim-spin { animation: animSpin 5s linear infinite; }
        .anim-pulse { animation: animPulse 1.6s ease-in-out infinite; }
        .anim-shake { animation: animShake 0.8s ease-in-out infinite; }

        @keyframes animBounce {
          0% { transform: translateY(0) scale(1); }
          100% { transform: translateY(-8px) scale(1.1); }
        }
        @keyframes animSway {
          0% { transform: rotate(-10deg) scale(1); }
          100% { transform: rotate(10deg) scale(1.08); }
        }
        @keyframes animFly {
          0% { transform: translate(0, 0) rotate(-15deg); }
          100% { transform: translate(3px, -8px) rotate(-10deg); }
        }
        @keyframes animSpin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.1); }
          100% { transform: rotate(360deg) scale(1); }
        }
        @keyframes animPulse {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes animShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px) rotate(-2deg); }
          75% { transform: translateX(3px) rotate(2deg); }
        }
        @keyframes bigGiftCelebration {
          0% { transform: scale(0.3) rotate(-20deg); opacity: 0; }
          60% { transform: scale(1.3) rotate(8deg); opacity: 1; }
          80% { transform: scale(0.95) rotate(-3deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes pulseGlow {
          0% { opacity: 0.4; transform: translate(-50%, -50%) scale(0.85); }
          100% { opacity: 0.85; transform: translate(-50%, -50%) scale(1.15); }
        }
        .gift-card-hover:active {
          transform: scale(0.94);
        }
      `}</style>
    </div>
  );
}
