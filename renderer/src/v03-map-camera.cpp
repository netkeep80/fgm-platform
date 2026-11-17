#include "v03-map-camera.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace fgmv::v03 {
namespace {
constexpr double side = 16;
constexpr double height = 24;
constexpr double low = -0.5;

struct Coordinate {
  double high = 0;
  double remainder = 0;

  Coordinate operator-() const { return {-high,-remainder}; }
};
struct PlaneCoordinates { Coordinate x, y; };

// TwoSum keeps the part lost when the rounded binary64 sum is formed.
Coordinate add_parts(double a, double b) {
  const double sum = a+b;
  if (!std::isfinite(sum)) return {sum,0};
  const double recovered_b = sum-a;
  return {sum,(a-(sum-recovered_b))+(b-recovered_b)};
}

Coordinate operator+(Coordinate a, Coordinate b) {
  const auto head = add_parts(a.high,b.high);
  const auto tail = add_parts(a.remainder,b.remainder);
  const auto middle = add_parts(head.remainder,tail.high);
  const auto merged = add_parts(head.high,middle.high);
  return add_parts(merged.high,merged.remainder+(middle.remainder+tail.remainder));
}

Coordinate operator-(Coordinate a, Coordinate b) {
  return a+(-b);
}

Coordinate operator*(Coordinate value, double factor) {
  const double product = value.high*factor;
  if (!std::isfinite(product)) return {product,0};
  const double tail = value.remainder*factor;
  return Coordinate{product,std::fma(value.high,factor,-product)} +
         Coordinate{tail,std::fma(value.remainder,factor,-tail)};
}

Coordinate operator/(Coordinate value, double divisor) {
  const double quotient = value.high/divisor;
  if (!std::isfinite(quotient)) return {quotient,0};
  const auto error = add_parts(std::fma(-quotient,divisor,value.high),value.remainder);
  const double correction = error.high/divisor;
  const double correction_error = std::fma(-correction,divisor,error.high)+error.remainder;
  return Coordinate{quotient}+Coordinate{correction,correction_error/divisor};
}

PlaneCoordinates unpack(MapScreen p) {
  return {{p.x,p.remainder.x},{p.y,p.remainder.y}};
}

MapScreen pack(Coordinate x, Coordinate y) {
  auto p = MapScreen{x.high,y.high};
  p.remainder = {x.remainder,y.remainder};
  return p;
}

bool finite(MapScreen p) {
  return std::isfinite(p.x) && std::isfinite(p.y) &&
         std::isfinite(p.remainder.x) && std::isfinite(p.remainder.y);
}

bool in_map_closed(const MapSize& size, MapPoint p) {
  return p.x >= low && p.x <= side*size.width+low &&
         p.y >= low && p.y <= side*size.depth+low &&
         p.z >= low && p.z <= height*size.levels+low;
}

void check_camera(const MapCamera& c) {
  if (c.size.width <= 0 || c.size.depth <= 0 || c.size.levels <= 0)
    throw std::invalid_argument("E_V03_MAP_SIZE");
  if (c.quarter_turns < 0 || c.quarter_turns > 3)
    throw std::invalid_argument("E_V03_ORIENTATION");
  if (c.viewport.width <= 0 || c.viewport.height <= 0 ||
      !finite(c.pan) || !std::isfinite(c.zoom) || c.zoom <= 0)
    throw std::invalid_argument("E_V03_MAP_VIEW");
  if (c.anchor && (!finite(c.anchor->pixel) || !in_map_closed(c.size,c.anchor->world)))
    throw std::invalid_argument("E_V03_MAP_ANCHOR");
}

MapPoint pivot(const MapSize& size) {
  return {0.5*(side*size.width-1), 0.5*(side*size.depth-1), 0};
}

MapAnchor reference(const MapCamera& c) {
  if (c.anchor) {
    const auto& a = *c.anchor;
    const auto pixel = unpack(a.pixel);
    return {a.world,pack(pixel.x+Coordinate{c.pan.x},pixel.y+Coordinate{c.pan.y})};
  }
  const auto p = pivot(c.size);
  return {p,pack(add_parts(0.5*c.viewport.width,c.pan.x)+Coordinate{16+p.x-p.y}*c.zoom,
                 add_parts(0.5*c.viewport.height,c.pan.y)+Coordinate{20+0.5*(p.x+p.y)}*c.zoom)};
}

PlaneCoordinates rotate(int turn, PlaneCoordinates point) {
  switch (turn) {
    case 0: return point;
    case 1: return {-point.y,point.x};
    case 2: return {-point.x,-point.y};
    case 3: return {point.y,-point.x};
    default: throw std::invalid_argument("E_V03_ORIENTATION");
  }
}

int next_turn(int turn, std::int64_t steps) {
  return quarter_turn(Camera{{},turn,0,0},steps).quarter_turns;
}

bool less_than(Coordinate value, double bound) {
  return value.high < bound || (value.high == bound && value.remainder < 0);
}

bool in_view(const Viewport& viewport, PlaneCoordinates cursor) {
  return !less_than(cursor.x,0) && less_than(cursor.x,viewport.width) &&
         !less_than(cursor.y,0) && less_than(cursor.y,viewport.height);
}

int owner(double coordinate, double span) {
  // Rounding the quotient can move the predecessor of a boundary up by one.
  const int candidate = static_cast<int>((coordinate-low)/span);
  return coordinate < candidate*span + low ? candidate-1 : candidate;
}

double spacing(double value) {
  const double magnitude = std::abs(value);
  return std::nextafter(magnitude,std::numeric_limits<double>::infinity())-magnitude;
}

std::optional<double> resolve_grid_coordinate(Coordinate coordinate, double tolerance) {
  const double seam = std::round((coordinate.high-low)/side)*side+low;
  const auto delta = coordinate-Coordinate{seam};
  const double previous = std::nextafter(seam,-std::numeric_limits<double>::infinity());
  if (std::abs(delta.high) <= tolerance) {
    // With binary64 world input, this face's owner is certain only if the
    // uncertainty interval excludes the representable point on its left.
    if (delta.high-tolerance <= previous-seam) return std::nullopt;
    return seam;
  }
  if (coordinate.high == seam && delta.high < 0) return previous;
  return coordinate.high;
}
} // namespace

