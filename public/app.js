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

const EMOJIS = [
  '\u{1F602}', '\u{1F62E}', '❤️', '\u{1F525}', '\u{1F62D}', '\u{1F44F}',
  '\u{1F631}', '\u{1F914}', '\u{1F612}', '\u{1F918}', '\u{1F44D}', '\u{1F44E}',
  '\u{1F595}', '\u{1F923}', '\u{1F60D}', '\u{1F644}', '\u{1F62C}', '\u{1F92F}',
  '\u{1F634}', '\u{1F440}', '\u{1F480}', '\u{1F921}', '\u{1F64C}', '\u{2728}',
  '\u{1F37F}', '\u{1F389}', '\u{1F605}', '\u{1F633}', '\u{1F971}', '\u{1F976}',
  '\u{1F975}', '\u{1F44B}', '\u{1F64F}'
];

// Only the first few sit on the bar; the rest live behind the picker.
const QUICK_EMOJIS = 6;

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
  emojiPop: $('emoji-pop'), emojiMore: null,
  playBtn: $('play-btn'), seek: $('seek'), timeNow: $('time-now'), timeTotal: $('time-total'),
  hostTools: $('host-tools'), pickFile: $('pick-file'), fileInput: $('file-input'),
  shareBtn: $('share-btn'), shareLabel: $('share-label'),
  controls: $('controls'), liveBadge: $('live-badge'),
  connChip: $('conn-chip'), connText: $('conn-text'),
  ytTools: $('yt-tools'), ytUrl: $('yt-url'), ytLoad: $('yt-load'),
  linkTools: $('link-tools'), linkUrl: $('link-url'), linkLoad: $('link-load'),
  embedTools: $('embed-tools'), embedUrl: $('embed-url'), embedLoad: $('embed-load'),
  embedHolder: $('embed-holder'), countdownBtn: $('countdown-btn'),
  countdown: $('countdown'), countdownNum: $('countdown-num'),
  peers: $('peers'), chatLog: $('chat-log'), chatForm: $('chat-form'), chatInput: $('chat-input'),
  stickerBtn: $('sticker-btn'), stickerInput: $('sticker-input'),
  toast: $('toast'),
  waitingAudio: $('waiting-audio'), musicBtn: $('music-btn'), musicBtnHome: $('music-btn-home'),
  profileBtn: $('profile-btn'), profileAv: $('profile-av'), profileName: $('profile-name'),
  profileMenu: $('profile-menu'),
  historyList: $('history-list'), historyEmpty: $('history-empty'), historyClear: $('history-clear'),
  historyDetail: $('history-detail'), historyBack: $('history-back'),
  detailTitle: $('detail-title'), detailFacts: $('detail-facts'),
  detailPeople: $('detail-people'), detailLog: $('detail-log'),
  helpBtn: $('help-btn'), helpDialog: $('help-dialog'), helpClose: $('help-close'),
  helpScrim: $('help-scrim'),
  renameSec: $('rename-sec'), renameInput: $('rename-input'), renameSave: $('rename-save'),
  pollOptionsWrap: $('poll-options'), pollAdd: $('poll-add'),
  replyBar: $('reply-bar'), replyName: $('reply-name'), replyText: $('reply-text'),
  replyCancel: $('reply-cancel'), mentionPop: $('mention-pop'),
  panel: $('panel'), panelBtn: $('panel-btn'), panelClose: $('panel-close'),
  panelScrim: $('panel-scrim'), panelBadge: $('panel-badge'),
  hostSettings: $('host-settings'), cfgChat: $('cfg-chat'), cfgLock: $('cfg-lock'),
  cfgMuteAll: $('cfg-muteall'),
  pollMaker: $('poll-maker'), pollQ: $('poll-q'), pollCreate: $('poll-create'),
  memberList: $('member-list'), peopleCount: $('people-count'),
  guestActions: $('guest-actions'), askHost: $('ask-host'),
  banSec: $('ban-sec'), banList: $('ban-list'), banCount: $('ban-count'),
  banners: $('banners'), chatNote: $('chat-note'),
  leaveDialog: $('leave-dialog'), leaveScrim: $('leave-scrim'), leaveText: $('leave-text'),
  heirWrap: $('leave-heir-wrap'), heir: $('heir'), leaveTransfer: $('leave-transfer'),
  leaveDestroy: $('leave-destroy'), leaveCancel: $('leave-cancel')
};

// Session history lives on this device only. Declared up here because
// sysMessage() and chatMessage() feed it, and those are defined long before
// the history section further down.
const HISTORY_KEY = 'wt-history';
const HISTORY_MAX = 40;
const LOG_MAX = 800;

let live = null; // the record for the session currently open

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
  bans: [],
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
  historyLog('system', null, text);
  const li = document.createElement('li');
  li.className = 'sys';
  li.textContent = text;
  ui.chatLog.appendChild(li);
  ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
  popMessage(null, text, 'sys');
}

// The sidebar is not rendered in fullscreen, so messages surface over the
// picture instead and fade out on their own.
function popMessage(who, text, kind, image) {
  const pop = document.createElement('div');
  pop.className = 'chat-pop' + (kind ? ' ' + kind : '');
  if (who) {
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = who;
    pop.appendChild(name);
  }
  if (image) {
    const img = document.createElement('img');
    img.className = 'sticker';
    img.src = image;
    img.alt = 'sticker';
    pop.appendChild(img);
  }
  if (text) pop.appendChild(document.createTextNode(text));
  ui.chatOverlay.appendChild(pop);
  // Keep the stack shallow enough to stay out of the way of the film.
  while (ui.chatOverlay.children.length > 5) ui.chatOverlay.firstChild.remove();
  setTimeout(() => pop.remove(), 7300);
}

