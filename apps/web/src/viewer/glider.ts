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

import type { GliderAttitude } from './glider-attitude';
import paragliderModelUrl from './models/paraglider.glb?url';
import {
  FLAT_GROUND,
  GLIDER_NODES,
  lyingAngleDeg,
  lyingRollDeg,
  nodeTransforms,
  POSE,
  type GliderNode,
  type GliderPose,
  type LyingWing,
  type NodeTransform,
} from './glider-pose';
import { liftAboveGround } from './ground-clearance';

/**
 * Пилот на сцене — модель параплана (ТЗ §12, задача 2.9), а не точка.
 * Позиция — та же, что у часов (SampledPositionProperty); поза — из
 * gliderAttitude: курс по сглаженной траектории и крен координированного виража.
 */

/**
 * Не мельче, px — и не крупнее реального больше чем в GLIDER_MAX_SCALE раз.
 * Было 48 px и до ×200: с ~200 м Cesium раздувал модель, в Top (1.4 км) —
 * в 6–7 раз, и круг термика в 50 м выглядел шириной в полтора крыла:
 * «параплан огромный, круги мелкие». Теперь увеличение — с ~430 м и не
 * больше трёх раз: в Chase, Side и Top модель почти в реальном масштабе.
 * Дальше она честно уменьшается, пилота видно по концу трека.
 */
const GLIDER_MIN_PIXEL_SIZE = 24;
const GLIDER_MAX_SCALE = 3;
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
  lyingAt: (time: JulianDate) => LyingWing,
  frameNumber: () => number,
): PropertyBag {
  // Кэш — на кадр, а не на момент полёта: на паузе момент не меняется, и угол
  // раскладки, посчитанный до загрузки рельефа, оставался навсегда.
  let cachedFrame = Number.NaN;
  let cachedMs = Number.NaN;
  let cached: Record<GliderNode, NodeTransform> | null = null;
  const transformsAt = (time: JulianDate): Record<GliderNode, NodeTransform> => {
    const ms = JulianDate.toDate(time).getTime();
    const frame = frameNumber();
    if (!cached || ms !== cachedMs || frame !== cachedFrame) {
      cachedFrame = frame;
      const pose = poseAt(ms);
      // Рельеф позади спрашивается только когда крыло на земле.
      const lying = pose.wing === 'lying' || pose.wing === 'rising' || pose.wing === 'falling';
      cached = nodeTransforms(pose, lying ? lyingAt(time) : FLAT_GROUND);
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
  const spot = new Cartographic();
  const lyingAt = (time: JulianDate): LyingWing => {
    const at = lifted.getValue(time);
    const place = at ? Cartographic.fromCartesian(at) : undefined;
    if (!at || !place) return FLAT_GROUND;
    const heading = CesiumMath.toRadians(lastHeadingDeg);
    const enu = Transforms.eastNorthUpToFixedFrame(at);
    // Позади — против курса; влево — левое крыло модели (+X): курс, повёрнутый на 90° против часовой.
    const back = [-Math.sin(heading), -Math.cos(heading)] as const;
    const left = [-Math.cos(heading), Math.sin(heading)] as const;
    const groundAt = (behindM: number, leftM: number): number => {
      const offset = new Cartesian3(back[0] * behindM + left[0] * leftM, back[1] * behindM + left[1] * leftM, 0);
      const point = Matrix4.multiplyByPoint(enu, offset, new Cartesian3());
      const where = Cartographic.fromCartesian(point, undefined, spot);
      return (where ? globe.getHeight(where) : undefined) ?? Number.NaN;
    };
    return {
      angleDeg: lyingAngleDeg(groundAt(POSE.lyingBehindM, 0) - place.height),
      rollDeg: lyingRollDeg(groundAt(POSE.lyingBehindM, POSE.lyingHalfSpanM), groundAt(POSE.lyingBehindM, -POSE.lyingHalfSpanM)),
    };
  };

  // Номер кадра — ключ кэша поз узлов; счётчик свой: frameState в типах Cesium закрыт.
  let frame = 0;
  viewer.scene.preRender.addEventListener(() => {
    frame += 1;
  });

  return viewer.entities.add({
    position: lifted,
    orientation,
    model: {
      // Адрес с хешем содержимого: новая модель после выкладки видна сразу, без очистки кэша.
      uri: paragliderModelUrl,
      // Не мельче GLIDER_MIN_PIXEL_SIZE — только в воздухе. Cesium увеличивает модель вокруг
      // точки подвеса, а на земле крыло и ноги ниже неё: издалека они уходили
      // в склон пропорционально увеличению. На земле — настоящий размер.
      minimumPixelSize: new CallbackProperty(
        (time) => (time && poseAt(JulianDate.toDate(time).getTime()).pilot !== 'flying' ? 0 : GLIDER_MIN_PIXEL_SIZE),
        false,
      ),
      maximumScale: GLIDER_MAX_SCALE,
      nodeTransformations: nodeTransformations(poseAt, lyingAt, () => frame),
    },
  });
}
