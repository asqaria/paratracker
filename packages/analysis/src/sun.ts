/**
 * Положение солнца (задача П.4, ТЗ §6.9): азимут от севера по часовой и
 * высота над горизонтом, геометрически (без рефракции). Алгоритм NOAA Solar
 * Calculator (Meeus, «Astronomical Algorithms»): точность — сотые градуса,
 * для нагрева склонов с запасом.
 */

export interface SunPosition {
  /** От севера по часовой, [0, 360). */
  azimuthDeg: number;
  /** Над горизонтом; меньше нуля — ночь. */
  elevationDeg: number;
}

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
/** Юлианская дата эпохи UNIX. */
const JD_UNIX_EPOCH = 2_440_587.5;
/** J2000.0 и дней в юлианском столетии. */
const JD_J2000 = 2_451_545;
const DAYS_PER_CENTURY = 36_525;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_DEGREE = 4;

const deg = (radians: number): number => radians / RAD;

export function sunPosition(latDeg: number, lonDeg: number, timeMs: number): SunPosition {
  const jd = timeMs / MS_PER_DAY + JD_UNIX_EPOCH;
  const t = (jd - JD_J2000) / DAYS_PER_CENTURY;

  // Средняя долгота, аномалия, эксцентриситет орбиты Земли.
  const meanLong = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(apparentLong * RAD));

  // Уравнение времени, мин.
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    MINUTES_PER_DEGREE *
    deg(
      y * Math.sin(2 * meanLong * RAD) -
        2 * ecc * Math.sin(meanAnom * RAD) +
        4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
        0.5 * y * y * Math.sin(4 * meanLong * RAD) -
        1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD),
    );

  const utcMinutes = (((timeMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60_000;
  const trueSolarMinutes = (((utcMinutes + eqTime + MINUTES_PER_DEGREE * lonDeg) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hourAngle = trueSolarMinutes / MINUTES_PER_DEGREE - 180;

  const lat = latDeg * RAD;
  const cosZenith = Math.min(
    1,
    Math.max(-1, Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle * RAD)),
  );
  const zenith = Math.acos(cosZenith);
  const denom = Math.cos(lat) * Math.sin(zenith);
  let azimuth: number;
  if (Math.abs(denom) < 1e-12) {
    azimuth = latDeg > 0 ? 180 : 0;
  } else {
    const cosAz = Math.min(1, Math.max(-1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(declination)) / denom));
    const az = deg(Math.acos(cosAz));
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }
  return { azimuthDeg: azimuth, elevationDeg: 90 - deg(zenith) };
}
