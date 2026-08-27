'use strict';

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // Free public relay, used when no direct peer-to-peer route can be found.
    // Replace with your own TURN server if connections stay unreliable.
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

const EMOJIS = ['\u{1F602}', '\u{1F62E}', '❤️', '\u{1F525}', '\u{1F62D}', '\u{1F44F}', '\u{1F631}', '\u{1F914}'];

const $ = (id) => document.getElementById(id);

const ui = {
  home: $('home'), room: $('room'),
  name: $('name'), title: $('title'), code: $('code'),
  sourceSeg: $('source-seg'), privacySeg: $('privacy-seg'), sourceHint: $('source-hint'),
  createBtn: $('create-btn'), joinBtn: $('join-btn'), refreshBtn: $('refresh-btn'),
  publicList: $('public-list'), publicEmpty: $('public-empty'), homeError: $('home-error'),
  roleSeg: $('role-seg'), companionCard: $('companion-card'), companionSub: $('companion-sub'),
  roomTitle: $('room-title'), roomCode: $('room-code'), leaveBtn: $('leave-btn'),
  micBtn: $('mic-btn'), micLabel: $('mic-label'),
  stage: $('stage'), videoWrap: $('video-wrap'), fsBtn: $('fs-btn'),
  video: $('video'), ytHolder: $('yt-holder'),
  overlay: $('overlay'), overlayText: $('overlay-text'), overlayBtn: $('overlay-btn'),
  overlaySpinner: $('overlay-spinner'),
  reactions: $('reactions'), reactionBar: $('reaction-bar'), chatOverlay: $('chat-overlay'),
  playBtn: $('play-btn'), seek: $('seek'), timeNow: $('time-now'), timeTotal: $('time-total'),
  hostTools: $('host-tools'), pickFile: $('pick-file'), fileInput: $('file-input'),
  shareBtn: $('share-btn'), shareLabel: $('share-label'),
  controls: $('controls'), liveBadge: $('live-badge'),
  ytTools: $('yt-tools'), ytUrl: $('yt-url'), ytLoad: $('yt-load'),
  peers: $('peers'), chatLog: $('chat-log'), chatForm: $('chat-form'), chatInput: $('chat-input'),
  toast: $('toast'),
  waitingAudio: $('waiting-audio'), musicBtn: $('music-btn'), musicBtnHome: $('music-btn-home'),
  panel: $('panel'), panelBtn: $('panel-btn'), panelClose: $('panel-close'),
  panelScrim: $('panel-scrim'), panelBadge: $('panel-badge'),
  hostSettings: $('host-settings'), cfgChat: $('cfg-chat'), cfgLock: $('cfg-lock'),
  cfgMuteAll: $('cfg-muteall'),
  pollMaker: $('poll-maker'), pollQ: $('poll-q'), pollCreate: $('poll-create'),
  pollOpts: [$('poll-o1'), $('poll-o2'), $('poll-o3'), $('poll-o4')],
  memberList: $('member-list'), peopleCount: $('people-count'),
  guestActions: $('guest-actions'), askHost: $('ask-host'),
  banners: $('banners'), chatNote: $('chat-note'),
  leaveDialog: $('leave-dialog'), leaveScrim: $('leave-scrim'), leaveText: $('leave-text'),
  heirWrap: $('leave-heir-wrap'), heir: $('heir'), leaveTransfer: $('leave-transfer'),
  leaveDestroy: $('leave-destroy'), leaveCancel: $('leave-cancel')
};

const state = {
  ws: null,
  myId: null,
  session: null,
  isHost: false,
  companion: false,   // a second screen: chat and controls, no media
  mode: 'file',
  peers: new Map(),     // peerId -> { name, pc, audioEl, pending }
  micStream: null,
  micOn: true,
  localFilm: null,      // host: the MediaStream currently being sent
  screenStream: null,   // host: display capture, when sharing a screen
  streamKind: null,     // 'file' | 'screen' | 'none'
  filmTracks: [],       // guest: film tracks received from the host
  gotFilm: false,
  duration: 0,
  position: 0,
  paused: true,
  seeking: false,
  suppressUntil: 0,     // ignore player events we caused ourselves
  yt: null,
  ytReady: false,
  ytPendingId: null,
  progressTimer: null,
  wantConnected: false,
  me: null,           // my own member record from the server
  roster: [],         // everyone in the room, with their permissions
  config: { chatOpen: true, lockControls: false, muteAll: false },
  poll: null,
  voteKick: null,
  myVote: null,       // which poll option I picked
  selfMuted: false
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

let toastTimer = null;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2600);
}

function sysMessage(text) {
  const li = document.createElement('li');
  li.className = 'sys';
  li.textContent = text;
  ui.chatLog.appendChild(li);
  ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
  popMessage(null, text, 'sys');
}

// The sidebar is not rendered in fullscreen, so messages surface over the
// picture instead and fade out on their own.
function popMessage(who, text, kind) {
  const pop = document.createElement('div');
  pop.className = 'chat-pop' + (kind ? ' ' + kind : '');
  if (who) {
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = who;
    pop.appendChild(name);
  }
  pop.appendChild(document.createTextNode(text));
  ui.chatOverlay.appendChild(pop);
  // Keep the stack shallow enough to stay out of the way of the film.
  while (ui.chatOverlay.children.length > 5) ui.chatOverlay.firstChild.remove();
  setTimeout(() => pop.remove(), 7300);
}

function chatMessage(who, text, mine) {
  const li = document.createElement('li');
  if (mine) li.className = 'me';
  else {
    const strong = document.createElement('span');
    strong.className = 'who';
    strong.textContent = who;
    li.appendChild(strong);
  }
  li.appendChild(document.createTextNode(text));
  ui.chatLog.appendChild(li);
  ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
  popMessage(mine ? null : who, text, mine ? 'me' : '');
}

function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

let pendingBtn = null;
let pendingTimer = null;

function startPending(btn) {
  clearPending();
  pendingBtn = btn;
  setLoading(btn, true);
  // Never leave a button spinning forever if the server goes quiet.
  pendingTimer = setTimeout(() => {
    clearPending();
    homeError('The server is not answering. Try again.');
  }, 15000);
}

function clearPending() {
  clearTimeout(pendingTimer);
  setLoading(pendingBtn, false);
  pendingBtn = null;
}

function send(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function showOverlay(text, buttonLabel, onClick, busy) {
  ui.overlayText.textContent = text;
  ui.overlaySpinner.hidden = !busy;
  if (buttonLabel) {
    ui.overlayBtn.textContent = buttonLabel;
    ui.overlayBtn.hidden = false;
    ui.overlayBtn.onclick = onClick;
  } else {
    ui.overlayBtn.hidden = true;
    ui.overlayBtn.onclick = null;
  }
  ui.overlay.hidden = false;
}

function hideOverlay() {
  ui.overlay.hidden = true;
  ui.overlayBtn.onclick = null;
}

function parseYouTubeId(input) {
  const raw = String(input || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : 'https://' + raw);
  } catch {
    return null;
  }
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) return null;
  const v = url.searchParams.get('v');
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const m = url.pathname.match(/\/(embed|shorts|v|live)\/([\w-]{11})/);
  return m ? m[2] : null;
}

/* ------------------------------------------------------------------ */
/* home screen                                                         */
/* ------------------------------------------------------------------ */

function segValue(seg, attr) {
  const active = seg.querySelector('.seg-btn.active');
  return active ? active.dataset[attr] : null;
}

function wireSeg(seg, onChange) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (onChange) onChange(btn);
  });
}

wireSeg(ui.sourceSeg, (btn) => {
  ui.sourceHint.textContent = btn.dataset.source === 'youtube'
    ? 'You both load the same YouTube video and it stays in sync. Nothing is uploaded.'
    : 'Play a file, or share a browser tab so anything you can watch, she can watch. Streams straight to whoever joins - keep this tab open.';
});
wireSeg(ui.privacySeg);
wireSeg(ui.roleSeg);

function homeError(message) {
  ui.homeError.textContent = message;
  ui.homeError.hidden = !message;
}

function rememberName() {
  try { localStorage.setItem('wt-name', ui.name.value.trim()); } catch {}
}

