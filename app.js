/**
 * Gestor de Proyectos Pomodoro
 * Persists data to localStorage and allows JSON Export/Import.
 */

// Anti-FOUC theme bootstrap. Runs as soon as app.js is evaluated. Because
// the <script> uses `defer`, the parser has already produced <body> when we
// get here, so we can sync the body data-theme to whatever the user picked
// last time before the rest of the app initializes. The body already starts
// with data-theme="dark" literal, so users who never toggled (or are on
// their first visit) see no flash either way.
(function bootTheme() {
    try {
        var saved = localStorage.getItem('itadaki_pomodoro_settings');
        if (!saved) return;
        var parsed = JSON.parse(saved);
        if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark')) {
            document.body.dataset.theme = parsed.theme;
        }
    } catch (e) { /* fall back to the literal data-theme="dark" already on <body> */ }
})();

// State
let projects = [];
let history = []; // { id, projectName, timestamp, duration, type }
let globalBreakDuration = 5; // Default minutes
let isServerAvailable = false;
const DATA_URL = '/data';
const STORAGE_KEY = 'itadaki_pomodoro_projects';
const HISTORY_KEY = 'itadaki_pomodoro_history';
const SETTINGS_KEY = 'itadaki_pomodoro_settings';
let activeTimers = {}; // Map projectId -> intervalId

// DOM Elements
const projectListEl = document.getElementById('project-list');
const historyListEl = document.getElementById('history-list');
const searchInput = document.getElementById('search');
const addProjectBtn = document.getElementById('add-project');
const modal = document.getElementById('project-modal');
const modalTitle = document.getElementById('modal-title');
const nameInput = document.getElementById('proj-name');
const descInput = document.getElementById('proj-desc');
const saveBtn = document.getElementById('save-proj');
const cancelBtn = document.getElementById('cancel-proj');
const exportBtn = document.getElementById('export-data');
const importBtn = document.getElementById('import-data');
const importInput = document.getElementById('import-file');
// Quick Break Elements
const quickBreakBtn = document.getElementById('quick-break-btn');
const quickBreakToggle = document.getElementById('quick-break-toggle');
const quickBreakDropdown = document.getElementById('quick-break-dropdown');
const globalBreakInput = document.getElementById('global-break-duration');
const saveBreakConfigBtn = document.getElementById('save-break-config');
const statsBtn = document.getElementById('stats-btn');
const statsModal = document.getElementById('stats-modal');
const closeStatsBtn = document.getElementById('close-stats');
const timeChartCanvas = document.getElementById('timeChart');
const statsStartInput = document.getElementById('stats-start');
const statsEndInput = document.getElementById('stats-end');
const connectionStatusEl = document.getElementById('connection-status');
const timelineBarEl = document.getElementById('timeline-bar');
const timelineWorkedEl = document.getElementById('timeline-worked');
const timelineRestedEl = document.getElementById('timeline-rested');
const archiveBtn = document.getElementById('archive-btn');
const archiveModal = document.getElementById('archive-modal');
const archiveListEl = document.getElementById('archive-list');
const closeArchiveBtn = document.getElementById('close-archive');
// Manual Entry Elements
const manualEntryBtn = document.getElementById('manual-entry-btn');
const manualModal = document.getElementById('manual-modal');
const manualProjectSelect = document.getElementById('manual-project-select');
const manualDatetimeInput = document.getElementById('manual-datetime');
const manualDurationInput = document.getElementById('manual-duration');
const saveManualBtn = document.getElementById('save-manual');
const cancelManualBtn = document.getElementById('cancel-manual');
// Theme toggle
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');
let timeChartInstance = null;
const ONE_DAY_MS = 86400000;
const RETENTION_DAYS = 90;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(getStoredTheme());
    await loadFromServer();
    renderProjects();
    renderHistory();
    renderTimeline();
    setupEventListeners();
    requestNotificationPermission();
});

function setupEventListeners() {
    searchInput.addEventListener('input', (e) => renderProjects(e.target.value));

    addProjectBtn.addEventListener('click', () => openModal());
    cancelBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', saveProjectFromModal);

    // Close modal on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (exportBtn) exportBtn.addEventListener('click', exportData);
    if (importBtn) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', importData);

    // Quick Break Listeners
    if (quickBreakBtn) quickBreakBtn.addEventListener('click', startGlobalBreak);
    if (quickBreakToggle) quickBreakToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        quickBreakDropdown.classList.toggle('show');
    });
    if (saveBreakConfigBtn) saveBreakConfigBtn.addEventListener('click', saveSettings);

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (quickBreakDropdown && !quickBreakDropdown.contains(e.target) && e.target !== quickBreakToggle) {
            quickBreakDropdown.classList.remove('show');
        }
    });

    // Stats Listeners
    if (statsBtn) statsBtn.addEventListener('click', openStatsModal);
    if (closeStatsBtn) closeStatsBtn.addEventListener('click', () => statsModal.classList.remove('active'));
    if (statsModal) statsModal.addEventListener('click', (e) => {
        if (e.target === statsModal) statsModal.classList.remove('active');
    });

    // Stats Date Filters
    if (statsStartInput) statsStartInput.addEventListener('change', renderStats);
    if (statsEndInput) statsEndInput.addEventListener('change', renderStats);

    // Connection Reconnect
    if (connectionStatusEl) connectionStatusEl.addEventListener('click', loadFromServer);

    // Archive Listeners
    if (archiveBtn) archiveBtn.addEventListener('click', openArchiveModal);
    if (closeArchiveBtn) closeArchiveBtn.addEventListener('click', () => archiveModal.classList.remove('active'));
    if (archiveModal) archiveModal.addEventListener('click', (e) => {
        if (e.target === archiveModal) archiveModal.classList.remove('active');
    });

    // Manual Entry Listeners
    if (manualEntryBtn) manualEntryBtn.addEventListener('click', openManualModal);
    if (cancelManualBtn) cancelManualBtn.addEventListener('click', () => manualModal.classList.remove('active'));
    if (saveManualBtn) saveManualBtn.addEventListener('click', saveManualEntry);
    if (manualModal) manualModal.addEventListener('click', (e) => {
        if (e.target === manualModal) manualModal.classList.remove('active');
    });

    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

    // Theme Toggle
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

    setupDelegatedHandlers();
}

