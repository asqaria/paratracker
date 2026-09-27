import {
  Cartesian2,
  CallbackProperty,
  Math as CesiumMath,
  JulianDate,
  VerticalOrigin,
  type Entity,
  type PositionProperty,
  type Viewer,
} from 'cesium';

import { arrowScale, screenRotationDeg, WIND_ARROW, type WindHere } from './wind-arrows';

/**
 * Стрелка ветра у пилота (задача 3.14): значок в плоскости экрана чуть ниже
 * пилота, повёрнут относительно курса камеры — «куда сносит» так же, как в
 * колонке слоёв. Одна сущность на сцену; ветер — слоя, в котором пилот.
 */

/** Стрелка «вверх» с тёмной обводкой — читается и на снегу, и на лесе. */
function arrowImage(fill: string, outline: string): HTMLCanvasElement {
  const size = WIND_ARROW.sizePx;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const u = size / 12;
  ctx.beginPath();
  ctx.moveTo(6 * u, 0.8 * u);
  ctx.lineTo(10.6 * u, 6 * u);
  ctx.lineTo(7.6 * u, 6 * u);
  ctx.lineTo(7.6 * u, 11.2 * u);
  ctx.lineTo(4.4 * u, 11.2 * u);
  ctx.lineTo(4.4 * u, 6 * u);
  ctx.lineTo(1.4 * u, 6 * u);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = u;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  return canvas;
}

export class WindArrowLayer {
  private readonly entity: Entity;

  constructor(
    viewer: Viewer,
    pilot: PositionProperty,
    windAtTime: (timeMs: number) => WindHere | null,
    colors: { fill: string; outline: string },
  ) {
    const windOf = (time: JulianDate | undefined): WindHere | null =>
      time ? windAtTime(JulianDate.toDate(time).getTime()) : null;
    this.entity = viewer.entities.add({
      position: pilot,
      billboard: {
        image: arrowImage(colors.fill, colors.outline),
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, WIND_ARROW.offsetBelowPx),
        // Значок не прячется за склоном: ветер нужен и когда пилот у рельефа.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty((time) => windOf(time) !== null, false),
        scale: new CallbackProperty((time) => arrowScale(windOf(time)?.speedMs ?? 0), false),
        // Cesium вращает против часовой, наш угол — по часовой от «вверх».
        rotation: new CallbackProperty((time) => {
          const wind = windOf(time);
          if (!wind) return 0;
          return -CesiumMath.toRadians(screenRotationDeg(wind.dirDeg, CesiumMath.toDegrees(viewer.camera.heading)));
        }, false),
      },
    });
  }

  setVisible(visible: boolean): void {
    this.entity.show = visible;
  }
}