ui.createBtn.addEventListener('click', () => {
  const name = ui.name.value.trim();
  if (!name) { homeError('Enter your name first.'); ui.name.focus(); return; }
  homeError('');
  rememberName();
  startPending(ui.createBtn);
  connect(() => send({
    t: 'create',
    name,
    title: ui.title.value.trim() || 'Movie night',
    isPublic: segValue(ui.privacySeg, 'public') === 'true',
    source: segValue(ui.sourceSeg, 'source')
  }));
});

let joiningAsCompanion = false;

// The public list sits above the name field, so a first-time visitor will click
// Join before typing anything. Remember what they wanted and pick it up again
// as soon as they have a name, instead of making them hunt for the button.
let pendingJoin = null;

function askForName(code) {
  pendingJoin = code || null;
  homeError('Almost there - add a display name and we will take you straight in.');
  ui.name.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => ui.name.focus(), 260);
}

function doJoin(code, btn) {
  const name = ui.name.value.trim();
  if (!name) { askForName(code); return; }
  pendingJoin = null;
  if (!code) { homeError('Enter a session code.'); ui.code.focus(); return; }
  homeError('');
  rememberName();
  startPending(btn || ui.joinBtn);
  // Locked in now, so toggling the switch mid-connect cannot change it.
  joiningAsCompanion = segValue(ui.roleSeg, 'companion') === 'true';
  connect(() => send({ t: 'join', code, name, companion: joiningAsCompanion }));
}

ui.joinBtn.addEventListener('click', () => doJoin(ui.code.value.trim().toUpperCase(), ui.joinBtn));

ui.name.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const name = ui.name.value.trim();
  if (!name) return;
  homeError('');
  if (pendingJoin) doJoin(pendingJoin, null);
  else if (ui.code.value.trim()) ui.joinBtn.click();
});

ui.name.addEventListener('input', () => {
  if (ui.name.value.trim()) homeError('');
});
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.joinBtn.click(); });

let lastListSignature = null;

const EMPTY_LIST_TEXT = 'No public sessions yet. Start one below and it will show up here.';

