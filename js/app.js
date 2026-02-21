/*  =========================================================
 *  app.js – Photo Organizer PWA  (all UI logic)
 *  ========================================================= */

/* ─── State ─── */
let currentPage = 'gallery';
let currentSort = { key: 'dateAdded', dir: 'desc', label: 'DATE_ADDED_DESC' };
let selectedIds = new Set();
let currentFolderId = null;      // for folder detail view
let currentFolderName = '';
let currentDetailPhotoId = null;
let searchMode = 'ALL';

/* thumbnail URL cache (object-url → revoke later) */
const thumbCache = new Map();

/* ─── DOM refs ─── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const toolbar       = $('#toolbar');
const toolbarTitle  = $('#toolbarTitle');
const btnBack       = $('#btnBack');
const btnSort       = $('#btnSort');
const sortMenu      = $('#sortMenu');
const selectionBar  = $('#selectionBar');
const selCount      = $('#selCount');
const fab           = $('#fab');
const fileInput     = $('#fileInput');
const snackbarEl    = $('#snackbar');
const modalOverlay  = $('#modalOverlay');
const modalContent  = $('#modalContent');
const contextMenu   = $('#contextMenu');
const photoDetail   = $('#photoDetail');
const bottomNav     = $('#bottomNav');

/* page elements */
const galleryGrid      = $('#galleryGrid');
const galleryEmpty     = $('#galleryEmpty');
const folderList       = $('#folderList');
const foldersEmpty     = $('#foldersEmpty');
const folderDetailGrid = $('#folderDetailGrid');
const folderDetailEmpty= $('#folderDetailEmpty');
const tagListEl        = $('#tagList');
const tagsEmpty        = $('#tagsEmpty');
const searchGrid       = $('#searchGrid');
const searchEmpty      = $('#searchEmpty');
const searchInput      = $('#searchInput');
const searchTagChips   = $('#searchTagChips');
const searchDateRange  = $('#searchDateRange');

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  setupNavigation();
  setupSort();
  setupSelection();
  setupFab();
  setupSearch();
  setupPhotoDetail();
  loadPage('gallery');
});

/* ========== Navigation ========== */
function setupNavigation() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      navigateTo(page);
    });
  });
  btnBack.addEventListener('click', goBack);
}

function navigateTo(page, opts = {}) {
  clearSelection();
  closeSort();
  closeContextMenu();

  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));

  // Show/hide back button and nav-specific UI
  const isSubpage = (page === 'folderDetail');
  btnBack.style.display = isSubpage ? 'flex' : 'none';

  // Update active nav
  const navMap = { gallery: 'gallery', folders: 'folders', folderDetail: 'folders', search: 'search', tags: 'tags' };
  const activeNav = $(`.nav-item[data-page="${navMap[page]}"]`);
  if (activeNav) activeNav.classList.add('active');

  // Sort button only on gallery + folder detail
  btnSort.style.display = (page === 'gallery' || page === 'folderDetail') ? 'flex' : 'none';

  // FAB context
  updateFab(page);

  // Show page
  const pageId = {
    gallery: 'pageGallery', folders: 'pageFolders', folderDetail: 'pageFolderDetail',
    search: 'pageSearch', tags: 'pageTags'
  }[page];
  const pageEl = $(`#${pageId}`);
  if (pageEl) pageEl.classList.add('active');

  // Titles
  const titles = { gallery: 'Capture', folders: 'Folders', search: 'Search', tags: 'Tags' };
  if (page === 'folderDetail') {
    toolbarTitle.textContent = currentFolderName || 'Folder';
  } else {
    toolbarTitle.textContent = titles[page] || 'Photo Organizer';
  }

  loadPage(page);
}

function goBack() {
  if (currentPage === 'folderDetail') navigateTo('folders');
}

function updateFab(page) {
  fab.style.display = 'flex';
  if (page === 'gallery' || page === 'folderDetail') {
    fab.textContent = '+';
    fab.title = 'Import photos';
  } else if (page === 'folders') {
    fab.textContent = '+';
    fab.title = 'Create folder';
  } else if (page === 'tags') {
    fab.textContent = '+';
    fab.title = 'Create tag';
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

/* ─── Gallery ─── */
async function loadGallery() {
  const { key, dir } = currentSort;
  const photos = await PhotoDB.getAll(key, dir);
  galleryEmpty.classList.toggle('hidden', photos.length > 0);
  galleryGrid.classList.toggle('hidden', photos.length === 0);
  renderPhotoGrid(galleryGrid, photos);
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
      currentFolderId = f.id;
      currentFolderName = f.name;
      navigateTo('folderDetail');
    });
    card.querySelector('.card-action').addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderContextMenu(f, e.target);
    });
    folderList.appendChild(card);
  }
}

