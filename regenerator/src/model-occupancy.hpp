#pragma once

#include "loft-voxels.hpp"

#include <fgm/evaluator.hpp>
#include <string_view>

namespace fgmr {
inline constexpr std::size_t voxel_count = r03::kHeight*r03::kSide*r03::kSide;

struct Occupancy {
    r03::Rows rows{};
    std::string mask;
    std::size_t occupied = 0;
};

Occupancy sample_occupancy(const fgm::Evaluator& model, std::string_view material);
}
