/* =============================================
   AKASHA — Sovereign Vedic Intelligence Portal
   Frontend Application v3.0
   ============================================= */

// ================================
// UTILITIES
// ================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ================================
// STATE
// ================================

const state = {
  graph: { nodes: [], edges: [] },
  filteredNodes: [],
  searchTerm: '',
  activeCategory: 'all',
  currentPage: 1,
  perPage: 30,
  selectedNode: null,
  guruModel: null,
  isSemantic: false,
  viewMode: 'grid',
  cacheTimestamp: null
};

// ================================
// CATEGORY MAPPING
// ================================

const CATEGORIES = {
  all:         { title: 'All Sacred Texts',      subtitle: 'The Universal Archive of Dharmic Wisdom' },
  rigveda:     { title: 'Ṛgveda',                subtitle: 'The Veda of Hymns — 10,552 verses across 10 Maṇḍalas' },
  samaveda:    { title: 'Sāmaveda',             subtitle: 'The Veda of Melodies — Sacred chants for worship' },
  yajurveda:   { title: 'Yajurveda',            subtitle: 'The Veda of Rituals — Sacrificial formulas' },
  atharvaveda: { title: 'Atharvaveda',         subtitle: 'The Veda of Knowledge — Spells and philosophy' },
  upanishads:  { title: 'Upaniṣads',           subtitle: 'The Philosophical Core — 108 texts on Brahman' },
  puranas:     { title: 'Purāṇas',             subtitle: 'Ancient Lore — Cosmology and Devotion' },
  itihasa:     { title: 'Itihāsa',             subtitle: 'The Great Epics — Mahābhārata and Rāmāyaṇa' },
  gita:        { title: 'Bhagavad Gītā',       subtitle: 'Song of God — The Essence of Vedānta' },
  academic:    { title: 'Scholarly Archives',   subtitle: 'Deep Academic Research Materials' }
};

const debouncedFilterAndRender = debounce(filterAndRender, 300);

// ================================
// INITIALIZATION
// ================================

async function init() {
  try {
    await fetchSettings();
    fetchStatus();
    await fetchGraph();
  } catch (e) {
    console.error('Init error:', e);
  }

  bindUI();
  renderCards();
  updateCategoryCounts();
  startDiscoveryFeed();
  initCosmosBackground();
}

// ================================
// EVENT BINDINGS
// ================================

function bindUI() {
  // Search
  const searchEl = document.getElementById('globalSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      state.searchTerm = e.target.value.toLowerCase().trim();
      state.currentPage = 1;
      debouncedFilterAndRender();
    });
  }

  // Semantic Toggle
  const semanticToggle = document.getElementById('semanticToggle');
  if (semanticToggle) {
    semanticToggle.addEventListener('click', () => {
      state.isSemantic = !state.isSemantic;
      semanticToggle.classList.toggle('active', state.isSemantic);
      state.currentPage = 1;
      filterAndRender();
    });
  }

  // Sidebar Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.activeCategory = item.dataset.category || 'all';
      state.currentPage = 1;

      const cat = CATEGORIES[state.activeCategory] || CATEGORIES.all;
      const pageTitle = document.getElementById('pageTitle');
      const pageSubtitle = document.getElementById('pageSubtitle');
      if (pageTitle) pageTitle.textContent = cat.title;
      if (pageSubtitle) pageSubtitle.textContent = cat.subtitle;

      filterAndRender();
    });
  });

  // View Mode
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const grid = document.getElementById('contentGrid');
      grid.classList.toggle('list-view', state.viewMode === 'list');
    });
  });

  // Model Select
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) {
    modelSelect.addEventListener('change', async (e) => {
      state.guruModel = e.target.value;
      try {
        await saveSettings();
      } catch (e) {
        console.error('Failed to save model:', e);
      }
    });
  }

  // Chat
  document.getElementById('chatSendBtn').addEventListener('click', sendChatMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // Panel Tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-body').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel + 'Panel').classList.add('active');
      if (tab.dataset.panel === 'graph') {
        setTimeout(() => initGraph(), 100);
      }
    });
  });

  // Modal
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Actions
  document.getElementById('translateBtn').addEventListener('click', translateCurrent);
  document.getElementById('insightBtn').addEventListener('click', requestInsight);
}

