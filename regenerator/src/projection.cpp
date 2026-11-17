#include "projection.hpp"

namespace r05 {
namespace {
Pixel withinTile(Pixel anchor, Point local) {
    // Усечение применяется ко всему вертикальному слагаемому.
    return {anchor.x + 16 + local.x - local.y,
            anchor.y + (40 + local.x + local.y - 2 * local.z) / 2};
}

Point position(const r02::Tile& tile) {
    return {tile.x, tile.y, tile.z};
}
}

Pixel tileAnchor(Point tile, Offset camera) {
    const std::int64_t x = tile.x, y = tile.y, z = tile.z;
    return {16 * (x - y) + camera.x, 8 * (x + y) - 24 * z + camera.y};
}

Pixel voxelPixel(Point voxel, Offset camera) {
    const Point tile{voxel.x / 16, voxel.y / 16, voxel.z / 24};
    const Point local{voxel.x % 16, voxel.y % 16, voxel.z % 24};
    return withinTile(tileAnchor(tile, camera), local);
}

Pixel spriteAnchor(Point tile, std::uint8_t pLevel, Offset camera) {
    auto pixel = tileAnchor(tile, camera);
    pixel.y -= pLevel;
    return pixel;
}

Mask projectLoft(const r02::Tile& tile, const r03::Rows& occupied, Offset camera) {
    Mask mask;
    const auto anchor = tileAnchor(position(tile), camera);
    constexpr auto side = static_cast<std::int32_t>(r03::kSide);
    constexpr auto height = static_cast<std::int32_t>(r03::kHeight);
    for (std::int32_t z = 0; z < height; ++z) {
        for (std::int32_t y = 0; y < side; ++y) {
            const auto row = occupied[static_cast<std::size_t>(z * side + y)];
            for (std::int32_t x = 0; x < side; ++x) {
                if (row & (1u << (side - 1 - x))) {
                    mask.insert(withinTile(anchor, {x, y, z}));
                }
            }
        }
    }
    return mask;
}

Mask spriteMask(const r02::Tile& tile,
                std::span<const std::uint8_t, spriteWidth * spriteHeight> indices,
                std::uint8_t pLevel, bool rightHalf, Offset camera) {
    Mask mask;
    const auto anchor = spriteAnchor(position(tile), pLevel, camera);
    const std::size_t left = rightHalf ? spriteWidth / 2 : 0;
    for (std::size_t y = 0; y < spriteHeight; ++y) {
        for (std::size_t x = left; x < spriteWidth; ++x) {
            if (indices[y * spriteWidth + x] != 0) {
                mask.insert({anchor.x + static_cast<std::int64_t>(x),
                             anchor.y + static_cast<std::int64_t>(y)});
            }
        }
    }
    return mask;
}

Counts compare(const Mask& predicted, const Mask& observed) {
    std::size_t common = 0;
    for (const auto& pixel : predicted) {
        if (observed.contains(pixel)) ++common;
    }
    return {common, predicted.size() - common, observed.size() - common};
}
} // namespace r05
