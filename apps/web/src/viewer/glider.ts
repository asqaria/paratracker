import {
  CallbackProperty,
  HeadingPitchRoll,
  JulianDate,
  Math as CesiumMath,
  Quaternion,
  Transforms,
  type Entity,
  type SampledPositionProperty,
  type Viewer,
} from 'cesium';

import { PARAGLIDER_MODEL_PATH, type GliderAttitude } from './glider-attitude';

/**
 * Пилот на сцене — модель параплана (ТЗ §12, задача 2.9), а не точка.
 * Позиция — та же, что у часов (SampledPositionProperty); поза — из
 * gliderAttitude: курс по сглаженной траектории и крен координированного виража.
 */

/** Не мельче, px: сверху с 1,5 км крыло в 10 м иначе пропадает. */
const GLIDER_MIN_PIXEL_SIZE = 48;
/** Не крупнее реального в столько раз: иначе при отдалении модель раздувается до размеров долины. */
const GLIDER_MAX_SCALE = 200;
/**
 * Модель glTF смотрит носом в +Z; Cesium разворачивает её так, что при
 * курсе 0 в headingPitchRoll нос смотрит на восток, а курс растёт по часовой.
 * Компасный курс B → heading = B − 90°.
 */
const MODEL_HEADING_OFFSET_DEG = -90;

/** Добавляет модель; attitudeAt — поза в момент времени (UNIX мс). */
export function addGlider(
  viewer: Viewer,
  position: SampledPositionProperty,
  attitudeAt: (timeMs: number) => GliderAttitude,
): Entity {
  // Пилот стоит — курса нет: держим последний, а не разворачиваем на север.
  let lastHeadingDeg = 0;
  const orientation = new CallbackProperty((time, result) => {
    if (!time) return undefined;
    const at = position.getValue(time);
    if (!at) return undefined;
    const attitude = attitudeAt(JulianDate.toDate(time).getTime());
    if (Number.isFinite(attitude.headingDeg)) lastHeadingDeg = attitude.headingDeg;
    const hpr = new HeadingPitchRoll(
      CesiumMath.toRadians(lastHeadingDeg + MODEL_HEADING_OFFSET_DEG),
      0,
      CesiumMath.toRadians(attitude.bankDeg),
    );
    return Transforms.headingPitchRollQuaternion(at, hpr, undefined, undefined, result as Quaternion | undefined);
  }, false);

  return viewer.entities.add({
    position,
    orientation,
    model: {
      uri: `${import.meta.env.BASE_URL}${PARAGLIDER_MODEL_PATH}`,
      minimumPixelSize: GLIDER_MIN_PIXEL_SIZE,
      maximumScale: GLIDER_MAX_SCALE,
    },
  });
}
