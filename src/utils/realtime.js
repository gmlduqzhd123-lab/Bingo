const SUPABASE_WS = 'wss://oaavmecavooowuayjxjn.supabase.co/realtime/v1/websocket';
const SUPABASE_KEY = 'sb_publishable_w8zpvaF_wge0pAVJy661gA_bSGnFEn9';

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
  let closed = false;

  const setStatus = st => { if (typeof onStatus === 'function') onStatus(st); };
  setStatus('connecting');

  const ws = new WebSocket(url);

  const sendRaw = (event, payload, tgtTopic = topic) => {
    if (closed || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ topic: tgtTopic, event, payload, ref: String(refCounter++) }));
    return true;
  };

  ws.onopen = () => {
    if (closed) { try { ws.close(); } catch {} return; }
    sendRaw('phx_join', { config: { broadcast: { self: false, ack: false } } });
    hbTimer = setInterval(() => {
      sendRaw('heartbeat', {}, 'phoenix');
    }, 25000);
  };

  ws.onmessage = ev => {
    if (closed) return;
    try {
      const msg = JSON.parse(String(ev.data || '{}'));
      if (msg.event === 'phx_reply' && msg.topic === topic) {
        if (msg.payload && msg.payload.status === 'ok') setStatus('connected');
        else setStatus('error');
        return;
      }
      if (msg.event === 'broadcast' && msg.payload && msg.payload.event) {
        if (typeof onMessage === 'function') onMessage(msg.payload.event, msg.payload.payload || {});
      }
    } catch {}
  };

  ws.onerror = () => {
    if (!closed) setStatus('error');
  };

  ws.onclose = () => {
    clearInterval(hbTimer);
    hbTimer = null;
    if (!closed) setStatus('closed');
  };

  return {
    code,
    send(event, payload = {}) {
      return sendRaw('broadcast', { type: 'broadcast', event, payload });
    },
    close() {
      closed = true;
      clearInterval(hbTimer);
      hbTimer = null;
      try { ws.close(); } catch {}
    }
  };
}
