/*  =========================================================
 *  app.js – Photo Organizer PWA  (all UI logic)
 *  Mirrors the Android app's capture session workflow.
 *  ========================================================= */

/* ─── State ─── */
let currentPage = 'gallery';
let currentSort = { key: 'dateAdded', dir: 'desc', label: 'DATE_ADDED_DESC' };
let selectedIds = new Set();
let currentFolderId = null;
let currentFolderName = '';
let currentDetailPhotoId = null;
let searchMode = 'ALL';

const thumbCache = new Map();

/* ─── DOM refs ─── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const toolbarTitle   = $('#toolbarTitle');
const btnBack        = $('#btnBack');
const btnSort        = $('#btnSort');
const sortMenu       = $('#sortMenu');
const selectionBar   = $('#selectionBar');
const selCount       = $('#selCount');
const fab            = $('#fab');
const fileInput      = $('#fileInput');
const snackbarEl     = $('#snackbar');
const modalOverlay   = $('#modalOverlay');
const modalContent   = $('#modalContent');
const contextMenu    = $('#contextMenu');
const photoDetail    = $('#photoDetail');
const bottomNav      = $('#bottomNav');

const sessionIdle    = $('#sessionIdle');
const sessionActive  = $('#sessionActive');
const sessionFolderNameEl = $('#sessionFolderName');
const sessionGrid    = $('#sessionGrid');
const sessionPhotoCount = $('#sessionPhotoCount');
const dropZone       = $('#dropZone');

const folderList     = $('#folderList');
const foldersEmpty   = $('#foldersEmpty');
const folderDetailGrid = $('#folderDetailGrid');
const folderDetailEmpty= $('#folderDetailEmpty');
const tagListEl      = $('#tagList');
const tagsEmpty      = $('#tagsEmpty');
const searchGrid     = $('#searchGrid');
const searchEmpty    = $('#searchEmpty');
const searchInput    = $('#searchInput');
const searchTagChips = $('#searchTagChips');
const searchDateRange= $('#searchDateRange');

/* ═══════════════════════════════════════════
 *  SESSION STATE (persisted in localStorage)
 *  Mirrors Android's SessionRepository
 * ═══════════════════════════════════════════ */
const SessionState = {
  _key: 'capture_session',
  _counterKey: 'session_counter',

  get() {
    try { return JSON.parse(localStorage.getItem(this._key)); } catch { return null; }
  },
  isActive() { return !!this.get()?.active; },
  getFolderId() { return this.get()?.folderId ?? null; },
  getFolderName() { return this.get()?.folderName ?? null; },
  getStartTime() { return this.get()?.startTime ?? null; },

  start(folderId, folderName) {
    localStorage.setItem(this._key, JSON.stringify({
      active: true, folderId, folderName, startTime: Date.now()
    }));
  },
  stop() { localStorage.removeItem(this._key); },

  /** Returns next session number for today and increments. Resets on new day. */
  getNextSessionNumber() {
    const today = new Date().toISOString().slice(0, 10);
    let data;
    try { data = JSON.parse(localStorage.getItem(this._counterKey)); } catch { data = null; }
    let count;
    if (data && data.date === today) {
      count = (data.count || 0) + 1;
    } else {
      count = 1;
    }
    localStorage.setItem(this._counterKey, JSON.stringify({ date: today, count }));
    return count;
  }
};

/* ═══════════════════════════════════════════
 *  DAILY CONSOLIDATION
 *  Mirrors Android's DailyConsolidationWorker
 *  Merges yesterday's "Session X" folders into
 *  a single date-named folder (e.g. "02/18/2026")
 * ═══════════════════════════════════════════ */
