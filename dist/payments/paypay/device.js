// paython-wrapper/helpers.py の DeviceState / generate_device_state 忠実ポート。
// センサーデータ乱数 を Bot 検知回避のため同範囲で生成する。
function uniform(a, b) {
    return a + Math.random() * (b - a);
}
function randomVector(r1, r2, r3, precision = 8) {
    return `${uniform(...r1).toFixed(precision)}_${uniform(...r2).toFixed(precision)}_${uniform(...r3).toFixed(precision)}`;
}
export function generateDeviceState() {
    return {
        orientation: randomVector([2.2, 2.6], [-0.2, -0.05], [-0.05, 0.1]),
        orientation_2: randomVector([2.0, 2.6], [-0.2, -0.05], [-0.05, 0.2]),
        rotation: randomVector([-0.8, -0.6], [0.65, 0.8], [-0.12, -0.04]),
        rotation_2: randomVector([-0.85, -0.4], [0.53, 0.9], [-0.15, -0.03]),
        acceleration: randomVector([-0.35, 0.0], [-0.01, 0.3], [-0.1, 0.1]),
        acceleration_2: randomVector([0.01, 0.04], [-0.04, 0.09], [-0.03, 0.1]),
    };
}
