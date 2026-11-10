document.addEventListener("DOMContentLoaded", () => {
    const unplacedSection = document.getElementById('dp-unplaced-section');
    const unplacedPool = document.getElementById('dp-unplaced-pool');
    const layoutGrid = document.getElementById('dp-layout-grid');
    const toggleBtn = document.getElementById('dp-toggle-mode');
    const addColBtn = document.getElementById('dp-add-column');
    const saveBtn = document.getElementById('dp-save-layout');
    const modeText = document.getElementById('dp-mode-text');
    
    let isLocked = true;
    document.body.classList.add('locked');
    let draggedElement = null;
    let dragType = null; 

    try {
        const customMeta = (savedLayout && savedLayout.metadata) ? savedLayout.metadata : {};

        // Per-category background colors (keys: array, parity, pool, unassigned, flash). Empty = default white.
        const CATEGORY_DEFS = [
            { key: 'array',      label: 'Array (Data)' },
            { key: 'parity',     label: 'Parity' },
            { key: 'pool',       label: 'Pool (Cache)' },
            { key: 'unassigned', label: 'Unassigned (UD)' },
            { key: 'flash',      label: 'Flash' }
        ];
        let categoryColors = (savedLayout && savedLayout.categoryColors) ? Object.assign({}, savedLayout.categoryColors) : {};

        // Shipped default tints per theme (array stays default white/dark-base). A category with
        // no explicit saved color falls back to these; a drive with an issue still overrides to red.
        const CATEGORY_DEFAULTS_LIGHT = { parity: '#eae6f9', pool: '#fdf4e4', unassigned: '#e9e9e9', flash: '#dbf1f9' };
        const CATEGORY_DEFAULTS_DARK  = { parity: '#322c40', pool: '#3a3326', unassigned: '#30333a', flash: '#26373d' };
        const categoryDefaults = document.body.classList.contains('dp-dark') ? CATEGORY_DEFAULTS_DARK : CATEGORY_DEFAULTS_LIGHT;

        // Three view densities: 'standard' | 'compact' | 'ultra'. The card markup is ALWAYS built
        // "compact"; the view mode only shows/hides blocks:
        //   standard = also show the model+serial detail block (adds .show-details)
        //   compact  = head row + usage bar + size/serial line
        //   ultra    = a single line per card (adds .ultra-mode): name - size [serial] [pill]
        // Back-compat: older layouts stored a boolean settings.compactMode.
        let viewMode = 'compact';
        if (savedLayout && savedLayout.settings) {
            if (typeof savedLayout.settings.viewMode === 'string') {
                viewMode = savedLayout.settings.viewMode;
            } else if (typeof savedLayout.settings.compactMode === 'boolean') {
                viewMode = savedLayout.settings.compactMode ? 'compact' : 'standard';
            }
        }
        document.body.classList.add('compact-mode');
        function applyViewMode(mode) {
            viewMode = mode;
            document.body.classList.toggle('show-details', mode === 'standard');
            document.body.classList.toggle('ultra-mode', mode === 'ultra');
        }
        applyViewMode(viewMode);

        const controlsDiv = document.querySelector('.dp-controls');
        const viewControl = document.createElement('div');
        viewControl.className = 'dp-viewmode';
        viewControl.innerHTML = `
            <label class="dp-vm-opt"><input type="radio" name="dp-view" value="standard"> Standard</label>
            <label class="dp-vm-opt"><input type="radio" name="dp-view" value="compact"> Compact</label>
            <label class="dp-vm-opt"><input type="radio" name="dp-view" value="ultra"> Ultra-Compact</label>
        `;
        controlsDiv.insertBefore(viewControl, toggleBtn);
        const vmChecked = viewControl.querySelector(`input[value="${viewMode}"]`);
        if (vmChecked) vmChecked.checked = true;
        // Height is a fixed 30px in CSS; the selector is vertically centered on the
        // taller Print/Mode buttons via align-self:center (no JS height-matching).

        // Category Colors button (shown only in unlocked mode)
        const catColorBtn = document.createElement('button');
        catColorBtn.id = 'dp-category-colors';
        catColorBtn.className = 'dp-btn dp-btn-secondary';
        catColorBtn.innerHTML = '🎨 Category Colors';
        controlsDiv.insertBefore(catColorBtn, toggleBtn);
        catColorBtn.addEventListener('click', openCategoryColorModal);

        // Print / Save-as-PDF button (available in both modes)
        const pdfBtn = document.createElement('button');
        pdfBtn.id = 'dp-export-pdf';
        pdfBtn.className = 'dp-btn dp-btn-secondary';
        pdfBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:6px;" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>Print';
        controlsDiv.insertBefore(pdfBtn, toggleBtn);
        pdfBtn.addEventListener('click', exportPdf);

        viewControl.addEventListener('change', (e) => {
            if (!e.target || e.target.name !== 'dp-view') return;
            applyViewMode(e.target.value);
            if (window.dpSizeColumns) requestAnimationFrame(window.dpSizeColumns);
            persistCompactPref();   // remember the view choice across page loads
        });

        // Build the full layout object from the current DOM (shared by Save and the compact-pref auto-save).
        function buildLayout() {
            const layout = { columns: [], metadata: {}, categoryColors: categoryColors, settings: { viewMode: viewMode, compactMode: viewMode !== 'standard' } };
            document.querySelectorAll('.dp-column').forEach(col => {
                const titleInput = col.querySelector('.dp-column-title');
                const title = titleInput ? titleInput.value : "Column";
                const slots = [];
                col.querySelectorAll('.dp-slot').forEach(slot => {
                    const card = slot.querySelector('.dp-card');
                    slots.push(card ? card.dataset.id : null);
                });
                layout.columns.push({ title, slots });
            });
            document.querySelectorAll('.dp-card').forEach(card => {
                layout.metadata[card.dataset.id] = {
                    name: card.dataset.customName || "",
                    mediaType: card.dataset.mediaType || "default",
                    notes: card.dataset.notes || "",
                    color: card.dataset.color || ""
                };
            });
            return layout;
        }
        // Silently persist the current layout (used when the compact toggle changes).
        function persistCompactPref() {
            try {
                $.post("/plugins/driveplacement/save.php", {
                    payload: JSON.stringify(buildLayout()),
                    csrf_token: typeof csrf_token !== 'undefined' ? csrf_token : ''
                }, "json");
            } catch (e) { /* non-critical: the Save button is the authoritative save */ }
        }

        saveBtn.addEventListener('click', () => {
            if (isLocked) return; 
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = "⏳ Saving...";
            saveBtn.disabled = true;

            try {
                const layout = buildLayout();

                $.post("/plugins/driveplacement/save.php", {
                    payload: JSON.stringify(layout),
                    csrf_token: typeof csrf_token !== 'undefined' ? csrf_token : ''
                }, "json")
                .done(function(data) {
                    if (data && data.status === 'success') {
                        saveBtn.innerHTML = "✅ Saved!";
                        saveBtn.classList.add('success-flash');
                        setTimeout(() => saveBtn.classList.remove('success-flash'), 2000);
                    } else {
                        saveBtn.innerHTML = "❌ Error";
                    }
                })
                .fail(function() { saveBtn.innerHTML = "❌ Failed"; })
                .always(function() {
                    setTimeout(() => { saveBtn.innerHTML = originalText; saveBtn.disabled = false; }, 2000);
                });

            } catch (err) {
                console.error("Save Error:", err);
                saveBtn.innerHTML = "❌ Error";
                setTimeout(() => { saveBtn.innerHTML = originalText; saveBtn.disabled = false; }, 2000);
            }
        });

        document.addEventListener('dragover', (e) => {
            if (!draggedElement) return;
            const edgeThreshold = 80; 
            const scrollSpeed = 15;
            if (e.clientY < edgeThreshold) window.scrollBy(0, -scrollSpeed);
            else if (window.innerHeight - e.clientY < edgeThreshold) window.scrollBy(0, scrollSpeed);
        });

        function checkUnplacedPool() {
            unplacedSection.style.display = unplacedPool.querySelectorAll('.dp-card').length === 0 ? 'none' : 'block';
        }

        const mediaIcons = {
            'default': '💿 HDD',
            'hdd': '<img src="/plugins/driveplacement/icons/hdd.png" alt="HDD" onerror="this.outerHTML=\'💿 HDD\'" style="height:20px;">',
            'ssd': '<img src="/plugins/driveplacement/icons/ssd.png" alt="SSD" onerror="this.outerHTML=\'⚡ SSD\'" style="height:20px;">',
            'nvme': '<img src="/plugins/driveplacement/icons/nvme.png" alt="NVMe" onerror="this.outerHTML=\'🚀 NVMe\'" style="height:20px;">',
            'usb': '<img src="/plugins/driveplacement/icons/usb.png" alt="USB" onerror="this.outerHTML=\'💾 USB Flash\'" style="height:20px;">'
        };

        function createCardDOM(drive) {
            const card = document.createElement('div');
            card.className = 'dp-card';
            card.draggable = !isLocked;
            card.dataset.id = drive.id;
            card.dataset.rawSerial = drive.serial || "Unknown";
            
            const meta = customMeta[drive.id] || {};
            card.dataset.customName = meta.name || drive.name || "Drive";
            card.dataset.mediaType = meta.mediaType || drive.mediaType || "default";
            card.dataset.notes = meta.notes || "";
            card.dataset.color = meta.color || "";   // per-card background override (hex)
            
            renderCardContent(card, drive);
            setupCardDrag(card);
            return card;
        }

        function renderCardContent(card, drive) {
            let badgeClass = 'badge-data';
            let typeLabel = drive.type || "Data";
            
            let category = 'array';
            if (typeLabel.toLowerCase().includes('parity')) { badgeClass = 'badge-parity'; category = 'parity'; }
            if (typeLabel.toLowerCase().includes('cache')) { badgeClass = 'badge-cache'; typeLabel = 'Pool'; category = 'pool'; }

            if (typeLabel.toLowerCase().includes('flash')) {
                badgeClass = 'badge-flash';
                typeLabel = 'Flash';
                category = 'flash';
            } else if (typeLabel.toLowerCase().includes('unassigned')) {
                badgeClass = 'badge-unassigned';
                typeLabel = 'UD';
                category = 'unassigned';
            }
            card.dataset.category = category;
            
            let displayName = card.dataset.customName || "";
            displayName = displayName.replace(/^(disk)(\d+)$/i, 'Disk $2');

            const mediaType = card.dataset.mediaType || "default";
            const iconHtml = mediaIcons[mediaType] || mediaIcons['default'];
            const rawSerial = card.dataset.rawSerial || "";
            const last4 = rawSerial.length >= 4 ? rawSerial.slice(-4) : rawSerial;

            // --- temperature: pill badge after the name, tinted by category ---
            const temp = (drive.temp !== null && drive.temp !== undefined) ? drive.temp : null;
            let tempHtml = "";
            if (temp !== null) {
                const tc = temp >= 55 ? 'temp-hot' : (temp >= 45 ? 'temp-warm' : (temp <= 32 ? 'temp-cool' : 'temp-ok'));
                const band = temp >= 55 ? 'Hot - check airflow/cooling'
                           : temp >= 45 ? 'Warm - a little high, normal under heavy load'
                           : temp <= 32 ? 'Cool'
                           : 'Normal operating range';
                const tTitle = `${temp}°C - ${band}  (cool ≤32° · normal 33-44° · warm 45-54° · hot ≥55°)`;
                tempHtml = `<span class="dp-temp ${tc}" title="${tTitle}">${temp}&deg;</span>`;
            } else if (drive.spundown) {
                tempHtml = `<span class="dp-temp temp-sleep" title="Drive is spun down (asleep) - no temperature reported">Zzz</span>`;
            }

            // --- usage: short monochrome bar + "Free: x.xx TB" (filesystem drives only) ---
            const usedPct = (drive.usedPct !== null && drive.usedPct !== undefined) ? drive.usedPct : null;
            const partitions = Array.isArray(drive.partitions) ? drive.partitions : [];
            let usageHtml = "";
            if (drive.mounted === false && partitions.length === 0) {
                // An unmounted UD device has no filesystem usage to show - flag it in the usage spot.
                usageHtml = `<span class="dp-notmounted" title="This device is not mounted - no filesystem usage available">Not mounted</span>`;
            } else if (usedPct !== null) {
                const sizeTxt = drive.size ? ' of ' + drive.size : '';
                const freePct = 100 - usedPct;
                const barTtl = `${usedPct}% used${sizeTxt}` + (drive.freeLabel ? `  ·  ${drive.freeLabel} free (${freePct}% free)` : '');
                const freeTtl = drive.freeLabel ? `Free space: ${drive.freeLabel} (${freePct}% free)${sizeTxt}` : 'Free space';
                const freeTxt = drive.freeLabel ? `Free: ${drive.freeLabel} - ${freePct}%` : `${freePct}% free`;
                usageHtml = `<span class="dp-usage" title="${barTtl}"><span class="dp-usage-fill" style="width:${usedPct}%"></span></span>` +
                            `<span class="dp-free" title="${freeTtl}">${freeTxt}</span>`;
            }

            // --- filesystem format label (xfs / ntfs / zfs ...) shown under the drive size ---
            const fmt = (drive.format || "").trim();
            const fmtHtml = fmt ? `<span class="dp-fmt" title="Filesystem: ${fmt.toUpperCase()}">${fmt}</span>` : "";

            // --- per-partition sub-lines (UD drives with more than one partition) ---
            let partsHtml = "";
            if (partitions.length > 1) {
                const rows = partitions.map(p => {
                    const pName = p.name || "part";
                    const pFmt = (p.format || "").trim();
                    const pFmtHtml = pFmt ? `<span class="dp-part-fmt">${pFmt}</span>` : "";
                    let pUse;
                    if (p.mounted === false) {
                        pUse = `<span class="dp-notmounted dp-part-nm" title="Partition is not mounted">Not mounted</span>`;
                    } else if (p.usedPct !== null && p.usedPct !== undefined) {
                        const pTtl = `${p.usedPct}% used` + (p.freeLabel ? `  ·  ${p.freeLabel} free` : '');
                        pUse = `<span class="dp-usage" title="${pTtl}"><span class="dp-usage-fill" style="width:${p.usedPct}%"></span></span>` +
                               (p.freeLabel ? `<span class="dp-free">${p.freeLabel}</span>` : '');
                    } else {
                        pUse = "";
                    }
                    return `<div class="dp-part"><span class="dp-part-name" title="${pName}">${pName}</span>${pFmtHtml}${pUse}</div>`;
                }).join('');
                partsHtml = `<div class="dp-parts">${rows}</div>`;
            }

            const notesText = card.dataset.notes || "";
            
            // Constructs the tooltip icon (used in compact mode)
            const notesIconHtml = notesText ? `
                <div class="dp-notes-wrapper">
                    <i class="fa fa-info-circle dp-notes-icon"></i>
                    <div class="dp-notes-tooltip">${notesText}</div>
                </div>
            ` : "";

            // Constructs the standard 2-line notes (used in normal mode)
            const standardNotesHtml = notesText ? `<div class="dp-drive-notes">${notesText}</div>` : "";

            const badgeTitles = { array: 'Array data disk', parity: 'Parity disk', pool: 'Cache pool device', unassigned: 'Unassigned device (UD)', flash: 'unRAID boot flash' };
            const badgeTitle = badgeTitles[category] || '';
            const serialTitle = [drive.model, rawSerial].filter(Boolean).join('  ·  ');
            const bulbSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>`;

            // The card is always laid out "compact". The .dp-detail block (model + full serial) sits
            // between the head row and the main line, and is shown only when "Compact" is unchecked.
            card.innerHTML = `
                <div class="dp-ultra-line">
                    <span class="dp-ultra-name">${displayName}</span>
                    <span class="dp-ultra-sep">-</span>
                    <span class="dp-ultra-size">${drive.size || ""}</span>
                    <span class="dp-ultra-serial" title="${serialTitle}">${last4.toUpperCase()}</span>
                    <div class="dp-badge ${badgeClass}" title="${badgeTitle}">${typeLabel}</div>
                </div>
                <div class="dp-head-row">
                    <span class="dp-drive-name">${displayName}</span>
                    ${tempHtml}
                    <div class="dp-badge-container">
                        ${notesIconHtml}
                        <div class="dp-badge ${badgeClass}" title="${badgeTitle}">${typeLabel}</div>
                    </div>
                </div>
                ${usageHtml ? `<div class="dp-usage-row">${usageHtml}</div>` : ""}

                <div class="dp-detail">
                    <div class="dp-drive-model">${drive.model || "Unknown"}</div>
                    <div class="dp-drive-serial">${rawSerial}</div>
                </div>

                <div class="dp-main">
                    <div class="dp-drive-size">
                        ${iconHtml}
                        <span class="dp-size-stack">
                            <span class="dp-size-val">${drive.size || "Unknown"}</span>
                            ${fmtHtml}
                        </span>
                    </div>

                    <div class="dp-serial-row">
                        <button class="dp-led" title="Identify this drive - blink its activity LED" data-serial="${rawSerial}">${bulbSvg}</button>
                        <div class="dp-serial-large" title="${serialTitle}">${last4.toUpperCase()}</div>
                        <div class="dp-action-group">
                            <button class="dp-action-btn dp-btn-delete" title="Remove Slot & Return Drive">X</button>
                            <button class="dp-action-btn dp-btn-edit" title="Edit Drive">✏️</button>
                        </div>
                    </div>
                </div>

                ${partsHtml}
                ${standardNotesHtml}
            `;

            card.classList.toggle('dp-issue', drive.health === 'issue');
            card.classList.toggle('dp-spundown', !!drive.spundown);
            card.classList.toggle('has-notes', !!notesText);
            card.classList.toggle('has-parts', partitions.length > 1);
            applyCardColor(card);

            card.querySelector('.dp-btn-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                showEditForm(card, drive);
            });

            card.querySelector('.dp-btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = card.closest('.dp-slot');
                if (slot) {
                    unplacedPool.appendChild(card);
                    slot.remove();
                    checkUnplacedPool();
                }
            });

            // Identify: blink the drive's activity LED (works in locked mode too)
            const ledBtn = card.querySelector('.dp-led');
            if (ledBtn) {
                ledBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                ledBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const serial = ledBtn.dataset.serial;
                    if (!serial || ledBtn.classList.contains('blinking')) return;
                    const secs = 8;
                    ledBtn.classList.add('blinking');
                    ledBtn.disabled = true;
                    $.post('/plugins/driveplacement/identify.php', {
                        serial: serial,
                        seconds: secs,
                        csrf_token: (typeof csrf_token !== 'undefined' ? csrf_token : '')
                    }).always(() => {
                        setTimeout(() => { ledBtn.classList.remove('blinking'); ledBtn.disabled = false; }, secs * 1000 + 500);
                    });
                });
            }
        }

        function showEditForm(card, drive) {
            const currentName = card.dataset.customName;
            const currentType = card.dataset.mediaType;
            const currentNotes = card.dataset.notes || "";
            const currentColor = card.dataset.color || "";

            // A draggable ancestor suppresses text selection in child inputs, so turn drag OFF
            // on both the card AND its column while the edit form is open (restored on save).
            card.draggable = false;
            const editCol = card.closest('.dp-column');
            if (editCol) editCol.draggable = false;

            card.innerHTML = `
                <div class="dp-edit-form">
                    <label style="font-size:1.2rem; font-weight:bold;">Custom Name:</label>
                    <input type="text" class="dp-edit-name" value="${currentName}">

                    <label style="font-size:1.2rem; font-weight:bold; margin-top:5px;">Media Type:</label>
                    <select class="dp-edit-type">
                        <option value="default" ${currentType === 'default' ? 'selected' : ''}>Default OS Detected</option>
                        <option value="hdd" ${currentType === 'hdd' ? 'selected' : ''}>HDD</option>
                        <option value="ssd" ${currentType === 'ssd' ? 'selected' : ''}>SATA SSD</option>
                        <option value="nvme" ${currentType === 'nvme' ? 'selected' : ''}>NVMe</option>
                        <option value="usb" ${currentType === 'usb' ? 'selected' : ''}>USB Flash</option>
                    </select>

                    <label style="font-size:1.2rem; font-weight:bold; margin-top:5px;">Notes:</label>
                    <input type="text" class="dp-edit-notes" value="${currentNotes}" placeholder="Optional notes...">

                    <label style="font-size:1.2rem; font-weight:bold; margin-top:5px;">Card Background:</label>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <input type="color" class="dp-edit-color-pick" value="${currentColor || '#ffffff'}" style="width:38px; height:30px; padding:0; border:1px solid #cbd5e1; border-radius:4px;">
                        <input type="text" class="dp-edit-color-hex" value="${currentColor}" placeholder="default (blank)" spellcheck="false" style="flex:1;">
                        <button type="button" class="dp-edit-color-clear dp-btn dp-btn-secondary" style="padding:4px 8px; font-size:0.85rem;">Default</button>
                    </div>

                    <button class="dp-btn dp-btn-primary dp-save-edit" style="margin-top:10px; padding: 6px;">Update Card</button>
                </div>
            `;

            const colorPick = card.querySelector('.dp-edit-color-pick');
            const colorHex = card.querySelector('.dp-edit-color-hex');
            colorPick.addEventListener('input', () => { colorHex.value = colorPick.value; });
            colorHex.addEventListener('input', () => { const v = normalizeHex(colorHex.value); if (v) colorPick.value = v; });
            card.querySelector('.dp-edit-color-clear').addEventListener('click', () => { colorHex.value = ''; colorPick.value = '#ffffff'; });

            card.querySelector('.dp-save-edit').addEventListener('click', () => {
                card.dataset.customName = card.querySelector('.dp-edit-name').value;
                card.dataset.mediaType = card.querySelector('.dp-edit-type').value;
                card.dataset.notes = card.querySelector('.dp-edit-notes').value;
                card.dataset.color = normalizeHex(card.querySelector('.dp-edit-color-hex').value);
                renderCardContent(card, drive);
                card.draggable = !isLocked;   // restore drag now the form is closed
                if (editCol) editCol.draggable = !isLocked;
                if (!isLocked && saveBtn) saveBtn.click();  // persist immediately
            });
        }

        function createColumnDOM(titleText) {
            const col = document.createElement('div');
            col.className = 'dp-column';
            col.draggable = !isLocked;

            col.innerHTML = `
                <div class="dp-column-header">
                    <input type="text" class="dp-column-title" value="${titleText}">
                    <div class="dp-column-actions">
                        <button class="dp-col-btn dp-add-row" title="Add Slot">+ SLOT</button>
                        <button class="dp-col-btn dp-del-col" title="Delete Column">🗑️</button>
                    </div>
                </div>
                <div class="dp-column-slots"></div>
            `;

            col.querySelector('.dp-add-row').addEventListener('click', () => {
                col.querySelector('.dp-column-slots').appendChild(createEmptySlot());
            });

            col.querySelector('.dp-del-col').addEventListener('click', () => {
                if (confirm("Delete this column? All drives inside will be returned to the Unplaced Pool.")) {
                    col.querySelectorAll('.dp-card').forEach(card => unplacedPool.appendChild(card));
                    col.remove();
                    checkUnplacedPool();
                }
            });

            setupColumnDrag(col);
            return col;
        }

        function createEmptySlot() {
            const slot = document.createElement('div');
            slot.className = 'dp-slot';
            
            const delEmptyBtn = document.createElement('button');
            delEmptyBtn.className = 'dp-del-empty-slot';
            delEmptyBtn.innerHTML = 'X';
            delEmptyBtn.title = 'Remove Empty Slot';
            delEmptyBtn.addEventListener('click', () => {
                slot.remove();
                checkUnplacedPool();
            });
            slot.appendChild(delEmptyBtn);
            
            slot.addEventListener('dragover', (e) => {
                if(dragType === 'card' && !isLocked) {
                    e.preventDefault();
                    slot.classList.add('drag-over');
                }
            });

            slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));

            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
                if (dragType === 'card' && !isLocked && draggedElement) {
                    if (slot.querySelector('.dp-card')) unplacedPool.appendChild(slot.querySelector('.dp-card'));
                    slot.appendChild(draggedElement);
                    checkUnplacedPool();
                }
            });
            return slot;
        }

        let unplacedDrives = Array.isArray(serverDrives) ? [...serverDrives] : []; 
        
        if (savedLayout && savedLayout.columns && savedLayout.columns.length > 0) {
            savedLayout.columns.forEach(colData => {
                const col = createColumnDOM(colData.title);
                colData.slots.forEach(driveId => {
                    const slot = createEmptySlot();
                    if (driveId) {
                        const driveIndex = unplacedDrives.findIndex(d => d.id === driveId);
                        if (driveIndex > -1) {
                            slot.appendChild(createCardDOM(unplacedDrives[driveIndex]));
                            unplacedDrives.splice(driveIndex, 1); 
                        }
                    }
                    col.querySelector('.dp-column-slots').appendChild(slot);
                });
                layoutGrid.appendChild(col);
            });
        }

        unplacedDrives.forEach(drive => unplacedPool.appendChild(createCardDOM(drive)));
        checkUnplacedPool();

        // ---- Size each column to its widest card, in pixels ----
        // CSS max-content sizing gets overridden by unRAID's global stylesheet, so we
        // measure the real rendered content (immune to that) and set explicit widths.
        function sizeColumns() {
            const compact = document.body.classList.contains('compact-mode');
            const ultra = document.body.classList.contains('ultra-mode');
            const cols = [...layoutGrid.querySelectorAll('.dp-column')];
            if (!cols.length) return;
            cols.forEach(c => { c.style.width = ''; c.style.flex = ''; });  // reset before measuring
            document.body.classList.add('dp-measuring');
            const widths = cols.map(col => {
                let need = 0;
                col.querySelectorAll('.dp-card').forEach(card => {
                    if (ultra) {
                        const ul = card.querySelector('.dp-ultra-line');
                        let uw = 0;
                        if (ul) {
                            const uk = [...ul.children].filter(k => k.offsetWidth > 0);
                            uw = uk.reduce((a, k) => a + k.offsetWidth, 0) + Math.max(0, uk.length - 1) * 8;
                        }
                        if (uw > need) need = uw;
                        return;
                    }
                    const hr = card.querySelector('.dp-head-row');
                    let headW = 0;
                    if (hr) {
                        const kids = [...hr.children].filter(k => k.offsetWidth > 0);
                        headW = kids.reduce((a, k) => a + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * 7;
                    }
                    let mainW = 0;
                    const mn = card.querySelector('.dp-main');
                    if (mn) {
                        if (compact) {
                            const kids = [...mn.children].filter(k => k.offsetWidth > 0);
                            mainW = kids.reduce((a, k) => a + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * 10;
                        } else {
                            // Non-compact width is driven only by the size line + serial box (same as compact).
                            // The drive model and full serial WRAP within that width - they add height, not width.
                            mn.querySelectorAll(':scope > .dp-drive-size, :scope > .dp-serial-row').forEach(k => {
                                if (k.scrollWidth > mainW) mainW = k.scrollWidth;
                            });
                        }
                    }
                    const w = Math.max(headW, mainW);
                    if (w > need) need = w;
                });
                return Math.ceil(need) + 28; // card padding (10+10) + border + sub-pixel buffer
            });
            document.body.classList.remove('dp-measuring');
            cols.forEach((col, i) => {
                const w = Math.max(widths[i], 250); // 250px floor
                col.style.flex = '0 0 ' + w + 'px';
                col.style.width = w + 'px';
            });
        }
        window.dpSizeColumns = sizeColumns;
        requestAnimationFrame(sizeColumns);
        window.addEventListener('load', sizeColumns);
        setTimeout(sizeColumns, 400); // re-run once drive icons have loaded

        // ---- Background colors (per-card override + per-category) ----
        function normalizeHex(s) {
            if (!s) return '';
            s = String(s).trim();
            if (s && s[0] !== '#') s = '#' + s;
            return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s) ? s : '';
        }
        function applyCardColor(card) {
            // A failed drive always shows the CSS red, overriding any chosen color.
            if (card.classList.contains('dp-issue')) { card.style.background = ''; return; }
            const custom = card.dataset.color || '';
            const cat = card.dataset.category || 'array';
            const bg = custom || categoryColors[cat] || categoryDefaults[cat] || '';
            card.style.background = bg; // '' falls back to the default (white / dark base) in CSS
        }
        function reapplyAllColors() {
            document.querySelectorAll('.dp-card').forEach(applyCardColor);
        }
        function openCategoryColorModal() {
            const existing = document.getElementById('dp-cat-modal');
            if (existing) existing.remove();
            const overlay = document.createElement('div');
            overlay.id = 'dp-cat-modal';
            overlay.className = 'dp-modal-overlay';
            const rows = CATEGORY_DEFS.map(c => {
                const val = categoryColors[c.key] || '';          // explicit override only
                const def = categoryDefaults[c.key] || '';         // shipped themed default
                const eff = val || def || '#ffffff';               // what the card actually shows
                const ph = def ? def + ' (default)' : 'default (white)';
                return `<div class="dp-cat-row" data-key="${c.key}" data-default="${def}">
                    <span class="dp-cat-label">${c.label}</span>
                    <span class="dp-cat-swatch" style="background:${eff}"></span>
                    <input type="color" class="dp-cat-pick" value="${eff}">
                    <input type="text" class="dp-cat-hex" value="${val}" placeholder="${ph}" spellcheck="false">
                    <button type="button" class="dp-cat-reset">Default</button>
                </div>`;
            }).join('');
            overlay.innerHTML = `
                <div class="dp-modal">
                    <div class="dp-modal-head">
                        <h3>Category Background Colors</h3>
                        <button type="button" class="dp-modal-x" title="Close">&times;</button>
                    </div>
                    <p class="dp-modal-note">Blank = default (white). A drive with an issue always shows red, overriding these. Click <b>Save Layout</b> afterwards to keep the colors.</p>
                    <div class="dp-cat-list">${rows}</div>
                    <div class="dp-modal-foot">
                        <button type="button" class="dp-btn dp-btn-secondary dp-cat-cancel">Cancel</button>
                        <button type="button" class="dp-btn dp-btn-primary dp-cat-apply">Apply</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelectorAll('.dp-cat-row').forEach(row => {
                const pick = row.querySelector('.dp-cat-pick');
                const hex = row.querySelector('.dp-cat-hex');
                const sw = row.querySelector('.dp-cat-swatch');
                const def = row.dataset.default || '#ffffff';
                pick.addEventListener('input', () => { hex.value = pick.value; sw.style.background = pick.value; });
                hex.addEventListener('input', () => {
                    const v = normalizeHex(hex.value);
                    sw.style.background = v || def;
                    if (v) pick.value = v;
                });
                row.querySelector('.dp-cat-reset').addEventListener('click', () => {
                    hex.value = ''; pick.value = def; sw.style.background = def;   // back to shipped default
                });
            });
            const close = () => overlay.remove();
            overlay.querySelector('.dp-modal-x').addEventListener('click', close);
            overlay.querySelector('.dp-cat-cancel').addEventListener('click', close);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            overlay.querySelector('.dp-cat-apply').addEventListener('click', () => {
                overlay.querySelectorAll('.dp-cat-row').forEach(row => {
                    const key = row.dataset.key;
                    const v = normalizeHex(row.querySelector('.dp-cat-hex').value);
                    if (v) categoryColors[key] = v; else delete categoryColors[key];
                });
                reapplyAllColors();
                if (!isLocked && saveBtn) saveBtn.click();  // persist immediately
                close();
            });
        }

        // ---- Export a clean, print-ready REPORT (Save as PDF) ----
        // Not a clone of the UI: a grouped inventory report, sans-serif, letter/A4 sized,
        // color used only for hierarchy (title bar, section headers, category dots, red issues).
        function exportPdf() {
            const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
                c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const CAT_DOT = { array: '#22c55e', parity: '#8b5cf6', pool: '#f59e0b', unassigned: '#9ca3af', flash: '#0ea5e9' };
            const CAT_NAME = { array: 'Data', parity: 'Parity', pool: 'Pool', unassigned: 'UD', flash: 'Flash' };
            const ISSUE = '#dc2626';

            const driveMap = {};
            (typeof serverDrives !== 'undefined' && Array.isArray(serverDrives) ? serverDrives : [])
                .forEach(d => { driveMap[d.id] = d; });

            const cols = [...document.querySelectorAll('#dp-layout-grid .dp-column')];
            let totalDrives = 0;
            const sections = [];
            cols.forEach(col => {
                const titleEl = col.querySelector('.dp-column-title');
                const title = (titleEl && (titleEl.value || titleEl.textContent) || 'Column').trim();
                const cards = [...col.querySelectorAll('.dp-card')];
                if (!cards.length) return;
                const rows = cards.map(card => {
                    const d = driveMap[card.dataset.id] || {};
                    let name = (card.dataset.customName || d.name || 'Drive');
                    name = name.replace(/^(disk)(\d+)$/i, 'Disk $2');
                    const cat = card.dataset.category || 'array';
                    const rawSerial = card.dataset.rawSerial || d.serial || '';
                    const last4 = rawSerial.length >= 4 ? rawSerial.slice(-4) : rawSerial;
                    const issue = card.classList.contains('dp-issue');
                    const spun = card.classList.contains('dp-spundown');
                    const temp = (d.temp !== null && d.temp !== undefined) ? d.temp + '°' : (spun ? 'asleep' : '');
                    const usedPct = (d.usedPct !== null && d.usedPct !== undefined) ? d.usedPct : null;
                    const subParts = [CAT_NAME[cat] || 'Data', d.size || ''].filter(Boolean);
                    if (temp) subParts.push(temp);
                    if (usedPct !== null) subParts.push(usedPct + '% used');
                    if (d.freeLabel) subParts.push('Free ' + d.freeLabel);
                    const dot = issue ? ISSUE : (CAT_DOT[cat] || '#9ca3af');
                    totalDrives++;
                    return '<div class="rpt-drive">' +
                        '<span class="dot" style="background:' + dot + '"></span>' +
                        '<div class="mid">' +
                            '<div class="nm">' + esc(name) +
                                (issue ? '<span class="chip">ISSUE</span>' : '') + '</div>' +
                            '<div class="sub">' + esc(subParts.join('  ·  ')) + '</div>' +
                            (d.model ? '<div class="mdl">' + esc(d.model) + '</div>' : '') +
                            (rawSerial ? '<div class="sn">S/N: ' + esc(rawSerial) + '</div>' : '') +
                        '</div>' +
                        '<span class="r4">' + esc(last4) + '</span>' +
                    '</div>';
                }).join('');
                sections.push('<section class="rpt-sec">' +
                    '<div class="rpt-sec-h">' + esc(title) + '<span class="cnt">' + cards.length + ' drive' + (cards.length === 1 ? '' : 's') + '</span></div>' +
                    rows + '</section>');
            });

            const orient = sections.length >= 3 ? 'landscape' : 'portrait';
            const when = new Date().toLocaleString();
            const legend = Object.keys(CAT_DOT).map(k =>
                '<span class="lg"><span class="lg-dot" style="background:' + CAT_DOT[k] + '"></span>' + CAT_NAME[k] + '</span>').join('') +
                '<span class="lg"><span class="lg-dot" style="background:' + ISSUE + '"></span>Issue</span>';

            const css =
                '@page { size: ' + orient + '; margin: 12mm; }' +
                '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }' +
                'html,body { margin:0; background:#fff; color:#111827; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:10pt; }' +
                '.rpt-head { display:flex; justify-content:space-between; align-items:center; background:#1f2937; color:#fff; padding:11px 16px; border-radius:6px; }' +
                '.rpt-head h1 { margin:0; font-size:16pt; font-weight:700; letter-spacing:.3px; }' +
                '.rpt-head .when { font-size:9pt; color:#cbd5e1; }' +
                '.rpt-legend { display:flex; flex-wrap:wrap; gap:14px; margin:9px 2px 13px; font-size:8pt; color:#4b5563; }' +
                '.rpt-legend .lg { display:flex; align-items:center; gap:5px; }' +
                '.lg-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }' +
                '.rpt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(235px,1fr)); gap:11px; align-items:start; }' +
                '.rpt-sec { border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; break-inside:avoid; }' +
                '.rpt-sec-h { display:flex; justify-content:space-between; align-items:center; background:#334155; color:#fff; padding:6px 10px; font-size:10.5pt; font-weight:600; }' +
                '.rpt-sec-h .cnt { font-size:8pt; font-weight:500; color:#cbd5e1; }' +
                '.rpt-drive { display:flex; gap:8px; padding:6px 10px; border-top:1px solid #f1f5f9; align-items:flex-start; break-inside:avoid; }' +
                '.rpt-drive .dot { width:9px; height:9px; border-radius:50%; margin-top:3px; flex:0 0 auto; }' +
                '.rpt-drive .mid { flex:1; min-width:0; }' +
                '.rpt-drive .nm { font-size:10pt; font-weight:600; color:#111827; }' +
                '.rpt-drive .nm .chip { font-size:6.5pt; font-weight:700; color:#fff; background:' + ISSUE + '; padding:1px 5px; border-radius:3px; margin-left:6px; letter-spacing:.5px; vertical-align:1px; }' +
                '.rpt-drive .sub { font-size:8pt; color:#6b7280; margin-top:1px; }' +
                '.rpt-drive .mdl { font-size:7.5pt; color:#9ca3af; margin-top:1px; word-break:break-all; }' +
                '.rpt-drive .sn { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:9pt; font-weight:700; color:#da0909; margin-top:1px; word-break:break-all; }' +
                '.rpt-drive .r4 { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12pt; font-weight:700; letter-spacing:1px; color:#334155; margin-left:auto; flex:0 0 auto; align-self:center; }' +
                '.rpt-foot { margin-top:12px; font-size:8pt; color:#9ca3af; text-align:right; }';

            const html = '<!doctype html><html><head><meta charset="utf-8"><title>Drive Placement Report</title>' +
                '<style>' + css + '</style></head><body>' +
                '<div class="rpt-head"><h1>Drive Placement Map</h1><span class="when">' + esc(when) + '</span></div>' +
                '<div class="rpt-legend">' + legend + '</div>' +
                '<div class="rpt-grid">' + sections.join('') + '</div>' +
                '<div class="rpt-foot">' + totalDrives + ' drives across ' + sections.length + ' location' + (sections.length === 1 ? '' : 's') + ' · Drive Placement</div>' +
                '</body></html>';

            const w = window.open('', '_blank');
            if (!w) { alert('Please allow pop-ups for this page to export the PDF.'); return; }
            w.document.write(html);
            w.document.close();
            const go = () => setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 300);
            if (w.document.readyState === 'complete') go();
            else w.addEventListener('load', go);
        }

        addColBtn.addEventListener('click', () => {
            layoutGrid.appendChild(createColumnDOM("New Column"));
        });

        function setupCardDrag(card) {
            card.addEventListener('dragstart', function(e) {
                if (isLocked) { e.preventDefault(); return; }
                // Don't start a card drag when interacting with the edit form / its fields,
                // so text (e.g. the hex color) can be selected and copied normally.
                if (e.target.closest('.dp-edit-form') ||
                    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'LABEL'].includes(e.target.tagName)) {
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
                draggedElement = this;
                dragType = 'card';
                setTimeout(() => this.style.opacity = '0.4', 0);
            });
            card.addEventListener('dragend', function() {
                setTimeout(() => {
                    this.style.opacity = '1';
                    draggedElement = null;
                    dragType = null;
                    checkUnplacedPool();
                }, 0);
            });
        }

        function setupColumnDrag(col) {
            col.addEventListener('dragstart', function(e) {
                if (isLocked || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('.dp-card')) {
                    e.preventDefault(); return;
                }
                draggedElement = this;
                dragType = 'column';
                setTimeout(() => this.style.opacity = '0.4', 0);
            });
            col.addEventListener('dragend', function() {
                setTimeout(() => {
                    this.style.opacity = '1';
                    draggedElement = null;
                    dragType = null;
                }, 0);
            });
            col.addEventListener('dragover', function(e) {
                if(dragType === 'column' && !isLocked) e.preventDefault();
            });
            col.addEventListener('drop', function(e) {
                if (dragType === 'column' && this !== draggedElement && !isLocked) {
                    e.preventDefault();
                    let allCols = [...layoutGrid.querySelectorAll('.dp-column')];
                    let draggedIndex = allCols.indexOf(draggedElement);
                    let droppedIndex = allCols.indexOf(this);
                    if (draggedIndex < droppedIndex) this.parentNode.insertBefore(draggedElement, this.nextSibling);
                    else this.parentNode.insertBefore(draggedElement, this);
                }
            });
        }

        unplacedPool.addEventListener('dragover', (e) => { if(dragType === 'card' && !isLocked) e.preventDefault(); });
        unplacedPool.addEventListener('drop', (e) => {
            if (dragType === 'card' && !isLocked && draggedElement) {
                e.preventDefault();
                unplacedPool.appendChild(draggedElement);
            }
        });

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isLocked = !isLocked;
            document.body.classList.toggle('locked', isLocked);
            modeText.innerText = isLocked ? "Locked 🔒" : "Unlocked 🔓";
            document.querySelectorAll('.dp-card, .dp-column').forEach(el => el.draggable = !isLocked);
        });

    } catch (criticalError) {
        console.error("UI Render Crash:", criticalError);
        layoutGrid.innerHTML = `<div style="padding: 20px; background: #fee2e2; border: 2px solid #ef4444; border-radius: 8px; color: #991b1b; max-width: 600px;">
            <h3 style="margin-top:0;">🚨 Critical Render Error</h3>
            <p>The Javascript failed to build the layout. Error details:</p>
            <pre style="background: white; padding: 10px; border-radius: 4px; overflow-x: auto;">${criticalError.toString()}</pre>
        </div>`;
    }
});