async function runDailyConsolidation() {
  const lastRunKey = 'consolidation_last_run';
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(lastRunKey) === today) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  const allFolders = await FolderDB.getAll();
  const sessionFolders = allFolders.filter(f =>
    f.createdAt >= yesterdayStart && f.createdAt < todayStart
  );

  if (sessionFolders.length > 0) {
    const yesterday = new Date(yesterdayStart);
    const dateLabel = `${String(yesterday.getMonth()+1).padStart(2,'0')}/${String(yesterday.getDate()).padStart(2,'0')}/${yesterday.getFullYear()}`;

    let dateFolderId;
    const existing = allFolders.find(f => f.name === dateLabel);
    if (existing) {
      dateFolderId = existing.id;
    } else {
      dateFolderId = await FolderDB.create(dateLabel);
    }

    for (const sf of sessionFolders) {
      const photos = await PhotoDB.getByFolder(sf.id);
      if (photos.length > 0) {
        await PhotoDB.moveToFolder(photos.map(p => p.id), dateFolderId);
      }
      await FolderDB.delete(sf.id);
    }
  }

  localStorage.setItem(lastRunKey, today);
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await runDailyConsolidation();
  setupNavigation();
  setupSort();
  setupSelection();
  setupFab();
  setupSearch();
  setupPhotoDetail();
  setupSession();
  setupDragDrop();
  loadPage('gallery');
});

/* ═══════════════════════════════════════════
 *  SESSION UI SETUP
 * ═══════════════════════════════════════════ */
function setupSession() {
  $('#btnSessionStart').addEventListener('click', showSessionNameDialog);
  $('#btnSessionStop').addEventListener('click', () => {
    showConfirm('End session?', 'Your captured photos will be saved to the session folder.', async () => {
      SessionState.stop();
      showSnack('Session ended');
      loadGallery();
    }, 'End session', 'Keep recording');
  });
}

function showSessionNameDialog() {
  const sessionNum = SessionState.getNextSessionNumber();
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const defaultName = `Session ${sessionNum} - ${timeStr} - Today`;

  showModal(`
    <h2>Name this session</h2>
    <input class="modal-input" id="sessionNameInput" placeholder="Session name" value="${esc(defaultName)}">
    <p style="color:var(--on-surface-variant);font-size:13px;margin-bottom:4px;">
      All photos you import will go into this folder.
    </p>
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalOk">Start</button>
    </div>
  `);
  const input = $('#sessionNameInput');
  input.focus();
  input.select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => startSessionWithName(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSessionWithName(input.value); });
}

async function startSessionWithName(name) {
  const folderName = name.trim() || `Session ${SessionState.getNextSessionNumber()}`;
  closeModal();

  let folderId;
  const exists = await FolderDB.nameExists(folderName);
  if (exists) {
    folderId = await FolderDB.create(`${folderName} (${Date.now()})`);
  } else {
    folderId = await FolderDB.create(folderName);
  }

  SessionState.start(folderId, folderName);
  showSnack(`Session started: ${folderName}`);
  loadGallery();
}

/* Drag & drop on the capture page */
function setupDragDrop() {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) { showSnack('No image files found'); return; }
    await importToSession(files);
  });
  dropZone.addEventListener('click', () => {
    if (SessionState.isActive()) fileInput.click();
  });
}

