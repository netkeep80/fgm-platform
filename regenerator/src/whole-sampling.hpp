#pragma once
#include <array>
#include <string>
#include <string_view>
#include <vector>

namespace fgmr {
// S43-S1: bounded, deterministic, canonical C05 sampling for a finished
// whole-object FGM package. This does not attest B1 membership or build FGM.
std::string sample_whole(std::string_view package_bytes,
                         std::string_view material,
                         const std::vector<std::array<int, 3>>& local_cells);
} // namespace fgmr
