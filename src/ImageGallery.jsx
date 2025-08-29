import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from './AuthContext';
import { listImages, deleteImage } from './imageStore'; // Using the new unified image store
import { clearFiles as clearLocalFiles } from './localStore'; // For clearing the gallery
import './styles.css';

const useLocalStorage = import.meta.env.VITE_USE_LOCAL_STORAGE === '1';

export default function ImageGallery() {
  const { user } = useContext(AuthContext);
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!user) {
      setItems([]);
      return;
    }
    setBusy(true);
    try {
      const imageList = await listImages();
      setItems(imageList);
    } catch (e) {
      console.error("Failed to fetch images", e);
      alert("Failed to fetch images: " + e.message);
    }
    setBusy(false);
  }

  useEffect(() => {
    refresh();
  }, [user]);

  async function deleteItem(item) {
    if (!confirm('Delete this image?')) return;
    try {
        // The `id` property is used for IndexedDB, while `fullPath` is for Firebase.
        const idToDelete = useLocalStorage ? item.id : item.fullPath;
        await deleteImage(idToDelete);
        if (preview === item.url) setPreview(null);
        refresh();
    } catch (e) {
        console.error("Failed to delete image", e);
        alert("Failed to delete image: " + e.message);
    }
  }

  async function clearGallery() {
    if (!confirm('Delete ALL images?')) return;
    setBusy(true);
    try {
        if (useLocalStorage) {
            await clearLocalFiles(user.uid);
        } else {
            // For Firebase, delete each item individually.
            await Promise.all(items.map(item => deleteImage(item.fullPath)));
        }
        setPreview(null);
        await refresh();
    } catch (e) {
        console.error("Failed to clear gallery", e);
        alert("Failed to clear gallery: " + e.message);
    }
    setBusy(false);
  }

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
          {items.map(item => (
            <div key={item.url} className="card" style={{ padding: 12 }}>
              <img src={item.url} className="thumb" alt="" onClick={() => setPreview(item.url)} style={{ cursor: 'pointer' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <button className="btn" onClick={() => deleteItem(item)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <img src={preview} alt="preview" className="modal-content" />
          <button className="modal-close" onClick={() => setPreview(null)}>&times;</button>
        </div>
      )}
    </div>
  );
}
