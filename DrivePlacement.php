<?php
function formatSize($bytes) {
    if (!is_numeric($bytes) || $bytes <= 0) return 'Unknown';
    $tb = $bytes / 1000000000000;
    if ($tb >= 0.9) return round($tb) . ' TB';
    return round($bytes / 1000000000) . ' GB';
}
// Like formatSize but keeps 2 decimals for TB (used for the "Free:" label)
function formatSizePrecise($bytes) {
    if (!is_numeric($bytes) || $bytes <= 0) return '';
    $tb = $bytes / 1000000000000;
    if ($tb >= 1) return round($tb, 2) . ' TB';
    return round($bytes / 1000000000) . ' GB';
}

// Read a drive temperature for Unassigned Devices (unRAID doesn't put UD temps in disks.ini).
// Standby-safe: `-n standby` returns WITHOUT spinning up a sleeping disk, so idle drives stay asleep.
function udProbeTemp($devName) {
    if (!preg_match('/^[a-z0-9]+$/', $devName)) return ['temp' => null, 'spundown' => false];
    $out = (string) shell_exec('timeout 5 smartctl -A -n standby /dev/' . $devName . ' 2>&1');
    if ($out === '') return ['temp' => null, 'spundown' => false];
    if (stripos($out, 'STANDBY') !== false || stripos($out, 'SLEEP') !== false)
        return ['temp' => null, 'spundown' => true];
    // NVMe / SCSI style: "Temperature:  35 Celsius"  or  "Current Drive Temperature: 35 C"
    if (preg_match('/Temperature:\s+(\d+)\s*Cel/i', $out, $m)) return ['temp' => (int)$m[1], 'spundown' => false];
    if (preg_match('/Current Drive Temperature:\s+(\d+)/i', $out, $m)) return ['temp' => (int)$m[1], 'spundown' => false];
    // SATA attribute table: 194 Temperature_Celsius ... - 35 (Min/Max 11/45)
    foreach (explode("\n", $out) as $ln) {
        if (preg_match('/(Temperature_Celsius|Airflow_Temperature|Temperature_Internal)/i', $ln)) {
            if (preg_match('/-\s+(\d+)(?:\s+\([^)]*\))?\s*$/', trim($ln), $mm)) return ['temp' => (int)$mm[1], 'spundown' => false];
        }
    }
    return ['temp' => null, 'spundown' => false];
}

// Tidy a raw filesystem type into a short lowercase label for the card. '' = don't show (parity / none).
function prettyFs($fs) {
    $fs = strtolower(trim((string)$fs));
    if ($fs === '' || $fs === 'auto' || $fs === '-') return '';
    $map = [
        'zfs_member' => 'zfs', 'zfs' => 'zfs', 'linux_raid_member' => 'raid',
        'vfat' => 'fat', 'fat16' => 'fat', 'fat32' => 'fat',
        'ntfs' => 'ntfs', 'exfat' => 'exfat', 'xfs' => 'xfs', 'btrfs' => 'btrfs',
        'ext4' => 'ext4', 'ext3' => 'ext3', 'ext2' => 'ext2', 'iso9660' => 'iso', 'swap' => 'swap',
    ];
    return $map[$fs] ?? $fs;
}

$disks = parse_ini_file("/var/local/emhttp/disks.ini", true);
$driveData = [];
$assignedDevices = []; 

