import { google } from "googleapis";
import { Readable } from "stream";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
} from "../config.js";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function getOAuthConfig() {
  const clientId = GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required"
    );
  }
  return { clientId, clientSecret, refreshToken };
}

function getFolderId() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  }
  return folderId;
}

function getRefreshToken(authUser) {
  const { refreshToken } = getOAuthConfig();
  const userRefreshToken = authUser?.google_refresh_token;
  if (userRefreshToken) {
    return userRefreshToken;
  }
  if (refreshToken) {
    return refreshToken;
  }
  throw new Error("Google Drive is not connected for this user");
}

async function getDriveClient(authUser) {
  const { clientId, clientSecret } = getOAuthConfig();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({
    refresh_token: getRefreshToken(authUser),
    scope: SCOPES.join(" "),
  });
  return google.drive({ version: "v3", auth: oauth2Client });
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export async function uploadBuffer({ buffer, filename, mimeType, authUser }) {
  const drive = await getDriveClient(authUser);
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

export async function downloadBuffer(driveFileId, authUser) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient(authUser);
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

export async function downloadRange(driveFileId, start, end, authUser) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient(authUser);
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

export async function getFileMetadata(driveFileId, authUser) {
  if (!driveFileId) {
    throw new Error("driveFileId is required");
  }
  const drive = await getDriveClient(authUser);
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

export async function deleteFile(driveFileId, authUser) {
  if (!driveFileId) {
    return;
  }
  try {
    const drive = await getDriveClient(authUser);
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

export async function deleteManyFiles(driveFileIds, authUser) {
  const ids = (driveFileIds || []).filter(Boolean);
  if (ids.length === 0) {
    return;
  }
  await Promise.all(
    ids.map((id) =>
      deleteFile(id, authUser).catch((err) => {
        console.warn(`[WARN] Failed to delete Drive file ${id}: ${err?.message || err}`);
      })
    )
  );
}
