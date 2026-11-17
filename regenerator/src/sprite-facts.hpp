#pragma once
#include <cstddef>
#include <cstdint>
#include <span>
#include <string>

namespace r04 {
std::string spriteFacts(std::span<const std::uint8_t> pck,
                        std::span<const std::uint8_t> tab,
                        std::span<const std::uint8_t> palette,
                        std::span<const std::uint8_t> mcd,
                        unsigned tabBits, std::size_t paletteIndex, std::size_t record);
}
