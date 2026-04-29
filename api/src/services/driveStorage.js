import { google } from "googleapis";
import { Readable } from "stream";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

let driveClientPromise = null;

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
  }
}

function getFolderId() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  }
  return folderId;
}

async function getDriveClient() {
  if (!driveClientPromise) {
    driveClientPromise = (async () => {
      const credentials = getCredentials();
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: SCOPES,
      });
      const authClient = await auth.getClient();
      return google.drive({ version: "v3", auth: authClient });
    })().catch((err) => {
      driveClientPromise = null;
      throw err;
    });
  }
  return driveClientPromise;
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export async function uploadBuffer({ buffer, filename, mimeType }) {
  const drive = await getDriveClient();
  const folderId = getFolderId();
  const safeName = (filename || `upload-${Date.now()}`).slice(0, 200);
  const safeMime = mimeType || "application/octet-stream";

  const response = await drive.files.create({
    requestBody: {
      name: safeName,
      parents: [folderId],
      mimeType: safeMime,
    },
    media: {
      mimeType: safeMime,
      body: bufferToStream(Buffer.from(buffer)),
    },
    fields: "id, name, mimeType, size",
    supportsAllDrives: true,
  });

  return {
    drive_file_id: response.data.id,
    filename: response.data.name || safeName,
    mime_type: response.data.mimeType || safeMime,
    size: Number(response.data.size) || Buffer.from(buffer).length,
  };
}

export async function downloadBuffer(driveFileId) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient();
  const response = await drive.files.get(
    {
      fileId: driveFileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data);
}

export async function downloadRange(driveFileId, start, end) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient();
  const headers = {};
  if (Number.isInteger(start) || Number.isInteger(end)) {
    const startStr = Number.isInteger(start) ? String(start) : "0";
    const endStr = Number.isInteger(end) ? String(end) : "";
    headers.Range = `bytes=${startStr}-${endStr}`;
  }
  const response = await drive.files.get(
    {
      fileId: driveFileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer", headers }
  );
  return Buffer.from(response.data);
}

export async function getFileMetadata(driveFileId) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient();
  const response = await drive.files.get({
    fileId: driveFileId,
    fields: "id, name, mimeType, size",
    supportsAllDrives: true,
  });
  return {
    drive_file_id: response.data.id,
    filename: response.data.name || "",
    mime_type: response.data.mimeType || "application/octet-stream",
    size: Number(response.data.size) || 0,
  };
}

export async function deleteFile(driveFileId) {
  if (!driveFileId) {
    return;
  }
  try {
    const drive = await getDriveClient();
    await drive.files.delete({
      fileId: driveFileId,
      supportsAllDrives: true,
    });
  } catch (err) {
    const status = err?.code || err?.response?.status;
    if (status === 404) {
      return;
    }
    throw err;
  }
}

export async function deleteManyFiles(driveFileIds) {
  const ids = (driveFileIds || []).filter(Boolean);
  if (ids.length === 0) {
    return;
  }
  await Promise.all(
    ids.map((id) =>
      deleteFile(id).catch((err) => {
        console.warn(`[WARN] Failed to delete Drive file ${id}: ${err?.message || err}`);
      })
    )
  );
}
