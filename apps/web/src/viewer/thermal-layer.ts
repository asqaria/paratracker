import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  GeometryInstance,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Quaternion,
  ShowGeometryInstanceAttribute,
  Transforms,
  type Scene,
} from 'cesium';

import { COLUMN_ALPHA, type CurrentColumnStyle, type ThermalColumn } from './thermal-columns';

/**
 * Колонны термиков (ТЗ §7.2, задача 2.7): ОДИН Primitive, по экземпляру на
 * термик — цилиндр, повёрнутый матрицей экземпляра вдоль оси снизу вверх.
 * Цвет у экземпляра свой и один на весь цилиндр — это ColorGeometryInstanceAttribute,
 * а не вершинные цвета трека. Текущий термик подсвечивается или прячется
 * сменой атрибутов, без пересборки геометрии.
 *
 * Не PolylineVolumeGeometry: она для коридоров вдоль земли и строит сечение
 * по нормали к эллипсоиду — на почти вертикальной оси сечение вырождалось
 * в огромную плоскость через полкадра.
 */

/** Сегментов окружности: на радиусе 30–40 м гладко, треугольников — десятки на колонну. */
const CIRCLE_SEGMENTS = 24;
const CHANNEL_MAX = 255;
const UP = Cartesian3.UNIT_Z;
/** Ось короче сантиметра — направление не определено, цилиндр стоит вертикально. */
const MIN_AXIS_M = 0.01;

/**
 * Матрица экземпляра: цилиндр CylinderGeometry стоит центром в начале координат
 * вдоль Z; поворот Z → ось колонны и перенос в её середину — в локальной
 * системе восток-север-вверх этой середины.
 */
function columnMatrix(bottom: Cartesian3, top: Cartesian3): { matrix: Matrix4; length: number } {
  const middle = Cartesian3.midpoint(bottom, top, new Cartesian3());
  const enu = Transforms.eastNorthUpToFixedFrame(middle);
  const toLocal = Matrix4.inverseTransformation(enu, new Matrix4());
  const axisFixed = Cartesian3.subtract(top, bottom, new Cartesian3());
  const axis = Matrix4.multiplyByPointAsVector(toLocal, axisFixed, new Cartesian3());
  const length = Cartesian3.magnitude(axis);
  let rotation = Quaternion.IDENTITY;
  if (length > MIN_AXIS_M) {
    const direction = Cartesian3.normalize(axis, new Cartesian3());
    const pivot = Cartesian3.cross(UP, direction, new Cartesian3());
    const angle = Math.acos(Math.min(1, Math.max(-1, Cartesian3.dot(UP, direction))));
    if (Cartesian3.magnitude(pivot) > Number.EPSILON) {
      rotation = Quaternion.fromAxisAngle(Cartesian3.normalize(pivot, pivot), angle);
    }
  }
  const local = Matrix4.fromRotationTranslation(Matrix3.fromQuaternion(rotation), Cartesian3.ZERO);
  return { matrix: Matrix4.multiply(enu, local, new Matrix4()), length };
}

const colorOf = (column: ThermalColumn, alpha: number): Color =>
  new Color(column.rgb[0] / CHANNEL_MAX, column.rgb[1] / CHANNEL_MAX, column.rgb[2] / CHANNEL_MAX, alpha);

export class ThermalLayer {
  private readonly primitive: Primitive | null;
  /** Выделенная сейчас и та, что нужно выделить: атрибуты доступны лишь у готового примитива. */
  private current: { index: number | null; style: CurrentColumnStyle } = { index: null, style: 'highlight' };
  private wanted: { index: number | null; style: CurrentColumnStyle } = { index: null, style: 'highlight' };
  private readonly stopListening: () => void;

  constructor(
    private readonly scene: Scene,
    private readonly columns: readonly ThermalColumn[],
  ) {
    if (columns.length === 0) {
      this.primitive = null;
      this.stopListening = () => undefined;
      return;
    }
    this.primitive = new Primitive({
      geometryInstances: columns.map((column, k) => {
        const { matrix, length } = columnMatrix(
          Cartesian3.fromDegrees(column.bottom.lon, column.bottom.lat, column.bottom.alt),
          Cartesian3.fromDegrees(column.top.lon, column.top.lat, column.top.alt),
        );
        return new GeometryInstance({
          id: k,
          geometry: new CylinderGeometry({
            length,
            topRadius: column.radiusM,
            bottomRadius: column.radiusM,
            slices: CIRCLE_SEGMENTS,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          modelMatrix: matrix,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(colorOf(column, COLUMN_ALPHA.other)),
            show: new ShowGeometryInstanceAttribute(true),
          },
        });
      }),
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
      // Колонн десятки: синхронная сборка — доли миллисекунды, зато атрибуты
      // доступны сразу после первого кадра.
      asynchronous: false,
    });
    scene.primitives.add(this.primitive);
    // Подсветка, заказанная до готовности примитива, применяется после кадра, в котором он собрался.
    this.stopListening = scene.postRender.addEventListener(() => {
      if (this.wanted.index !== this.current.index || this.wanted.style !== this.current.style) this.apply();
    });
  }

  setVisible(visible: boolean): void {
    if (this.primitive) this.primitive.show = visible;
  }

  /** Выделить колонну с номером index (в выходе thermalColumns); null — ни одну. */
  setCurrent(index: number | null, style: CurrentColumnStyle): void {
    this.wanted = { index, style };
    this.apply();
  }

  private apply(): void {
    const { index, style } = this.wanted;
    if (!this.primitive?.ready) return;
    if (index === this.current.index && style === this.current.style) return;
    for (const k of new Set([this.current.index, index])) {
      if (k === null) continue;
      const column = this.columns[k];
      const attributes = this.primitive.getGeometryInstanceAttributes(k) as { color?: Uint8Array; show?: Uint8Array } | undefined;
      if (!column || !attributes) continue;
      const isCurrent = k === index;
      attributes.color = ColorGeometryInstanceAttribute.toValue(
        colorOf(column, isCurrent && style === 'highlight' ? COLUMN_ALPHA.current : COLUMN_ALPHA.other),
      );
      attributes.show = ShowGeometryInstanceAttribute.toValue(!(isCurrent && style === 'hide'));
    }
    this.current = { index, style };
    this.scene.requestRender();
  }

  destroy(): void {
    this.stopListening();
    // Сцену могли уничтожить раньше слоя (вместе с Viewer) — примитивы ушли с ней.
    if (this.primitive && !this.scene.isDestroyed()) this.scene.primitives.remove(this.primitive);
  }
}