foreach ($disks as $diskName => $data) {
    if (empty($data['id']) || $data['status'] === 'DISK_NP') continue;
    if (!empty($data['device'])) $assignedDevices[] = $data['device'];

    // unRAID by-id is MODEL_SERIAL: split the last _-token as serial, rest = clean model name
    $idParts = explode('_', $data['id']);
    if (count($idParts) > 1) {
        $cleanSerial = array_pop($idParts);
        $cleanModel  = implode(' ', $idParts);
    } else {
        $cleanSerial = $data['id'];
        $cleanModel  = !empty($data['model']) ? $data['model'] : 'Unknown';
    }

    // health: DISK_OK + no errors + not red = healthy; anything else is an issue (fsColor is ignored - yellow on healthy pools)
    $status    = $data['status'] ?? '';
    $numErrors = (int)($data['numErrors'] ?? 0);
    $udColor   = $data['color'] ?? '';
    $health    = 'ok';
    if (($status !== 'DISK_OK' && $status !== '') || $numErrors > 0 || strpos($udColor, 'red') === 0) $health = 'issue';

    // temp: numeric C, or null when spun down ('*') / unknown
    $tempRaw  = $data['temp'] ?? '';
    $temp     = is_numeric($tempRaw) ? (int)$tempRaw : null;
    $spundown = (($data['spundown'] ?? '0') === '1');

    // usage: fsSize/fsUsed/fsFree are in 1024-byte blocks (parity has none)
    $fsSize    = (float)($data['fsSize'] ?? 0);
    $fsUsed    = (float)($data['fsUsed'] ?? 0);
    $usedPct   = $fsSize > 0 ? (int)round($fsUsed / $fsSize * 100) : null;
    $freeLabel = $fsSize > 0 ? formatSizePrecise(((float)($data['fsFree'] ?? 0)) * 1024) : null;

    $driveData[] = [
        'id' => $data['id'],
        'name' => $data['name'],
        'model' => $cleanModel,
        'serial' => $cleanSerial,
        'size' => formatSize(($data['size'] ?? 0) * 1024),   // disks.ini size is in 1024-byte blocks
        'type' => $data['type'] ?? 'Data',
        'mediaType' => 'default',
        'temp' => $temp,
        'spundown' => $spundown,
        'health' => $health,
        'usedPct' => $usedPct,
        'freeLabel' => $freeLabel,
        'format' => prettyFs($data['fsType'] ?? ''),   // array/pool/flash filesystem
        'mounted' => true,
        'partitions' => []
    ];
}

// Pull every block device WITH its partitions so UD cards can show mount state, usage and filesystem.
$lsblk_output = shell_exec('lsblk -n -P -b -o NAME,PKNAME,TYPE,MODEL,SERIAL,SIZE,ROTA,FSTYPE,LABEL,MOUNTPOINT,FSSIZE,FSUSED,FSAVAIL 2>/dev/null');
$allRows = [];
foreach (explode("\n", trim((string)$lsblk_output)) as $line) {
    if ($line === '') continue;
    preg_match_all('/([A-Z%]+)="([^"]*)"/', $line, $matches);
    $row = [];
    foreach ($matches[1] as $index => $key) $row[$key] = trim($matches[2][$index]);
    $allRows[] = $row;
}
// Group partitions under their parent whole-disk.
$partsByDisk = [];
foreach ($allRows as $row) {
    if (($row['TYPE'] ?? '') === 'part' && !empty($row['PKNAME'])) $partsByDisk[$row['PKNAME']][] = $row;
}

foreach ($allRows as $row) {
    if (($row['TYPE'] ?? '') !== 'disk') continue;
    $devName = $row['NAME'] ?? '';
    if ($devName === '' || strpos($devName, 'loop') === 0 || strpos($devName, 'ram') === 0 || strpos($devName, 'md') === 0 || strpos($devName, 'zram') === 0 || in_array($devName, $assignedDevices)) continue;

    $serial = !empty($row['SERIAL']) ? $row['SERIAL'] : $devName;
    $probe  = udProbeTemp($devName);

    // Partitions - fall back to the whole disk when it carries a filesystem directly (no partition table).
    $parts = $partsByDisk[$devName] ?? [];
    if (empty($parts) && ((($row['FSTYPE'] ?? '') !== '') || (($row['MOUNTPOINT'] ?? '') !== ''))) $parts = [$row];

    $partList = [];
    foreach ($parts as $p) {
        $pSize = (float)($p['FSSIZE'] ?? 0);
        $pName = $p['LABEL'] ?? '';
        if ($pName === '') { $mp = $p['MOUNTPOINT'] ?? ''; $pName = $mp !== '' ? basename($mp) : ($p['NAME'] ?? ''); }
        $partList[] = [
            'name'      => $pName,
            'format'    => prettyFs($p['FSTYPE'] ?? ''),
            'mounted'   => (($p['MOUNTPOINT'] ?? '') !== ''),
            'usedPct'   => $pSize > 0 ? (int)round(((float)($p['FSUSED'] ?? 0)) / $pSize * 100) : null,
            'freeLabel' => $pSize > 0 ? formatSizePrecise((float)($p['FSAVAIL'] ?? 0)) : null,
            'size'      => formatSize((float)($p['SIZE'] ?? 0)),
        ];
    }

    $multi = count($partList) > 1;
    // Single partition promotes its details to the card; multi leaves usage to the per-partition sub-lines.
    $topFmt = ''; $topUsed = null; $topFree = null; $mounted = false;
    if (count($partList) === 1) {
        $p0 = $partList[0];
        $topFmt = $p0['format']; $topUsed = $p0['usedPct']; $topFree = $p0['freeLabel']; $mounted = $p0['mounted'];
    } elseif ($multi) {
        $mounted = true;   // card itself isn't "unmounted"; each partition shows its own state
    }

    $driveData[] = [
        'id' => "ud_" . md5($serial . $devName),
        'name' => 'Mount: /dev/' . strtolower($devName),
        'model' => !empty($row['MODEL']) ? $row['MODEL'] : 'Unknown',
        'serial' => $serial,
        'size' => formatSize((float)($row['SIZE'] ?? 0)),
        'type' => 'Unassigned',
        'mediaType' => 'default',
        'temp' => $probe['temp'],
        'spundown' => $probe['spundown'],
        'health' => 'ok',
        'usedPct' => $topUsed,
        'freeLabel' => $topFree,
        'format' => $topFmt,
        'mounted' => $mounted,
        'partitions' => $multi ? $partList : []
    ];
}

