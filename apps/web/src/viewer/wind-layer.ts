import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  Color,
  ColorBlendMode,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Viewer,
} from 'cesium';

import { dartModelUri } from './dart-model';
import { downwindDeg, type WindHere } from './wind-arrows';
import { cameraFade, dartScale, particleAlpha, spawnParticle, stepParticles, WIND_PARTICLES, type Particle } from './wind-particles';

/**
 * Поле ветра у пилота (задача 3.14): частицы из wind-particles.ts — плоские
 * полупрозрачные наконечники в 3D, горизонтально, носом по ветру своей высоты.
 * Перспектива настоящая: поле читается объёмом. Сущностей немного (count),
 * их положение, курс, размер и прозрачность — CallbackProperty от состояния,
 * которое кадр обновляет в update().
 */

/** Нос модели — по +Z glTF: Cesium ставит его на восток при курсе 0; компасный курс B → heading = B − 90° (как у пилота). */
const MODEL_HEADING_OFFSET_DEG = -90;

interface DartState {
  position: Cartesian3;
  headingDeg: number;
  scale: number;
  alpha: number;
}

export class WindFieldLayer {
  private readonly particles: Particle[];
  private readonly states: DartState[];
  private readonly enu = new Matrix4();
  private readonly rand = Math.random;
  private visible = false;

  constructor(viewer: Viewer, fill: string) {
    const color = Color.fromCssColorString(fill);
    const uri = dartModelUri();
    this.particles = Array.from({ length: WIND_PARTICLES.count }, () => spawnParticle(this.rand, true));
    this.states = this.particles.map(() => ({ position: new Cartesian3(), headingDeg: 0, scale: 0, alpha: 0 }));
    for (const state of this.states) {
      viewer.entities.add({
        position: new CallbackPositionProperty(() => state.position, false),
        orientation: new CallbackProperty(
          () =>
            Transforms.headingPitchRollQuaternion(
              state.position,
              new HeadingPitchRoll(CesiumMath.toRadians(state.headingDeg + MODEL_HEADING_OFFSET_DEG), 0, 0),
            ),
          false,
        ),
        model: {
          show: new CallbackProperty(() => this.visible && state.alpha > 0, false),
          uri,
          scale: new CallbackProperty(() => WIND_PARTICLES.lengthM * state.scale, false),
          minimumPixelSize: WIND_PARTICLES.minPixels,
          color: new CallbackProperty(() => color.withAlpha(state.alpha), false),
          colorBlendMode: ColorBlendMode.REPLACE,
        },
      });
    }
  }

  /**
   * pilot — где пилот; windAtUp — ветер на высоте «пилот + up», null — пилот
   * на земле: поля нет. dtS — сколько поле течёт в этом кадре (на паузе 0).
   * camera — где камера: между ней и пилотом наконечники гаснут.
   */
  update(
    pilot: Cartesian3 | undefined,
    windAtUp: ((upM: number) => WindHere | null) | null,
    dtS: number,
    camera: Cartesian3,
  ): void {
    this.visible = Boolean(pilot && windAtUp);
    if (!pilot || !windAtUp) return;
    if (dtS > 0) stepParticles(this.particles, dtS, windAtUp, this.rand);
    Transforms.eastNorthUpToFixedFrame(pilot, undefined, this.enu);
    const pilotToCamera = Cartesian3.distance(pilot, camera);
    this.particles.forEach((p, i) => {
      const state = this.states[i];
      if (!state) return;
      const wind = windAtUp(p.up);
      if (!wind) {
        state.alpha = 0;
        return;
      }
      Matrix4.multiplyByPoint(this.enu, new Cartesian3(p.east, p.north, p.up), state.position);
      state.headingDeg = downwindDeg(wind.dirDeg);
      state.scale = dartScale(wind.speedMs);
      state.alpha = particleAlpha(p.ageS, p.lifeS) * cameraFade(Cartesian3.distance(state.position, camera), pilotToCamera);
    });
  }
}