// ================================
// DATA FETCHING
// ================================

async function fetchStatus() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // Ollama Status
    const ollamaRow = document.getElementById('ollamaStatus');
    if (data.ollama && data.ollama.online && data.ollama.models && data.ollama.models.length > 0) {
      ollamaRow.innerHTML = `
        <span class="status-dot online"></span>
        <span class="status-text">Guru (AI)</span>
        <span class="status-label">Online</span>
      `;

      const modelSelect = document.getElementById('modelSelect');
      if (modelSelect) {
        const newModels = data.ollama.models.map(m => m.name);
        const currentModels = Array.from(modelSelect.options).map(o => o.value);

        if (JSON.stringify(currentModels) !== JSON.stringify(newModels)) {
          modelSelect.innerHTML = data.ollama.models.map(m =>
            `<option value="${m.name}" ${m.name === state.guruModel ? 'selected' : ''}>${m.name}</option>`
          ).join('');
        }

        if (!data.ollama.models.find(m => m.name === state.guruModel)) {
          state.guruModel = data.ollama.models[0].name;
          modelSelect.value = state.guruModel;
          saveSettings();
        }
      }
    } else {
      ollamaRow.innerHTML = `
        <span class="status-dot offline"></span>
        <span class="status-text">Guru (AI)</span>
        <span class="status-label">Offline</span>
      `;
    }

    // Engine Status
    const engineRow = document.getElementById('engineStatus');
    try {
      const eRes = await Promise.race([
        fetch('/api/advanced/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test', limit: 1 })
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);

      if (eRes.ok || eRes.status === 503) {
        engineRow.innerHTML = `
          <span class="status-dot online"></span>
          <span class="status-text">Semantic Engine</span>
          <span class="status-label">Ready</span>
        `;
      } else {
        throw new Error('Not ready');
      }
    } catch(e) {
      engineRow.innerHTML = `
        <span class="status-dot offline"></span>
        <span class="status-text">Semantic Engine</span>
        <span class="status-label">Offline</span>
      `;
    }
  } catch (e) {
    console.error('Status check failed:', e);
  }
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.ai && data.ai.model) {
      state.guruModel = data.ai.model;
    }
  } catch (e) {
    console.warn('Could not fetch settings:', e.message);
  }
}

async function saveSettings() {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai: { model: state.guruModel } })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

async function fetchGraph() {
  try {
    const now = Date.now();
    if (state.cacheTimestamp && (now - state.cacheTimestamp) < 60000) {
      return;
    }

    const res = await fetch('/api/knowledge/graph?page=1&limit=10000');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.nodes && Array.isArray(data.nodes)) {
      state.graph = {
        nodes: data.nodes,
        edges: data.edges || []
      };
      state.cacheTimestamp = now;
    }

    filterAndRender();
  } catch (e) {
    console.error('Graph fetch failed:', e);
  }
}

// ================================
// FILTERING & RENDERING
// ================================

async function filterAndRender() {
  if (state.isSemantic && state.searchTerm && state.searchTerm.length > 2) {
    try {
      const res = await fetch('/api/advanced/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: state.searchTerm, limit: 20 })
      });
      const data = await res.json();

      state.filteredNodes = (data.results || []).map(r => ({
        id: r.id,
        label: r.metadata?.label || r.metadata?.hymn || 'Vedic Insight',
        content: r.content,
        category: 'academic',
        type: 'verse',
        source: r.metadata?.source || 'Local Vault'
      }));
    } catch (e) {
      console.error('Semantic search failed:', e);
      state.isSemantic = false;
      document.getElementById('semanticToggle').classList.remove('active');
      performKeywordFilter();
    }
  } else {
    performKeywordFilter();
  }

  renderCards();
  renderPagination();
  updateCategoryCounts();
}

