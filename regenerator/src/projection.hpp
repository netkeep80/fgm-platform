#pragma once

#include "loft-voxels.hpp"

#include <compare>
#include <cstddef>
#include <cstdint>
#include <set>
#include <span>

namespace r05 {
struct Point { std::int32_t x, y, z; };
struct Offset { std::int32_t x = 0, y = 0; };
struct Pixel {
    std::int64_t x, y;
    auto operator<=>(const Pixel&) const = default;
};
struct Counts {
    std::size_t common, predictedOnly, observedOnly;
    bool operator==(const Counts&) const = default;
};
using Mask = std::set<Pixel>;
inline constexpr std::size_t spriteWidth = 32, spriteHeight = 40;

Pixel tileAnchor(Point tile, Offset camera = {});
Pixel voxelPixel(Point voxel, Offset camera = {});
Pixel spriteAnchor(Point tile, std::uint8_t pLevel, Offset camera = {});
Mask projectLoft(const r02::Tile& tile, const r03::Rows& occupied, Offset camera = {});
Mask spriteMask(const r02::Tile& tile,
                std::span<const std::uint8_t, spriteWidth * spriteHeight> indices,
                std::uint8_t pLevel, bool rightHalf, Offset camera = {});
Counts compare(const Mask& predicted, const Mask& observed);
}
