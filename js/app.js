'use strict';

// ── State ──────────────────────────────────────────────────────────────────
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

// ── DOM helpers ────────────────────────────────────────────────────────────
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

// ── Mobile tab switching ───────────────────────────────────────────────────
function switchTab(tab) {
  S.mobileTab = tab;
  const map = { library: '.sidebar', editor: '.editor', playing: '.mobile-playing' };
  Object.entries(map).forEach(([t, sel]) =>
    document.querySelector(sel)?.classList.toggle('mob-active', t === tab)
  );
  document.querySelectorAll('.mnav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
}

// ── Playlist helpers ───────────────────────────────────────────────────────
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

// ── Render: sidebar ────────────────────────────────────────────────────────
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

// ── Render: editor ─────────────────────────────────────────────────────────
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
  const inp   = e.target;
  const i     = +inp.dataset.i;
  const field = inp.dataset.f;
  const pl    = currentPlaylist();
  if (!pl) return;
  const t  = pl.tracks[i];
  let ms   = timeToMs(inp.value);
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

// ── Player ─────────────────────────────────────────────────────────────────
async function initSDK() {
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = async () => {
      S.sdkPlayer = new Spotify.Player({
        name: 'Timed Playlist Editor',
        getOAuthToken: async cb => cb(await SpotifyAuth.getToken()),
        volume: 0.8,
      });
      S.sdkPlayer.addListener('ready', ({ device_id }) => { S.deviceId = device_id; resolve(); });
      S.sdkPlayer.addListener('not_ready', () => {
        S.deviceId = null;
        // Silently try to reconnect; ready listener above will restore S.deviceId
        setTimeout(() => S.sdkPlayer?.connect().catch(console.warn), 2000);
      });
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

// Reconnects the SDK player if the device has gone away, with up to 8s wait.
async function ensureConnected() {
  if (S.deviceId) return;
  if (!S.sdkPlayer) throw new Error('Player not initialized — Spotify Premium required');
  toast('Reconnecting player…', '');
  await S.sdkPlayer.connect();
  for (let i = 0; i < 32; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (S.deviceId) { toast('Player reconnected', 'success'); return; }
  }
  throw new Error('Player did not reconnect — try refreshing');
}

async function playAt(i) {
  const pl = currentPlaylist();
  if (!pl || i < 0 || i >= pl.tracks.length) return;
  try { await ensureConnected(); } catch (err) { toast(err.message, 'error'); return; }

  clearTimeout(S.stopTimer);
  clearInterval(S.progTimer);

  const track  = pl.tracks[i];
  S.nowIdx     = i;
  S.segStart   = track.start_ms;
  S.segEnd     = track.end_ms;
  const segDur = S.segEnd - S.segStart;

  try {
    await SpotifyAuth.startPlayback(S.deviceId, track.id, S.segStart);
  } catch (err) {
    // Device may have just dropped — reconnect once and retry
    if (err.message.toLowerCase().includes('device') || err.message.includes('404') || err.message.includes('502')) {
      S.deviceId = null;
      try {
        await ensureConnected();
        await SpotifyAuth.startPlayback(S.deviceId, track.id, S.segStart);
      } catch (err2) {
        toast(err2.message, 'error');
        return;
      }
    } else {
      toast(err.message, 'error');
      return;
    }
  }

  S.playing = true;
  syncPPBtns();
  syncPlayerUI(track);
  renderEditor();
  if (isMobile()) switchTab('playing');

  _startProgressTimer(S.segStart, segDur, pl);
}

function _startProgressTimer(fromMs, segDur, pl) {
  clearInterval(S.progTimer);
  clearTimeout(S.stopTimer);
  const wallStart  = Date.now();
  const remaining  = S.segEnd - fromMs;

  S.progTimer = setInterval(() => {
    const elapsed = Date.now() - wallStart;
    const ms      = fromMs + elapsed;
    const pct     = Math.min(100, ((ms - S.segStart) / segDur) * 100);
    const label   = msToTime(ms);
    $('pb-fill').style.width = pct + '%';
    $('mp-fill').style.width = pct + '%';
    $('pb-cur').textContent  = label;
    $('mp-cur').textContent  = label;
  }, 200);

  S.stopTimer = setTimeout(async () => {
    clearInterval(S.progTimer);
    if (S.nowIdx < (pl?.tracks.length ?? 0) - 1) {
      await playAt(S.nowIdx + 1);
    } else {
      await stopPlayback();
    }
  }, remaining);
}

// Seek to any ms position within the full track; restarts segment timer from there
async function seekTo(posMs) {
  clearTimeout(S.stopTimer);
  clearInterval(S.progTimer);
  if (!S.sdkPlayer) return;

  const pl    = currentPlaylist();
  const track = pl?.tracks[S.nowIdx];
  if (!track) return;

  await S.sdkPlayer.seek(posMs);

  const segDur = S.segEnd - S.segStart;

  // Resume progress timer from seeked position
  const wallStart = Date.now();
  S.progTimer = setInterval(() => {
    const elapsed = Date.now() - wallStart;
    const ms  = posMs + elapsed;
    const pct = Math.min(100, ((ms - S.segStart) / segDur) * 100);
    $('pb-fill').style.width = pct + '%';
    $('mp-fill').style.width = pct + '%';
    $('pb-cur').textContent  = msToTime(ms);
    $('mp-cur').textContent  = msToTime(ms);
  }, 200);

  const remaining = S.segEnd - posMs;
  if (remaining > 0) {
    S.stopTimer = setTimeout(async () => {
      clearInterval(S.progTimer);
      if (S.nowIdx < (pl?.tracks.length ?? 0) - 1) {
        await playAt(S.nowIdx + 1);
      } else {
        await stopPlayback();
      }
    }, remaining);
  } else {
    // Dragged past end — advance now
    if (S.nowIdx < (pl?.tracks.length ?? 0) - 1) playAt(S.nowIdx + 1);
    else stopPlayback();
  }
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
    clearTimeout(S.stopTimer); clearInterval(S.progTimer);
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
  $('pb-art').src             = track.image;
  $('pb-name').textContent    = track.name;
  $('pb-artist').textContent  = track.artist;
  $('pb-end').textContent     = msToTime(track.end_ms);
  $('pb-segment').textContent = msToTime(track.start_ms) + ' → ' + msToTime(track.end_ms);
  $('player-bar').classList.remove('hidden');

  const art = $('mp-art');
  art.src = track.image;
  art.classList.remove('pulse'); void art.offsetWidth; art.classList.add('pulse');
  $('mp-name').textContent   = track.name;
  $('mp-artist').textContent = track.artist;
  $('mp-pl').textContent     = currentPlaylist()?.name || '';
  $('mp-seg').textContent    = msToTime(track.start_ms) + ' → ' + msToTime(track.end_ms);
  $('mp-end').textContent    = msToTime(track.end_ms);
  $('mp-idle').classList.add('hidden');
  $('mp-track').classList.remove('hidden');
}

// ── Scrubbing ──────────────────────────────────────────────────────────────
function initScrubbing() {
  // Both desktop bar and mobile bar
  const bars = [
    $('pb-scrub'),  // desktop
    $('mp-scrub'),  // mobile now-playing
  ].filter(Boolean);

  let dragging  = false;
  let activeBar = null;

  function pctAt(bar, e) {
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    const x = (touch ? touch.clientX : e.clientX) - bar.getBoundingClientRect().left;
    return Math.max(0, Math.min(1, x / bar.offsetWidth));
  }

  function pctToMs(pct) {
    // Map 0–1 within the segment (start_ms → end_ms)
    return Math.round(S.segStart + pct * (S.segEnd - S.segStart));
  }

  function updateVisuals(pct) {
    const ms = pctToMs(pct);
    const t  = msToTime(ms);
    $('pb-fill').style.width = (pct * 100) + '%';
    $('mp-fill').style.width = (pct * 100) + '%';
    $('pb-cur').textContent  = t;
    $('mp-cur').textContent  = t;
  }

  bars.forEach(bar => {
    bar.addEventListener('mousedown', e => {
      if (S.nowIdx < 0) return;
      dragging = true; activeBar = bar;
      clearInterval(S.progTimer); // pause ticker while dragging
      bar.classList.add('scrubbing');
      updateVisuals(pctAt(bar, e));
      e.preventDefault();
    });
    bar.addEventListener('touchstart', e => {
      if (S.nowIdx < 0) return;
      dragging = true; activeBar = bar;
      clearInterval(S.progTimer);
      bar.classList.add('scrubbing');
      updateVisuals(pctAt(bar, e));
    }, { passive: true });
  });

  document.addEventListener('mousemove', e => {
    if (!dragging || !activeBar) return;
    updateVisuals(pctAt(activeBar, e));
  });
  document.addEventListener('touchmove', e => {
    if (!dragging || !activeBar) return;
    updateVisuals(pctAt(activeBar, e));
  }, { passive: true });

  const onEnd = e => {
    if (!dragging || !activeBar) return;
    const pct = pctAt(activeBar, e);
    activeBar.classList.remove('scrubbing');
    dragging = false; activeBar = null;
    seekTo(pctToMs(pct));
  };
  document.addEventListener('mouseup',  onEnd);
  document.addEventListener('touchend', onEnd);
}

// ── Search ─────────────────────────────────────────────────────────────────
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
    el.classList.remove('hidden'); return;
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
      </div>`;
  }).join('');
  el.querySelectorAll('.sr-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addTrack(JSON.parse(btn.dataset.track.replace(/&quot;/g, '"')));
      btn.textContent = '✓'; btn.style.background = '#555';
      setTimeout(() => { btn.textContent = 'Add'; btn.style.background = ''; }, 1500);
    });
  });
  el.classList.remove('hidden');
}

function addTrack(track) {
  if (!currentPlaylist()) createPlaylist();
  currentPlaylist().tracks.push(track);
  renderEditor(); renderSidebar();
  if (isMobile()) switchTab('editor');
}

// ── Spotify playlist import ────────────────────────────────────────────────
async function openImportModal() {
  $('import-modal').classList.remove('hidden');
  if (!SpotifyAuth.hasScope('playlist-read-private')) {
    $('import-list').innerHTML = `
      <div style="padding:24px;text-align:center">
        <p style="margin-bottom:16px;color:var(--text-muted);line-height:1.5">
          Spotify needs to approve playlist access.<br>Click below — Spotify will show an approval screen.
        </p>
        <button id="reauth-btn" class="btn btn-primary">Grant playlist access</button>
      </div>`;
    $('reauth-btn').addEventListener('click', () => {
      SpotifyAuth.logout();
      SpotifyAuth.login(true);
    });
    return;
  }
  $('import-list').innerHTML = '<p class="hint" style="padding:20px">Loading your Spotify playlists…</p>';
  try {
    const playlists = await SpotifyAuth.getUserPlaylists();
    renderImportList(playlists);
  } catch (e) {
    $('import-list').innerHTML =
      `<p class="hint" style="padding:20px;color:var(--danger)">Error: ${esc(e.message)}</p>`;
  }
}

function renderImportList(playlists) {
  if (!playlists.length) {
    $('import-list').innerHTML = '<p class="hint" style="padding:20px">No playlists found.</p>';
    return;
  }
  $('import-list').innerHTML = playlists.map(pl => {
    const img   = pl.images?.[0]?.url || '';
    const count = pl.tracks?.total;
    const countStr = count != null ? `${count} track${count !== 1 ? 's' : ''}` : '';
    return `
      <div class="import-pl-item" data-id="${pl.id}" data-name="${esc(pl.name)}">
        ${img
          ? `<img class="import-pl-img" src="${img}" alt="" loading="lazy" />`
          : `<div class="import-pl-img import-pl-img--empty"></div>`
        }
        <div class="import-pl-info">
          <div class="import-pl-name">${esc(pl.name)}</div>
          ${countStr ? `<div class="import-pl-meta">${countStr}</div>` : ''}
        </div>
        <span class="import-pl-arrow">›</span>
      </div>`;
  }).join('');
  $('import-list').querySelectorAll('.import-pl-item').forEach(el =>
    el.addEventListener('click', () => importPlaylist(el.dataset.id, el.dataset.name))
  );
}

async function importPlaylist(spotifyId, name) {
  $('import-list').innerHTML =
    '<p class="hint" style="padding:20px">Importing tracks…</p>';
  try {
    const raw    = await SpotifyAuth.getPlaylistTracks(spotifyId);
    const tracks = raw.map(t => trackFromSpotify(t));
    S.playlists.push({ name, tracks, path: null, sha: null, created: new Date().toISOString() });
    S.activeIdx = S.playlists.length - 1;
    $('import-modal').classList.add('hidden');
    renderSidebar(); renderEditor();
    if (isMobile()) switchTab('editor');
    toast(`Imported "${name}" — ${tracks.length} tracks`, 'success');
  } catch (e) {
    const scopeErr = e.message.toLowerCase().includes('scope') ||
                     e.message.toLowerCase().includes('forbidden') ||
                     e.message.includes('403');
    const msg = scopeErr
      ? 'Access denied — log out and log back in so Spotify can grant playlist permissions.'
      : e.message;
    $('import-list').innerHTML =
      `<p class="hint" style="padding:20px;color:var(--danger)">Error: ${esc(msg)}</p>`;
  }
}

function closeImportModal() { $('import-modal').classList.add('hidden'); }

// ── Playlist CRUD ──────────────────────────────────────────────────────────
function createPlaylist() {
  S.playlists.push({ name: 'New Playlist', tracks: [], path: null, sha: null, created: new Date().toISOString() });
  S.activeIdx = S.playlists.length - 1;
  renderSidebar(); renderEditor();
  if (isMobile()) switchTab('editor');
  else { $('playlist-name').focus(); $('playlist-name').select(); }
}

function openPlaylist(i) {
  S.activeIdx = i;
  renderSidebar(); renderEditor();
  if (isMobile()) switchTab('editor');
}

async function savePlaylist() {
  if (!GitHub.hasToken()) { toast('Enter a GitHub token to save playlists.', 'error'); return; }
  const pl = currentPlaylist();
  if (!pl || !S.user) return;
  pl.name    = $('playlist-name').value.trim() || 'Untitled';
  pl.updated = new Date().toISOString();
  const btn  = $('save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    pl.path = await GitHub.savePlaylist(S.user.id, pl.name,
      { name: pl.name, owner: S.user.id, created: pl.created, updated: pl.updated, tracks: pl.tracks });
    toast('Saved to repo!', 'success'); renderSidebar();
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
  renderSidebar(); renderEditor();
  toast('Playlist deleted.');
}

async function loadSavedPlaylists() {
  if (!GitHub.hasToken() || !S.user) return;
  try {
    const files  = await GitHub.listPlaylists(S.user.id);
    const loaded = (await Promise.all(files.map(f => GitHub.loadPlaylist(f.path)))).filter(Boolean);
    const remote = loaded.map(({ playlist, sha }, idx) => ({ ...playlist, path: files[idx].path, sha }));
    S.playlists  = [...remote, ...S.playlists.filter(p => !p.path)];
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
    if (login) { toast(`GitHub: connected as @${login}`, 'success'); if (S.user) loadSavedPlaylists(); }
    else { toast('GitHub token invalid.', 'error'); GitHub.clearToken(); }
  } catch (e) { toast('GitHub token error: ' + e.message, 'error'); GitHub.clearToken(); }
}

// ── App init ───────────────────────────────────────────────────────────────
async function launchApp() {
  $('auth-overlay').classList.add('hidden');
  $('app').classList.remove('hidden');

  S.user = await SpotifyAuth.getUser();
  $('user-display').textContent = S.user.display_name || S.user.id;

  if (isMobile()) switchTab('editor');

  const savedTok = GitHub.getToken();
  if (savedTok) {
    $('gh-token-input').value = savedTok;
    $('gh-status').textContent = 'Connecting to GitHub…';
    loadSavedPlaylists();
  } else {
    $('gh-status').textContent = 'No GitHub token — playlists won\'t be saved.';
  }

  initSDK()
    .then(() => { toast('Player ready', 'success'); initScrubbing(); })
    .catch(err => { console.warn('SDK:', err); toast('Playback unavailable (Premium required).', 'error'); });

  // Reconnect when the user returns to the app (tab focus or phone unlock)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.sdkPlayer && !S.deviceId) {
      S.sdkPlayer.connect().catch(console.warn);
    }
  });

  // Search
  $('search-input').addEventListener('input', e => {
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => doSearch(e.target.value), 380);
  });
  document.addEventListener('click', e => {
    if (!$('search-results').contains(e.target) && e.target !== $('search-input'))
      $('search-results').classList.add('hidden');
  });

  // Sidebar
  $('new-playlist-btn').addEventListener('click', createPlaylist);
  $('import-btn').addEventListener('click', openImportModal);

  // Import modal
  $('close-import').addEventListener('click', closeImportModal);
  $('import-modal').querySelector('.modal-bg').addEventListener('click', closeImportModal);

  // Editor
  $('playlist-name').addEventListener('input', e => {
    if (currentPlaylist()) { currentPlaylist().name = e.target.value; renderSidebar(); }
  });
  $('play-all-btn').addEventListener('click', () => { if (currentPlaylist()?.tracks.length) playAt(0); });
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

  // Mobile player
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
  const ghIn = $('gh-token-input'), ghBtn = $('gh-token-save-btn');
  if (ghIn && ghBtn) {
    ghBtn.addEventListener('click', () => applyGhToken(ghIn.value.trim()));
    ghIn.addEventListener('keydown', e => { if (e.key === 'Enter') applyGhToken(ghIn.value.trim()); });
  }

  // PWA install
  $('install-btn')?.addEventListener('click', async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    const { outcome } = await S.installEvt.userChoice;
    if (outcome === 'accepted') $('install-btn').classList.add('hidden');
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); S.installEvt = e;
  $('install-btn')?.classList.remove('hidden');
});

(async () => {
  const clientId = window.APP_CONFIG?.spotify_client_id || '';
  if (!clientId || clientId === 'YOUR_SPOTIFY_CLIENT_ID_HERE')
    $('config-warning').classList.remove('hidden');

  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (code) {
    history.replaceState({}, '', window.location.pathname);
    try { await SpotifyAuth.handleCallback(code); await launchApp(); }
    catch (e) { toast('Login failed: ' + e.message, 'error'); console.error(e); }
    return;
  }

  if (SpotifyAuth.isLoggedIn()) { await launchApp(); return; }

  $('spotify-login-btn').addEventListener('click', () => SpotifyAuth.login());
  const ghSave = $('gh-token-save-btn'), ghIn = $('gh-token-input');
  if (ghSave) {
    ghSave.addEventListener('click', () => applyGhToken(ghIn.value.trim()));
    ghIn.addEventListener('keydown', e => { if (e.key === 'Enter') applyGhToken(ghIn.value.trim()); });
    if (GitHub.getToken()) ghIn.value = GitHub.getToken();
  }
  $('install-btn')?.addEventListener('click', async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    const { outcome } = await S.installEvt.userChoice;
    if (outcome === 'accepted') $('install-btn').classList.add('hidden');
  });
})();
