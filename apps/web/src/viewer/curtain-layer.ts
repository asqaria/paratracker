import { Cartesian3, Color, GeometryInstance, Material, MaterialAppearance, Primitive, WallGeometry, type Scene } from 'cesium';

import { CURTAIN, pieceProgress } from './curtain';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8): по примитиву WallGeometry на
 * каждую стену между термиками (curtainPieces). Прозрачность — материал на
 * координате t стены (0 у земли, 1 у трека): почти ровная, с плотной кромкой
 * у рельефа (CURTAIN.groundEdge); цвет нейтральный —
 * палитра варио остаётся единственным «кричащим» элементом сцены (ТЗ §8.1).
 *
 * «Пройденный»: у каждой стены своя униформа progress — докуда рисовать по
 * координате s (номер точки / (число точек − 1)). Её пересчитывают в каждом
 * кадре по времени пилота, шейдер отбрасывает всё дальше — край занавеса идёт
 * за пилотом непрерывно, без пересборки геометрии.
 */

/** Трек сцены (откалиброванный по земле) — те же высоты, что у линии, без щели между ними. */
export interface CurtainTrack {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
}

const WALL_SOURCE = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  if (materialInput.st.s > progress) discard;
  czm_material material = czm_getDefaultMaterial(materialInput);
  float t = clamp(materialInput.st.t, 0.0, 1.0);
  material.diffuse = color.rgb;
  material.alpha = t < edgeFraction ? edgeAlpha : mix(bottomAlpha, topAlpha, t);
  return material;
}`;

interface Wall {
  piece: readonly number[];
  primitive: Primitive;
  material: Material;
  progress: number;
}

export class CurtainLayer {
  private readonly walls: Wall[];
  private visible = true;

  /**
   * pieces — стены по индексам точек трека (curtainPieces); groundM — высота
   * рельефа под точкой, м (нет — не пришла); color — цвет стены (прозрачность —
   * из CURTAIN).
   */
  constructor(
    private readonly scene: Scene,
    private readonly track: CurtainTrack,
    pieces: readonly (readonly number[])[],
    groundM: ReadonlyMap<number, number>,
    color: Color,
  ) {
    this.walls = pieces.map((piece) => {
      const top = piece.map((i) => track.alt[i] ?? Number.NaN);
      // Рельеф не пришёл или выше трека (ошибка калибровки) — низ по треку, стена нулевой высоты.
      const bottom = piece.map((i, k) => {
        const ground = Math.min(groundM.get(i) ?? Number.NaN, top[k] ?? Number.NaN);
        return Number.isFinite(ground) ? ground : (top[k] ?? 0);
      });
      const material = new Material({
        fabric: {
          type: 'CurtainGradient',
          uniforms: {
            color,
            topAlpha: CURTAIN.topAlpha,
            bottomAlpha: CURTAIN.bottomAlpha,
            edgeFraction: CURTAIN.groundEdge.fraction,
            edgeAlpha: CURTAIN.groundEdge.alpha,
            progress: 1,
          },
          source: WALL_SOURCE,
        },
        translucent: true,
      });
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new WallGeometry({
            positions: Cartesian3.fromDegreesArrayHeights(piece.flatMap((i, k) => [track.lon[i] ?? 0, track.lat[i] ?? 0, top[k] ?? 0])),
            minimumHeights: bottom,
            maximumHeights: top,
            vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new MaterialAppearance({
          material,
          translucent: true,
          // Без освещения: стена — полупрозрачная вуаль, а не поверхность со светом и тенью.
          flat: true,
          faceForward: true,
          materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
        }),
        asynchronous: false,
      });
      scene.primitives.add(primitive);
      return { piece, primitive, material, progress: 1 };
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const wall of this.walls) wall.primitive.show = visible && wall.progress > 0;
  }

  /** «Весь» — timeMs null; «Пройденный» — край каждой стены по времени пилота. */
  update(timeMs: number | null): void {
    for (const wall of this.walls) {
      const progress = timeMs === null ? 1 : pieceProgress(this.track.t, wall.piece, timeMs);
      if (progress === wall.progress) continue;
      wall.progress = progress;
      (wall.material.uniforms as { progress: number }).progress = progress;
      wall.primitive.show = this.visible && progress > 0;
    }
  }

  destroy(): void {
    if (this.scene.isDestroyed()) return;
    for (const wall of this.walls) this.scene.primitives.remove(wall.primitive);
  }
}
