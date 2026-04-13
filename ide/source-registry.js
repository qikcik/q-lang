// ide/source-registry.js — global registry of Source objects and their views
//
// Replaces ide/macro-view-ref.js.  That module existed solely as a circular-
// import breaker between main.js and crossSelection.js.  This module solves
// the same problem more cleanly: it is a neutral data store with no imports
// from any other IDE file, so it can be imported by both main.js and
// crossSelection.js without creating a cycle.
//
// A Source is any self-contained text buffer an ASTNode might be positioned
// within for IDE rendering.  Currently two kinds exist:
//   'user'  — the main editor buffer           (id = 'main')
//   'macro' — the expanded body of a call-site  (id = 'macro:name:fileId:offset')
//
// When a Source becomes visible in a <qlang-source-view>, the view is
// registered alongside the Source so that highlight calls can route to the
// correct SourceView without any global singleton.

const _sources = new Map();   // id → Source
const _views   = new Map();   // id → QLangSourceView element

/**
 * Register a Source/SourceBuffer (and optionally its view).
 * Overwrites previous entry for the same id (safe for re-register on recompile).
 */
export function registerSource(source, view = null) {
  if (!source?.id) return;
  _sources.set(source.id, source);
  if (view) _views.set(source.id, view);
}

/**
 * Update the view for an already-registered source.
 * Called when the same source is re-mounted in a new SourceView element.
 */
export function registerView(sourceId, view) {
  _views.set(sourceId, view);
}

/** Unregister a source and its view (e.g. when a macro panel closes). */
export function unregisterSource(id) {
  _sources.delete(id);
  _views.delete(id);
}

/** Returns the Source for the given id, or null. */
export function getSource(id) { return _sources.get(id) ?? null; }

/** Returns the QLangSourceView element for the given id, or null. */
export function getView(id)   { return _views.get(id)   ?? null; }

/** Returns all registered source ids. */
export function getAllSourceIds() { return [..._views.keys()]; }

/**
 * Highlight a range in the SourceView associated with sourceId.
 * No-ops silently when no view is registered (e.g. macro panel closed).
 */
export function highlightInSource(sourceId, start, end) {
  _views.get(sourceId)?.highlightRange(start, end);
}

/** Clear the highlight overlay of the SourceView for the given sourceId. */
export function clearSourceViewHighlight(sourceId) {
  _views.get(sourceId)?.clearHighlight();
}