async function importToSession(files) {
  const folderId = SessionState.getFolderId();
  if (!folderId) { showSnack('No active session'); return; }
  showSnack(`Importing ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  await PhotoDB.importPhotos(files, folderId);
  showSnack(`${files.length} photo${files.length > 1 ? 's' : ''} imported`);
  loadGallery();
}

/* ========== Navigation ========== */
function setupNavigation() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  btnBack.addEventListener('click', goBack);
}

function navigateTo(page) {
  clearSelection();
  closeSort();
  closeContextMenu();

  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));

  const isSubpage = (page === 'folderDetail');
  btnBack.style.display = isSubpage ? 'flex' : 'none';

  const navMap = { gallery: 'gallery', folders: 'folders', folderDetail: 'folders', search: 'search', tags: 'tags' };
  const activeNav = $(`.nav-item[data-page="${navMap[page]}"]`);
  if (activeNav) activeNav.classList.add('active');

  btnSort.style.display = (page === 'folderDetail') ? 'flex' : 'none';
  updateFab(page);

  const pageId = { gallery: 'pageGallery', folders: 'pageFolders', folderDetail: 'pageFolderDetail', search: 'pageSearch', tags: 'pageTags' }[page];
  const pageEl = $(`#${pageId}`);
  if (pageEl) pageEl.classList.add('active');

  const titles = { gallery: 'Capture', folders: 'Folders', search: 'Search', tags: 'Tags' };
  toolbarTitle.textContent = page === 'folderDetail' ? (currentFolderName || 'Folder') : (titles[page] || 'Photo Organizer');

  loadPage(page);
}

function goBack() { if (currentPage === 'folderDetail') navigateTo('folders'); }

function updateFab(page) {
  if (page === 'gallery') {
    fab.style.display = SessionState.isActive() ? 'flex' : 'none';
    fab.textContent = '+';
    fab.title = 'Import photos to session';
  } else if (page === 'folderDetail') {
    fab.style.display = 'flex'; fab.textContent = '+'; fab.title = 'Import photos';
  } else if (page === 'folders') {
    fab.style.display = 'flex'; fab.textContent = '+'; fab.title = 'Create folder';
  } else if (page === 'tags') {
    fab.style.display = 'flex'; fab.textContent = '+'; fab.title = 'Create tag';
  } else {
    fab.style.display = 'none';
  }
}

/* ========== Page Loading ========== */
async function loadPage(page) {
  if (page === 'gallery') await loadGallery();
  else if (page === 'folders') await loadFolders();
  else if (page === 'folderDetail') await loadFolderDetail();
  else if (page === 'search') await loadSearch();
  else if (page === 'tags') await loadTags();
}

/* ─── Gallery / Capture ─── */
async function loadGallery() {
  const active = SessionState.isActive();
  sessionIdle.classList.toggle('hidden', active);
  sessionActive.classList.toggle('hidden', !active);
  updateFab('gallery');

  if (active) {
    const folderId = SessionState.getFolderId();
    sessionFolderNameEl.textContent = SessionState.getFolderName() || 'Session';

    const photos = await PhotoDB.getByFolder(folderId, currentSort.key, currentSort.dir);
    sessionPhotoCount.textContent = photos.length > 0
      ? `${photos.length} photo${photos.length !== 1 ? 's' : ''} captured`
      : '';
    sessionGrid.classList.toggle('hidden', photos.length === 0);
    renderPhotoGrid(sessionGrid, photos);
  }
}

/* ─── Folders ─── */
async function loadFolders() {
  const folders = await FolderDB.getAll();
  foldersEmpty.classList.toggle('hidden', folders.length > 0);
  folderList.classList.toggle('hidden', folders.length === 0);
  folderList.innerHTML = '';
  for (const f of folders) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-icon" style="background:${f.color || '#333'}">📁</div>
      <div class="card-body">
        <div class="card-title">${esc(f.name)}</div>
        <div class="card-subtitle">${f.photoCount} photo${f.photoCount !== 1 ? 's' : ''}</div>
      </div>
      <button class="card-action" data-folder-id="${f.id}" aria-label="More">⋮</button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-action')) return;
      currentFolderId = f.id; currentFolderName = f.name; navigateTo('folderDetail');
    });
    card.querySelector('.card-action').addEventListener('click', (e) => {
      e.stopPropagation(); showFolderContextMenu(f, e.target);
    });
    folderList.appendChild(card);
  }
}

/* ─── Folder Detail ─── */
async function loadFolderDetail() {
  if (!currentFolderId) return;
  const photos = await PhotoDB.getByFolder(currentFolderId, currentSort.key, currentSort.dir);
  folderDetailEmpty.classList.toggle('hidden', photos.length > 0);
  folderDetailGrid.classList.toggle('hidden', photos.length === 0);
  renderPhotoGrid(folderDetailGrid, photos);
}

