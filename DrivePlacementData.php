<?php
/*
 * Drive Placement - shared data layer.
 *
 * Builds the three things both the full Utilities page and the Dashboard tile
 * need, so the two can never drift:
 *   $driveData   - every drive (array, pool, parity, flash, UD) with temp,
 *                  usage, health, filesystem and category.
 *   $savedLayout - parsed layout.json (columns, metadata, categoryColors, settings).
 *   $dpDark      - true when unRAID is on a dark skin.
 *
 * require_once this file; it is safe to include from both pages.
 *
 * Optional caching: define DP_DATA_CACHE_TTL (seconds) BEFORE including to serve
 * $driveData from a short-lived cache. The Dashboard tile sets this so frequent
 * dashboard refreshes don't re-run smartctl/lsblk on every poll; the full
 * interactive page leaves it unset and always reads fresh.
 */

if (!function_exists('dp_formatSize')) {

    function dp_formatSize($bytes) {
        if (!is_numeric($bytes) || $bytes <= 0) return 'Unknown';
        $tb = $bytes / 1000000000000;
        if ($tb >= 0.9) return round($tb) . ' TB';
        return round($bytes / 1000000000) . ' GB';
    }

    // Like dp_formatSize but keeps 2 decimals for TB (used for the "Free:" label).
    function dp_formatSizePrecise($bytes) {
        if (!is_numeric($bytes) || $bytes <= 0) return '';
        $tb = $bytes / 1000000000000;
        if ($tb >= 1) return round($tb, 2) . ' TB';
        return round($bytes / 1000000000) . ' GB';
    }

    // Read a drive temperature for Unassigned Devices (unRAID doesn't put UD temps in disks.ini).
    // Standby-safe: `-n standby` returns WITHOUT spinning up a sleeping disk, so idle drives stay asleep.
    function dp_udProbeTemp($devName) {
        if (!preg_match('/^[a-z0-9]+$/', $devName)) return ['temp' => null, 'spundown' => false];
        $out = (string) shell_exec('timeout 5 smartctl -A -n standby /dev/' . $devName . ' 2>&1');
        if ($out === '') return ['temp' => null, 'spundown' => false];
        if (stripos($out, 'STANDBY') !== false || stripos($out, 'SLEEP') !== false)
            return ['temp' => null, 'spundown' => true];
        if (preg_match('/Temperature:\s+(\d+)\s*Cel/i', $out, $m)) return ['temp' => (int)$m[1], 'spundown' => false];
        if (preg_match('/Current Drive Temperature:\s+(\d+)/i', $out, $m)) return ['temp' => (int)$m[1], 'spundown' => false];
        foreach (explode("\n", $out) as $ln) {
            if (preg_match('/(Temperature_Celsius|Airflow_Temperature|Temperature_Internal)/i', $ln)) {
                if (preg_match('/-\s+(\d+)(?:\s+\([^)]*\))?\s*$/', trim($ln), $mm)) return ['temp' => (int)$mm[1], 'spundown' => false];
            }
        }
        return ['temp' => null, 'spundown' => false];
    }

    // Tidy a raw filesystem type into a short lowercase label. '' = don't show (parity / none).
    function dp_prettyFs($fs) {
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

    // Map a drive's unRAID "type" to a Drive Placement category key.
    // Mirrors renderCardContent() in DrivePlacement.js exactly.
    function dp_category($type) {
        $t = strtolower((string)$type);
        $cat = 'array';
        if (strpos($t, 'parity') !== false) $cat = 'parity';
        if (strpos($t, 'cache')  !== false) $cat = 'pool';
        if (strpos($t, 'flash')  !== false) $cat = 'flash';
        else if (strpos($t, 'unassigned') !== false) $cat = 'unassigned';
        return $cat;
    }

    // Short category label for the card badge / chip.
    function dp_categoryLabel($cat) {
        $m = ['array' => 'Data', 'parity' => 'Parity', 'pool' => 'Pool', 'unassigned' => 'UD', 'flash' => 'Flash'];
        return $m[$cat] ?? 'Data';
    }

    // Build the full $driveData list from disks.ini + lsblk (UD) probing.
    function dp_buildDriveData() {
        $disks = parse_ini_file("/var/local/emhttp/disks.ini", true);
        $driveData = [];
        $assignedDevices = [];
        if (!is_array($disks)) $disks = [];

        foreach ($disks as $diskName => $data) {
            if (empty($data['id']) || ($data['status'] ?? '') === 'DISK_NP') continue;
            if (!empty($data['device'])) $assignedDevices[] = $data['device'];

            $idParts = explode('_', $data['id']);
            if (count($idParts) > 1) {
                $cleanSerial = array_pop($idParts);
                $cleanModel  = implode(' ', $idParts);
            } else {
                $cleanSerial = $data['id'];
                $cleanModel  = !empty($data['model']) ? $data['model'] : 'Unknown';
            }

            $status    = $data['status'] ?? '';
            $numErrors = (int)($data['numErrors'] ?? 0);
            $udColor   = $data['color'] ?? '';
            $health    = 'ok';
            if (($status !== 'DISK_OK' && $status !== '') || $numErrors > 0 || strpos($udColor, 'red') === 0) $health = 'issue';

            $tempRaw  = $data['temp'] ?? '';
            $temp     = is_numeric($tempRaw) ? (int)$tempRaw : null;
            $spundown = (($data['spundown'] ?? '0') === '1');

            $fsSize    = (float)($data['fsSize'] ?? 0);
            $fsUsed    = (float)($data['fsUsed'] ?? 0);
            $usedPct   = $fsSize > 0 ? (int)round($fsUsed / $fsSize * 100) : null;
            $freeLabel = $fsSize > 0 ? dp_formatSizePrecise(((float)($data['fsFree'] ?? 0)) * 1024) : null;

            $driveData[] = [
                'id' => $data['id'],
                'name' => $data['name'],
                'model' => $cleanModel,
                'serial' => $cleanSerial,
                'size' => dp_formatSize(($data['size'] ?? 0) * 1024),
                'type' => $data['type'] ?? 'Data',
                'mediaType' => 'default',
                'temp' => $temp,
                'spundown' => $spundown,
                'health' => $health,
                'usedPct' => $usedPct,
                'freeLabel' => $freeLabel,
                'format' => dp_prettyFs($data['fsType'] ?? ''),
                'mounted' => true,
                'partitions' => []
            ];
        }

        $lsblk_output = shell_exec('lsblk -n -P -b -o NAME,PKNAME,TYPE,MODEL,SERIAL,WWN,SIZE,ROTA,FSTYPE,LABEL,MOUNTPOINT,FSSIZE,FSUSED,FSAVAIL 2>/dev/null');
        $allRows = [];
        foreach (explode("\n", trim((string)$lsblk_output)) as $line) {
            if ($line === '') continue;
            preg_match_all('/([A-Z%]+)="([^"]*)"/', $line, $matches);
            $row = [];
            foreach ($matches[1] as $index => $key) $row[$key] = trim($matches[2][$index]);
            $allRows[] = $row;
        }
        $partsByDisk = [];
        foreach ($allRows as $row) {
            if (($row['TYPE'] ?? '') === 'part' && !empty($row['PKNAME'])) $partsByDisk[$row['PKNAME']][] = $row;
        }

        foreach ($allRows as $row) {
            if (($row['TYPE'] ?? '') !== 'disk') continue;
            $devName = $row['NAME'] ?? '';
            if ($devName === '' || strpos($devName, 'loop') === 0 || strpos($devName, 'ram') === 0 || strpos($devName, 'md') === 0 || strpos($devName, 'zram') === 0 || in_array($devName, $assignedDevices)) continue;

            $serial = !empty($row['SERIAL']) ? $row['SERIAL'] : $devName;
            $probe  = dp_udProbeTemp($devName);

            $parts = $partsByDisk[$devName] ?? [];
            if (empty($parts) && ((($row['FSTYPE'] ?? '') !== '') || (($row['MOUNTPOINT'] ?? '') !== ''))) $parts = [$row];

            $partList = [];
            foreach ($parts as $p) {
                $pSize = (float)($p['FSSIZE'] ?? 0);
                $pName = $p['LABEL'] ?? '';
                if ($pName === '') { $mp = $p['MOUNTPOINT'] ?? ''; $pName = $mp !== '' ? basename($mp) : ($p['NAME'] ?? ''); }
                $partList[] = [
                    'name'      => $pName,
                    'format'    => dp_prettyFs($p['FSTYPE'] ?? ''),
                    'mounted'   => (($p['MOUNTPOINT'] ?? '') !== ''),
                    'usedPct'   => $pSize > 0 ? (int)round(((float)($p['FSUSED'] ?? 0)) / $pSize * 100) : null,
                    'freeLabel' => $pSize > 0 ? dp_formatSizePrecise((float)($p['FSAVAIL'] ?? 0)) : null,
                    'size'      => dp_formatSize((float)($p['SIZE'] ?? 0)),
                ];
            }

            $multi = count($partList) > 1;
            $topFmt = ''; $topUsed = null; $topFree = null; $mounted = false;
            if (count($partList) === 1) {
                $p0 = $partList[0];
                $topFmt = $p0['format']; $topUsed = $p0['usedPct']; $topFree = $p0['freeLabel']; $mounted = $p0['mounted'];
            } elseif ($multi) {
                $mounted = true;
            }

            $stableId = !empty($row['SERIAL']) ? $row['SERIAL'] : (!empty($row['WWN']) ? $row['WWN'] : $devName);

            $driveData[] = [
                'id' => "ud_" . md5($stableId),
                'name' => 'Mount: /dev/' . strtolower($devName),
                'model' => !empty($row['MODEL']) ? $row['MODEL'] : 'Unknown',
                'serial' => $serial,
                'size' => dp_formatSize((float)($row['SIZE'] ?? 0)),
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

        return $driveData;
    }
}

// ---- Resolve $driveData (with optional short-lived cache) ----
$dpCacheTtl  = defined('DP_DATA_CACHE_TTL') ? (int)DP_DATA_CACHE_TTL : 0;
$dpCacheFile = '/tmp/driveplacement-data-cache.json';
$driveData   = null;
if ($dpCacheTtl > 0 && is_file($dpCacheFile) && (time() - (int)@filemtime($dpCacheFile) < $dpCacheTtl)) {
    $cached = json_decode((string)@file_get_contents($dpCacheFile), true);
    if (is_array($cached)) $driveData = $cached;
}
if ($driveData === null) {
    $driveData = dp_buildDriveData();
    if ($dpCacheTtl > 0) @file_put_contents($dpCacheFile, json_encode($driveData));
}

// Demo cards for documentation screenshots (off by default).
if (!empty($_GET['dpdemo'])) {
    $driveData[] = [
        'id' => 'demo_bad', 'name' => 'Disk 10', 'model' => 'Seagate IronWolf ST16000NT001',
        'serial' => 'DEMO0F57H', 'size' => '16 TB', 'type' => 'Data', 'mediaType' => 'default',
        'temp' => 52, 'spundown' => false, 'health' => 'issue', 'usedPct' => 71, 'freeLabel' => '1.71 TB',
        'format' => 'xfs', 'mounted' => true, 'partitions' => []
    ];
}

// ---- layout.json ----
$dpLayoutFile = "/boot/config/plugins/driveplacement/layout.json";
$savedLayout  = is_file($dpLayoutFile) ? json_decode((string)file_get_contents($dpLayoutFile), true) : null;

// ---- dark-skin detection ----
if (!isset($dpDark)) {
    $dpThemeName = '';
    if (isset($display['theme'])) {
        $dpThemeName = $display['theme'];
    } else {
        $dynCfg = @parse_ini_file("/boot/config/plugins/dynamix/dynamix.cfg", true);
        $dpThemeName = $dynCfg['display']['theme'] ?? 'white';
    }
    $dpDark = in_array(strtolower($dpThemeName), ['black', 'gray', 'grey']);
}
?>