// Splits @names out of the text so they can be highlighted, without ever
// putting user text near innerHTML.
function renderBody(text) {
  const frag = document.createDocumentFragment();
  const pattern = /@([\p{L}\p{N}_'-]{1,24})/gu;
  let last = 0;
  let m;
  while ((m = pattern.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const span = document.createElement('span');
    span.className = 'mention';
    span.textContent = m[0];
    const me = myName();
    if (me && m[1].toLowerCase() === me.toLowerCase()) span.classList.add('is-me');
    frag.appendChild(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function chatMessage(who, text, mine, meta) {
  const hasImage = !!(meta && meta.image);
  historyLog('chat', mine ? (ui.name.value.trim() || 'You') : who,
    hasImage ? (text ? text + ' [picture]' : '[picture]') : text);
  const li = document.createElement('li');
  if (mine) li.classList.add('me');
  if (!mine && mentionsMe(text)) li.classList.add('tagged');

  if (meta && meta.replyTo) {
    const quote = document.createElement('div');
    quote.className = 'quote';
    const qname = document.createElement('span');
    qname.className = 'quote-name';
    qname.textContent = meta.replyTo.name;
    quote.appendChild(qname);
    quote.appendChild(document.createTextNode(meta.replyTo.text));
    li.appendChild(quote);
  }

  if (!mine) {
    const strong = document.createElement('span');
    strong.className = 'who';
    strong.textContent = who;
    strong.style.color = avatarColor(who);
    li.appendChild(strong);
  }

  if (meta && meta.image) {
    const img = document.createElement('img');
    img.className = 'sticker';
    img.src = meta.image;
    img.alt = text || 'sticker';
    img.loading = 'lazy';
    li.appendChild(img);
  }

  if (text) li.appendChild(renderBody(text));

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = new Date((meta && meta.ts) || Date.now())
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.appendChild(time);

  const id = (meta && meta.id) || ('m' + Date.now() + Math.random().toString(36).slice(2, 6));
  li.classList.add('replyable');
  li.title = 'Click to reply';
  li.addEventListener('click', () => {
    setReply({ id, name: mine ? (myName() || 'You') : who, text });
  });

  ui.chatLog.appendChild(li);
  ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
  popMessage(mine ? null : who, text, mine ? 'me' : '', meta && meta.image);
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

const SOURCE_HINTS = {
  file: 'Play a file, or share a browser tab so anything you can watch, she can watch. Streams straight to whoever joins - keep this tab open.',
  sync: 'You each open your own copy of the same file. Only play, pause and seek travel between you, so it costs almost no bandwidth and stays sharp on a weak connection.',
  embed: 'Puts any page in the room so you can watch it side by side with voice and chat. Playback is NOT synced - nothing outside this app can be controlled from it - so use the countdown to start together.',
  youtube: 'You both load the same YouTube video and it stays in sync. Nothing is uploaded.'
};

wireSeg(ui.sourceSeg, (btn) => {
  ui.sourceHint.textContent = SOURCE_HINTS[btn.dataset.source] || SOURCE_HINTS.file;
});
wireSeg(ui.privacySeg);
wireSeg(ui.roleSeg);

function homeError(message) {
  ui.homeError.textContent = message;
  ui.homeError.hidden = !message;
}

function rememberName() {
  try { localStorage.setItem('wt-name', ui.name.value.trim()); } catch {}
  renderProfile();
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
  openProfile();
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
  rememberName();
  closeProfile();
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
      if (msg.bans) state.bans = msg.bans;
      for (const m of msg.members) {
        if (m.id !== state.myId) historySeen(m.name, m.companion);
      }
      if (state.session) state.session.hostId = msg.hostId;
      state.me = msg.members.find((m) => m.id === state.myId) || state.me;
      state.isHost = !!state.me && state.me.isHost;
      afterStateChange();
      break;

    case 'config':
      state.config = msg.config;
      afterStateChange();
      break;

    case 'countdown':
      runCountdown(msg.at, msg.from);
      break;

    case 'renamed':
      if (state.session) state.session.title = msg.title;
      ui.roomTitle.textContent = msg.title;
      break;

    case 'host-changed':
      if (state.session) state.session.hostId = msg.hostId;
      state.isHost = msg.hostId === state.myId;
      sysMessage(state.isHost ? 'You are the host now.' : `${msg.name} is the host now.`);
      if (state.isHost) toast('You are the host now');
      afterStateChange();
      break;

    case 'host-request':
      cue('request');
      sysMessage(`${msg.name} asked to become the host.`);
      toast(`${msg.name} wants to host`);
      break;

    case 'you-muted':
      cue('muted');
      sysMessage(msg.seconds
        ? `${msg.by} muted you for ${msg.seconds} seconds.`
        : `${msg.by} muted you.`);
      toast('You were muted');
      break;

    case 'you-unmuted':
      cue('unmuted');
      sysMessage(`${msg.by} unmuted you.`);
      break;

    case 'chat-block':
      cue(msg.blocked ? 'blocked' : 'unblocked');
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
      chatMessage(msg.name, msg.text, false, msg);
      if (mentionsMe(msg.text)) cue('tagged');
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
      if (msg.mediaUrl && state.mode === 'embed') loadEmbed(msg.mediaUrl);
      else if (msg.mediaUrl) loadMediaUrl(msg.mediaUrl, false);
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
  state.bans = msg.bans || [];
  state.selfMuted = rejoined ? !!(msg.me && msg.me.selfMuted) : true;
  if (!rejoined) send({ t: 'selfMute', muted: true });
  saveResume(msg.session.code, msg.token);
  historyStart(msg.session, msg.session.hostId === msg.you, msg.me && msg.me.companion);
  for (const peer of msg.peers) historySeen(peer.name, peer.companion);
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
  const isSync = state.mode === 'sync';
  const isEmbed = state.mode === 'embed';
  resetVideoElement();
  wasHostLastTime = state.isHost;
  setShareUi();
  ui.ytHolder.hidden = !isYouTube;
  ui.embedHolder.hidden = !isEmbed;
  ui.video.hidden = isYouTube || isEmbed;

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
  } else if (isEmbed) {
    if (msg.mediaUrl) loadEmbed(msg.mediaUrl);
    else showOverlay(state.isHost
      ? 'Paste the address of the page you want to watch together.'
      : 'Waiting for the host to open a page.', null, null, !state.isHost);
  } else if (isSync) {
    if (msg.mediaUrl) {
      loadMediaUrl(msg.mediaUrl, false);
    } else {
      showOverlay(state.isHost
        ? 'Choose your copy of the file, or paste a direct video link below.'
        : 'Open your own copy of the file to join in.',
        'Choose file', () => ui.fileInput.click());
    }
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
  historyEnd();
  startConnectionWatch();
  quietSince = 0;
  wasPlaying = false;
  setTimeout(updateMusic, 0);
  state.filmTracks = [];
  state.gotFilm = false;
  state.session = null;
  state.me = null;
  state.roster = [];
  state.poll = null;
  state.voteKick = null;
  state.bans = [];
  state.myVote = null;
  state.selfMuted = false;
  state.config = { chatOpen: true, lockControls: false, muteAll: false };
  ui.banners.innerHTML = '';
  ui.chatNote.hidden = true;
  stopConnectionWatch();
  ui.embedHolder.innerHTML = '';
  ui.embedHolder.hidden = true;
  ui.countdown.hidden = true;
  clearInterval(countdownTimer);
  embedWarned = false;
  clearReply();
  closeMentions();
  closeHelp();
  closeEmojiPop();
  state.duration = 0;
  state.position = 0;
  state.paused = true;

  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }

  ui.room.classList.remove('active');
  ui.home.classList.add('active');
  showView('browse');
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
  if (!companion) paintAvatar(av, name);
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
    // Do NOT flip selfMuted here. Everyone starts muted, and this resolves a
    // moment after the room is entered, so calling setMic(true) would quietly
    // switch the microphone back on behind the user.
    applyMicState();
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
    if (data.reset) {
      // The other side is rebuilding this connection from scratch, so drop
      // ours and wait for their offer rather than answering on a stale one.
      closePeer(peerId);
      const info = state.roster.find((m) => m.id === peerId);
      state.peers.set(peerId, {
        name: info ? info.name : (entry.name || 'Guest'),
        companion: !!(info && info.companion),
        pc: null, audioEl: null, pending: []
      });
      return;
    }
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

  if (state.mode === 'sync') {
    // Nobody is watching our pixels, so skip the capture entirely and just
    // report where we are.
    ui.roomTitle.textContent = file.name.replace(/\.[^.]+$/, '');
    state.streamKind = 'file';
    startProgressLoop();
    applyStreamKind();
    updateControlsEnabled();
    sysMessage('Your copy is loaded. Playback stays in step with everyone else.');
    return;
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

  if (state.mode !== 'sync') broadcastFilm();
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
  if (!drivesOwnPlayer() || state.mode === 'youtube') return;
  state.duration = ui.video.duration || 0;
  updateTimeUi(ui.video.currentTime, state.duration);
  updateControlsEnabled();
}

function onVideoPlay() {
  if (!drivesOwnPlayer() || state.mode === 'youtube') return;
  state.paused = false;
  ui.playBtn.textContent = 'Pause';
  sendProgress();
  updateMusic();
}

function onVideoPause() {
  if (!drivesOwnPlayer() || state.mode === 'youtube') return;
  state.paused = true;
  ui.playBtn.textContent = 'Play';
  sendProgress();
  updateMusic();
}

function onVideoTime() {
  if (drivesOwnPlayer() && state.mode !== 'youtube' && !state.seeking) {
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

  // Each copy plays on its own machine in sync mode, so nudge it back when it
  // drifts, exactly as the YouTube path does.
  if (state.mode === 'sync' && !state.companion && ui.video.src
      && Date.now() > state.suppressUntil) {
    if (Math.abs(ui.video.currentTime - msg.time) > 1.5) {
      state.suppressUntil = Date.now() + 900;
      ui.video.currentTime = msg.time;
    }
    if (msg.paused && !ui.video.paused) { state.suppressUntil = Date.now() + 900; ui.video.pause(); }
    if (!msg.paused && ui.video.paused) { state.suppressUntil = Date.now() + 900; ui.video.play().catch(() => {}); }
  }

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
  if (state.mode === 'embed') ready = false;
  else if (state.companion) ready = state.duration > 0;
  else if (state.mode === 'sync') ready = !!ui.video.src;
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
  if (state.mode === 'sync') return ui.video.currentTime || state.position;
  if (state.mode === 'youtube') return ytTime();
  return state.isHost ? ui.video.currentTime : state.position;
}

// Applies a control on the device that triggered it. In file mode a guest only
// sends the request: the host's element is the single source of truth and the
// change comes back through the stream.
function drivesOwnPlayer() {
  return state.mode === 'sync' ? !state.companion : state.isHost;
}

function applyLocalControl(action, time) {
  if (state.mode === 'youtube') {
    if (state.yt) {
      state.suppressUntil = Date.now() + 900;
      if (action === 'play') state.yt.playVideo();
      else if (action === 'pause') state.yt.pauseVideo();
      else if (action === 'seek') state.yt.seekTo(time, true);
    }
  } else if (drivesOwnPlayer()) {
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
  } else if (drivesOwnPlayer()) {
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
  const payload = { t: 'chat', text };
  if (replyTarget) payload.replyTo = replyTarget;
  send(payload);
  chatMessage(ui.name.value.trim() || 'You', text, true, {
    id: 'local-' + Date.now(),
    ts: Date.now(),
    replyTo: replyTarget
  });
  clearReply();
  ui.chatInput.value = '';
  closeMentions();
});

function emojiButton(emoji) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = emoji;
  btn.setAttribute('aria-label', `React with ${emoji}`);
  btn.addEventListener('click', () => {
    floatEmoji(emoji);
    send({ t: 'reaction', emoji });
    closeEmojiPop();
  });
  return btn;
}

function closeEmojiPop() {
  ui.emojiPop.hidden = true;
  if (ui.emojiMore) ui.emojiMore.setAttribute('aria-expanded', 'false');
}

function buildReactions() {
  ui.reactionBar.innerHTML = '';
  for (const emoji of EMOJIS.slice(0, QUICK_EMOJIS)) {
    ui.reactionBar.appendChild(emojiButton(emoji));
  }
  if (EMOJIS.length <= QUICK_EMOJIS) return;

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'emoji-more';
  more.textContent = '…';
  more.setAttribute('aria-label', 'More reactions');
  more.setAttribute('aria-expanded', 'false');
  more.title = 'More reactions';
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = ui.emojiPop.hidden;
    ui.emojiPop.hidden = !opening;
    more.setAttribute('aria-expanded', String(opening));
  });
  ui.reactionBar.appendChild(more);
  ui.emojiMore = more;

  ui.emojiPop.innerHTML = '';
  for (const emoji of EMOJIS) ui.emojiPop.appendChild(emojiButton(emoji));
}

buildReactions();

ui.emojiPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (!ui.emojiPop.hidden) closeEmojiPop(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.emojiPop.hidden) closeEmojiPop();
});

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
let wasHostLastTime = false;

function afterStateChange() {
  applyHostTools();
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

// A connection carries video only if it was built while we were the host: the
// transceivers are laid down at creation and never appear later. So inheriting
// the role means rebuilding every peer connection, or the new host has the
// buttons but no channel to send a picture down.
function rebuildPeersAsHost() {
  if (state.companion || state.mode === 'youtube') return;
  for (const [peerId, entry] of [...state.peers]) {
    if (entry.companion) continue;
    send({ t: 'signal', to: peerId, data: { reset: true } });
    const name = entry.name;
    const companion = entry.companion;
    closePeer(peerId);
    state.peers.set(peerId, { name, companion, pc: null, audioEl: null, pending: [] });
    createPeer(peerId, true);
  }
}

// Host-only affordances have to follow the role around the room, not be set
// once on the way in.
function applyHostTools() {
  const isYouTube = state.mode === 'youtube';
  const isSync = state.mode === 'sync';
  // In sync mode there is no host stream, so everyone needs their own picker.
  ui.hostTools.hidden = (!state.isHost && !isSync) || state.companion;
  ui.pickFile.hidden = isYouTube;
  ui.shareBtn.hidden = isYouTube || isSync;
  ui.ytTools.hidden = !isYouTube;
  // Only the host shares a link, or everyone would fight over the source.
  ui.linkTools.hidden = !(isSync && state.isHost);
  ui.embedTools.hidden = !(state.mode === 'embed' && state.isHost);

  if (wasHostLastTime && !state.isHost && state.mode === 'file') {
    // Handed the role over: stop pushing our own picture at everyone.
    if (sharingScreen()) stopScreenShare();
    else if (state.localFilm || ui.video.src) {
      stopLocalFilm();
      detachFilm();
      clearInterval(state.progressTimer);
      state.progressTimer = null;
      state.streamKind = 'none';
      resetVideoElement();
      showOverlay('You are no longer the host. Waiting for them to pick something.', null, null, true);
    }
  }

  if (!wasHostLastTime && state.isHost && state.session && state.mode === 'file') {
    rebuildPeersAsHost();
    ui.renameInput.value = state.session.title || '';
    if (state.mode !== 'youtube' && !state.localFilm && !ui.video.src) {
      showOverlay('You are the host now. Choose a video file or share your screen.',
        'Choose file', () => ui.fileInput.click());
    }
  }
  wasHostLastTime = state.isHost;
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
  ui.renameSec.hidden = !state.isHost;
  if (state.session && document.activeElement !== ui.renameInput) {
    ui.renameInput.value = state.session.title || '';
  }
  ui.guestActions.hidden = state.isHost || state.companion;

  ui.cfgChat.checked = state.config.chatOpen;
  ui.cfgLock.checked = state.config.lockControls;
  ui.cfgMuteAll.checked = state.config.muteAll;

  const watchers = state.roster.filter((m) => !m.companion).length;
  ui.peopleCount.textContent = '(' + watchers + ')';

  renderBans();

  ui.memberList.innerHTML = '';
  for (const m of state.roster) {
    const row = document.createElement('li');
    row.className = 'member-row';

    const top = document.createElement('div');
    top.className = 'member-top';
    const av = document.createElement('span');
    av.className = 'av';
    av.textContent = (m.name.trim()[0] || '?').toUpperCase();
    paintAvatar(av, m.name);
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
      actions.appendChild(actionButton('Kick', () => {
        if (confirm('Kick ' + m.name + '? They can rejoin with the link.')) {
          send({ t: 'host:kick', id: m.id });
        }
      }, true));
      actions.appendChild(actionButton('Ban', () => {
        if (confirm('Ban ' + m.name + '? They will not be able to rejoin. You can undo it from the Banned list.')) {
          send({ t: 'host:ban', id: m.id });
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

function renderBans() {
  const show = state.isHost && state.bans.length > 0;
  ui.banSec.hidden = !show;
  if (!show) return;

  ui.banCount.textContent = '(' + state.bans.length + ')';
  ui.banList.innerHTML = '';
  for (const b of state.bans) {
    const li = document.createElement('li');

    const who = document.createElement('div');
    who.className = 'ban-who';
    const name = document.createElement('span');
    name.textContent = b.name;
    who.appendChild(name);
    const how = document.createElement('span');
    how.className = 'meta';
    how.textContent = b.byIp ? 'name and address' : 'name only';
    who.appendChild(how);

    li.appendChild(who);
    li.appendChild(actionButton('Unban', () => send({ t: 'host:unban', token: b.token })));
    ui.banList.appendChild(li);
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
  const options = pollRows().map((i) => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) {
    toast('A poll needs a question and two answers.');
    return;
  }
  send({ t: 'host:poll', question, options });
  ui.pollQ.value = '';
  resetPollBuilder();
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
// Is something actually being watched right now? Loaded-but-paused does not
// count: the music keeps a paused room company until playback resumes.
function mediaPlaying() {
  if (!state.session) return false;
  // Nothing can be observed inside another site's page, so assume it is being
  // watched and keep the music out of the way.
  if (state.mode === 'embed') return true;
  if (state.mode === 'sync') {
    return state.companion ? (state.duration > 0 && !state.paused)
                           : (!!ui.video.src && !ui.video.paused);
  }
  if (state.mode === 'youtube') return !!state.yt && !state.paused;
  if (state.streamKind === 'screen') return true;
  if (state.companion) return state.duration > 0 && !state.paused;
  if (state.isHost) return (!!ui.video.src || !!state.localFilm) && !ui.video.paused;
  return state.gotFilm && !state.paused;
}

function musicShouldPlay() {
  if (!musicEnabled || !musicAvailable) return false;
  return !mediaPlaying();
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

// A seek or a buffer flicks playback off for a second or two. Waiting a beat
// before fading the music back in keeps that from sounding like a glitch.
const MUSIC_RESUME_DELAY = 4000;
let quietSince = 0;
let wasPlaying = false;
let musicRecheck = null;

function updateMusic() {
  const audio = ui.waitingAudio;
  if (!audio) return;

  const playing = mediaPlaying();
  if (playing !== wasPlaying) {
    wasPlaying = playing;
    if (!playing) quietSince = Date.now();
  }

  let want = musicShouldPlay();
  if (want && state.session && quietSince) {
    const waited = Date.now() - quietSince;
    if (waited < MUSIC_RESUME_DELAY) {
      want = false;
      clearTimeout(musicRecheck);
      musicRecheck = setTimeout(updateMusic, MUSIC_RESUME_DELAY - waited + 50);
    }
  }
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

/* ------------------------------------------------------------------ */
/* home views                                                          */
/* ------------------------------------------------------------------ */

const VIEWS = ['browse', 'create', 'join', 'history'];
let currentView = 'browse';

function showView(name, skipHash) {
  if (!VIEWS.includes(name)) name = 'browse';
  currentView = name;

  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('is-active', view.id === 'view-' + name);
  }
  for (const link of document.querySelectorAll('.nav-link')) {
    const on = link.dataset.view === name;
    link.classList.toggle('is-active', on);
    link.setAttribute('aria-selected', String(on));
  }

  homeError('');
  closeProfile();
  if (name === 'history') renderHistoryList();
  if (name === 'browse') loadPublicSessions(true);
  if (!skipHash) location.hash = name === 'browse' ? '' : '#' + name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-view]');
  if (!trigger) return;
  e.preventDefault();
  showView(trigger.dataset.view);
});

window.addEventListener('hashchange', () => {
  showView(location.hash.replace(/^#\/?/, '') || 'browse', true);
});

/* ------------------------------------------------------------------ */
/* profile menu                                                        */
/* ------------------------------------------------------------------ */

function renderProfile() {
  const name = ui.name.value.trim();
  ui.profileAv.textContent = name ? name[0].toUpperCase() : '?';
  if (name) paintAvatar(ui.profileAv, name);
  else ui.profileAv.style.background = '';
  ui.profileName.textContent = name || 'Add name';
  ui.profileBtn.classList.toggle('unset', !name);
}

function openProfile() {
  ui.profileMenu.hidden = false;
  ui.profileBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => ui.name.focus(), 40);
}

function closeProfile() {
  ui.profileMenu.hidden = true;
  ui.profileBtn.setAttribute('aria-expanded', 'false');
}

ui.profileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (ui.profileMenu.hidden) openProfile();
  else closeProfile();
});

ui.profileMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (!ui.profileMenu.hidden) closeProfile(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.profileMenu.hidden) closeProfile();
});

ui.name.addEventListener('input', renderProfile);

/* ------------------------------------------------------------------ */
/* session history, kept on this device                                */
/* ------------------------------------------------------------------ */


function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(records) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, HISTORY_MAX)));
  } catch {
    // storage full or blocked: history is a nicety, never break the session
  }
}

// Everything is recorded from what this browser actually saw, so a guest's
// history covers the part of the session they were present for.
function historyStart(session, isHost, companion) {
  const records = readHistory();
  const open = records.find((r) => r.code === session.code && !r.endedAt);
  if (open) {
    live = open; // rejoining after a reload continues the same record
    return;
  }
  live = {
    id: 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    code: session.code,
    title: session.title,
    source: session.source,
    isPublic: session.isPublic,
    wasHost: isHost,
    companion: !!companion,
    startedAt: Date.now(),
    endedAt: null,
    people: [],
    log: []
  };
  records.unshift(live);
  writeHistory(records);
}

function historySave() {
  if (!live) return;
  const records = readHistory();
  const i = records.findIndex((r) => r.id === live.id);
  if (i === -1) records.unshift(live);
  else records[i] = live;
  writeHistory(records);
}

function historyLog(kind, name, text) {
  if (!live) return;
  live.log.push({ t: Date.now(), kind, name: name || '', text: String(text || '') });
  if (live.log.length > LOG_MAX) live.log.splice(0, live.log.length - LOG_MAX);
  historySave();
}

function historySeen(name, companion) {
  if (!live || !name) return;
  const known = live.people.find((p) => p.name === name);
  if (known) {
    known.seenAt = Date.now();
    return;
  }
  live.people.push({ name, companion: !!companion, firstSeen: Date.now(), seenAt: Date.now() });
  historySave();
}

function historyEnd() {
  if (!live) return;
  live.endedAt = Date.now();
  historySave();
  live = null;
}

/* ---------- rendering ---------- */

function fmtDuration(ms) {
  if (!ms || ms < 0) return '0m';
  // Check the raw value first: rounding 30s would report it as a whole minute.
  if (ms < 60000) return 'under a minute';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'Today at ' + time;
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday at ' + time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' at ' + time;
}

function sourceLabel(record) {
  if (record.source === 'youtube') return 'YouTube';
  return 'From device';
}

function renderHistoryList() {
  const records = readHistory();
  ui.historyDetail.hidden = true;
  ui.historyList.hidden = false;
  ui.historyList.innerHTML = '';
  ui.historyEmpty.hidden = records.length > 0;
  ui.historyClear.disabled = records.length === 0;

  records.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'history-row';
    li.style.animationDelay = (i * 35) + 'ms';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'history-main';

    const top = document.createElement('div');
    top.className = 'history-title';
    top.textContent = r.title || 'Session';
    if (!r.endedAt) {
      const dot = document.createElement('span');
      dot.className = 'tag host';
      dot.textContent = 'Open';
      top.appendChild(dot);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const people = r.people.length;
    meta.textContent = [
      fmtWhen(r.startedAt),
      fmtDuration((r.endedAt || Date.now()) - r.startedAt),
      people ? people + (people === 1 ? ' person' : ' people') : 'nobody else',
      r.wasHost ? 'you hosted' : 'you joined'
    ].join(' · ');

    main.appendChild(top);
    main.appendChild(meta);
    main.addEventListener('click', () => renderHistoryDetail(r.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost small';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      writeHistory(readHistory().filter((x) => x.id !== r.id));
      renderHistoryList();
    });

    li.appendChild(main);
    li.appendChild(del);
    ui.historyList.appendChild(li);
  });
}

function fact(dl, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function renderHistoryDetail(id) {
  const record = readHistory().find((r) => r.id === id);
  if (!record) return renderHistoryList();

  ui.historyList.hidden = true;
  ui.historyEmpty.hidden = true;
  ui.historyDetail.hidden = false;
  ui.detailTitle.textContent = record.title || 'Session';

  ui.detailFacts.innerHTML = '';
  fact(ui.detailFacts, 'Started', fmtWhen(record.startedAt));
  fact(ui.detailFacts, 'Lasted', record.endedAt
    ? fmtDuration(record.endedAt - record.startedAt)
    : 'still open');
  fact(ui.detailFacts, 'Code', record.code);
  fact(ui.detailFacts, 'Source', sourceLabel(record));
  fact(ui.detailFacts, 'Visibility', record.isPublic ? 'Public' : 'Private');
  fact(ui.detailFacts, 'Your role', record.wasHost ? 'Host' : (record.companion ? 'Second screen' : 'Guest'));

  ui.detailPeople.innerHTML = '';
  if (!record.people.length) {
    const li = document.createElement('li');
    li.className = 'muted-row';
    li.textContent = 'Nobody else joined.';
    ui.detailPeople.appendChild(li);
  }
  for (const p of record.people) {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'av';
    av.textContent = (p.name[0] || '?').toUpperCase();
    paintAvatar(av, p.name);
    const label = document.createElement('span');
    label.textContent = p.name + (p.companion ? ' (2nd screen)' : '');
    const when = document.createElement('span');
    when.className = 'meta';
    when.textContent = fmtWhen(p.firstSeen);
    li.appendChild(av);
    li.appendChild(label);
    li.appendChild(when);
    ui.detailPeople.appendChild(li);
  }

  ui.detailLog.innerHTML = '';
  if (!record.log.length) {
    const li = document.createElement('li');
    li.className = 'muted-row';
    li.textContent = 'Nothing was said.';
    ui.detailLog.appendChild(li);
  }
  for (const entry of record.log) {
    const li = document.createElement('li');
    li.className = entry.kind === 'system' ? 'log-sys' : 'log-msg';
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.appendChild(time);
    if (entry.kind !== 'system') {
      const who = document.createElement('span');
      who.className = 'log-who';
      who.textContent = entry.name;
      li.appendChild(who);
    }
    li.appendChild(document.createTextNode(entry.text));
    ui.detailLog.appendChild(li);
  }
}

ui.historyBack.addEventListener('click', renderHistoryList);

ui.historyClear.addEventListener('click', () => {
  if (!confirm('Delete every saved session from this device?')) return;
  writeHistory([]);
  renderHistoryList();
});

/* ------------------------------------------------------------------ */
/* boot the home screen                                                */
/* ------------------------------------------------------------------ */

renderProfile();
showView(location.hash.replace(/^#\/?/, '') || 'browse', true);

/* ------------------------------------------------------------------ */
/* notification cues                                                   */
/* ------------------------------------------------------------------ */

// Synthesised rather than shipped as files: a handful of oscillator notes
// costs nothing to download and cannot be a licensing problem.
const CUES = {
  muted:     { notes: [[660, 0], [440, 0.12]], type: 'sine' },
  unmuted:   { notes: [[440, 0], [660, 0.12]], type: 'sine' },
  blocked:   { notes: [[300, 0], [200, 0.14]], type: 'square', gain: 0.05 },
  unblocked: { notes: [[400, 0], [600, 0.1], [800, 0.2]], type: 'sine' },
  tagged:    { notes: [[880, 0], [1170, 0.09]], type: 'triangle' },
  request:   { notes: [[620, 0], [780, 0.1], [620, 0.2]], type: 'sine' }
};

let audioCtx = null;

function cue(name) {
  const spec = CUES[name];
  if (!spec || !musicAvailable) { /* still fine to beep without the mp3 */ }
  if (!spec) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    for (const [freq, at] of spec.notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = audioCtx.currentTime + at;
      const peak = spec.gain || 0.07;
      osc.type = spec.type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  } catch {
    // an unavailable audio context is not worth breaking anything over
  }
}

/* ------------------------------------------------------------------ */
/* avatar colours                                                      */
/* ------------------------------------------------------------------ */

// Derived from the name, so the same person is the same colour on every
// device without anyone having to agree on it.
function avatarColor(name) {
  const text = String(name || '?');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const sat = 58 + (hash >> 9) % 18;
  const light = 46 + (hash >> 17) % 10;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function paintAvatar(el, name) {
  el.style.background = avatarColor(name);
  el.style.backgroundImage = 'none';
}

/* ------------------------------------------------------------------ */
/* mentions and replies                                                */
/* ------------------------------------------------------------------ */

let replyTarget = null;

function myName() {
  return (ui.name.value || '').trim();
}

function mentionsMe(text) {
  const me = myName();
  if (!me) return false;
  return new RegExp('@' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text || '');
}

function setReply(entry) {
  replyTarget = { id: entry.id, name: entry.name, text: entry.text.slice(0, 120) };
  ui.replyName.textContent = 'Replying to ' + entry.name;
  ui.replyText.textContent = entry.text;
  ui.replyBar.hidden = false;
  ui.chatInput.focus();
}

function clearReply() {
  replyTarget = null;
  ui.replyBar.hidden = true;
}

ui.replyCancel.addEventListener('click', clearReply);

// --- the @ picker -----------------------------------------------------

function closeMentions() {
  ui.mentionPop.hidden = true;
}

function mentionQuery() {
  const value = ui.chatInput.value;
  const caret = ui.chatInput.selectionStart || value.length;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const term = before.slice(at + 1);
  if (/\s/.test(term)) return null;
  return { at, caret, term };
}

function insertMention(name) {
  const q = mentionQuery();
  const value = ui.chatInput.value;
  if (!q) {
    ui.chatInput.value = value + (value && !value.endsWith(' ') ? ' ' : '') + '@' + name + ' ';
  } else {
    ui.chatInput.value = value.slice(0, q.at) + '@' + name + ' ' + value.slice(q.caret);
  }
  closeMentions();
  ui.chatInput.focus();
}

function renderMentions() {
  const q = mentionQuery();
  if (!q) return closeMentions();
  const term = q.term.toLowerCase();
  const matches = state.roster
    .filter((m) => m.id !== state.myId && m.name.toLowerCase().startsWith(term))
    .slice(0, 6);
  if (!matches.length) return closeMentions();

  ui.mentionPop.innerHTML = '';
  for (const m of matches) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mention-row';
    const av = document.createElement('span');
    av.className = 'av';
    av.textContent = (m.name[0] || '?').toUpperCase();
    paintAvatar(av, m.name);
    row.appendChild(av);
    row.appendChild(document.createTextNode(m.name));
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertMention(m.name);
    });
    ui.mentionPop.appendChild(row);
  }
  ui.mentionPop.hidden = false;
}

ui.chatInput.addEventListener('input', renderMentions);
ui.chatInput.addEventListener('blur', () => setTimeout(closeMentions, 120));
ui.chatInput.addEventListener('keydown', (e) => {
  if (ui.mentionPop.hidden) return;
  if (e.key === 'Escape') { closeMentions(); return; }
  if (e.key === 'Tab' || e.key === 'Enter') {
    const first = ui.mentionPop.querySelector('.mention-row');
    if (first) {
      e.preventDefault();
      first.dispatchEvent(new MouseEvent('mousedown'));
    }
  }
});

/* ------------------------------------------------------------------ */
/* session rename                                                      */
/* ------------------------------------------------------------------ */

function saveRename() {
  const title = ui.renameInput.value.trim();
  if (!title || !state.session || title === state.session.title) return;
  send({ t: 'host:rename', title });
  toast('Session renamed');
}

ui.renameSave.addEventListener('click', saveRename);
ui.renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
});

/* ------------------------------------------------------------------ */
/* poll builder                                                        */
/* ------------------------------------------------------------------ */

const POLL_MAX = 20;

function pollRows() {
  return [...ui.pollOptionsWrap.querySelectorAll('input')];
}

function addPollOption(value, focus) {
  const rows = pollRows();
  if (rows.length >= POLL_MAX) {
    toast('Twenty answers is the limit.');
    return;
  }
  const row = document.createElement('div');
  row.className = 'poll-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'Answer ' + (rows.length + 1);
  input.value = value || '';
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const all = pollRows();
    const i = all.indexOf(input);
    if (i === all.length - 1) addPollOption('', true);
    else all[i + 1].focus();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn poll-remove';
  remove.setAttribute('aria-label', 'Remove this answer');
  remove.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  remove.addEventListener('click', () => {
    if (pollRows().length <= 2) {
      toast('A poll needs at least two answers.');
      return;
    }
    row.remove();
    renumberPollRows();
  });

  row.appendChild(input);
  row.appendChild(remove);
  ui.pollOptionsWrap.appendChild(row);
  renumberPollRows();
  if (focus) input.focus();
}

function renumberPollRows() {
  pollRows().forEach((input, i) => { input.placeholder = 'Answer ' + (i + 1); });
}

function resetPollBuilder() {
  ui.pollOptionsWrap.innerHTML = '';
  addPollOption('');
  addPollOption('');
}

ui.pollAdd.addEventListener('click', () => addPollOption('', true));
resetPollBuilder();

/* ------------------------------------------------------------------ */
/* help                                                                */
/* ------------------------------------------------------------------ */

function openHelp() { ui.helpDialog.hidden = false; }
function closeHelp() { ui.helpDialog.hidden = true; }

ui.helpBtn.addEventListener('click', openHelp);
ui.helpClose.addEventListener('click', closeHelp);
ui.helpScrim.addEventListener('click', closeHelp);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.helpDialog.hidden) closeHelp();
});