function performKeywordFilter() {
  const search = state.searchTerm;
  const cat = state.activeCategory;

  state.filteredNodes = state.graph.nodes.filter(n => {
    if (cat !== 'all' && !matchCategory(n, cat)) return false;

    if (search) {
      return (n.label && n.label.toLowerCase().includes(search)) ||
             (n.veda && n.veda.toLowerCase().includes(search)) ||
             (n.category && n.category.toLowerCase().includes(search)) ||
             (n.content && n.content.toLowerCase().includes(search));
    }
    return true;
  });
}

function matchCategory(node, cat) {
  const veda = (node.veda || '').toLowerCase();
  const category = (node.category || '').toLowerCase();
  const label = (node.label || '').toLowerCase();
  const source = (node.source || '').toLowerCase();
  const type = (node.type || '').toLowerCase();

  switch (cat) {
    case 'rigveda':    return veda.includes('rig') || category === 'rigveda' || label.includes('rigveda');
    case 'samaveda':   return veda.includes('sama') || category === 'samaveda' || label.includes('samaveda');
    case 'yajurveda':  return veda.includes('yajur') || category === 'yajurveda' || label.includes('yajurveda');
    case 'atharvaveda': return veda.includes('atharva') || category === 'atharvaveda' || label.includes('atharvaveda');
    case 'upanishads': return category === 'upanishads' || veda.includes('upanishad') || label.includes('upaniṣad');
    case 'puranas':    return category === 'puranas' || veda === 'puranas' || label.includes('purana');
    case 'itihasa':    return category === 'itihasa' || veda === 'itihasa' || label.includes('mahabharata') || label.includes('ramayana');
    case 'gita':       return category === 'gita' || veda === 'gita' || label.includes('bhagavad') || label.includes('gītā');
    case 'academic':   return category === 'academic' || type === 'archive' || source.includes('gretil') || source.includes('sarit');
    default:           return true;
  }
}

function getBadgeClass(node) {
  const cat = (node.category || node.veda || '').toLowerCase();
  if (cat.includes('purana') || cat.includes('itihasa') || cat.includes('gita') || cat.includes('smriti')) return 'badge-smriti';
  if (cat.includes('academic') || cat.includes('archive')) return 'badge-archive';
  return 'badge-shruti';
}

function getBadgeLabel(node) {
  if (node.veda) return node.veda.toUpperCase();
  if (node.category) return node.category.toUpperCase();
  if (node.source) return node.source.toUpperCase();
  return 'VEDA';
}

