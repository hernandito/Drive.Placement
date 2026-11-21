<?php
// Data layer: helper functions, $driveData (every drive), $savedLayout (layout.json)
// and $dpDark (dark-skin flag). Shared with the Dashboard tile so the two can
// never drift. See DrivePlacementData.php.
require_once "/usr/local/emhttp/plugins/driveplacement/DrivePlacementData.php";

// Dashboard-tile visibility: a marker file (managed by set-dash.php) is the
// source of truth, also read by DrivePlacementDash.page's Cond. Present = hidden.
$dpDashHidden = file_exists("/boot/config/plugins/driveplacement/.dash-hidden");
?>

<?php
// Cache-bust CSS/JS by file mtime so browsers never serve a stale pairing of the two.
$dpBase   = "/usr/local/emhttp/plugins/driveplacement";
$cssVer   = @filemtime("$dpBase/DrivePlacement.css") ?: time();
$jsVer    = @filemtime("$dpBase/DrivePlacement.js")  ?: time();
?>
<link rel="stylesheet" href="/plugins/driveplacement/DrivePlacement.css?v=<?php echo $cssVer; ?>">
<script src="/plugins/driveplacement/DrivePlacement.js?v=<?php echo $jsVer; ?>"></script>
<script>
    const serverDrives = <?php echo json_encode($driveData, JSON_INVALID_UTF8_SUBSTITUTE); ?>;
    const savedLayout = <?php echo json_encode($savedLayout, JSON_INVALID_UTF8_SUBSTITUTE); ?>;
    const dpDarkTheme = <?php echo $dpDark ? 'true' : 'false'; ?>;
    document.body.classList.toggle('dp-dark', dpDarkTheme);
</script>

<div class="dp-wrapper">
    <div class="dp-header glass-panel">
        <div class="dp-title-wrap">
            <img class="dp-case-img" src="/webGui/images/case-model.png" alt="Server case" onerror="this.style.display='none'">
            <div>
                <h2 class="dp-title">Drive Placement Map</h2>
                <p class="dp-subtitle">Map your physical server layout.</p>
            </div>
        </div>
        <div class="dp-controls">
            <button id="dp-save-layout" class="dp-btn dp-btn-success">💾 Save Layout</button>
            <button id="dp-add-column" class="dp-btn dp-btn-primary">+ Add Column</button>
            <button id="dp-toggle-mode" class="dp-btn dp-btn-secondary">Mode: <span id="dp-mode-text">Locked 🔒</span></button>
            <label class="dp-dash-toggle" title="Show a compact Drive Placement tile on the unRAID Dashboard" style="display:inline-flex;align-items:center;gap:6px;margin-left:4px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="dp-dash-tile-cb" <?php echo $dpDashHidden ? '' : 'checked'; ?>>
                <span>Dashboard tile</span>
            </label>
        </div>
    </div>

    <div id="dp-unplaced-section">
        <div class="dp-section-title">Unplaced Drives Pool</div>
        <div id="dp-unplaced-pool" class="dp-unplaced-container glass-panel"></div>
    </div>

    <div class="dp-layout-container">
        <div class="dp-section-title">Server Layout</div>
        <div id="dp-layout-grid" class="dp-layout-grid"></div>
    </div>
</div>

<script>
    // Dashboard-tile toggle: write the marker via set-dash.php. Takes effect on the
    // next Dashboard load (the tile's Cond is evaluated when the Dashboard is built).
    (function () {
        var cb = document.getElementById('dp-dash-tile-cb');
        if (!cb) return;
        cb.addEventListener('change', function () {
            var token = (typeof csrf_token !== 'undefined') ? csrf_token : '';
            fetch('/plugins/driveplacement/set-dash.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'show=' + (cb.checked ? '1' : '0') + '&csrf_token=' + encodeURIComponent(token)
            })
            .then(function (r) { return r.json(); })
            .then(function (j) { if (window.console) console.log('[DrivePlacement] dashboard tile', j); })
            .catch(function () { /* non-fatal */ });
        });
    })();
</script>