/* ------------------------------------------------------------------ */
/* pictures and stickers in the chat                                   */
/* ------------------------------------------------------------------ */

const STICKER_MAX_EDGE = 320;
const STICKER_MAX_CHARS = 200000;

// Shrink and re-encode before sending. A photo straight off a phone is several
// megabytes; nobody needs that to say "look at this face".
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('not an image'));

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // WebP keeps transparency, which is what makes a sticker a sticker.
      const type = 'image/webp';
      let quality = 0.85;
      let out = canvas.toDataURL(type, quality);
      if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');

      while (out.length > STICKER_MAX_CHARS && quality > 0.35) {
        quality -= 0.15;
        out = canvas.toDataURL(type, quality);
      }
      if (out.length > STICKER_MAX_CHARS) return reject(new Error('too big'));
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read that image'));
    };
    img.src = url;
  });
}

async function sendSticker(file) {
  if (!canChat()) return;
  setLoading(ui.stickerBtn, true);
  try {
    const image = await shrinkImage(file);
    const caption = ui.chatInput.value.trim();
    const payload = { t: 'chat', text: caption, image };
    if (replyTarget) payload.replyTo = replyTarget;
    send(payload);
    chatMessage(myName() || 'You', caption, true, {
      id: 'local-' + Date.now(),
      ts: Date.now(),
      image,
      replyTo: replyTarget
    });
    ui.chatInput.value = '';
    clearReply();
  } catch (err) {
    toast(err.message === 'too big' ? 'That picture is too big to send.' : 'Could not read that picture.');
  } finally {
    setLoading(ui.stickerBtn, false);
  }
}