/* ─── Tags ─── */
async function loadTags() {
  const tags = await TagDB.getAll();
  tagsEmpty.classList.toggle('hidden', tags.length > 0);
  tagListEl.classList.toggle('hidden', tags.length === 0);
  tagListEl.innerHTML = '';
  for (const t of tags) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="chip-dot" style="background:${t.color};width:32px;height:32px;border-radius:50%;flex-shrink:0;"></div>
      <div class="card-body">
        <div class="card-title">${esc(t.name)}</div>
        <div class="card-subtitle">${t.usageCount} photo${t.usageCount !== 1 ? 's' : ''}</div>
      </div>
      <button class="card-action" data-tag-id="${t.id}" aria-label="Delete">🗑</button>
    `;
    card.querySelector('.card-action').addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm(`Delete tag "${t.name}"?`, 'The tag will be removed from all photos.', async () => {
        await TagDB.delete(t.id); showSnack('Tag deleted'); loadTags();
      });
    });
    tagListEl.appendChild(card);
  }
}

/* ─── Search ─── */
function setupSearch() {
  $$('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      searchMode = tab.dataset.mode;
      updateSearchVisibility(); doSearch();
    });
  });
  searchInput.addEventListener('input', debounce(doSearch, 250));
  $('#dateFrom').addEventListener('change', doSearch);
  $('#dateTo').addEventListener('change', doSearch);
}

function updateSearchVisibility() {
  $('#searchBarWrap').classList.toggle('hidden', !(searchMode === 'ALL' || searchMode === 'BY_NAME'));
  searchTagChips.classList.toggle('hidden', searchMode !== 'BY_TAG');
  searchDateRange.classList.toggle('hidden', searchMode !== 'BY_DATE');
}

async function loadSearch() {
  const tags = await TagDB.getAll();
  searchTagChips.innerHTML = '';
  for (const t of tags) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.tagId = t.id;
    chip.innerHTML = `<span class="chip-dot" style="background:${t.color}"></span>${esc(t.name)}`;
    chip.addEventListener('click', () => {
      $$('#searchTagChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.toggle('active'); doSearch();
    });
    searchTagChips.appendChild(chip);
  }
  updateSearchVisibility(); doSearch();
}

async function doSearch() {
  const query = searchInput.value;
  const dateFrom = $('#dateFrom').value ? new Date($('#dateFrom').value).getTime() : null;
  const dateTo = $('#dateTo').value ? new Date($('#dateTo').value).getTime() + 86400000 : null;
  let results = await PhotoDB.search(query, searchMode, { dateFrom, dateTo });

  if (searchMode === 'BY_TAG') {
    const activeChip = $('#searchTagChips .chip.active');
    if (activeChip) {
      const photoIds = await PhotoTagDB.getPhotosForTag(parseInt(activeChip.dataset.tagId));
      const idSet = new Set(photoIds);
      results = results.filter(p => idSet.has(p.id));
    }
  }

  searchEmpty.classList.toggle('hidden', results.length > 0 || (!query && searchMode !== 'BY_TAG' && searchMode !== 'BY_DATE'));
  searchGrid.classList.toggle('hidden', results.length === 0);
  renderPhotoGrid(searchGrid, results, { selectable: false });
}

/* ========== Photo Grid Renderer ========== */
function renderPhotoGrid(container, photos, opts = {}) {
  const { selectable = true } = opts;
  container.innerHTML = '';
  for (const photo of photos) {
    const item = document.createElement('div');
    item.className = 'photo-grid-item';
    item.dataset.photoId = photo.id;
    if (selectedIds.has(photo.id)) item.classList.add('selected');

    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = photo.displayName;
    if (photo.thumbnail) {
      const url = thumbCache.get(photo.id) || URL.createObjectURL(photo.thumbnail);
      thumbCache.set(photo.id, url); img.src = url;
    } else if (photo.blob) { img.src = URL.createObjectURL(photo.blob); }
    item.appendChild(img);

    if (photo.isFavorite) {
      const badge = document.createElement('span');
      badge.className = 'fav-badge'; badge.textContent = '❤';
      item.appendChild(badge);
    }

    item.addEventListener('click', () => {
      if (selectedIds.size > 0 && selectable) toggleSelection(photo.id);
      else openPhotoDetail(photo.id);
    });

    if (selectable) {
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleSelection(photo.id); });
      let pressTimer;
      item.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => { e.preventDefault(); toggleSelection(photo.id); }, 500);
      }, { passive: false });
      item.addEventListener('touchend', () => clearTimeout(pressTimer));
      item.addEventListener('touchmove', () => clearTimeout(pressTimer));
    }
    container.appendChild(item);
  }
}

/* ========== Selection ========== */
function setupSelection() {
  $('#selClear').addEventListener('click', clearSelection);
  $('#selSelectAll').addEventListener('click', selectAll);
  $('#selMove').addEventListener('click', () => showMoveDialog([...selectedIds]));
  $('#selTag').addEventListener('click', () => showTagPickerDialog([...selectedIds]));
  $('#selFav').addEventListener('click', toggleFavSelected);
  $('#selDelete').addEventListener('click', deleteSelected);
}
function toggleSelection(photoId) {
  if (selectedIds.has(photoId)) selectedIds.delete(photoId);
  else selectedIds.add(photoId);
  updateSelectionUI();
}
function clearSelection() { selectedIds.clear(); updateSelectionUI(); }
function selectAll() {
  $$('.page.active .photo-grid-item').forEach(item => selectedIds.add(parseInt(item.dataset.photoId)));
  updateSelectionUI();
}
function updateSelectionUI() {
  selectionBar.classList.toggle('active', selectedIds.size > 0);
  selCount.textContent = `${selectedIds.size} selected`;
  $$('.photo-grid-item').forEach(item => {
    item.classList.toggle('selected', selectedIds.has(parseInt(item.dataset.photoId)));
  });
}
async function toggleFavSelected() {
  for (const id of selectedIds) {
    const p = await PhotoDB.getById(id);
    if (p) await PhotoDB.setFavorite(id, !p.isFavorite);
  }
  clearSelection(); showSnack('Favorites updated'); loadPage(currentPage);
}
async function deleteSelected() {
  showConfirm(`Delete ${selectedIds.size} photo${selectedIds.size > 1 ? 's' : ''}?`, 'This cannot be undone.', async () => {
    await PhotoDB.deletePhotos([...selectedIds]);
    clearSelection(); showSnack('Photos deleted'); loadPage(currentPage);
  });
}

/* ========== Sort ========== */
function setupSort() {
  btnSort.addEventListener('click', (e) => { e.stopPropagation(); sortMenu.classList.toggle('open'); });
  $$('.sort-option').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('.sort-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      currentSort = parseSortOption(opt.dataset.sort);
      closeSort(); loadPage(currentPage);
    });
  });
  document.addEventListener('click', () => closeSort());
}
function closeSort() { sortMenu.classList.remove('open'); }
function parseSortOption(val) {
  const map = {
    DATE_ADDED_DESC: { key: 'dateAdded', dir: 'desc' }, DATE_ADDED_ASC: { key: 'dateAdded', dir: 'asc' },
    NAME_ASC: { key: 'displayName', dir: 'asc' }, NAME_DESC: { key: 'displayName', dir: 'desc' },
    SIZE_DESC: { key: 'size', dir: 'desc' }, SIZE_ASC: { key: 'size', dir: 'asc' }
  };
  return { ...map[val], label: val };
}

/* ========== FAB ========== */
function setupFab() {
  fab.addEventListener('click', () => {
    if (currentPage === 'gallery' && SessionState.isActive()) fileInput.click();
    else if (currentPage === 'folderDetail') fileInput.click();
    else if (currentPage === 'folders') showCreateFolderDialog();
    else if (currentPage === 'tags') showCreateTagDialog();
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    if (currentPage === 'gallery' && SessionState.isActive()) {
      await importToSession(files);
    } else if (currentPage === 'folderDetail') {
      showSnack(`Importing ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      await PhotoDB.importPhotos(files, currentFolderId);
      showSnack(`${files.length} photo${files.length > 1 ? 's' : ''} imported`);
      loadPage(currentPage);
    }
    fileInput.value = '';
  });
}

