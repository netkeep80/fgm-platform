#include "loft-voxels.hpp"

#include <array>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string_view>

namespace r03 {
namespace {
constexpr std::array<std::string_view,kParts> kNames{
    "floor","west_wall","north_wall","object"
};
void require(bool ok, const char* error) {
    if (!ok) throw std::runtime_error(error);
}
void escaped(std::ostream& stream, std::string_view value) {
    stream << '"';
    constexpr char digits[] = "0123456789abcdef";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') stream << '\\' << char(c);
        else if (c == '\n') stream << "\\n";
        else if (c == '\r') stream << "\\r";
        else if (c == '\t') stream << "\\t";
        else if (c < 32) stream << "\\u00" << digits[c >> 4] << digits[c & 15];
        else stream << char(c);
    }
    stream << '"';
}
std::size_t rowIndex(int y, int z) {
    return std::size_t(z) * kSide + std::size_t(y);
}
void rowsJson(std::ostream& out, const Rows& rows) {
    out << '[';
    for (std::size_t z = 0; z < kHeight; ++z) {
        if(z) out << ',';
        out << '[';
        for (std::size_t y = 0; y < kSide; ++y) {
            if(y) out << ',';
            out << rows[z * kSide + y];
        }
        out << ']';
    }
    out << ']';
}
} // namespace

Profiles decodeLoft(const r02::Bytes& bytes) {
    // Source LOFTEMPS.DAT is a stream of little-endian 16-bit rows.
    // An MCD LOFT ID is uint8_t, therefore only first 256 profiles are addressable.
    require(!bytes.empty() && bytes.size() % kProfileBytes == 0,
            "E_R03_LOFT_ALIGNMENT");
    require(bytes.size() <= 256 * kProfileBytes, "E_R03_LOFT_LIMIT");
    Profiles result(bytes.size() / kProfileBytes);
    for (std::size_t profile = 0; profile < result.size(); ++profile) {
        for (std::size_t y = 0; y < kSide; ++y) {
            const std::size_t offset = profile * kProfileBytes + y * 2;
            result[profile][y] =
                std::uint16_t(unsigned(bytes[offset]) | (unsigned(bytes[offset + 1]) << 8));
        }
    }
    return result;
}

TileMasks build(const r02::Facts& facts, const Profiles& profiles,
                int tileX, int tileY, int tileZ) {
    const auto& map = facts.map;
    require(tileX >= 0 && tileY >= 0 && tileZ >= 0 &&
            tileX < map.sizeX && tileY < map.sizeY && tileZ < map.sizeZ,
            "E_R03_TILE_BOUNDS");
    require(!profiles.empty() && profiles.size() <= 256, "E_R03_LOFT_LIMIT");

    const auto index = (std::size_t(map.sizeZ - 1 - tileZ) * map.sizeY +
                       std::size_t(tileY)) * map.sizeX + std::size_t(tileX);
    require(index < map.tiles.size(), "E_R03_TILE_BOUNDS");
    TileMasks result{};
    result.tile = map.tiles[index];
    require(result.tile.x == tileX && result.tile.y == tileY &&
            result.tile.z == tileZ && result.tile.recordIndex == index,
            "E_R03_TILE_ORDER");

    for (std::size_t part = 0; part < kParts; ++part) {
        auto& target = result.sources[part];
        target.sourceIndex = result.tile.parts[part];
        if (target.sourceIndex == 0) continue; // MAP byte 0 = missing part, not LOFT ID 0.
        target.present = true;
        std::size_t global = target.sourceIndex; // No off-by-one.
        const r02::DataSet* matched = nullptr;
        for (const auto& set : facts.datasets) {
            require(!set.bytes.empty() && set.bytes.size() % 62 == 0,
                    "E_R03_MCD_ALIGNMENT");
            const auto count = set.bytes.size() / 62;
            if (global < count) {
                matched = &set;
                target.localIndex = global;
                target.dataset = set.id;
                break;
            }
            global -= count;
        }
        require(matched != nullptr, "E_R03_MAP_REFERENCE");
        const auto offset = target.localIndex * 62;
        for (std::size_t layer = 0; layer < kLayers; ++layer) {
            const auto profile = matched->bytes[offset + 8 + layer];
            require(profile < profiles.size(), "E_R03_LOFT_REFERENCE");
            target.loftIds[layer] = profile;
            const auto& rows = profiles[profile];
            for (std::size_t parity = 0; parity < 2; ++parity) {
                const auto z = layer * 2 + parity;
                for (std::size_t y = 0; y < kSide; ++y) {
                    result.partRows[part][z * kSide + y] = rows[y];
                    result.unionRows[z * kSide + y] |= rows[y];
                }
            }
        }
    }
    return result;
}

