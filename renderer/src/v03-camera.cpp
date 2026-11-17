#include "v03-camera.hpp"

#include <cmath>
#include <stdexcept>
#include <utility>

namespace fgmv::v03 {
namespace {
constexpr int kSide = 16;
constexpr int kHeight = 24;
constexpr int kTileLimit = 1000000;
constexpr std::int64_t kOffsetLimit = 1000000;

void check_camera(const Camera& camera) {
  if (camera.quarter_turns < 0 || camera.quarter_turns > 3)
    throw std::invalid_argument("E_V03_ORIENTATION");
  if (std::abs(static_cast<std::int64_t>(camera.tile.x)) > kTileLimit ||
      std::abs(static_cast<std::int64_t>(camera.tile.y)) > kTileLimit ||
      std::abs(static_cast<std::int64_t>(camera.tile.z)) > kTileLimit ||
      camera.offset_x < -kOffsetLimit || camera.offset_x > kOffsetLimit ||
      camera.offset_y < -kOffsetLimit || camera.offset_y > kOffsetLimit)
    throw std::invalid_argument("E_V03_ANCHOR");
}
void check_voxel(Voxel value) {
  if (value.x < 0 || value.x >= kSide || value.y < 0 ||
      value.y >= kSide || value.z < 0 || value.z >= kHeight)
    throw std::invalid_argument("E_V03_VOXEL");
}
void check_point(double x, double y, double z) {
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z))
    throw std::invalid_argument("E_V03_NONFINITE");
  if (x < 0 || x >= kSide || y < 0 || y >= kSide || z < 0 || z >= kHeight)
    throw std::invalid_argument("E_V03_POINT");
}
std::pair<double,double> rotate_double(int turns, double x, double y) {
  switch (turns) {
    case 0: return {x,y};
    case 1: return {15-y,x};
    case 2: return {15-x,15-y};
    case 3: return {y,15-x};
    default: throw std::invalid_argument("E_V03_ORIENTATION");
  }
}
std::pair<double,double> inverse_double(int turns, double x, double y) {
  switch (turns) {
    case 0: return {x,y};
    case 1: return {y,15-x};
    case 2: return {15-x,15-y};
    case 3: return {15-y,x};
    default: throw std::invalid_argument("E_V03_ORIENTATION");
  }
}
} // namespace

Camera quarter_turn(const Camera& camera, std::int64_t steps) {
  check_camera(camera);
  Camera rotated=camera;
  rotated.quarter_turns=static_cast<int>((camera.quarter_turns+(steps%4)+4)%4);
  return rotated;
}
Pixel tile_anchor(const Camera& camera) {
  check_camera(camera);
  const auto x=static_cast<std::int64_t>(camera.tile.x);
  const auto y=static_cast<std::int64_t>(camera.tile.y);
  const auto z=static_cast<std::int64_t>(camera.tile.z);
  return {16*(x-y)+camera.offset_x, 8*(x+y)-24*z+camera.offset_y};
}
Voxel rotated_voxel(int turns, Voxel local) {
  check_voxel(local);
  switch (turns) {
    case 0: return local;
    case 1: return {15-local.y,local.x,local.z};
    case 2: return {15-local.x,15-local.y,local.z};
    case 3: return {local.y,15-local.x,local.z};
    default: throw std::invalid_argument("E_V03_ORIENTATION");
  }
}
Pixel raster_pixel(const Camera& camera, Voxel local) {
  const auto anchor=tile_anchor(camera);
  const auto p=rotated_voxel(camera.quarter_turns,local);
  // C++ integral division is toward zero, also when the numerator is negative.
  // This reproduces r05::withinTile, not floor()/round() or a GPU approximation.
  return {anchor.x+16+p.x-p.y,
          anchor.y+(40+p.x+p.y-2*p.z)/2};
}
Screen project_continuous(const Camera& camera,double x,double y,double z) {
  const auto anchor=tile_anchor(camera);
  check_point(x,y,z);
  const auto [a,b]=rotate_double(camera.quarter_turns,x,y);
  return {static_cast<double>(anchor.x)+16+a-b,
          static_cast<double>(anchor.y)+20+0.5*(a+b)-z};
}
std::optional<PlanePoint> unproject_on_plane(
    const Camera& camera,Screen screen,double z) {
  const auto anchor=tile_anchor(camera);
  if (!std::isfinite(screen.x) || !std::isfinite(screen.y) || !std::isfinite(z))
    throw std::invalid_argument("E_V03_NONFINITE");
  if (z<0 || z>=kHeight) throw std::invalid_argument("E_V03_PLANE");
  const double difference=screen.x-static_cast<double>(anchor.x)-16;
  const double sum=2*(screen.y-static_cast<double>(anchor.y)-20+z);
  const auto [x,y]=inverse_double(camera.quarter_turns,
                                  (sum+difference)/2,(sum-difference)/2);
  if (!std::isfinite(x) || !std::isfinite(y) ||
      x<0 || x>=kSide || y<0 || y>=kSide) return std::nullopt;
  return PlanePoint{x,y};
}
} // namespace fgmv::v03