// `quiet` is used by the background poll: redrawing a spinner every fifteen
// seconds over a list somebody is reading would be worse than a stale row.
async function loadPublicSessions(quiet) {
  if (!quiet) {
    ui.publicEmpty.hidden = true;
    ui.publicList.innerHTML = '<li class="list-loading"><span class="spinner"></span></li>';
  }
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    const signature = data.sessions.map((s) => s.code + ':' + s.count + ':' + s.title).join('|');
    if (quiet && signature === lastListSignature) return;
    lastListSignature = signature;

    ui.publicList.innerHTML = '';
    ui.publicEmpty.hidden = data.sessions.length > 0;
    ui.publicEmpty.textContent = EMPTY_LIST_TEXT;
    data.sessions.forEach((s, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = (quiet ? 0 : i * 45) + 'ms';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'p-title';
      name.textContent = s.title;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${s.hostName} · ${s.count} watching · ${s.source === 'youtube' ? 'YouTube' : 'File'}`;
      info.appendChild(name);
      info.appendChild(meta);
      const btn = document.createElement('button');
      btn.className = 'ghost small';
      btn.textContent = 'Join';
      btn.addEventListener('click', () => doJoin(s.code, btn));
      li.appendChild(info);
      li.appendChild(btn);
      ui.publicList.appendChild(li);
    });
  } catch {
    if (quiet) return;
    ui.publicList.innerHTML = '';
    ui.publicEmpty.hidden = false;
    ui.publicEmpty.textContent = 'Could not load the list.';
  }
}

ui.refreshBtn.addEventListener('click', async () => {
  setLoading(ui.refreshBtn, true);
  await loadPublicSessions();
  setLoading(ui.refreshBtn, false);
});

/* ------------------------------------------------------------------ */
/* signaling                                                           */
/* ------------------------------------------------------------------ */

function connect(onOpen) {
  state.wantConnected = true;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) { onOpen(); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;
  ws.addEventListener('open', () => onOpen());
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  });
  ws.addEventListener('close', () => {
    if (!state.wantConnected) return;
    clearPending();
    if (state.session || resuming) scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    clearPending();
    homeError('Could not reach the server.');
  });
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'hello':
      state.myId = msg.id;
      break;

    case 'error':
      clearPending();
      if (msg.fatal) {
        clearResume();
        resuming = false;
        if (state.session) goHome();
        homeError(msg.message);
      } else if (state.session) {
        toast(msg.message);
      } else {
        homeError(msg.message);
      }
      break;

    case 'system':
      sysMessage(msg.text);
      break;

    case 'roster':
      state.roster = msg.members;
      if (state.session) state.session.hostId = msg.hostId;
      state.me = msg.members.find((m) => m.id === state.myId) || state.me;
      state.isHost = !!state.me && state.me.isHost;
      afterStateChange();
      break;

    case 'config':
      state.config = msg.config;
      afterStateChange();
      break;

    case 'host-changed':
      if (state.session) state.session.hostId = msg.hostId;
      state.isHost = msg.hostId === state.myId;
      sysMessage(state.isHost ? 'You are the host now.' : `${msg.name} is the host now.`);
      if (state.isHost) toast('You are the host now');
      afterStateChange();
      break;

    case 'host-request':
      sysMessage(`${msg.name} asked to become the host.`);
      toast(`${msg.name} wants to host`);
      break;

    case 'you-muted':
      sysMessage(msg.seconds
        ? `${msg.by} muted you for ${msg.seconds} seconds.`
        : `${msg.by} muted you.`);
      toast('You were muted');
      break;

    case 'you-unmuted':
      sysMessage(`${msg.by} unmuted you.`);
      break;

    case 'chat-block':
      sysMessage(msg.blocked
        ? `${msg.by} blocked you from the chat.`
        : `${msg.by} let you back into the chat.`);
      break;

    case 'poll':
      if (msg.poll && (!state.poll || state.poll.id !== msg.poll.id)) state.myVote = null;
      state.poll = msg.poll;
      if (msg.poll && msg.poll.open) toast('New poll');
      renderBanners();
      break;

    case 'votekick':
      state.voteKick = msg.vote;
      renderBanners();
      break;

    case 'kicked':
      clearResume();
      goHome();
      homeError(msg.reason);
      break;

    case 'peer-offline':
      closePeer(msg.id);
      break;

    case 'peer-reset': {
      closePeer(msg.id);
      const info = state.roster.find((m) => m.id === msg.id);
      state.peers.set(msg.id, {
        name: info ? info.name : 'Guest',
        companion: !!(info && info.companion),
        pc: null, audioEl: null, pending: []
      });
      if (!state.companion && !(info && info.companion)) createPeer(msg.id, true);
      break;
    }

    case 'joined':
      clearPending();
      enterRoom(msg);
      break;

    case 'peer-join':
      state.peers.set(msg.peer.id, {
        name: msg.peer.name, companion: !!msg.peer.companion, pc: null, audioEl: null, pending: []
      });
      renderPeers();
      sysMessage(`${msg.peer.name} joined${msg.peer.companion ? ' on a second screen' : ''}.`);
      // Existing members always make the offer, so the newcomer only answers.
      // A second screen never gets one: it would cost the host another upload.
      if (!state.companion && !msg.peer.companion) createPeer(msg.peer.id, true);
      break;

    case 'peer-leave':
      closePeer(msg.id);
      renderPeers();
      sysMessage(`${msg.name || 'Someone'} left.`);
      break;

    case 'session-closed':
      clearResume();
      goHome();
      homeError(msg.reason || 'The host ended the session.');
      break;

    case 'signal':
      handleSignal(msg.from, msg.data);
      break;

    case 'chat':
      chatMessage(msg.name, msg.text);
      break;

    case 'reaction':
      floatEmoji(msg.emoji);
      break;

    case 'control':
      applyRemoteControl(msg);
      break;

    case 'progress':
      applyRemoteProgress(msg);
      break;

    case 'source':
      if (!state.session) break;
      state.session.title = msg.title;
      ui.roomTitle.textContent = msg.title;
      state.streamKind = msg.kind || null;
      if (msg.youtubeId) loadYouTube(msg.youtubeId, false);
      if (!state.isHost) {
        // Keep the received tracks: the transceivers are reused when the host
        // starts again, so ontrack will not fire a second time.
        if (msg.kind === 'none') showOverlay('The host stopped sharing.', null, null, true);
        else if (state.gotFilm) tryPlayRemoteFilm();
      }
      applyStreamKind();
      break;
  }
}

/* ------------------------------------------------------------------ */
/* room lifecycle                                                      */
/* ------------------------------------------------------------------ */

async function enterRoom(msg) {
  const rejoined = resuming || (!!state.session && state.session.code === msg.session.code);
  resuming = false;
  reconnectAttempt = 0;
  state.myId = msg.you;
  state.me = msg.me;
  state.roster = [msg.me].concat(msg.peers);
  state.config = msg.session.config || state.config;
  state.poll = msg.poll || null;
  state.voteKick = msg.voteKick || null;
  state.selfMuted = rejoined ? !!(msg.me && msg.me.selfMuted) : true;
  if (!rejoined) send({ t: 'selfMute', muted: true });
  saveResume(msg.session.code, msg.token);
  for (const id of [...state.peers.keys()]) closePeer(id);
  state.session = msg.session;
  state.isHost = msg.session.hostId === msg.you;
  state.companion = !state.isHost && (msg.me ? msg.me.companion : joiningAsCompanion);
  ui.room.classList.toggle('companion', state.companion);
  state.mode = msg.session.source;
  state.gotFilm = false;
  state.filmTracks = [];
  state.streamKind = msg.streamKind || null;

  ui.home.classList.remove('active');
  ui.room.classList.add('active');
  ui.roomTitle.textContent = msg.session.title;
  ui.roomCode.textContent = msg.session.code;
  if (!rejoined) {
    ui.chatLog.innerHTML = '';
    sysMessage(state.isHost
      ? 'You created this session. Share the code above to invite someone.'
      : 'You joined the session.');
  } else {
    sysMessage('Reconnected.');
  }
  afterStateChange();

  const isYouTube = state.mode === 'youtube';
  resetVideoElement();
  ui.hostTools.hidden = !state.isHost;
  ui.pickFile.hidden = isYouTube;
  ui.shareBtn.hidden = isYouTube;
  setShareUi();
  ui.ytTools.hidden = !isYouTube;
  ui.ytHolder.hidden = !isYouTube;
  ui.video.hidden = isYouTube;

  state.peers.clear();
  for (const peer of msg.peers) {
    state.peers.set(peer.id, {
      name: peer.name, companion: !!peer.companion, pc: null, audioEl: null, pending: []
    });
  }
  renderPeers();

  if (state.companion) {
    ui.companionCard.hidden = false;
    ui.companionSub.textContent = isYouTube
      ? 'Watching elsewhere. Chat here, and play, pause and seek work for everyone.'
      : 'Watching elsewhere. Chat here, and the controls below work for everyone.';
    sysMessage('Second screen. No video or microphone on this device.');
    hideOverlay();
    updateControlsEnabled();
    return;
  }
  ui.companionCard.hidden = true;

  // Ask for the mic early so the track exists before any offer is built.
  startMic();

  if (isYouTube) {
    await ensureYouTubeApi();
    if (msg.youtubeId) loadYouTube(msg.youtubeId, false);
    else showOverlay(state.isHost
      ? 'Paste a YouTube link below to start.'
      : 'Waiting for the host to pick a video...', null, null, !state.isHost);
  } else if (state.isHost) {
    showOverlay(rejoined
      ? 'Session restored. Pick the file again to start streaming.'
      : 'Choose a video file to start.', 'Choose file', () => ui.fileInput.click());
  } else {
    // Deliberately no srcObject yet: a <video> handed an empty MediaStream
    // will not pick up a video track added to it later.
    showOverlay('Waiting for the host to pick a video...', null, null, true);
  }

  updateControlsEnabled();
}

function leaveSession(opts) {
  send(Object.assign({ t: 'leave' }, opts || {}));
  clearResume();
  goHome();
}

function goHome() {
  if (fullscreenElement() && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  state.wantConnected = false;
  closePanel();
  ui.leaveDialog.hidden = true;
  for (const id of [...state.peers.keys()]) closePeer(id);
  state.peers.clear();
  clearInterval(state.progressTimer);
  state.progressTimer = null;

  if (state.micStream) {
    state.micStream.getTracks().forEach((t) => t.stop());
    state.micStream = null;
  }
  // The cached promise still holds the stream we just stopped, so a second
  // session would find a dead microphone and stay silent.
  micPromise = null;
  if (state.yt) {
    try { state.yt.destroy(); } catch {}
    state.yt = null;
  }
  ui.ytHolder.innerHTML = '<div id="yt-player"></div>';
  resetVideoElement();

  stopLocalFilm();
  setShareUi();
  state.streamKind = null;
  state.companion = false;
  ui.room.classList.remove('companion');
  ui.companionCard.hidden = true;
  setTimeout(updateMusic, 0);
  state.filmTracks = [];
  state.gotFilm = false;
  state.session = null;
  state.me = null;
  state.roster = [];
  state.poll = null;
  state.voteKick = null;
  state.myVote = null;
  state.selfMuted = false;
  state.config = { chatOpen: true, lockControls: false, muteAll: false };
  ui.banners.innerHTML = '';
  ui.chatNote.hidden = true;
  state.duration = 0;
  state.position = 0;
  state.paused = true;

  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }

  ui.room.classList.remove('active');
  ui.home.classList.add('active');
  hideOverlay();
  lastListSignature = null;
  loadPublicSessions();
}

ui.leaveBtn.addEventListener('click', () => {
  const others = state.roster.filter((m) => m.id !== state.myId && !m.companion);
  if (state.isHost && others.length) openLeaveDialog(others);
  else leaveSession({});
});

ui.roomCode.addEventListener('click', async () => {
  if (!state.session) return;
  const link = `${location.origin}/?code=${state.session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    prompt('Copy this invite link:', link);
  }
});

function peerChip(name, isHost, companion) {
  const chip = document.createElement('span');
  if (companion) chip.className = 'companion';
  const av = document.createElement('span');
  av.className = 'av';
  av.textContent = companion ? '2' : (name.trim()[0] || '?').toUpperCase();
  chip.appendChild(av);
  let suffix = '';
  if (isHost) suffix = ' (host)';
  else if (companion) suffix = ' (2nd screen)';
  chip.appendChild(document.createTextNode(name + suffix));
  return chip;
}

function renderPeers() {
  ui.peers.innerHTML = '';
  for (const m of state.roster) {
    const chip = peerChip(m.id === state.myId ? m.name + ' (you)' : m.name, m.isHost, m.companion);
    if (!m.online) chip.classList.add('offline');
    ui.peers.appendChild(chip);
  }
}

/* ------------------------------------------------------------------ */
/* microphone + WebRTC                                                 */
/* ------------------------------------------------------------------ */

let micPromise = null;

function startMic() {
  if (micPromise) return micPromise;
  micPromise = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  }).then((stream) => {
    state.micStream = stream;
    setMic(true);
    return stream;
  }).catch(() => {
    state.micStream = null;
    ui.micLabel.textContent = 'No mic';
    ui.micBtn.disabled = true;
    sysMessage('No microphone available. You can still watch and use text chat.');
    return null;
  });
  return micPromise;
}

// The host can silence you, but only you can undo muting yourself.
function forcedMute() {
  const me = state.me;
  return !!(state.config.muteAll || (me && me.hostMuted));
}

function applyMicState() {
  const on = !state.selfMuted && !forcedMute();
  state.micOn = on;
  if (state.micStream) state.micStream.getAudioTracks().forEach((t) => { t.enabled = on; });
  ui.micBtn.setAttribute('aria-pressed', String(on));
  if (ui.micBtn.disabled && ui.micLabel.textContent === 'No mic') return;
  ui.micLabel.textContent = forcedMute() ? 'Muted' : (on ? 'Mic on' : 'Mic off');
  ui.micBtn.title = forcedMute() ? 'The host muted you' : 'Toggle your microphone';
}

function setMic(on) {
  state.selfMuted = !on;
  send({ t: 'selfMute', muted: state.selfMuted });
  applyMicState();
}

ui.micBtn.addEventListener('click', () => {
  if (forcedMute() && state.selfMuted === false) {
    toast('The host muted you.');
    return;
  }
  setMic(state.selfMuted);
});

// The voice channel is always the LAST audio transceiver, on both sides.
function attachMic(pc) {
  if (!state.micStream) return;
  const audio = pc.getTransceivers().filter((t) => (t.sender.track || t.receiver.track || {}).kind === 'audio' || t.kind === 'audio');
  const voice = audio[audio.length - 1];
  if (!voice) return;
  voice.direction = 'sendrecv';
  voice.sender.replaceTrack(state.micStream.getAudioTracks()[0]).catch(() => {});
}