function renderCards() {
  const grid = document.getElementById('contentGrid');
  const start = (state.currentPage - 1) * state.perPage;
  const pageNodes = state.filteredNodes.slice(start, start + state.perPage);

  if (state.filteredNodes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <h3>No sacred texts found</h3>
        <p>Try a different category or search term</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = pageNodes.map(node => `
    <div class="scripture-card" data-id="${escapeHtml(node.id)}">
      <span class="card-badge ${getBadgeClass(node)}">${escapeHtml(getBadgeLabel(node))}</span>
      <h3 class="card-title">${escapeHtml(node.label || 'Untitled')}</h3>
      <div class="card-meta">
        <span>${escapeHtml(node.type || 'text')}</span>
        ${node.source ? `<span class="dot"></span><span>${escapeHtml(node.source)}</span>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.scripture-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

function renderPagination() {
  const paginationEl = document.getElementById('pagination');
  const totalPages = Math.ceil(state.filteredNodes.length / state.perPage);

  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  let html = `<button ${state.currentPage <= 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">← Prev</button>`;

  const maxVisible = 5;
  let startPage = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="${i === state.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `<button ${state.currentPage >= totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">Next →</button>`;

  paginationEl.innerHTML = html;
  paginationEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      if (page >= 1 && page <= totalPages) {
        state.currentPage = page;
        renderCards();
        renderPagination();
        document.querySelector('.content-scroll').scrollTop = 0;
      }
    });
  });
}

function updateCategoryCounts() {
  const nodes = state.graph.nodes || [];

  const counts = { all: nodes.length };
  Object.keys(CATEGORIES).forEach(cat => {
    if (cat === 'all') return;
    counts[cat] = nodes.filter(n => matchCategory(n, cat)).length;
  });

  Object.entries(counts).forEach(([cat, count]) => {
    const el = document.getElementById(`count-${cat}`);
    if (el) el.textContent = count;
  });

  const totalEl = document.getElementById('totalCount');
  if (totalEl) totalEl.textContent = counts.all;
}

// ================================
// MODAL
// ================================

async function openModal(id) {
  state.selectedNode = state.graph.nodes.find(n => n.id === id) || state.filteredNodes.find(n => n.id === id);
  if (!state.selectedNode) return;

  const node = state.selectedNode;
  const overlay = document.getElementById('modalOverlay');

  document.getElementById('modalBadge').textContent = getBadgeLabel(node);
  document.getElementById('modalTitle').textContent = node.label || 'Untitled';
  document.getElementById('modalSource').textContent = node.source ? `Source: ${node.source}` : '';
  document.getElementById('guruInsight').textContent = 'Click below to request divine guidance...';
  document.getElementById('translateResult').classList.remove('visible');
  document.getElementById('translateResult').textContent = '';

  const textEl = document.getElementById('modalText');
  textEl.innerHTML = '<div class="loader-outer" style="margin: 40px auto;"><div class="loader-inner"></div></div>';

  overlay.classList.add('visible');

  try {
    const res = await fetch(`/api/knowledge/vault/${id}`);
    if (res.ok) {
      const data = await res.json();
      let content = data.content || data.text || data.data;

      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        if (parsed && typeof parsed === 'object') {
          let html = '';
          if (parsed.title) html += `<h3 style="color: var(--gold-primary); font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; margin-bottom: 1rem;">${escapeHtml(parsed.title)}</h3>`;
          if (parsed.book || parsed.author) html += `<p style="color: var(--text-tertiary); font-style: italic; margin-bottom: 1.5rem;">${escapeHtml(parsed.book || '')} ${parsed.book && parsed.author ? '•' : ''} ${escapeHtml(parsed.author || '')}</p>`;
          if (parsed.describe) html += `<p style="margin-bottom: 1.5rem; font-style: italic; color: var(--text-secondary);">${escapeHtml(parsed.describe)}</p>`;

          if (Array.isArray(parsed.data)) {
            parsed.data.forEach(item => {
              if (item.title) html += `<h4 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">${escapeHtml(item.title)}</h4>`;
              if (item.hymn) html += `<p style="color: var(--gold-primary); font-size: 0.8rem;">${escapeHtml(item.hymn)}</p>`;
              if (item.text) html += `<p style="line-height: 1.8; margin-bottom: 1rem;">${escapeHtml(item.text).replace(/\n/g, '<br>')}</p>`;
            });
          } else if (parsed.text || parsed.content) {
            html += `<p style="line-height: 1.8;">${escapeHtml(parsed.text || parsed.content).replace(/\n/g, '<br>')}</p>`;
          } else if (!parsed.describe) {
            html += `<pre style="background: var(--bg-deep); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.8rem;">${JSON.stringify(parsed, null, 2)}</pre>`;
          }
          content = html;
        }
      } catch (e) {
        content = `<p style="line-height: 1.8;">${escapeHtml(content)}</p>`;
      }

      textEl.innerHTML = content || '<p>No text available in the vault.</p>';
    } else {
      textEl.innerHTML = node.content
        ? `<p style="line-height: 1.8;">${escapeHtml(node.content)}</p>`
        : '<div class="empty-state"><p>This sacred text is indexed in the knowledge graph. Ask the Guru for deeper insights.</p></div>';
    }
  } catch (e) {
    console.error('Modal fetch failed:', e);
    textEl.innerHTML = '<div class="empty-state"><p>This sacred text is indexed. Ask the Guru for insights.</p></div>';
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('visible');
}

// ================================
// TRANSLATION & INSIGHT
// ================================

