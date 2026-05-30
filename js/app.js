'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  user:        null,
  playlists:   [],
  activeIdx:   -1,
  searchTimer: null,
  mobileTab:   'editor',
  installEvt:  null,
  // Player
  sdkPlayer:   null,
  deviceId:    null,
  nowIdx:      -1,
  playing:     false,
  stopTimer:   null,
  progTimer:   null,
  segStart:    0,
  segEnd:      0,
};

const isMobile = () => window.innerWidth <= 640;

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function msToTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function timeToMs(str) {
  const parts = (str || '0:00').split(':');
  return ((parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0)) * 1000;
}

let _toastTimer;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Mobile tab switching ───────────────────────────────────────────────────────
function switchTab(tab) {
  S.mobileTab = tab;
  const map = { library: '.sidebar', editor: '.editor', playing: '.mobile-playing' };
  Object.entries(map).forEach(([t, sel]) => {
    document.querySelector(sel)?.classList.toggle('mob-active', t === tab);
  });
  document.querySelectorAll('.mnav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
}

// ── Playlist helpers ──────────────────────────────────────────────────────────
function currentPlaylist() { return S.playlists[S.activeIdx] || null; }

function trackFromSpotify(t) {
  return {
    id:          t.id,
    name:        t.name,
    artist:      (t.artists || []).map(a => a.name).join(', '),
    album:       t.album?.name || '',
    image:       t.album?.images?.[0]?.url || '',
    duration_ms: t.duration_ms || 0,
    start_ms:    0,
    end_ms:      t.duration_ms || 0,
  };
}

// ── Render: sidebar ───────────────────────────────────────────────────────────
function renderSidebar() {
  const el = $('playlist-list');
  if (!S.playlists.length) {
    el.innerHTML = '<p class="hint">Click + to create a playlist.</p>';
    return;
  }
  el.innerHTML = S.playlists.map((pl, i) => `
    <div class="pl-item${i === S.activeIdx ? ' active' : ''}" data-i="${i}">
      <span class="pl-name">${esc(pl.name)}</span>
      <span class="pl-count">${pl.tracks.length}</span>
    </div>
  `).join('');
  el.querySelectorAll('.pl-item').forEach(el =>
    el.addEventListener('click', () => openPlaylist(+el.dataset.i))
  );
}

// ── Render: editor ────────────────────────────────────────────────────────────
function renderEditor() {
  const pl = currentPlaylist();
  if (!pl) {
    $('editor-empty').classList.remove('hidden');
    $('editor-content').classList.add('hidden');
    return;
  }
  $('editor-empty').classList.add('hidden');
  $('editor-content').classList.remove('hidden');
  $('playlist-name').value = pl.name;

  const list = $('track-list');
  if (!pl.tracks.length) {
    list.innerHTML = '<p class="hint">Search for songs above, then click Add.</p>';
    return;
  }

  list.innerHTML = pl.tracks.map((t, i) => `
    <div class="track-item${i === S.nowIdx && S.playing ? ' playing' : ''}" id="ti-${i}">
      <span class="t-num">${i + 1}</span>
      <img class="t-art" src="${t.image}" alt="" loading="lazy" />
      <div class="t-info">
        <div class="t-name" title="${esc(t.name)}">${esc(t.name)}</div>
        <div class="t-artist">${esc(t.artist)}</div>
      </div>
      <div class="t-times">
        <div class="t-time-group">
          <span class="t-time-label">Start</span>
          <input class="t-time-input" type="text" value="${msToTime(t.start_ms)}"
                 data-i="${i}" data-f="start_ms" title="Max ${msToTime(t.duration_ms)}" />
        </div>
        <span class="t-sep">→</span>
        <div class="t-time-group">
          <span class="t-time-label">End</span>
          <input class="t-time-input" type="text" value="${msToTime(t.end_ms)}"
                 data-i="${i}" data-f="end_ms" title="Max ${msToTime(t.duration_ms)}" />
        </div>
        <span class="t-dur">${msToTime(t.duration_ms)}</span>
      </div>
      <div class="t-actions">
        <button class="t-play-btn${i === S.nowIdx && S.playing ? ' active' : ''}" data-i="${i}" title="Play segment">▶</button>
        <button class="t-move-btn" data-i="${i}" data-d="-1" title="Move up"   ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="t-move-btn" data-i="${i}" data-d="1"  title="Move down" ${i === pl.tracks.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="t-rm-btn"   data-i="${i}" title="Remove">×</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.t-time-input').forEach(inp => {
    inp.addEventListener('change', onTimeChange);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  list.querySelectorAll('.t-play-btn').forEach(btn =>
    btn.addEventListener('click', () => playAt(+btn.dataset.i))
  );
  list.querySelectorAll('.t-move-btn').forEach(btn =>
    btn.addEventListener('click', () => moveTrack(+btn.dataset.i, +btn.dataset.d))
  );
  list.querySelectorAll('.t-rm-btn').forEach(btn =>
    btn.addEventListener('click', () => removeTrack(+btn.dataset.i))
  );
}

function onTimeChange(e) {
  const inp  = e.target;
  const i    = +inp.dataset.i;
  const field = inp.dataset.f;
  const pl   = currentPlaylist();
  if (!pl) return;
  const t = pl.tracks[i];
  let ms = timeToMs(inp.value);
  if (field === 'start_ms') ms = Math.max(0, Math.min(ms, t.end_ms - 1000));
  else                      ms = Math.max(t.start_ms + 1000, Math.min(ms, t.duration_ms));
  t[field]  = ms;
  inp.value = msToTime(ms);
}

function moveTrack(i, dir) {
  const pl = currentPlaylist();
  if (!pl) return;
  const j = i + dir;
  if (j < 0 || j >= pl.tracks.length) return;
  [pl.tracks[i], pl.tracks[j]] = [pl.tracks[j], pl.tracks[i]];
  if (S.nowIdx === i) S.nowIdx = j;
  else if (S.nowIdx === j) S.nowIdx = i;
  renderEditor();
}

function removeTrack(i) {
  const pl = currentPlaylist();
  if (!pl) return;
  pl.tracks.splice(i, 1);
  if (S.nowIdx >= i) S.nowIdx = Math.max(-1, S.nowIdx - 1);
  renderEditor();
  renderSidebar();
}

// ── Player ────────────────────────────────────────────────────────────────────
async function initSDK() {
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = async () => {
      S.sdkPlayer = new Spotify.Player({
        name: 'Timed Playlist Editor',
        getOAuthToken: async cb => cb(await SpotifyAuth.getToken()),
        volume: 0.8,
      });
      S.sdkPlayer.addListener('ready',         ({ device_id }) => { S.deviceId = device_id; resolve(); });
      S.sdkPlayer.addListener('not_ready',      ()             => { S.deviceId = null; });
      S.sdkPlayer.addListener('account_error',  ({ message })  => {
        toast('Spotify Premium required for playback.', 'error');
        console.warn('account_error:', message);
      });
      S.sdkPlayer.addListener('initialization_error', ({ message }) => reject(new Error(message)));
      S.sdkPlayer.addListener('authentication_error', ({ message }) => reject(new Error(message)));
      S.sdkPlayer.addListener('player_state_changed', st => {
        if (!st) return;
        S.playing = !st.paused;
        syncPPBtns();
      });
      const ok = await S.sdkPlayer.connect();
      if (!ok) reject(new Error('SDK connect failed'));
    };
    const sc = document.createElement('script');
    sc.src = 'https://sdk.scdn.co/spotify-player.js';
    sc.onerror = () => reject(new Error('Failed to load Spotify SDK'));
    document.head.appendChild(sc);
  });
}

async function playAt(i) {
  const pl = currentPlaylist();
  if (!pl || i < 0 || i >= pl.tracks.length) return;
  if (!S.deviceId) { toast('Player not ready. Spotify Premium required.', 'error'); return; }

  clearTimeout(S.stopTimer);
  clearInterval(S.progTimer);

  const track = pl.tracks[i];
  S.nowIdx   = i;
  S.segStart = track.start_ms;
  S.segEnd   = track.end_ms;
  const segDur = S.segEnd - S.segStart;

  try {
    await SpotifyAuth.startPlayback(S.deviceId, track.id, S.segStart);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  S.playing = true;
  syncPPBtns();
  syncPlayerUI(track);
  renderEditor();

  if (isMobile()) switchTab('playing');

  const wallStart = Date.now();
  S.progTimer = setInterval(() => {
    const elapsed = Date.now() - wallStart;
    const pct = Math.min(100, (elapsed / segDur) * 100);
    const cur  = msToTime(S.segStart + elapsed);
    // Desktop
    $('pb-fill').style.width = pct + '%';
    $('pb-cur').textContent  = cur;
    // Mobile
    $('mp-fill').style.width = pct + '%';
    $('mp-cur').textContent  = cur;
  }, 200);

  S.stopTimer = setTimeout(async () => {
    clearInterval(S.progTimer);
    if (S.nowIdx < pl.tracks.length - 1) {
      await playAt(S.nowIdx + 1);
    } else {
      await stopPlayback();
    }
  }, segDur);
}

async function stopPlayback() {
  clearTimeout(S.stopTimer);
  clearInterval(S.progTimer);
  if (S.sdkPlayer) await S.sdkPlayer.pause();
  S.playing = false;
  S.nowIdx  = -1;
  syncPPBtns();
  $('pb-fill').style.width = '0%';
  $('mp-fill').style.width = '0%';
  renderEditor();
}

async function togglePlayback() {
  if (S.playing) {
    clearTimeout(S.stopTimer);
    clearInterval(S.progTimer);
    if (S.sdkPlayer) await S.sdkPlayer.pause();
    S.playing = false; syncPPBtns();
  } else if (S.nowIdx >= 0) {
    if (S.sdkPlayer) await S.sdkPlayer.resume();
    S.playing = true; syncPPBtns();
  } else if (currentPlaylist()?.tracks.length) {
    playAt(0);
  }
}

function syncPPBtns() {
  const icon = S.playing ? '⏸' : '▶';
  $('pp-btn').textContent = icon;
  $('mp-pp').textContent  = icon;
}

function syncPlayerUI(track) {
  // Desktop bar
  $('pb-art').src            = track.image;
  $('pb-name').textContent   = track.name;
  $('pb-artist').textContent = track.artist;
  $('pb-end').textContent    = msToTime(track.end_ms);
  $('pb-segment').textContent = msToTime(track.start_ms) + ' → ' + msToTime(track.end_ms);
  $('player-bar').classList.remove('hidden');

  // Mobile now-playing panel
  const art = $('mp-art');
  art.src = track.image;
  art.classList.remove('pulse');
  void art.offsetWidth; // reflow to restart animation
  art.classList.add('pulse');

  $('mp-name').textContent   = track.name;
  $('mp-artist').textContent = track.artist;
  $('mp-pl').textContent     = currentPlaylist()?.name || '';
  $('mp-seg').textContent    = msToTime(track.start_ms) + ' → ' + msToTime(track.end_ms);
  $('mp-end').textContent    = msToTime(track.end_ms);

  // Show track content, hide idle
  $('mp-idle').classList.add('hidden');
  $('mp-track').classList.remove('hidden');
}

// ── Search ────────────────────────────────────────────────────────────────────
async function doSearch(q) {
  if (!q.trim()) { $('search-results').classList.add('hidden'); return; }
  try {
    const tracks = await SpotifyAuth.search(q);
    renderSearchResults(tracks);
  } catch (e) { console.error('search:', e); }
}

function renderSearchResults(tracks) {
  const el = $('search-results');
  if (!tracks.length) {
    el.innerHTML = '<p class="hint" style="padding:14px">No results.</p>';
    el.classList.remove('hidden');
    return;
  }
  el.innerHTML = tracks.map(t => {
    const img  = t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || '';
    const art  = (t.artists || []).map(a => a.name).join(', ');
    const data = JSON.stringify(trackFromSpotify(t)).replace(/"/g, '&quot;');
    return `
      <div class="sr-item">
        <img class="sr-img" src="${img}" alt="" loading="lazy" />
        <div class="sr-info">
          <div class="sr-name">${esc(t.name)}</div>
          <div class="sr-sub">${esc(art)} · ${esc(t.album?.name || '')}</div>
        </div>
        <span class="sr-dur">${msToTime(t.duration_ms)}</span>
        <button class="sr-add" data-track="${data}">Add</button>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.sr-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const track = JSON.parse(btn.dataset.track.replace(/&quot;/g, '"'));
      addTrack(track);
      btn.textContent = '✓';
      btn.style.background = '#555';
      setTimeout(() => { btn.textContent = 'Add'; btn.style.background = ''; }, 1500);
    });
  });
  el.classList.remove('hidden');
}

