// ide/examples.js — "Open project" dropdown loader
//
// Fetches examples/index.json once; rebuilds the dropdown on every open so
// user-created VFS projects are always current.
//
// Supports both old format { file } and new format { files, main }.
//
// Exports:
//   initExamples(
//     onLoad: ({ name, texts: Map }) => void,
//     opts?: { getProjects: () => Project[], onProjectOpen: (proj) => void }
//   ) → void

export function initExamples(onLoad, { getProjects, onProjectOpen } = {}) {
  const btn  = document.getElementById('btn-open-project');
  const list = document.getElementById('project-list');
  if (!btn || !list) return;

  let _examples = [];

  fetch(new URL('../examples/index.json', import.meta.url))
    .then(r => r.json())
    .then(entries => { _examples = entries; })
    .catch(() => { btn.disabled = true; });

  function _header(text) {
    const li = document.createElement('li');
    li.className = 'project-list-header';
    li.textContent = text;
    return li;
  }

  function _sep() {
    const li = document.createElement('li');
    li.className = 'project-list-sep';
    return li;
  }

  function _rebuildList() {
    list.replaceChildren();

    const userProjects = (getProjects ? getProjects() : []).filter(p => !p.isExample);

    if (userProjects.length > 0) {
      list.appendChild(_header('My projects'));
      for (const proj of userProjects) {
        const li = document.createElement('li');
        li.textContent = proj.name;
        li.addEventListener('click', () => {
          list.hidden = true;
          onProjectOpen?.(proj);
        });
        list.appendChild(li);
      }
      if (_examples.length > 0) list.appendChild(_sep());
    }

    if (_examples.length > 0) {
      list.appendChild(_header('Examples'));
      for (const entry of _examples) {
        const li = document.createElement('li');
        li.className = 'project-list-example';
        li.textContent = entry.name;
        li.addEventListener('click', () => {
          list.hidden = true;
          _loadEntry(entry, onLoad);
        });
        list.appendChild(li);
      }
    }
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (list.hidden) _rebuildList();
    list.hidden = !list.hidden;
  });

  document.addEventListener('click', () => { list.hidden = true; });
}

function _loadEntry(entry, onLoad) {
  // Resolve file list — new format has { files, main }, old has { file }
  const mainFile = entry.main ?? entry.file;
  const allFiles = entry.files ?? [entry.file];

  // Strip the folder prefix shared with main so VFS keys are simple basenames.
  // E.g. mainFile='namespaces/main.qlang' → mainDir='namespaces/'
  //      'namespaces/vec2.qlang' → stored as 'vec2.qlang' in VFS.
  const mainDir = mainFile.includes('/')
    ? mainFile.slice(0, mainFile.lastIndexOf('/') + 1)
    : '';

  // Fetch all files in parallel; remap the main file to 'main.qlang'
  Promise.all(
    allFiles.map(f =>
      fetch(new URL('../examples/' + f, import.meta.url))
        .then(r => r.text())
        .then(t => {
          let key = f === mainFile ? 'main.qlang' : f;
          if (mainDir && key !== 'main.qlang' && key.startsWith(mainDir)) {
            key = key.slice(mainDir.length);
          }
          return [key, t.replace(/\r\n/g, '\n')];
        })
    )
  ).then(pairs => {
    onLoad({ name: entry.name, texts: new Map(pairs) });
  }).catch(e => console.error('Failed to load example:', e));
}

