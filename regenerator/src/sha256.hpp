#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <string_view>

namespace fgmr {
std::string sha256(std::span<const std::uint8_t> bytes);
inline std::string sha256(std::string_view bytes) {
    return sha256({reinterpret_cast<const std::uint8_t*>(bytes.data()),bytes.size()});
}
}