/* ─── Folder Detail ─── */
async function loadFolderDetail() {
  if (!currentFolderId) return;
  const { key, dir } = currentSort;
  const photos = await PhotoDB.getByFolder(currentFolderId, key, dir);
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
        await TagDB.delete(t.id);
        showSnack('Tag deleted');
        loadTags();
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
      updateSearchVisibility();
      doSearch();
    });
  });
  searchInput.addEventListener('input', debounce(doSearch, 250));
  $('#dateFrom').addEventListener('change', doSearch);
  $('#dateTo').addEventListener('change', doSearch);
}

function updateSearchVisibility() {
  const showInput = searchMode === 'ALL' || searchMode === 'BY_NAME';
  const showTags = searchMode === 'BY_TAG';
  const showDates = searchMode === 'BY_DATE';
  $('#searchBarWrap').classList.toggle('hidden', !showInput);
  searchTagChips.classList.toggle('hidden', !showTags);
  searchDateRange.classList.toggle('hidden', !showDates);
}

async function loadSearch() {
  // Load tag chips
  const tags = await TagDB.getAll();
  searchTagChips.innerHTML = '';
  for (const t of tags) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.tagId = t.id;
    chip.innerHTML = `<span class="chip-dot" style="background:${t.color}"></span>${esc(t.name)}`;
    chip.addEventListener('click', () => {
      $$('#searchTagChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.toggle('active');
      doSearch();
    });
    searchTagChips.appendChild(chip);
  }
  updateSearchVisibility();
  doSearch();
}

async function doSearch() {
  const query = searchInput.value;
  const dateFrom = $('#dateFrom').value ? new Date($('#dateFrom').value).getTime() : null;
  const dateTo = $('#dateTo').value ? new Date($('#dateTo').value).getTime() + 86400000 : null;

  let results = await PhotoDB.search(query, searchMode, { dateFrom, dateTo });

  // Tag filter
  if (searchMode === 'BY_TAG') {
    const activeChip = $('#searchTagChips .chip.active');
    if (activeChip) {
      const tagId = parseInt(activeChip.dataset.tagId);
      const photoIds = await PhotoTagDB.getPhotosForTag(tagId);
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
    img.loading = 'lazy';
    img.alt = photo.displayName;

    // Use thumbnail blob
    if (photo.thumbnail) {
      const url = thumbCache.get(photo.id) || URL.createObjectURL(photo.thumbnail);
      thumbCache.set(photo.id, url);
      img.src = url;
    } else if (photo.blob) {
      const url = URL.createObjectURL(photo.blob);
      img.src = url;
    }

    item.appendChild(img);

    if (photo.isFavorite) {
      const badge = document.createElement('span');
      badge.className = 'fav-badge';
      badge.textContent = '❤';
      item.appendChild(badge);
    }

    item.addEventListener('click', () => {
      if (selectedIds.size > 0 && selectable) {
        toggleSelection(photo.id);
      } else {
        openPhotoDetail(photo.id);
      }
    });

    if (selectable) {
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        toggleSelection(photo.id);
      });
      // Long press for mobile
      let pressTimer;
      item.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
          e.preventDefault();
          toggleSelection(photo.id);
        }, 500);
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

function clearSelection() {
  selectedIds.clear();
  updateSelectionUI();
}

function selectAll() {
  const items = $$('.page.active .photo-grid-item');
  items.forEach(item => selectedIds.add(parseInt(item.dataset.photoId)));
  updateSelectionUI();
}

function updateSelectionUI() {
  const active = selectedIds.size > 0;
  selectionBar.classList.toggle('active', active);
  selCount.textContent = `${selectedIds.size} selected`;
  // Update grid items
  $$('.photo-grid-item').forEach(item => {
    const id = parseInt(item.dataset.photoId);
    item.classList.toggle('selected', selectedIds.has(id));
  });
}

async function toggleFavSelected() {
  for (const id of selectedIds) {
    const photo = await PhotoDB.getById(id);
    if (photo) await PhotoDB.setFavorite(id, !photo.isFavorite);
  }
  clearSelection();
  showSnack('Favorites updated');
  loadPage(currentPage);
}

async function deleteSelected() {
  showConfirm(`Delete ${selectedIds.size} photo${selectedIds.size > 1 ? 's' : ''}?`, 'This cannot be undone.', async () => {
    await PhotoDB.deletePhotos([...selectedIds]);
    clearSelection();
    showSnack('Photos deleted');
    loadPage(currentPage);
  });
}

/* ========== Sort ========== */
function setupSort() {
  btnSort.addEventListener('click', (e) => {
    e.stopPropagation();
    sortMenu.classList.toggle('open');
  });
  $$('.sort-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.sort;
      $$('.sort-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      currentSort = parseSortOption(val);
      closeSort();
      loadPage(currentPage);
    });
  });
  document.addEventListener('click', () => closeSort());
}