// Transceivers are created in a fixed order so both sides can identify a track
// from its mid alone. That means the host can pick a file later without
// renegotiating anything.
function createPeer(peerId, isOfferer) {
  const entry = state.peers.get(peerId);
  if (!entry) return null;
  if (entry.pc) return entry.pc;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  entry.pc = pc;
  entry.pending = entry.pending || [];

  const iSendFilm = state.isHost && state.mode === 'file';

  if (isOfferer) {
    if (iSendFilm) {
      // Kept as references because mids only exist after setLocalDescription.
      entry.filmVideo = pc.addTransceiver('video', { direction: 'sendonly' }); // mid 0
      entry.filmAudio = pc.addTransceiver('audio', { direction: 'sendonly' }); // mid 1
    }
    pc.addTransceiver('audio', { direction: 'sendrecv' });   // voice chat
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) send({ t: 'signal', to: peerId, data: { candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    const mid = e.transceiver.mid;
    const fromHost = state.session && peerId === state.session.hostId;
    if (fromHost && state.mode === 'file' && (mid === '0' || mid === '1')) {
      if (!state.filmTracks.includes(e.track)) state.filmTracks.push(e.track);
      // A fresh MediaStream every time, so the element reloads and actually
      // binds the new track instead of ignoring it.
      ui.video.srcObject = new MediaStream(state.filmTracks);
      state.gotFilm = true;
      updateControlsEnabled();
      tryPlayRemoteFilm();
      // A track that arrives before the host has picked a file stays muted
      // until frames start, so rebind once it unmutes.
      e.track.onunmute = () => {
        state.gotFilm = true;
        ui.video.srcObject = new MediaStream(state.filmTracks);
        updateControlsEnabled();
        tryPlayRemoteFilm();
      };
      return;
    }
    if (!entry.audioEl) {
      entry.audioEl = document.createElement('audio');
      entry.audioEl.autoplay = true;
      entry.audioEl.style.display = 'none';
      document.body.appendChild(entry.audioEl);
    }
    entry.audioEl.srcObject = new MediaStream([e.track]);
    entry.audioEl.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') sysMessage(`Connection to ${entry.name} failed.`);
  };

  if (isOfferer) {
    (async () => {
      await startMic();
      attachMic(pc);
      if (iSendFilm) attachFilmTo(entry);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ t: 'signal', to: peerId, data: { sdp: pc.localDescription } });
    })().catch(() => {});
  }

  return pc;
}

async function handleSignal(peerId, data) {
  let entry = state.peers.get(peerId);
  if (!entry) {
    entry = { name: 'Guest', pc: null, audioEl: null, pending: [] };
    state.peers.set(peerId, entry);
  }

  try {
    if (data.sdp && data.sdp.type === 'offer') {
      const pc = entry.pc || createPeer(peerId, false);
      await pc.setRemoteDescription(data.sdp);
      await startMic();
      attachMic(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ t: 'signal', to: peerId, data: { sdp: pc.localDescription } });
      await flushCandidates(entry);
    } else if (data.sdp && entry.pc) {
      await entry.pc.setRemoteDescription(data.sdp);
      await flushCandidates(entry);
    } else if (data.candidate) {
      if (entry.pc && entry.pc.remoteDescription) {
        await entry.pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        entry.pending.push(data.candidate);
      }
    }
  } catch {
    /* a dropped negotiation step just means that peer stays silent */
  }
}

async function flushCandidates(entry) {
  const queued = entry.pending || [];
  entry.pending = [];
  for (const candidate of queued) {
    await entry.pc.addIceCandidate(candidate).catch(() => {});
  }
}

function closePeer(peerId) {
  const entry = state.peers.get(peerId);
  if (!entry) return;
  if (entry.pc) { try { entry.pc.close(); } catch {} }
  if (entry.audioEl) entry.audioEl.remove();
  state.peers.delete(peerId);
}

function attachFilmTo(entry) {
  if (!state.localFilm || !entry.pc) return;
  const video = state.localFilm.getVideoTracks()[0];
  const audio = state.localFilm.getAudioTracks()[0];
  if (entry.filmVideo && video) entry.filmVideo.sender.replaceTrack(video).catch(() => {});
  if (entry.filmAudio && audio) entry.filmAudio.sender.replaceTrack(audio).catch(() => {});
}

function broadcastFilm() {
  for (const [peerId, entry] of state.peers) {
    attachFilmTo(entry);
    renegotiate(peerId, entry);
  }
}

// Anyone who joined before a file was chosen negotiated an empty video m-line.
// Re-offer now that the tracks are really attached.
async function renegotiate(peerId, entry) {
  if (!state.isHost || !entry.pc || entry.pc.signalingState !== 'stable') return;
  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    send({ t: 'signal', to: peerId, data: { sdp: entry.pc.localDescription } });
  } catch {
    /* the connection keeps whatever it already had */
  }
}

async function tryPlayRemoteFilm() {
  try {
    await ui.video.play();
    hideOverlay();
  } catch {
    showOverlay('Ready. Tap to start watching.', 'Start', async () => {
      try { await ui.video.play(); } catch {}
      hideOverlay();
      watchForPicture();
    });
    return;
  }
  watchForPicture();
}

// videoWidth stays 0 until real frames decode, which separates "connected but
// nothing is coming" from "still waiting for the host".
let pictureTimer = null;
function watchForPicture() {
  clearTimeout(pictureTimer);
  if (state.isHost || state.mode !== 'file') return;
  pictureTimer = setTimeout(() => {
    if (!state.gotFilm || ui.video.videoWidth) return;
    showOverlay('Connected, but no picture is arriving yet. Ask the host to press pause then play.');
  }, 6000);
}

/* ------------------------------------------------------------------ */
/* file mode                                                           */
/* ------------------------------------------------------------------ */

ui.pickFile.addEventListener('click', () => ui.fileInput.click());

// Containers no browser will decode from a plain <video> element.
const UNPLAYABLE = {
  ts: 'MPEG transport stream', m2ts: 'MPEG transport stream', mts: 'MPEG transport stream',
  avi: 'AVI', wmv: 'Windows Media', flv: 'Flash video', vob: 'DVD video',
  mpg: 'MPEG-1/2', mpeg: 'MPEG-1/2', rmvb: 'RealMedia', divx: 'DivX'
};

function extensionOf(file) {
  return (file.name.split('.').pop() || '').toLowerCase();
}

function unplayableMessage(file) {
  const ext = extensionOf(file);
  const label = UNPLAYABLE[ext];
  return label
    ? `${label} (.${ext}) files cannot be played in a browser. Convert it to MP4 first, then pick it again - the README has the one-line command.`
    : 'This browser cannot decode that file. MP4 with H.264 video and AAC audio always works.';
}

// Resolves once the browser has actually accepted the container, so a file it
// cannot decode is reported here instead of failing quietly a step later.
function waitForVideoReady(video) {
  return new Promise((resolve) => {
    const finish = (ok) => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onFail);
      clearTimeout(timer);
      resolve(ok);
    };
    const onReady = () => finish(true);
    const onFail = () => finish(false);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('error', onFail);
    const timer = setTimeout(() => finish(false), 20000);
  });
}

ui.fileInput.addEventListener('change', async () => {
  const file = ui.fileInput.files && ui.fileInput.files[0];
  if (!file) return;
  setLoading(ui.pickFile, true);
  try {
    await openFile(file);
  } finally {
    setLoading(ui.pickFile, false);
  }
});