// Demo-only cards for documentation screenshots.
// TEMPORARY: set $DP_DEMO = false; (or delete this block) before release.
$DP_DEMO = false;
if ($DP_DEMO || isset($_GET['dpdemo'])) {
    $driveData[] = [
        'id' => 'demo_bad', 'name' => 'Disk 10', 'model' => 'Seagate IronWolf ST16000NT001',
        'serial' => 'DEMO0F57H', 'size' => '16 TB', 'type' => 'Data', 'mediaType' => 'default',
        'temp' => 52, 'spundown' => false, 'health' => 'issue', 'usedPct' => 71, 'freeLabel' => '1.71 TB',
        'format' => 'xfs', 'mounted' => true, 'partitions' => []
    ];
    $driveData[] = [
        'id' => 'demo_multi', 'name' => 'Mount: /dev/sdz', 'model' => 'Samsung Portable SSD T7',
        'serial' => 'DEMO09R5T', 'size' => '4 TB', 'type' => 'Unassigned', 'mediaType' => 'default',
        'temp' => 34, 'spundown' => false, 'health' => 'ok', 'usedPct' => null, 'freeLabel' => null,
        'format' => '', 'mounted' => true, 'partitions' => [
            ['name' => 'Media',    'format' => 'ntfs',  'mounted' => true,  'usedPct' => 82, 'freeLabel' => '360 GB', 'size' => '2 TB'],
            ['name' => 'Backups',  'format' => 'xfs',   'mounted' => true,  'usedPct' => 45, 'freeLabel' => '1.1 TB', 'size' => '1.5 TB'],
            ['name' => 'scratch',  'format' => 'exfat', 'mounted' => false, 'usedPct' => null, 'freeLabel' => null,   'size' => '500 GB'],
        ]
    ];
}

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
    <?php
    $layoutFile = "/boot/config/plugins/driveplacement/layout.json";
    $savedLayout = file_exists($layoutFile) ? json_decode(file_get_contents($layoutFile), true) : null;
    ?>
    const savedLayout = <?php echo json_encode($savedLayout, JSON_INVALID_UTF8_SUBSTITUTE); ?>;
    <?php
    // Detect unRAID's active theme so the plugin can match a dark skin.
    $dpTheme = '';
    if (isset($display['theme'])) {
        $dpTheme = $display['theme'];
    } else {
        $dynCfg = @parse_ini_file("/boot/config/plugins/dynamix/dynamix.cfg", true);
        $dpTheme = $dynCfg['display']['theme'] ?? 'white';
    }
    $dpDark = in_array(strtolower($dpTheme), ['black', 'gray', 'grey']) ? 'true' : 'false';
    ?>
    const dpDarkTheme = <?php echo $dpDark; ?>;
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