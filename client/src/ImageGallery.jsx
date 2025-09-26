import React, { useState, useEffect } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

export default function ImageGallery({ token }) {
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const fetchImages = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images/generated`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setImages(data);
      } else {
        throw new Error('Failed to fetch images');
      }
    } catch (error) {
      console.error('Failed to fetch images:', error);
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchImages();
    }
  }, [token]);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Generated Images</h2>
        <button className="btn" onClick={fetchImages} disabled={busy}>Refresh</button>
      </div>
      <div style={{ height: 16 }} />
      {busy ? (
        <p>Loading...</p>
      ) : images.length === 0 ? (
        <div className="muted">No images generated yet.</div>
      ) : (
        <div className="grid">
          {images.map(image => (
            <div key={image.id} className="card" style={{ padding: 12 }}>
              <img 
                src={`data:image/jpeg;base64,${image.data}`}
                className="thumb"
                alt="Generated content"
                onClick={() => setPreview(`data:image/jpeg;base64,${image.data}`)}
                style={{ cursor: 'pointer' }}
              />
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <img src={preview} alt="Preview" className="modal-content" />
          <button className="modal-close" onClick={() => setPreview(null)}>&times;</button>
        </div>
      )}
    </div>
  );
}