async function openFile(file) {
  const capture = ui.video.captureStream || ui.video.mozCaptureStream;
  if (!capture) {
    showOverlay('This browser cannot share a local file. Use Chrome, Edge or Firefox.');
    return;
  }

  if (UNPLAYABLE[extensionOf(file)]) {
    showOverlay(unplayableMessage(file), 'Pick another file', () => ui.fileInput.click());
    return;
  }

  stopLocalFilm();
  setShareUi();
  // A clean element, so captureStream() gives a live stream rather than the
  // ended one it cached from a previous file.
  resetVideoElement();
  ui.video.src = URL.createObjectURL(file);
  ui.video.muted = false;
  showOverlay(`Opening ${file.name}...`, null, null, true);

  if (!(await waitForVideoReady(ui.video))) {
    showOverlay(unplayableMessage(file), 'Pick another file', () => ui.fileInput.click());
    return;
  }
  hideOverlay();

  try {
    await ui.video.play();
  } catch {
    showOverlay('Tap to start playing.', 'Play', () => { ui.video.play(); hideOverlay(); });
  }

  state.localFilm = capture.call(ui.video);
  // Chrome only attaches the tracks once decoding has actually started.
  if (state.localFilm.getVideoTracks().length === 0) {
    await new Promise((resolve) => {
      state.localFilm.addEventListener('addtrack', resolve, { once: true });
      setTimeout(resolve, 4000);
    });
  }
  if (state.localFilm.getVideoTracks().length === 0) {
    sysMessage('Could not capture the picture from this file. Try letting it play for a second, then pick it again.');
  }

  broadcastFilm();
  const title = file.name.replace(/\.[^.]+$/, '');
  ui.roomTitle.textContent = title;
  state.streamKind = 'file';
  send({ t: 'source', title, youtubeId: null, kind: 'file' });
  applyStreamKind();
  startProgressLoop();
  updateControlsEnabled();
  toast('Streaming to everyone in the room');
}

function onVideoMeta() {
  if (!state.isHost || state.mode !== 'file') return;
  state.duration = ui.video.duration || 0;
  updateTimeUi(ui.video.currentTime, state.duration);
  updateControlsEnabled();
}

function onVideoPlay() {
  if (!state.isHost || state.mode !== 'file') return;
  state.paused = false;
  ui.playBtn.textContent = 'Pause';
  sendProgress();
}

function onVideoPause() {
  if (!state.isHost || state.mode !== 'file') return;
  state.paused = true;
  ui.playBtn.textContent = 'Play';
  sendProgress();
}

function onVideoTime() {
  if (state.isHost && state.mode === 'file' && !state.seeking) {
    state.duration = ui.video.duration || 0;
    updateTimeUi(ui.video.currentTime, state.duration);
  }
}

// Fires when the intrinsic size goes from nothing to the real frame size.
function onVideoResize() {
  if (!state.isHost && state.mode === 'file' && ui.video.videoWidth) {
    clearTimeout(pictureTimer);
    hideOverlay();
  }
}

function bindVideo(el) {
  el.addEventListener('loadedmetadata', onVideoMeta);
  el.addEventListener('play', onVideoPlay);
  el.addEventListener('pause', onVideoPause);
  el.addEventListener('timeupdate', onVideoTime);
  el.addEventListener('resize', onVideoResize);
}

// captureStream() caches its stream on the element and hands back the same one
// every time. Once those tracks have ended - which load() does - the element can
// never produce a live stream again. So a file session always gets a new element.
function resetVideoElement() {
  const old = ui.video;
  const fresh = document.createElement('video');
  fresh.id = 'video';
  fresh.setAttribute('playsinline', '');
  fresh.hidden = old.hidden;
  if (old.src) URL.revokeObjectURL(old.src);
  old.pause();
  old.removeAttribute('src');
  old.srcObject = null;
  old.replaceWith(fresh);
  ui.video = fresh;
  bindVideo(fresh);
  return fresh;
}

bindVideo(ui.video);

function startProgressLoop() {
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(sendProgress, 1000);
}

function sendProgress() {
  if (!state.isHost) return;
  const youtube = state.mode === 'youtube';
  send({
    t: 'progress',
    time: youtube ? ytTime() : ui.video.currentTime,
    duration: youtube ? ytDuration() : (ui.video.duration || 0),
    paused: youtube ? !ytPlaying() : ui.video.paused
  });
}

function applyRemoteProgress(msg) {
  state.duration = msg.duration;
  state.paused = msg.paused;
  ui.playBtn.textContent = msg.paused ? 'Play' : 'Pause';
  if (!state.seeking) updateTimeUi(msg.time, msg.duration);
  updateControlsEnabled();

  // YouTube plays independently on each device, so nudge it back when it drifts.
  if (state.mode === 'youtube' && state.yt && Date.now() > state.suppressUntil) {
    if (Math.abs(ytTime() - msg.time) > 1.5) {
      state.suppressUntil = Date.now() + 900;
      state.yt.seekTo(msg.time, true);
    }
    if (msg.paused && ytPlaying()) { state.suppressUntil = Date.now() + 900; state.yt.pauseVideo(); }
    if (!msg.paused && !ytPlaying()) { state.suppressUntil = Date.now() + 900; state.yt.playVideo(); }
  }
}

function updateTimeUi(position, duration) {
  state.position = position;
  ui.timeNow.textContent = fmtTime(position);
  ui.timeTotal.textContent = fmtTime(duration);
  if (!state.seeking) {
    ui.seek.value = duration > 0 ? Math.round((position / duration) * 1000) : 0;
  }
}

function updateControlsEnabled() {
  let ready;
  // A second screen has no player, so it goes on what the host reports.
  if (state.companion) ready = state.duration > 0;
  else if (state.mode === 'youtube') ready = !!state.yt;
  else if (state.isHost) ready = !!ui.video.src || !!state.localFilm;
  else ready = state.gotFilm;
  const live = state.streamKind === 'screen';
  const locked = state.config.lockControls && !state.isHost;
  ui.playBtn.disabled = !ready || live || locked;
  ui.seek.disabled = !ready || live || locked || !(state.duration > 0);
  ui.playBtn.title = locked ? 'The host locked playback' : '';
  updateMusic();
}

// A screen share has no timeline, so swap the transport controls for a badge.
function applyStreamKind() {
  const live = state.streamKind === 'screen';
  ui.controls.classList.toggle('live', live);
  ui.liveBadge.hidden = !live;
  updateControlsEnabled();
}

/* ------------------------------------------------------------------ */
/* shared playback controls                                            */
/* ------------------------------------------------------------------ */

ui.playBtn.addEventListener('click', () => {
  const action = state.paused ? 'play' : 'pause';
  const time = currentTime();
  applyLocalControl(action, time);
  send({ t: 'control', action, time });
});

ui.seek.addEventListener('input', () => { state.seeking = true; });
ui.seek.addEventListener('change', () => {
  state.seeking = false;
  if (!(state.duration > 0)) return;
  const time = (Number(ui.seek.value) / 1000) * state.duration;
  applyLocalControl('seek', time);
  send({ t: 'control', action: 'seek', time });
});

function currentTime() {
  if (state.companion) return state.position;
  if (state.mode === 'youtube') return ytTime();
  return state.isHost ? ui.video.currentTime : state.position;
}

// Applies a control on the device that triggered it. In file mode a guest only
// sends the request: the host's element is the single source of truth and the
// change comes back through the stream.
function applyLocalControl(action, time) {
  if (state.mode === 'youtube') {
    if (state.yt) {
      state.suppressUntil = Date.now() + 900;
      if (action === 'play') state.yt.playVideo();
      else if (action === 'pause') state.yt.pauseVideo();
      else if (action === 'seek') state.yt.seekTo(time, true);
    }
  } else if (state.isHost) {
    if (action === 'play') ui.video.play().catch(() => {});
    else if (action === 'pause') ui.video.pause();
    else if (action === 'seek') ui.video.currentTime = time;
  }
  if (action !== 'seek') {
    state.paused = action === 'pause';
    ui.playBtn.textContent = state.paused ? 'Play' : 'Pause';
  }
}

// Applies a control that someone else triggered.
function applyRemoteControl(msg) {
  if (state.mode === 'youtube') {
    if (state.yt) {
      state.suppressUntil = Date.now() + 900;
      if (msg.action === 'play') state.yt.playVideo();
      else if (msg.action === 'pause') state.yt.pauseVideo();
      else if (msg.action === 'seek') state.yt.seekTo(msg.time, true);
    }
  } else if (state.isHost) {
    if (msg.action === 'play') ui.video.play().catch(() => {});
    else if (msg.action === 'pause') ui.video.pause();
    else if (msg.action === 'seek') ui.video.currentTime = msg.time;
  }
  if (msg.action !== 'seek') {
    state.paused = msg.action === 'pause';
    ui.playBtn.textContent = state.paused ? 'Play' : 'Pause';
  }
  sysMessage(msg.action === 'seek'
    ? `${msg.name} jumped to ${fmtTime(msg.time)}.`
    : `${msg.name} hit ${msg.action}.`);
}