function addTrack(track) {
  if (!currentPlaylist()) createPlaylist();
  currentPlaylist().tracks.push(track);
  renderEditor();
  renderSidebar();
  if (isMobile()) switchTab('editor');
}

// ── Playlist CRUD ─────────────────────────────────────────────────────────────
function createPlaylist() {
  S.playlists.push({ name: 'New Playlist', tracks: [], path: null, sha: null, created: new Date().toISOString() });
  S.activeIdx = S.playlists.length - 1;
  renderSidebar();
  renderEditor();
  if (isMobile()) {
    switchTab('editor');
  } else {
    $('playlist-name').focus();
    $('playlist-name').select();
  }
}

function openPlaylist(i) {
  S.activeIdx = i;
  renderSidebar();
  renderEditor();
  if (isMobile()) switchTab('editor');
}

async function savePlaylist() {
  if (!GitHub.hasToken()) { toast('Enter a GitHub token to save playlists.', 'error'); return; }
  const pl = currentPlaylist();
  if (!pl || !S.user) return;

  pl.name    = $('playlist-name').value.trim() || 'Untitled';
  pl.updated = new Date().toISOString();

  const btn = $('save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const data = { name: pl.name, owner: S.user.id, created: pl.created, updated: pl.updated, tracks: pl.tracks };
    pl.path = await GitHub.savePlaylist(S.user.id, pl.name, data);
    toast('Saved to repo!', 'success');
    renderSidebar();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save to Repo';
  }
}