// Delegación de eventos sobre listas dinámicas. Evita interpolar IDs en
// `onclick=...` (vector M-1/M-2 de la auditoría red-hat): los IDs viajan
// por `data-id` en el DOM y nunca se concatenan a código.
function setupDelegatedHandlers() {
    if (projectListEl) {
        projectListEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const card = btn.closest('.project-card');
            if (!card) return;
            const id = card.dataset.id;
            switch (btn.dataset.action) {
                case 'edit':        openModalById(id); break;
                case 'archive':     archiveProject(id); break;
                case 'switchMode':  switchMode(id, btn.dataset.mode); break;
                case 'toggleTimer': toggleTimer(id); break;
                case 'stopTimer':   stopTimer(id); break;
                case 'resetTimer':  resetTimer(id); break;
            }
        });
        projectListEl.addEventListener('change', (e) => {
            const input = e.target.closest('[data-action="setDuration"]');
            if (!input) return;
            const card = input.closest('.project-card');
            if (!card) return;
            setDuration(card.dataset.id, input.value, input.dataset.mode);
        });
    }

    if (archiveListEl) {
        archiveListEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            if (!id) return;
            if (btn.dataset.action === 'restore') restoreProject(id);
            else if (btn.dataset.action === 'deletePermanent') deletePermanent(id);
        });
    }
}

// --- Data Persistence ---

// --- Data Persistence ---

async function loadFromServer() {
    try {
        const res = await fetch(DATA_URL);
        if (res.ok) {
            const data = await res.json();
            // Server is available - even if data is empty (first run)
            isServerAvailable = true;
            projects = data.projects || [];
            history = data.history || [];
            globalBreakDuration = data.settings?.globalBreakDuration || 5;
            if (globalBreakInput) globalBreakInput.value = globalBreakDuration;

            // Reset runtime states
            projects.forEach(p => {
                p.timerActive = false;
                if (p.timeLeft === undefined) p.timeLeft = p.timerDuration * 60;
            });

            pruneHistory(); // Retention Policy
            console.log('Loaded from Server');
            updateConnectionStatus(true);
            return;
        }
    } catch (e) {
        console.warn('Server unavailable, falling back to LocalStorage', e);
    }

    updateConnectionStatus(false);

    // Fallback or First Run
    loadProjectsLocal();
    loadHistoryLocal();
    loadSettingsLocal();
}

function loadProjectsLocal() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            projects = JSON.parse(data);
            projects.forEach(p => {
                p.timerActive = false;
                if (!p.timerDuration) p.timerDuration = 25;
                if (!p.breakDuration) p.breakDuration = 5;
                if (p.timeLeft === undefined) p.timeLeft = p.timerDuration * 60;
                if (!p.mode) p.mode = 'work';
            });
        } catch (e) { projects = []; }
    }
}

function pruneHistory() {
    const cutoff = Date.now() - (RETENTION_DAYS * ONE_DAY_MS);
    const initialLen = history.length;
    history = history.filter(item => {
        const ts = new Date(item.timestamp).getTime();
        return ts >= cutoff;
    });
    if (history.length < initialLen) {
        console.log(`Pruned ${initialLen - history.length} old entries.`);
    }
}

async function saveData() {
    // 1. Prepare Data
    const payload = {
        projects: projects.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            timerDuration: p.timerDuration,
            breakDuration: p.breakDuration,
            timeLeft: p.timeLeft,
            breakDuration: p.breakDuration,
            timeLeft: p.timeLeft,
            mode: p.mode,
            archived: p.archived || false
        })),
        history: history,
        settings: { globalBreakDuration }
    };

    // 2. Save to Server
    if (isServerAvailable) {
        try {
            await fetch(DATA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            updateConnectionStatus(true);
        } catch (e) {
            console.error('Failed to save to server', e);
            updateConnectionStatus(false);
        }
    }

    // 3. Save to LocalStorage (Backup)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.projects));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload.history));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload.settings));
}

// Wrapper aliases to maintain compatibility
function saveProjects() { saveData(); }
// saveHistory and saveSettings are defined below with additional UI logic

