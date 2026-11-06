<?php
// Identify a drive by blinking its activity LED.
// Generates bounded, READ-ONLY traffic on the drive so its activity light flickers -
// works without a backplane/SES, since it's just the drive's own activity LED.
header('Content-Type: application/json');

$serial  = $_POST['serial'] ?? '';
$seconds = (int)($_POST['seconds'] ?? 8);
if ($seconds < 1)  $seconds = 1;
if ($seconds > 20) $seconds = 20;

// Validate serial format up front (drive serials are alphanumeric plus . _ -).
if (!preg_match('/^[A-Za-z0-9._-]{2,64}$/', $serial)) {
    echo json_encode(["status" => "error", "message" => "Invalid serial"]);
    exit;
}

// Resolve serial -> whole-disk device via lsblk. We match the serial in PHP and only ever
// pass the resolved /dev/<name> (re-validated) to the shell, never the raw user input.
$out = shell_exec('lsblk -dn -o NAME,SERIAL 2>/dev/null');
$dev = '';
foreach (explode("\n", trim((string)$out)) as $line) {
    $parts = preg_split('/\s+/', trim($line), 2);
    if (count($parts) === 2 && $parts[1] === $serial) { $dev = '/dev/' . $parts[0]; break; }
}

if ($dev === '' || !preg_match('#^/dev/[a-z0-9]+$#', $dev)) {
    echo json_encode(["status" => "error", "message" => "Drive not found for that serial"]);
    exit;
}

// Blink: read-only dd into /dev/null, capped by `timeout`, detached so we return immediately.
// iflag=direct bypasses the page cache so it actually touches the disk (and its LED).
$cmd = 'setsid timeout ' . (int)$seconds
     . ' dd if=' . escapeshellarg($dev) . ' of=/dev/null bs=1M iflag=direct > /dev/null 2>&1 &';
shell_exec($cmd);

echo json_encode(["status" => "success", "device" => $dev, "seconds" => $seconds]);
?>