function closeSort() { sortMenu.classList.remove('open'); }

function parseSortOption(val) {
  const map = {
    DATE_ADDED_DESC: { key: 'dateAdded', dir: 'desc' },
    DATE_ADDED_ASC: { key: 'dateAdded', dir: 'asc' },
    NAME_ASC: { key: 'displayName', dir: 'asc' },
    NAME_DESC: { key: 'displayName', dir: 'desc' },
    SIZE_DESC: { key: 'size', dir: 'desc' },
    SIZE_ASC: { key: 'size', dir: 'asc' }
  };
  return { ...map[val], label: val };
}

/* ========== FAB ========== */
function setupFab() {
  fab.addEventListener('click', () => {
    if (currentPage === 'gallery' || currentPage === 'folderDetail') {
      fileInput.click();
    } else if (currentPage === 'folders') {
      showCreateFolderDialog();
    } else if (currentPage === 'tags') {
      showCreateTagDialog();
    }
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    const folderId = currentPage === 'folderDetail' ? currentFolderId : null;
    showSnack(`Importing ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    await PhotoDB.importPhotos(files, folderId);
    fileInput.value = '';
    showSnack(`${files.length} photo${files.length > 1 ? 's' : ''} imported`);
    loadPage(currentPage);
  });
}

/* ========== Photo Detail ========== */
function setupPhotoDetail() {
  $('#detailBack').addEventListener('click', closePhotoDetail);
  $('#detailFav').addEventListener('click', async () => {
    const photo = await PhotoDB.getById(currentDetailPhotoId);
    if (!photo) return;
    await PhotoDB.setFavorite(photo.id, !photo.isFavorite);
    openPhotoDetail(photo.id); // refresh
    showSnack(photo.isFavorite ? 'Removed from favorites' : 'Added to favorites');
  });
  $('#detailDelete').addEventListener('click', () => {
    showConfirm('Delete this photo?', 'This cannot be undone.', async () => {
      await PhotoDB.deletePhotos([currentDetailPhotoId]);
      closePhotoDetail();
      showSnack('Photo deleted');
      loadPage(currentPage);
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

  // Image
  const imgEl = $('#detailImg');
  if (photo.blob) {
    imgEl.src = URL.createObjectURL(photo.blob);
  }

  // Info
  $('#infoDate').textContent = new Date(photo.dateAdded).toLocaleDateString();
  $('#infoSize').textContent = formatBytes(photo.size);
  $('#infoDims').textContent = `${photo.width} × ${photo.height}`;

  // Folder name
  if (photo.folderId) {
    const folder = await FolderDB.getById(photo.folderId);
    $('#infoFolder').textContent = folder ? folder.name : 'Uncategorized';
  } else {
    $('#infoFolder').textContent = 'Uncategorized';
  }

  // Tags
  const tags = await PhotoTagDB.getTagsForPhoto(photoId);
  const tagContainer = $('#detailTags');
  tagContainer.innerHTML = '';
  if (tags.length === 0) {
    tagContainer.innerHTML = '<span style="color:var(--on-surface-variant);font-size:13px;">No tags</span>';
  }
  for (const t of tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="chip-dot" style="background:${t.color}"></span>${esc(t.name)} <span style="cursor:pointer;margin-left:4px" data-remove-tag="${t.id}">✕</span>`;
    chip.querySelector('[data-remove-tag]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await PhotoTagDB.remove(photoId, t.id);
      openPhotoDetail(photoId);
      showSnack('Tag removed');
    });
    tagContainer.appendChild(chip);
  }

  photoDetail.classList.add('open');
  bottomNav.style.display = 'none';
  fab.style.display = 'none';
}

function closePhotoDetail() {
  photoDetail.classList.remove('open');
  bottomNav.style.display = 'flex';
  updateFab(currentPage);
  // Revoke detail image URL
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
    openPhotoDetail(photoId);
    showSnack('Photo renamed');
  });
}

/* ========== Dialogs ========== */
function showModal(html) {
  modalContent.innerHTML = html;
  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  modalContent.innerHTML = '';
}

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