MapCamera map_quarter_turn(const MapCamera& camera, std::int64_t steps) {
  check_camera(camera);
  MapCamera next = camera;
  next.quarter_turns = next_turn(camera.quarter_turns,steps);
  if (camera.anchor && next.quarter_turns != camera.quarter_turns) {
    const auto map_center = pivot(camera.size);
    next.anchor = MapAnchor{map_center,project_map(camera,map_center)};
    next.pan = {};
  }
  return next;
}

MapScreen project_map(const MapCamera& camera, MapPoint world) {
  check_camera(camera);
  if (!in_map_closed(camera.size, world)) throw std::invalid_argument("E_V03_MAP_POINT");
  const auto ref = reference(camera);
  const auto origin = unpack(ref.pixel);
  const auto p = rotate(camera.quarter_turns,
                        {add_parts(world.x,-ref.world.x),add_parts(world.y,-ref.world.y)});
  const auto elevation = add_parts(world.z,-ref.world.z);
  const auto pixel = pack(origin.x+(p.x-p.y)*camera.zoom,
                          origin.y+((p.x+p.y)*0.5-elevation)*camera.zoom);
  if (!finite(pixel)) throw std::invalid_argument("E_V03_MAP_RANGE");
  return pixel;
}

std::optional<PlaneSelection> pick_map_on_plane(const MapCamera& camera, MapScreen cursor, double z) {
  check_camera(camera);
  if (!std::isfinite(z) || z < low || z >= height*camera.size.levels+low)
    throw std::invalid_argument("E_V03_MAP_PLANE");
  if (!finite(cursor)) throw std::invalid_argument("E_V03_MAP_CURSOR");
  const auto pixel = unpack(cursor);
  if (!in_view(camera.viewport,pixel)) return std::nullopt;

  const auto ref = reference(camera);
  const auto origin = unpack(ref.pixel);
  const auto x_from_origin = pixel.x-origin.x;
  const auto y_from_origin = pixel.y-origin.y;
  const bool exact_anchor = camera.anchor && x_from_origin.high == 0 &&
                            y_from_origin.high == 0 && z == ref.world.z;
  MapPoint p{ref.world.x,ref.world.y,z};
  if (!exact_anchor) {
    const auto half_difference = (x_from_origin/camera.zoom)*0.5;
    const auto half_sum = y_from_origin/camera.zoom+add_parts(z,-ref.world.z);
    const auto delta = rotate((4-camera.quarter_turns)%4,
                              {half_sum+half_difference,half_sum-half_difference});
    const auto x = Coordinate{ref.world.x}+delta.x;
    const auto y = Coordinate{ref.world.y}+delta.y;
    if (!std::isfinite(x.high) || !std::isfinite(y.high)) return std::nullopt;

    const double world_scale = std::max({std::abs(delta.x.high),std::abs(delta.y.high),
                                         std::abs(z),std::abs(ref.world.z)});
    constexpr double epsilon = std::numeric_limits<double>::epsilon();
    // Projection and inverse share the same represented origin. The inverse
    // carries half of the horizontal output error and all of the vertical.
    const double screen_error = 0.25*spacing(pixel.x.remainder)+0.5*spacing(pixel.y.remainder);
    const double tolerance = (screen_error+
        8*std::numeric_limits<double>::denorm_min())/camera.zoom +
        16*epsilon*epsilon*world_scale;
    if (tolerance >= side/2) return std::nullopt;
    const auto resolved_x = resolve_grid_coordinate(x,tolerance);
    const auto resolved_y = resolve_grid_coordinate(y,tolerance);
    if (!resolved_x || !resolved_y) return std::nullopt;
    p.x = *resolved_x;
    p.y = *resolved_y;
  }
  if (!in_map_closed(camera.size,p) ||
      p.x >= side*camera.size.width+low || p.y >= side*camera.size.depth+low)
    return std::nullopt;
  return PlaneSelection{p, {owner(p.x,side),owner(p.y,side),owner(p.z,height)}};
}

std::optional<MapCamera> reframe_map_at(
    const MapCamera& camera, MapScreen cursor, double z, std::int64_t steps, double zoom) {
  if (!std::isfinite(zoom) || zoom <= 0) throw std::invalid_argument("E_V03_MAP_VIEW");
  const auto selected = pick_map_on_plane(camera,cursor,z);
  if (!selected) return std::nullopt;

  auto next = camera;
  next.quarter_turns = next_turn(camera.quarter_turns,steps);
  next.zoom = zoom;
  next.pan = {};
  // Store the reference as an exact world/pixel pair, avoiding a subtract/add
  // round-trip through a derived translation at half-open tile boundaries.
  next.anchor = MapAnchor{selected->world,cursor};
  return next;
}
} // namespace fgmv::v03
