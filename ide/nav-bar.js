// ide/nav-bar.js — Floating navigation bar for canonical-ref chain traversal
//
// Shows a small pill at the bottom-center of the screen: "◀ prev  1 / 3  ▶ next  ✕"
// Driven by navigate.js — it calls showNavBar / updateNavBar / hideNavBar.

import { navPrev, navNext, clearNav } from './navigate.js';

const bar      = document.getElementById('nav-bar');
const prevBtn  = document.getElementById('nav-prev');
const nextBtn  = document.getElementById('nav-next');
const label    = document.getElementById('nav-label');
const closeBtn = document.getElementById('nav-close');

prevBtn .addEventListener('click', navPrev);
nextBtn .addEventListener('click', navNext);
closeBtn.addEventListener('click', clearNav);

/**
 * Show the nav-bar for the given cursor.
 * @param {{ segments: any[], activeIdx: number }} cursor
 */
export function showNavBar(cursor) {
  _render(cursor);
  bar.classList.add('visible');
}

/**
 * Re-render the label and button states (call after navNext / navPrev).
 * @param {{ segments: any[], activeIdx: number }} cursor
 */
export function updateNavBar(cursor) {
  if (!cursor) { hideNavBar(); return; }
  _render(cursor);
}

export function hideNavBar() {
  bar.classList.remove('visible');
}

function _render(cursor) {
  const { segments, activeIdx } = cursor;
  const n = segments.length;
  const seg = segments[activeIdx];
  const segLabel = seg?.label ?? seg?.sourceId ?? '';
  label.textContent = `${segLabel}  (${activeIdx + 1}/${n})`;
  prevBtn.disabled = activeIdx <= 0;
  nextBtn.disabled = activeIdx >= n - 1;
}
