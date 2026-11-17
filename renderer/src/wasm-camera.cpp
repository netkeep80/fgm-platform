#include "v03-map-camera.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace {
using namespace fgmv::v03;

constexpr MapSize demo_size{4,3,2};
constexpr Viewport demo_view{640,400};
constexpr MapPoint map_center{31.5,23.5,0};
constexpr double demo_plane = 0;
constexpr double depth_span = 16*(demo_size.width+demo_size.depth)+24*demo_size.levels;

const MapCamera initial_camera{demo_size,0,demo_view,{},4.5,MapAnchor{map_center,{320,220}}};
MapCamera camera = initial_camera;

double depth(MapPoint point) {
  // The iso-projection ray follows increasing view X, view Y and Z.
  const std::array<double,4> view_sum{
      point.x+point.y, point.x-point.y, -point.x-point.y, -point.x+point.y};
  return 0.5 - 0.5*(view_sum[camera.quarter_turns]+point.z)/depth_span;
}
} // namespace

extern "C" void fgm_camera_reset() {
  camera = initial_camera;
}

extern "C" int fgm_camera_turn(int steps) {
  try {
    camera = map_quarter_turn(camera,steps);
    return 0;
  } catch (...) {
    return 1;
  }
}

extern "C" int fgm_camera_zoom(double factor, double x, double y) {
  if (!std::isfinite(factor) || factor <= 0) return 1;
  try {
    const double zoom = std::clamp(camera.zoom*factor,1.5,12.0);
    if (zoom == camera.zoom) return 0;
    if (const auto next = reframe_map_at(camera,{x,y},demo_plane,0,zoom)) {
      camera = *next;
    } else {
      camera.anchor = MapAnchor{map_center,project_map(camera,map_center)};
      camera.pan = {};
      camera.zoom = zoom;
    }
    return 0;
  } catch (...) {
    return 1;
  }
}

extern "C" int fgm_camera_project(double x, double y, double z, double* output) {
  if (!output) return 1;
  try {
    const MapPoint world{x,y,z};
    const auto screen = project_map(camera,world).rounded();
    output[0] = screen.x;
    output[1] = screen.y;
    output[2] = depth(world);
    return 0;
  } catch (...) {
    return 1;
  }
}

extern "C" int fgm_camera_pick(double x, double y, double* output) {
  if (!output) return -1;
  try {
    const auto picked = pick_map_on_plane(camera,{x,y},demo_plane);
    if (!picked) return 0;
    output[0] = picked->world.x;
    output[1] = picked->world.y;
    output[2] = picked->tile.x;
    output[3] = picked->tile.y;
    return 1;
  } catch (...) {
    return -1;
  }
}
