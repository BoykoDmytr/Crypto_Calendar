// src/utils/anon.js
export function getAnonId() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return '00000000-0000-0000-0000-000000000000';
  }
  const existing = localStorage.getItem('anon_id');
  if (existing) return existing;
  const uuid = crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  localStorage.setItem('anon_id', uuid);
  return uuid;
}
