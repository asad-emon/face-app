
import React, { useState } from 'react';
import Authentication from './Authentication';
import ImageGallery from './ImageGallery';
import ImageUpload from './ImageUpload';
import { AuthProvider } from './AuthContext';
import './styles.css';

function TabButton({ active, onClick, children }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>;
}

export default function App() {
  const [tab, setTab] = useState('upload');

  return (
    <AuthProvider>
      <div className="container">
        <Authentication>
          <div className="tabs" style={{ marginTop: 16 }}>
            <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>Upload</TabButton>
            <TabButton active={tab === 'gallery'} onClick={() => setTab('gallery')}>Gallery</TabButton>
          </div>
          {tab === 'upload' ? <ImageUpload /> : <ImageGallery />}
        </Authentication>
        <div style={{ marginTop: 16 }} className="muted">
          A standalone React web app using Vite and IndexedDB for on-device storage.
        </div>
      </div>
    </AuthProvider>
  );
}
