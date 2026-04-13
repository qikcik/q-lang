// ide/layout.js — Column resize, row resize, drag & drop between columns.
//
// Extracted from index.html inline <script>.
// Imported from main.js for side effect (sets up event listeners on <main>).
//
// Depends on: qlang-pane.js already registered (for .sub-pane class).

const main = document.querySelector('main');

// ── Column resize ────────────────────────────────────────────────────────────

main.querySelectorAll('.col-handle').forEach(handle => {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const kids = [...main.children];
    const hi = kids.indexOf(handle);
    const leftPane  = kids[hi - 1];
    const rightPane = kids[hi + 1];
    if (!leftPane || !rightPane) return;

    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('resizing');

    const startX  = e.clientX;
    const panes = [...main.querySelectorAll(':scope > .pane')];
    const startWidths = panes.map(p => p.getBoundingClientRect().width);
    const li = panes.indexOf(leftPane);
    const ri = panes.indexOf(rightPane);
    const total = startWidths[li] + startWidths[ri];

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const newL = Math.max(80, Math.min(total - 80, startWidths[li] + dx));
      const widths = [...startWidths];
      widths[li] = newL;
      widths[ri] = total - newL;
      main.style.gridTemplateColumns = widths.map(w => w + 'px').join(' 4px ');
    }
    function onUp() {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

// ── Row resize (sub-pane height) ─────────────────────────────────────────────

export function initRowHandle(handle) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const col = handle.closest('.pane');
    const kids = [...col.children];
    const hi = kids.indexOf(handle);
    const topPane = kids[hi - 1];
    const botPane = kids[hi + 1];
    if (!topPane || !botPane || !topPane.classList.contains('sub-pane') || !botPane.classList.contains('sub-pane')) return;

    handle.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('resizing');

    const startY  = e.clientY;
    const startTH = topPane.getBoundingClientRect().height;
    const startBH = botPane.getBoundingClientRect().height;
    const total   = startTH + startBH;

    function onMove(ev) {
      const dy = ev.clientY - startY;
      const newT = Math.max(30, Math.min(total - 30, startTH + dy));
      const newB = total - newT;
      topPane.style.flex = '0 0 ' + newT + 'px';
      botPane.style.flex = '0 0 ' + newB + 'px';
    }
    function onUp() {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
main.querySelectorAll('.row-handle').forEach(initRowHandle);

// ── Drag & drop sub-panes between columns ────────────────────────────────────

let draggedPane = null;

main.addEventListener('dragstart', e => {
  const label = e.target.closest('.pane-label[draggable="true"]');
  if (!label) return;
  draggedPane = label.closest('.sub-pane');
  if (!draggedPane) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  requestAnimationFrame(() => draggedPane.classList.add('dragging'));
});

main.addEventListener('dragend', () => {
  if (draggedPane) draggedPane.classList.remove('dragging');
  draggedPane = null;
  main.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
});

main.addEventListener('dragover', e => {
  if (!draggedPane) return;
  const target = e.target.closest('.sub-pane');
  if (!target || target === draggedPane) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  main.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  target.classList.add('drag-over');
});

main.addEventListener('dragleave', e => {
  const target = e.target.closest('.sub-pane');
  if (target) target.classList.remove('drag-over');
});

main.addEventListener('drop', e => {
  e.preventDefault();
  main.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (!draggedPane) return;
  const target = e.target.closest('.sub-pane');
  if (!target || target === draggedPane) return;

  const oldCol = draggedPane.closest('.pane');
  const targetCol = target.closest('.pane');

  // Remove dragged pane and its adjacent row-handle
  const prev = draggedPane.previousElementSibling;
  const next = draggedPane.nextElementSibling;
  if (prev && prev.classList.contains('row-handle')) prev.remove();
  else if (next && next.classList.contains('row-handle')) next.remove();
  draggedPane.remove();

  // Insert before target, adding a row-handle between them
  const rh = document.createElement('div');
  rh.className = 'row-handle';
  initRowHandle(rh);
  targetCol.insertBefore(draggedPane, target);
  targetCol.insertBefore(rh, target);

  // Reset flex sizing for clean layout
  draggedPane.style.flex = '';
  target.style.flex = '';

  // Clean up old column if it has orphaned row-handles
  cleanOrphanHandles(oldCol);
  cleanOrphanHandles(targetCol);
});

function cleanOrphanHandles(col) {
  const kids = [...col.children];
  // Remove leading row-handles
  while (kids.length && kids[0].classList && kids[0].classList.contains('row-handle')) {
    kids.shift().remove();
  }
  // Remove trailing row-handles
  while (kids.length && kids[kids.length - 1].classList && kids[kids.length - 1].classList.contains('row-handle')) {
    kids.pop().remove();
  }
  // Remove consecutive row-handles
  for (let i = 1; i < col.children.length; i++) {
    const c = col.children[i];
    const p = col.children[i - 1];
    if (c.classList.contains('row-handle') && p.classList.contains('row-handle')) {
      c.remove();
      i--;
    }
  }
}
