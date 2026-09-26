import {
  Cartesian3,
  CallbackProperty,
  HeadingPitchRoll,
  JulianDate,
  Math as CesiumMath,
  PropertyBag,
  Quaternion,
  TranslationRotationScale,
  Transforms,
  type Entity,
  type SampledPositionProperty,
  type Viewer,
} from 'cesium';

import { PARAGLIDER_MODEL_PATH, type GliderAttitude } from './glider-attitude';
import { GLIDER_NODES, nodeTransforms, type GliderNode, type GliderPose, type NodeTransform } from './glider-pose';

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

/**
 * Узлы модели по позе (glider-pose.ts): поза считается раз на момент времени,
 * преобразования — в объекты Cesium, которые переиспользуются между кадрами.
 */
function nodeTransformations(poseAt: (timeMs: number) => GliderPose): PropertyBag {
  let cachedMs = Number.NaN;
  let cached: Record<GliderNode, NodeTransform> | null = null;
  const transformsAt = (time: JulianDate): Record<GliderNode, NodeTransform> => {
    const ms = JulianDate.toDate(time).getTime();
    if (!cached || ms !== cachedMs) {
      cached = nodeTransforms(poseAt(ms));
      cachedMs = ms;
    }
    return cached;
  };
  const bag = new PropertyBag();
  for (const node of GLIDER_NODES) {
    const trs = new TranslationRotationScale();
    bag.addProperty(
      node,
      new CallbackProperty((time) => {
        if (!time) return trs;
        const { translation, rotation, scale } = transformsAt(time)[node];
        trs.translation = Cartesian3.fromArray([...translation], 0, trs.translation);
        trs.rotation = Quaternion.unpack([...rotation], 0, trs.rotation);
        trs.scale = Cartesian3.fromArray([...scale], 0, trs.scale);
        return trs;
      }, false),
    );
  }
  return bag;
}

/**
 * Добавляет модель; attitudeAt — курс и крен в момент времени (UNIX мс),
 * poseAt — поза пилота и крыла (на земле — стоит, идёт, разбег, посадка).
 */
export function addGlider(
  viewer: Viewer,
  position: SampledPositionProperty,
  attitudeAt: (timeMs: number) => GliderAttitude,
  poseAt: (timeMs: number) => GliderPose,
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
      nodeTransformations: nodeTransformations(poseAt),
    },
  });
}
