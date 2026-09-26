import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineMaterialAppearance,
  VerticalOrigin,
  type Scene,
} from 'cesium';

import type { XcRoute } from './xc-route';

/**
 * XC-маршрут на сцене (ТЗ §6.6, задача 3.3): контур по рельефу, у
 * треугольника — полупрозрачная заливка, у ППМ — точки с номерами на высоте,
 * где пилот их прошёл. Три примитива на весь маршрут, без Entity.
 */

const OUTLINE_PX = 3;
const FILL_ALPHA = 0.15;
const MARKER_PX = 10;
const MARKER_OUTLINE_PX = 2;
/** Подпись над точкой, px: не наезжает на саму точку. */
const LABEL_OFFSET_PX = -14;
const LABEL_FONT = '600 14px Inter, sans-serif';

export class XcLayer {
  private readonly outline: GroundPolylinePrimitive;
  private readonly fill: GroundPrimitive | null;
  private readonly points = new PointPrimitiveCollection();
  private readonly labels = new LabelCollection();

  constructor(
    private readonly scene: Scene,
    route: XcRoute,
    color: Color,
    /** Высота трека сцены в момент прохождения ППМ, м над эллипсоидом. */
    altitudeAt: (timeMs: number) => number,
  ) {
    const positions = route.path.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
    this.outline = new GroundPolylinePrimitive({
      geometryInstances: new GeometryInstance({ geometry: new GroundPolylineGeometry({ positions, width: OUTLINE_PX }) }),
      appearance: new PolylineMaterialAppearance({ material: Material.fromType('Color', { color }) }),
    });
    scene.groundPrimitives.add(this.outline);

    this.fill = route.closed
      ? new GroundPrimitive({
          geometryInstances: new GeometryInstance({
            geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(positions.slice(0, -1)) }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(FILL_ALPHA)) },
          }),
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        })
      : null;
    if (this.fill) scene.groundPrimitives.add(this.fill);

    for (const marker of route.markers) {
      const position = Cartesian3.fromDegrees(marker.lon, marker.lat, altitudeAt(marker.timeMs));
      this.points.add({
        position,
        pixelSize: MARKER_PX,
        color,
        outlineColor: Color.WHITE,
        outlineWidth: MARKER_OUTLINE_PX,
        // Маркер виден сквозь склон: ППМ за гребнем — тоже часть маршрута.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      this.labels.add({
        position,
        text: marker.label,
        font: LABEL_FONT,
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: MARKER_OUTLINE_PX,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian3(0, LABEL_OFFSET_PX, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    scene.primitives.add(this.points);
    scene.primitives.add(this.labels);
  }

  setVisible(visible: boolean): void {
    this.outline.show = visible;
    if (this.fill) this.fill.show = visible;
    this.points.show = visible;
    this.labels.show = visible;
  }

  destroy(): void {
    this.scene.groundPrimitives.remove(this.outline);
    if (this.fill) this.scene.groundPrimitives.remove(this.fill);
    this.scene.primitives.remove(this.points);
    this.scene.primitives.remove(this.labels);
  }
}