ui.stickerBtn.addEventListener('click', () => ui.stickerInput.click());

ui.stickerInput.addEventListener('change', () => {
  const file = ui.stickerInput.files && ui.stickerInput.files[0];
  ui.stickerInput.value = '';
  if (file) sendSticker(file);
});

// Long-press paste on a phone, or Ctrl+V on a desktop, after copying an image
// from anywhere else.
ui.chatInput.addEventListener('paste', (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    e.preventDefault();
    sendSticker(file);
    return;
  }
});

// Dropping an image onto the chat works too.
ui.chatLog.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
});

ui.chatLog.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  e.preventDefault();
  sendSticker(file);
});

/* ------------------------------------------------------------------ */
/* connection quality                                                  */
/* ------------------------------------------------------------------ */

// Reading getStats every couple of seconds turns "it's laggy" into something
// you can act on: how much is actually flowing, how much is being dropped, and
// whether the connection went peer-to-peer or is crawling through a relay.
const CONN_POLL_MS = 2500;

let connTimer = null;
let lastBytes = 0;
let lastBytesAt = 0;

function connectionPeers() {
  return [...state.peers.values()].filter((e) => e.pc && e.pc.connectionState === 'connected');
}

async function sampleConnection() {
  if (!state.session || state.mode === 'sync' || state.companion) {
    ui.connChip.hidden = true;
    return;
  }
  const peers = connectionPeers();
  if (!peers.length) {
    ui.connChip.hidden = true;
    return;
  }

  let bytes = 0;
  let lost = 0;
  let received = 0;
  let relayed = false;

  for (const entry of peers) {
    let report;
    try {
      report = await entry.pc.getStats();
    } catch {
      continue;
    }
    report.forEach((stat) => {
      if (stat.type === 'outbound-rtp' && !stat.isRemote) bytes += stat.bytesSent || 0;
      if (stat.type === 'inbound-rtp' && !stat.isRemote) {
        bytes += stat.bytesReceived || 0;
        lost += stat.packetsLost || 0;
        received += stat.packetsReceived || 0;
      }
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
        const local = report.get(stat.localCandidateId);
        const remote = report.get(stat.remoteCandidateId);
        if ((local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay')) {
          relayed = true;
        }
      }
    });
  }

  const now = Date.now();
  let kbps = 0;
  if (lastBytesAt && bytes >= lastBytes) {
    kbps = ((bytes - lastBytes) * 8) / ((now - lastBytesAt) / 1000) / 1000;
  }
  lastBytes = bytes;
  lastBytesAt = now;

  const lossPct = received + lost > 0 ? (lost / (received + lost)) * 100 : 0;
  const rate = kbps >= 1000 ? (kbps / 1000).toFixed(1) + ' Mbps' : Math.round(kbps) + ' kbps';

  let grade = 'good';
  if (lossPct > 5 || (kbps > 0 && kbps < 250)) grade = 'bad';
  else if (lossPct > 1.5 || relayed) grade = 'fair';

  ui.connChip.hidden = false;
  ui.connChip.dataset.grade = grade;
  ui.connText.textContent = rate + (lossPct >= 0.5 ? ` · ${lossPct.toFixed(1)}% lost` : '');
  ui.connChip.title = [
    rate + ' right now',
    lossPct.toFixed(1) + '% of packets lost',
    relayed ? 'Going through a relay, which adds delay' : 'Direct peer-to-peer connection',
    grade === 'bad' ? 'Try the "we both have the file" mode or a YouTube session.' : ''
  ].filter(Boolean).join('\n');
}