/* ========== Photo Detail ========== */
function setupPhotoDetail() {
  $('#detailBack').addEventListener('click', closePhotoDetail);
  $('#detailFav').addEventListener('click', async () => {
    const p = await PhotoDB.getById(currentDetailPhotoId);
    if (!p) return;
    await PhotoDB.setFavorite(p.id, !p.isFavorite);
    openPhotoDetail(p.id);
    showSnack(p.isFavorite ? 'Removed from favorites' : 'Added to favorites');
  });
  $('#detailDelete').addEventListener('click', () => {
    showConfirm('Delete this photo?', 'This cannot be undone.', async () => {
      await PhotoDB.deletePhotos([currentDetailPhotoId]);
      closePhotoDetail(); showSnack('Photo deleted'); loadPage(currentPage);
    });
  });
  $('#detailRename').addEventListener('click', () => renamePhoto(currentDetailPhotoId));
  $('#detailMove').addEventListener('click', () => showMoveDialog([currentDetailPhotoId], true));
  $('#detailAddTag').addEventListener('click', () => showTagPickerDialog([currentDetailPhotoId], true));
}

async function openPhotoDetail(photoId) {
  currentDetailPhotoId = photoId;
  const photo = await PhotoDB.getById(photoId);
  if (!photo) return;

  $('#detailName').textContent = photo.customName || photo.displayName;
  $('#detailFav').textContent = photo.isFavorite ? '❤' : '♡';
  if (photo.blob) $('#detailImg').src = URL.createObjectURL(photo.blob);

  $('#infoDate').textContent = new Date(photo.dateAdded).toLocaleDateString();
  $('#infoSize').textContent = formatBytes(photo.size);
  $('#infoDims').textContent = `${photo.width} × ${photo.height}`;

  if (photo.folderId) {
    const folder = await FolderDB.getById(photo.folderId);
    $('#infoFolder').textContent = folder ? folder.name : 'Uncategorized';
  } else { $('#infoFolder').textContent = 'Uncategorized'; }

  const tags = await PhotoTagDB.getTagsForPhoto(photoId);
  const tc = $('#detailTags');
  tc.innerHTML = '';
  if (!tags.length) tc.innerHTML = '<span style="color:var(--on-surface-variant);font-size:13px;">No tags</span>';
  for (const t of tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="chip-dot" style="background:${t.color}"></span>${esc(t.name)} <span style="cursor:pointer;margin-left:4px" data-remove-tag="${t.id}">✕</span>`;
    chip.querySelector('[data-remove-tag]').addEventListener('click', async (e) => {
      e.stopPropagation(); await PhotoTagDB.remove(photoId, t.id);
      openPhotoDetail(photoId); showSnack('Tag removed');
    });
    tc.appendChild(chip);
  }

  photoDetail.classList.add('open');
  bottomNav.style.display = 'none'; fab.style.display = 'none';
}

function closePhotoDetail() {
  photoDetail.classList.remove('open');
  bottomNav.style.display = 'flex'; updateFab(currentPage);
  const img = $('#detailImg');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

async function renamePhoto(photoId) {
  const photo = await PhotoDB.getById(photoId);
  if (!photo) return;
  showPrompt('Rename photo', 'New name', photo.customName || photo.displayName, async (name) => {
    if (!name.trim()) return;
    photo.customName = name.trim();
    await PhotoDB.update(photo);
    openPhotoDetail(photoId); showSnack('Photo renamed');
  });
}

/* ========== Dialogs ========== */
function showModal(html) { modalContent.innerHTML = html; modalOverlay.classList.add('open'); }
function closeModal() { modalOverlay.classList.remove('open'); modalContent.innerHTML = ''; }
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

function showConfirm(title, message, onConfirm, confirmText = 'Delete', cancelText = 'Cancel') {
  showModal(`
    <h2>${esc(title)}</h2>
    <p style="color:var(--on-surface-variant);font-size:14px;margin-bottom:8px;">${esc(message)}</p>
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">${esc(cancelText)}</button>
      <button class="btn btn-danger" id="modalConfirm">${esc(confirmText)}</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalConfirm').addEventListener('click', () => { closeModal(); onConfirm(); });
}

function showPrompt(title, placeholder, defaultVal, onSubmit) {
  showModal(`
    <h2>${esc(title)}</h2>
    <input class="modal-input" id="promptInput" placeholder="${esc(placeholder)}" value="${esc(defaultVal || '')}">
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalOk">Save</button>
    </div>
  `);
  const input = $('#promptInput'); input.focus(); input.select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => { closeModal(); onSubmit(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { closeModal(); onSubmit(input.value); } });
}

function showCreateFolderDialog(editId = null, editName = '') {
  const isEdit = editId !== null;
  showModal(`
    <h2>${isEdit ? 'Rename folder' : 'New folder'}</h2>
    <input class="modal-input" id="folderNameInput" placeholder="Folder name" value="${esc(editName)}">
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalOk">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `);
  const input = $('#folderNameInput'); input.focus(); if (isEdit) input.select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => submitFolder(isEdit, editId, input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFolder(isEdit, editId, input); });
}

