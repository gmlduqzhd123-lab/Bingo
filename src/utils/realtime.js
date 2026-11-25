const SUPABASE_WS = 'wss://oaavmecavooowuayjxjn.supabase.co/realtime/v1/websocket';
const SUPABASE_KEY = 'sb_publishable_w8zpvaF_wge0pAVJy661gA_bSGnFEn9';

export const RECONNECT_BACKOFFS = [1500, 3000, 6000, 10000];

export function getReconnectDelay(attempt) {
  const idx = Math.max(0, Math.min(RECONNECT_BACKOFFS.length - 1, Number(attempt) || 0));
  return RECONNECT_BACKOFFS[idx];
}

export function normalizeRoomCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z2-9]{6}$/.test(s) ? s : '';
}

export function createLiveChannel(roomCode, { onMessage, onStatus } = {}) {
  const code = normalizeRoomCode(roomCode);
  if (!code) throw new Error('INVALID_ROOM_CODE');
  const topic = `realtime:bingo-room-${code}`;
  const url = `${SUPABASE_WS}?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`;
  let refCounter = 1;
  let hbTimer = null;
  let reconnTimer = null;
  let closed = false;
  let everConnected = false;
  let attempt = 0;
  let ws = null;

  const setStatus = st => { if (typeof onStatus === 'function') onStatus(st); };

  const clearTimers = () => {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
  };

  const sendRaw = (event, payload, tgtTopic = topic) => {
    if (closed || !ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ topic: tgtTopic, event, payload, ref: String(refCounter++) }));
    return true;
  };

  const connect = () => {
    if (closed) return;
    clearTimers();
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    const curWs = new WebSocket(url);
    ws = curWs;

    curWs.onopen = () => {
      if (closed || ws !== curWs) { try { curWs.close(); } catch {} return; }
      sendRaw('phx_join', { config: { broadcast: { self: false, ack: false } } });
      hbTimer = setInterval(() => {
        sendRaw('heartbeat', {}, 'phoenix');
      }, 25000);
    };

    curWs.onmessage = ev => {
      if (closed || ws !== curWs) return;
      try {
        const msg = JSON.parse(String(ev.data || '{}'));
        if (msg.event === 'phx_reply' && msg.topic === topic) {
          if (msg.payload && msg.payload.status === 'ok') {
            everConnected = true;
            attempt = 0;
            setStatus('connected');
          } else {
            setStatus('error');
          }
          return;
        }
        if (msg.event === 'broadcast' && msg.payload && msg.payload.event) {
          if (typeof onMessage === 'function') onMessage(msg.payload.event, msg.payload.payload || {});
        }
      } catch {}
    };

    curWs.onerror = () => {
      if (closed || ws !== curWs) return;
      setStatus(everConnected ? 'reconnecting' : 'error');
    };

    curWs.onclose = () => {
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
      if (closed || ws !== curWs) return;
      const delay = getReconnectDelay(attempt++);
      setStatus('reconnecting');
      reconnTimer = setTimeout(() => {
        reconnTimer = null;
        if (!closed) connect();
      }, delay);
    };
  };

  connect();

  return {
    code,
    send(event, payload = {}) {
      return sendRaw('broadcast', { type: 'broadcast', event, payload });
    },
    reconnect() {
      if (closed) return;
      attempt = 0;
      if (ws) { try { ws.close(); } catch {} }
      else connect();
    },
    close() {
      closed = true;
      clearTimers();
      if (ws) { try { ws.close(); } catch {} ws = null; }
    }
  };
}