async function deletePlaylist() {
  const pl = currentPlaylist();
  if (!pl || !confirm(`Delete "${pl.name}"?`)) return;
  if (pl.path && pl.sha) {
    try { await GitHub.deletePlaylist(pl.path, pl.sha); }
    catch (e) { toast('Delete failed: ' + e.message, 'error'); return; }
  }
  S.playlists.splice(S.activeIdx, 1);
  S.activeIdx = -1;
  renderSidebar();
  renderEditor();
  toast('Playlist deleted.');
}

async function loadSavedPlaylists() {
  if (!GitHub.hasToken() || !S.user) return;
  try {
    const files  = await GitHub.listPlaylists(S.user.id);
    const loaded = (await Promise.all(files.map(f => GitHub.loadPlaylist(f.path)))).filter(Boolean);
    const remote = loaded.map(({ playlist, sha }, idx) => ({ ...playlist, path: files[idx].path, sha }));
    const local  = S.playlists.filter(p => !p.path);
    S.playlists  = [...remote, ...local];
    renderSidebar();
    const gs = $('gh-status');
    gs.textContent = `✓ GitHub connected · ${remote.length} playlist${remote.length !== 1 ? 's' : ''} saved`;
    gs.className   = 'gh-status ok';
  } catch (e) {
    const gs = $('gh-status');
    gs.textContent = 'GitHub error: ' + e.message;
    gs.className   = 'gh-status err';
  }
}