async function translateCurrent() {
  const lang = document.getElementById('translateLang').value.trim();
  if (!lang) return;

  const resultEl = document.getElementById('translateResult');
  const text = document.getElementById('modalText').textContent;

  resultEl.innerHTML = '<span style="color: var(--gold-primary);">The Guru is translating...</span>';
  resultEl.classList.add('visible');

  try {
    const res = await fetch('/api/guru/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1000), lang })
    });
    const data = await res.json();
    resultEl.innerHTML = data.response ? marked.parse(data.response) : 'Translation unavailable.';
  } catch (e) {
    resultEl.innerHTML = '<em>Translation failed. Is the Guru online?</em>';
  }
}

async function requestInsight() {
  const insightEl = document.getElementById('guruInsight');
  const text = document.getElementById('modalText').textContent;

  insightEl.innerHTML = '<span style="color: var(--gold-primary);">The Guru is contemplating your request...</span>';

  try {
    const res = await fetch('/api/guru/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `Provide a deep spiritual and philosophical commentary on this sacred text. Explain its significance, context, and key teachings:\n\n${text.slice(0, 1000)}`,
        mantraId: state.selectedNode?.id
      })
    });
    const data = await res.json();
    insightEl.innerHTML = data.response ? marked.parse(data.response) : '<em>The Guru is in silent contemplation.</em>';
  } catch (e) {
    insightEl.innerHTML = '<em style="color: var(--ruby);">Unable to reach the Guru. Please check Ollama status.</em>';
  }
}

// ================================
// CHAT
// ================================

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendChatMessage('user', text);
  input.value = '';

  const thinkingId = 'thinking-' + Date.now();
  appendChatMessage('guru', '<span style="color: var(--gold-primary);">The Guru is contemplating...</span>', thinkingId);

  try {
    const res = await fetch('/api/guru/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, mantraId: state.selectedNode?.id })
    });
    const data = await res.json();
    const el = document.getElementById(thinkingId);
    if (el) {
      const body = el.querySelector('.msg-body');
      if (data.response) {
        body.innerHTML = marked.parse(data.response);
      } else {
        body.innerHTML = 'No response from the Guru.';
      }
    }
  } catch (e) {
    const el = document.getElementById(thinkingId);
    if (el) {
      el.querySelector('.msg-body').innerHTML = '<em style="color: var(--ruby);">Connection to the Guru lost.</em>';
    }
  }
}

function appendChatMessage(role, text, id = '') {
  const container = document.getElementById('chatMessages');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  if (id) msg.id = id;

  const isGuru = role === 'guru';

  msg.innerHTML = isGuru
    ? `<div class="msg-avatar">ॐ</div><div class="msg-body">${text}</div>`
    : `<div class="msg-avatar">👤</div><div class="msg-body">${escapeHtml(text)}</div>`;

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// ================================
// KNOWLEDGE GRAPH
// ================================

let graphInstance = null;

function initGraph() {
  const container = document.getElementById('graphContainer');
  if (!container) return;

  // Check if library loaded
  if (typeof ForceGraph === 'undefined') {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);">Loading graph library...</div>';
    console.error('ForceGraph library not loaded');
    return;
  }

  const nodesToRender = state.filteredNodes.length > 0 ? state.filteredNodes : state.graph.nodes;

  if (nodesToRender.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);">No nodes to display</div>';
    return;
  }

  const nodeIds = new Set(nodesToRender.map(n => n.id));
  const linksToRender = state.graph.edges.filter(e => {
    const src = e.source?.id || e.source || e.from;
    const tgt = e.target?.id || e.target || e.to;
    return nodeIds.has(src) && nodeIds.has(tgt);
  });

  const gData = {
    nodes: nodesToRender.slice(0, 300).map(n => ({ ...n })),
    links: linksToRender.slice(0, 500).map(e => ({
      source: e.source?.id || e.source || e.from,
      target: e.target?.id || e.target || e.to
    }))
  };

  // Clear container
  container.innerHTML = '';

  // Get actual dimensions
  const rect = container.getBoundingClientRect();
  const width = rect.width || 350;
  const height = rect.height || 400;

  try {
    graphInstance = ForceGraph()
    (container)
      .width(width)
      .height(height)
      .graphData(gData)
      .nodeId('id')
      .nodeLabel(node => `<div style="background:#12121a;padding:8px 12px;border:1px solid rgba(201,162,39,0.3);border-radius:8px;color:#f5f5f7;font-size:12px;"><strong>${node.label || node.id}</strong></div>`)
      .nodeColor(() => '#c9a227')
      .nodeRelSize(5)
      .linkColor(() => 'rgba(201, 162, 39, 0.25)')
      .linkWidth(1.5)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.003)
      .backgroundColor('#030305')
      .onNodeClick(node => {
        openModal(node.id);
      });

    document.getElementById('graphNodeCount').textContent = `${gData.nodes.length} nodes`;

    // Handle resize
    window.addEventListener('resize', () => {
      if (graphInstance) {
        const newRect = container.getBoundingClientRect();
        graphInstance.width(newRect.width).height(newRect.height);
      }
    });
  } catch (e) {
    console.error('Graph initialization error:', e);
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ruby);">Graph error: ' + e.message + '</div>';
  }
}