/* ------------------------------------------------------------------ */
/* YouTube mode                                                        */
/* ------------------------------------------------------------------ */

function ensureYouTubeApi() {
  if (state.ytReady) return Promise.resolve();
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) { state.ytReady = true; resolve(); return; }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      state.ytReady = true;
      if (typeof previous === 'function') previous();
      resolve();
    };
    if (!document.getElementById('yt-api')) {
      const script = document.createElement('script');
      script.id = 'yt-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
    setTimeout(resolve, 8000);
  });
}

function loadYouTube(videoId, announce) {
  if (!state.ytReady || !window.YT || !window.YT.Player) {
    state.ytPendingId = videoId;
    ensureYouTubeApi().then(() => {
      const pending = state.ytPendingId;
      state.ytPendingId = null;
      if (pending) loadYouTube(pending, announce);
    });
    return;
  }

  hideOverlay();

  if (state.yt && state.yt.loadVideoById) {
    state.suppressUntil = Date.now() + 1500;
    state.yt.loadVideoById(videoId);
  } else {
    ui.ytHolder.innerHTML = '<div id="yt-player"></div>';
    state.yt = new YT.Player('yt-player', {
      videoId,
      playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          state.duration = ytDuration();
          updateTimeUi(0, state.duration);
          updateControlsEnabled();
          if (state.isHost) startProgressLoop();
          showOverlay('Ready. Tap to start.', 'Start', startYouTube);
        },
        onStateChange: onYtStateChange,
        onError: () => showOverlay('That video will not play here. Try another link.')
      }
    });
  }

  if (announce) {
    send({ t: 'source', youtubeId: videoId, title: state.session.title });
  }
}

// Browsers need a real tap before a video with sound may start.
function startYouTube() {
  hideOverlay();
  if (!state.yt) return;
  if (state.isHost) {
    const time = ytTime();
    applyLocalControl('play', time);
    send({ t: 'control', action: 'play', time });
  } else {
    state.suppressUntil = Date.now() + 900;
    state.yt.playVideo();
  }
}

function onYtStateChange(e) {
  state.duration = ytDuration();
  updateControlsEnabled();
  const playing = e.data === YT.PlayerState.PLAYING;
  if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
    state.paused = !playing;
    ui.playBtn.textContent = playing ? 'Pause' : 'Play';
    if (Date.now() < state.suppressUntil) return;
    send({ t: 'control', action: playing ? 'play' : 'pause', time: ytTime() });
  }
}

function ytTime() { return state.yt && state.yt.getCurrentTime ? (state.yt.getCurrentTime() || 0) : 0; }
function ytDuration() { return state.yt && state.yt.getDuration ? (state.yt.getDuration() || 0) : 0; }
function ytPlaying() { return !!(state.yt && state.yt.getPlayerState && state.yt.getPlayerState() === 1); }

ui.ytLoad.addEventListener('click', () => {
  const id = parseYouTubeId(ui.ytUrl.value);
  if (!id) { toast('That does not look like a YouTube link.'); return; }
  setLoading(ui.ytLoad, true);
  showOverlay('Loading the video...', null, null, true);
  loadYouTube(id, true);
  setTimeout(() => setLoading(ui.ytLoad, false), 1200);
});
ui.ytUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.ytLoad.click(); });

// Keep the guest's clock ticking between the host's progress messages.
setInterval(() => {
  if (state.mode !== 'youtube' || !state.yt || state.seeking) return;
  updateTimeUi(ytTime(), state.duration || ytDuration());
}, 500);

/* ------------------------------------------------------------------ */
/* screen sharing                                                      */
/* ------------------------------------------------------------------ */

function sharingScreen() {
  return !!state.screenStream;
}

function setShareUi() {
  ui.shareLabel.textContent = sharingScreen() ? 'Stop sharing' : 'Share my screen';
  ui.shareBtn.classList.toggle('active', sharingScreen());
}

async function startScreenShare() {
  const media = navigator.mediaDevices;
  if (!media || !media.getDisplayMedia) {
    toast('Screen sharing is not available in this browser.');
    return;
  }

  let stream;
  setLoading(ui.shareBtn, true);
  try {
    stream = await media.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      // The tab's own sound, not a microphone, so leave it unprocessed.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch {
    setLoading(ui.shareBtn, false);
    return; // the picker was cancelled
  }
  setLoading(ui.shareBtn, false);

  stopLocalFilm();
  state.screenStream = stream;
  state.localFilm = stream;
  state.streamKind = 'screen';

  // Preview it muted: the real thing is already playing on this machine, and
  // unmuting here would double the sound and feed the microphone.
  resetVideoElement();
  ui.video.srcObject = stream;
  ui.video.muted = true;
  ui.video.play().catch(() => {});
  hideOverlay();

  if (stream.getAudioTracks().length === 0) {
    sysMessage('Sharing without sound. To include it, share a browser tab and tick "Also share tab audio".');
  }
  stream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);

  broadcastFilm();
  ui.roomTitle.textContent = 'Screen share';
  send({ t: 'source', title: 'Screen share', youtubeId: null, kind: 'screen' });
  setShareUi();
  applyStreamKind();
  toast('Sharing your screen');
}

function stopScreenShare() {
  if (!state.screenStream) return;
  state.screenStream.getTracks().forEach((t) => t.stop());
  state.screenStream = null;
  state.localFilm = null;
  state.streamKind = 'none';

  detachFilm();
  ui.video.srcObject = null;
  setShareUi();
  applyStreamKind();
  showOverlay('You stopped sharing.', 'Share again', startScreenShare);
  send({ t: 'source', title: state.session ? state.session.title : '', youtubeId: null, kind: 'none' });
}

// Releases whatever the host was sending before a new source replaces it.
function stopLocalFilm() {
  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }
  state.localFilm = null;
}

function detachFilm() {
  for (const entry of state.peers.values()) {
    if (entry.filmVideo) entry.filmVideo.sender.replaceTrack(null).catch(() => {});
    if (entry.filmAudio) entry.filmAudio.sender.replaceTrack(null).catch(() => {});
  }
}

ui.shareBtn.addEventListener('click', () => {
  if (sharingScreen()) stopScreenShare();
  else startScreenShare();
});

/* ------------------------------------------------------------------ */
/* fullscreen                                                          */
/* ------------------------------------------------------------------ */

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

// The whole stage goes fullscreen, not just the picture, so the controls and
// the reaction bar come along instead of being locked out behind the video.
function toggleFullscreen() {
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const el = ui.stage;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) { toast('Fullscreen is not available here.'); return; }
  Promise.resolve(request.call(el)).catch(() => toast('Fullscreen was blocked.'));
}

ui.fsBtn.addEventListener('click', toggleFullscreen);

ui.videoWrap.addEventListener('dblclick', (e) => {
  // Do not swallow a double tap on the overlay's own button.
  if (e.target.closest('button')) return;
  toggleFullscreen();
});

let idleTimer = null;
function nudgeControls() {
  ui.stage.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!fullscreenElement()) return;
  idleTimer = setTimeout(() => {
    if (document.activeElement === ui.chatInput) return;
    ui.stage.classList.add('idle');
  }, 2800);
}

ui.stage.addEventListener('mousemove', nudgeControls);
ui.stage.addEventListener('touchstart', nudgeControls, { passive: true });

// Only the fullscreen element and its descendants are painted, so the form is
// moved rather than duplicated - one element, one set of listeners.
const chatFormHome = ui.chatForm.parentElement;

function onFullscreenChange() {
  const on = !!fullscreenElement();
  ui.fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  ui.fsBtn.title = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
  if (on) ui.stage.appendChild(ui.chatForm);
  else chatFormHome.appendChild(ui.chatForm);
  ui.chatOverlay.innerHTML = '';
  nudgeControls();
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

document.addEventListener('keydown', (e) => {
  if (!state.session || e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  if (e.key === 'Enter' && fullscreenElement()) {
    e.preventDefault();
    nudgeControls();
    ui.chatInput.focus();
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  } else if (e.key === ' ' && !ui.playBtn.disabled) {
    e.preventDefault();
    ui.playBtn.click();
  }
});

/* ------------------------------------------------------------------ */
/* chat + reactions                                                    */
/* ------------------------------------------------------------------ */

ui.chatForm.addEventListener('keydown', nudgeControls);

ui.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.chatInput.value.trim();
  if (!text || !canChat()) return;
  send({ t: 'chat', text });
  chatMessage('You', text, true);
  ui.chatInput.value = '';
});

