/**
 * Параплан и камера над рельефом — расчёт без Cesium. Высота рельефа — та,
 * что сцена рисует сейчас (globe.getHeight): у склона ошибка GPS (±5–15 м)
 * и отличие рисуемого рельефа от точного опускали трек под землю, и модель
 * с ним. Камера следящих режимов ставится через lookAt, мимо защиты Cesium
 * от столкновений (она работает только для ручного управления во Free), и
 * у склона за пилотом уходила в гору.
 */

export const CLEARANCE = {
  /** Модель не ниже земли на высоту подвески: стоящий пилот — на ногах, а не по колено в склоне. */
  gliderM: 1,
  /** Камера не ближе к земле: ближе ближняя плоскость отсечения режет склон. */
  cameraM: 10,
  /**
   * …но не больше этой доли дальности: у Cockpit (12 м) запас 10 м задрал бы
   * камеру почти отвесно над стоящим на земле пилотом; 20 % — 2.4 м.
   */
  cameraRangeFraction: 0.2,
  /** Круче не поднимаем: в надире курс камеры вырождается. */
  steepestPitchDeg: -85,
} as const;

const DEG = Math.PI / 180;

/** Высота модели: не ниже рисуемого рельефа плюс подвеска; рельефа нет — как в треке. */
export function liftAboveGround(heightM: number, groundM: number | undefined): number {
  if (groundM === undefined || !Number.isFinite(groundM)) return heightM;
  return Math.max(heightM, groundM + CLEARANCE.gliderM);
}

/**
 * Наклон камеры (соглашение HeadingPitchRange: отрицательный — вниз), при
 * котором камера на дальности rangeM от пилота на pilotM не ниже groundM +
 * запас. groundM — рельеф под камерой; дальность не меняется, камера
 * поднимается по дуге вокруг пилота.
 */
export function pitchClearingGround(
  pose: { pitchDeg: number; rangeM: number },
  pilotM: number,
  groundM: number | undefined,
): number {
  if (groundM === undefined || !Number.isFinite(groundM) || !(pose.rangeM > 0)) return pose.pitchDeg;
  const cameraM = pilotM - pose.rangeM * Math.sin(pose.pitchDeg * DEG);
  const needM = groundM + Math.min(CLEARANCE.cameraM, pose.rangeM * CLEARANCE.cameraRangeFraction);
  if (cameraM >= needM) return pose.pitchDeg;
  const sine = (needM - pilotM) / pose.rangeM;
  if (sine >= Math.sin(-CLEARANCE.steepestPitchDeg * DEG)) return CLEARANCE.steepestPitchDeg;
  return -Math.asin(sine) / DEG;
}
