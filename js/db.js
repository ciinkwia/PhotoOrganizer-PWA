/*  =========================================================
 *  db.js – IndexedDB data layer for Photo Organizer PWA
 *  Mirrors the Room database from the Android app:
 *    photos, folders, tags, photo_tag_cross_ref
 *  ========================================================= */

const DB_NAME = 'PhotoOrganizerDB';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Photos store
      if (!db.objectStoreNames.contains('photos')) {
        const ps = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('folderId', 'folderId', { unique: false });
        ps.createIndex('dateAdded', 'dateAdded', { unique: false });
        ps.createIndex('displayName', 'displayName', { unique: false });
        ps.createIndex('size', 'size', { unique: false });
        ps.createIndex('isFavorite', 'isFavorite', { unique: false });
      }

      // Folders store
      if (!db.objectStoreNames.contains('folders')) {
        const fs = db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
        fs.createIndex('name', 'name', { unique: true });
        fs.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Tags store
      if (!db.objectStoreNames.contains('tags')) {
        const ts = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
        ts.createIndex('name', 'name', { unique: true });
      }

      // Photo-Tag cross reference
      if (!db.objectStoreNames.contains('photo_tags')) {
        const pts = db.createObjectStore('photo_tags', { autoIncrement: true });
        pts.createIndex('photoId', 'photoId', { unique: false });
        pts.createIndex('tagId', 'tagId', { unique: false });
        pts.createIndex('combo', ['photoId', 'tagId'], { unique: true });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

/* ─── Generic helpers ─── */
async function _tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function _req(idbReq) {
  return new Promise((resolve, reject) => {
    idbReq.onsuccess = () => resolve(idbReq.result);
    idbReq.onerror = () => reject(idbReq.error);
  });
}

function _txComplete(store) {
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = (e) => reject(e.target.error);
  });
}

/* ─── Photos ─── */
const PhotoDB = {
  /** Import photos from File objects. Stores thumbnail + blob. Returns array of new IDs. */
  async importPhotos(files, folderId = null) {
    const db = await openDB();
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const ids = [];
    const now = Date.now();

    for (const file of files) {
      const blob = file;
      const thumb = await _makeThumbnail(file, 300);
      const dims = await _getImageDimensions(file);
      const record = {
        blob,
        thumbnail: thumb,
        displayName: file.name,
        customName: null,
        mimeType: file.type,
        dateAdded: now,
        dateModified: file.lastModified || now,
        dateTaken: file.lastModified || null,
        size: file.size,
        width: dims.width,
        height: dims.height,
        folderId: folderId,
        isFavorite: false,
      };
      const req = store.add(record);
      ids.push(await _req(req));
    }
    await _txComplete(store);
    return ids;
  },

  async getAll(sortKey = 'dateAdded', sortDir = 'desc') {
    const store = await _tx('photos', 'readonly');
    const all = await _req(store.getAll());
    return _sortPhotos(all, sortKey, sortDir);
  },

  async getByFolder(folderId, sortKey = 'dateAdded', sortDir = 'desc') {
    const store = await _tx('photos', 'readonly');
    const idx = store.index('folderId');
    const all = await _req(idx.getAll(folderId));
    return _sortPhotos(all, sortKey, sortDir);
  },

  async getById(id) {
    const store = await _tx('photos', 'readonly');
    return _req(store.get(id));
  },

  async update(photo) {
    const store = await _tx('photos', 'readwrite');
    return _req(store.put(photo));
  },

  async moveToFolder(photoIds, folderId) {
    const db = await openDB();
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const id of photoIds) {
      const photo = await _req(store.get(id));
      if (photo) { photo.folderId = folderId; store.put(photo); }
    }
    await _txComplete(store);
  },

  async setFavorite(photoId, isFav) {
    const store = await _tx('photos', 'readwrite');
    const photo = await _req(store.get(photoId));
    if (photo) { photo.isFavorite = isFav; await _req(store.put(photo)); }
  },

  async deletePhotos(ids) {
    // Remove tag references first
    await _deleteTagRefsForPhotos(ids);
    // Then delete the photos
    const db = await openDB();
    const tx = db.transaction('photos', 'readwrite');
    const ps = tx.objectStore('photos');
    for (const id of ids) {
      ps.delete(id);
    }
    await _txComplete(ps);
  },

  async search(query, mode, { tagId, dateFrom, dateTo } = {}) {
    const all = await this.getAll();
    const q = (query || '').toLowerCase().trim();
    return all.filter(p => {
      if (mode === 'BY_NAME') return p.displayName.toLowerCase().includes(q) || (p.customName && p.customName.toLowerCase().includes(q));
      if (mode === 'BY_DATE') {
        if (!dateFrom && !dateTo) return true;
        const d = p.dateAdded;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      }
      if (mode === 'BY_TAG') return true; // filtered after tag join
      // ALL
      if (!q) return true;
      return p.displayName.toLowerCase().includes(q) || (p.customName && p.customName.toLowerCase().includes(q));
    });
  },

  async countByFolder(folderId) {
    const store = await _tx('photos', 'readonly');
    const idx = store.index('folderId');
    return _req(idx.count(folderId));
  },

  async getUncategorizedCount() {
    // Photos with folderId = null
    const all = await this.getAll();
    return all.filter(p => p.folderId === null).length;
  }
};