for (const emoji of EMOJIS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = emoji;
  btn.setAttribute('aria-label', `React with ${emoji}`);
  btn.addEventListener('click', () => {
    floatEmoji(emoji);
    send({ t: 'reaction', emoji });
  });
  ui.reactionBar.appendChild(btn);
}

function floatEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = (10 + Math.random() * 75) + '%';
  ui.reactions.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

try {
  const saved = localStorage.getItem('wt-name');
  if (saved) ui.name.value = saved;
} catch {}

const inviteCode = new URLSearchParams(location.search).get('code');
if (inviteCode) {
  ui.code.value = inviteCode.toUpperCase().slice(0, 6);
  if (!ui.name.value) ui.name.focus();
}

loadPublicSessions();

// The list is the first thing on the page, so it should not look empty just
// because it was drawn a minute ago. Only poll while it is actually on screen.
setInterval(() => {
  if (state.session || document.hidden || !ui.home.classList.contains('active')) return;
  loadPublicSessions(true);
}, 15000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.session && ui.home.classList.contains('active')) {
    loadPublicSessions(true);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

window.addEventListener('beforeunload', () => {
  if (state.session) send({ t: 'leave' });
});

/* ------------------------------------------------------------------ */
/* session persistence                                                 */
/* ------------------------------------------------------------------ */

const RESUME_KEY = 'wt-resume';
let resuming = false;
let reconnectAttempt = 0;

function saveResume(code, token) {
  if (!token) return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ code, token, at: Date.now() }));
  } catch {}
}

function loadResume() {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
}

// A reload or a dropped connection should not cost you the room: the server
// holds your seat for a grace period while we come back with the same token.
function scheduleReconnect() {
  const saved = loadResume();
  if (!saved) return;
  if (reconnectAttempt >= 6) {
    resuming = false;
    showOverlay('Lost the connection.', 'Back home', goHome);
    return;
  }
  const delay = Math.min(8000, 700 * Math.pow(2, reconnectAttempt++));
  resuming = true;
  if (state.session) showOverlay('Reconnecting...', null, null, true);
  setTimeout(() => {
    if (!resuming) return;
    state.wantConnected = true;
    connect(() => send({ t: 'rejoin', code: saved.code, token: saved.token }));
  }, delay);
}

/* ------------------------------------------------------------------ */
/* permission-aware UI                                                 */
/* ------------------------------------------------------------------ */

function canChat() {
  if (!state.me) return true;
  if (state.me.chatBlocked) return false;
  return state.config.chatOpen || state.isHost;
}

// One place that re-derives everything the server may have changed.
function afterStateChange() {
  renderPeers();
  renderPanel();
  renderBanners();
  applyMicState();
  updateControlsEnabled();

  const allowed = canChat();
  ui.chatInput.disabled = !allowed;
  ui.chatForm.querySelector('button').disabled = !allowed;
  ui.chatInput.placeholder = allowed ? 'Say something...' : 'Chat is unavailable';
  if (allowed) {
    ui.chatNote.hidden = true;
  } else {
    ui.chatNote.hidden = false;
    ui.chatNote.textContent = state.me && state.me.chatBlocked
      ? 'The host blocked you from the chat.'
      : 'The host closed the chat.';
  }

  const pending = state.roster.filter((m) => m.wantsHost).length;
  ui.panelBadge.hidden = !(state.isHost && pending);
  ui.panelBadge.textContent = String(pending);
}

/* ------------------------------------------------------------------ */
/* room panel                                                          */
/* ------------------------------------------------------------------ */

function openPanel() {
  ui.panel.hidden = false;
  renderPanel();
}

function closePanel() {
  ui.panel.hidden = true;
}

ui.panelBtn.addEventListener('click', () => (ui.panel.hidden ? openPanel() : closePanel()));
ui.panelClose.addEventListener('click', closePanel);
ui.panelScrim.addEventListener('click', closePanel);

function actionButton(label, handler, danger) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (danger) btn.className = 'danger';
  btn.addEventListener('click', handler);
  return btn;
}

function tagEl(text, kind) {
  const el = document.createElement('span');
  el.className = 'tag' + (kind ? ' ' + kind : '');
  el.textContent = text;
  return el;
}

function renderPanel() {
  if (ui.panel.hidden) return;

  ui.hostSettings.hidden = !state.isHost;
  ui.pollMaker.hidden = !state.isHost;
  ui.guestActions.hidden = state.isHost || state.companion;

  ui.cfgChat.checked = state.config.chatOpen;
  ui.cfgLock.checked = state.config.lockControls;
  ui.cfgMuteAll.checked = state.config.muteAll;

  const watchers = state.roster.filter((m) => !m.companion).length;
  ui.peopleCount.textContent = '(' + watchers + ')';

  ui.memberList.innerHTML = '';
  for (const m of state.roster) {
    const row = document.createElement('li');
    row.className = 'member-row';

    const top = document.createElement('div');
    top.className = 'member-top';
    const av = document.createElement('span');
    av.className = 'av';
    av.textContent = (m.name.trim()[0] || '?').toUpperCase();
    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = m.id === state.myId ? m.name + ' (you)' : m.name;
    top.appendChild(av);
    top.appendChild(name);
    row.appendChild(top);

    const tags = document.createElement('div');
    tags.className = 'tags';
    if (m.isHost) tags.appendChild(tagEl('Host', 'host'));
    if (m.companion) tags.appendChild(tagEl('2nd screen'));
    if (!m.online) tags.appendChild(tagEl('Away', 'away'));
    if (m.hostMuted) tags.appendChild(tagEl(m.muteUntil ? 'Timed mute' : 'Muted', 'warn'));
    if (m.selfMuted) tags.appendChild(tagEl('Self muted'));
    if (m.chatBlocked) tags.appendChild(tagEl('Chat blocked', 'warn'));
    if (m.wantsHost) tags.appendChild(tagEl('Wants to host', 'host'));
    if (tags.children.length) row.appendChild(tags);

    const actions = document.createElement('div');
    actions.className = 'member-actions';

    if (state.isHost && m.id !== state.myId) {
      if (m.wantsHost) {
        actions.appendChild(actionButton('Accept host request', () =>
          send({ t: 'host:requestResponse', id: m.id, accept: true })));
        actions.appendChild(actionButton('Decline', () =>
          send({ t: 'host:requestResponse', id: m.id, accept: false })));
      }
      if (!m.companion) {
        if (m.hostMuted) {
          actions.appendChild(actionButton('Unmute', () => send({ t: 'host:unmute', id: m.id })));
        } else {
          actions.appendChild(actionButton('Mute 30s', () =>
            send({ t: 'host:mute', id: m.id, seconds: 30 })));
          actions.appendChild(actionButton('Mute', () =>
            send({ t: 'host:mute', id: m.id, seconds: 0 })));
        }
      }
      actions.appendChild(actionButton(
        m.chatBlocked ? 'Allow chat' : 'Block chat',
        () => send({ t: 'host:blockChat', id: m.id, blocked: !m.chatBlocked })
      ));
      if (!m.companion) {
        actions.appendChild(actionButton('Make host', () => {
          if (confirm('Hand the host role to ' + m.name + '?')) {
            send({ t: 'host:transfer', id: m.id });
          }
        }));
      }
      actions.appendChild(actionButton('Remove', () => {
        if (confirm('Remove ' + m.name + ' from the session?')) {
          send({ t: 'host:kick', id: m.id });
        }
      }, true));
    }

    const canVote = !state.isHost && !state.companion && m.id !== state.myId
      && !m.isHost && !m.companion;
    if (canVote) {
      actions.appendChild(actionButton('Vote to remove', () => {
        if (confirm('Start a vote to remove ' + m.name + '?')) {
          send({ t: 'votekick:start', id: m.id });
        }
      }, true));
    }

    if (actions.children.length) row.appendChild(actions);
    ui.memberList.appendChild(row);
  }
}

ui.cfgChat.addEventListener('change', () => send({ t: 'host:config', chatOpen: ui.cfgChat.checked }));
ui.cfgLock.addEventListener('change', () => send({ t: 'host:config', lockControls: ui.cfgLock.checked }));
ui.cfgMuteAll.addEventListener('change', () => send({ t: 'host:config', muteAll: ui.cfgMuteAll.checked }));

