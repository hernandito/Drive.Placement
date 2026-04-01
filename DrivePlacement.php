<?php
function formatSize($bytes) {
    if (!is_numeric($bytes) || $bytes <= 0) return 'Unknown';
    $tb = $bytes / 1000000000000; 
    if ($tb >= 0.9) return round($tb) . ' TB';
    return round($bytes / 1000000000) . ' GB';
}

$disks = parse_ini_file("/var/local/emhttp/disks.ini", true);
$driveData = [];
$assignedDevices = []; 

foreach ($disks as $diskName => $data) {
    if (empty($data['id']) || $data['status'] === 'DISK_NP') continue;
    if (!empty($data['device'])) $assignedDevices[] = $data['device']; 
    
    $driveData[] = [
        'id' => $data['id'],
        'name' => $data['name'],
        'model' => $data['model'] ?? 'Unknown',
        'serial' => $data['id'] ?? 'Unknown',
        'size' => formatSize($data['size'] ?? 0),
        'type' => $data['type'] ?? 'Data', 
        'mediaType' => 'default'
    ];
}

$lsblk_output = shell_exec('lsblk -n -d -P -b -o NAME,MODEL,SERIAL,SIZE,ROTA 2>/dev/null');
$lines = explode("\n", trim($lsblk_output));

foreach ($lines as $line) {
    if (empty($line)) continue;
    preg_match_all('/([A-Z]+)="([^"]*)"/', $line, $matches);
    $diskInfo = [];
    foreach ($matches[1] as $index => $key) {
        $diskInfo[$key] = trim($matches[2][$index]);
    }
    $devName = $diskInfo['NAME'] ?? '';
    
    if (strpos($devName, 'loop') === 0 || strpos($devName, 'ram') === 0 || strpos($devName, 'md') === 0 || strpos($devName, 'zram') === 0 || in_array($devName, $assignedDevices)) continue;

    $serial = !empty($diskInfo['SERIAL']) ? $diskInfo['SERIAL'] : $devName;
    $driveData[] = [
        'id' => "ud_" . md5($serial . $devName),
        'name' => 'Mount: /dev/' . strtolower($devName),
        'model' => !empty($diskInfo['MODEL']) ? $diskInfo['MODEL'] : 'Unknown',
        'serial' => $serial,
        'size' => formatSize($diskInfo['SIZE'] ?? 0),
        'type' => 'Unassigned',
        'mediaType' => 'default'
    ];
}
?>

<link rel="stylesheet" href="/plugins/driveplacement/DrivePlacement.css">
<script src="/plugins/driveplacement/DrivePlacement.js"></script>
<script>
    const serverDrives = <?php echo json_encode($driveData, JSON_INVALID_UTF8_SUBSTITUTE); ?>;
    <?php
    $layoutFile = "/boot/config/plugins/driveplacement/layout.json";
    $savedLayout = file_exists($layoutFile) ? json_decode(file_get_contents($layoutFile), true) : null;
    ?>
    const savedLayout = <?php echo json_encode($savedLayout, JSON_INVALID_UTF8_SUBSTITUTE); ?>;
</script>

<div class="dp-wrapper">
    <div class="dp-header glass-panel">
        <div>
            <h2 class="dp-title">Drive Placement Map</h2>
            <p class="dp-subtitle">Map your physical server layout.</p>
        </div>
        <div class="dp-controls">
            <button id="dp-save-layout" class="dp-btn dp-btn-success">💾 Save Layout</button>
            <button id="dp-add-column" class="dp-btn dp-btn-primary">+ Add Column</button>
            <button id="dp-toggle-mode" class="dp-btn dp-btn-secondary">Mode: <span id="dp-mode-text">Locked 🔒</span></button>
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