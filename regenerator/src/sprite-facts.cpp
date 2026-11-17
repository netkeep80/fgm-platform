#include "sprite-facts.hpp"

#include <algorithm>
#include <array>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace r04 {
namespace {
using Bytes = std::span<const std::uint8_t>;
constexpr std::size_t width = 32, height = 40, pixelCount = width * height;
constexpr std::size_t paletteSize = 768, paletteStride = paletteSize + 6;
constexpr std::size_t mcdRecordSize = 62, mcdSlotCount = 8;
using Raster = std::array<std::uint8_t, pixelCount>;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::vector<std::size_t> readOffsets(Bytes tab, std::size_t pckSize, unsigned bits) {
    require(bits == 16 || bits == 32, "E_R04_ARGUMENTS");
    const std::size_t stride = bits / 8;
    require(!tab.empty() && tab.size() % stride == 0, "E_R04_TAB_LENGTH");
    std::vector<std::size_t> offsets;
    offsets.reserve(tab.size() / stride + 1);
    for (std::size_t start = 0; start < tab.size(); start += stride) {
        std::uint32_t offset = 0;
        for (std::size_t i = 0; i < stride; ++i)
            offset |= std::uint32_t(tab[start + i]) << (8 * i);
        require(offset < pckSize && (offsets.empty() ? offset == 0 : offset > offsets.back()),
                "E_R04_TAB_OFFSET");
        offsets.push_back(offset);
    }
    offsets.push_back(pckSize);
    return offsets;
}

Raster decodeFrame(Bytes frame) {
    Raster raster{};
    std::size_t pixel = std::size_t(frame.front()) * width;
    require(pixel <= raster.size(), "E_R04_FRAME_BOUNDS");
    for (std::size_t cursor = 1; cursor < frame.size(); ++cursor) {
        const auto value = frame[cursor];
        if (value == 255) {
            require(cursor + 1 == frame.size(), "E_R04_FRAME_TRAILING");
            return raster;
        }
        if (value == 254) {
            require(++cursor < frame.size(), "E_R04_FRAME_RUN");
            const std::size_t run = frame[cursor];
            pixel += std::min(run, raster.size() - pixel);
        } else {
            require(pixel < raster.size(), "E_R04_FRAME_BOUNDS");
            raster[pixel++] = value;
        }
    }
    throw std::runtime_error("E_R04_FRAME_TERMINATOR");
}

void writePalette(std::ostream& out, Bytes palette, unsigned multiplier) {
    out << '[';
    for (std::size_t i = 0; i < palette.size(); i += 3) {
        if (i != 0) out << ',';
        out << '[' << palette[i] * multiplier << ',' << palette[i + 1] * multiplier
            << ',' << palette[i + 2] * multiplier << ']';
    }
    out << ']';
}

void writeRaster(std::ostream& out, const Raster& raster, bool alpha) {
    constexpr char hex[] = "0123456789abcdef";
    out << '"';
    for (auto value : raster) {
        if (alpha) value = value == 0 ? 0 : 255;
        out << hex[value >> 4] << hex[value & 15];
    }
    out << '"';
}
} // namespace

std::string spriteFacts(Bytes pck, Bytes tab, Bytes palette, Bytes mcd,
                        unsigned tabBits, std::size_t paletteIndex, std::size_t record) {
    require(!mcd.empty() && mcd.size() % mcdRecordSize == 0, "E_R04_MCD_ALIGNMENT");
    require(record < mcd.size() / mcdRecordSize, "E_R04_MCD_RECORD");
    const auto slots = mcd.subspan(record * mcdRecordSize, mcdSlotCount);

    require(palette.size() >= paletteSize && paletteIndex <= (palette.size() - paletteSize) / paletteStride,
            "E_R04_PALETTE_LENGTH");
    const auto paletteOffset = paletteIndex * paletteStride;
    const auto colors = palette.subspan(paletteOffset, paletteSize);
    require(std::all_of(colors.begin(), colors.end(), [](auto c) { return c <= 63; }),
            "E_R04_PALETTE_RGB6");

    const auto offsets = readOffsets(tab, pck.size(), tabBits);
    const auto frameCount = offsets.size() - 1;
    std::vector<Raster> rasters(256);
    for (auto id : slots) require(id < frameCount, "E_R04_FRAME_INDEX");
    for (std::size_t id = 0; id < frameCount; ++id) {
        const auto raster = decodeFrame(pck.subspan(offsets[id], offsets[id + 1] - offsets[id]));
        if (std::find(slots.begin(), slots.end(), id) != slots.end()) rasters[id] = raster;
    }

    std::ostringstream out;
    out << R"({"schema":"fgm-regenerator/sprite-facts-v1","width":)" << width
        << R"(,"height":)" << height << R"(,"record":)" << record
        << R"(,"orientation":null,"tab_bits":)" << tabBits
        << R"(,"frame_count":)" << frameCount << R"(,"palette_index":)" << paletteIndex
        << R"(,"palette_offset":)" << paletteOffset << R"(,"palette_rgb6":)";
    writePalette(out, colors, 1);
    out << R"(,"palette_rgb8":)";
    writePalette(out, colors, 4);
    out << R"(,"mcd_frame_slots":[)";
    for (std::size_t i = 0; i < slots.size(); ++i) {
        if (i != 0) out << ',';
        out << unsigned(slots[i]);
    }
    out << R"(],"frames":[)";
    std::array<bool, 256> written{};
    bool first = true;
    for (auto id : slots) {
        if (written[id]) continue;
        written[id] = true;
        if (!first) out << ',';
        first = false;
        out << R"({"id":)" << unsigned(id) << R"(,"offset":)" << offsets[id]
            << R"(,"end_offset":)" << offsets[std::size_t(id) + 1]
            << R"(,"indices_hex":)";
        writeRaster(out, rasters[id], false);
        out << R"(,"alpha_hex":)";
        writeRaster(out, rasters[id], true);
        out << '}';
    }
    out << "]}\n";
    return out.str();
}
} // namespace r04
