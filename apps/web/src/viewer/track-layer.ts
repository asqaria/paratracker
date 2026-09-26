import {
  ArcType,
  Cartesian3,
  Color,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  Material,
  PolylineColorAppearance,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  ShowGeometryInstanceAttribute,
  type Scene,
} from 'cesium';

import type { TrackGeometry } from './track-geometry';
import { chunkRanges, progressOf, type TrackShown } from './track-progress';

/**
 * Линия трека и её тень на рельефе, нарезанные на куски (track-progress.ts):
 * «Весь» — все куски, «Пройденный» — куски до пилота плюс хвост.
 * Линия — один Primitive с вершинными цветами (ТЗ §7.3, CLAUDE.md):
 * PolylineGeometry({ colors, colorsPerVertex }) + PolylineColorAppearance,
 * по инстансу на кусок, у каждого свой флаг show.
 */

const CHANNELS_PER_COLOR = 4;

export interface TrackLayerStyle {
  linePx: number;
  shadowPx: number;
  shadowColor: Color;
}

export class TrackLayer {
  private readonly ranges: Array<[number, number]>;
  private readonly line: Primitive;
  private readonly shadow: GroundPolylinePrimitive;
  private tail: Primitive | null = null;
  private tailRange: [number, number] | null = null;
  /** Сколько первых кусков показано сейчас; null — показ не применён (примитив не готов). */
  private visibleLine: number | null = null;
  private visibleShadow: number | null = null;
  private wantedChunks: number;
  private readonly positions: Cartesian3[];
  private readonly colors: Color[];

  /** positions — вершины линии (Cartesian3 из geometry.positions), их же берёт сцена. */
  constructor(
    private readonly scene: Scene,
    geometry: TrackGeometry,
    positions: Cartesian3[],
    private readonly style: TrackLayerStyle,
  ) {
    this.positions = positions;
    this.colors = [];
    for (let i = 0; i < geometry.pointCount; i++) {
      const at = i * CHANNELS_PER_COLOR;
      this.colors.push(
        Color.fromBytes(geometry.colors[at], geometry.colors[at + 1], geometry.colors[at + 2], geometry.colors[at + 3]),
      );
    }
    const ground = Cartesian3.fromDegreesArray(Array.from(geometry.groundPositions));

    this.ranges = chunkRanges(geometry.pointCount);
    this.wantedChunks = this.ranges.length;
    const show = (): { show: ShowGeometryInstanceAttribute } => ({ show: new ShowGeometryInstanceAttribute(true) });

    this.line = new Primitive({
      geometryInstances: this.ranges.map(
        ([start, end], id) =>
          new GeometryInstance({ id, geometry: this.lineGeometry(start, end), attributes: show() }),
      ),
      appearance: new PolylineColorAppearance({ translucent: false }),
      asynchronous: false,
    });
    scene.primitives.add(this.line);

    // Тень трека на рельефе — те же куски, прижатые к земле (ТЗ §7.2). Хвоста
    // у тени нет: прижатая линия строится асинхронно, перестраивать её на каждой
    // точке дорого. Тень отстаёт от пилота не больше чем на кусок.
    this.shadow = new GroundPolylinePrimitive({
      geometryInstances: this.ranges.map(
        ([start, end], id) =>
          new GeometryInstance({
            id,
            geometry: new GroundPolylineGeometry({ positions: ground.slice(start, end + 1), width: style.shadowPx }),
            attributes: show(),
          }),
      ),
      appearance: new PolylineMaterialAppearance({
        material: Material.fromType('Color', { color: style.shadowColor }),
      }),
    });
    scene.groundPrimitives.add(this.shadow);
  }

  private lineGeometry(start: number, end: number): PolylineGeometry {
    return new PolylineGeometry({
      positions: this.positions.slice(start, end + 1),
      colors: this.colors.slice(start, end + 1),
      colorsPerVertex: true,
      width: this.style.linePx,
      arcType: ArcType.NONE,
      vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
    });
  }

  /** «Весь» или «Пройденный»; flownVertices — сколько вершин пройдено сейчас. */
  update(shown: TrackShown, flownVertices: number): void {
    const progress = shown === 'all' ? { fullChunks: this.ranges.length, tail: null } : progressOf(this.ranges, flownVertices);
    this.wantedChunks = progress.fullChunks;
    this.visibleLine = this.applyChunks(this.line, this.visibleLine);
    this.visibleShadow = this.applyChunks(this.shadow, this.visibleShadow);
    this.setTail(progress.tail);
  }

  /** Примитив ещё не готов (тень строится асинхронно) — применить позже. */
  get pending(): boolean {
    return this.visibleLine !== this.wantedChunks || this.visibleShadow !== this.wantedChunks;
  }

  private applyChunks(primitive: Primitive | GroundPolylinePrimitive, visible: number | null): number | null {
    if (!primitive.ready) return visible;
    const wanted = this.wantedChunks;
    // Первый раз — все куски; дальше — только те, что сменили видимость.
    const from = visible === null ? 0 : Math.min(visible, wanted);
    const to = visible === null ? this.ranges.length : Math.max(visible, wanted);
    for (let id = from; id < to; id++) {
      // Типы Cesium отдают any; атрибуты инстанса с флагом show — это Uint8Array.
      const attributes = primitive.getGeometryInstanceAttributes(id) as { show: Uint8Array };
      attributes.show = ShowGeometryInstanceAttribute.toValue(id < wanted);
    }
    return wanted;
  }

  private setTail(range: [number, number] | null): void {
    if (range?.[0] === this.tailRange?.[0] && range?.[1] === this.tailRange?.[1]) return;
    if (this.tail) this.scene.primitives.remove(this.tail);
    this.tail = null;
    this.tailRange = range;
    if (!range) return;
    const tail = new Primitive({
      geometryInstances: new GeometryInstance({ geometry: this.lineGeometry(range[0], range[1]) }),
      appearance: new PolylineColorAppearance({ translucent: false }),
      asynchronous: false,
    });
    this.scene.primitives.add(tail);
    this.tail = tail;
  }
}