/* ─── Folders ─── */
const FolderDB = {
  async create(name, description = null, color = null) {
    const store = await _tx('folders', 'readwrite');
    const record = { name, description, color, createdAt: Date.now(), sortOrder: 0, coverPhotoId: null };
    return _req(store.add(record));
  },

  async getAll() {
    const store = await _tx('folders', 'readonly');
    const all = await _req(store.getAll());
    // Attach photo counts
    for (const f of all) {
      f.photoCount = await PhotoDB.countByFolder(f.id);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getById(id) {
    const store = await _tx('folders', 'readonly');
    return _req(store.get(id));
  },

  async rename(id, newName) {
    const store = await _tx('folders', 'readwrite');
    const folder = await _req(store.get(id));
    if (folder) { folder.name = newName; await _req(store.put(folder)); }
  },

  async delete(id) {
    // Move photos to uncategorized first
    const photos = await PhotoDB.getByFolder(id);
    if (photos.length) await PhotoDB.moveToFolder(photos.map(p => p.id), null);
    const store = await _tx('folders', 'readwrite');
    return _req(store.delete(id));
  },

  async nameExists(name, excludeId = null) {
    const all = await this.getAll();
    return all.some(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== excludeId);
  }
};

/* ─── Tags ─── */
const TagDB = {
  async create(name, color = '#FF6200EE') {
    const store = await _tx('tags', 'readwrite');
    return _req(store.add({ name, color, createdAt: Date.now(), usageCount: 0 }));
  },

  async getAll() {
    const store = await _tx('tags', 'readonly');
    const all = await _req(store.getAll());
    // Recount usage
    for (const t of all) {
      t.usageCount = await this.getUsageCount(t.id);
    }
    return all.sort((a, b) => b.usageCount - a.usageCount);
  },

  async getById(id) {
    const store = await _tx('tags', 'readonly');
    return _req(store.get(id));
  },

  async delete(id) {
    await _deleteTagRefs(id);
    const store = await _tx('tags', 'readwrite');
    return _req(store.delete(id));
  },

  async nameExists(name) {
    const all = await this.getAll();
    return all.some(t => t.name.toLowerCase() === name.toLowerCase());
  },

  async getUsageCount(tagId) {
    const store = await _tx('photo_tags', 'readonly');
    const idx = store.index('tagId');
    return _req(idx.count(tagId));
  }
};

/* ─── Photo-Tag Refs ─── */
const PhotoTagDB = {
  async add(photoId, tagId) {
    const store = await _tx('photo_tags', 'readwrite');
    try {
      await _req(store.add({ photoId, tagId, taggedAt: Date.now() }));
    } catch (e) {
      // Duplicate — ignore
    }
  },

  async addToMultiple(photoIds, tagId) {
    for (const pid of photoIds) await this.add(pid, tagId);
  },

  async remove(photoId, tagId) {
    const store = await _tx('photo_tags', 'readwrite');
    const idx = store.index('combo');
    const key = await _req(idx.getKey([photoId, tagId]));
    if (key !== undefined) await _req(store.delete(key));
  },

  async getTagsForPhoto(photoId) {
    const store = await _tx('photo_tags', 'readonly');
    const idx = store.index('photoId');
    const refs = await _req(idx.getAll(photoId));
    const tags = [];
    for (const ref of refs) {
      const tag = await TagDB.getById(ref.tagId);
      if (tag) tags.push(tag);
    }
    return tags;
  },

  async getPhotosForTag(tagId) {
    const store = await _tx('photo_tags', 'readonly');
    const idx = store.index('tagId');
    const refs = await _req(idx.getAll(tagId));
    return refs.map(r => r.photoId);
  }
};

/* ─── Internal helpers ─── */
async function _deleteTagRefs(tagId) {
  const db = await openDB();
  const tx = db.transaction('photo_tags', 'readwrite');
  const store = tx.objectStore('photo_tags');
  const idx = store.index('tagId');
  const keys = await _getAllKeys(idx, tagId);
  for (const k of keys) store.delete(k);
  await _txComplete(store);
}

async function _deleteTagRefsForPhotos(photoIds) {
  const db = await openDB();
  const tx = db.transaction('photo_tags', 'readwrite');
  const store = tx.objectStore('photo_tags');
  for (const pid of photoIds) {
    const idx = store.index('photoId');
    const keys = await _getAllKeys(idx, pid);
    for (const k of keys) store.delete(k);
  }
  await _txComplete(store);
}

function _getAllKeys(index, query) {
  return new Promise((resolve, reject) => {
    const keys = [];
    const req = index.openKeyCursor(query);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { keys.push(cursor.primaryKey); cursor.continue(); }
      else resolve(keys);
    };
    req.onerror = () => reject(req.error);
  });
}

function _sortPhotos(arr, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return arr.sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function _makeThumbnail(file, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob);
      }, 'image/jpeg', 0.7);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function _getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.width, height: img.height }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
    img.src = url;
  });
}
