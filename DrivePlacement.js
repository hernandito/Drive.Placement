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
        
        let isCompact = (savedLayout && savedLayout.settings && savedLayout.settings.compactMode) === true;
        document.body.classList.toggle('compact-mode', isCompact);

        const controlsDiv = document.querySelector('.dp-controls');
        const compactLabel = document.createElement('label');
        compactLabel.className = 'dp-btn dp-btn-secondary dp-compact-label';
        compactLabel.innerHTML = `<input type="checkbox" id="dp-compact-toggle" style="margin-right: 5px; transform: scale(1.2);" ${isCompact ? 'checked' : ''}> Compact`;
        controlsDiv.insertBefore(compactLabel, toggleBtn);

        document.getElementById('dp-compact-toggle').addEventListener('change', (e) => {
            isCompact = e.target.checked;
            document.body.classList.toggle('compact-mode', isCompact);
        });

        saveBtn.addEventListener('click', () => {
            if (isLocked) return; 
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = "⏳ Saving...";
            saveBtn.disabled = true;

            try {
                const layout = { columns: [], metadata: {}, settings: { compactMode: isCompact } };
                
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
                        notes: card.dataset.notes || ""
                    };
                });

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
            'default': '💿 HDD (Spinner)',
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
            
            renderCardContent(card, drive);
            setupCardDrag(card);
            return card;
        }

        function renderCardContent(card, drive) {
            let badgeClass = 'badge-data';
            let typeLabel = drive.type || "Data";
            
            if (typeLabel.toLowerCase().includes('parity')) badgeClass = 'badge-parity';
            if (typeLabel.toLowerCase().includes('cache')) badgeClass = 'badge-cache';
            
            if (typeLabel.toLowerCase().includes('unassigned') || typeLabel.toLowerCase().includes('flash')) {
                badgeClass = 'badge-unassigned';
                typeLabel = 'UD'; 
            }
            
            let displayName = card.dataset.customName || "";
            displayName = displayName.replace(/^(disk)(\d+)$/i, 'Disk $2');

            const mediaType = card.dataset.mediaType || "default";
            const iconHtml = mediaIcons[mediaType] || mediaIcons['default'];
            const rawSerial = card.dataset.rawSerial || "";
            const last4 = rawSerial.length >= 4 ? rawSerial.slice(-4) : rawSerial;

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

            // Injects both versions! CSS will hide/show the appropriate one based on the mode toggle.
            card.innerHTML = `
                <div class="dp-badge-container">
                    ${notesIconHtml}
                    <div class="dp-badge ${badgeClass}">${typeLabel}</div>
                </div>
                
                <div class="dp-drive-name">${displayName}</div>
                <div class="dp-drive-size">${iconHtml} ${drive.size || "Unknown"}</div>

                <div class="dp-drive-model">${drive.model || "Unknown"}</div>
                <div class="dp-drive-serial">${rawSerial}</div>
                
                <div class="dp-serial-row">
                    <div class="dp-serial-large">${last4.toUpperCase()}</div>
                    <div class="dp-action-group">
                        <button class="dp-action-btn dp-btn-delete" title="Remove Slot & Return Drive">X</button>
                        <button class="dp-action-btn dp-btn-edit" title="Edit Drive">✏️</button>
                    </div>
                </div>
                
                ${standardNotesHtml}
            `;

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
        }

        function showEditForm(card, drive) {
            const currentName = card.dataset.customName;
            const currentType = card.dataset.mediaType;
            const currentNotes = card.dataset.notes || ""; 

            card.innerHTML = `
                <div class="dp-edit-form">
                    <label style="font-size:0.8rem; font-weight:bold;">Custom Name:</label>
                    <input type="text" class="dp-edit-name" value="${currentName}">
                    
                    <label style="font-size:0.8rem; font-weight:bold; margin-top:5px;">Media Type:</label>
                    <select class="dp-edit-type">
                        <option value="default" ${currentType === 'default' ? 'selected' : ''}>Default OS Detected</option>
                        <option value="hdd" ${currentType === 'hdd' ? 'selected' : ''}>HDD (Spinner)</option>
                        <option value="ssd" ${currentType === 'ssd' ? 'selected' : ''}>SATA SSD</option>
                        <option value="nvme" ${currentType === 'nvme' ? 'selected' : ''}>NVMe</option>
                        <option value="usb" ${currentType === 'usb' ? 'selected' : ''}>USB Flash</option>
                    </select>

                    <label style="font-size:0.8rem; font-weight:bold; margin-top:5px;">Notes:</label>
                    <input type="text" class="dp-edit-notes" value="${currentNotes}" placeholder="Optional notes...">

                    <button class="dp-btn dp-btn-primary dp-save-edit" style="margin-top:10px; padding: 6px;">Update Card</button>
                </div>
            `;

            card.querySelector('.dp-save-edit').addEventListener('click', () => {
                card.dataset.customName = card.querySelector('.dp-edit-name').value;
                card.dataset.mediaType = card.querySelector('.dp-edit-type').value;
                card.dataset.notes = card.querySelector('.dp-edit-notes').value; 
                renderCardContent(card, drive); 
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

        addColBtn.addEventListener('click', () => {
            layoutGrid.appendChild(createColumnDOM("New Column"));
        });

        function setupCardDrag(card) {
            card.addEventListener('dragstart', function(e) {
                if (isLocked) { e.preventDefault(); return; }
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