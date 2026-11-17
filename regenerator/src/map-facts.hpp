#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace r02 {
using Bytes = std::vector<std::uint8_t>;

struct Tile {
    std::size_t recordIndex = 0;
    int x = 0, y = 0, z = 0;
    std::array<std::uint8_t, 4> parts{};
};
struct Map {
    std::uint8_t sizeY = 0, sizeX = 0, sizeZ = 0;
    std::vector<Tile> tiles;
};
struct DataSet {
    std::string id;
    Bytes bytes; // 62-byte records, never interpreted as mesh geometry
};
struct Facts {
    Map map;
    std::vector<DataSet> datasets; // order is significant
};
struct RecordReference {
    std::size_t setIndex, localIndex;
};
RecordReference resolveRecord(const std::vector<DataSet>& sets, std::size_t index);
Map decodeMap(const Bytes& raw);
Bytes encodeMap(const Map& decoded);
Facts decode(const Bytes& map, const std::vector<DataSet>& datasets);
std::string toJson(const Facts& facts);
} // namespace r02
