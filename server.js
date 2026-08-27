const path = require('path');
const http = require('http');
const crypto = require('crypto');
const dns = require('dns').promises;
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// How long a member keeps their seat after their socket drops, so a page
// reload does not look like leaving.
const GRACE_MS = 90000;
const VOTE_KICK_MS = 60000;
// Generous rather than unlimited: past this a poll stops being readable.
const MAX_POLL_OPTIONS = 20;
// A base64 data URL is about a third bigger than the bytes it carries, so
// this lands near 150KB of actual image.
const MAX_IMAGE_CHARS = 200000;
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
// Enough for a shrunk sticker plus signalling, far short of anything that
// could be used to push the process over.
const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 });

const sessions = new Map(); // code -> session
const sockets = new Map();  // ws -> { code, memberId }

// No 0/O/1/I so codes stay easy to read out loud over a call.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(6))
      .map((b) => ALPHABET[b % ALPHABET.length])
      .join('');
  } while (sessions.has(code));
  return code;
}

// Behind the Cloudflare tunnel or a platform proxy the socket address is the
// proxy's, so the forwarded header is the only real one. It is only
// trustworthy because nothing reaches this process except through that proxy;
// exposed directly, a client could set it to anything.
function clientIp(req) {
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

// Loopback means everyone testing on this machine shares one address, so
// banning it would lock the host out of their own session.
function bannableIp(ip) {
  if (!ip) return null;
  const bare = ip.replace(/^::ffff:/, '');
  if (bare === '127.0.0.1' || bare === '::1' || bare === 'localhost') return null;
  return bare;
}

// Checking a link means this process fetches an address someone typed, so it
// must never be talked into reaching something on the private network. Every
// hop is resolved and checked before it is followed.
function isPublicAddress(ip) {
  const bare = String(ip).replace(/^::ffff:/, '');
  if (/^(127\.|0\.|10\.|169\.254\.|192\.168\.)/.test(bare)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return false;
  if (bare === '::1' || bare === '::') return false;
  if (/^f[cd]/i.test(bare) || /^fe[89ab]/i.test(bare)) return false;
  return true;
}

async function resolvesPublicly(hostname) {
  try {
    const found = await dns.lookup(hostname, { all: true });
    return found.length > 0 && found.every((entry) => isPublicAddress(entry.address));
  } catch {
    return false;
  }
}

// Follows redirects by hand so each destination can be vetted in turn.
async function inspectUrl(raw, hops = 3) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid web address.' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https addresses work.' };
  }
  if (!(await resolvesPublicly(target.hostname))) {
    return { ok: false, reason: 'That address does not point anywhere public.' };
  }

  let res;
  try {
    res = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return { ok: false, reason: 'Could not reach that address.' };
  }

  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get('location');
    if (!next || hops <= 0) return { ok: false, reason: 'That address redirects too many times.' };
    return inspectUrl(new URL(next, target).toString(), hops - 1);
  }

  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('video/')) return { ok: true, contentType: type };
  if (type.startsWith('text/html')) {
    return {
      ok: false, contentType: type,
      reason: 'That is a web page, not a video file. Services like SwissTransfer or WeTransfer give you a download page - the file itself has to be downloaded first, then shared with "we both have the file".'
    };
  }
  return {
    ok: false, contentType: type,
    reason: `That address serves ${type || 'something unrecognised'}, not a video.`
  };
}

function cleanName(name) {
  return String(name || 'Guest').trim().slice(0, 24) || 'Guest';
}

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(session, payload, exceptId) {
  for (const member of session.members.values()) {
    if (member.id === exceptId) continue;
    send(member.ws, payload);
  }
}

/* ------------------------------------------------------------------ */
/* shape of things                                                     */
/* ------------------------------------------------------------------ */

function hostMuted(member) {
  return member.hostMuted || member.muteUntil > Date.now();
}

function memberView(session, member) {
  return {
    id: member.id,
    name: member.name,
    companion: member.companion,
    online: !!member.ws,
    isHost: session.hostId === member.id,
    chatBlocked: member.chatBlocked,
    selfMuted: member.selfMuted,
    hostMuted: hostMuted(member),
    muteUntil: member.muteUntil > Date.now() ? member.muteUntil : 0,
    wantsHost: session.hostRequests.has(member.id)
  };
}

