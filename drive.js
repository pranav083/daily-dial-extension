/**
 * Google Drive backup — chrome.identity's launchWebAuthFlow + Drive's
 * appDataFolder.
 *
 * Deliberately NOT chrome.identity.getAuthToken(): that mechanism ties the
 * OAuth client to Google Cloud Console's "Chrome Extension" application
 * type, keyed to one exact extension ID, and in practice it can fail with a
 * bare `400 invalid_request` / "Custom URI scheme is not supported" error
 * that has nothing to do with actual misconfiguration — a known rough edge
 * of that mechanism under Google's current console. launchWebAuthFlow
 * instead speaks Google's plain OAuth endpoint directly, through a normal
 * "Web application"-type client with `https://<extension-id>.chromiumapp.org/`
 * registered as an authorized redirect URI — an ordinary OAuth implicit
 * flow with no extension-specific client type involved at all.
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

/** From the "Web application"-type OAuth client — see docs/GOOGLE_DRIVE_SETUP.md.
 *  Not a secret: it's embedded in every copy of the extension, the same way
 *  any public OAuth client id is; the redirect-URI allowlist on Google's side
 *  is what actually gates who can use it. */
const CLIENT_ID = "752491211125-sh205mkhfofckied2cc4ptpjnmbjdhqb.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

/** Held only in memory — cleared on every service worker/page restart, which
 *  just means the next call re-authenticates. That's silent and instant as
 *  long as the browser still has an active Google session and access hasn't
 *  been revoked, since `interactive:false` is always tried first. */
let cachedToken = null;

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "token",
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPE,
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** launchWebAuthFlow opens a real (or, non-interactively, invisible) browser
 *  window at Google's auth URL and resolves with wherever it got redirected
 *  to once Google sends the browser back to our chromiumapp.org URI — the
 *  access token rides in that URL's fragment, per the OAuth implicit flow. */
function launchAuthFlow(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: buildAuthUrl(), interactive }, (redirectUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !redirectUrl) {
        reject(new Error(err?.message || "No response from Google."));
        return;
      }
      const params = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
      const token = params.get("access_token");
      const expiresIn = Number(params.get("expires_in")) || 3600;
      if (!token) {
        reject(new Error("Google did not return an access token."));
        return;
      }
      cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
      resolve(token);
    });
  });
}

/** Our own token cache, since launchWebAuthFlow (unlike getAuthToken) has no
 *  built-in one. `interactive:false` is tried first even for an interactive
 *  request, so a still-valid browser session never shows a consent screen
 *  it doesn't need to. */
async function getAuthToken(interactive) {
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) return cachedToken.token;
  try {
    return await launchAuthFlow(false);
  } catch {
    if (!interactive) throw new Error("No Google account token available.");
    return launchAuthFlow(true);
  }
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

/** Revokes the token with Google and clears our own cache of it, so the next
 *  connect prompts for consent again. Never throws — disconnecting should
 *  always succeed from the user's point of view even if there was nothing
 *  to revoke. */
export async function driveDisconnect() {
  const token = cachedToken?.token ?? (await getAuthToken(false).catch(() => null));
  cachedToken = null;
  if (!token) return;
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
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