function showConfirm(title, message, onConfirm) {
  showModal(`
    <h2>${esc(title)}</h2>
    <p style="color:var(--on-surface-variant);font-size:14px;margin-bottom:8px;">${esc(message)}</p>
    <div class="modal-actions">
      <button class="btn btn-text" id="modalCancel">Cancel</button>
      <button class="btn btn-danger" id="modalConfirm">Delete</button>
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
  const input = $('#promptInput');
  input.focus();
  input.select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => { closeModal(); onSubmit(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { closeModal(); onSubmit(input.value); } });
}

/* Create folder dialog */
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
  const input = $('#folderNameInput');
  input.focus();
  if (isEdit) input.select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => submitFolder(isEdit, editId, input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFolder(isEdit, editId, input); });
}

async function submitFolder(isEdit, editId, input) {
  const name = input.value.trim();
  if (!name) { showSnack('Name cannot be empty'); return; }
  const exists = await FolderDB.nameExists(name, isEdit ? editId : null);
  if (exists) { showSnack('A folder with this name already exists'); return; }
  closeModal();
  if (isEdit) {
    await FolderDB.rename(editId, name);
    showSnack('Folder renamed');
    if (currentPage === 'folderDetail') { currentFolderName = name; toolbarTitle.textContent = name; }
  } else {
    await FolderDB.create(name);
    showSnack(`Folder "${name}" created`);
  }
  loadFolders();
}

/* Create tag dialog */
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
  const input = $('#tagNameInput');
  input.focus();
  $$('#colorPicker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('#colorPicker .color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedTagColor = sw.dataset.color;
    });
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => submitTag(input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTag(input); });
}

async function submitTag(input) {
  const name = input.value.trim();
  if (!name) { showSnack('Name cannot be empty'); return; }
  const exists = await TagDB.nameExists(name);
  if (exists) { showSnack('A tag with this name already exists'); return; }
  closeModal();
  await TagDB.create(name, selectedTagColor);
  showSnack(`Tag "${name}" created`);
  loadTags();
}

/* Move to folder dialog */
async function showMoveDialog(photoIds, fromDetail = false) {
  const folders = await FolderDB.getAll();
  let items = folders.map(f =>
    `<div class="folder-pick-item" data-fid="${f.id}"><span class="folder-pick-icon">📁</span><span class="folder-pick-name">${esc(f.name)}</span></div>`
  ).join('');
  items += `<div class="folder-pick-item" data-fid="null"><span class="folder-pick-icon">📂</span><span class="folder-pick-name">Uncategorized</span></div>`;

  showModal(`
    <h2>Move to folder</h2>
    <div class="folder-pick-list">${items}</div>
    <div class="modal-actions"><button class="btn btn-text" id="modalCancel">Cancel</button></div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $$('.folder-pick-item').forEach(item => {
    item.addEventListener('click', async () => {
      const fid = item.dataset.fid === 'null' ? null : parseInt(item.dataset.fid);
      closeModal();
      await PhotoDB.moveToFolder(photoIds, fid);
      clearSelection();
      showSnack(`Moved ${photoIds.length} photo${photoIds.length > 1 ? 's' : ''}`);
      if (fromDetail) { openPhotoDetail(photoIds[0]); }
      loadPage(currentPage);
    });
  });
}

/* Tag picker dialog */
async function showTagPickerDialog(photoIds, fromDetail = false) {
  const tags = await TagDB.getAll();
  if (!tags.length) { showSnack('Create a tag first'); return; }
  const items = tags.map(t =>
    `<div class="folder-pick-item" data-tid="${t.id}"><span class="chip-dot" style="background:${t.color};width:24px;height:24px;border-radius:50%;flex-shrink:0;"></span><span class="folder-pick-name">${esc(t.name)}</span></div>`
  ).join('');

  showModal(`
    <h2>Add tag</h2>
    <div class="folder-pick-list">${items}</div>
    <div class="modal-actions"><button class="btn btn-text" id="modalCancel">Cancel</button></div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $$('.folder-pick-item').forEach(item => {
    item.addEventListener('click', async () => {
      const tid = parseInt(item.dataset.tid);
      closeModal();
      await PhotoTagDB.addToMultiple(photoIds, tid);
      clearSelection();
      showSnack('Tag added');
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
    showConfirm(`Delete "${folder.name}"?`, 'Photos in this folder will be moved to uncategorized.', async () => {
      await FolderDB.delete(folder.id);
      showSnack('Folder deleted');
      loadFolders();
    });
  });
  // Close on outside click
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function closeContextMenu() { contextMenu.classList.remove('open'); }

/* ========== Share ========== */
async function sharePhotos(photos) {
  if (!navigator.share) {
    showSnack('Sharing not supported on this browser');
    return;
  }
  const files = [];
  for (const p of photos) {
    if (p.blob) files.push(new File([p.blob], p.displayName, { type: p.mimeType }));
  }
  try {
    await navigator.share({ files, title: 'Photos from Photo Organizer' });
  } catch (e) {
    if (e.name !== 'AbortError') showSnack('Share failed');
  }
}

/* ========== Utilities ========== */
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Snackbar */
let snackTimer;
function showSnack(msg) {
  clearTimeout(snackTimer);
  snackbarEl.textContent = msg;
  snackbarEl.classList.add('show');
  snackTimer = setTimeout(() => snackbarEl.classList.remove('show'), 2500);
}
