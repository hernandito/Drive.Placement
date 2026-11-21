<?php
// Toggle whether the Drive Placement Dashboard tile is registered.
// A single marker file is the source of truth, read by DrivePlacementDash.page's
// Cond. Present = hidden. POST (or GET) show=1 to show, show=0 to hide.
$dir = "/boot/config/plugins/driveplacement";
if (!is_dir($dir)) @mkdir($dir, 0777, true);
$flag = "$dir/.dash-hidden";

header('Content-Type: application/json');
$show = (($_POST['show'] ?? $_GET['show'] ?? '1') === '1');
if ($show) {
    @unlink($flag);
} else {
    @file_put_contents($flag, "hidden\n");
}
echo json_encode(["status" => "success", "show" => $show]);
?>
