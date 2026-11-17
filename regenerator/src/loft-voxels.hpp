#pragma once

#include "map-facts.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace r03 {
constexpr std::size_t kSide = 16;
constexpr std::size_t kHeight = 24;
constexpr std::size_t kLayers = 12;
constexpr std::size_t kProfileBytes = 32;
constexpr std::size_t kRows = kSide * kHeight;
constexpr std::size_t kParts = 4;

using Profile = std::array<std::uint16_t, kSide>;
using Profiles = std::vector<Profile>;
using Rows = std::array<std::uint16_t, kRows>;

struct Source {
    bool present = false;
    std::uint8_t sourceIndex = 0;
    std::string dataset; // Caller-supplied label; not certified provenance.
    std::size_t localIndex = 0;
    std::array<std::uint8_t, kLayers> loftIds{};
};

struct TileMasks {
    r02::Tile tile;
    std::array<Source, kParts> sources{};
    std::array<Rows, kParts> partRows{};
    Rows unionRows{};
};

struct Hit {
    bool inBounds = false;
    int firstPart = -1; // -1 = empty, 0..3 = floor/west/north/object.
    std::array<bool, kParts> partHit{};
};

Profiles decodeLoft(const r02::Bytes& bytes);
TileMasks build(const r02::Facts& facts, const Profiles& profiles, int tileX, int tileY, int tileZ);
Hit sample(const TileMasks& masks, int x, int y, int z);
std::string toJson(const TileMasks& masks, std::size_t profileCount,
                   const std::optional<std::array<int, 3>>& probe = std::nullopt);
} // namespace r03