ui.askHost.addEventListener('click', () => {
  send({ t: 'hostRequest' });
  toast('Request sent to the host');
});

ui.pollCreate.addEventListener('click', () => {
  const question = ui.pollQ.value.trim();
  const options = ui.pollOpts.map((i) => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) {
    toast('A poll needs a question and two options.');
    return;
  }
  send({ t: 'host:poll', question, options });
  ui.pollQ.value = '';
  ui.pollOpts.forEach((i) => { i.value = ''; });
  closePanel();
});

/* ------------------------------------------------------------------ */
/* banners: polls and votes                                            */
/* ------------------------------------------------------------------ */

function renderBanners() {
  ui.banners.innerHTML = '';
  if (state.poll) ui.banners.appendChild(pollBanner(state.poll));
  if (state.voteKick) ui.banners.appendChild(voteBanner(state.voteKick));
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

function pollBanner(poll) {
  const box = document.createElement('div');
  box.className = 'banner';

  const title = document.createElement('h4');
  title.textContent = poll.question;
  box.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'banner-sub';
  sub.textContent = poll.open
    ? plural(poll.total, 'vote') + ' so far'
    : 'Closed - ' + plural(poll.total, 'vote');
  box.appendChild(sub);

  poll.options.forEach((option, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'poll-opt';

    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'poll-bar' + (state.myVote === i ? ' mine' : '');
    bar.disabled = !poll.open;

    const fill = document.createElement('span');
    fill.className = 'poll-fill';
    fill.style.width = (poll.total ? Math.round((option.votes / poll.total) * 100) : 0) + '%';

    const label = document.createElement('span');
    label.className = 'poll-label';
    const text = document.createElement('span');
    text.textContent = option.text;
    const count = document.createElement('span');
    count.textContent = String(option.votes);
    label.appendChild(text);
    label.appendChild(count);

    bar.appendChild(fill);
    bar.appendChild(label);
    bar.addEventListener('click', () => {
      state.myVote = i;
      send({ t: 'poll:vote', option: i });
      renderBanners();
    });

    wrap.appendChild(bar);
    box.appendChild(wrap);
  });

  if (state.isHost) {
    const actions = document.createElement('div');
    actions.className = 'banner-actions';
    if (poll.open) {
      actions.appendChild(actionButton('Close voting', () => send({ t: 'host:pollClose' })));
    }
    actions.appendChild(actionButton('Clear', () => send({ t: 'host:pollClear' })));
    box.appendChild(actions);
  }
  return box;
}

function voteBanner(vote) {
  const box = document.createElement('div');
  box.className = 'banner vote';

  const title = document.createElement('h4');
  title.textContent = 'Remove ' + vote.targetName + '?';
  box.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'banner-sub';
  sub.textContent = 'Started by ' + vote.startedBy + ' - ' + vote.yes + ' of ' + vote.needed + ' needed';
  box.appendChild(sub);

  if (vote.targetId !== state.myId && !state.companion) {
    const actions = document.createElement('div');
    actions.className = 'banner-actions';
    actions.appendChild(actionButton('Yes, remove', () => send({ t: 'votekick:vote', yes: true })));
    actions.appendChild(actionButton('No, keep', () => send({ t: 'votekick:vote', yes: false })));
    box.appendChild(actions);
  }
  return box;
}

/* ------------------------------------------------------------------ */
/* leaving as the host                                                 */
/* ------------------------------------------------------------------ */

function openLeaveDialog(others) {
  ui.heir.innerHTML = '';
  const eligible = others.filter((m) => m.online);
  for (const m of eligible) {
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = m.name;
    ui.heir.appendChild(option);
  }
  ui.heirWrap.hidden = eligible.length === 0;
  ui.leaveText.textContent = eligible.length
    ? 'You are the host. Hand the room over so it keeps going, or end it for everyone.'
    : 'Nobody else is connected right now, so leaving will end the session.';
  ui.leaveDialog.hidden = false;
}

ui.leaveTransfer.addEventListener('click', () => leaveSession({ transferTo: ui.heir.value }));
ui.leaveDestroy.addEventListener('click', () => leaveSession({ destroy: true }));
ui.leaveCancel.addEventListener('click', () => { ui.leaveDialog.hidden = true; });
ui.leaveScrim.addEventListener('click', () => { ui.leaveDialog.hidden = true; });

/* ------------------------------------------------------------------ */
/* pick the session back up on load                                    */
/* ------------------------------------------------------------------ */

(function tryResume() {
  const saved = loadResume();
  if (!saved || !saved.code || !saved.token) return;
  resuming = true;
  state.wantConnected = true;
  toast('Reconnecting to your session...');
  connect(() => send({ t: 'rejoin', code: saved.code, token: saved.token }));
})();


/* ------------------------------------------------------------------ */
/* waiting room music                                                  */
/* ------------------------------------------------------------------ */

const MUSIC_KEY = 'wt-music';
const MUSIC_VOLUME = 0.12;

let musicEnabled = true;
// public/waiting-room.mp3 is optional and not shipped with the source.
let musicAvailable = true;
let musicUnlocked = false;
let musicFade = null;

try { musicEnabled = localStorage.getItem(MUSIC_KEY) !== 'off'; } catch {}

// True whenever there is no picture to watch: the home screen, or a room that
// is still waiting for someone to put something on. Pausing mid-episode does
// not count, otherwise the music would barge in every time you stop to talk.
function musicShouldPlay() {
  if (!musicEnabled || !musicAvailable) return false;
  if (!state.session) return true;
  if (state.mode === 'youtube') return !state.yt;
  if (state.streamKind === 'screen') return false;
  if (state.companion) return !(state.duration > 0);
  if (state.isHost) return !ui.video.src && !state.localFilm;
  return !state.gotFilm;
}

function fadeMusicTo(target, done) {
  clearInterval(musicFade);
  const audio = ui.waitingAudio;
  musicFade = setInterval(() => {
    const diff = target - audio.volume;
    if (Math.abs(diff) < 0.012) {
      audio.volume = target;
      clearInterval(musicFade);
      musicFade = null;
      if (done) done();
      return;
    }
    audio.volume = Math.min(1, Math.max(0, audio.volume + (diff > 0 ? 0.012 : -0.012)));
  }, 45);
}

function renderMusicButtons(playing) {
  for (const btn of [ui.musicBtn, ui.musicBtnHome]) {
    if (!btn) continue;
    btn.setAttribute('aria-pressed', String(musicEnabled));
    btn.classList.toggle('playing', musicEnabled && !!playing);
    btn.title = musicEnabled ? 'Waiting room music on' : 'Waiting room music off';
  }
}

function updateMusic() {
  const audio = ui.waitingAudio;
  if (!audio) return;
  const want = musicShouldPlay();
  renderMusicButtons(want && !audio.paused);

  if (want) {
    if (audio.paused) {
      audio.volume = 0;
      audio.play().then(() => {
        musicUnlocked = true;
        renderMusicButtons(true);
        fadeMusicTo(MUSIC_VOLUME);
      }).catch(() => {
        // Browsers refuse audio before the page has been touched; the first
        // click or key press below tries again.
      });
    } else if (!musicFade && Math.abs(audio.volume - MUSIC_VOLUME) > 0.005) {
      fadeMusicTo(MUSIC_VOLUME);
    }
  } else if (!audio.paused) {
    fadeMusicTo(0, () => {
      audio.pause();
      renderMusicButtons(false);
    });
  }
}

function unlockMusic() {
  if (musicUnlocked || !musicEnabled) return;
  updateMusic();
}
document.addEventListener('pointerdown', unlockMusic);
document.addEventListener('keydown', unlockMusic);

function toggleMusic() {
  musicEnabled = !musicEnabled;
  try { localStorage.setItem(MUSIC_KEY, musicEnabled ? 'on' : 'off'); } catch {}
  updateMusic();
  toast(musicEnabled ? 'Waiting room music on' : 'Waiting room music off');
}

if (ui.waitingAudio) {
  ui.waitingAudio.addEventListener('error', () => {
    musicAvailable = false;
    for (const btn of [ui.musicBtn, ui.musicBtnHome]) if (btn) btn.hidden = true;
  });
}

if (ui.musicBtn) ui.musicBtn.addEventListener('click', toggleMusic);
if (ui.musicBtnHome) ui.musicBtnHome.addEventListener('click', toggleMusic);

updateMusic();