function exportData() {
    const data = {
        projects: projects,
        history: history
    };
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `itadaki_pomodoro_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Datos exportados existosamente');
}

// Schema validators — backup importado puede venir de cualquier lado
// (WhatsApp, email, sitio web). M-3 de la auditoría red-hat: blindar
// importData contra IDs maliciosos que después se interpolen en el DOM.
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_PROJECTS = 1000;
const MAX_HISTORY = 100000;
const MAX_NAME_LEN = 200;
const MAX_DESC_LEN = 2000;

function isValidProject(p) {
    if (!p || typeof p !== 'object') return false;
    const id = (typeof p.id === 'number') ? String(p.id) : p.id;
    if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) return false;
    if (typeof p.name !== 'string' || p.name.length === 0 || p.name.length > MAX_NAME_LEN) return false;
    if (p.description !== undefined && p.description !== null
        && (typeof p.description !== 'string' || p.description.length > MAX_DESC_LEN)) return false;
    return true;
}

const HISTORY_STATUS_ALLOWED = new Set(['started', 'paused', 'completed', 'stopped']);
const HISTORY_TYPE_ALLOWED = new Set(['Pomodoro', 'Break']);

function isValidHistoryEntry(h) {
    if (!h || typeof h !== 'object') return false;
    if (typeof h.projectName !== 'string' || h.projectName.length > MAX_NAME_LEN) return false;
    if (typeof h.timestamp !== 'number' && typeof h.timestamp !== 'string') return false;
    if (h.status !== undefined && !HISTORY_STATUS_ALLOWED.has(h.status)) return false;
    if (h.type !== undefined && !HISTORY_TYPE_ALLOWED.has(h.type)) return false;
    if (h.duration !== undefined && (!Number.isFinite(+h.duration) || +h.duration < 0 || +h.duration > 100000)) return false;
    return true;
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            const rawProjects = Array.isArray(imported)
                ? imported
                : (imported && Array.isArray(imported.projects) ? imported.projects : null);

            if (!rawProjects) {
                alert('Formato JSON no reconocido.');
                return;
            }
            if (rawProjects.length > MAX_PROJECTS) {
                alert(`El archivo contiene demasiados proyectos (max ${MAX_PROJECTS}).`);
                return;
            }
            const validProjects = rawProjects
                .filter(isValidProject)
                .map(p => ({ ...p, id: String(p.id) }));
            const skipped = rawProjects.length - validProjects.length;

            loadImportedProjects(validProjects);

            if (imported && Array.isArray(imported.history)) {
                history = imported.history.filter(isValidHistoryEntry).slice(0, MAX_HISTORY);
                saveHistory();
                renderHistory();
            }

            const base = Array.isArray(imported) ? 'Proyectos importados (formato antiguo)' : 'Datos completos importados';
            showToast(skipped > 0 ? `${base} — ${skipped} ignorados por formato inválido` : base);
        } catch (err) {
            alert('Error al leer el archivo JSON.');
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
}

function loadImportedProjects(importedProjects) {
    Object.values(activeTimers).forEach(clearInterval);
    activeTimers = {};

    projects = importedProjects;
    projects.forEach(p => {
        p.timerActive = false;
        if (!p.timerDuration) p.timerDuration = 25;
        if (!p.breakDuration) p.breakDuration = 5;
        if (p.timeLeft === undefined) p.timeLeft = p.timerDuration * 60;
        if (!p.mode) p.mode = 'work';
    });

    saveProjects();
    renderProjects();
}

// --- Theme Management ---

function applyTheme(theme) {
    const t = (theme === 'light') ? 'light' : 'dark';
    document.body.dataset.theme = t;
    if (themeIconSun && themeIconMoon) {
        themeIconSun.style.display = (t === 'dark') ? 'inline-block' : 'none';
        themeIconMoon.style.display = (t === 'light') ? 'inline-block' : 'none';
    }
    if (themeToggleBtn) {
        themeToggleBtn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    }
    // Re-render chart if visible so its labels/grid follow the new theme
    if (timeChartInstance && statsModal && statsModal.classList.contains('active')) {
        renderStats();
    }
}

function getStoredTheme() {
    try {
        const data = localStorage.getItem(SETTINGS_KEY);
        if (!data) return 'dark';
        const parsed = JSON.parse(data);
        return (parsed.theme === 'light' || parsed.theme === 'dark') ? parsed.theme : 'dark';
    } catch (e) { return 'dark'; }
}

function persistTheme(theme) {
    try {
        const data = localStorage.getItem(SETTINGS_KEY);
        const parsed = data ? JSON.parse(data) : {};
        parsed.theme = theme;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
    } catch (e) { console.error('persistTheme failed', e); }
}

function toggleTheme() {
    const current = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    persistTheme(next);
}

// --- Settings & Global Break ---

function loadSettingsLocal() {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
        try {
            const settings = JSON.parse(data);
            if (settings.globalBreakDuration) {
                globalBreakDuration = parseInt(settings.globalBreakDuration);
                if (globalBreakInput) globalBreakInput.value = globalBreakDuration;
            }
        } catch (e) { console.error(e); }
    }
}

function saveSettings() {
    const val = parseInt(globalBreakInput.value);
    if (val > 0) {
        globalBreakDuration = val;
        quickBreakDropdown.classList.remove('show');
        saveData(); // Persist to server + localStorage
        showToast(`Tiempo de descanso guardado: ${val} min`);
    } else {
        alert('Ingrese un valor válido');
    }
}

function startGlobalBreak() {
    // 1. Pause all active timers
    Object.keys(activeTimers).forEach(id => {
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
        const p = projects.find(x => x.id === id);
        if (p) p.timerActive = false;
    });

    // 2. Find or Create "Quick Break" project
    let breakProj = projects.find(p => p.id === 'quick-break-global');
    if (!breakProj) {
        breakProj = {
            id: 'quick-break-global',
            name: '☕ Descanso Rápido',
            description: 'Tiempo personal generado desde la cabecera.',
            timerDuration: 25,
            breakDuration: globalBreakDuration,
            timeLeft: globalBreakDuration * 60,
            mode: 'break',
            timerActive: false
        };
        projects.unshift(breakProj); // Add to top
    } else {
        // Ensure it's in break mode and updated duration
        breakProj.mode = 'break';
        breakProj.breakDuration = globalBreakDuration;
        breakProj.timeLeft = globalBreakDuration * 60;
    }

    saveProjects();
    renderProjects();

    // 3. Start it
    toggleTimer('quick-break-global');
    showToast('¡Descanso iniciado!');

    // 4. Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- History Logic ---

// --- History Logic ---

function loadHistoryLocal() {
    const data = localStorage.getItem(HISTORY_KEY);
    if (data) {
        try {
            history = JSON.parse(data);
        } catch (e) {
            console.error('Error loading history:', e);
            history = [];
        }
    }
}

function saveHistory() {
    saveData(); // Persist to server + localStorage
}

function addToHistory(projectName, durationMinutes, type = 'Pomodoro', status = 'completed', startTime = null) {
    const entry = {
        id: Date.now().toString(),
        projectName,
        duration: durationMinutes,
        type, // 'Pomodoro' or 'Break'
        status, // 'started', 'completed', 'stopped', 'paused'
        timestamp: new Date().toISOString(),
        startTime: startTime // ISO string of when session started (for timeline)
    };
    history.unshift(entry);
    saveHistory();
    renderHistory();
    renderTimeline();
}

function clearHistory() {
    if (!confirm('¿Borrar todo el historial?')) return;
    history = [];
    saveHistory();
    renderHistory();
}

function renderHistory() {
    if (!historyListEl) return;
    historyListEl.innerHTML = '';

    if (history.length === 0) {
        historyListEl.innerHTML = '<div style="color:#888; font-size:0.9rem; font-style:italic;">No hay actividad reciente.</div>';
        return;
    }

    // Group by Date
    const groups = {};
    history.forEach(item => {
        const date = new Date(item.timestamp);
        const dateKey = date.toLocaleDateString(); // e.g., "1/22/2026"
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(item);
    });

    // Sort dates descending
    const dates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));

    dates.forEach(dateKey => {
        // Date Header
        const dateHeader = document.createElement('h3');
        dateHeader.style.fontSize = '0.9rem';
        dateHeader.style.color = '#888';
        dateHeader.style.marginTop = '1rem';
        dateHeader.style.marginBottom = '0.5rem';
        dateHeader.style.borderBottom = '1px solid #eee';

        // Smart Date Label
        const today = new Date().toLocaleDateString();
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
        if (dateKey === today) dateHeader.textContent = 'Hoy';
        else if (dateKey === yesterday) dateHeader.textContent = 'Ayer';
        else dateHeader.textContent = dateKey;

        historyListEl.appendChild(dateHeader);

        // Items
        groups[dateKey].forEach(item => {
            const date = new Date(item.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const typeLabel = item.type === 'Break' ? '☕' : '🍅';

            const el = document.createElement('div');
            el.className = 'history-item';

            // Visual distinction for Started vs Completed vs Paused.
            // `duration` viene del JSON persistido y puede ser hostil tras un
            // import — coerción a entero defensiva antes de interpolar.
            let actionText, color, icon;
            if (item.status === 'started') {
                actionText = 'Iniciado';
                color = 'var(--color-success)'; // Play = Green
                icon = '▶';
            } else if (item.status === 'paused') {
                actionText = 'Pausado';
                color = '#f39c12'; // Orange warning color
                icon = '⏸';
            } else {
                actionText = 'Completado';
                color = 'var(--color-primary)'; // Done = Blue
                const safeDuration = Number.isFinite(+item.duration) ? Math.trunc(+item.duration) : 0;
                icon = '✔ ' + safeDuration + ' min';
            }

            el.innerHTML = `
                <div class="history-header">
                    <span>${timeStr} ${typeLabel}</span>
                    <span class="history-time" style="color:${color}">${icon}</span>
                </div>
                <div class="history-task" style="opacity:${item.status === 'started' ? 0.8 : 1}">${escapeHtml(item.projectName)} <span style="font-weight:normal; font-size:0.8em; color:#888">(${actionText})</span></div>
            `;
            historyListEl.appendChild(el);
        });
    });
}

// --- Project Logic ---

function openModal(project = null) {
    modal.classList.add('active');
    if (project) {
        modalTitle.textContent = 'Editar Proyecto';
        nameInput.value = project.name;
        descInput.value = project.description;
        saveBtn.dataset.id = project.id;
    } else {
        modalTitle.textContent = 'Nuevo Proyecto';
        nameInput.value = '';
        descInput.value = '';
        saveBtn.dataset.id = '';
    }
    nameInput.focus();
}

function closeModal() {
    modal.classList.remove('active');
}

function saveProjectFromModal() {
    const name = nameInput.value.trim();
    if (!name) return alert('El nombre es obligatorio');

    const desc = descInput.value.trim();
    const id = saveBtn.dataset.id;

    if (id) {
        // Edit
        const p = projects.find(x => x.id === id);
        if (p) {
            p.name = name;
            p.description = desc;
        }
    } else {
        // Create
        const newProj = {
            id: Date.now().toString(),
            name,
            description: desc,
            timerDuration: 25,
            breakDuration: 5,
            timeLeft: 25 * 60,
            mode: 'work',
            timerActive: false
        };
        projects.push(newProj);
    }

    saveProjects();
    renderProjects(searchInput.value);
    closeModal();
}

function archiveProject(id) {
    if (!confirm('¿Archivar este proyecto? Podrás restaurarlo después.')) return;

    if (activeTimers[id]) {
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
    }

    const p = projects.find(x => x.id === id);
    if (p) {
        p.archived = true;
        p.timerActive = false;
    }

    saveProjects();
    renderProjects(searchInput.value);
    showToast('Proyecto archivado');
}

function restoreProject(id) {
    const p = projects.find(x => x.id === id);
    if (p) {
        p.archived = false;
    }
    saveProjects();
    renderProjects(searchInput.value);
    openArchiveModal(); // Refresh list
    showToast('Proyecto restaurado');
}

function deletePermanent(id) {
    if (!confirm('¿Eliminar DEFINITIVAMENTE? Esta acción no se puede deshacer.')) return;
    projects = projects.filter(p => p.id !== id);
    saveProjects();
    openArchiveModal(); // Refresh list
    showToast('Proyecto eliminado definitivamente');
}

function openArchiveModal() {
    archiveModal.classList.add('active');
    renderArchiveList();
}

function renderArchiveList() {
    archiveListEl.innerHTML = '';
    const archived = projects.filter(p => p.archived);

    if (archived.length === 0) {
        archiveListEl.innerHTML = '<div style="color:#888; text-align:center;">No hay proyectos archivados</div>';
        return;
    }

    archived.forEach(p => {
        const item = document.createElement('div');
        item.style.borderBottom = '1px solid #eee';
        item.style.padding = '0.5rem';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';

        item.innerHTML = `
            <div>
                <strong>${escapeHtml(p.name)}</strong>
                <div style="font-size:0.8rem; color:#666;">${escapeHtml(p.description || '')}</div>
            </div>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn" style="background:var(--color-success); font-size:0.8rem; padding:0.3rem 0.6rem;" data-action="restore" data-id="${escapeAttr(p.id)}" title="Restaurar">♻️</button>
                <button class="btn" style="background:var(--color-danger); font-size:0.8rem; padding:0.3rem 0.6rem;" data-action="deletePermanent" data-id="${escapeAttr(p.id)}" title="Eliminar Definitivamente">❌</button>
            </div>
        `;
        archiveListEl.appendChild(item);
    });
}

// --- Manual Entry Logic ---

function openManualModal() {
    manualModal.classList.add('active');

    // Populate Projects
    manualProjectSelect.innerHTML = '';
    const activeProjects = projects.filter(p => !p.archived);
    activeProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        manualProjectSelect.appendChild(opt);
    });

    // Default to specific global break if exists, or first project

    // Default Date: Now
    // Format required for datetime-local: YYYY-MM-DDTHH:mm
    const now = new Date();
    // Adjust for timezone offset to show local time in input
    const offsetMs = now.getTimezoneOffset() * 60000;
    const localIso = new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
    manualDatetimeInput.value = localIso;
}

function saveManualEntry() {
    const projectId = manualProjectSelect.value;
    const project = projects.find(p => p.id === projectId);
    if (!project) return alert('Seleccione un proyecto');

    const duration = parseInt(manualDurationInput.value);
    if (isNaN(duration) || duration < 1) return alert('Duración inválida');

    const dateVal = manualDatetimeInput.value;
    if (!dateVal) return alert('Fecha inválida');

    const typeRadio = document.querySelector('input[name="manual-type"]:checked');
    const type = typeRadio ? typeRadio.value : 'Pomodoro';

    // Calculate timestamps
    const startTimeDate = new Date(dateVal);
    const endTimeDate = new Date(startTimeDate.getTime() + duration * 60000);

    // Add to history
    // We construct a custom entry to inject specific timestamps
    const entry = {
        id: Date.now().toString(),
        projectName: project.name,
        duration: duration,
        type: type,
        status: 'manual', // Distinguish manual entries? Or treat as completed? Let's say 'manual' or just 'completed'. 'completed' is safe for stats.
        timestamp: endTimeDate.toISOString(), // Used for grouping date
        startTime: startTimeDate.toISOString() // Used for timeline
    };

    // Special handling: addToHistory usually generates ID/Time. 
    // We'll push directly or use a modified addToHistory.
    // Let's modify addToHistory or just push and save.
    // Existing addToHistory takes: (projectName, durationMinutes, type, status, startTime)
    // But it sets timestamp to NOW. We need it to be custom.

    // Let's push manually here to be safe and precise.
    history.unshift(entry);
    saveHistory();
    renderHistory();
    renderTimeline(); // Re-render logic handles sorting? 
    // Timeline logic filters by day, so it should pick it up.
    // History list sorts by date descending, so it should serve it correctly.

    manualModal.classList.remove('active');
    showToast('Tiempo manual agregado');
}

// --- Pomodoro Logic ---

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function toggleTimer(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    if (p.timerActive) {
        // Pause
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
        p.timerActive = false;

        // Log Pause
        const type = p.mode === 'work' ? 'Pomodoro' : 'Break';
        addToHistory(p.name, 0, type, 'paused');
    } else {
        // Start
        if (p.timeLeft <= 0) {
            // If starting from 0, reset based on current mode
            p.timeLeft = (p.mode === 'work' ? p.timerDuration : p.breakDuration) * 60;
        }

        p.timerActive = true;
        p.sessionStartTime = new Date().toISOString(); // Track when session started

        // Log "Started"
        const type = p.mode === 'work' ? 'Pomodoro' : 'Break';
        addToHistory(p.name, 0, type, 'started', p.sessionStartTime);

        activeTimers[id] = setInterval(() => {
            p.timeLeft--;
            if (p.timeLeft <= 0) {
                // Timer finished
                clearInterval(activeTimers[id]);
                delete activeTimers[id];
                p.timerActive = false;
                p.timeLeft = 0;

                playAlarm();
                const type = p.mode === 'work' ? 'Pomodoro' : 'Break';
                notifyUser(`${p.name} (${type})`);

                // Only log Pomodoros to history, optional log break
                addToHistory(p.name, p.mode === 'work' ? p.timerDuration : p.breakDuration, type, 'completed', p.sessionStartTime);

                if (p.mode === 'work') {
                    p.mode = 'break';
                    p.timeLeft = p.breakDuration * 60;
                    showToast(`¡Pomodoro terminado! Tiempo de descanso: ${p.breakDuration} min.`);
                } else {
                    p.mode = 'work';
                    p.timeLeft = p.timerDuration * 60;
                    showToast(`¡Descanso terminado! Vuelta al trabajo.`);
                }
            }
            updateCardUI(id);
            saveProjects();
        }, 1000);

        // Auto-sort to top
        const idx = projects.findIndex(x => x.id === id);
        if (idx > 0) {
            const [proj] = projects.splice(idx, 1);
            projects.unshift(proj);
            saveProjects();
        }
    }
    renderProjects(searchInput.value);
}

function stopTimer(id) {
    const p = projects.find(x => x.id === id);
    if (!p || !p.timerActive) return;

    // Stop Interval
    if (activeTimers[id]) {
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
    }
    p.timerActive = false;

    // Calculate actual duration
    const fullDurationSec = (p.mode === 'work' ? p.timerDuration : p.breakDuration) * 60;
    const elapsedSec = fullDurationSec - p.timeLeft;
    const elapsedMin = Math.floor(elapsedSec / 60); // Use full minutes

    // Log "Stopped"
    const type = p.mode === 'work' ? 'Pomodoro' : 'Break';

    // Use sessionStartTime if available, else derive
    const startTime = p.sessionStartTime || new Date(Date.now() - elapsedSec * 1000).toISOString();

    // Only log if at least 1 min or if user wants to track everything. 
    // Let's log if >= 1 min to avoid noise, or maybe 0 if they stop immediately. 
    // We'll log whatever elapsedMin is, enabling short session tracking if they last at least 1 min.
    // If < 1 min, record as 0 or 1? Let's record as 1 if > 30s? No, let's stick to Math.floor for consistency, but maybe allow decimals in future. 
    // For now, let's use Math.max(1, ...) if it was a real attempt (>10s).
    let durationToLog = elapsedMin;
    if (elapsedSec > 30 && durationToLog < 1) durationToLog = 1;

    addToHistory(p.name, durationToLog, type, 'stopped', startTime);

    // Reset Time Left to FULL duration for next time
    p.timeLeft = (p.mode === 'work' ? p.timerDuration : p.breakDuration) * 60;
    p.mode = 'work'; // Optional: Reset to work mode after stop? Or keep current? "Stopped" implies abandoning or finishing early. Let's keep current mode logic or reset. 
    // Existing logic toggles mode on finish. On stop, we probably stay or reset. Let's stay in current mode but reset timer.

    playAlarm();
    showToast(`Tarea detenida. Tiempo: ${durationToLog} min.`);
    saveProjects();
    renderProjects(searchInput.value);
}

function setDuration(id, value, type) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    const m = parseInt(value);
    if (isNaN(m) || m < 1) return;

    if (type === 'work') {
        p.timerDuration = m;
        // If currently in work mode and idle, update timeLeft
        if (p.mode === 'work' && !p.timerActive) {
            p.timeLeft = m * 60;
        }
    } else {
        p.breakDuration = m;
        // If currently in break mode and idle, update timeLeft
        if (p.mode === 'break' && !p.timerActive) {
            p.timeLeft = m * 60;
        }
    }

    saveProjects();
    renderProjects(searchInput.value);
}

function resetTimer(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    if (activeTimers[id]) {
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
    }
    p.timerActive = false;
    // Reset based on mode
    p.timeLeft = (p.mode === 'work' ? p.timerDuration : p.breakDuration) * 60;
    saveProjects();
    renderProjects(searchInput.value);
}

function switchMode(id, mode) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    // Stop if running
    if (activeTimers[id]) {
        clearInterval(activeTimers[id]);
        delete activeTimers[id];
        p.timerActive = false;
    }

    p.mode = mode;
    p.timeLeft = (mode === 'work' ? p.timerDuration : p.breakDuration) * 60;
    saveProjects();
    renderProjects(searchInput.value);
}

function updateCardUI(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    const card = document.querySelector(`.project-card[data-id="${id}"]`);
    if (card) {
        const timeDisplay = card.querySelector('.timer-display');
        if (timeDisplay) {
            timeDisplay.textContent = formatTime(p.timeLeft);
            timeDisplay.style.color = p.mode === 'break' ? 'var(--color-success)' : 'var(--color-primary)';
        }

        // Update document title if active
        if (p.timerActive) {
            const icon = p.mode === 'break' ? '☕' : '🍅';
            document.title = `${icon} (${formatTime(p.timeLeft)}) ${p.name}`;
        }
    }
}

// --- Audio Logic ---
let audioCtx = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
['click', 'keydown', 'touchstart'].forEach(event => document.addEventListener(event, initAudio, { once: true }));

function playAlarm() {
    if (!audioCtx) initAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    playBeep(now, 880, 0.2);
    playBeep(now + 0.3, 880, 0.2);
    playBeep(now + 0.6, 880, 0.4);
}

function playBeep(startTime, freq, duration) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.5, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
}

const testBtn = document.getElementById('test-audio');
if (testBtn) testBtn.addEventListener('click', () => { initAudio(); playAlarm(); showToast('Reproduciendo sonido...'); });

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted') Notification.requestPermission();
}

function notifyUser(msg) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Pomodoro Timer', { body: msg, icon: 'assets/favicon.jpg' });
    }
    showToast(msg);
}

// --- Rendering ---

function renderProjects(filter = '') {
    projectListEl.innerHTML = '';
    const term = filter.toLowerCase();

    projects
        .filter(p => !p.archived) // Only show non-archived
        .filter(p => p.name.toLowerCase().includes(term))
        .forEach(p => {
            const card = document.createElement('div');
            card.className = 'project-card';
            if (p.timerActive) card.classList.add('active-timer');
            card.dataset.id = p.id;

            const isRunning = p.timerActive;
            const btnText = isRunning ? 'Pausar' : 'Iniciar';
            const btnClass = isRunning ? 'btn-danger' : 'btn-success';

            const isWork = p.mode === 'work';
            const displayColor = isWork ? 'var(--color-primary)' : 'var(--color-success)';

            card.innerHTML = `
            <div class="card-header">
                <h2>${escapeHtml(p.name)}</h2>
                <div>
                   <button class="btn-icon" data-action="edit" title="Editar">✏️</button>
                   <button class="btn-icon" data-action="archive" title="Archivar">📦</button>
                </div>
            </div>
            <p class="card-desc">${escapeHtml(p.description || '')}</p>

            <div class="timer-section">
                <!-- Mode Switcher -->
                <div style="display:flex; justify-content:center; gap:0.5rem; margin-bottom:0.5rem; font-size:0.8rem;">
                    <button data-action="switchMode" data-mode="work" style="background:${isWork ? '#ddd' : 'transparent'}; border:1px solid #ddd; padding:2px 8px; border-radius:10px; cursor:pointer; font-weight:${isWork ? 'bold' : 'normal'}">🍅 Work</button>
                    <button data-action="switchMode" data-mode="break" style="background:${!isWork ? '#ddd' : 'transparent'}; border:1px solid #ddd; padding:2px 8px; border-radius:10px; cursor:pointer; font-weight:${!isWork ? 'bold' : 'normal'}">☕ Break</button>
                </div>

                <div class="timer-display" style="color:${displayColor}">${formatTime(p.timeLeft)}</div>

                <div class="timer-controls">
                    <button class="btn ${btnClass}" data-action="toggleTimer">${btnText}</button>
                    ${isRunning ? `<button class="btn btn-stop" data-action="stopTimer" title="Terminar y guardar tiempo real">⏹ Stop</button>` : ''}
                    <button class="btn" data-action="resetTimer" style="background:#777">Reset</button>
                </div>

                <div style="display:flex; gap:1rem; justify-content:center; margin-top:0.8rem; border-top:1px solid rgba(0,0,0,0.05); padding-top:0.5rem">
                    <div class="input-time-group">
                        <label>Trabajo:</label>
                        <input type="number" value="${p.timerDuration}" min="1" data-action="setDuration" data-mode="work" ${isRunning ? 'disabled' : ''}>
                    </div>
                     <div class="input-time-group">
                        <label>Desc.:</label>
                        <input type="number" value="${p.breakDuration}" min="1" data-action="setDuration" data-mode="break" ${isRunning ? 'disabled' : ''}>
                    </div>
                </div>
            </div>
        `;
            projectListEl.appendChild(card);
        });
}

function escapeHtml(text) { if (!text) return ''; return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function escapeAttr(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function openModalById(id) { const p = projects.find(x => x.id === id); if (p) openModal(p); }
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// --- Statistics Logic ---

function openStatsModal() {
    statsModal.classList.add('active');
    renderStats();
}

function renderStats() {
    if (!timeChartCanvas) return;

    // 1. Aggregate Data (Sum duration by Project, only Completed Pomodoros)
    const totals = {};
    // Find currently active project to highlight
    const activeProject = projects.find(p => p.timerActive);
    const activeName = activeProject ? activeProject.name : null;

    // Filter Dates
    const startVal = statsStartInput ? statsStartInput.value : '';
    const endVal = statsEndInput ? statsEndInput.value : '';

    history.forEach(item => {
        // Date Check
        const itemDate = new Date(item.timestamp);
        const year = itemDate.getFullYear();
        const month = String(itemDate.getMonth() + 1).padStart(2, '0');
        const day = String(itemDate.getDate()).padStart(2, '0');
        const itemYMD = `${year}-${month}-${day}`;

        if (startVal && itemYMD < startVal) return;
        if (endVal && itemYMD > endVal) return;

        if (item.type === 'Pomodoro' && (item.status === 'completed' || item.status === 'stopped' || item.status === 'manual')) {
            if (!totals[item.projectName]) totals[item.projectName] = 0;
            totals[item.projectName] += item.duration;
        }
    });

    // Convert to arrays for Chart.js
    const labels = Object.keys(totals);
    const data = Object.values(totals);

    // Generate Colors: Active = Green, Others = Blue
    const backgroundColors = labels.map(name =>
        name === activeName ? 'rgba(46, 204, 113, 0.8)' : 'rgba(54, 162, 235, 0.6)'
    );
    const borderColors = labels.map(name =>
        name === activeName ? 'rgba(46, 204, 113, 1)' : 'rgba(54, 162, 235, 1)'
    );

    // 2. Destroy internal chart instance if exists
    if (timeChartInstance) {
        timeChartInstance.destroy();
    }

    // Dynamic Title
    let titleText = 'Tiempo Total por Proyecto';
    if (startVal && endVal) titleText += ` (${startVal} a ${endVal})`;
    else if (startVal) titleText += ` (Desde ${startVal})`;
    else if (endVal) titleText += ` (Hasta ${endVal})`;

    // Theme-aware chart colors (labels/grid must contrast with card background)
    const isDark = document.body.dataset.theme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    const textColor = isDark ? 'hsl(210, 10%, 90%)' : 'hsl(210, 10%, 20%)';

    // 3. Render Chart
    timeChartInstance = new Chart(timeChartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Minutos Productivos',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Minutos', color: textColor },
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                },
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: titleText, color: textColor }
            }
        }
    });
}

function updateConnectionStatus(connected) {
    if (!connectionStatusEl) return;
    if (connected) {
        isServerAvailable = true;
        connectionStatusEl.style.backgroundColor = 'var(--color-success)';
        connectionStatusEl.title = 'Conectado al servidor';
    } else {
        isServerAvailable = false;
        connectionStatusEl.style.backgroundColor = 'var(--color-danger)';
    }
}

// --- Timeline Logic ---

function renderTimeline() {
    if (!timelineBarEl) return;
    timelineBarEl.innerHTML = '';

    let totalWork = 0; // minutes
    let totalRest = 0; // minutes

    // Filter history for today
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 86400000;

    let minStart = null;
    let maxEnd = null;

    // We only care about items that have some overlap with today, mainly those started today.
    history.forEach(item => {
        let startMs;
        if (item.startTime) {
            startMs = new Date(item.startTime).getTime();
        } else {
            // Fallback: timestamp is completion time (end time)
            const endMs = new Date(item.timestamp).getTime();
            // Estimate start
            startMs = endMs - (item.duration * 60000);
        }

        const endMs = startMs + (item.duration * 60000);

        // Only items from today
        if (startMs >= startOfDay && startMs < endOfDay && item.duration > 0) {
            const type = (item.type === 'Pomodoro') ? 'work' : 'break';
            const duration = item.duration; // minutes

            if (type === 'work') totalWork += duration;
            else totalRest += duration;

            // Update Start/End Markers boundaries
            if (minStart === null || startMs < minStart) minStart = startMs;
            if (maxEnd === null || endMs > maxEnd) maxEnd = endMs;

            // Render Segment
            // Minute of day (0-1440)
            const startMinute = (startMs - startOfDay) / 60000;

            const leftPct = (startMinute / 1440) * 100;
            const widthPct = (duration / 1440) * 100;

            const seg = document.createElement('div');
            seg.className = `timeline-segment ${type}`;
            seg.style.left = `${leftPct}%`;
            seg.style.width = `${Math.max(0.2, widthPct)}%`; // Min width for visibility

            // Tooltip
            const startTimeStr = new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTimeStr = new Date(endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            seg.title = `${item.projectName} (${type})\n${startTimeStr} - ${endTimeStr} (${duration}m)`;

            timelineBarEl.appendChild(seg);
        }
    });

    // Render Markers
    if (minStart !== null) {
        renderMarker(minStart, startOfDay, 'start', 'Inicio');
    }
    if (maxEnd !== null) {
        renderMarker(maxEnd, startOfDay, 'end', 'Fin');
    }

    // Update Totals
    if (timelineWorkedEl) timelineWorkedEl.textContent = `🍅 Trabajado: ${formatHrMin(totalWork)}`;
    if (timelineRestedEl) timelineRestedEl.textContent = `☕ Descanso: ${formatHrMin(totalRest)}`;
}

function renderMarker(timeMs, startOfDay, type, labelText) {
    const minute = (timeMs - startOfDay) / 60000;
    const leftPct = (minute / 1440) * 100;
    const timeStr = new Date(timeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const marker = document.createElement('div');
    marker.className = `timeline-marker ${type}`;
    marker.style.left = `${leftPct}%`;

    const label = document.createElement('div');
    label.className = 'timeline-marker-label';
    label.textContent = `${labelText} ${timeStr}`;

    marker.appendChild(label);
    timelineBarEl.appendChild(marker);
}

function formatHrMin(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
}
