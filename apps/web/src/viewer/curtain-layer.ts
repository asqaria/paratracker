import {
  Cartesian3,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Primitive,
  ShowGeometryInstanceAttribute,
  WallGeometry,
  type Scene,
} from 'cesium';

import { CURTAIN } from './curtain';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8): ОДИН Primitive, по экземпляру
 * WallGeometry на сегмент между соседними точками стены. Градиент прозрачности —
 * материал на координате t стены (0 у земли, 1 у трека): у трека стена
 * заметна, к земле растворяется. Цвет нейтральный — палитра варио остаётся
 * единственным «кричащим» элементом сцены (ТЗ §8.1). «Пройденный» — флагами
 * show экземпляров, как у линии трека.
 */

/** Трек сцены (откалиброванный по земле) — те же высоты, что у линии, без щели между ними. */
export interface CurtainTrack {
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
}

const GRADIENT_SOURCE = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  material.diffuse = color.rgb;
  material.alpha = color.a * pow(clamp(materialInput.st.t, 0.0, 1.0), fadePower);
  return material;
}`;

export class CurtainLayer {
  private readonly primitive: Primitive | null;
  /** Сколько первых сегментов показано; null — ещё не применено (примитив не готов). */
  private visible: number | null = null;
  private wanted: number;
  private readonly segments: number;

  /**
   * samples — индексы точек стены (curtainSamples), groundM — высота рельефа под
   * каждой из них, м; shownSegments — какие сегменты рисовать (curtainSegmentsShown);
   * color — цвет стены у трека (альфа — CURTAIN.topAlpha).
   */
  constructor(
    private readonly scene: Scene,
    track: CurtainTrack,
    samples: readonly number[],
    groundM: readonly number[],
    shownSegments: readonly boolean[],
    color: Color,
  ) {
    const segments = Math.max(0, samples.length - 1);
    this.segments = segments;
    this.wanted = segments;
    if (!shownSegments.slice(0, segments).some((shown) => shown !== false)) {
      this.primitive = null;
      return;
    }
    const at = (k: number) => {
      const i = samples[k] ?? 0;
      const top = track.alt[i] ?? Number.NaN;
      // Рельеф не пришёл или выше трека (ошибка калибровки) — низ по треку, стена нулевой высоты.
      const ground = Math.min(groundM[k] ?? top, top);
      return { lon: track.lon[i] ?? 0, lat: track.lat[i] ?? 0, top, ground: Number.isFinite(ground) ? ground : top };
    };
    const instances: GeometryInstance[] = [];
    // id экземпляра — номер сегмента: пропущенные (в термике) просто не создаются.
    for (let k = 0; k < segments; k++) {
      if (shownSegments[k] === false) continue;
      const [a, b] = [at(k), at(k + 1)];
      instances.push(
        new GeometryInstance({
          id: k,
          geometry: new WallGeometry({
            positions: Cartesian3.fromDegreesArrayHeights([a.lon, a.lat, a.top, b.lon, b.lat, b.top]),
            minimumHeights: [a.ground, b.ground],
            maximumHeights: [a.top, b.top],
            vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
          attributes: { show: new ShowGeometryInstanceAttribute(true) },
        }),
      );
    }
    this.primitive = new Primitive({
      geometryInstances: instances,
      appearance: new MaterialAppearance({
        material: new Material({
          fabric: {
            type: 'CurtainGradient',
            uniforms: { color: color.withAlpha(CURTAIN.topAlpha), fadePower: CURTAIN.fadePower },
            source: GRADIENT_SOURCE,
          },
          translucent: true,
        }),
        translucent: true,
        // Без освещения: стена — полупрозрачная вуаль, а не поверхность со светом и тенью.
        flat: true,
        faceForward: true,
        materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
      }),
      asynchronous: false,
    });
    scene.primitives.add(this.primitive);
  }

  setVisible(visible: boolean): void {
    if (this.primitive) this.primitive.show = visible;
  }

  /** Показать первые flown сегментов (режим «Пройденный»); все — режим «Весь». */
  update(flown: number): void {
    this.wanted = flown;
    if (!this.primitive?.ready) return;
    const wanted = this.wanted;
    const visible = this.visible;
    if (visible === wanted) return;
    // Первый раз — все сегменты; дальше — только те, что сменили видимость.
    const from = visible === null ? 0 : Math.min(visible, wanted);
    const to = visible === null ? this.segments : Math.max(visible, wanted);
    for (let id = from; id < to; id++) {
      // Сегмента в термике нет среди экземпляров — атрибутов у него тоже нет.
      const attributes = this.primitive.getGeometryInstanceAttributes(id) as { show: Uint8Array } | undefined;
      if (attributes) attributes.show = ShowGeometryInstanceAttribute.toValue(id < wanted);
    }
    this.visible = wanted;
  }

  /** Примитив ещё не готов — показ применится в следующем кадре. */
  get pending(): boolean {
    return this.primitive !== null && this.visible !== this.wanted;
  }

  destroy(): void {
    if (this.primitive && !this.scene.isDestroyed()) this.scene.primitives.remove(this.primitive);
  }
}
