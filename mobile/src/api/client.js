// REST client for the HiveFit API.
//
// The token is held in SecureStore on device. SecureStore has no web
// implementation, so the web build falls back to localStorage — Expo's web
// target is how the team demos this on a laptop.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'hivefit.token';

export const API_BASE =
  Constants.expoConfig?.extra?.apiBaseUrl ?? 'http://localhost:4000/api';

const webStore = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

export async function getToken() {
  if (Platform.OS === 'web') return webStore.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token) {
  if (Platform.OS === 'web') return webStore.setItem(TOKEN_KEY, token);
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  if (Platform.OS === 'web') return webStore.removeItem(TOKEN_KEY);
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, auth = true, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // A fetch rejection here is nearly always the API not running, or a
    // device pointing at localhost instead of the host machine's LAN address.
    throw new ApiError(
      0,
      `Cannot reach the HiveFit API at ${API_BASE}. Is the server running?`,
      err.message
    );
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? `Request failed (${response.status})`, data?.details);
  }
  return data;
}

export const api = {
  // 1.0 Authentication
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => request('/auth/me'),

  // 2.0 Resumes
  listResumes: () => request('/resumes'),
  getResume: (id) => request(`/resumes/${id}`),
  createResumeFromText: (title, text) => request('/resumes', { method: 'POST', body: { title, text } }),
  uploadResume: (formData) => request('/resumes', { method: 'POST', body: formData, isForm: true }),
  deleteResume: (id) => request(`/resumes/${id}`, { method: 'DELETE' }),

  // 2.0 Analysis
  analyze: (payload) => request('/analyses', { method: 'POST', body: payload }),
  listAnalyses: () => request('/analyses'),
  getAnalysis: (id) => request(`/analyses/${id}`),

  // 3.0 Suggestions
  suggest: (payload) => request('/suggestions', { method: 'POST', body: payload }),
  decideSuggestion: (id, accepted) => request(`/suggestions/${id}`, { method: 'PATCH', body: { accepted } }),

  // 4.0 Job search
  searchJobs: (query, location) =>
    request(`/jobs/search?query=${encodeURIComponent(query ?? '')}&location=${encodeURIComponent(location ?? '')}`),

  // 5.0 Application tracker
  listSavedJobs: (status) => request(`/saved-jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  saveJob: (jobPostingId, status = 'Saved') =>
    request('/saved-jobs', { method: 'POST', body: { jobPostingId, status } }),
  updateSavedJob: (id, payload) => request(`/saved-jobs/${id}`, { method: 'PATCH', body: payload }),
  deleteSavedJob: (id) => request(`/saved-jobs/${id}`, { method: 'DELETE' }),

  health: () => request('/health', { auth: false }),
};
