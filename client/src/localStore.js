// src/localStore.js

const DB_NAME = 'image-store';
const STORE_NAME = 'images';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Use `id` as the keyPath and auto-increment it.
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // Create an index on userId to easily query images for a specific user.
        store.createIndex('userId_idx', 'userId', { unique: false });
      }
    };
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    request.onerror = event => {
      console.error("IndexedDB error:", event.target.error);
      reject(event.target.error);
    };
  });
}

export async function saveFile(userId, file) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Store the raw file object along with the userId.
    // IndexedDB can handle File objects directly in modern browsers.
    const fileData = {
        userId: userId,
        file: file,
        name: file.name,
    };

    return new Promise((resolve, reject) => {
        const request = store.add(fileData);
        request.onsuccess = (event) => {
            resolve(event.target.result); // Returns the new key (id)
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function getFiles(userId) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('userId_idx');
    const getAllRequest = index.getAll(userId);

    return new Promise((resolve, reject) => {
        getAllRequest.onsuccess = () => {
            // Map the retrieved data to the format the gallery expects
            const userFiles = getAllRequest.result.map(fileData => ({
                url: URL.createObjectURL(fileData.file),
                id: fileData.id,
                name: fileData.name,
                // Provide a 'fullPath' equivalent for compatibility with Firebase version
                fullPath: fileData.id 
            }));
            resolve(userFiles);
        };
        getAllRequest.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function deleteFile(userId, fileId) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // We must ensure the file belongs to the user before deleting.
    const getRequest = store.get(fileId);

    return new Promise((resolve, reject) => {
        getRequest.onsuccess = () => {
            if (getRequest.result && getRequest.result.userId === userId) {
                const deleteRequest = store.delete(fileId);
                deleteRequest.onsuccess = () => resolve();
                deleteRequest.onerror = (e) => reject(e.target.error);
            } else {
                reject("File not found or permission denied.");
            }
        };
        getRequest.onerror = (e) => reject(e.target.error);
    });
}

export async function clearFiles(userId) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('userId_idx');
    const cursorRequest = index.openCursor(IDBKeyRange.only(userId));

    return new Promise((resolve, reject) => {
        cursorRequest.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve(); // End of cursor
            }
        };
        cursorRequest.onerror = event => {
            reject(event.target.error);
        };
    });
}