function roster(session) {
  return [...session.members.values()].map((m) => memberView(session, m));
}

function banList(session) {
  return session.bans.map((b) => ({ token: b.token, name: b.name, at: b.at, byIp: !!b.ip }));
}

function isBanned(session, token, ip) {
  const bare = bannableIp(ip);
  return session.bans.some((b) => (token && b.token === token) || (bare && b.ip === bare));
}

function pollView(session) {
  if (!session.poll) return null;
  return {
    id: session.poll.id,
    question: session.poll.question,
    open: session.poll.open,
    options: session.poll.options.map((o) => ({ text: o.text, votes: o.votes.size })),
    total: session.poll.options.reduce((n, o) => n + o.votes.size, 0)
  };
}

function voteKickView(session) {
  const vk = session.voteKick;
  if (!vk) return null;
  const target = session.members.get(vk.targetId);
  return {
    targetId: vk.targetId,
    targetName: target ? target.name : 'Someone',
    startedBy: vk.startedByName,
    yes: vk.yes.size,
    no: vk.no.size,
    needed: vk.needed,
    expiresAt: vk.expiresAt
  };
}

function sessionInfo(session) {
  return {
    code: session.code,
    title: session.title,
    isPublic: session.isPublic,
    hostId: session.hostId,
    source: session.source,
    config: session.config
  };
}

function pushRoster(session) {
  broadcast(session, {
    t: 'roster', members: roster(session), hostId: session.hostId, bans: banList(session)
  });
}

/* ------------------------------------------------------------------ */
/* public listing                                                      */
/* ------------------------------------------------------------------ */

app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const session of sessions.values()) {
    if (!session.isPublic) continue;
    const host = session.members.get(session.hostId);
    list.push({
      code: session.code,
      title: session.title,
      source: session.source,
      hostName: host ? host.name : 'Host',
      count: [...session.members.values()].filter((m) => !m.companion).length,
      createdAt: session.createdAt
    });
  }
  res.json({ sessions: list.sort((a, b) => b.createdAt - a.createdAt) });
});

app.get('/api/health', (req, res) => res.json({ ok: true, sessions: sessions.size }));

/* ------------------------------------------------------------------ */
/* membership                                                          */
/* ------------------------------------------------------------------ */

function newMember(name, companion, ip) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(24).toString('hex'),
    ip: ip || '',
    name: cleanName(name),
    companion: !!companion,
    ws: null,
    chatBlocked: false,
    hostMuted: false,
    muteUntil: 0,
    selfMuted: false,
    dropTimer: null,
    joinedAt: Date.now()
  };
}

function destroySession(session, reason) {
  broadcast(session, { t: 'session-closed', reason: reason || 'The host ended the session.' });
  for (const member of session.members.values()) {
    clearTimeout(member.dropTimer);
    if (member.ws) sockets.delete(member.ws);
  }
  if (session.voteKick) clearTimeout(session.voteKick.timer);
  sessions.delete(session.code);
}

// Picks the member who has been here longest, so the room keeps going when a
// host disappears without handing over.
function nextHost(session, excludeId) {
  const candidates = [...session.members.values()]
    .filter((m) => m.id !== excludeId && !m.companion)
    .sort((a, b) => (b.online === a.online ? a.joinedAt - b.joinedAt : (b.ws ? 1 : 0) - (a.ws ? 1 : 0)));
  return candidates[0] || null;
}

function setHost(session, memberId) {
  session.hostId = memberId;
  session.hostRequests.delete(memberId);
  const host = session.members.get(memberId);
  const name = host ? host.name : 'Someone';
  broadcast(session, { t: 'host-changed', hostId: memberId, name });
  broadcast(session, { t: 'system', text: `${name} is now the host.` });
  pushRoster(session);
}

function removeMember(session, member, reason) {
  clearTimeout(member.dropTimer);
  session.members.delete(member.id);
  session.hostRequests.delete(member.id);
  if (member.ws) sockets.delete(member.ws);

  if (session.voteKick && session.voteKick.targetId === member.id) {
    clearTimeout(session.voteKick.timer);
    session.voteKick = null;
    broadcast(session, { t: 'votekick', vote: null });
  }

  broadcast(session, { t: 'peer-leave', id: member.id, name: member.name, reason });

  if (session.members.size === 0) {
    if (session.voteKick) clearTimeout(session.voteKick.timer);
    sessions.delete(session.code);
    return;
  }
  if (session.hostId === member.id) {
    const heir = nextHost(session, member.id);
    if (heir) setHost(session, heir.id);
    else destroySession(session, 'Everyone watching has left.');
    return;
  }
  pushRoster(session);
}

