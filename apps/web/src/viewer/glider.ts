import {
  Cartesian3,
  Cartographic,
  CallbackPositionProperty,
  CallbackProperty,
  HeadingPitchRoll,
  JulianDate,
  Math as CesiumMath,
  Matrix4,
  PropertyBag,
  Quaternion,
  TranslationRotationScale,
  Transforms,
  type Entity,
  type SampledPositionProperty,
  type Viewer,
} from 'cesium';

import { PARAGLIDER_MODEL_PATH, type GliderAttitude } from './glider-attitude';
import { GLIDER_NODES, lyingAngleDeg, nodeTransforms, POSE, type GliderNode, type GliderPose, type NodeTransform } from './glider-pose';
import { liftAboveGround } from './ground-clearance';

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
function nodeTransformations(
  poseAt: (timeMs: number) => GliderPose,
  lyingAt: (time: JulianDate) => number,
): PropertyBag {
  let cachedMs = Number.NaN;
  let cached: Record<GliderNode, NodeTransform> | null = null;
  const transformsAt = (time: JulianDate): Record<GliderNode, NodeTransform> => {
    const ms = JulianDate.toDate(time).getTime();
    if (!cached || ms !== cachedMs) {
      const pose = poseAt(ms);
      // Рельеф позади спрашивается только когда крыло на земле.
      const lying = pose.wing === 'lying' || pose.wing === 'rising' || pose.wing === 'falling';
      cached = nodeTransforms(pose, lying ? lyingAt(time) : POSE.lyingAngleDeg);
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
  // Модель — не ниже рисуемого рельефа плюс подвеска: у склона трек (GPS)
  // бывает под землёй, и модель уходила в гору вместе с ним.
  const globe = viewer.scene.globe;
  const scratch = new Cartographic();
  const lifted = new CallbackPositionProperty((time, result) => {
    if (!time) return undefined;
    const at = position.getValue(time, result);
    if (!at) return undefined;
    const place = Cartographic.fromCartesian(at, undefined, scratch);
    if (!place) return at;
    const height = liftAboveGround(place.height, globe.getHeight(place));
    if (height === place.height) return at;
    return Cartesian3.fromRadians(place.longitude, place.latitude, height, undefined, at);
  }, false);

  // Пилот стоит — курса нет: держим последний, а не разворачиваем на север.
  let lastHeadingDeg = 0;
  const orientation = new CallbackProperty((time, result) => {
    if (!time) return undefined;
    const at = lifted.getValue(time);
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

  // Угол раскладки крыла — по рисуемому рельефу позади пилота (против курса):
  // на старте склон за спиной поднимается, и купол уходил в гору.
  const behind = new Cartographic();
  const lyingAt = (time: JulianDate): number => {
    const at = lifted.getValue(time);
    const place = at ? Cartographic.fromCartesian(at) : undefined;
    if (!at || !place) return POSE.lyingAngleDeg;
    const heading = CesiumMath.toRadians(lastHeadingDeg);
    const enu = Transforms.eastNorthUpToFixedFrame(at);
    const offset = new Cartesian3(-Math.sin(heading) * POSE.lyingBehindM, -Math.cos(heading) * POSE.lyingBehindM, 0);
    const point = Matrix4.multiplyByPoint(enu, offset, new Cartesian3());
    const spot = Cartographic.fromCartesian(point, undefined, behind);
    const ground = spot ? globe.getHeight(spot) : undefined;
    return lyingAngleDeg(ground === undefined ? Number.NaN : ground - place.height);
  };

  return viewer.entities.add({
    position: lifted,
    orientation,
    model: {
      uri: `${import.meta.env.BASE_URL}${PARAGLIDER_MODEL_PATH}`,
      minimumPixelSize: GLIDER_MIN_PIXEL_SIZE,
      maximumScale: GLIDER_MAX_SCALE,
      nodeTransformations: nodeTransformations(poseAt, lyingAt),
    },
  });
}
