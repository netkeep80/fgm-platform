#pragma once

#include "v03-camera.hpp"

namespace fgmv::v03 {
struct MapSize { int width = 0, depth = 0, levels = 0; };
struct Viewport { int width = 0, height = 0; };
struct MapPoint { double x = 0, y = 0, z = 0; };
// The high pair is drawable. The low pair preserves sub-ULP projection
// information for an inverse query or a change of camera reference.
struct MapScreen {
  double x = 0, y = 0;
  Screen remainder{};

  constexpr MapScreen() = default;
  constexpr MapScreen(double x, double y) : x(x), y(y) {}
  constexpr MapScreen(Screen pixel) : MapScreen(pixel.x,pixel.y) {}
  constexpr Screen rounded() const { return {x,y}; }
};
struct MapAnchor { MapPoint world; MapScreen pixel; };
struct MapCamera {
  MapSize size;
  int quarter_turns = 0;
  Viewport viewport;
  Screen pan{};
  double zoom = 1;
  std::optional<MapAnchor> anchor{};
};
struct PlaneSelection { MapPoint world; Tile tile; };

MapCamera map_quarter_turn(const MapCamera& camera, std::int64_t steps);
MapScreen project_map(const MapCamera& camera, MapPoint world);
// Only an explicit plane query, with half-open tile and viewport ownership.
std::optional<PlaneSelection> pick_map_on_plane(const MapCamera& camera, MapScreen cursor, double z);
std::optional<MapCamera> reframe_map_at(
    const MapCamera& camera, MapScreen cursor, double z, std::int64_t steps, double zoom);
} // namespace fgmv::v03
