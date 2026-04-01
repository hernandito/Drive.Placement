<?php
// Bypass unRAID's UI wrapper entirely
$configDir = "/boot/config/plugins/driveplacement";
if (!is_dir($configDir)) @mkdir($configDir);

$payload = $_POST['payload'] ?? '';
$data = json_decode($payload, true);

header('Content-Type: application/json');

if (is_array($data)) {
    $result = @file_put_contents("$configDir/layout.json", json_encode($data, JSON_PRETTY_PRINT));
    if ($result !== false) {
        echo json_encode(["status" => "success"]);
    } else {
        echo json_encode(["status" => "error", "message" => "Write failed to flash drive"]);
    }
} else {
    echo json_encode(["status" => "error", "message" => "Invalid payload data"]);
}
?>