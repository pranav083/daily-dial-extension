/**
 * Google Drive backup — chrome.identity + Drive's appDataFolder.
 *
 * appDataFolder is Google's own sandboxed per-app storage space: invisible
 * in the user's normal Drive UI, and inaccessible to any other app (even one
 * with full Drive access can't see it). This module's fetch() calls to
 * www.googleapis.com go out like any other cross-origin request from an
 * extension page — Chrome doesn't grant them special access — relying on
 * Drive's API allowing CORS for bearer-token requests, which is why no
 * host_permissions entry is needed or declared for this.
 *
 * Everything here is a thin, impure wrapper: the actual request shaping
 * (URLs, the multipart body) lives in lib.js as plain testable functions.
 */

import {
  driveCreateMultipartBody,
  driveDeleteUrl,
  driveDownloadUrl,
  driveListUrl,
  driveParseListResponse,
  driveUploadUrl,
} from "./lib.js";

/** Wrapped in a Promise rather than relying on the newer chrome.identity
 *  promise sugar, which shipped later and less consistently across Chrome
 *  versions than the callback form. `interactive:false` resolves silently
 *  with a cached token, or rejects with no prompt if there isn't one. */
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) reject(new Error(err?.message || "No Google account token available."));
      else resolve(token);
    });
  });
}

async function driveFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}

/** Prompts for Google sign-in/consent the first time; silent after, as long
 *  as the cached token stays valid. */
export const driveConnect = () => getAuthToken(true);

/** Revokes the token with Google and clears Chrome's cache of it, so the
 *  next connect prompts for consent again. Never throws — disconnecting
 *  should always succeed from the user's point of view even if there was
 *  nothing to revoke. */
export async function driveDisconnect() {
  const token = await getAuthToken(false).catch(() => null);
  if (!token) return;
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
  await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

/** @returns {{id:string, modifiedTime:string|null}|null} */
export async function driveFindBackupFile(token) {
  const res = await driveFetch(driveListUrl(), token);
  return driveParseListResponse(await res.json());
}

/** Updates the existing backup file in place, or creates it on the very
 *  first backup from this account. @returns {string} the file id. */
export async function driveUploadBackup(token, existingFileId, jsonText) {
  if (existingFileId) {
    await driveFetch(driveUploadUrl(existingFileId), token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: jsonText,
    });
    return existingFileId;
  }
  const boundary = `dailydial-${Date.now()}`;
  const res = await driveFetch(driveUploadUrl(null), token, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: driveCreateMultipartBody(jsonText, boundary),
  });
  const created = await res.json();
  return created.id;
}

export async function driveDownloadBackup(token, fileId) {
  const res = await driveFetch(driveDownloadUrl(fileId), token);
  return res.text();
}

/** Permanently deletes the backup file from the user's Drive. Disconnecting
 *  alone only revokes this app's access — it doesn't touch the file, since
 *  appDataFolder content isn't visible or manageable from the regular Drive
 *  UI at all. This is the only way a user can actually remove it. */
export async function driveDeleteBackup(token, fileId) {
  await driveFetch(driveDeleteUrl(fileId), token, { method: "DELETE" });
}