// A dropped socket keeps its seat for a while: reloading a page should not
// cost you the room.
function handleDisconnect(ws) {
  const link = sockets.get(ws);
  sockets.delete(ws);
  if (!link) return;
  const session = sessions.get(link.code);
  if (!session) return;
  const member = session.members.get(link.memberId);
  if (!member || member.ws !== ws) return;

  member.ws = null;
  broadcast(session, { t: 'peer-offline', id: member.id });
  pushRoster(session);

  member.dropTimer = setTimeout(() => {
    if (member.ws) return;
    removeMember(session, member, 'left');
  }, GRACE_MS);
}

function attach(ws, session, member) {
  clearTimeout(member.dropTimer);
  member.dropTimer = null;
  if (member.ws && member.ws !== ws) {
    // Same person opened the room twice in one role; drop the older socket.
    sockets.delete(member.ws);
    send(member.ws, { t: 'session-closed', reason: 'You opened this session in another tab.' });
  }
  member.ws = ws;
  sockets.set(ws, { code: session.code, memberId: member.id });
}

function joinPayload(session, member) {
  return {
    t: 'joined',
    you: member.id,
    token: member.token,
    session: sessionInfo(session),
    peers: roster(session).filter((m) => m.id !== member.id),
    youtubeId: session.youtubeId,
    mediaUrl: session.mediaUrl,
    streamKind: session.streamKind,
    poll: pollView(session),
    voteKick: voteKickView(session),
    bans: banList(session),
    me: memberView(session, member)
  };
}

/* ------------------------------------------------------------------ */
/* vote to kick                                                        */
/* ------------------------------------------------------------------ */

function eligibleVoters(session, targetId) {
  return [...session.members.values()].filter(
    (m) => !m.companion && m.id !== targetId && m.ws
  );
}

function settleVoteKick(session) {
  const vk = session.voteKick;
  if (!vk) return;
  const target = session.members.get(vk.targetId);

  if (vk.yes.size >= vk.needed && target) {
    clearTimeout(vk.timer);
    session.voteKick = null;
    broadcast(session, { t: 'votekick', vote: null });
    broadcast(session, { t: 'system', text: `${target.name} was voted out.` });
    send(target.ws, { t: 'kicked', reason: 'The room voted to remove you.' });
    session.bans.push({
      token: target.token,
      ip: bannableIp(target.ip),
      name: target.name,
      at: Date.now()
    });
    removeMember(session, target, 'voted out');
    return;
  }
  broadcast(session, { t: 'votekick', vote: voteKickView(session) });
}

