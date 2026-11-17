#include "projection.hpp"

#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>

namespace {
void expect(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void anchors() {
    using r05::Pixel;
    expect(r05::tileAnchor({0, 0, 0}) == Pixel{0, 0}, "tile origin");
    expect(r05::tileAnchor({1, 0, 0}) == Pixel{16, 8}, "tile x");
    expect(r05::tileAnchor({0, 1, 0}) == Pixel{-16, 8}, "tile y");
    expect(r05::tileAnchor({0, 0, 1}) == Pixel{0, -24}, "tile floor");
    expect(r05::tileAnchor({3, 2, 1}, {101, -43}) == Pixel{117, -27}, "camera translation");
    expect(r05::voxelPixel({0, 0, 0}) == Pixel{16, 20}, "voxel origin");
    expect(r05::voxelPixel({16, 0, 0}) == Pixel{32, 28}, "voxel x boundary");
    expect(r05::voxelPixel({0, 16, 0}) == Pixel{0, 28}, "voxel y boundary");
    expect(r05::voxelPixel({0, 0, 24}) == Pixel{16, -4}, "voxel z boundary");
    expect(r05::voxelPixel({1, 0, 23}) == Pixel{17, -2}, "truncate whole subexpression");
    expect(r05::voxelPixel({15, 15, 23}) == Pixel{16, 12}, "last voxel");
    expect(r05::voxelPixel({-1, 0, 24}) == Pixel{15, -5}, "negative signed remainder");
    expect(r05::voxelPixel({49, 34, 25}, {2, 3}) == Pixel{33, 39}, "voxel camera");
    expect(r05::spriteAnchor({3, 2, 1}, 255, {101, -43}) == Pixel{117, -282}, "unsigned P_Level");
}

void observation() {
    using r05::Pixel;
    const r02::Tile tile{0, 2, 1, 1, {}};
    r03::Rows rows{};
    rows[0] = 0xc000;
    rows[16] = 0x4000;
    rows[23 * 16] = 0x4000;
    const auto predicted = r05::projectLoft(tile, rows, {-16, 0});
    const r05::Mask oracle{{16, 20}, {17, 20}, {17, 19}, {17, -2}};
    expect(predicted == oracle, "occupied LOFT samples, overlap, and negative Y");

    std::array<std::uint8_t, 32 * 40> raster{};
    raster[22 * 32 + 16] = 3;
    raster[22 * 32 + 17] = 253;
    raster[24 * 32 + 17] = 1;
    raster[27 * 32 + 4] = 5;
    const auto observed = r05::spriteMask(tile, raster, 2, false, {-16, 0});
    const auto counts = r05::compare(predicted, observed);
    expect(counts.common == 2 && counts.predictedOnly == 2 && counts.observedOnly == 2, "mask comparison");
    const auto half = r05::spriteMask(tile, raster, 2, true, {-16, 0});
    expect(half == r05::Mask{{16, 20}, {17, 20}, {17, 22}}, "right half retains native x");
    expect(r05::compare({}, {}).common == 0, "empty comparison");

    const r05::Offset delta{57, -19};
    auto moved = r05::projectLoft(tile, rows, {delta.x - 16, delta.y});
    auto movedObserved = r05::spriteMask(tile, raster, 2, false, {delta.x - 16, delta.y});
    expect(r05::compare(moved, movedObserved) == counts, "common camera offset leaves comparison unchanged");
}
}

int main() {
    try {
        anchors();
        observation();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
