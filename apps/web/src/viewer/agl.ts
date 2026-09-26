/**
 * Высота над рельефом (AGL, задача 2.15): высота трека сцены минус рельеф
 * под точкой. Трек — откалиброванный по земле (ground-calibration.ts), рельеф —
 * тот же, что занавес запросил под полётом: и то и другое над эллипсоидом, и
 * пилот на склоне даёт ~0, а не расхождение GPS и DEM.
 *
 * Считается только там, где рельеф пришёл (от взлёта до посадки); остальное —
 * NaN: график в тех местах пустой, а не нулевой.
 */
export function aglProfile(alt: Float64Array, groundAt: ReadonlyMap<number, number>): Float64Array {
  const agl = new Float64Array(alt.length).fill(Number.NaN);
  for (const [index, ground] of groundAt) {
    const a = alt[index];
    if (a !== undefined && Number.isFinite(a) && Number.isFinite(ground)) agl[index] = a - ground;
  }
  return agl;
}
