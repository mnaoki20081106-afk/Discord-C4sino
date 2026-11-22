// paython-wrapper/helpers.py の DeviceState / generate_device_state 忠実ポート。
// センサーデータ乱数 を Bot 検知回避のため同範囲で生成する。

export interface DeviceState {
  orientation: string;
  orientation_2: string;
  rotation: string;
  rotation_2: string;
  acceleration: string;
  acceleration_2: string;
}

function uniform(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function randomVector(
  r1: [number, number], r2: [number, number], r3: [number, number],
  precision = 8,
): string {
  return `${uniform(...r1).toFixed(precision)}_${uniform(...r2).toFixed(precision)}_${uniform(...r3).toFixed(precision)}`;
}

export function generateDeviceState(): DeviceState {
  return {
    orientation:    randomVector([ 2.2, 2.6], [-0.2,  -0.05], [-0.05, 0.1]),
    orientation_2:  randomVector([ 2.0, 2.6], [-0.2,  -0.05], [-0.05, 0.2]),
    rotation:       randomVector([-0.8,-0.6], [ 0.65,  0.8 ], [-0.12,-0.04]),
    rotation_2:     randomVector([-0.85,-0.4],[ 0.53,  0.9 ], [-0.15,-0.03]),
    acceleration:   randomVector([-0.35, 0.0],[-0.01,  0.3 ], [-0.1,  0.1]),
    acceleration_2: randomVector([ 0.01, 0.04],[-0.04, 0.09], [-0.03, 0.1]),
  };
}