async function applyGhToken(token) {
  if (!token) return;
  GitHub.saveToken(token);
  try {
    const login = await GitHub.verifyToken();
    if (login) {
      toast(`GitHub: connected as @${login}`, 'success');
      if (S.user) loadSavedPlaylists();
    } else {
      toast('GitHub token invalid.', 'error');
      GitHub.clearToken();
    }
  } catch (e) {
    toast('GitHub token error: ' + e.message, 'error');
    GitHub.clearToken();
  }
}

// ── App init ───────────────────────────────────────────────────────────────────
async function launchApp() {
  $('auth-overlay').classList.add('hidden');
  $('app').classList.remove('hidden');

  S.user = await SpotifyAuth.getUser();
  $('user-display').textContent = S.user.display_name || S.user.id;

  // Default mobile tab
  if (isMobile()) switchTab('editor');

  // GitHub token
  const savedTok = GitHub.getToken();
  if (savedTok) {
    $('gh-token-input').value = savedTok;
    $('gh-status').textContent = 'Connecting to GitHub…';
    loadSavedPlaylists();
  } else {
    $('gh-status').textContent = 'No GitHub token — playlists won\'t be saved.';
  }

  // Spotify SDK
  initSDK()
    .then(() => toast('Player ready', 'success'))
    .catch(err => { console.warn('SDK:', err); toast('Playback unavailable (Premium required).', 'error'); });

  // ── Event listeners ───────────────────────────────────────────────────────

  // Search
  $('search-input').addEventListener('input', e => {
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => doSearch(e.target.value), 380);
  });
  document.addEventListener('click', e => {
    if (!$('search-results').contains(e.target) && e.target !== $('search-input'))
      $('search-results').classList.add('hidden');
  });

  // Sidebar + editor
  $('new-playlist-btn').addEventListener('click', createPlaylist);
  $('playlist-name').addEventListener('input', e => {
    if (currentPlaylist()) { currentPlaylist().name = e.target.value; renderSidebar(); }
  });
  $('play-all-btn').addEventListener('click', () => {
    if (currentPlaylist()?.tracks.length) playAt(0);
  });
  $('save-btn').addEventListener('click', savePlaylist);
  $('delete-btn').addEventListener('click', deletePlaylist);

  // Logout
  $('logout-btn').addEventListener('click', () => {
    if (confirm('Log out of Spotify?')) { SpotifyAuth.logout(); location.reload(); }
  });

  // Desktop player bar
  $('pp-btn').addEventListener('click', togglePlayback);
  $('prev-btn').addEventListener('click', () => { if (S.nowIdx > 0) playAt(S.nowIdx - 1); });
  $('next-btn').addEventListener('click', () => {
    const pl = currentPlaylist();
    if (pl && S.nowIdx < pl.tracks.length - 1) playAt(S.nowIdx + 1);
  });

  // Mobile player controls
  $('mp-pp').addEventListener('click', togglePlayback);
  $('mp-prev').addEventListener('click', () => { if (S.nowIdx > 0) playAt(S.nowIdx - 1); });
  $('mp-next').addEventListener('click', () => {
    const pl = currentPlaylist();
    if (pl && S.nowIdx < pl.tracks.length - 1) playAt(S.nowIdx + 1);
  });

  // Mobile nav
  document.querySelectorAll('.mnav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // GitHub token (in-app)
  const ghIn  = $('gh-token-input');
  const ghBtn = $('gh-token-save-btn');
  if (ghIn && ghBtn) {
    ghBtn.addEventListener('click', () => applyGhToken(ghIn.value.trim()));
    ghIn.addEventListener('keydown',  e => { if (e.key === 'Enter') applyGhToken(ghIn.value.trim()); });
  }

  // PWA install button
  $('install-btn')?.addEventListener('click', async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    const { outcome } = await S.installEvt.userChoice;
    if (outcome === 'accepted') $('install-btn').classList.add('hidden');
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
// Capture PWA install prompt
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  S.installEvt = e;
  $('install-btn')?.classList.remove('hidden');
});

