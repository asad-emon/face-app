import {
    getStorage as getFirebaseStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    listAll,
    deleteObject
} from "firebase/storage";
import {
    saveFile as saveFileLocal,
    getFiles as getFilesLocal,
    deleteFile as deleteFileLocal
} from './localStore';
import { app, auth } from './firebase';

const useLocalStorage = import.meta.env.VITE_USE_LOCAL_STORAGE === '1';

// Initialize Firebase Storage only if we are using it
const storage = !useLocalStorage ? getFirebaseStorage(app) : null;

export async function uploadImage(file) {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    if (useLocalStorage) {
        return saveFileLocal(user.uid, file);
    } else {
        const storageRef = ref(storage, `images/${user.uid}/${file.name}`);
        await uploadBytes(storageRef, file);
        return getDownloadURL(storageRef);
    }
}

export async function listImages() {
    const user = auth.currentUser;
    if (!user) return [];

    if (useLocalStorage) {
        return getFilesLocal(user.uid);
    } else {
        const listRef = ref(storage, `images/${user.uid}`);
        const res = await listAll(listRef);
        const imageList = await Promise.all(
            res.items.map(async (itemRef) => {
                const url = await getDownloadURL(itemRef);
                return {
                    url,
                    fullPath: itemRef.fullPath
                };
            })
        );
        return imageList;
    }
}

export async function deleteImage(imagePath) {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    if (useLocalStorage) {
        // For local storage, the `imagePath` is the numeric ID.
        return deleteFileLocal(user.uid, imagePath);
    } else {
        const imageRef = ref(storage, imagePath);
        return deleteObject(imageRef);
    }
}