Hit sample(const TileMasks& masks, int x, int y, int z) {
    Hit result{};
    if (x < 0 || y < 0 || z < 0 ||
        x >= int(kSide) || y >= int(kSide) || z >= int(kHeight))
        return result;
    result.inBounds = true;
    const auto index = rowIndex(y,z);
    const auto bit = std::uint16_t(1u << unsigned(15 - x)); // OpenXcom reversed X.
    for (std::size_t part = 0; part < kParts; ++part) {
        result.partHit[part] = (masks.partRows[part][index] & bit) != 0;
        if (result.partHit[part] && result.firstPart < 0)
            result.firstPart = int(part);
    }
    return result;
}

std::string toJson(const TileMasks& masks, std::size_t profileCount,
                   const std::optional<std::array<int,3>>& probe) {
    std::ostringstream out;
    out << "{\"schema\":\"fgm-regenerator/loft-terrain-v1\",\"voxel_dimensions_xyz\":[16,16,24],"
        << "\"mask_coordinates\":\"local XYZ; rows[z][y]; bit 15-x\","
        << "\"terrain_only\":true,\"dynamic_doors_units_gravlift\":false,"
        << "\"loft_profiles\":" << profileCount << ",\"tile\":{\"xyz\":["
        << masks.tile.x << ',' << masks.tile.y << ',' << masks.tile.z
        << "],\"record_index\":" << masks.tile.recordIndex << "},\"sources\":[";
    for (std::size_t p = 0; p < kParts; ++p) {
        if (p) out << ',';
        const auto& src = masks.sources[p];
        out << "{\"part\":";
        escaped(out,kNames[p]);
        out << ",\"source_index\":" << unsigned(src.sourceIndex)
            << ",\"present\":" << (src.present?"true":"false");
        if (src.present) {
            out << ",\"dataset_label\":";
            escaped(out,src.dataset);
            out << ",\"local_index\":" << src.localIndex << ",\"loft_ids\":[";
            for (std::size_t layer=0; layer<kLayers; ++layer) {
                if (layer) out << ',';
                out << unsigned(src.loftIds[layer]);
            }
            out << ']';
        }
        out << '}';
    }
    out << "],\"part_rows\":[";
    for (std::size_t p=0;p<kParts;++p) {
        if(p) out << ',';
        rowsJson(out,masks.partRows[p]);
    }
    out << "],\"union_rows\":";
    rowsJson(out,masks.unionRows);
    out << ",\"first_hit_rows\":[";
    std::array<std::size_t,kParts> partCount{};
    std::size_t unionCount=0;
    constexpr char winners[] = "FWNO";
    for (int z=0;z<int(kHeight);++z) {
        if(z) out << ',';
        out << '[';
        for (int y=0;y<int(kSide);++y) {
            if(y) out << ',';
            std::string line;
            line.reserve(kSide);
            for (int x=0;x<int(kSide);++x) {
                const Hit h = sample(masks,x,y,z);
                line.push_back(h.firstPart < 0 ? '.' : winners[h.firstPart]);
                if(h.firstPart>=0) ++unionCount;
                for (std::size_t p=0;p<kParts;++p)
                    if(h.partHit[p]) ++partCount[p];
            }
            escaped(out,line);
        }
        out << ']';
    }
    out << "],\"counts\":{\"union\":" << unionCount << ",\"parts\":[";
    for (std::size_t p=0;p<kParts;++p) {
        if(p) out << ',';
        out << partCount[p];
    }
    out << "]}";
    if (probe) {
        const int x=(*probe)[0],y=(*probe)[1],z=(*probe)[2];
        const auto h=sample(masks,x,y,z);
        out << ",\"sample\":{\"xyz\":["<<x<<','<<y<<','<<z<<"],\"status\":\"";
        out << (!h.inBounds?"out_of_bounds":(h.firstPart<0?"empty":"hit")) << '"';
        if(h.inBounds) {
            out << ",\"first_part\":" << h.firstPart << ",\"witnesses\":[";
            bool first=true;
            for (std::size_t p=0;p<kParts;++p) {
                if(!h.partHit[p])continue;
                if(!first)out<<',';
                first=false;
                const auto& src=masks.sources[p];
                const std::uint8_t id=src.loftIds[std::size_t(z)/2];
                out << "{\"part\":";
                escaped(out,kNames[p]);
                out << ",\"source_index\":" << unsigned(src.sourceIndex)
                    << ",\"dataset_label\":";
                escaped(out,src.dataset);
                out << ",\"local_index\":"<<src.localIndex
                    << ",\"loft_id\":"<<unsigned(id)
                    << ",\"row\":"<<y<<",\"bit\":"<<15-x
                    << ",\"row_mask\":"<<masks.partRows[p][rowIndex(y,z)]<<'}';
            }
            out << ']';
        }
        out << '}';
    }
    out << "}\n";
    return out.str();
}
} // namespace r03
