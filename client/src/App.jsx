import React, { useState, useEffect } from 'react';
import ImageGallery from './ImageGallery';
import ImageUpload from './ImageUpload';
import ModelUpload from './ModelUpload';
import Login from './Login'; // Assuming you will create this component
import './styles.css';

function TabButton({ active, onClick, children }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>;
}

export default function App() {
  const [tab, setTab] = useState('model');
  const [token, setToken] = useState(localStorage.getItem('token'));

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  if (!token) {
    return <Login setToken={setToken} />;
  }

  return (
    <div className="container">
      <div className="header">
        <button onClick={handleLogout} className="logout-button">Logout</button>
      </div>
      <div className="tabs" style={{ marginTop: 16 }}>
        <TabButton active={tab === 'model'} onClick={() => setTab('model')}>Model Upload</TabButton>
        <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>Swap</TabButton>
        <TabButton active={tab === 'gallery'} onClick={() => setTab('gallery')}>Gallery</TabButton>
      </div>
      {tab === 'model' && <ModelUpload token={token} />}
      {tab === 'upload' && <ImageUpload token={token} />}
      {tab === 'gallery' && <ImageGallery token={token} />}
      <div style={{ marginTop: 16 }} className="muted">
        A modern, database-driven face swapping application.
      </div>
    </div>
  );
}
