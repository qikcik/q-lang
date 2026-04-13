// ide/examples.js — Examples dropdown loader
//
// Fetches examples/index.json to get the list of examples, populates the
// dropdown, and loads a selected file into the editor via the onLoad callback.
//
// Exports:
//   initExamples(onLoad: (text: string) => void) → void

export function initExamples(onLoad) {
  const btn  = document.getElementById('btn-load-example');
  const list = document.getElementById('example-list');
  if (!btn || !list) return;

  fetch(new URL('../examples/index.json', import.meta.url))
    .then(r => r.json())
    .then(entries => {
      for (const { name, file } of entries) {
        const li = document.createElement('li');
        li.textContent = name;
        li.addEventListener('click', () => {
          list.hidden = true;
          fetch(new URL('../examples/' + file, import.meta.url))
            .then(r => r.text())
            .then(t => onLoad(t.replace(/\r\n/g, '\n')))
            .catch(e => console.error('Failed to load example:', e));
        });
        list.appendChild(li);
      }
    })
    .catch(() => { btn.disabled = true; });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });

  document.addEventListener('click', () => { list.hidden = true; });
}
