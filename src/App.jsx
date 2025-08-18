
import React, { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { saveImage, listImages, getImageBlob, removeImage, clearAll } from './storage.js'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

function TabButton({ active, onClick, children }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>
}

function useObjectURL(blob) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}

function UploadTab() {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [inputUrl, setInputUrl] = useState('')

  const fileRef = useRef()

  async function onPickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelected(file)
  }

  async function onPasteFromClipboard() {
    try {
      if ('clipboard' in navigator && 'read' in navigator.clipboard) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type)
              setSelected(blob)
              return
            }
          }
        }
        alert('No image in clipboard. Copy an image and try again.')
      } else {
        alert('Clipboard image read not supported in this browser.')
      }
    } catch (e) {
      alert('Clipboard error: ' + e.message)
    }
  }

  async function onLoadFromUrl() {
    if (!inputUrl) return
    try {
      setBusy(true)
      const res = await fetch(inputUrl)
      const blob = await res.blob()
      setSelected(blob)
    } catch (e) {
      alert('Failed to fetch image: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  async function onUpload() {
    if (!selected) return
    await getBase64(selected) // `file` your img file
      .then(res => uploadImage(res)) // `res` base64 of img file
      .catch(err => console.log(err))
  }

  async function getBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        resolve(reader.result)
      }
      reader.onerror = reject
    })
  }

  function base64ToBlob(base64, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(base64);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  }

  const uploadImage = async (base64Image) => {
    setBusy(true);
    try {
      const requestObj = {
        method: 'POST',
        body: JSON.stringify({ image_base64: base64Image }),
        headers: {
          'Content-Type': 'application/json',
        }
      };

      const response = await fetch(`${apiBaseUrl}/api/proxy`, requestObj);

      if (response.ok) {
        const responseData = await response.json();
        if (responseData.result) {
          // Handle base64 encoded image
          const dataUrl = responseData.result;

          const [meta, base64Data] = dataUrl.split(',');
          const mime = meta.match(/:(.*?);/)?.[1] || 'image/png';

          const imgBlob = base64ToBlob(base64Data, mime);

          onSaveToGallery(imgBlob);
          alert('Success', 'Image uploaded successfully!');
        }
      } else {
        alert('Error, Failed to upload image');
      }
    } catch (error) {
      console.error('Network error:', error);
      alert('Error, Network error occurred');
    } finally {
      setBusy(false);
    }
  };

  async function onSaveToGallery(fileOrBlob) {
    if (!fileOrBlob) return
    try {
      setBusy(true)
      const name = typeof fileOrBlob.name === 'string' ? fileOrBlob.name : 'pasted-image.png'
      await saveImage(fileOrBlob, name)
      setSelected(null)
      alert('Saved to gallery. Open the Gallery tab to view.')
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const previewUrl = useObjectURL(selected)

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: '0 0 8px' }}>Upload</h2>
          <div className="muted">Pick a file, paste an image, or load from URL.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()}>Choose File</button>
          <button className="btn" onClick={onPasteFromClipboard}>Paste Image</button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />

      <div style={{ height: 12 }} />

      <div className="row">
        <input type="text" placeholder="https://example.com/image.jpg" value={inputUrl} onChange={e => setInputUrl(e.target.value)} />
        <button className="btn" onClick={onLoadFromUrl} disabled={busy || !inputUrl}>Load URL</button>
      </div>

      <div style={{ height: 16 }} />

      {selected ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <img src={previewUrl} className="thumb" alt="preview" />
          <div className="row">
            <button className="btn" onClick={onUpload} disabled={busy}>Save to Gallery</button>
            <button className="btn" onClick={() => setSelected(null)} disabled={busy}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="muted">No image selected yet.</div>
      )}
    </div>
  )
}

function GalleryTab() {
  const [items, setItems] = useState([])
  const [preview, setPreview] = useState(null) // { id, blob }
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const list = await listImages()
    setItems(list)
  }

  useEffect(() => { refresh() }, [])

  async function openItem(meta) {
    const blob = await getImageBlob(meta.id)
    setPreview({ id: meta.id, blob })
  }

  async function deleteItem(id) {
    if (!confirm('Delete this image?')) return
    await removeImage(id)
    if (preview?.id === id) setPreview(null)
    refresh()
  }

  async function clearGallery() {
    if (!confirm('Delete ALL images?')) return
    setBusy(true)
    await clearAll()
    setPreview(null)
    await refresh()
    setBusy(false)
  }

  const previewUrl = useObjectURL(preview?.blob || null)

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
  )
}

function ImageThumb({ id, onClick }) {
  const [blob, setBlob] = useState(null)
  useEffect(() => { (async () => { setBlob(await getImageBlob(id)) })() }, [id])
  const url = useObjectURL(blob)
  return <img src={url || ''} className="thumb" alt="" onClick={onClick} style={{ cursor: 'pointer' }} />
}

export default function App() {
  const [tab, setTab] = useState('upload')
  return (
    <div className="container">
      <div className="tabs">
        <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>Upload</TabButton>
        <TabButton active={tab === 'gallery'} onClick={() => setTab('gallery')}>Gallery</TabButton>
      </div>
      {tab === 'upload' ? <UploadTab /> : <GalleryTab />}
      <div style={{ marginTop: 16 }} className="muted">
        Converted from Expo/React Native to a standalone React web app using Vite and IndexedDB for on-device storage.
      </div>
    </div>
  )
}