// ================================
// DISCOVERY FEED
// ================================

function startDiscoveryFeed() {
  function addLog(msg) {
    const feed = document.getElementById('logFeed');
    if (!feed) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-text">${escapeHtml(msg)}</span>`;
    feed.prepend(entry);

    while (feed.children.length > 20) feed.lastChild.remove();
  }

  addLog('AKASHA Portal initialized. Connecting to knowledge streams...');

  // Poll logs
  async function pollLogs() {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      const logList = data.logs || [];
      if (logList.length > 0) {
        logList.slice(-3).forEach(log => addLog(log.message || log.msg || ''));
      }
    } catch (e) {}
  }

  setInterval(pollLogs, 5000);
}

// ================================
// COSMOS BACKGROUND ANIMATION
// ================================

function initCosmosBackground() {
  const canvas = document.getElementById('cosmos-bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let stars = [];

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createStars() {
    stars = [];
    for (let i = 0; i < 150; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.5 + 0.2,
        speed: Math.random() * 0.02 + 0.005
      });
    }
  }

  function draw() {
    ctx.fillStyle = '#030305';
    ctx.fillRect(0, 0, width, height);

    // Draw gradient overlay
    const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
    gradient.addColorStop(0, 'rgba(201, 162, 39, 0.03)');
    gradient.addColorStop(0.5, 'rgba(30, 30, 50, 0.02)');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Draw stars
    stars.forEach(star => {
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
      ctx.fill();

      // Subtle twinkle
      star.opacity += Math.sin(Date.now() * star.speed) * 0.01;
      star.opacity = Math.max(0.1, Math.min(0.7, star.opacity));
    });

    requestAnimationFrame(draw);
  }

  resize();
  createStars();
  draw();

  window.addEventListener('resize', () => {
    resize();
    createStars();
  });
}

// ================================
// WINDOW RESIZE HANDLER
// ================================

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Update graph if visible
    const graphPanel = document.getElementById('graphPanel');
    if (graphPanel && graphPanel.classList.contains('active') && graphInstance) {
      const container = document.getElementById('graphContainer');
      if (container) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          graphInstance.width(rect.width).height(rect.height);
        }
      }
    }

    // Recalculate content grid if needed
    const contentGrid = document.getElementById('contentGrid');
    if (contentGrid) {
      // Force reflow to fix any grid layout issues
      contentGrid.style.display = 'grid';
    }
  }, 250);
});

// Fix for iOS Safari bounce scroll
document.addEventListener('touchmove', function(e) {
  if (e.target.closest('.content-scroll, .nav-section, .chat-messages, .log-feed')) {
    // Allow native scroll
  } else if (e.target.closest('.modal-overlay')) {
    // Allow modal scroll
  } else {
    // Prevent body scroll when modal is open
    if (document.getElementById('modalOverlay').classList.contains('visible')) {
      e.preventDefault();
    }
  }
}, { passive: false });

// ================================
// LAUNCH
// ================================

window.addEventListener('DOMContentLoaded', init);