function startConnectionWatch() {
  clearInterval(connTimer);
  lastBytes = 0;
  lastBytesAt = 0;
  connTimer = setInterval(sampleConnection, CONN_POLL_MS);
}

function stopConnectionWatch() {
  clearInterval(connTimer);
  connTimer = null;
  ui.connChip.hidden = true;
}

startConnectionWatch();


/* ------------------------------------------------------------------ */
/* a shared video link                                                 */
/* ------------------------------------------------------------------ */

// The same idea as the YouTube path, but pointing at a plain video file: each
// person fetches it from wherever it lives, and only the clock is shared. That
// keeps a weak connection pulling from a real host rather than from the room's
// host, which is usually far kinder to it.
//
// This needs the address of the file itself. A page that happens to contain a
// player is not a video, and a player embedded from another site cannot be
// driven from here, so there is nothing to keep in step.
async function loadMediaUrl(url, announce) {
  if (!url) return;
  ui.linkUrl.value = url;

  resetVideoElement();
  ui.video.src = url;
  ui.video.muted = false;
  showOverlay('Loading the video...', null, null, true);

  const ready = await waitForVideoReady(ui.video);
  if (!ready) {
    showOverlay(
      'That link did not play. It has to point at the video file itself, not at a page with a player on it.',
      state.isHost ? 'Try another' : null,
      state.isHost ? () => { hideOverlay(); ui.linkUrl.focus(); } : null
    );
    return;
  }

  hideOverlay();
  state.duration = ui.video.duration || 0;
  state.streamKind = 'file';
  applyStreamKind();
  updateControlsEnabled();

  if (announce) {
    const guess = decodeURIComponent(url.split('/').pop() || '').replace(/\.[^.]+$/, '');
    const title = guess || (state.session ? state.session.title : 'Video');
    send({ t: 'source', url, youtubeId: null, kind: 'file', title });
    ui.roomTitle.textContent = title;
    startProgressLoop();
    sysMessage('Shared a video link. Everyone plays it from there.');
  }

  try {
    await ui.video.play();
  } catch {
    showOverlay('Ready. Tap to start watching.', 'Start', async () => {
      try { await ui.video.play(); } catch {}
      hideOverlay();
    });
  }
}