/* ------------------------------------------------------------------ */
/* socket handling                                                     */
/* ------------------------------------------------------------------ */

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'hello' });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    /* ---------- entering ---------- */

    if (msg.t === 'create') {
      handleDisconnect(ws);
      const member = newMember(msg.name, false, ws.ip);
      const session = {
        code: makeCode(),
        title: String(msg.title || 'Movie night').trim().slice(0, 60) || 'Movie night',
        isPublic: !!msg.isPublic,
        // 'file' streams the host's picture out; 'sync' keeps everyone's own
        // copy in step and sends no video at all.
        source: ['youtube', 'sync', 'embed'].includes(msg.source) ? msg.source : 'file',
        youtubeId: null,
        mediaUrl: null,
        streamKind: null,
        createdAt: Date.now(),
        hostId: member.id,
        config: { chatOpen: true, lockControls: false, muteAll: false },
        members: new Map([[member.id, member]]),
        bans: [],   // { token, ip, name, at }
        poll: null,
        voteKick: null,
        hostRequests: new Set()
      };
      sessions.set(session.code, session);
      attach(ws, session, member);
      send(ws, joinPayload(session, member));
      return;
    }

    if (msg.t === 'join' || msg.t === 'rejoin') {
      const code = String(msg.code || '').trim().toUpperCase();
      const session = sessions.get(code);
      if (!session) {
        send(ws, { t: 'error', message: 'No session with that code. It may have ended.', fatal: true });
        return;
      }

      if (msg.t === 'rejoin') {
        if (isBanned(session, msg.token, ws.ip)) {
          send(ws, { t: 'error', message: 'You are banned from this session.', fatal: true });
          return;
        }
        const existing = [...session.members.values()].find((m) => m.token === msg.token);
        if (!existing) {
          send(ws, { t: 'error', message: 'That session moved on without you.', fatal: true });
          return;
        }
        handleDisconnect(ws);
        attach(ws, session, existing);
        send(ws, joinPayload(session, existing));
        broadcast(session, { t: 'peer-reset', id: existing.id }, existing.id);
        pushRoster(session);
        return;
      }

      if (isBanned(session, msg.token, ws.ip)) {
        send(ws, { t: 'error', message: 'You are banned from this session.', fatal: true });
        return;
      }

      handleDisconnect(ws);
      const member = newMember(msg.name, msg.companion, ws.ip);
      session.members.set(member.id, member);
      attach(ws, session, member);
      send(ws, joinPayload(session, member));
      broadcast(session, {
        t: 'peer-join',
        peer: memberView(session, member)
      }, member.id);
      pushRoster(session);
      return;
    }

    /* ---------- in a session ---------- */

    const link = sockets.get(ws);
    if (!link) return;
    const session = sessions.get(link.code);
    if (!session) return;
    const me = session.members.get(link.memberId);
    if (!me) return;
    const isHost = session.hostId === me.id;
    const target = msg.id ? session.members.get(msg.id) : null;

    switch (msg.t) {
      /* ----- media plumbing ----- */

      case 'signal': {
        const peer = session.members.get(msg.to);
        if (peer) send(peer.ws, { t: 'signal', from: me.id, data: msg.data });
        break;
      }

      case 'progress': {
        if (!isHost) break;
        broadcast(session, {
          t: 'progress',
          time: Number(msg.time) || 0,
          duration: Number(msg.duration) || 0,
          paused: !!msg.paused
        }, me.id);
        break;
      }

      case 'source': {
        if (!isHost) break;
        // A shared link is fetched by each person from wherever it is hosted,
        // so it only has to be a real http(s) address. Anything else is
        // refused rather than handed to everybody's video element.
        if (msg.url !== undefined) {
          let clean = null;
          if (msg.url) {
            try {
              const parsed = new URL(String(msg.url));
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                clean = parsed.toString().slice(0, 2000);
              }
            } catch {
              clean = null;
            }
            if (!clean) {
              send(ws, { t: 'error', message: 'That does not look like a web address.' });
              break;
            }
          }
          session.mediaUrl = clean;
        }
        session.youtubeId = msg.youtubeId || null;
        session.streamKind = msg.kind || null;
        session.title = String(msg.title || session.title).trim().slice(0, 60);
        broadcast(session, {
          t: 'source',
          youtubeId: session.youtubeId,
          mediaUrl: session.mediaUrl,
          kind: session.streamKind,
          title: session.title
        }, me.id);
        break;
      }

      case 'control': {
        if (session.config.lockControls && !isHost) {
          send(ws, { t: 'error', message: 'The host locked the playback controls.' });
          break;
        }
        broadcast(session, {
          t: 'control',
          from: me.id,
          name: me.name,
          action: msg.action,
          time: Number(msg.time) || 0
        }, me.id);
        break;
      }

      /* ----- talking ----- */

      case 'chat': {
        const text = String(msg.text || '').slice(0, 500);
        let image = null;
        if (typeof msg.image === 'string' && msg.image) {
          if (!IMAGE_URL.test(msg.image)) break;
          if (msg.image.length > MAX_IMAGE_CHARS) {
            send(ws, { t: 'error', message: 'That image is too big to send.' });
            break;
          }
          image = msg.image;
        }
        if (!text.trim() && !image) break;
        if (me.chatBlocked) {
          send(ws, { t: 'error', message: 'The host blocked you from the chat.' });
          break;
        }
        if (!session.config.chatOpen && !isHost) {
          send(ws, { t: 'error', message: 'The chat is closed.' });
          break;
        }
        let replyTo = null;
        if (msg.replyTo && msg.replyTo.id) {
          replyTo = {
            id: String(msg.replyTo.id).slice(0, 40),
            name: String(msg.replyTo.name || '').slice(0, 24),
            text: String(msg.replyTo.text || '').slice(0, 120)
          };
        }
        broadcast(session, {
          t: 'chat',
          id: crypto.randomUUID(),
          from: me.id,
          name: me.name,
          text,
          image,
          replyTo,
          ts: Date.now()
        }, me.id);
        break;
      }

      case 'reaction': {
        if (me.chatBlocked) break;
        broadcast(session, {
          t: 'reaction', from: me.id, name: me.name, emoji: String(msg.emoji || '').slice(0, 8)
        }, me.id);
        break;
      }

      case 'selfMute': {
        me.selfMuted = !!msg.muted;
        pushRoster(session);
        break;
      }

      /* ----- leaving ----- */

      case 'leave': {
        if (isHost && msg.destroy) {
          destroySession(session, 'The host ended the session.');
          break;
        }
        if (isHost && msg.transferTo && session.members.has(msg.transferTo)) {
          setHost(session, msg.transferTo);
        }
        removeMember(session, me, 'left');
        break;
      }

      /* ----- host powers ----- */

      case 'host:config': {
        if (!isHost) break;
        if (typeof msg.chatOpen === 'boolean') session.config.chatOpen = msg.chatOpen;
        if (typeof msg.lockControls === 'boolean') session.config.lockControls = msg.lockControls;
        if (typeof msg.muteAll === 'boolean') session.config.muteAll = msg.muteAll;
        broadcast(session, { t: 'config', config: session.config, by: me.name });
        pushRoster(session);
        break;
      }

      // Nothing can drive a page from another site, so the room counts down
      // together instead and everyone presses play on the same beat.
      case 'checkUrl': {
        if (!isHost) break;
        const verdict = await inspectUrl(String(msg.url || ''));
        send(ws, { t: 'urlCheck', url: msg.url, ...verdict });
        break;
      }

      case 'countdown': {
        if (!isHost) break;
        broadcast(session, { t: 'countdown', from: me.name, at: Date.now() + 3200 });
        break;
      }

      case 'host:rename': {
        if (!isHost) break;
        const title = String(msg.title || '').trim().slice(0, 60);
        if (!title || title === session.title) break;
        session.title = title;
        broadcast(session, { t: 'renamed', title, by: me.name });
        broadcast(session, { t: 'system', text: `${me.name} renamed the session to "${title}".` });
        break;
      }

      case 'host:mute': {
        if (!isHost || !target || target.id === me.id) break;
        const seconds = Number(msg.seconds) || 0;
        if (seconds > 0) {
          target.muteUntil = Date.now() + seconds * 1000;
          target.hostMuted = false;
        } else {
          target.hostMuted = true;
          target.muteUntil = 0;
        }
        send(target.ws, { t: 'you-muted', seconds, by: me.name });
        pushRoster(session);
        break;
      }

      case 'host:unmute': {
        if (!isHost || !target) break;
        // Deliberately does not touch selfMuted: only they can undo that.
        target.hostMuted = false;
        target.muteUntil = 0;
        send(target.ws, { t: 'you-unmuted', by: me.name });
        pushRoster(session);
        break;
      }

      case 'host:blockChat': {
        if (!isHost || !target || target.id === me.id) break;
        target.chatBlocked = !!msg.blocked;
        send(target.ws, { t: 'chat-block', blocked: target.chatBlocked, by: me.name });
        pushRoster(session);
        break;
      }

      case 'host:kick': {
        if (!isHost || !target || target.id === me.id) break;
        // A kick is a door, not a wall: they can come back if they behave.
        send(target.ws, { t: 'kicked', reason: 'The host removed you from the session.' });
        broadcast(session, { t: 'system', text: `${target.name} was removed by the host.` });
        removeMember(session, target, 'removed');
        break;
      }

      case 'host:ban': {
        if (!isHost || !target || target.id === me.id) break;
        session.bans.push({
          token: target.token,
          ip: bannableIp(target.ip),
          name: target.name,
          at: Date.now()
        });
        send(target.ws, { t: 'kicked', reason: 'The host banned you from this session.' });
        broadcast(session, { t: 'system', text: `${target.name} was banned by the host.` });
        removeMember(session, target, 'banned');
        break;
      }

      case 'host:unban': {
        if (!isHost) break;
        const before = session.bans.length;
        session.bans = session.bans.filter((b) => b.token !== msg.token);
        if (session.bans.length !== before) {
          broadcast(session, { t: 'system', text: 'A ban was lifted.' });
          pushRoster(session);
        }
        break;
      }

      case 'host:transfer': {
        if (!isHost || !target || target.companion) break;
        setHost(session, target.id);
        break;
      }

      /* ----- asking for the host role ----- */

      case 'hostRequest': {
        if (isHost || me.companion) break;
        session.hostRequests.add(me.id);
        const host = session.members.get(session.hostId);
        send(host && host.ws, { t: 'host-request', from: me.id, name: me.name });
        pushRoster(session);
        break;
      }

      case 'host:requestResponse': {
        if (!isHost || !target) break;
        session.hostRequests.delete(target.id);
        if (msg.accept) {
          setHost(session, target.id);
        } else {
          send(target.ws, { t: 'system', text: 'The host declined your request.' });
          pushRoster(session);
        }
        break;
      }

      /* ----- polls ----- */

      case 'host:poll': {
        if (!isHost) break;
        const question = String(msg.question || '').trim().slice(0, 140);
        const options = (Array.isArray(msg.options) ? msg.options : [])
          .map((o) => String(o || '').trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, MAX_POLL_OPTIONS);
        if (!question || options.length < 2) {
          send(ws, { t: 'error', message: 'A poll needs a question and at least two options.' });
          break;
        }
        session.poll = {
          id: crypto.randomUUID(),
          question,
          open: true,
          options: options.map((text) => ({ text, votes: new Set() }))
        };
        broadcast(session, { t: 'poll', poll: pollView(session) });
        break;
      }

      case 'poll:vote': {
        const poll = session.poll;
        if (!poll || !poll.open) break;
        const index = Number(msg.option);
        if (!(index >= 0 && index < poll.options.length)) break;
        for (const option of poll.options) option.votes.delete(me.id);
        poll.options[index].votes.add(me.id);
        broadcast(session, { t: 'poll', poll: pollView(session) });
        break;
      }

      case 'host:pollClose': {
        if (!isHost || !session.poll) break;
        session.poll.open = false;
        broadcast(session, { t: 'poll', poll: pollView(session) });
        break;
      }

      case 'host:pollClear': {
        if (!isHost) break;
        session.poll = null;
        broadcast(session, { t: 'poll', poll: null });
        break;
      }

      /* ----- vote to kick ----- */

      case 'votekick:start': {
        if (!target || target.id === me.id || me.companion) break;
        if (session.hostId === target.id) {
          send(ws, { t: 'error', message: 'The host cannot be voted out.' });
          break;
        }
        if (session.voteKick) break;
        const voters = eligibleVoters(session, target.id);
        if (voters.length < 2) {
          send(ws, { t: 'error', message: 'A vote needs at least three people watching.' });
          break;
        }
        session.voteKick = {
          targetId: target.id,
          startedByName: me.name,
          yes: new Set([me.id]),
          no: new Set(),
          needed: Math.floor(voters.length / 2) + 1,
          expiresAt: Date.now() + VOTE_KICK_MS,
          timer: setTimeout(() => {
            session.voteKick = null;
            broadcast(session, { t: 'votekick', vote: null });
            broadcast(session, { t: 'system', text: 'The vote expired.' });
          }, VOTE_KICK_MS)
        };
        broadcast(session, { t: 'system', text: `${me.name} started a vote to remove ${target.name}.` });
        settleVoteKick(session);
        break;
      }

      case 'votekick:vote': {
        const vk = session.voteKick;
        if (!vk || me.companion || me.id === vk.targetId) break;
        vk.yes.delete(me.id);
        vk.no.delete(me.id);
        (msg.yes ? vk.yes : vk.no).add(me.id);
        settleVoteKick(session);
        break;
      }
    }
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});

// Drop half-open connections so ghost members do not linger in a room.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`CooWatch running on http://localhost:${PORT}`);
});
