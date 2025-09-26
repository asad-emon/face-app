import React, { useState, useEffect } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

export default function ImageUpload({ token }) {
  const [modelFiles, setModelFiles] = useState([]);
  const [modelName, setModelName] = useState('');
  const [targetImageFile, setTargetImageFile] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultImage, setResultImage] = useState(null);

  useEffect(() => {
    fetchModels();
  }, [token]);

  const fetchModels = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setModels(data);
        if (data.length > 0) {
          setSelectedModelId(data[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  const handleGenerateModel = async () => {
    if (modelFiles.length === 0 || !modelName) {
      alert('Please select files and provide a name for the model.');
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.append('name', modelName);
    modelFiles.forEach(file => formData.append('file', file));

    try {
      const response = await fetch(`${apiBaseUrl}/models/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (response.ok) {
        alert('Model generated successfully!');
        fetchModels(); // Refresh the list of models
        setModelFiles([]);
        setModelName('');
      } else {
        throw new Error('Model generation failed');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSwap = async () => {
    if (!selectedModelId || !targetImageFile) {
      alert('Please select a model and a target image.');
      return;
    }
    setBusy(true);
    setResultImage(null);

    try {
      // Step 1: Upload the target image
      const imageFormData = new FormData();
      imageFormData.append('file', targetImageFile);
      const imgResponse = await fetch(`${apiBaseUrl}/images`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: imageFormData,
      });

      if (!imgResponse.ok) throw new Error('Failed to upload image');
      const imgData = await imgResponse.json();
      const imageId = imgData.id;

      // Step 2: Perform the swap
      const swapResponse = await fetch(`${apiBaseUrl}/swap/?model_id=${selectedModelId}&image_id=${imageId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!swapResponse.ok) throw new Error('Face swap failed');
      const swapData = await swapResponse.json();
      setResultImage(swapData.result);

    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Section for generating a new model */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Create a New Face Model</h2>
        <input
          type="text"
          placeholder="Model Name"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
        />
        <input
          type="file"
          onChange={(e) => setModelFiles(Array.from(e.target.files))}
        />
        <button onClick={handleGenerateModel} disabled={busy}>Generate Model</button>
      </div>

      {/* Section for performing the face swap */}
      <div className="card">
        <h2>Perform Face Swap</h2>
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          disabled={models.length === 0}
        >
          <option value="" disabled>Select a model</option>
          {models.map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setTargetImageFile(e.target.files[0])}
        />
        <button onClick={handleSwap} disabled={busy || !selectedModelId || !targetImageFile}>Swap Faces</button>
      </div>

      {busy && <p>Processing...</p>}

      {resultImage && (
        <div className="card result-container">
          <h2>Result</h2>
          <img src={resultImage} alt="Processed result" style={{ maxWidth: '100%', marginTop: 16 }} />
        </div>
      )}
    </div>
  );
}