async function submitFolder(isEdit, editId, input) {
  const name = input.value.trim();
  if (!name) { showSnack('Name cannot be empty'); return; }
  if (await FolderDB.nameExists(name, isEdit ? editId : null)) { showSnack('A folder with this name already exists'); return; }
  closeModal();
  if (isEdit) {
    await FolderDB.rename(editId, name); showSnack('Folder renamed');
    if (currentPage === 'folderDetail') { currentFolderName = name; toolbarTitle.textContent = name; }
  } else {
    await FolderDB.create(name); showSnack(`Folder "${name}" created`);
  }
  loadFolders();
}

const TAG_COLORS = ['#FF6200EE','#FF03DAC5','#FFE53935','#FF43A047','#FF1E88E5','#FFFB8C00','#FF8E24AA','#FF00ACC1'];
let selectedTagColor = TAG_COLORS[0];

function showCreateTagDialog() {
  const swatches = TAG_COLORS.map((c, i) =>
    `<div class="color-swatch ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
  ).join('');
  showModal(`
    <h2>New tag</h2>
    <input class="modal-input" id="tagNameInput" placeholder="Tag name">
    <div class="section-title">Color</div>
    <div class="color-picker" id="colorPicker">${swatches}</div>
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalOk">Create</button>
    </div>
  `);
  selectedTagColor = TAG_COLORS[0];
  const input = $('#tagNameInput'); input.focus();
  $$('#colorPicker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('#colorPicker .color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected'); selectedTagColor = sw.dataset.color;
    });
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => submitTag(input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTag(input); });
}

async function submitTag(input) {
  const name = input.value.trim();
  if (!name) { showSnack('Name cannot be empty'); return; }
  if (await TagDB.nameExists(name)) { showSnack('A tag with this name already exists'); return; }
  closeModal();
  await TagDB.create(name, selectedTagColor);
  showSnack(`Tag "${name}" created`); loadTags();
}

async function showMoveDialog(photoIds, fromDetail = false) {
  const folders = await FolderDB.getAll();
  let items = folders.map(f =>
    `<div class="folder-pick-item" data-fid="${f.id}"><span class="folder-pick-icon">📁</span><span class="folder-pick-name">${esc(f.name)}</span></div>`
  ).join('');
  items += `<div class="folder-pick-item" data-fid="null"><span class="folder-pick-icon">📂</span><span class="folder-pick-name">Uncategorized</span></div>`;
  showModal(`<h2>Move to folder</h2><div class="folder-pick-list">${items}</div><div class="modal-actions"><button class="btn btn-text" id="modalCancel">Cancel</button></div>`);
  $('#modalCancel').addEventListener('click', closeModal);
  $$('.folder-pick-item').forEach(item => {
    item.addEventListener('click', async () => {
      const fid = item.dataset.fid === 'null' ? null : parseInt(item.dataset.fid);
      closeModal(); await PhotoDB.moveToFolder(photoIds, fid); clearSelection();
      showSnack(`Moved ${photoIds.length} photo${photoIds.length > 1 ? 's' : ''}`);
      if (fromDetail) openPhotoDetail(photoIds[0]);
      loadPage(currentPage);
    });
  });
}

async function showTagPickerDialog(photoIds, fromDetail = false) {
  const tags = await TagDB.getAll();
  if (!tags.length) { showSnack('Create a tag first'); return; }
  const items = tags.map(t =>
    `<div class="folder-pick-item" data-tid="${t.id}"><span class="chip-dot" style="background:${t.color};width:24px;height:24px;border-radius:50%;flex-shrink:0;"></span><span class="folder-pick-name">${esc(t.name)}</span></div>`
  ).join('');
  showModal(`<h2>Add tag</h2><div class="folder-pick-list">${items}</div><div class="modal-actions"><button class="btn btn-text" id="modalCancel">Cancel</button></div>`);
  $('#modalCancel').addEventListener('click', closeModal);
  $$('.folder-pick-item').forEach(item => {
    item.addEventListener('click', async () => {
      closeModal(); await PhotoTagDB.addToMultiple(photoIds, parseInt(item.dataset.tid));
      clearSelection(); showSnack('Tag added');
      if (fromDetail) openPhotoDetail(photoIds[0]);
      loadPage(currentPage);
    });
  });
}

/* ========== Folder Context Menu ========== */
function showFolderContextMenu(folder, anchor) {
  closeContextMenu();
  const rect = anchor.getBoundingClientRect();
  contextMenu.style.top = rect.bottom + 'px';
  contextMenu.style.right = (window.innerWidth - rect.right) + 'px';
  contextMenu.style.left = 'auto';
  contextMenu.innerHTML = `
    <button class="context-option" id="ctxRename">Rename</button>
    <button class="context-option" id="ctxShare">Share all photos</button>
    <button class="context-option danger" id="ctxDelete">Delete folder</button>
  `;
  contextMenu.classList.add('open');
  $('#ctxRename').addEventListener('click', () => { closeContextMenu(); showCreateFolderDialog(folder.id, folder.name); });
  $('#ctxShare').addEventListener('click', async () => {
    closeContextMenu();
    const photos = await PhotoDB.getByFolder(folder.id);
    if (!photos.length) { showSnack('No photos to share'); return; }
    sharePhotos(photos);
  });
  $('#ctxDelete').addEventListener('click', () => {
    closeContextMenu();
    showConfirm(`Delete "${folder.name}"?`, 'Photos will be moved to uncategorized.', async () => {
      await FolderDB.delete(folder.id); showSnack('Folder deleted'); loadFolders();
    });
  });
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}
function closeContextMenu() { contextMenu.classList.remove('open'); }

/* ========== Share ========== */
async function sharePhotos(photos) {
  if (!navigator.share) { showSnack('Sharing not supported on this browser'); return; }
  const files = photos.filter(p => p.blob).map(p => new File([p.blob], p.displayName, { type: p.mimeType }));
  try { await navigator.share({ files, title: 'Photos from Photo Organizer' }); }
  catch (e) { if (e.name !== 'AbortError') showSnack('Share failed'); }
}

/* ========== Utilities ========== */
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

let snackTimer;
function showSnack(msg) {
  clearTimeout(snackTimer);
  snackbarEl.textContent = msg;
  snackbarEl.classList.add('show');
  snackTimer = setTimeout(() => snackbarEl.classList.remove('show'), 2500);
}
