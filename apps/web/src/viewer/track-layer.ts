import {
  ArcType,
  Cartesian3,
  Color,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  Material,
  PolylineColorAppearance,
  PolylineCollection,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  type Polyline,
  ShowGeometryInstanceAttribute,
  type Scene,
} from 'cesium';

import type { TrackGeometry } from './track-geometry';
import { chunkRanges, progressOf, TRACK_CHUNK_POINTS, type TrackShown } from './track-progress';

/**
 * Линия трека и её тень на рельефе, нарезанные на куски (track-progress.ts):
 * «Весь» — все куски, «Пройденный» — куски до пилота плюс хвост.
 * Линия — один Primitive с вершинными цветами (ТЗ §7.3, CLAUDE.md):
 * PolylineGeometry({ colors, colorsPerVertex }) + PolylineColorAppearance,
 * по инстансу на кусок, у каждого свой флаг show.
 *
 * Хвост — от начала текущего куска до пилота — PolylineCollection из коротких
 * отрезков: их вершины меняются без пересборки геометрии, и последний отрезок
 * в каждом кадре кончается в позиции пилота. Раньше хвост был примитивом,
 * пересобираемым на каждой точке трека, — линия росла ступеньками раз в
 * секунду записи и мигала при пересборке.
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
  private readonly tail: PolylineCollection;
  /** Отрезки хвоста: кусок — до TRACK_CHUNK_POINTS отрезков, плюс отрезок до пилота. */
  private readonly tailLines: Polyline[] = [];
  /** Какие вершины [первая, последняя] уже разложены по отрезкам хвоста; null — хвост скрыт. */
  private tailVertices: [number, number] | null = null;
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

    this.tail = new PolylineCollection();
    for (let k = 0; k <= TRACK_CHUNK_POINTS + 1; k++) {
      this.tailLines.push(
        this.tail.add({
          show: false,
          width: style.linePx,
          positions: [Cartesian3.ZERO, Cartesian3.ZERO],
          material: Material.fromType('Color', { color: Color.WHITE }),
        }),
      );
    }
    scene.primitives.add(this.tail);
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

  /**
   * «Весь» или «Пройденный»; flownVertices — сколько вершин пилот уже миновал,
   * pilot — его позиция в этом кадре (между вершинами): хвост кончается в ней.
   */
  update(shown: TrackShown, flownVertices: number, pilot?: Cartesian3): void {
    const progress = shown === 'all' ? { fullChunks: this.ranges.length, tail: null } : progressOf(this.ranges, flownVertices);
    this.wantedChunks = progress.fullChunks;
    this.visibleLine = this.applyChunks(this.line, this.visibleLine);
    this.visibleShadow = this.applyChunks(this.shadow, this.visibleShadow);
    const start = this.ranges[progress.fullChunks]?.[0];
    const last = flownVertices - 1;
    this.setTail(shown === 'flown' && start !== undefined && last >= start ? [start, last] : null, pilot);
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

  private setTail(vertices: [number, number] | null, pilot: Cartesian3 | undefined): void {
    const lines = this.tailLines;
    if (!vertices) {
      if (this.tailVertices) for (const line of lines) line.show = false;
      this.tailVertices = null;
      return;
    }
    const [start, last] = vertices;
    // Отрезки между вершинами меняются только при смене вершин — раз в секунду записи.
    if (this.tailVertices?.[0] !== start || this.tailVertices[1] !== last) {
      for (let k = 0; k < lines.length - 1; k++) {
        const line = lines[k];
        if (!line) continue;
        const v = start + k;
        line.show = v < last;
        if (v >= last) continue;
        line.positions = [this.positions[v] ?? Cartesian3.ZERO, this.positions[v + 1] ?? Cartesian3.ZERO];
        (line.material.uniforms as { color: Color }).color = this.colors[v] ?? Color.WHITE;
      }
      this.tailVertices = [start, last];
    }
    // Последний отрезок — от миновавшей вершины до пилота, в каждом кадре.
    const toPilot = lines[last - start];
    for (let k = last - start + 1; k < lines.length; k++) {
      const line = lines[k];
      if (line) line.show = false;
    }
    if (!toPilot) return;
    const from = this.positions[last];
    toPilot.show = pilot !== undefined && from !== undefined;
    if (!toPilot.show || !pilot || !from) return;
    toPilot.positions = [from, pilot];
    (toPilot.material.uniforms as { color: Color }).color = this.colors[last] ?? Color.WHITE;
  }
}
