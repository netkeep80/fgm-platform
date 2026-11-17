#pragma once
#include <cstdint>
#include <optional>

namespace fgmv::v03 {
struct Voxel { int x = 0, y = 0, z = 0; };
struct Tile { int x = 0, y = 0, z = 0; };
struct Pixel { std::int64_t x = 0, y = 0; };
struct Screen { double x = 0, y = 0; };
struct PlanePoint { double x = 0, y = 0; };

// Single-tile R05 calibration. A quarter-turn rotates the local x/y axes;
// it never rotates FGM data or changes world-space collision semantics.
struct Camera {
  Tile tile{};
  int quarter_turns = 0; // 0, 1, 2, 3; four quarter-turns restore the start
  std::int64_t offset_x = 0, offset_y = 0;
};

Camera quarter_turn(const Camera& camera, std::int64_t steps);
Pixel tile_anchor(const Camera& camera);
Voxel rotated_voxel(int turns, Voxel local);
Pixel raster_pixel(const Camera& camera, Voxel local); // exact R05 integer truncation
Screen project_continuous(const Camera& camera, double x, double y, double z);
// Inverse of the continuous camera on the *specified* z plane.
// Not a depth query, object picker, visibility oracle, or inverse of integer truncation.
// Out-of-tile points yield nullopt; invalid/nonfinite inputs throw.
std::optional<PlanePoint> unproject_on_plane(
    const Camera& camera, Screen screen, double z);
} // namespace fgmv::v03