ui.linkLoad.addEventListener('click', () => {
  const url = ui.linkUrl.value.trim();
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    toast('That is not a valid address.');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    toast('Only http and https links work.');
    return;
  }
  if (/\.(html?|php|aspx)$/i.test(parsed.pathname)) {
    toast('That is a web page, not a video file. Find the direct link to the file.');
    return;
  }
  setLoading(ui.linkLoad, true);
  loadMediaUrl(parsed.toString(), true).finally(() => setLoading(ui.linkLoad, false));
});

ui.linkUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); ui.linkLoad.click(); }
});


/* ------------------------------------------------------------------ */
/* embedding another page                                              */
/* ------------------------------------------------------------------ */

// This is the honest fallback for anything with no player API. The page is put
// in the room so it can be watched side by side with voice and chat, but
// nothing inside it can be read or driven from here - that is the browser's
// same-origin rule, not a gap in this app - so playback genuinely is not
// synchronised and the room counts down instead.
let embedWarned = false;

function loadEmbed(url) {
  ui.embedHolder.innerHTML = '';

  const frame = document.createElement('iframe');
  frame.src = url;
  frame.referrerPolicy = 'no-referrer';
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  // No allow-popups and no allow-top-navigation: sites like this fire redirect
  // ads, and without those the page cannot drag the room somewhere else.
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  frame.title = 'Shared page';

  ui.embedHolder.appendChild(frame);
  ui.embedHolder.hidden = false;
  hideOverlay();

  if (!embedWarned) {
    embedWarned = true;
    sysMessage('Playback here is not synced. Use "Start together" to count everyone in.');
  }
}

