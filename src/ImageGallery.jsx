
import React, { useEffect, useMemo, useState } from 'react';
import { listImages, getImageBlob, removeImage, clearAll } from './storage.js';
import './styles.css';

function useObjectURL(blob) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

function ImageThumb({ id, onClick }) {
  const [blob, setBlob] = useState(null);
  useEffect(() => { (async () => { setBlob(await getImageBlob(id)); })(); }, [id]);
  const url = useObjectURL(blob);
  return <img src={url || ''} className="thumb" alt="" onClick={onClick} style={{ cursor: 'pointer' }} />;
}

export default function ImageGallery() {
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null); // { id, blob }
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const list = await listImages();
    setItems(list);
  }

  useEffect(() => { refresh(); }, []);

  async function openItem(meta) {
    const blob = await getImageBlob(meta.id);
    setPreview({ id: meta.id, blob });
  }

  async function deleteItem(id) {
    if (!confirm('Delete this image?')) return;
    await removeImage(id);
    if (preview?.id === id) setPreview(null);
    refresh();
  }

  async function clearGallery() {
    if (!confirm('Delete ALL images?')) return;
    setBusy(true);
    await clearAll();
    setPreview(null);
    await refresh();
    setBusy(false);
  }

  const previewUrl = useObjectURL(preview?.blob || null);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Gallery</h2>
        <div className="row">
          <button className="btn" onClick={refresh} disabled={busy}>Refresh</button>
          <button className="btn" onClick={clearGallery} disabled={busy || items.length === 0}>Clear All</button>
        </div>
      </div>

      <div style={{ height: 16 }} />

      {items.length === 0 ? (
        <div className="muted">No images stored yet. Save some from the Upload tab.</div>
      ) : (
        <div className="grid">
          {items.map(meta => (
            <div key={meta.id} className="card" style={{ padding: 12 }}>
              <ImageThumb id={meta.id} onClick={() => openItem(meta)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span className="muted" title={new Date(meta.createdAt).toLocaleString()}>
                  {new Date(meta.createdAt).toLocaleDateString()}
                </span>
                <button className="btn" onClick={() => deleteItem(meta.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Preview</h3>
          <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid #293349' }} />
        </div>
      )}
    </div>
  );
}
