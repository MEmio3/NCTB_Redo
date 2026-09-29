/* ==========================================================================
   NCTB Atlas — local library store (IndexedDB)

   Everything a reader creates lives here, in their own browser, and nowhere
   else. Three stores:

     docs   one row per opened document: title, origin, reading position
     marks  one row per annotation, indexed by docId
     files  the PDF bytes themselves, so a book fetched or dropped once
            reopens instantly on the next visit

   localStorage is deliberately not used for any of this: annotation sets and
   PDF blobs both blow past its ~5 MB string quota.
   ========================================================================== */

const DB_NAME = 'nctb-atlas';
const DB_VERSION = 1;

let dbPromise;

function openDB() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) {
        db.createObjectStore('docs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('marks')) {
        const marks = db.createObjectStore('marks', { keyPath: 'id' });
        marks.createIndex('docId', 'docId');
        marks.createIndex('docPage', ['docId', 'page']);
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage blocked by another open tab'));
  });
  return dbPromise;
}

/** Run `fn(store)` in a transaction and resolve with the request result. */
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let out;
    try {
      out = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

function reqAll(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** True when the browser has IndexedDB at all (private modes sometimes not). */
export const supported = typeof indexedDB !== 'undefined';

/* --------------------------------------------------------------------------
   Identity
   -------------------------------------------------------------------------- */

/**
 * Stable id for a document so annotations reattach on a later visit.
 *
 * Drive and URL documents key off their address, which never changes. A file
 * the reader drags in keys off a hash of its bytes, so dropping the same PDF
 * again — even renamed, even from a different folder — finds the same notes.
 */
export async function docId({ driveId, url, bytes } = {}) {
  if (driveId) return `drive:${driveId}`;
  if (url) return `url:${await sha256(new TextEncoder().encode(url))}`;
  if (bytes) return `file:${await sha256(bytes)}`;
  throw new Error('docId needs a driveId, url, or bytes');
}

async function sha256(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('').slice(0, 32);
}

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/* --------------------------------------------------------------------------
   Documents
   -------------------------------------------------------------------------- */

export async function getDoc(id) {
  return tx('docs', 'readonly', (s) => s.get(id));
}

export async function listDocs() {
  const rows = await tx('docs', 'readonly', (s) => s.getAll());
  return (rows || []).sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

/** Create or merge a document row. Existing fields win unless overridden. */
export async function putDoc(doc) {
  const existing = await getDoc(doc.id);
  const merged = {
    createdAt: Date.now(),
    ...existing,
    ...doc,
    lastOpenedAt: Date.now(),
  };
  await tx('docs', 'readwrite', (s) => s.put(merged));
  return merged;
}

export async function patchDoc(id, patch) {
  const existing = await getDoc(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  await tx('docs', 'readwrite', (s) => s.put(merged));
  return merged;
}

/** Remove a document and everything attached to it. */
export async function deleteDoc(id) {
  const marks = await listMarks(id);
  await tx('marks', 'readwrite', (s) => { marks.forEach((m) => s.delete(m.id)); });
  await tx('files', 'readwrite', (s) => s.delete(id));
  await tx('docs', 'readwrite', (s) => s.delete(id));
}

/* --------------------------------------------------------------------------
   Annotations
   -------------------------------------------------------------------------- */

export async function listMarks(docId) {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const t = db.transaction('marks', 'readonly');
    const req = t.objectStore('marks').index('docId').getAll(IDBKeyRange.only(docId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return (rows || []).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

export async function putMark(mark) {
  const row = {
    id: mark.id || uid(),
    createdAt: mark.createdAt || Date.now(),
    ...mark,
    updatedAt: Date.now(),
  };
  await tx('marks', 'readwrite', (s) => s.put(row));
  return row;
}

export async function putMarks(marks) {
  if (!marks.length) return [];
  const rows = marks.map((m) => ({
    id: m.id || uid(),
    createdAt: m.createdAt || Date.now(),
    ...m,
    updatedAt: Date.now(),
  }));
  await tx('marks', 'readwrite', (s) => { rows.forEach((r) => s.put(r)); });
  return rows;
}

export async function deleteMark(id) {
  await tx('marks', 'readwrite', (s) => s.delete(id));
}

export async function clearMarks(docId) {
  const marks = await listMarks(docId);
  await tx('marks', 'readwrite', (s) => { marks.forEach((m) => s.delete(m.id)); });
  return marks.length;
}

/* --------------------------------------------------------------------------
   Cached PDF bytes
   -------------------------------------------------------------------------- */

export async function getFile(id) {
  const row = await tx('files', 'readonly', (s) => s.get(id));
  return row ? row.blob : null;
}

export async function hasFile(id) {
  const row = await tx('files', 'readonly', (s) => s.getKey(id));
  return Boolean(row);
}

/**
 * Keep a copy of the PDF so the reader never has to find it again.
 * Returns false (without throwing) when the browser refuses the write —
 * quota is a normal condition here, since textbooks run to 30 MB.
 */
export async function putFile(id, blob, name = '') {
  try {
    await tx('files', 'readwrite', (s) =>
      s.put({ id, blob, name, size: blob.size, storedAt: Date.now() }));
    return true;
  } catch (err) {
    console.warn('[atlas] could not cache PDF bytes:', err);
    return false;
  }
}

export async function deleteFile(id) {
  await tx('files', 'readwrite', (s) => s.delete(id));
}

/* --------------------------------------------------------------------------
   Housekeeping
   -------------------------------------------------------------------------- */

/** Bytes used / available, when the browser is willing to say. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
  return { used, quota };
}

/** Ask the browser not to evict this origin under storage pressure. */
export async function persist() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** Everything the reader has made, as a portable JSON object. */
export async function exportAll(docIdFilter = null) {
  const docs = await listDocs();
  const chosen = docIdFilter ? docs.filter((d) => d.id === docIdFilter) : docs;
  const out = [];
  for (const doc of chosen) {
    out.push({ doc, marks: await listMarks(doc.id) });
  }
  return {
    format: 'nctb-atlas-annotations',
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: out,
  };
}

/** Merge an exported bundle back in. Existing ids are overwritten. */
export async function importAll(bundle) {
  if (!bundle || bundle.format !== 'nctb-atlas-annotations') {
    throw new Error('Not an Atlas annotation file');
  }
  let docs = 0;
  let marks = 0;
  for (const entry of bundle.documents || []) {
    if (!entry.doc?.id) continue;
    await putDoc(entry.doc);
    docs += 1;
    const rows = (entry.marks || []).map((m) => ({ ...m, docId: entry.doc.id }));
    await putMarks(rows);
    marks += rows.length;
  }
  return { docs, marks };
}

export { openDB };