ui.embedLoad.addEventListener('click', () => {
  const raw = ui.embedUrl.value.trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = new URL(raw.includes('://') ? raw : 'https://' + raw);
  } catch {
    toast('That is not a valid address.');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    toast('Only http and https pages work.');
    return;
  }
  const url = parsed.toString();
  loadEmbed(url);
  send({ t: 'source', url, youtubeId: null, kind: 'embed', title: parsed.hostname });
  ui.roomTitle.textContent = parsed.hostname;
});

ui.embedUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); ui.embedLoad.click(); }
});

/* ---------- counting everyone in ---------- */

ui.countdownBtn.addEventListener('click', () => {
  send({ t: 'countdown' });
  runCountdown(Date.now() + 3200, null);
});

let countdownTimer = null;

function runCountdown(at, from) {
  clearInterval(countdownTimer);
  if (from) sysMessage(from + ' is counting everyone in.');

  const tick = () => {
    const left = Math.ceil((at - Date.now()) / 1000);
    if (left > 0) {
      ui.countdown.hidden = false;
      ui.countdownNum.textContent = String(left);
      return;
    }
    ui.countdownNum.textContent = 'NOW';
    clearInterval(countdownTimer);
    countdownTimer = null;
    cue('tagged');
    setTimeout(() => { ui.countdown.hidden = true; }, 1200);
  };

  tick();
  countdownTimer = setInterval(tick, 200);
}