(async () => {
  // Config check
  const clientId = window.APP_CONFIG?.spotify_client_id || '';
  if (!clientId || clientId === 'YOUR_SPOTIFY_CLIENT_ID_HERE') {
    $('config-warning').classList.remove('hidden');
  }

  // Handle Spotify OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (code) {
    history.replaceState({}, '', window.location.pathname);
    try {
      await SpotifyAuth.handleCallback(code);
      await launchApp();
    } catch (e) {
      toast('Login failed: ' + e.message, 'error');
      console.error(e);
    }
    return;
  }

  if (SpotifyAuth.isLoggedIn()) {
    await launchApp();
    return;
  }

  // Show auth overlay
  $('spotify-login-btn').addEventListener('click', () => SpotifyAuth.login());

  const ghSave = $('gh-token-save-btn');
  const ghIn   = $('gh-token-input');
  if (ghSave) {
    ghSave.addEventListener('click', () => applyGhToken(ghIn.value.trim()));
    ghIn.addEventListener('keydown',  e => { if (e.key === 'Enter') applyGhToken(ghIn.value.trim()); });
    if (GitHub.getToken()) ghIn.value = GitHub.getToken();
  }

  $('install-btn')?.addEventListener('click', async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    const { outcome } = await S.installEvt.userChoice;
    if (outcome === 'accepted') $('install-btn').classList.add('hidden');
  });
})();
